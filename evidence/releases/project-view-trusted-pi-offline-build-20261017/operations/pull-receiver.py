#!/usr/bin/env python3
"""Fixed AMD128 pull receiver. Inert on import; credentials arrive only on stdin."""
import argparse
import base64
import datetime as dt
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import socket
import stat
import subprocess
import sys
import time

ACCOUNT = '8b0d70250211aa10d89e20605a1c7e5e'
REGISTRY = 'registry.cloudflare.com'
BASE = REGISTRY + '/' + ACCOUNT + '/riffology-issue165-trusted-pi@sha256:9b76ab9ee7a4f31d250957fbbeefc62d71056e6bd1eb24686ebbeaff3d65873c'
ROOT = Path('/tmp/riffoid-jhg46-image-20261017.AU613w/pi-resource-compat-v1')
DOCKER = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock']
SAFE_ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin'}
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
HEX = re.compile(r'^[a-f0-9]{64}$')
MAX_OUTPUT = 131072

class Stop(Exception):
    pass

def guard(value, code):
    if not value:
        raise Stop(code)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def write_new(path, value):
    raw = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(raw)
        out.flush()
        os.fsync(out.fileno())

def read_line(stream, seconds, limit=65536):
    # Read one byte at a time: never consume a later credential frame early.
    deadline = time.monotonic() + seconds
    data = bytearray()
    with selectors.DefaultSelector() as selector:
        selector.register(stream, selectors.EVENT_READ)
        while len(data) <= limit:
            left = deadline - time.monotonic()
            guard(left > 0 and selector.select(left), 'stdin-timeout')
            part = os.read(stream.fileno(), 1)
            guard(part, 'stdin-eof')
            if part == b'\n':
                return json.loads(data)
            data.extend(part)
    raise Stop('stdin-overflow')

def validate_credential(envelope, request_id):
    guard(isinstance(envelope, dict) and set(envelope) == {'schema', 'requestId', 'credential'}, 'credential-envelope')
    guard(envelope['schema'] == 'trusted-pi-pull-credential-envelope/v1' and envelope['requestId'] == request_id, 'credential-request')
    c = envelope['credential']
    guard(isinstance(c, dict) and set(c) == {'account_id', 'registry_host', 'username', 'password'}, 'credential-fields')
    guard(c['account_id'] == ACCOUNT and c['registry_host'] == REGISTRY, 'credential-target')
    for key in ('username', 'password'):
        guard(isinstance(c[key], str) and 0 < len(c[key]) <= 16384 and all(32 <= ord(x) <= 126 for x in c[key]), 'credential-value')
    guard(':' not in c['username'], 'credential-username')
    return c

def bounded_command(argv, seconds):
    """No shell; external stdout/stderr are hashed, never persisted or printed."""
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, env=SAFE_ENV, start_new_session=True)
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    totals = {'stdout': 0, 'stderr': 0}
    stopped = False
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
            selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
            end = time.monotonic() + seconds
            while selector.get_map():
                left = end - time.monotonic()
                guard(left > 0, 'command-timeout')
                for key, _ in selector.select(min(left, 1)):
                    block = os.read(key.fileobj.fileno(), 16384)
                    if not block:
                        selector.unregister(key.fileobj)
                        continue
                    name = key.data
                    totals[name] += len(block)
                    buffers[name].extend(block[:max(0, MAX_OUTPUT - len(buffers[name]))])
            guard(child.wait(timeout=max(0.1, end - time.monotonic())) == 0, 'command-nonzero')
    except BaseException:
        stopped = True
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
        raise
    finally:
        child.stdout.close()
        child.stderr.close()
    guard(not stopped and all(totals[k] == len(buffers[k]) for k in totals), 'command-output-discarded')
    return {k: bytes(v) for k, v in buffers.items()}, {
        k: {'bytes': totals[k], 'sha256': sha(v), 'discardedBytes': totals[k] - len(v)}
        for k, v in buffers.items()
    }

def pull_with_config(task, credential, run=bounded_command):
    config = task / 'docker-auth'
    config.mkdir(mode=0o700)
    path = config / 'config.json'
    try:
        auth = base64.b64encode((credential['username'] + ':' + credential['password']).encode()).decode()
        write_new(path, {'auths': {REGISTRY: {'auth': auth}}})
        guard(stat.S_IMODE(path.stat().st_mode) == 0o600, 'auth-config-mode')
        _, pull_output = run(DOCKER + ['--config', str(config), 'pull', '--platform', 'linux/amd64', BASE], 600)
        raw, inspect_output = run(DOCKER + ['--config', str(config), 'image', 'inspect', BASE,
                                  '--format', '{{json .}}'], 30)
        info = json.loads(raw['stdout'])
        guard(info.get('Os') == 'linux' and info.get('Architecture') == 'amd64'
              and BASE in info.get('RepoDigests', []), 'pulled-image-identity')
        # Engine image Id need not equal an OCI config or registry-manifest digest.
        return {'pullOutput': pull_output, 'inspectOutput': inspect_output,
                'image': {'id': info.get('Id'), 'repoDigest': BASE, 'os': 'linux', 'architecture': 'amd64'}}
    finally:
        if path.exists():
            path.unlink()
        if config.exists():
            config.rmdir()
        guard(not path.exists() and not config.exists(), 'auth-config-cleanup-unconfirmed')

def proc_start(pid):
    try:
        # The ')' before field3 may occur inside the comm name.
        return Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()[19]
    except FileNotFoundError:
        return None

def fixed_task(request_id):
    guard(UUID.fullmatch(request_id), 'request-id')
    return ROOT / ('pull-once-' + request_id)

def listener_addresses():
    # Actual Linux bind readback: sshd GatewayPorts may override an -R request.
    addresses = []
    for family, filename in ((4, '/proc/net/tcp'), (6, '/proc/net/tcp6')):
        for line in Path(filename).read_text().splitlines()[1:]:
            parts = line.split()
            guard(len(parts) >= 4, 'listener-table-format')
            address, port = parts[1].split(':')
            if int(port, 16) != 7897 or parts[3] != '0A':
                continue
            if family == 4:
                addresses.append(socket.inet_ntop(socket.AF_INET, bytes.fromhex(address)[::-1]))
            else:
                data = bytes.fromhex(address)
                addresses.append(socket.inet_ntop(socket.AF_INET6, b''.join(data[x:x+4][::-1] for x in range(0, 16, 4))))
    return sorted(addresses)

def readback(request_id, grant_sha, manifest_sha):
    task = fixed_task(request_id)
    intent = json.loads((task / 'intent.json').read_bytes())
    guard(intent['requestId'] == request_id and intent['grantSha256'] == grant_sha
          and intent['operationsManifestSha256'] == manifest_sha, 'original-intent-identity')
    original_gone = proc_start(intent['receiverPid']) != intent['receiverStartTicks']
    sock = socket.socket()
    sock.settimeout(2)
    try:
        code = sock.connect_ex(('127.0.0.1', 7897))
    finally:
        sock.close()
    terminal = json.loads((task / 'terminal.json').read_bytes()) if (task / 'terminal.json').exists() else None
    absent = not (task / 'docker-auth').exists()
    listeners = listener_addresses()
    return {'schema': 'trusted-pi-pull-cleanup-readback/v1', 'requestId': request_id,
            'grantSha256': grant_sha, 'operationsManifestSha256': manifest_sha,
            'originalReceiverAbsent': original_gone, 'authConfigAbsent': absent,
            'remote7897Absent': code == 111 and not listeners, 'remote7897ConnectErrno': code,
            'remote7897ListenerAddresses': listeners,
            'terminal': terminal,
            'cleanupConfirmed': original_gone and absent and code == 111 and not listeners and terminal is not None}

def verify_payload(scope):
    guard(ROOT.is_dir() and not ROOT.is_symlink() and ROOT.resolve() == ROOT, 'fixed-task-directory-required')
    guard(ROOT.stat().st_uid == os.getuid() and not ROOT.stat().st_mode & 0o022, 'task-directory-owner-mode')
    guard(scope['accountId'] == ACCOUNT and scope['baseImage'] == BASE and scope['remoteDirectory'] == str(ROOT), 'scope-target')
    guard(len(scope['payload']) == 9, 'payload-count')
    for item in scope['payload']:
        relative = Path(item['path'])
        guard(not relative.is_absolute() and '..' not in relative.parts, 'payload-path')
        path = ROOT / relative
        guard(path.resolve() == path and path.is_file() and not path.is_symlink(), 'payload-file')
        guard(path.stat().st_size == item['bytes'] and item['bytes'] <= 131072, 'payload-size')
        guard(sha(path.read_bytes()) == item['sha256'], 'payload-drift')

def execute(request_id, grant_sha, manifest_sha, scope_sha, ends_at):
    task = fixed_task(request_id)
    guard(HEX.fullmatch(grant_sha) and HEX.fullmatch(manifest_sha) and HEX.fullmatch(scope_sha), 'input-hashes')
    deadline = dt.datetime.fromisoformat(ends_at.replace('Z', '+00:00')).timestamp()
    guard(0 < deadline - time.time() <= 900, 'execution-window')
    scope = read_line(sys.stdin.buffer, 30)
    guard(sha((json.dumps(scope, sort_keys=True, separators=(',', ':')) + '\n').encode()) == scope_sha, 'scope-bytes')
    verify_payload(scope)
    task.mkdir(mode=0o700)  # Original UUID lock: existing directory is never removed/replayed.
    intent = {'schema': 'trusted-pi-pull-original-intent/v1', 'requestId': request_id,
              'grantSha256': grant_sha, 'operationsManifestSha256': manifest_sha,
              'receiverPid': os.getpid(), 'receiverStartTicks': proc_start(os.getpid()),
              'baseImage': BASE, 'startedAt': utc(), 'deadline': ends_at}
    write_new(task / 'intent.json', intent)
    terminal = {'schema': 'trusted-pi-pull-terminal/v1', 'requestId': request_id,
                'status': 'unknown-stopped', 'authConfigAbsent': False}
    def interrupt(*_):
        raise Stop('receiver-interrupted')
    for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT, signal.SIGALRM):
        signal.signal(sig, interrupt)
    signal.alarm(max(1, int(deadline - time.time())))
    try:
        guard(stat.S_ISSOCK(os.stat('/var/run/docker.sock').st_mode), 'fixed-daemon-socket')
        info, _ = bounded_command(DOCKER + ['info', '--format', '{{json .}}'], 15)
        info = json.loads(info['stdout'])
        guard(info.get('HttpProxy') == 'http://127.0.0.1:7897'
              and info.get('HttpsProxy') == 'http://127.0.0.1:7897', 'daemon-proxy-drift')
        bound = listener_addresses()
        guard(bound == ['127.0.0.1'], 'relay-must-actually-bind-loopback-only')
        terminal['routeBindAddressesBeforeCredential'] = bound
        print(json.dumps({'schema': 'trusted-pi-pull-receiver-ready/v1', 'requestId': request_id}), flush=True)
        credential = validate_credential(read_line(sys.stdin.buffer, min(60, deadline - time.time())), request_id)
        terminal.update(pull_with_config(task, credential))
        credential.clear()
        terminal['status'] = 'fixed-base-pull-verified'
    except BaseException as exc:
        terminal['errorCode'] = str(exc) if isinstance(exc, Stop) else 'receiver-local-error'
    finally:
        signal.alarm(0)
        terminal['endedAt'] = utc()
        terminal['authConfigAbsent'] = not (task / 'docker-auth').exists()
        if not terminal['authConfigAbsent']:
            terminal['status'] = 'unknown-stopped'
        write_new(task / 'terminal.json', terminal)
        print(json.dumps(terminal, sort_keys=True), flush=True)
    return 0 if terminal['status'] == 'fixed-base-pull-verified' else 1

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['execute', 'readback'])
    parser.add_argument('request_id')
    parser.add_argument('grant_sha')
    parser.add_argument('manifest_sha')
    parser.add_argument('--scope-sha')
    parser.add_argument('--ends-at')
    args = parser.parse_args()
    try:
        if args.mode == 'readback':
            guard(HEX.fullmatch(args.grant_sha) and HEX.fullmatch(args.manifest_sha), 'input-hashes')
            print(json.dumps(readback(args.request_id, args.grant_sha, args.manifest_sha), sort_keys=True))
            return 0
        return execute(args.request_id, args.grant_sha, args.manifest_sha, args.scope_sha, args.ends_at)
    except BaseException as exc:
        print(json.dumps({'status': 'unknown-stopped', 'errorCode': str(exc) if isinstance(exc, Stop) else 'receiver-local-error'}))
        return 1

if __name__ == '__main__':
    sys.exit(main())
