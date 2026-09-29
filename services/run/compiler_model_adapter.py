#!/usr/bin/env python3
"""Root-owned adapter for the fixed sim-engine-compiler v0.1 runtime."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
from pathlib import Path
from typing import Any

from sim_engine_compiler import load_bundle, run_bundle, validate_business


SHA256 = 64
MAX_INPUT_BYTES = 65_536
MAX_BUSINESS_BYTES = 4 * 1024 * 1024
MAX_BUNDLE_BYTES = 128 * 1024 * 1024
MAX_RESULT_BYTES = 65_536
EXECUTION_PROFILE = "sim-engine-compiler-0.1.0/v1"
METRIC_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")


def _unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate-compiler-field")
        value[key] = item
    return value


def _read_regular(path: Path, limit: int) -> bytes:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:
            raise ValueError("invalid-compiler-file")
        data = bytearray()
        while len(data) <= limit:
            chunk = os.read(fd, min(1024 * 1024, limit + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        if len(data) > limit:
            raise ValueError("compiler-file-too-large")
        return bytes(data)
    finally:
        os.close(fd)


def _json(path: Path, limit: int) -> dict[str, Any]:
    value = json.loads(
        _read_regular(path, limit).decode("utf-8"),
        object_pairs_hook=_unique,
        parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)),
    )
    if type(value) is not dict:
        raise ValueError("invalid-compiler-json")
    return value


def _digest(path: Path, limit: int) -> str:
    return hashlib.sha256(_read_regular(path, limit)).hexdigest()


def _content_digest(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _exact(value: Any, fields: set[str]) -> dict[str, Any]:
    if type(value) is not dict or set(value) != fields:
        raise ValueError("invalid-compiler-input")
    return value


def _checked_input(path: Path) -> dict[str, Any]:
    value = _exact(
        _json(path, MAX_INPUT_BYTES),
        {
            "schemaVersion", "runId", "businessIr", "businessSha256", "bundle",
            "bundleSha256", "executionProfile", "parameters", "seed",
        },
    )
    if (
        value["schemaVersion"] != 2
        or type(value["runId"]) is not str
        or not value["runId"]
        or len(value["runId"]) > 128
        or value["executionProfile"] != EXECUTION_PROFILE
        or value["parameters"] != {}
        or type(value["seed"]) is not int
        or not 0 <= value["seed"] <= 4_294_967_295
    ):
        raise ValueError("invalid-compiler-input")
    for key in ("businessSha256", "bundleSha256"):
        if type(value[key]) is not str or len(value[key]) != SHA256 or any(c not in "0123456789abcdef" for c in value[key]):
            raise ValueError("invalid-compiler-digest")
    for key, suffix in (("businessIr", ".json"), ("bundle", ".simpack")):
        raw = value[key]
        if type(raw) is not str or not raw.startswith("model/") or not raw.endswith(suffix):
            raise ValueError("invalid-compiler-path")
        parts = raw.split("/")
        if len(parts) < 2 or any(part in ("", ".", "..", ".riffology") for part in parts):
            raise ValueError("invalid-compiler-path")
    return value


def _declared_metrics(workspace: Path, request: dict[str, Any]) -> set[str]:
    spec = _json(workspace / "model/model-spec.json", 32_768)
    required = {
        "schemaVersion", "researchQuestion", "scope", "entities", "mechanisms",
        "assumptions", "parameters", "metrics", "limitations", "execution",
    }
    execution = spec.get("execution")
    metrics = spec.get("metrics")
    if (
        set(spec) != required
        or spec.get("schemaVersion") != 1
        or spec.get("parameters") != {}
        or type(metrics) is not dict
        or not metrics
        or type(execution) is not dict
        or execution != {"kind": "compiler-v01", "businessIr": request["businessIr"], "bundle": request["bundle"]}
        or any(type(key) is not str or not METRIC_NAME.fullmatch(key) for key in metrics)
    ):
        raise ValueError("invalid-compiler-model-spec")
    return set(metrics)


def _numeric_metrics(raw: Any, declared: set[str]) -> tuple[dict[str, int | float], str]:
    if type(raw) is not dict:
        raise ValueError("invalid-compiler-metrics")
    stop_reason = raw.get("stop_reason")
    if type(stop_reason) is not str or not stop_reason or len(stop_reason) > 256:
        raise ValueError("invalid-compiler-stop-reason")
    for key, value in raw.items():
        if key == "stop_reason":
            continue
        if type(key) is not str or type(value) not in (int, float):
            raise ValueError("invalid-compiler-metric")
        if type(value) is float and not math.isfinite(value):
            raise ValueError("invalid-compiler-metric")
    metrics = {key: raw[key] for key in declared if key in raw}
    if set(metrics) != declared:
        raise ValueError("invalid-compiler-metrics")
    return metrics, stop_reason


def execute(input_path: Path, workspace: Path) -> dict[str, Any]:
    request = _checked_input(input_path)
    business_path = workspace / request["businessIr"]
    bundle_path = workspace / request["bundle"]
    declared_metrics = _declared_metrics(workspace, request)
    if _digest(business_path, MAX_BUSINESS_BYTES) != request["businessSha256"]:
        raise ValueError("compiler-business-digest-mismatch")
    if _digest(bundle_path, MAX_BUNDLE_BYTES) != request["bundleSha256"]:
        raise ValueError("compiler-bundle-digest-mismatch")

    business = _json(business_path, MAX_BUSINESS_BYTES)
    validation = validate_business(business)
    if validation.get("status") != "valid" or validation.get("diagnostics") != []:
        raise ValueError("compiler-business-invalid")
    bundle = load_bundle(bundle_path)
    if bundle.business != business:
        raise ValueError("compiler-business-bundle-mismatch")
    run = run_bundle(bundle_path, seed=request["seed"], run_id=request["runId"], observation="summary")
    identity = _exact(
        run.get("model_identity"),
        {
            "bundle_id", "compiler_version", "runtime_version", "domain_pack",
            "ir_versions", "execution_profile", "plan_fingerprint", "business_fingerprint",
        },
    )
    if (
        run.get("bundle_id") != bundle.bundle_id
        or identity["bundle_id"] != bundle.bundle_id
        or identity["business_fingerprint"] != business.get("fingerprint")
        or validation.get("identity", {}).get("business_fingerprint") != identity["business_fingerprint"]
        or validation.get("identity", {}).get("plan_fingerprint") != identity["plan_fingerprint"]
        or run.get("schema_version") != "sim-engine-run/v1"
        or type(run.get("result_sha256")) is not str
        or run["result_sha256"] != _content_digest(run.get("result"))
    ):
        raise ValueError("compiler-run-identity-mismatch")
    metrics, stop_reason = _numeric_metrics(run.get("result", {}).get("metrics"), declared_metrics)
    return {
        "schemaVersion": 2,
        "metrics": metrics,
        "compiler": {
            "bundleSha256": request["bundleSha256"],
            "bundleId": identity["bundle_id"],
            "businessFingerprint": identity["business_fingerprint"],
            "planFingerprint": identity["plan_fingerprint"],
            "compilerVersion": identity["compiler_version"],
            "runtimeVersion": identity["runtime_version"],
            "domainPack": identity["domain_pack"],
            "irVersions": identity["ir_versions"],
            "executionProfile": identity["execution_profile"],
            "resultSha256": run["result_sha256"],
            "stopReason": stop_reason,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--workspace", default="/workspace")
    args = parser.parse_args()
    result = execute(Path(args.input), Path(args.workspace))
    raw = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(raw) > MAX_RESULT_BYTES:
        raise ValueError("compiler-result-too-large")
    output = Path(args.output)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        view = memoryview(raw)
        while view:
            view = view[os.write(fd, view):]
        os.fsync(fd)
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
