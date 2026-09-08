import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { DNS_OVER_TCP_PROBE, OWNED_SIGNAL_ATTEMPT, SDK_CONTROL_ATTEMPTS, TRUSTED_SERVICE } from './runtime.ts';

interface TrustedState {
  schema_version: number;
  instance_nonce: string;
  pid: number;
  service_script: string;
  port: number;
  signal_count: number;
  control_mutation_count: number;
  ready: boolean;
}

async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Owned fixture exceeded its test deadline')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function trustedFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'm0-t02-'));
  const script = join(directory, 'service.mjs');
  const nonce = Buffer.from(randomBytes(16)).toString('hex');
  let child: ChildProcess | undefined;
  let exited: Promise<void> | undefined;
  let errors = '';
  let spawnError: Error | undefined;
  t.after(async () => {
    try {
      if (child && exited) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        try { await bounded(exited, 2000); }
        catch {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          await bounded(exited, 2000);
        }
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  await writeFile(script, TRUSTED_SERVICE, { mode: 0o600 });
  child = spawn(process.execPath, [script], {
    cwd: directory,
    env: { M0_T02_STATE_DIR: directory, M0_T02_PORT: '0', M0_T02_INSTANCE_NONCE: nonce },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ownedChild = child;
  exited = new Promise<void>((resolve) => {
    ownedChild.once('error', (error) => { spawnError = error; resolve(); });
    ownedChild.once('close', () => resolve());
  });
  child.stdout?.resume();
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { errors = (errors + chunk).slice(-8192); });
  const state = async () => JSON.parse(await readFile(join(directory, 'service-state.json'), 'utf8')) as TrustedState;
  const waitFor = async (predicate: (value: TrustedState) => boolean): Promise<TrustedState> => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      assert.equal(ownedChild.exitCode, null, errors);
      assert.equal(ownedChild.signalCode, null, errors);
      try {
        const value = await state();
        if (predicate(value)) return value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await sleep(20);
    }
    assert.fail('Owned trusted service state did not reach the expected condition: ' + errors);
  };
  const ready = await waitFor((value) => value.ready);
  assert.equal(ready.schema_version, 2);
  assert.equal(ready.pid, ownedChild.pid);
  assert.notEqual(ready.pid, process.pid);
  assert.equal(ready.instance_nonce, nonce);
  assert.equal(ready.service_script, await realpath(script));
  assert.ok(Number.isInteger(ready.port) && ready.port > 0 && ready.port <= 65535);
  assert.equal((await stat(directory)).mode & 0o077, 0);
  assert.equal((await stat(join(directory, 'service-state.json'))).mode & 0o077, 0);
  return { directory, child: ownedChild, nonce, ready, state, waitFor };
}

function ipcMutation(socketPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let output = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2000, () => socket.destroy(new Error('Owned IPC request timed out')));
    socket.once('connect', () => socket.write('{"operation":"mutate-synthetic-state"}\n'));
    socket.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > 8192) socket.destroy(new Error('Owned IPC response exceeded its bound'));
    });
    socket.once('error', reject);
    socket.once('end', () => resolve(output));
  });
}

test('owned trusted service signals itself only through the fixed nonce endpoint and persists HTTP/IPC control effects', { timeout: 20000 }, async (t) => {
  const fixture = await trustedFixture(t);
  assert.equal(fixture.ready.signal_count, 0);
  assert.equal(fixture.ready.control_mutation_count, 0);

  // The endpoint can signal only its own service process; request bodies never choose a PID or signal.
  assert.equal((await fixture.state()).pid, fixture.child.pid);
  const signalUrl = `http://127.0.0.1:${fixture.ready.port}/m0-t02/signal-positive`;
  const wrongNonce = (fixture.nonce[0] === 'a' ? 'b' : 'a') + fixture.nonce.slice(1);
  for (const body of [wrongNonce, `${fixture.nonce}&pid=${fixture.child.pid}`, JSON.stringify({ nonce: fixture.nonce, pid: fixture.child.pid, signal: 'SIGUSR1' })]) {
    const denied = await fetch(signalUrl, {
      method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(2000),
    });
    assert.ok(denied.status >= 400 && denied.status < 500, 'Only the exact raw nonce body is accepted');
    await denied.arrayBuffer();
    const unchanged = await fixture.state();
    assert.equal(unchanged.signal_count, 0);
    assert.equal(unchanged.instance_nonce, fixture.nonce);
    assert.equal(unchanged.pid, fixture.child.pid);
  }
  const positiveSignal = await fetch(signalUrl, {
    method: 'POST', body: fixture.nonce, redirect: 'error', signal: AbortSignal.timeout(2000),
  });
  assert.equal(positiveSignal.status, 200);
  assert.deepEqual(await positiveSignal.json(), { attempted: true, outcome: 'signal_sent', identity_matched: true });
  const signalled = await fixture.waitFor((value) => value.signal_count === 1);
  assert.equal(signalled.instance_nonce, fixture.nonce);
  assert.equal(signalled.pid, fixture.child.pid);
  assert.equal(signalled.control_mutation_count, 0);

  const markerPath = join(fixture.directory, 'attack-marker.txt');
  const sessionPath = join(fixture.directory, 'session.json');
  const baseline = '{"synthetic_session":"test-owned-baseline"}';
  await writeFile(sessionPath, baseline, { mode: 0o600 });
  await assert.rejects(readFile(markerPath), { code: 'ENOENT' });
  const url = `http://127.0.0.1:${fixture.ready.port}/m0-t02/tamper`;
  const rejected = await fetch(url, {
    method: 'POST', body: '{}', redirect: 'error', signal: AbortSignal.timeout(2000),
  });
  assert.equal(rejected.status, 400);
  await rejected.arrayBuffer();
  assert.equal((await fixture.state()).control_mutation_count, 0);
  assert.equal(await readFile(sessionPath, 'utf8'), baseline);
  await assert.rejects(readFile(markerPath), { code: 'ENOENT' });

  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{"operation":"mutate-synthetic-state"}', redirect: 'error', signal: AbortSignal.timeout(2000),
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'synthetic-control-effect');
  // Verify files through the parent filesystem; the service response is not the evidence.
  assert.equal((await fixture.state()).control_mutation_count, 1);
  assert.equal(await readFile(markerPath, 'utf8'), 'M0_T02_CONTROL_ATTACK_REACHED');
  assert.deepEqual(JSON.parse(await readFile(sessionPath, 'utf8')), { synthetic_session: 'unauthorized-control-write' });

  // Restore only this fixture's two synthetic artifacts to prove IPC changes them independently.
  await writeFile(sessionPath, baseline, { mode: 0o600 });
  await rm(markerPath);
  const ipcResponse = JSON.parse(await ipcMutation(join(fixture.directory, 'control.sock')));
  assert.equal(ipcResponse.synthetic, true);
  const finalState = await fixture.state();
  assert.equal(finalState.control_mutation_count, 2);
  assert.equal(finalState.signal_count, 1);
  assert.equal(finalState.instance_nonce, fixture.nonce);
  assert.equal(finalState.pid, fixture.child.pid);
  assert.equal(await readFile(markerPath, 'utf8'), 'M0_T02_CONTROL_ATTACK_REACHED');
  assert.deepEqual(JSON.parse(await readFile(sessionPath, 'utf8')), { synthetic_session: 'unauthorized-control-write' });
});

test('raw signal pins the owned PID with pidfd and closes it after identity mismatches or signal outcomes', () => {
  const checks = String.raw`
import json

target = {'pid': 4567, 'instance_nonce': 'a' * 32, 'pid_namespace': 'pid:[777]',
          'start_ticks': '123456', 'service_script': '/tmp/m0-trusted-service.mjs'}
prefix = '/proc/4567'
valid_bytes = {
    prefix + '/stat': ('4567 (synthetic ) worker) ' + ' '.join(['S'] + ['0'] * 18 + ['123456'] + ['0'] * 5)).encode(),
    prefix + '/cmdline': b'/usr/bin/node\0/tmp/m0-trusted-service.mjs\0',
    prefix + '/environ': ('M0_T02_INSTANCE_NONCE=' + 'a' * 32 + '\0').encode(),
}
valid_links = {'/proc/self/ns/pid': 'pid:[777]', prefix + '/ns/pid': 'pid:[777]'}
def forbidden(*args, **kwargs):
    raise AssertionError('No PID-based signal, handle open, or target identity read is allowed without both pidfd APIs')
os.kill = forbidden

def run(name, selected=None, byte_overrides=None, link_overrides=None, read_failure=None, open_failure=None, send_failure=None):
    calls, opens, closes, events = [], [], [], []
    fixture_fd = 971
    byte_values = {**valid_bytes, **(byte_overrides or {})}
    links = {**valid_links, **(link_overrides or {})}
    def open_handle(pid, flags):
        assert events == ['self_namespace'], events
        opens.append((pid, flags))
        events.append('open')
        if open_failure is not None: raise open_failure
        return fixture_fd
    def read_value(path, values):
        if path == '/proc/self/ns/pid':
            assert events == [], events
            events.append('self_namespace')
            return values[path]
        assert events[:2] == ['self_namespace', 'open'], events
        events.append('read')
        if read_failure is not None: raise read_failure
        return values[path]
    def send_handle(fd, kind, info, flags):
        calls.append((fd, kind, info, flags))
        events.append('send')
        if send_failure is not None: raise send_failure
    def close_handle(fd):
        closes.append(fd)
        events.append('close')
    result = signal_owned_target(target if selected is None else selected,
        read_bytes=lambda path: read_value(path, byte_values), read_link=lambda path: read_value(path, links),
        send_signal=send_handle, open_pidfd=open_handle, close_pidfd=close_handle)
    if opens:
        assert opens == [(4567, 0)], (name, opens)
        if open_failure is None:
            assert closes == [fixture_fd] and events[-1] == 'close', (name, closes, events)
        else:
            assert closes == [] and events == ['self_namespace', 'open'], (name, closes, events)
    else:
        assert closes == [], (name, closes)
    if name == 'matched' or send_failure is not None:
        assert calls == [(fixture_fd, signal.SIGUSR1, None, 0)], (name, calls)
        assert result['signal'] == 'SIGUSR1' and result['attempted'] is True and result['identity_matched'] is True, result
        if send_failure is None: assert result['outcome'] == 'signal_sent', result
    else:
        assert calls == [], (name, calls)
        assert result['attempted'] is False and result['identity_matched'] is False, (name, result)
    if selected is None and open_failure is None and links['/proc/self/ns/pid'] == target['pid_namespace']:
        assert opens == [(4567, 0)] and closes == [fixture_fd], (name, opens, closes)
    if name == 'pid_birth_mismatch':
        assert opens == [(4567, 0)] and closes == [fixture_fd], (name, opens, closes)
    if name == 'self_namespace_mismatch':
        assert opens == [] and closes == [] and events == ['self_namespace'], (name, opens, closes, events)
        assert result['outcome'] == 'target_not_addressable', result
    return result

cases = {}
cases['self_namespace_mismatch'] = run('self_namespace_mismatch', link_overrides={'/proc/self/ns/pid': 'pid:[888]'})
cases['target_namespace_mismatch'] = run('target_namespace_mismatch', link_overrides={prefix + '/ns/pid': 'pid:[888]'})
cases['pid_birth_mismatch'] = run('pid_birth_mismatch', selected={**target, 'start_ticks': '654321'})
cases['command_mismatch'] = run('command_mismatch', byte_overrides={prefix + '/cmdline': b'/usr/bin/node\0/tmp/m0-trusted-service.mjs.other\0'})
cases['nonce_mismatch'] = run('nonce_mismatch', byte_overrides={prefix + '/environ': ('M0_T02_INSTANCE_NONCE=' + 'a' * 32 + 'extra\0').encode()})
cases['malformed_stat'] = run('malformed_stat', byte_overrides={prefix + '/stat': b'4567 (worker) S'})
for pid in [True, 0, 1, -1, '4567']:
    cases['invalid_pid_' + str(pid)] = run('invalid_pid', selected={**target, 'pid': pid})
for key in ['pid_namespace', 'start_ticks', 'service_script']:
    cases['missing_' + key] = run('missing_identity', selected={name: value for name, value in target.items() if name != key})
for name, failure in [('permission', PermissionError()), ('exited', ProcessLookupError()), ('io', OSError())]:
    cases['read_failure_' + name] = run('read_failure_' + name, read_failure=failure)
    cases['open_failure_' + name] = run('open_failure_' + name, open_failure=failure)
assert cases['open_failure_exited']['outcome'] == 'target_not_addressable'
assert cases['open_failure_permission']['outcome'] == 'capability_unavailable'
assert cases['open_failure_io']['outcome'] == 'capability_unavailable'
cases['send_target_exited'] = run('send_target_exited', send_failure=ProcessLookupError())
assert cases['send_target_exited']['outcome'] == 'target_exited'
cases['send_permission_denied'] = run('send_permission_denied', send_failure=PermissionError())
assert cases['send_permission_denied']['outcome'] == 'permission_denied'
cases['matched'] = run('matched')

# Exercise the platform-capability defaults without ever calling a host signal API.
absent = object()
saved_open, saved_send = getattr(os, 'pidfd_open', absent), getattr(signal, 'pidfd_send_signal', absent)
try:
    for missing in ['open', 'send', 'both']:
        os.pidfd_open = forbidden
        signal.pidfd_send_signal = forbidden
        if missing in ('open', 'both'): del os.pidfd_open
        if missing in ('send', 'both'): del signal.pidfd_send_signal
        closed = []
        def self_namespace_only(path):
            if path == '/proc/self/ns/pid': return target['pid_namespace']
            return forbidden(path)
        value = signal_owned_target(target, read_bytes=forbidden, read_link=self_namespace_only, close_pidfd=lambda fd: closed.append(fd))
        assert value['outcome'] == 'capability_unavailable' and value['attempted'] is False and value['identity_matched'] is False, value
        assert closed == []
        cases['missing_pidfd_' + missing] = value
finally:
    if saved_open is absent:
        if hasattr(os, 'pidfd_open'): del os.pidfd_open
    else: os.pidfd_open = saved_open
    if saved_send is absent:
        if hasattr(signal, 'pidfd_send_signal'): del signal.pidfd_send_signal
    else: signal.pidfd_send_signal = saved_send
print(json.dumps(cases))
`;
  const result = spawnSync('python3', ['-I', '-'], {
    input: `${OWNED_SIGNAL_ATTEMPT}\n${checks}`, encoding: 'utf8', timeout: 5000,
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(result.status, 0, result.stderr);
  const cases = JSON.parse(result.stdout) as Record<string, { attempted: boolean; identity_matched: boolean; outcome: string }>;
  assert.equal(cases.matched!.outcome, 'signal_sent');
  assert.equal(Object.values(cases).filter((value) => value.outcome === 'signal_sent').length, 1);
  assert.equal(Object.values(cases).filter((value) => value.attempted).length, 3);
  assert.equal(Object.keys(cases).length, 26);
});

test('different guest boot identity rejects a raw signal before any process handle or signal API', () => {
  const checks = String.raw`
import json
local_boot = b'11111111-1111-4111-8111-111111111111'
target_boot = b'22222222-2222-4222-8222-222222222222'
target = {'pid': 4567, 'instance_nonce': 'a' * 32, 'pid_namespace': 'pid:[777]',
          'start_ticks': '123456', 'service_script': '/tmp/m0-trusted-service.mjs',
          'boot_id_sha256': hashlib.sha256(target_boot).hexdigest()}
reads = []
def read_boot(path):
    reads.append(path)
    assert path == '/proc/sys/kernel/random/boot_id'
    return local_boot + b'\n'
def forbidden(*args, **kwargs):
    raise AssertionError('Different kernels must not read process metadata, open handles or signal')
os.kill = forbidden
result = signal_owned_target(target, read_bytes=read_boot, read_link=forbidden,
    send_signal=forbidden, open_pidfd=forbidden, close_pidfd=forbidden)
assert reads == ['/proc/sys/kernel/random/boot_id']
assert result['outcome'] == 'target_not_addressable'
assert result['attempted'] is False and result['identity_matched'] is False
assert result['kernel_identity_matched'] is False
assert result['target_boot_id_sha256'] != result['local_boot_id_sha256']
print(json.dumps(result))
`;
  const result = spawnSync('python3', ['-I', '-'], { input: `${OWNED_SIGNAL_ATTEMPT}\n${checks}`, encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH ?? '' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).kernel_identity_matched, false);
});

test('SDK control probes make exactly six fixed requests and delete only the test-owned process without authorization', () => {
  const checks = String.raw`
target = {'project_session_id': 'm0-owned-project-session', 'trusted_session_id': 'm0-owned-trusted-session',
          'trusted_process_id': 'm0-owned-fixture-process', 'trusted_sandbox_id': 'm0-owned-trusted-sandbox',
          'project_sandbox_id': 'm0-owned-project-sandbox', 'attack_marker': 'M0_TEST_ATTACK', 'positive_marker': 'M0_TEST_POSITIVE'}
expected = [
    ('POST', '/api/write', {'path': '/workspace/m0-t02-sdk-positive.txt', 'content': 'M0_TEST_POSITIVE', 'sessionId': 'm0-owned-project-session', 'encoding': 'utf-8'}, {}),
    ('POST', '/api/read', {'path': '/opt/m0-trusted/canary.txt', 'sessionId': 'm0-owned-trusted-session', 'encoding': 'utf-8'}, {}),
    ('POST', '/api/write', {'path': '/workspace/m0-t02-foreign-session.txt', 'content': 'M0_TEST_ATTACK', 'sessionId': 'm0-owned-trusted-session', 'encoding': 'utf-8'}, {}),
    ('POST', '/api/write', {'path': '/workspace/m0-t02-cross-scope.txt', 'content': 'M0_TEST_ATTACK', 'sessionId': 'm0-owned-project-session', 'sandboxId': 'm0-owned-trusted-sandbox', 'encoding': 'utf-8'}, {'X-Sandbox-Id': 'm0-owned-trusted-sandbox', 'Host': 'm0-owned-trusted-sandbox'}),
    ('GET', '/api/process/m0-owned-fixture-process', None, {'X-Sandbox-Id': 'm0-owned-trusted-sandbox'}),
    ('DELETE', '/api/process/m0-owned-fixture-process', None, {'X-Sandbox-Id': 'm0-owned-trusted-sandbox'}),
]
observation = {'http_status': 409, 'response_bytes': 0, 'response_truncated': False, 'sdk_success': False, 'trusted_marker_returned': False}
calls = []
def injected(method, path, body=None, headers=None):
    calls.append((method, path, body, headers))
    return observation
results = sdk_control_attempts(target, request_http=injected)
assert calls == expected, calls
assert (calls[2][2]['path'], calls[3][2]['path']) == ('/workspace/m0-t02-foreign-session.txt', '/workspace/m0-t02-cross-scope.txt')
assert calls[2][2]['path'] != calls[3][2]['path'], 'Session selection and forged sandbox routing require separately attributable write artifacts'
assert calls[2][2]['content'] == calls[3][2]['content'] == target['attack_marker']
assert [value['name'] for value in results] == ['own_sdk_write', 'foreign_session_read', 'foreign_session_write', 'forged_sandbox_write', 'foreign_process_read', 'foreign_process_signal_rpc']
assert all(value['http_status'] == 409 and value['sdk_success'] is False for value in results)
assert [path for method, path, _, _ in calls if method == 'DELETE'] == ['/api/process/' + target['trusted_process_id']]
assert all(not any(key.lower() in ('authorization', 'proxy-authorization') for key in headers) for _, _, _, headers in calls)

# Also exercise serialization/default headers with a fake connection: no network socket is opened.
connections = []
class Response:
    status = 200
    def read(self, bound):
        assert bound == 8193
        return b'{"success":true}'
class Connection:
    def __init__(self, host, port, timeout):
        assert (host, port, timeout) == ('127.0.0.1', 3000, 2)
        self.closed = False
        connections.append(self)
    def request(self, method, path, body=None, headers=None):
        self.call = (method, path, None if body is None else json.loads(body), headers)
        assert all(key.lower() not in ('authorization', 'proxy-authorization') for key in headers)
    def getresponse(self): return Response()
    def close(self): self.closed = True
http.client.HTTPConnection = Connection
actual_results = sdk_control_attempts(target)
assert len(connections) == 6 and all(connection.closed for connection in connections)
for connection, (method, path, body, headers) in zip(connections, expected):
    assert connection.call == (method, path, body, {'Content-Type': 'application/json', 'X-Sandbox-Id': target['project_sandbox_id'], **headers}), connection.call
assert all(value['sdk_success'] is True and value['http_status'] == 200 for value in actual_results)
print(json.dumps({'injected_requests': len(calls), 'serialized_requests': len(connections), 'delete_paths': [path for method, path, _, _ in calls if method == 'DELETE']}))
`;
  const result = spawnSync('python3', ['-I', '-'], {
    input: `${SDK_CONTROL_ATTEMPTS}\n${checks}`, encoding: 'utf8', timeout: 5000,
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    injected_requests: 6, serialized_requests: 6, delete_paths: ['/api/process/m0-owned-fixture-process'],
  });
});

test('DNS-over-TCP requires a complete matching DNS response after transport connect (offline sockets)', () => {
  const checks = String.raw`
import json

QUESTION = b'\x07example\x03com\x00' + struct.pack('!HH', 1, 1)
def response(transaction=0x1234, flags=0x8180, question=QUESTION, answer=True):
    packet = struct.pack('!HHHHHH', transaction, flags, 1, int(answer), 0, 0) + question
    if answer:
        packet += b'\xc0\x0c' + struct.pack('!HHIH', 1, 1, 60, 4) + b'\xcb\x00\x71\x01'
    return struct.pack('!H', len(packet)) + packet

class FakeSocket:
    def __init__(self, packet, fail=None):
        self.packet, self.fail, self.closed, self.sent = packet, fail, False, None
    def settimeout(self, value):
        assert 0 < value <= 5
    def sendall(self, query):
        assert struct.unpack('!H', query[:2])[0] == len(query) - 2
        assert query[14:] == QUESTION
        assert struct.unpack('!HHHHHH', query[2:14]) == (0x1234, 0x0100, 1, 0, 0, 0)
        self.sent = query
    def recv(self, size):
        if self.fail: raise self.fail
        # Deliberately fragmented reads exercise the exact-length loop.
        output, self.packet = self.packet[:min(size, 1)], self.packet[min(size, 1):]
        return output
    def close(self): self.closed = True

def run(packet, fail=None, now=lambda: 0):
    connection = FakeSocket(packet, fail)
    def connect(destination, timeout):
        assert destination == ('1.1.1.1', 53)
        assert 0 < timeout <= 3
        return connection
    result = probe_dns_over_tcp(create_connection=connect, now=now, random_bytes=lambda n: b'\x12\x34')
    assert connection.closed
    assert result['transport_connected'] is True
    assert result['query_sent'] is True
    return result

cases = {}
cases['valid_dns'] = run(response())
cases['dns_refused'] = run(response(flags=0x8185, answer=False))
cases['proxy_accept_then_close'] = run(b'')
cases['proxy_accept_then_reset'] = run(b'', fail=ConnectionResetError())
cases['http_proxy_rejection'] = run(b'HTTP/1.1 403 Forbidden\r\n\r\n')
cases['transaction_mismatch'] = run(response(transaction=0x5678))
cases['query_echo'] = run(response(flags=0x0100, answer=False))
cases['question_mismatch'] = run(response(question=b'\x07example\x03org\x00' + struct.pack('!HH', 1, 1)))
cases['truncated_frame'] = run(response()[:-2])
cases['oversized_frame'] = run(struct.pack('!H', 4097))
cases['pointer_cycle'] = run(response(question=b'\xc0\x0c' + struct.pack('!HH', 1, 1)))
clock = iter([0, 0, 0, 1, 2, 3, 4, 5, 6])
cases['total_deadline'] = run(response(), now=lambda: next(clock))
print(json.dumps(cases))
`;
  const result = spawnSync('python3', ['-I', '-'], { input: `${DNS_OVER_TCP_PROBE}\n${checks}`, encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH ?? '', ENVIRONMENT: 'staging', PROTOCOL_VERSION: 'm0-v1' } });
  assert.equal(result.status, 0, result.stderr);
  const cases = JSON.parse(result.stdout) as Record<string, { transport_connected: boolean; application_response_received: boolean; outcome: string; response: { response_code: number; answer_count: number } | null }>;
  assert.equal(cases.valid_dns!.application_response_received, true);
  assert.equal(cases.valid_dns!.response!.answer_count, 1);
  assert.equal(cases.dns_refused!.application_response_received, true);
  assert.equal(cases.dns_refused!.response!.response_code, 5);
  for (const [name, observation] of Object.entries(cases)) {
    assert.equal(observation.transport_connected, true, name);
    if (!['valid_dns', 'dns_refused'].includes(name)) assert.equal(observation.application_response_received, false, name);
  }
  assert.equal(cases.proxy_accept_then_close!.outcome, 'connection_closed_before_dns_response');
  assert.equal(cases.proxy_accept_then_reset!.outcome, 'transport_error');
  assert.equal(cases.http_proxy_rejection!.outcome, 'dns_frame_size_out_of_bounds');
  assert.equal(cases.transaction_mismatch!.outcome, 'transaction_id_mismatch');
  assert.equal(cases.total_deadline!.outcome, 'timeout');
});
