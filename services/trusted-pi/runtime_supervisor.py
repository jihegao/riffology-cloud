#!/usr/bin/env python3
"""Root-owned, fail-closed lifetime fence for a TrustedPi execution domain."""
import ctypes
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
import select
from contextlib import contextmanager

CONTROL_ROOT = "/var/lib/riffology/runtime-control"
PI_UID = 10002


def validate_account():
    if os.geteuid() != 0 or pwd.getpwnam("trustedpi").pw_uid != PI_UID or pwd.getpwnam("trustedpi").pw_gid == 0:
        raise RuntimeError("trustedpi-account-invalid")


@contextmanager
def spawn_lock():
    validate_account()
    # Even an empty-domain receipt requires the native pidfd capability.
    probe = pidfd_open(os.getpid())
    os.close(probe)
    directory = os.open(CONTROL_ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    lock = None
    try:
        info = os.fstat(directory)
        if info.st_uid != 0 or info.st_mode & 0o077:
            raise RuntimeError("trustedpi-control-permissions-invalid")
        lock = os.open(".spawn.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
        info = os.fstat(lock)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise RuntimeError("trustedpi-lock-invalid")
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield directory
    finally:
        if lock is not None:
            os.close(lock)
        os.close(directory)


def live_trustedpi_pids():
    result = []
    for name in os.listdir("/proc"):
        if not name.isdecimal():
            continue
        try:
            with open(f"/proc/{name}/status") as source:
                fields = dict(line.split(":", 1) for line in source if ":" in line)
            # Zombies cannot execute or write and may await an external reaper.
            if PI_UID in map(int, fields["Uid"].split()) and fields["State"].strip()[0] not in "ZX":
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
        raise RuntimeError("trustedpi-pidfd-required")
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    result = libc.syscall(ctypes.c_long(number), *(ctypes.c_long(v) for v in args))
    if result == -1:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))
    return result


def kill_as_trustedpi(pid):
    # Kernel permission checks protect against PID reuse: this child can signal
    # only trustedpi-owned processes, all of which are intentionally in scope.
    child = os.fork()
    if child == 0:
        try:
            account = pwd.getpwnam("trustedpi")
            os.setgroups([])
            os.setgid(account.pw_gid)
            os.setuid(PI_UID)
            try:
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            os._exit(0)
        except BaseException:
            os._exit(4)
    _, status = os.waitpid(child, 0)
    if status != 0:
        raise RuntimeError("trustedpi-signal-unproven")


def kill_trustedpi(pid):
    # A pidfd binds the signal to this process instance.
    try:
        handle = pidfd_open(pid)
    except ProcessLookupError:
        return
    try:
        try:
            with open(f"/proc/{pid}/status") as source:
                fields = dict(line.split(":", 1) for line in source if ":" in line)
            if PI_UID not in map(int, fields["Uid"].split()):
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
NODE = '/usr/local/bin/node'
HOST = '/opt/riffology/trusted-pi/trusted-pi-turn-host.mjs'
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
        if (set(state) != {'schemaVersion', 'epoch', 'status', 'used', 'spawnToken'}
                or state['schemaVersion'] != 1 or state['status'] not in {'active', 'sealed'}
                or not isinstance(state['used'], list) or not 1 <= len(state['used']) <= MAX_EPOCHS
                or any(not valid_epoch(e) for e in state['used'])
                or len(set(state['used'])) != len(state['used']) or state['epoch'] != state['used'][-1]
                or (state['spawnToken'] is not None and not re.fullmatch('[a-f0-9]{52}', state['spawnToken']))):
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
        if live_trustedpi_pids():
            raise RuntimeError('domain-not-quiescent')
        time.sleep(0.02)


def activate(epoch):
    with spawn_lock() as directory:
        state = read_state(directory)
        if state and state['epoch'] == epoch:
            # Retried activation never removes a seal, even after a lost ACK.
            return {'schemaVersion': 1, 'bindingEpoch': epoch, 'status': state['status']}
        if state and (state['status'] != 'sealed' or epoch in state['used'] or len(state['used']) >= MAX_EPOCHS):
            raise RuntimeError('activation-denied')
        require_quiet()
        write_state(directory, {'schemaVersion': 1, 'epoch': epoch, 'status': 'active',
                                'used': (state['used'] if state else []) + [epoch], 'spawnToken': None})
        return {'schemaVersion': 1, 'bindingEpoch': epoch, 'status': 'active'}


def seal(epoch):
    with spawn_lock() as directory:
        state = read_state(directory)
        if not state or state['epoch'] != epoch:
            raise RuntimeError('epoch-mismatch')
        state['status'] = 'sealed'
        write_state(directory, state)  # Durable admission fence BEFORE any signal.
        deadline = time.monotonic() + 8
        empty = 0
        while True:
            # Signal as the domain account, so root supervisors cannot be killed.
            kill_as_trustedpi(-1)
            pids = live_trustedpi_pids()
            empty = empty + 1 if not pids else 0
            if empty >= 2:
                return {'schemaVersion': 1, 'bindingEpoch': epoch, 'status': 'quiescent', 'remaining': 0}
            for pid in pids:
                kill_trustedpi(pid)
            if time.monotonic() >= deadline:
                raise RuntimeError('quiescence-unproven')
            time.sleep(0.02)


def drop_domain():
    account = pwd.getpwnam('trustedpi')
    os.setgroups([])
    os.setgid(account.pw_gid)
    os.setuid(PI_UID)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS: no setuid/file-capability escape.
        raise RuntimeError('privilege-drop-unproven')
    os.umask(0o077)


def spawn(epoch, argv):
    if len(argv) != 3 or argv[:2] != [NODE, HOST] or not re.fullmatch('[a-f0-9]{52}', argv[2]):
        raise RuntimeError('command-denied')
    child = None
    handle = None
    stopped = False

    def forward(signum, _frame):
        nonlocal stopped
        stopped = True
        if handle is not None:
            try:
                if hasattr(signal, 'pidfd_send_signal'):
                    signal.pidfd_send_signal(handle, signum)
                else:
                    linux_syscall(424, handle, signum, 0, 0)
            except ProcessLookupError:
                pass

    signal.signal(signal.SIGTERM, forward)
    signal.signal(signal.SIGINT, forward)
    try:
        with spawn_lock() as directory:
            state = read_state(directory)
            if not state or state['epoch'] != epoch or state['status'] != 'active' or state['spawnToken'] is not None or stopped:
                raise RuntimeError('spawn-denied')
            state['spawnToken'] = argv[2]
            write_state(directory, state)  # At-most-once even if fork/exec/ACK fails.
            ready_r, ready_w = os.pipe2(os.O_CLOEXEC)
            gate_r, gate_w = os.pipe2(os.O_CLOEXEC)
            child = os.fork()
            if child == 0:
                try:
                    signal.signal(signal.SIGTERM, signal.SIG_DFL)
                    signal.signal(signal.SIGINT, signal.SIG_DFL)
                    # Close inherited flock and all unrelated root descriptors.
                    for item in os.listdir('/proc/self/fd'):
                        fd = int(item)
                        if fd > 2 and fd not in {ready_w, gate_r}:
                            try:
                                os.close(fd)
                            except OSError:
                                pass
                    os.setsid()
                    drop_domain()
                    os.chdir('/var/lib/riffology/pi')
                    os.write(ready_w, b'R')
                    os.close(ready_w)
                    if os.read(gate_r, 1) != b'G':
                        os._exit(4)
                    os.close(gate_r)
                    os.execve(NODE, argv, {'LANG': 'C.UTF-8', 'PATH': '/usr/local/bin:/usr/bin:/bin',
                                          'HOME': '/var/lib/riffology/pi'})
                except BaseException:
                    os._exit(4)
            os.close(ready_w)
            os.close(gate_r)
            try:
                handle = pidfd_open(child)
                if not select.select([ready_r], [], [], 2)[0] or os.read(ready_r, 1) != b'R' or stopped:
                    raise RuntimeError('spawn-drop-unproven')
                # Child is already in the killable UID domain while admission lock is held.
                os.write(gate_w, b'G')
            finally:
                os.close(ready_r)
                os.close(gate_w)
        _, status = os.waitpid(child, 0)
        return os.waitstatus_to_exitcode(status)
    finally:
        if handle is not None:
            os.close(handle)



def prune(epoch, token):
    if not re.fullmatch('[a-f0-9]{52}', token):
        raise RuntimeError('prune-token-invalid')
    with spawn_lock() as directory:
        state = read_state(directory)
        if not state or state['epoch'] != epoch or state['status'] != 'sealed' or state['spawnToken'] != token:
            raise RuntimeError('prune-binding-denied')
        require_quiet()
        turns = os.open('/var/lib/riffology/turns', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(turns)
            if info.st_uid not in {0, PI_UID} or info.st_mode & 0o077:
                raise RuntimeError('prune-root-invalid')
            candidates = []
            for name in os.listdir(turns):
                matched = re.fullmatch(r'([a-f0-9]{52})\.(?:control\.json|input-session\.json|result\.json|output-session\.json)(?:\.tmp-[0-9]+)?', name)
                if not matched or matched[1] == token:
                    continue
                info = os.stat(name, dir_fd=turns, follow_symlinks=False)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid not in {0, PI_UID}:
                    raise RuntimeError('prune-file-invalid')
                candidates.append(name)
            for name in candidates:
                os.unlink(name, dir_fd=turns)
            os.fsync(turns)
            return {'schemaVersion': 1, 'bindingEpoch': epoch, 'status': 'pruned', 'removed': len(candidates)}
        finally:
            os.close(turns)

def main(args):
    if len(args) < 3 or args[1] != '--epoch' or not valid_epoch(args[2]):
        raise RuntimeError('command-invalid')
    command, epoch = args[0], args[2]
    if command == 'prune' and len(args) == 5 and args[3] == '--token':
        print(json.dumps(prune(epoch, args[4]), separators=(',', ':')), flush=True)
        return 0
    if command == 'spawn' and len(args) == 7 and args[3] == '--':
        result = spawn(epoch, args[4:])
        return result if result >= 0 else 128 - result
    if len(args) != 3 or command not in {'activate', 'seal'}:
        raise RuntimeError('command-invalid')
    print(json.dumps(activate(epoch) if command == 'activate' else seal(epoch), separators=(',', ':')), flush=True)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception:
        print('trusted-pi-supervisor-unproven', file=sys.stderr)
        sys.exit(4)
