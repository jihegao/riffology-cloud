"""One owned Node session. Definition only; never run in this preparation."""
import hashlib
import json
import os
from pathlib import Path
import resource
import selectors
import signal
import stat
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
STATE_ROOT = ROOT / '.state'
NODE = '/opt/homebrew/bin/node'
REQUEST = '560ada22-f507-48b9-b926-8df6d6b90ceb'


def stopped(code, mode, **extra):
    return {'schema': 'riffoid-ir.bounded-owner-stopped/v1', 'code': code,
            'automaticRetry': False, 'originalIdentityMustBeReconciled': mode == '--execute',
            'credentialsOrRawChildOutputLogged': False, **extra}


def read_owned(path, maximum):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as source:
        a = os.fstat(source.fileno())
        if not (stat.S_ISREG(a.st_mode) and a.st_uid == os.getuid()
                and a.st_nlink == 1 and 0 < a.st_size <= maximum):
            raise ValueError('bounded-owned-startup-source')
        raw = source.read(maximum + 1)
        b = os.fstat(source.fileno())
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if len(raw) != a.st_size or identity(a) != identity(b):
            raise ValueError('startup-source-changed')
        return raw


def persist_original(child, mode, deadline_ms):
    if os.getpgid(child.pid) != child.pid:
        raise ValueError('original-node-session-identity')
    entry = ROOT / 'owner-caller.mjs'
    raw = read_owned(entry, 65536)
    gate = ROOT / 'node-startup-gate.mjs'
    gate_raw = read_owned(gate, 65536)
    document = {'schema': 'riffoid-ir.original-node-pid/v1', 'requestId': REQUEST,
        'mode': mode, 'pid': child.pid, 'pgid': child.pid, 'uid': os.getuid(),
        'launcherPid': os.getpid(), 'createdAtUnixMs': int(time.time() * 1000),
        'hardDeadlineUnixMs': deadline_ms, 'node': NODE,
        'startupGate': {'file': str(gate), 'bytes': len(gate_raw),
                        'sha256': hashlib.sha256(gate_raw).hexdigest()},
        'entry': {'file': str(entry), 'bytes': len(raw),
                  'sha256': hashlib.sha256(raw).hexdigest()},
        'startupReleased': False, 'credentialBodyLogged': False,
        'manualFallbackScope': 'only-this-original-node-process-group-no-replay'}
    body = (json.dumps(document, sort_keys=True, separators=(',', ':')) + '\n').encode('ascii')
    STATE_ROOT.mkdir(mode=0o700, exist_ok=True)
    path = STATE_ROOT / ('owner-original-node-' + mode[2:] + '-' + str(child.pid) + '.safe.json')
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as target:
        os.fchmod(target.fileno(), 0o600)
        target.write(body)
        target.flush()
        os.fsync(target.fileno())
    parent = os.open(str(STATE_ROOT), os.O_RDONLY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)
    return {'file': str(path), 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}


def close_original_group(child):
    """Always called after Popen, including EOF/exception/HUP and normal exit.
    PID/PG came only from this Popen(start_new_session=True), never a PID file.
    The original group may outlive an exited leader; still close that same PG.
    """
    signals = []
    def send(name):
        try:
            os.killpg(child.pid, name)
            signals.append(signal.Signals(name).name)
        except ProcessLookupError:
            pass
        except OSError:
            return False
        return True
    ok, reaped = send(signal.SIGTERM), False
    try:
        try:
            child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass
        except BaseException:
            ok = False
    finally:
        # Leader exit / pipe EOF never proves descendant group termination.
        ok = send(signal.SIGKILL) and ok
        try:
            child.wait(timeout=2)
            reaped = True
        except BaseException:
            reaped = False
        finally:
            for stream in (child.stdin, child.stdout, child.stderr):
                try:
                    if stream is not None:
                        stream.close()
                except BaseException:
                    ok = False
    return {'childCloseObserved': reaped, 'groupSignals': signals,
            'cleanupSignalsAccepted': ok, 'originalPid': child.pid, 'originalPgid': child.pid}


def safe_child_result(buffers, returncode):
    document = json.loads(bytes(buffers['stdout'] if returncode == 0 else buffers['stderr']))
    permitted = {
        'riffoid-ir.owner-wiring-status/v1': {'schema','executionEnabled','factsBound',
            'receiptStreamBound','credentialMode','physicalEvaluatorBound',
            'credentialProviderInvoked','nativeConnectionConstructed','networkRequests','cloudWrites'},
        'riffoid-ir.owner-bootstrap-result/v1': {'schema','status','reference','cloudWrites','RegistryMints'},
        'riffoid-ir-original-publication-result/v1': {'schema','requestId','status','actualMain',
            'source','finalProjectionCanonicalSha256','authenticatedUserAcceptance',
            'maintenanceEndPerformed','providerModelOrToolExecutionPerformed'},
        'riffoid-ir.owner-caller-stopped/v1': {'schema','code','automaticRetry',
            'credentialsOrRawBodyLogged'}}
    if not isinstance(document, dict) or document.get('schema') not in permitted:
        raise ValueError('unexpected-child-schema')
    if set(document) != permitted[document['schema']]:
        raise ValueError('unexpected-child-fields')
    return document


def main():
    mode = sys.argv[1] if len(sys.argv) == 2 else '--inspect'
    if len(sys.argv) > 2 or mode not in ('--inspect', '--execute'):
        print(json.dumps(stopped('fixed-launcher-arguments', mode)))
        return 1
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    canceled = [None]
    for name in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(name, lambda number, _: canceled.__setitem__(0, signal.Signals(number).name))
    maximum = 10 if mode == '--inspect' else 900
    deadline = time.monotonic() + maximum
    deadline_ms = int((time.time() + maximum) * 1000)
    child, selector, reference = None, None, None
    result, returncode = stopped('owner-launcher-not-started', mode), 1
    cleanup = None
    try:
        if canceled[0]:
            raise InterruptedError()
        # One Node process; the gate imports the reviewed entry in this SAME PID.
        # Its private stdin carries nonsecret startup metadata only. The existing
        # credential helper's FD3/FD4 protocol is unchanged.
        child = subprocess.Popen([NODE, '--unhandled-rejections=strict',
            str(ROOT / 'node-startup-gate.mjs'), mode], cwd=str(ROOT),
            env={'PATH': '/usr/bin:/bin:/opt/homebrew/bin', 'LC_ALL': 'C'},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True)
        reference = persist_original(child, mode, deadline_ms)
        # Durable PID and its original PG are visible even if this launcher is
        # later SIGKILLed. Highest-caller SIGKILL is root's manual fallback, not
        # a claim of a recursively indestructible supervisor.
        print(json.dumps({'schema': 'riffoid-ir.original-node-startup/v1',
            'requestId': REQUEST, 'mode': mode, 'originalPid': child.pid,
            'originalPgid': child.pid, 'reference': reference,
            'pidRecordFsyncedBeforeEntryImport': True}), flush=True)
        if canceled[0] or time.monotonic() >= deadline:
            raise InterruptedError()
        frame = {'schema': 'riffoid-ir.original-node-startup-release/v1',
                 'requestId': REQUEST, 'pid': child.pid, 'pgid': child.pid,
                 'launcherPid': os.getpid(), 'mode': mode, 'record': reference}
        child.stdin.write(json.dumps(frame, separators=(',', ':')).encode('ascii'))
        child.stdin.close()  # EOF completes the bounded private startup frame.
        selector = selectors.DefaultSelector()
        buffers = {'stdout': bytearray(), 'stderr': bytearray()}
        for name, pipe in (('stdout', child.stdout), ('stderr', child.stderr)):
            selector.register(pipe, selectors.EVENT_READ, name)
        while True:
            if canceled[0] or time.monotonic() >= deadline:
                raise InterruptedError()
            code = child.poll()
            if code is not None and not selector.get_map():
                break
            # Pipe EOF is NOT process exit. With no open pipes, still wait for
            # the real child exit until the unchanged original hard deadline.
            if not selector.get_map():
                time.sleep(min(0.05, max(0, deadline - time.monotonic())))
                continue
            for key, _ in selector.select(min(0.1, max(0, deadline - time.monotonic()))):
                chunk = os.read(key.fileobj.fileno(), 4096)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                buffers[key.data].extend(chunk)
                if len(buffers[key.data]) > 65536:
                    raise OverflowError()
        result = safe_child_result(buffers, child.returncode)
        returncode = 0 if child.returncode == 0 else 1
    except InterruptedError:
        result = stopped('owner-canceled' if canceled[0] else 'owner-hard-deadline', mode,
                         cancelSignal=canceled[0])
    except OverflowError:
        result = stopped('owner-child-output-limit', mode)
    except BaseException:
        # Raw exception/child output is never forwarded; every post-Popen path
        # passes through the same original-PG cleanup and reap below.
        result = stopped('fixed-owner-launcher-stopped', mode)
    finally:
        if selector is not None:
            try:
                selector.close()
            except BaseException:
                pass  # Closing selector cannot skip original-PG cleanup.
        if child is not None:
            cleanup = close_original_group(child)
    if cleanup and (not cleanup['childCloseObserved'] or not cleanup['cleanupSignalsAccepted']):
        result, returncode = stopped('original-node-close-unconfirmed', mode,
            **cleanup, pidReference=reference), 1
    if canceled[0]:
        result, returncode = stopped('owner-canceled', mode, cancelSignal=canceled[0]), 1
    print(json.dumps(result))
    return 0 if returncode == 0 and not canceled[0] else 1


if __name__ == '__main__':
    raise SystemExit(main())
