"""Collect bounded, root-owned simulation artifacts after the child is sealed."""

from __future__ import annotations

import base64
import hashlib
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


def _valid_result(result: Any) -> None:
    if type(result) is not dict or set(result) not in ({"schemaVersion", "metrics"}, {"schemaVersion", "metrics", "outputs"}):
        raise ValueError("invalid-simulation-result")
    if result.get("schemaVersion") != 1 or type(result.get("metrics")) is not dict:
        raise ValueError("invalid-simulation-result")


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
