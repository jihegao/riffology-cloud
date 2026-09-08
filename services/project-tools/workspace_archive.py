#!/usr/bin/env python3
"""Canonical, bounded Project Workspace archive freezer/restorer.

The platform invokes only ``freeze`` and ``restore`` with an identity-derived
token. Archives contain regular files and directories only. Restore builds and
verifies a fresh tree inside the Workspace mount before installing its entries.
The helper runs before Pi starts, so a failed install is never exposed to Pi;
the retained input archive makes the next attempt repair a partial install.
"""

from __future__ import annotations

import hashlib
import fcntl
import json
import os
import shutil
import stat
import sys
import tarfile
import unicodedata
from pathlib import Path, PurePosixPath

TOKEN = __import__("re").compile(r"^[a-f0-9]{52}$")
MAX_ARCHIVE_BYTES = 56 * 1024 * 1024
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_ENTRIES = 4096
ALLOWED_FILE_MODES = {0o600, 0o644, 0o700, 0o755}
ALLOWED_DIR_MODES = {0o700, 0o755}
PROJECT_UID = 10001
PROJECT_GID = 10001


class ArchiveError(Exception):
    pass


def fail(code: str) -> None:
    raise ArchiveError(code)


def file_sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            value.update(chunk)
    return value.hexdigest()


def roots() -> tuple[Path, Path]:
    workspace = Path(os.environ.get("RIFFOLOGY_WORKSPACE_ROOT", "/workspace"))
    archive = Path(os.environ.get("RIFFOLOGY_ARCHIVE_ROOT", "/var/lib/riffology/archives"))
    if not workspace.is_absolute() or not archive.is_absolute() or workspace == Path("/"):
        fail("invalid-workspace-archive-root")
    return workspace, archive


def valid_name(value: str) -> str:
    if not value or len(value.encode("utf-8")) > 512 or unicodedata.normalize("NFC", value) != value:
        fail("invalid-workspace-archive-path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", "..", ".riffology"} for part in path.parts):
        fail("invalid-workspace-archive-path")
    if "\\" in value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        fail("invalid-workspace-archive-path")
    encoded = value.encode("utf-8")
    if len(encoded) > 100:
        splits = [index for index, char in enumerate(value) if char == "/"]
        if not any(len(value[:index].encode("utf-8")) <= 155 and len(value[index + 1:].encode("utf-8")) <= 100 for index in splits):
            fail("workspace-archive-path-too-long")
    return value


def inventory(root: Path) -> list[tuple[str, str, int, int]]:
    if root.is_symlink() or not root.is_dir():
        fail("invalid-workspace-root")
    entries: list[tuple[str, str, int, int]] = []
    for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        dirnames.sort()
        filenames.sort()
        relative = Path(current).relative_to(root)
        for name in [*dirnames, *filenames]:
            candidate = Path(current) / name
            logical = valid_name((relative / name).as_posix())
            info = candidate.lstat()
            mode = stat.S_IMODE(info.st_mode)
            if stat.S_ISDIR(info.st_mode):
                if mode not in ALLOWED_DIR_MODES:
                    fail("unsupported-workspace-archive-mode")
                entries.append((logical, "directory", mode, 0))
            elif stat.S_ISREG(info.st_mode):
                if info.st_nlink != 1:
                    fail("workspace-archive-hardlink-denied")
                if mode not in ALLOWED_FILE_MODES or info.st_size > MAX_FILE_BYTES:
                    fail("unsupported-workspace-archive-file")
                entries.append((logical, "file", mode, info.st_size))
            else:
                fail("workspace-archive-special-entry-denied")
            if len(entries) > MAX_ENTRIES:
                fail("workspace-archive-entry-limit")
    entries.sort(key=lambda item: item[0].encode("utf-8"))
    kinds = {name: kind for name, kind, _, _ in entries}
    for name, _, _, _ in entries:
        parts = name.split("/")
        for index in range(1, len(parts)):
            if kinds.get("/".join(parts[:index])) != "directory":
                fail("invalid-workspace-archive-parent")
    return entries


def open_beneath(root_fd: int, logical: str, directory: bool = False) -> int:
    parts = logical.split("/")
    current = os.dup(root_fd)
    try:
        for part in parts[:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            os.close(current)
            current = next_fd
        flags = os.O_RDONLY | os.O_NOFOLLOW | (os.O_DIRECTORY if directory else 0)
        return os.open(parts[-1], flags, dir_fd=current)
    finally:
        os.close(current)


def canonical_tar(root: Path, destination: Path) -> tuple[int, str]:
    entries = inventory(root)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.with_name(destination.name + f".tmp-{os.getpid()}")
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        with tarfile.open(temporary, "w", format=tarfile.USTAR_FORMAT) as archive:
            for logical, kind, mode, expected_size in entries:
                member = tarfile.TarInfo(logical)
                member.uid = member.gid = 0
                member.uname = member.gname = ""
                member.mtime = 0
                member.mode = mode
                if kind == "directory":
                    fd = open_beneath(root_fd, logical, directory=True)
                    try:
                        observed = os.fstat(fd)
                        if not stat.S_ISDIR(observed.st_mode) or stat.S_IMODE(observed.st_mode) != mode:
                            fail("workspace-archive-directory-race")
                    finally:
                        os.close(fd)
                    member.type = tarfile.DIRTYPE
                    member.size = 0
                    archive.addfile(member)
                    continue
                fd = open_beneath(root_fd, logical)
                try:
                    observed = os.fstat(fd)
                    if not stat.S_ISREG(observed.st_mode) or observed.st_nlink != 1 or observed.st_size != expected_size or stat.S_IMODE(observed.st_mode) != mode:
                        fail("workspace-archive-file-race")
                    member.type = tarfile.REGTYPE
                    member.size = observed.st_size
                    with os.fdopen(fd, "rb", closefd=False) as source:
                        archive.addfile(member, source)
                finally:
                    os.close(fd)
        size = temporary.stat().st_size
        if size < 1 or size > MAX_ARCHIVE_BYTES:
            fail("workspace-archive-size-limit")
        digest = file_sha256(temporary)
        os.replace(temporary, destination)
        return size, digest
    finally:
        os.close(root_fd)
        temporary.unlink(missing_ok=True)


def validate_members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = archive.getmembers()
    if len(members) > MAX_ENTRIES:
        fail("workspace-archive-entry-limit")
    names: list[str] = []
    kinds: dict[str, str] = {}
    total = 0
    for member in members:
        name = valid_name(member.name)
        if name in kinds or member.pax_headers or member.uid != 0 or member.gid != 0 or member.uname or member.gname or member.mtime != 0 or member.linkname:
            fail("noncanonical-workspace-archive")
        mode = member.mode
        if member.isdir():
            if mode not in ALLOWED_DIR_MODES or member.size != 0:
                fail("unsupported-workspace-archive-mode")
            kinds[name] = "directory"
        elif member.isreg():
            if mode not in ALLOWED_FILE_MODES or member.size < 0 or member.size > MAX_FILE_BYTES:
                fail("unsupported-workspace-archive-file")
            total += member.size
            if total > MAX_ARCHIVE_BYTES:
                fail("workspace-archive-size-limit")
            kinds[name] = "file"
        else:
            fail("workspace-archive-special-entry-denied")
        names.append(name)
    if names != sorted(names, key=lambda item: item.encode("utf-8")):
        fail("noncanonical-workspace-archive")
    for name in names:
        parts = name.split("/")
        for index in range(1, len(parts)):
            if kinds.get("/".join(parts[:index])) != "directory":
                fail("invalid-workspace-archive-parent")
    return members


def extract_canonical(source: Path, stage: Path, verification: Path) -> tuple[int, str]:
    size = source.stat().st_size
    if size < 1 or size > MAX_ARCHIVE_BYTES:
        fail("workspace-archive-size-limit")
    stage.mkdir(mode=0o700)
    with tarfile.open(source, "r:") as archive:
        members = validate_members(archive)
        for member in members:
            target = stage / member.name
            if member.isdir():
                target.mkdir(mode=member.mode)
            else:
                payload = archive.extractfile(member)
                if payload is None:
                    fail("invalid-workspace-archive-file")
                target.parent.mkdir(parents=True, exist_ok=True)
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, member.mode)
                written = 0
                try:
                    with os.fdopen(fd, "wb", closefd=False) as output:
                        while True:
                            chunk = payload.read(1024 * 1024)
                            if not chunk:
                                break
                            written += len(chunk)
                            if written > member.size:
                                fail("invalid-workspace-archive-file")
                            output.write(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                finally:
                    os.close(fd)
                if written != member.size:
                    fail("invalid-workspace-archive-file")
                os.chmod(target, member.mode, follow_symlinks=False)
    verified_size, digest = canonical_tar(stage, verification)
    if verified_size != size or source.read_bytes() != verification.read_bytes():
        fail("noncanonical-workspace-archive")
    return size, digest


def owner() -> tuple[int, int]:
    return (PROJECT_UID, PROJECT_GID) if os.geteuid() == 0 else (os.geteuid(), os.getegid())


def set_owner(root: Path) -> None:
    uid, gid = owner()
    for current, dirnames, filenames in os.walk(root, topdown=False, followlinks=False):
        for name in filenames:
            os.chown(Path(current) / name, uid, gid, follow_symlinks=False)
        for name in dirnames:
            os.chown(Path(current) / name, uid, gid, follow_symlinks=False)
    os.chown(root, uid, gid, follow_symlinks=False)
    os.chmod(root, 0o755)


def restore(workspace: Path, archive_root: Path, token: str) -> dict[str, object]:
    source = archive_root / f"{token}.input.tar"
    control = workspace / ".riffology"
    stage = control / "restore-new"
    verification = archive_root / f"{token}.verify.tar"
    marker = archive_root / f"{token}.restore.json"
    source_size = source.stat().st_size
    source_digest = file_sha256(source)
    if marker.exists():
        try:
            saved = json.loads(marker.read_text("utf-8"))
        except Exception:
            fail("invalid-workspace-restore-marker")
        if saved != {"bytes": source_size, "ok": True, "operation": "restore", "sha256": source_digest}:
            fail("workspace-restore-replay-conflict")
        if workspace.is_dir() and not workspace.is_symlink():
            return saved
    if workspace.is_symlink() or (workspace.exists() and not workspace.is_dir()):
        fail("invalid-workspace-root")
    workspace.mkdir(mode=0o755, parents=True, exist_ok=True)
    if control.is_symlink() or (control.exists() and not control.is_dir()):
        control.unlink()
    elif control.exists():
        shutil.rmtree(control)
    control.mkdir(mode=0o700)
    try:
        size, digest = extract_canonical(source, stage, verification)
        set_owner(stage)
        for current in workspace.iterdir():
            if current == control:
                continue
            if current.is_dir() and not current.is_symlink():
                shutil.rmtree(current)
            else:
                current.unlink()
        for current in sorted(stage.iterdir(), key=lambda item: item.name.encode("utf-8")):
            os.replace(current, workspace / current.name)
        directory = os.open(workspace, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        shutil.rmtree(control)
        result = {"ok": True, "operation": "restore", "bytes": size, "sha256": digest}
        temporary_marker = marker.with_name(marker.name + f".tmp-{os.getpid()}")
        temporary_marker.write_text(json.dumps(result, sort_keys=True, separators=(",", ":")), "utf-8")
        os.replace(temporary_marker, marker)
        return result
    finally:
        if control.exists():
            shutil.rmtree(control)
        verification.unlink(missing_ok=True)


def freeze(workspace: Path, archive_root: Path, token: str) -> dict[str, object]:
    output = archive_root / f"{token}.output.tar"
    size, digest = canonical_tar(workspace, output)
    return {"ok": True, "operation": "freeze", "bytes": size, "sha256": digest}


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in {"freeze", "restore"} or not TOKEN.fullmatch(sys.argv[2]):
        fail("invalid-workspace-archive-command")
    workspace, archive_root = roots()
    archive_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(archive_root, 0o700)
    lock_path = archive_root / f"{sys.argv[2]}.lock"
    with lock_path.open("a+b") as lock:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        result = freeze(workspace, archive_root, sys.argv[2]) if sys.argv[1] == "freeze" else restore(workspace, archive_root, sys.argv[2])
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ArchiveError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(4)
    except Exception:
        print("workspace-archive-operation-failed", file=sys.stderr)
        raise SystemExit(4)
