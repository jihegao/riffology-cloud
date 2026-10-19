"""Small JSON boundary around the public sim-engine-compiler 0.1.0 SDK.

No simulation runs here. The independent reference action is test-only.
"""
import json
import sys
from pathlib import Path


def main():
    from sim_engine_compiler import (
        __version__, ProductError, seal_business, validate_business,
        compile_bundle, inspect_model, load_bundle,
    )
    action, source, *rest = sys.argv[1:]
    if __version__ != "0.1.0":
        raise ProductError("compiler_version", "sim-engine-compiler 0.1.0 required", stage="load")
    if action == "probe":
        return {"version": __version__, "module": str(Path(sys.modules['sim_engine_compiler'].__file__).parent)}
    if action == "check":
        def no_duplicates(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate JSON field: " + key)
                result[key] = value
            return result
        try:
            value = json.loads(Path(source).read_text(), object_pairs_hook=no_duplicates,
                               parse_constant=lambda x: (_ for _ in ()).throw(ValueError("invalid number: " + x)))
        except json.JSONDecodeError as error:
            return {"status": "failed", "diagnostics": [{"code": "invalid_json", "stage": "load", "path": source,
                    "line": error.lineno, "column": error.colno, "message": error.msg}]}
        except (OSError, ValueError) as error:
            raise ProductError("invalid_json", str(error), stage="load", path=source)
        if not isinstance(value, dict) or value.get("version") != "aircraft-business-ir/v1" or not isinstance(value.get("payload"), dict):
            raise ProductError("invalid_business", "Business envelope with object payload required", stage="seal", path=source + "/payload")
        sealed = seal_business(value["payload"])
        report = validate_business(sealed)
        if report["status"] != "valid":
            return {"status": "failed", "diagnostics": report["diagnostics"]}
        return {"status": "passed", "sealed": sealed, "identity": report["identity"], "diagnostics": report["diagnostics"]}
    if action == "compile":
        report = compile_bundle(source, rest[0])
        inspection = inspect_model(rest[0])
        if inspection["status"] != "valid" or inspection.get("association_status") != "verified":
            return {"status": "failed", "diagnostics": inspection["diagnostics"]}
        bundle = load_bundle(rest[0])
        return {"status": "succeeded", "report": report, "inspection": inspection,
                "manifest": bundle.manifest, "plan": bundle.plan, "lineage": bundle.lineage,
                "business": bundle.business, "diagnostics": inspection["diagnostics"]}
    if action == "reference":
        from sim_engine_compiler.ir.plan import ExecutionPlan
        from sim_engine_compiler.reference import SimpyReferenceRuntime
        return SimpyReferenceRuntime(ExecutionPlan.from_dict(json.loads(Path(source).read_text())), seed=0).run()
    raise ProductError("unknown_action", action, stage="load")


try:
    print(json.dumps(main(), ensure_ascii=False, allow_nan=False))
except Exception as error:
    diagnostic = error.diagnostic() if hasattr(error, "diagnostic") else {
        "code": "compiler_unavailable" if isinstance(error, ImportError) else "compiler_error",
        "stage": "load", "message": str(error),
    }
    print(json.dumps({"status": "failed", "diagnostics": [diagnostic]}, ensure_ascii=False))
    sys.exit(2)
