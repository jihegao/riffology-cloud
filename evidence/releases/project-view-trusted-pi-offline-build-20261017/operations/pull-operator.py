#!/usr/bin/env python3
"""One approved OAuth->Registry credential->SSH stdin path. Import is inert."""
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shlex
import signal
import stat
import subprocess
import sys
import time
import urllib.request

HERE = Path(__file__).resolve().parent
ACCOUNT = '8b0d70250211aa10d89e20605a1c7e5e'
REGISTRY = 'registry.cloudflare.com'
BASE = REGISTRY + '/' + ACCOUNT + '/riffology-issue165-trusted-pi@sha256:9b76ab9ee7a4f31d250957fbbeefc62d71056e6bd1eb24686ebbeaff3d65873c'
ARCHIVE_SHA = 'c92e672ca39d10d61467801f457147e3ee9cf2cfbbbe8b96d00a618a6a208bae'
ARCHIVE_BYTES = 30515
PROXY = 'http://127.0.0.1:7892'
CREDENTIAL_URL = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + '/containers/registries/' + REGISTRY + '/credentials'
REMOTE_ROOT = '/tmp/riffoid-jhg46-image-20261017.AU613w/pi-resource-compat-v1'
OAUTH_SCOPES = {'user:read', 'offline_access', 'account:read', 'workers:write', 'workers_scripts:write'}
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
HEX = re.compile(r'^[a-f0-9]{64}$')
SHA40 = re.compile(r'^[a-f0-9]{40}$')
SAFE_ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin'}
SCHEMA = 'trusted-pi-offline-route-pull-grant/v1'
OPERATIONS = ['temporary-ssh-reverse-forward', 'local-oauth-one-pull-credential-post',
              'stdin-pull-credential-transfer', 'single-fixed-base-pull', 'original-identity-readback-cleanup']

class Stop(Exception):
    pass

def guard(value, code):
    if not value:
        raise Stop(code)

def sha(value):
    return hashlib.sha256(value).hexdigest()

def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def bounded_file(path, limit, private=False):
    path = Path(path)
    guard(not path.is_symlink() and path.is_file(), 'input-regular-file-required')
    st = path.stat()
    guard(st.st_size <= limit, 'input-size')
    if private:
        guard(st.st_uid == os.getuid() and not st.st_mode & 0o077, 'private-input-owner-mode')
    return path.read_bytes()

def write_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(json.dumps(value, sort_keys=True, indent=2).encode() + b'\n')
        out.flush()
        os.fsync(out.fileno())

def validate_grant(grant, grant_sha, manifest_sha, now=None, cleanup=False):
    now = time.time() if now is None else now
    guard(HEX.fullmatch(grant_sha or '') and HEX.fullmatch(manifest_sha or ''), 'explicit-root-reviewed-hashes-required')
    guard(grant.get('schema') == SCHEMA and grant.get('authority') == 'direct-human-instruction-recorded-by-root'
          and grant.get('rootReviewCompleted') is True and bool(grant.get('humanInstruction')), 'new-human-grant-required')
    guard(grant.get('accountId') == ACCOUNT and grant.get('registryHost') == REGISTRY and grant.get('baseImage') == BASE
          and grant.get('recipient') == 'AMD128' and grant.get('remoteDirectory') == REMOTE_ROOT, 'grant-target')
    guard(grant.get('archiveSha256') == ARCHIVE_SHA and grant.get('archiveBytes') == ARCHIVE_BYTES
          and grant.get('operationsManifestSha256') == manifest_sha and SHA40.fullmatch(grant.get('packetCommit', '')), 'grant-frozen-inputs')
    guard(UUID.fullmatch(grant.get('requestId', '')), 'grant-request-id')
    guard(grant.get('operations') == OPERATIONS and grant.get('credential') == {'expiration_minutes': 15, 'permissions': ['pull']}
          and grant.get('route') == {'remoteBind': '127.0.0.1:7897', 'localDestination': '127.0.0.1:7892'}, 'grant-exact-operations')
    guard(grant.get('allowRegistryPush') is False and grant.get('allowCloudAppUpdate') is False
          and grant.get('allowRealProviderTurnRun') is False and grant.get('allowNewSubscription') is False
          and grant.get('allowOAuthTransfer') is False and grant.get('allowAutomaticRefreshLoginOrNewScopes') is False, 'grant-exclusions')
    start = dt.datetime.fromisoformat(grant['startsAt'].replace('Z', '+00:00')).timestamp()
    end = dt.datetime.fromisoformat(grant['endsAt'].replace('Z', '+00:00')).timestamp()
    guard(0 < end - start <= 900 and now >= start and (cleanup or now < end), 'grant-window')
    return grant

def load_inputs(grant_path, grant_sha, manifest_sha, archive_path, cleanup=False):
    # Every target/source/grant guard precedes OAuth read, network and SSH creation.
    raw = bounded_file(grant_path, 32768, private=True)
    guard(sha(raw) == grant_sha, 'grant-file-drift')
    grant = validate_grant(json.loads(raw), grant_sha, manifest_sha, cleanup=cleanup)
    mb = bounded_file(HERE / 'operations-manifest.json', 32768)
    guard(sha(mb) == manifest_sha, 'operations-manifest-drift')
    manifest = json.loads(mb)
    guard(manifest.get('schema') == 'trusted-pi-route-pull-operations-manifest/v1', 'manifest-schema')
    required = {'pull-operator.py', 'pull-receiver.py', 'scope.json', 'test_operations.py', 'EXECUTION.md'}
    guard(set(manifest['files']) == required, 'manifest-file-set')
    for name, item in manifest['files'].items():
        b = bounded_file(HERE / name, 131072)
        guard(len(b) == item['bytes'] and sha(b) == item['sha256'], 'operation-source-drift')
    scope_raw = bounded_file(HERE / 'scope.json', 32768)
    scope = json.loads(scope_raw)
    guard(scope_raw == canonical(scope), 'canonical-scope-required')
    guard(scope.get('accountId') == ACCOUNT and scope.get('baseImage') == BASE and scope.get('remoteDirectory') == REMOTE_ROOT
          and scope.get('archiveSha256') == ARCHIVE_SHA and scope.get('archiveBytes') == ARCHIVE_BYTES, 'scope-target')
    archive = bounded_file(archive_path, ARCHIVE_BYTES)
    guard(len(archive) == ARCHIVE_BYTES and sha(archive) == ARCHIVE_SHA, 'archive-drift')
    repo = HERE.parents[3]
    for name in required | {'operations-manifest.json'}:
        relative = (HERE / name).relative_to(repo).as_posix()
        try:
            committed = subprocess.check_output(['/usr/bin/git', 'show', grant['packetCommit'] + ':' + relative],
                                                cwd=repo, stderr=subprocess.DEVNULL, timeout=10)
        except Exception:
            raise Stop('reviewed-packet-commit-required') from None
        guard(committed == (HERE / name).read_bytes(), 'packet-commit-source-drift')
    return grant, manifest, scope, scope_raw

def read_oauth():
    # Never called by import/tests/prepare; no refresh, login, credential fallback.
    path = Path.home() / '.wrangler/config/default.toml'
    raw = bounded_file(path, 32768, private=True)
    text = raw.decode()
    def quoted(key):
        match = re.search(r'^' + key + r'\s*=\s*"([^"\r\n]+)"\s*$', text, re.M)
        guard(match is not None, 'credential-preflight-format')
        return match.group(1)
    scopes = re.search(r'^scopes\s*=\s*(\[[^\]]*\])', text, re.M)
    guard(scopes is not None, 'credential-preflight-format')
    parsed_scopes = json.loads(re.sub(r',\s*\]', ']', scopes.group(1)))
    guard(isinstance(parsed_scopes, list) and len(parsed_scopes) == 5 and set(parsed_scopes) == OAUTH_SCOPES, 'oauth-existing-five-scopes-required')
    token = quoted('oauth_token')
    guard(isinstance(token, str) and 0 < len(token) <= 16384 and '\r' not in token and '\n' not in token, 'credential-preflight')
    expiry = dt.datetime.fromisoformat(quoted('expiration_time').replace('Z', '+00:00')).timestamp()
    guard(expiry > time.time() + 120, 'credential-preflight-expired-stop-no-refresh')
    return token

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        raise Stop('credential-api-redirect-rejected')

def create_pull_credential(oauth):
    body = canonical({'expiration_minutes': 15, 'permissions': ['pull']})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({'https': PROXY}), NoRedirect())
    request = urllib.request.Request(CREDENTIAL_URL, data=body, method='POST', headers={
        'Authorization': 'Bearer ' + oauth, 'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with opener.open(request, timeout=30) as response:
            guard(response.status == 201, 'credential-api-status')
            raw = response.read(65537)
            guard(len(raw) <= 65536, 'credential-api-size')
    except Stop:
        raise
    except Exception:
        raise Stop('credential-api-unknown-stop-no-retry') from None
    try:
        parsed = json.loads(raw)
        guard(parsed.get('success') is True, 'credential-api-not-success')
        credential = parsed['result']
        guard(isinstance(credential, dict) and set(credential) == {'account_id', 'registry_host', 'username', 'password'}, 'credential-result-fields')
        guard(credential['account_id'] == ACCOUNT and credential['registry_host'] == REGISTRY, 'credential-result-target')
        for key in ('username', 'password'):
            guard(isinstance(credential[key], str) and 0 < len(credential[key]) <= 16384
                  and all(32 <= ord(x) <= 126 for x in credential[key]), 'credential-result-value')
        guard(':' not in credential['username'], 'credential-result-username')
        return credential
    except Stop:
        raise
    except Exception:
        raise Stop('credential-api-invalid-response') from None

def ssh_argv(receiver, args, forward):
    # This argv contains public source + original identity only, never credentials.
    encoded = base64.b64encode(receiver).decode()
    bootstrap = 'import base64;exec(compile(base64.b64decode(' + repr(encoded) + '),"<reviewed-pull-receiver>","exec"))'
    remote = '/usr/bin/python3 -c ' + shlex.quote(bootstrap) + ' ' + ' '.join(shlex.quote(x) for x in args)
    options = ['/usr/bin/ssh', '-T', '-oBatchMode=yes', '-oConnectTimeout=10', '-oExitOnForwardFailure=yes',
               '-oServerAliveInterval=5', '-oServerAliveCountMax=2', '-oControlMaster=no', '-oControlPath=none',
               '-oControlPersist=no', '-oForwardAgent=no', '-oForwardX11=no', '-oPermitLocalCommand=no']
    if forward:
        options += ['-R', '127.0.0.1:7897:127.0.0.1:7892']
    return options + ['AMD128', remote]

def read_json_line(proc, timeout, limit=32768):
    buf = bytearray()
    end = time.monotonic() + timeout
    with selectors.DefaultSelector() as selector:
        selector.register(proc.stdout, selectors.EVENT_READ)
        while len(buf) <= limit:
            left = end - time.monotonic()
            guard(left > 0 and selector.select(left), 'ssh-response-timeout')
            ch = os.read(proc.stdout.fileno(), 1)
            guard(ch, 'ssh-response-eof')
            if ch == b'\n':
                return json.loads(buf)
            buf.extend(ch)
    raise Stop('ssh-response-overflow')

def start_ssh(argv):
    # stderr discarded: no uncontrolled transport error body is logged.
    return subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, env=SAFE_ENV, start_new_session=True)

def stop_owned(proc):
    # A broken pipe or process-exit race must not skip original-ID readback.
    try:
        if proc.stdin and not proc.stdin.closed:
            proc.stdin.close()
    except BaseException:
        pass
    for sig, wait in ((None, 15), (signal.SIGTERM, 10), (signal.SIGKILL, 5)):
        try:
            if proc.poll() is not None:
                return True
            if sig is not None:
                try:
                    os.killpg(proc.pid, sig)
                except ProcessLookupError:
                    pass
            proc.wait(timeout=wait)
            return proc.poll() is not None
        except subprocess.TimeoutExpired:
            continue
        except BaseException:
            continue
    try:
        return proc.poll() is not None
    except BaseException:
        return False

def read_cleanup(receiver, request_id, grant_sha, manifest_sha):
    proc = start_ssh(ssh_argv(receiver, ['readback', request_id, grant_sha, manifest_sha], False))
    try:
        result = read_json_line(proc, 30)
        guard(proc.wait(timeout=10) == 0 and result.get('schema') == 'trusted-pi-pull-cleanup-readback/v1'
              and result.get('requestId') == request_id and result.get('grantSha256') == grant_sha
              and result.get('operationsManifestSha256') == manifest_sha, 'original-cleanup-readback')
        return result
    finally:
        stop_owned(proc)

def execute(grant, manifest, scope_raw, grant_sha, manifest_sha, state_root):
    # Local exclusive lock exists before any credential/network path. Never deleted.
    request_id = grant['requestId']
    state_root = Path(state_root)
    state_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    guard(not state_root.is_symlink() and state_root.stat().st_uid == os.getuid()
          and not state_root.stat().st_mode & 0o077, 'private-state-directory')
    attempt = state_root / request_id
    attempt.mkdir(mode=0o700)
    write_new(attempt / 'intent.json', {'schema': 'trusted-pi-pull-local-intent/v1', 'requestId': request_id,
                                      'grantSha256': grant_sha, 'operationsManifestSha256': manifest_sha,
                                      'startedAt': utc(), 'credentialPosts': 'at-most-one', 'baseImage': BASE})
    receiver = bounded_file(HERE / 'pull-receiver.py', 131072)
    proc = None
    result = {'schema': 'trusted-pi-pull-local-result/v1', 'requestId': request_id,
              'status': 'unknown-stopped', 'credentialPostAttempted': False,
              'grantSha256': grant_sha, 'operationsManifestSha256': manifest_sha}
    try:
        # Reject extra configured forwarding; no inherited agent/X11/control master.
        effective = subprocess.check_output(['/usr/bin/ssh', '-G', 'AMD128'], stderr=subprocess.DEVNULL, env=SAFE_ENV, timeout=10).decode()
        guard(not any(line.split(' ', 1)[0] in {'remoteforward', 'localforward', 'dynamicforward'} for line in effective.splitlines()), 'unexpected-configured-ssh-forwarding')
        args = ['execute', request_id, grant_sha, manifest_sha, '--scope-sha', sha(scope_raw), '--ends-at', grant['endsAt']]
        proc = start_ssh(ssh_argv(receiver, args, True))
        write_new(attempt / 'owned-ssh.json', {'requestId': request_id, 'pid': proc.pid, 'startedAt': utc()})
        proc.stdin.write(scope_raw)
        proc.stdin.flush()
        ready = read_json_line(proc, 30)
        guard(ready == {'schema': 'trusted-pi-pull-receiver-ready/v1', 'requestId': request_id}, 'receiver-ready-identity')
        validate_grant(grant, grant_sha, manifest_sha)
        oauth = read_oauth()
        write_new(attempt / 'credential-post-intent.json', {'requestId': request_id, 'at': utc(),
                  'endpoint': CREDENTIAL_URL, 'body': {'expiration_minutes': 15, 'permissions': ['pull']}})
        result['credentialPostAttempted'] = True
        credential = create_pull_credential(oauth)
        oauth = None
        envelope = {'schema': 'trusted-pi-pull-credential-envelope/v1', 'requestId': request_id, 'credential': credential}
        proc.stdin.write(canonical(envelope))
        proc.stdin.flush()
        credential.clear()
        envelope.clear()
        proc.stdin.close()
        terminal = read_json_line(proc, 650)
        guard(terminal.get('schema') == 'trusted-pi-pull-terminal/v1' and terminal.get('requestId') == request_id, 'receiver-terminal-identity')
        write_new(attempt / 'receiver-terminal.json', terminal)
        guard(proc.wait(timeout=15) == 0 and terminal.get('status') == 'fixed-base-pull-verified'
              and terminal.get('authConfigAbsent') is True, 'receiver-terminal-failure')
        result['status'] = 'pull-verified-cleanup-pending'
    except BaseException as exc:
        result['errorCode'] = str(exc) if isinstance(exc, Stop) else 'operator-local-error'
    finally:
        try:
            result['ownedSshTerminated'] = stop_owned(proc) if proc else True
        except BaseException:
            result['ownedSshTerminated'] = False
        try:
            cleanup = read_cleanup(receiver, request_id, grant_sha, manifest_sha)
            write_new(attempt / 'cleanup-readback.json', cleanup)
            result['cleanupConfirmed'] = cleanup.get('cleanupConfirmed') is True
            if result['status'] == 'pull-verified-cleanup-pending' and result['cleanupConfirmed'] and result['ownedSshTerminated']:
                result['status'] = 'fixed-base-pull-and-owned-route-cleanup-verified'
        except BaseException:
            result['cleanupConfirmed'] = False
            result['cleanupReadback'] = 'unknown-stopped-original-identity-only'
        result['endedAt'] = utc()
        write_new(attempt / 'result.json', result)
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--readback-only', action='store_true')
    parser.add_argument('--grant', required=True)
    parser.add_argument('--grant-sha256', required=True)
    parser.add_argument('--operations-sha256', required=True)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--state-root', required=True)
    args = parser.parse_args()
    try:
        guard(args.execute != args.readback_only, 'explicit-execute-or-original-readback-required')
        grant, manifest, _, scope_raw = load_inputs(args.grant, args.grant_sha256, args.operations_sha256,
                                                   args.archive, cleanup=args.readback_only)
        if args.readback_only:
            # Never mint another credential or start another forwarding receiver.
            original = Path(args.state_root) / grant['requestId'] / 'intent.json'
            intent = json.loads(bounded_file(original, 32768, private=True))
            guard(intent['grantSha256'] == args.grant_sha256 and intent['operationsManifestSha256'] == args.operations_sha256,
                  'original-local-intent-required')
            result = read_cleanup(bounded_file(HERE / 'pull-receiver.py', 131072), grant['requestId'], args.grant_sha256, args.operations_sha256)
        else:
            result = execute(grant, manifest, scope_raw, args.grant_sha256, args.operations_sha256, args.state_root)
        print(json.dumps(result, sort_keys=True))
        return 0 if result.get('status') == 'fixed-base-pull-and-owned-route-cleanup-verified' or (args.readback_only and result.get('cleanupConfirmed')) else 1
    except BaseException as exc:
        print(json.dumps({'status': 'stopped', 'errorCode': str(exc) if isinstance(exc, Stop) else 'operator-local-error'}))
        return 1

if __name__ == '__main__':
    sys.exit(main())
