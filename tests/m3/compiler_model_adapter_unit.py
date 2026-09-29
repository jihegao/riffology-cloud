import hashlib
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
fake = types.ModuleType("sim_engine_compiler")
fake.load_bundle = lambda path: None
fake.run_bundle = lambda path, **options: None
fake.validate_business = lambda value: None
sys.modules["sim_engine_compiler"] = fake

adapter_spec = importlib.util.spec_from_file_location("compiler_model_adapter", ROOT / "services/run/compiler_model_adapter.py")
adapter = importlib.util.module_from_spec(adapter_spec)
adapter_spec.loader.exec_module(adapter)
artifacts_spec = importlib.util.spec_from_file_location("simulation_artifacts", ROOT / "services/run/simulation_artifacts.py")
artifacts = importlib.util.module_from_spec(artifacts_spec)
artifacts_spec.loader.exec_module(artifacts)


def digest(data):
    return hashlib.sha256(data).hexdigest()


class Bundle:
    def __init__(self, business):
        self.business = business
        self.bundle_id = "a" * 64


class CompilerAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "model").mkdir()
        self.business = {"version": "aircraft-business-ir/v1", "fingerprint": "b" * 64, "payload": {}}
        business_raw = json.dumps(self.business, separators=(",", ":")).encode()
        bundle_raw = b"fixed-bundle"
        (self.root / "model/business-ir.json").write_bytes(business_raw)
        (self.root / "model/model.simpack").write_bytes(bundle_raw)
        self.request = {
            "schemaVersion": 2,
            "runId": "run-1",
            "businessIr": "model/business-ir.json",
            "businessSha256": digest(business_raw),
            "bundle": "model/model.simpack",
            "bundleSha256": digest(bundle_raw),
            "executionProfile": adapter.EXECUTION_PROFILE,
            "parameters": {},
            "seed": 7,
        }
        (self.root / "model/model-spec.json").write_text(json.dumps({
            "schemaVersion": 1, "researchQuestion": "q", "scope": "s", "entities": [],
            "mechanisms": [], "assumptions": [], "parameters": {},
            "metrics": {"completed": {}, "ratio": {}}, "limitations": [],
            "execution": {"kind": "compiler-v01", "businessIr": "model/business-ir.json", "bundle": "model/model.simpack"},
        }))
        self.input = self.root / "input.json"
        self.input.write_text(json.dumps(self.request))
        adapter.validate_business = lambda value: {
            "status": "valid", "diagnostics": [],
            "identity": {"business_fingerprint": "b" * 64, "plan_fingerprint": "c" * 64},
        }
        adapter.load_bundle = lambda path: Bundle(self.business)
        self.run_result = {"metrics": {"completed": 2, "ratio": 0.5, "engine_extra": 9, "stop_reason": "duration"}}
        self.run_record = {
            "schema_version": "sim-engine-run/v1",
            "bundle_id": "a" * 64,
            "model_identity": {
                "bundle_id": "a" * 64,
                "compiler_version": "0.1.0",
                "runtime_version": "0.1.0",
                "domain_pack": {"name": "aircraft-support", "version": "aircraft-support-pack/v0.1"},
                "ir_versions": {"business": "aircraft-business-ir/v1", "core": "simulation-core-ir/v2", "plan": "aircraft-support-plan/v1alpha2", "lineage": "compiler-lineage/v2"},
                "execution_profile": {"semantic": "legacy-minute-v1", "rng": "legacy-sequential-v1", "work": "stable-topological-serial", "resource_dispatch_index": "absent"},
                "plan_fingerprint": "c" * 64,
                "business_fingerprint": "b" * 64,
            },
            "result": self.run_result,
            "result_sha256": adapter._content_digest(self.run_result),
        }
        adapter.run_bundle = lambda path, **options: self.run_record

    def test_binds_sources_and_emits_exact_numeric_result(self):
        result = adapter.execute(self.input, self.root)
        self.assertEqual(result["schemaVersion"], 2)
        self.assertEqual(result["metrics"], {"completed": 2, "ratio": 0.5})
        self.assertEqual(result["compiler"]["bundleSha256"], self.request["bundleSha256"])
        self.assertEqual(result["compiler"]["stopReason"], "duration")
        self.assertIs(artifacts.validate_result(result), result)

    def test_rejects_bundle_from_a_different_business_revision(self):
        adapter.load_bundle = lambda path: Bundle({**self.business, "fingerprint": "e" * 64})
        with self.assertRaisesRegex(ValueError, "compiler-business-bundle-mismatch"):
            adapter.execute(self.input, self.root)

    def test_rejects_unbound_result_digest_and_unknown_nonnumeric_metric(self):
        self.run_record["result_sha256"] = "d" * 64
        with self.assertRaisesRegex(ValueError, "compiler-run-identity-mismatch"):
            adapter.execute(self.input, self.root)
        self.run_record["result_sha256"] = adapter._content_digest(self.run_result)
        self.run_result["metrics"]["warning"] = "partial"
        self.run_record["result_sha256"] = adapter._content_digest(self.run_result)
        with self.assertRaisesRegex(ValueError, "invalid-compiler-metric"):
            adapter.execute(self.input, self.root)

    def test_rejects_model_spec_bound_to_other_sources(self):
        spec = json.loads((self.root / "model/model-spec.json").read_text())
        spec["execution"]["bundle"] = "model/other.simpack"
        (self.root / "model/model-spec.json").write_text(json.dumps(spec))
        with self.assertRaisesRegex(ValueError, "invalid-compiler-model-spec"):
            adapter.execute(self.input, self.root)

    def test_v2_artifact_contract_rejects_extra_fields_and_nonfinite_metrics(self):
        result = adapter.execute(self.input, self.root)
        with self.assertRaisesRegex(ValueError, "invalid-simulation-result"):
            artifacts.validate_result({**result, "outputs": []})
        result["metrics"]["bad"] = float("nan")
        with self.assertRaisesRegex(ValueError, "invalid-simulation-result"):
            artifacts.validate_result(result)

    def test_v1_artifact_contract_remains_accepted(self):
        result = {"schemaVersion": 1, "metrics": {"score": "project-contract-owned"}}
        self.assertIs(artifacts.validate_result(result), result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
