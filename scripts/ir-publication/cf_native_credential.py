"""Disabled unless an already validated owner sends the fixed FD3 request.
No import-time auth, network, CLI token or environment credential input.
Only identity GETs; no mint, refresh, Registry or publication method exists.
"""
import datetime
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import resource
import ssl
import stat
import time

ACCOUNT = '8b0d70250211aa10d89e20605a1c7e5e'
WORKER = 'riffology-m1-gateway-staging'
REQUEST = '560ada22-f507-48b9-b926-8df6d6b90ceb'
USER_SHA = 'c8d5e2a134d99693a4585510f761b811d67b3e36c413eb3c9d34d060cccc986d'
SCOPES = ['account:read', 'containers:write', 'offline_access', 'user:read',
          'workers:write', 'workers_scripts:write']
AUTH_FILES = (Path('/Users/jihegao/.wrangler/config/default.toml'),
              Path('/Users/jihegao/Library/Preferences/.wrangler/config/default.toml'))
SOURCE_MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'source-manifest.json')
HEX = re.compile(r'^[a-f0-9]{64}$')
COMMIT = re.compile(r'^[a-f0-9]{40}$')
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')

class Guard(Exception):
    pass


def need(ok, code):
    if not ok:
        raise Guard(code)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def parse(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            need(key not in result, 'duplicate-json-key')
            result[key] = value
        return result
    def nonfinite(_):
        raise Guard('nonfinite-json')
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=nonfinite)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise Guard('invalid-json') from None

def fixed_read(path, maximum=1048576):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as source:
        a = os.fstat(source.fileno())
        need(stat.S_ISREG(a.st_mode) and a.st_uid == os.getuid() and a.st_nlink == 1
             and 0 < a.st_size <= maximum, 'owned-bounded-regular-input')
        raw = source.read(maximum + 1)
        b = os.fstat(source.fileno())
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(len(raw) == a.st_size and identity(a) == identity(b), 'input-changed')
        return raw

def parse_existing_auth(raw):
    need(len(raw) <= 65536, 'bounded-existing-auth-config')
    try:
        text = raw.decode('utf8')
    except UnicodeError:
        raise Guard('existing-auth-config-encoding') from None
    # Narrow Wrangler root grammar, consumed completely. Python 3.9 has no
    # tomllib; no profile/table, dotted key or unparsed suffix is accepted.
    allowed = {'oauth_token', 'refresh_token', 'expiration_time', 'scopes'}
    fields, at = {}, 0

    def horizontal():
        nonlocal at
        while at < len(text) and text[at] in ' \t':
            at += 1

    def comment():
        nonlocal at
        if at < len(text) and text[at] == '#':
            while at < len(text) and text[at] not in '\r\n':
                need(text[at] == '\t' or ord(text[at]) >= 32 and ord(text[at]) != 127,
                     'invalid-root-auth-comment')
                at += 1

    def line_end():
        nonlocal at
        if at == len(text):
            return
        if text.startswith('\r\n', at):
            at += 2
        elif text[at] == '\n':
            at += 1
        else:
            raise Guard('unparsed-root-auth-content')

    def quoted_string():
        nonlocal at
        need(at < len(text) and text[at] == '"', 'root-auth-string-required')
        at += 1
        result = []
        escapes = {'b': '\b', 't': '\t', 'n': '\n', 'f': '\f',
                   'r': '\r', '"': '"', '\\': '\\'}
        while at < len(text):
            char = text[at]
            at += 1
            if char == '"':
                return ''.join(result)
            if char == '\\':
                need(at < len(text), 'incomplete-root-auth-escape')
                escaped = text[at]
                at += 1
                if escaped in escapes:
                    result.append(escapes[escaped])
                else:
                    need(escaped in ('u', 'U'), 'invalid-root-auth-escape')
                    count = 4 if escaped == 'u' else 8
                    digits = text[at:at + count]
                    need(len(digits) == count and re.fullmatch(r'[0-9A-Fa-f]+', digits),
                         'invalid-root-auth-unicode')
                    scalar = int(digits, 16)
                    need(scalar <= 0x10ffff and not 0xd800 <= scalar <= 0xdfff,
                         'invalid-root-auth-unicode')
                    result.append(chr(scalar))
                    at += count
            else:
                need(char == '\t' or ord(char) >= 32 and ord(char) != 127,
                     'invalid-root-auth-string')
                result.append(char)
        raise Guard('unterminated-root-auth-string')

    def array_gap():
        nonlocal at
        while True:
            horizontal()
            comment()
            if at < len(text) and text[at] in '\r\n':
                line_end()
            else:
                return

    def scope_array():
        nonlocal at
        need(at < len(text) and text[at] == '[', 'root-auth-scope-array-required')
        at += 1
        result = []
        array_gap()
        while at < len(text) and text[at] != ']':
            result.append(quoted_string())
            array_gap()
            need(at < len(text) and text[at] in ',]', 'invalid-root-auth-scope-array')
            if text[at] == ']':
                break
            at += 1
            array_gap()
        need(at < len(text) and text[at] == ']', 'unterminated-root-auth-scope-array')
        at += 1
        return result

    while at < len(text):
        horizontal()
        comment()
        if at == len(text):
            break
        if text[at] in '\r\n':
            line_end()
            continue
        need(text[at] != '[', 'root-auth-tables-forbidden')
        match = re.match(r'[A-Za-z_][A-Za-z0-9_]*', text[at:])
        need(match is not None, 'root-auth-key-required')
        key = match.group(0)
        at += len(key)
        need(key in allowed, 'unknown-root-auth-field')
        need(key not in fields, 'duplicate-root-auth-field')
        horizontal()
        need(at < len(text) and text[at] == '=', 'root-auth-assignment-required')
        at += 1
        horizontal()
        fields[key] = scope_array() if key == 'scopes' else quoted_string()
        horizontal()
        comment()
        line_end()
    need({'oauth_token', 'expiration_time', 'scopes'} <= fields.keys(),
         'existing-auth-field-required')
    # refresh_token is syntax-checked above but never used or returned.
    token, expiration, scopes = (fields[key] for key in ('oauth_token', 'expiration_time', 'scopes'))
    need(isinstance(scopes, list) and len(scopes) == 6 and sorted(scopes) == sorted(SCOPES),
         'exact-existing-six-oauth-scopes')
    try:
        expires = datetime.datetime.fromisoformat(expiration.replace('Z', '+00:00'))
        need(expires.tzinfo is not None and expires.timestamp() > time.time() + 120,
             'existing-oauth-expired-no-refresh')
    except (ValueError, OverflowError):
        raise Guard('existing-oauth-expiration') from None
    need(20 < len(token) <= 16384
         and all(33 <= ord(char) <= 126 for char in token), 'bounded-existing-oauth-token')
    return token, expires.timestamp(), list(scopes)

def load_existing_token():
    for path in AUTH_FILES:
        try:
            raw = fixed_read(path, 65536)
        except FileNotFoundError:
            continue  # Same two original locations; not an alternate profile.
        return parse_existing_auth(raw)  # A present invalid first file never falls back.
    raise Guard('existing-wrangler-oauth-unavailable')


def canonical_sha(value):
    return sha(json.dumps(value, sort_keys=True, separators=(',', ':'),
                          ensure_ascii=False, allow_nan=False).encode('utf8'))


def private_pipe(fd):
    info = os.fstat(fd)
    need(info.st_uid == os.getuid() and (stat.S_ISFIFO(info.st_mode)
         or stat.S_ISSOCK(info.st_mode)), 'owned-private-pipe-required')
    return info.st_dev, info.st_ino


def validate_fd_request(request):
    # The disabled/missing request stops before auth paths or any network.
    need(isinstance(request, dict) and request.get('executionEnabled') is True,
         'native-credential-disabled-before-auth')
    keys = {'schema', 'executionEnabled', 'mode', 'requestId', 'accountId', 'worker',
            'expectedUserIdSha256', 'requiredScopes', 'preparationManifestSha256',
            'helperSourceSha256', 'factsCanonicalSha256', 'preflight',
            'preflightCanonicalSha256', 'deadlineUnix', 'proxy'}
    need(set(request) == keys and request['schema'] == 'riffoid-ir.native-oauth-fd-request/v1'
         and request['requestId'] == REQUEST
         and request['mode'] in ('collect', 'execute')
         and request['accountId'] == ACCOUNT and request['worker'] == WORKER
         and request['expectedUserIdSha256'] == USER_SHA
         and request['requiredScopes'] == SCOPES
         and request['preparationManifestSha256'] == hashlib.sha256(fixed_read(SOURCE_MANIFEST, 262144)).hexdigest(),
         'fixed-native-credential-request')
    need(type(request['deadlineUnix']) in (int, float)
         and math.isfinite(request['deadlineUnix'])
         and time.time() < request['deadlineUnix'] <= time.time() + 900,
         'native-credential-deadline')
    need(all(isinstance(request[k], str) and HEX.fullmatch(request[k])
             for k in ('helperSourceSha256', 'factsCanonicalSha256', 'preflightCanonicalSha256'))
         and sha(fixed_read(Path(__file__), 131072)) == request['helperSourceSha256'],
         'fixed-native-credential-helper-source')
    p = request['preflight']
    need(isinstance(p, dict) and set(p) == {
        'schema', 'requestId', 'factsCanonicalSha256', 'actualMainSha', 'actualMainTree',
        'sourceAuditSha256', 'sourceClosureCanonicalSha256', 'authorityEvidenceSha256',
        'maintenanceHoldCanonicalSha256', 'phaseWitnessCanonicalSha256',
        'logicalReleaseEvidenceSha256', 'physicalBoundaryEvidenceSha256', 'verifiedAtUnix'}
         and p['schema'] == 'riffoid-ir.native-owner-precredential-preflight/v1'
         and p['requestId'] == request['requestId']
         and p['factsCanonicalSha256'] == request['factsCanonicalSha256']
         and canonical_sha(p) == request['preflightCanonicalSha256']
         and all(isinstance(p[k], str) and HEX.fullmatch(p[k]) for k in (
             'sourceAuditSha256', 'sourceClosureCanonicalSha256', 'authorityEvidenceSha256',
             'maintenanceHoldCanonicalSha256', 'phaseWitnessCanonicalSha256',
             'logicalReleaseEvidenceSha256'))
         and (p['physicalBoundaryEvidenceSha256'] is None if request['mode'] == 'collect'
              else isinstance(p['physicalBoundaryEvidenceSha256'], str)
              and HEX.fullmatch(p['physicalBoundaryEvidenceSha256']))
         and isinstance(p['actualMainSha'], str) and COMMIT.fullmatch(p['actualMainSha'])
         and isinstance(p['actualMainTree'], str) and COMMIT.fullmatch(p['actualMainTree'])
         and type(p['verifiedAtUnix']) in (int, float)
         and 0 <= time.time() - p['verifiedAtUnix'] <= 15,
         'fresh-validated-owner-preflight-required')
    proxy = request['proxy']
    need(proxy is None or isinstance(proxy, dict) and set(proxy) == {'hostname', 'port'}
         and proxy['hostname'] in ('127.0.0.1', 'localhost', '::1')
         and type(proxy['port']) is int and 1 <= proxy['port'] <= 65535,
         'fixed-explicit-loopback-proxy')
    need(private_pipe(3) != private_pipe(4), 'distinct-private-request-result-pipes')
    return request


def identity_get(token, path, deadline, proxy):
    need(path in ('/user', '/accounts/' + ACCOUNT), 'identity-get-only')
    need(time.monotonic() < deadline, 'identity-deadline')
    host, port = ('api.cloudflare.com', 443) if proxy is None else (
        proxy['hostname'], proxy['port'])
    connection = http.client.HTTPSConnection(host, port,
        timeout=max(0.001, min(20, deadline - time.monotonic())),
        context=ssl.create_default_context())
    if proxy is not None:
        # Standard library CONNECT is plain HTTP to the loopback proxy, followed
        # by certificate-checked TLS to the fixed API hostname.
        connection.set_tunnel('api.cloudflare.com', 443)
    try:
        connection.request('GET', '/client/v4' + path, headers={
            'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
            'Accept-Encoding': 'identity'})
        response = connection.getresponse()
        need(sum(len(k) + len(v) + 4 for k, v in response.getheaders()) <= 32768,
             'bounded-identity-headers')
        need(response.status == 200, 'identity-http-' + str(response.status))
        length = response.getheader('Content-Length')
        need(length is None or length.isdigit() and int(length) <= 65536,
             'bounded-identity-content-length')
        need(response.getheader('Content-Encoding') in (None, 'identity'),
             'identity-content-encoding')
        raw = bytearray()
        while True:
            need(time.monotonic() < deadline, 'identity-deadline')
            if connection.sock is not None:
                connection.sock.settimeout(max(0.001, min(20, deadline - time.monotonic())))
            chunk = response.read(min(4096, 65537 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
            need(len(raw) <= 65536, 'bounded-identity-json')
        need(length is None or len(raw) == int(length), 'complete-identity-body')
        value = parse(bytes(raw))
        need(isinstance(value, dict) and value.get('success') is True
             and value.get('errors') == [] and isinstance(value.get('result'), dict),
             'identity-success-envelope')
        return value['result'], {'path': path, 'status': 200,
                                 'bytes': len(raw), 'sha256': sha(raw)}
    finally:
        connection.close()


def private_main():
    token, token_bytes = None, None
    operation = 'disabled-before-auth'
    gets = {'user': 0, 'account': 0}
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        need(len(os.sys.argv) == 1, 'fixed-native-helper-no-arguments')
        private_pipe(3)
        with os.fdopen(3, 'rb') as pipe:
            raw = pipe.read(16385)
            need(0 < len(raw) <= 16384, 'bounded-private-owner-request')
            request = validate_fd_request(parse(raw))
        operation = 'existing-wrangler-read'
        token, expires, scopes = load_existing_token()
        need(len(token) < 16384 and expires > request['deadlineUnix'] + 120,
             'existing-oauth-valid-through-bounded-attempt-no-refresh')
        deadline = time.monotonic() + min(40, request['deadlineUnix'] - time.time())
        operation = 'get-user'
        gets['user'] = 1
        user, user_body = identity_get(token, '/user', deadline, request['proxy'])
        need(isinstance(user.get('id'), str)
             and sha(user['id'].encode('utf8')) == USER_SHA,
             'same-existing-cloudflare-user-required')
        operation = 'get-account'
        gets['account'] = 1
        account, account_body = identity_get(token, '/accounts/' + ACCOUNT,
                                             deadline, request['proxy'])
        need(account.get('id') == ACCOUNT, 'same-existing-cloudflare-account-required')
        need(time.time() < request['deadlineUnix'], 'native-credential-deadline')
        metadata = {
            'schema': 'riffoid-ir.native-oauth-fd-result/v1',
            'mode': request['mode'],
            'requestId': request['requestId'], 'accountId': ACCOUNT, 'worker': WORKER,
            'expectedUserIdSha256': USER_SHA, 'scopes': scopes,
            'factsCanonicalSha256': request['factsCanonicalSha256'],
            'preflightCanonicalSha256': request['preflightCanonicalSha256'],
            'helperSourceSha256': request['helperSourceSha256'],
            'expiresAtUnix': expires, 'deadlineUnix': request['deadlineUnix'],
            'identityVerifiedAtUnix': time.time(),
            'identityResponses': [user_body, account_body],
            'refreshAttempts': 0, 'retryAttempts': 0, 'credentialBodyLogged': False}
        header = json.dumps(metadata, sort_keys=True, separators=(',', ':'),
                            ensure_ascii=True, allow_nan=False).encode('ascii')
        token_bytes = bytearray(token.encode('ascii'))
        need(0 < len(header) <= 4096, 'bounded-private-credential-metadata')
        # Binary private frame; credentials never appear in JSON/stdout/stderr.
        frame = len(header).to_bytes(4, 'big') + len(token_bytes).to_bytes(4, 'big')
        with os.fdopen(4, 'wb') as output:
            output.write(frame)
            output.write(header)
            output.write(token_bytes)
            output.flush()
        return 0
    except BaseException as error:
        code = str(error) if isinstance(error, Guard) else 'native-private-helper-stopped'
        os.write(2, (json.dumps({'schema': 'riffoid-ir.native-oauth-fd-stopped/v1',
                                'code': code, 'credentialBodyLogged': False,
                                'operation': operation, 'identityGetCounts': gets,
                                'refreshAttempts': 0, 'retryAttempts': 0}) + '\n').encode('ascii'))
        return 1
    finally:
        token = None
        if token_bytes is not None:
            for i in range(len(token_bytes)):
                token_bytes[i] = 0


if __name__ == '__main__':
    raise SystemExit(private_main())
