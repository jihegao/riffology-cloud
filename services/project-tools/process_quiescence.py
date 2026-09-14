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
import re
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


def binding_epoch():
    value = os.environ.get('RIFFOLOGY_BINDING_EPOCH')
    if value is not None and not valid_epoch(value):
        raise RuntimeError('project-epoch-invalid')
    return value


def require_unsealed(directory):
    state = read_state(directory)
    epoch = binding_epoch()
    if state:
        if epoch != state['epoch'] or state['status'] != 'active':
            raise RuntimeError('project-binding-denied')
        return state
    if epoch is not None:
        raise RuntimeError('project-binding-absent')
    try:
        os.stat('.sealed', dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return None
    raise RuntimeError('project-effects-sealed')


def require_sealed(directory):
    state = read_state(directory)
    epoch = binding_epoch()
    if state:
        if epoch != state['epoch'] or state['status'] != 'sealed':
            raise RuntimeError('project-binding-denied')
        require_quiet()
        return state
    if epoch is not None:
        raise RuntimeError('project-binding-absent')
    os.stat('.sealed', dir_fd=directory, follow_symlinks=False)
    return None


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


STATE = 'binding.json'
MAX_EPOCHS = 1024  # Exhaustion requires a fresh container, never tombstone eviction.


def read_state(directory):
    try:
        fd = os.open(STATE, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_size > 150000:
            raise RuntimeError('state-invalid')
        with os.fdopen(os.dup(fd)) as source:
            state = json.load(source)
        if (set(state) != {'schemaVersion', 'epoch', 'status', 'used', 'archiveToken', 'frozen', 'previousFrozen'}
                or state['schemaVersion'] != 1 or state['status'] not in {'active', 'sealed'}
                or not isinstance(state['used'], list) or not 1 <= len(state['used']) <= MAX_EPOCHS
                or any(not valid_epoch(e) for e in state['used'])
                or len(set(state['used'])) != len(state['used']) or state['epoch'] != state['used'][-1]
                or (state['archiveToken'] is not None and not re.fullmatch('[a-f0-9]{52}', state['archiveToken']))
                or not valid_frozen(state['frozen']) or not valid_frozen(state['previousFrozen'])):
            raise RuntimeError('state-invalid')
        return state
    finally:
        os.close(fd)


def valid_epoch(epoch):
    return isinstance(epoch, str) and re.fullmatch('[A-Za-z0-9_-]{1,128}', epoch) is not None


def write_state(directory, state):
    # No in-place writes: a crash leaves either the prior or complete next fence.
    temporary = f'.state-{os.getpid()}-{os.urandom(8).hex()}'
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
    try:
        with os.fdopen(os.dup(fd), 'w') as target:
            json.dump(state, target, separators=(',', ':'))
            target.flush()
            os.fsync(target.fileno())
        os.rename(temporary, STATE, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        os.close(fd)
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass


def require_quiet():
    for _ in range(2):
        if live_project_pids():
            raise RuntimeError('domain-not-quiescent')
        time.sleep(0.02)



def valid_frozen(value):
    return value is None or (isinstance(value, dict) and set(value) == {'token', 'bytes', 'sha256'}
        and isinstance(value['token'], str) and re.fullmatch('[a-f0-9]{52}', value['token']) is not None
        and type(value['bytes']) is int and 0 < value['bytes'] <= 56 * 1024 * 1024
        and isinstance(value['sha256'], str) and re.fullmatch('[a-f0-9]{64}', value['sha256']) is not None)


def activate(epoch):
    if not valid_epoch(epoch):
        raise RuntimeError('project-epoch-invalid')
    with spawn_lock() as directory:
        # Warm leases require native pidfd; cold legacy cleanup keeps its fallback.
        probe = pidfd_open(os.getpid())
        os.close(probe)
        state = read_state(directory)
        if state and state['epoch'] == epoch:
            return {'schemaVersion': 1, 'bindingEpoch': epoch, 'status': state['status']}
        if state and (state['status'] != 'sealed' or epoch in state['used'] or len(state['used']) >= MAX_EPOCHS):
            raise RuntimeError('project-activation-denied')
        require_quiet()
        write_state(directory, {'schemaVersion': 1, 'epoch': epoch, 'status': 'active',
            'used': (state['used'] if state else []) + [epoch], 'archiveToken': None,
            'frozen': None, 'previousFrozen': state['frozen'] if state else None})
        return {'schemaVersion': 1, 'bindingEpoch': epoch, 'status': 'active'}

def seal():
    with spawn_lock() as directory:
        state = read_state(directory)
        epoch = binding_epoch()
        if state:
            if epoch != state['epoch']:
                raise RuntimeError('project-binding-denied')
            probe = pidfd_open(os.getpid())
            os.close(probe)
            state['status'] = 'sealed'
            write_state(directory, state)
        elif epoch is not None:
            raise RuntimeError('project-binding-absent')
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
                return {"schemaVersion": 1, "sealed": True, "quiescent": True, "projectUid": PROJECT_UID,
                        **({'bindingEpoch': epoch} if state else {})}
            for pid in pids:
                kill_project(pid)
            if time.monotonic() >= deadline:
                raise RuntimeError("project-processes-not-quiescent")
            time.sleep(0.02)



def prune(epoch, expected_sha):
    if not valid_epoch(epoch) or not re.fullmatch('[a-f0-9]{64}', expected_sha):
        raise RuntimeError('project-prune-invalid')
    with spawn_lock() as directory:
        state = read_state(directory)
        if (not state or state['epoch'] != epoch or state['status'] != 'sealed' or not state['frozen']
                or state['frozen']['token'] != state['archiveToken'] or state['frozen']['sha256'] != expected_sha):
            raise RuntimeError('project-prune-binding-denied')
        probe = pidfd_open(os.getpid()); os.close(probe)
        require_quiet()
        import workspace_archive
        _, archive_root = workspace_archive.roots()
        archive_fd = os.open(archive_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(archive_fd)
            if info.st_uid != 0 or info.st_mode & 0o077:
                raise RuntimeError('project-prune-root-invalid')
            token = state['archiveToken']
            keep = {f'{token}.restore.json', f'{token}.output.tar'}
            for name in keep:
                info = os.stat(name, dir_fd=archive_fd, follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != 0:
                    raise RuntimeError('project-prune-proof-invalid')
            output = archive_root / f'{token}.output.tar'
            if output.stat().st_size != state['frozen']['bytes'] or workspace_archive.file_sha256(output) != expected_sha:
                raise RuntimeError('project-prune-proof-invalid')
            archive_names = []
            for name in os.listdir(archive_fd):
                if name in keep or not re.fullmatch(r'[a-f0-9]{52}\.(?:input\.tar|output\.tar|verify\.tar|adopt-verify\.tar|restore\.json|lock)(?:\.tmp-[0-9]+)?', name):
                    continue
                info = os.stat(name, dir_fd=archive_fd, follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != 0:
                    raise RuntimeError('project-prune-file-invalid')
                archive_names.append(name)
            effect_names = []
            for name in os.listdir(directory):
                if name == STATE or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}\.json', name):
                    continue
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != 0:
                    raise RuntimeError('project-prune-file-invalid')
                if info.st_size > 1_100_512:
                    continue
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
                try:
                    with os.fdopen(os.dup(fd)) as source:
                        try: envelope = json.load(source)
                        except (ValueError, UnicodeError): continue
                finally:
                    os.close(fd)
                if (isinstance(envelope, dict) and set(envelope) == {'schemaVersion', 'effectId', 'request'}
                        and envelope['schemaVersion'] == 1 and envelope['effectId'] == name[:-5]
                        and isinstance(envelope['request'], str)):
                    effect_names.append(name)
            for name in archive_names: os.unlink(name, dir_fd=archive_fd)
            for name in effect_names: os.unlink(name, dir_fd=directory)
            os.fsync(archive_fd); os.fsync(directory)
            return {'schemaVersion': 1, 'bindingEpoch': epoch, 'status': 'pruned', 'removed': len(archive_names) + len(effect_names)}
        finally:
            os.close(archive_fd)

if __name__ == "__main__":
    try:
        if len(sys.argv) == 4 and sys.argv[1:3] == ['activate', '--epoch']:
            result = activate(sys.argv[3])
        elif len(sys.argv) == 6 and sys.argv[1:3] == ['prune', '--epoch'] and sys.argv[4] == '--files-sha256':
            result = prune(sys.argv[3], sys.argv[5])
        elif sys.argv[1:] == ['seal']:
            result = seal()
        else:
            raise RuntimeError('project-control-command-invalid')
        print(json.dumps(result, separators=(',', ':')))
    except Exception:
        print("project-quiescence-unproven", file=sys.stderr)
        raise SystemExit(4)
