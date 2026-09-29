"""Collect bounded, root-owned simulation artifacts after the child is sealed."""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import stat
from pathlib import Path
from typing import Any


_NAME = re.compile(r"^[A-Za-z0-9_-]+\.(?:json|csv|txt|png)$")
_MEDIA_TYPES = {"json": "application/json", "csv": "text/csv", "txt": "text/plain", "png": "image/png"}
_MAX_FILES = 4
_MAX_FILE_BYTES = 16_384
_MAX_TOTAL_BYTES = 32_768
_SHA = re.compile(r"^[a-f0-9]{64}$")


def _compiler_identity(value: Any) -> None:
    fields = {
        "bundleSha256", "bundleId", "businessFingerprint", "planFingerprint",
        "compilerVersion", "runtimeVersion", "domainPack", "irVersions",
        "executionProfile", "resultSha256", "stopReason",
    }
    if type(value) is not dict or set(value) != fields:
        raise ValueError("invalid-simulation-result")
    for key in ("bundleSha256", "bundleId", "businessFingerprint", "planFingerprint", "resultSha256"):
        if type(value[key]) is not str or not _SHA.fullmatch(value[key]):
            raise ValueError("invalid-simulation-result")
    for key in ("compilerVersion", "runtimeVersion", "stopReason"):
        if type(value[key]) is not str or not value[key] or len(value[key]) > 256:
            raise ValueError("invalid-simulation-result")
    if value["compilerVersion"] != "0.1.0" or value["runtimeVersion"] != "0.1.0":
        raise ValueError("invalid-simulation-result")
    nested = {
        "domainPack": {"name", "version"},
        "irVersions": {"business", "core", "plan", "lineage"},
        "executionProfile": {"semantic", "rng", "work", "resource_dispatch_index"},
    }
    for key, fields in nested.items():
        if type(value[key]) is not dict or set(value[key]) != fields or any(type(item) is not str or not item or len(item) > 256 for item in value[key].values()):
            raise ValueError("invalid-simulation-result")
    if (
        value["domainPack"] != {"name": "aircraft-support", "version": "aircraft-support-pack/v0.1"}
        or value["irVersions"] != {"business": "aircraft-business-ir/v1", "core": "simulation-core-ir/v2", "plan": "aircraft-support-plan/v1alpha2", "lineage": "compiler-lineage/v2"}
        or value["executionProfile"].get("semantic") not in ("legacy-minute-v1", "event-time-v2")
        or {key: item for key, item in value["executionProfile"].items() if key != "semantic"} != {"rng": "legacy-sequential-v1", "work": "stable-topological-serial", "resource_dispatch_index": "absent"}
    ):
        raise ValueError("invalid-simulation-result")
    try:
        json_value = json.dumps(value, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError, RecursionError) as exc:
        raise ValueError("invalid-simulation-result") from exc
    if len(json_value.encode("utf-8")) > 16_384:
        raise ValueError("invalid-simulation-result")


def _valid_result(result: Any) -> None:
    if type(result) is not dict:
        raise ValueError("invalid-simulation-result")
    if result.get("schemaVersion") == 1:
        if set(result) not in ({"schemaVersion", "metrics"}, {"schemaVersion", "metrics", "outputs"}) or type(result.get("metrics")) is not dict:
            raise ValueError("invalid-simulation-result")
        return
    if result.get("schemaVersion") != 2 or set(result) != {"schemaVersion", "metrics", "compiler"} or type(result.get("metrics")) is not dict:
        raise ValueError("invalid-simulation-result")
    if not result["metrics"]:
        raise ValueError("invalid-simulation-result")
    for key, value in result["metrics"].items():
        if type(key) is not str or not key or type(value) not in (int, float) or type(value) is float and not math.isfinite(value):
            raise ValueError("invalid-simulation-result")
    _compiler_identity(result["compiler"])


def validate_result(result: Any) -> dict[str, Any]:
    """Validate the exact finite result envelope before platform publication."""
    _valid_result(result)
    return result


def _read_regular(path: Path) -> bytes:
    try:
        info = path.lstat()
    except (FileNotFoundError, OSError) as exc:
        raise ValueError("simulation-output-unavailable") from exc
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_nlink != 1:
        raise ValueError("invalid-simulation-output-file")
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError as exc:
        raise ValueError("invalid-simulation-output-file") from exc
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 or opened.st_dev != info.st_dev or opened.st_ino != info.st_ino:
            raise ValueError("invalid-simulation-output-file")
        data = bytearray()
        while len(data) <= _MAX_FILE_BYTES:
            chunk = os.read(fd, _MAX_FILE_BYTES + 1 - len(data))
            if not chunk:
                break
            data.extend(chunk)
        if len(data) > _MAX_FILE_BYTES:
            raise ValueError("simulation-output-too-large")
        return bytes(data)
    finally:
        os.close(fd)


def collect_outputs(result: dict[str, Any], output_root: str | os.PathLike[str]) -> dict[str, Any]:
    """Replace declared output basenames with bounded, content-addressed data.

    The caller invokes this only after the process seal. A result without an
    ``outputs`` declaration is returned unchanged for compatibility.
    """
    _valid_result(result)
    if "outputs" not in result:
        return result
    outputs = result["outputs"]
    if type(outputs) is not list or len(outputs) > _MAX_FILES:
        raise ValueError("invalid-simulation-outputs")
    root = Path(output_root)
    seen: set[str] = set()
    collected: list[dict[str, Any]] = []
    total = 0
    for name in outputs:
        if type(name) is not str or not _NAME.fullmatch(name) or name == "result.json" or name in seen:
            raise ValueError("invalid-simulation-output-name")
        seen.add(name)
        data = _read_regular(root / name)
        total += len(data)
        if total > _MAX_TOTAL_BYTES:
            raise ValueError("simulation-outputs-too-large")
        suffix = name.rsplit(".", 1)[1]
        collected.append({
            "path": name,
            "sha256": hashlib.sha256(data).hexdigest(),
            "data": base64.b64encode(data).decode("ascii"),
            "mediaType": _MEDIA_TYPES[suffix],
            "size": len(data),
        })
    return {**result, "outputs": collected}
