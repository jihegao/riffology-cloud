#!/usr/bin/env python3
"""Root-only transport wrapper for one platform-authored project effect."""

import json
import os
import pwd
import re
import stat
import select
import sys

from process_quiescence import spawn_lock, require_unsealed, PROJECT_UID
import project_network_fence

CONTROL_ROOT = "/var/lib/riffology/effects"
HELPER = "/opt/riffology/file_service.py"
WORKSPACE = "/workspace"
MAX_CONTROL_BYTES = 1_100_512
ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
ENV = {"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin", "RIFFOLOGY_WORKSPACE_ROOT": WORKSPACE}
PLATFORM_EGRESS_MARKER = "workerd-deny-all-v1"
PLATFORM_EGRESS_ENV = "RIFFOLOGY_PROJECT_PLATFORM_EGRESS_FENCE"


def fail() -> "NoReturn":
    print("project-effect-control-invalid", file=sys.stderr)
    raise SystemExit(4)


def platform_egress_fence_active() -> bool:
    if os.environ.get(PLATFORM_EGRESS_ENV) != PLATFORM_EGRESS_MARKER:
        return False
    try:
        fields = dict(
            line.split(":", 1) for line in open("/proc/self/status", encoding="ascii")
            if line.startswith(("NoNewPrivs:", "Seccomp:"))
        )
    except (OSError, ValueError):
        return False
    return fields.get("NoNewPrivs", "").strip() == "1" and fields.get("Seccomp", "").strip() == "2"


def install_child_network_fence() -> None:
    try:
        project_network_fence.install()
    except RuntimeError as error:
        # linux/amd64 containers translated on an arm64 local Docker VM cannot
        # stack even an empty seccomp filter (libseccomp returns -ECANCELED).
        # Only the locked vertical image may rely on Workerd's deny-all
        # container egress boundary; production images remain fail closed.
        if str(error) != "project-network-seccomp-load-failed:-125" or not platform_egress_fence_active():
            raise


def drop_to_project() -> None:
    account = pwd.getpwnam("project")
    if account.pw_uid != PROJECT_UID:
        raise RuntimeError("project-account-invalid")
    install_child_network_fence()
    os.setgroups([])
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
    os.umask(0o077)


def run_effect(directory) -> tuple[int, int, str]:
    if len(sys.argv) != 2 or not ID.fullmatch(sys.argv[1]):
        fail()
    effect_id = sys.argv[1]
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    root_fd = os.open(CONTROL_ROOT, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    try:
        fd = os.open(f"{effect_id}.json", flags, dir_fd=root_fd)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > MAX_CONTROL_BYTES:
                fail()
            chunks = []
            size = 0
            while True:
                chunk = os.read(fd, min(65536, MAX_CONTROL_BYTES + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > MAX_CONTROL_BYTES:
                    fail()
            content = b"".join(chunks)
        finally:
            os.close(fd)
        os.unlink(f"{effect_id}.json", dir_fd=root_fd)
    finally:
        os.close(root_fd)
    try:
        envelope = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail()
    if type(envelope) is not dict or set(envelope) != {"schemaVersion", "effectId", "request"}:
        fail()
    if envelope["schemaVersion"] != 1 or envelope["effectId"] != effect_id or type(envelope["request"]) is not str:
        fail()
    request = envelope["request"]
    if len(request.encode("utf-8")) > 1_100_000:
        fail()
    input_r, input_w = os.pipe2(os.O_CLOEXEC)
    ready_r, ready_w = os.pipe2(os.O_CLOEXEC)
    gate_r, gate_w = os.pipe2(os.O_CLOEXEC)
    child = os.fork()
    if child == 0:
        try:
            os.dup2(input_r, 0)
            for item in os.listdir('/proc/self/fd'):
                fd = int(item)
                if fd > 2 and fd not in {ready_w, gate_r}:
                    try: os.close(fd)
                    except OSError: pass
            os.chdir(WORKSPACE)
            drop_to_project()
            os.write(ready_w, b'R')
            os.close(ready_w)
            if os.read(gate_r, 1) != b'G': os._exit(4)
            os.close(gate_r)
            os.execve(sys.executable, [sys.executable, HELPER], ENV)
        except BaseException:
            os._exit(4)
    os.close(input_r); os.close(ready_w); os.close(gate_r)
    try:
        if not select.select([ready_r], [], [], 2)[0] or os.read(ready_r, 1) != b'R':
            raise RuntimeError('project-spawn-drop-unproven')
        os.write(gate_w, b'G')
    except BaseException:
        os.close(input_w)
        raise
    finally:
        os.close(ready_r); os.close(gate_w)
    return child, input_w, request


def main() -> int:
    with spawn_lock() as directory:
        require_unsealed(directory)  # Check before even consuming a staged control.
        child, input_w, request = run_effect(directory)
    try:
        with os.fdopen(input_w, 'wb') as target:
            target.write(request.encode('utf-8'))
    except BrokenPipeError:
        pass
    _, status = os.waitpid(child, 0)
    result = os.waitstatus_to_exitcode(status)
    return result if result >= 0 else 128 - result


if __name__ == "__main__":
    raise SystemExit(main())
