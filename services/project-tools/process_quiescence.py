#!/usr/bin/env python3
"""Root-owned, fail-closed lifetime fence for a per-turn Project container."""
import ctypes
import errno
import platform
import fcntl
import json
import os
import pwd
import signal
import stat
import sys
import time
from contextlib import contextmanager

CONTROL_ROOT = "/var/lib/riffology/effects"
PROJECT_UID = 10001


def validate_account():
    if os.geteuid() != 0 or pwd.getpwnam("project").pw_uid != PROJECT_UID:
        raise RuntimeError("project-account-invalid")


@contextmanager
def spawn_lock():
    validate_account()
    directory = os.open(CONTROL_ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    lock = None
    try:
        info = os.fstat(directory)
        if info.st_uid != 0 or info.st_mode & 0o077:
            raise RuntimeError("project-control-permissions-invalid")
        lock = os.open(".spawn.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
        info = os.fstat(lock)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise RuntimeError("project-lock-invalid")
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield directory
    finally:
        if lock is not None:
            os.close(lock)
        os.close(directory)


def require_unsealed(directory):
    try:
        os.stat(".sealed", dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise RuntimeError("project-effects-sealed")


def live_project_pids():
    result = []
    for name in os.listdir("/proc"):
        if not name.isdecimal():
            continue
        try:
            with open(f"/proc/{name}/status") as source:
                fields = dict(line.split(":", 1) for line in source if ":" in line)
            # Zombies cannot execute or write and may await an external reaper.
            if PROJECT_UID in map(int, fields["Uid"].split()) and fields["State"].strip()[0] not in "ZX":
                result.append(int(name))
        except (FileNotFoundError, ProcessLookupError):
            continue
    return result


def pidfd_open(pid):
    if hasattr(os, "pidfd_open"):
        return os.pidfd_open(pid, 0)
    return linux_syscall(434, pid, 0)


def pidfd_kill(handle):
    if hasattr(signal, "pidfd_send_signal"):
        return signal.pidfd_send_signal(handle, signal.SIGKILL)
    return linux_syscall(424, handle, signal.SIGKILL, 0, 0)


def linux_syscall(number, *args):
    # musl Python builds may omit the Python wrappers; these syscall numbers
    # are shared by the two supported Linux container architectures.
    if sys.platform != "linux" or platform.machine() not in {"x86_64", "aarch64"}:
        raise RuntimeError("project-pidfd-required")
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    result = libc.syscall(ctypes.c_long(number), *(ctypes.c_long(v) for v in args))
    if result == -1:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))
    return result


def kill_as_project(pid):
    # Kernel permission checks protect against PID reuse: this child can signal
    # only project-owned processes, all of which are intentionally in scope.
    child = os.fork()
    if child == 0:
        try:
            account = pwd.getpwnam("project")
            os.setgroups([])
            os.setgid(account.pw_gid)
            os.setuid(PROJECT_UID)
            try:
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            os._exit(0)
        except BaseException:
            os._exit(4)
    _, status = os.waitpid(child, 0)
    if status != 0:
        raise RuntimeError("project-signal-unproven")


def kill_project(pid):
    # Prefer pidfd; fallback signals only after dropping root privileges.
    try:
        handle = pidfd_open(pid)
    except ProcessLookupError:
        return
    except OSError as error:
        if error.errno != errno.ENOSYS:
            raise
        kill_as_project(pid)
        return
    try:
        try:
            with open(f"/proc/{pid}/status") as source:
                fields = dict(line.split(":", 1) for line in source if ":" in line)
            if PROJECT_UID not in map(int, fields["Uid"].split()):
                return
            # An exited pidfd reports -1 even if the numeric PID was reused.
            with open(f"/proc/self/fdinfo/{handle}") as source:
                bound = dict(line.split(":", 1) for line in source if ":" in line)
            if int(bound["Pid"].strip()) != pid:
                return
            pidfd_kill(handle)
        except (FileNotFoundError, ProcessLookupError):
            return
    finally:
        os.close(handle)


def seal():
    with spawn_lock() as directory:
        marker = os.open(".sealed", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
        try:
            info = os.fstat(marker)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
                raise RuntimeError("project-seal-invalid")
            os.fsync(marker)
            os.fsync(directory)
        finally:
            os.close(marker)
        deadline = time.monotonic() + 8
        empty_scans = 0
        while True:
            # Kernel enumerates the entire permission-scoped process domain,
            # covering children forked while a userspace /proc list was read.
            kill_as_project(-1)
            pids = live_project_pids()
            empty_scans = empty_scans + 1 if not pids else 0
            if empty_scans >= 2:
                return {"schemaVersion": 1, "sealed": True, "quiescent": True, "projectUid": PROJECT_UID}
            for pid in pids:
                kill_project(pid)
            if time.monotonic() >= deadline:
                raise RuntimeError("project-processes-not-quiescent")
            time.sleep(0.02)


if __name__ == "__main__":
    try:
        if sys.argv[1:] != ["seal"]:
            raise RuntimeError("project-control-command-invalid")
        print(json.dumps(seal(), separators=(",", ":")))
    except Exception:
        print("project-quiescence-unproven", file=sys.stderr)
        raise SystemExit(4)
