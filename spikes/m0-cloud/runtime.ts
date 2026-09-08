// Fixed scripts only. Neither scripts nor command strings are accepted from HTTP callers.
export const TRUSTED_SERVICE = String.raw`
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { join, isAbsolute, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = process.env.M0_T02_STATE_DIR ?? '/opt/m0-trusted';
const nonce = process.env.M0_T02_INSTANCE_NONCE;
const port = Number(process.env.M0_T02_PORT ?? 41239);
if (!isAbsolute(directory) || directory === parse(directory).root || !/^[a-f0-9]{32}$/.test(nonce ?? '')
  || ![0, 41239].includes(port) || !fs.lstatSync(directory).isDirectory()) throw new Error('invalid-fixture-configuration');
const socketPath = join(directory, 'control.sock');
const statePath = join(directory, 'service-state.json');
// A fresh owned directory is required; never unlink another service's socket.
if (fs.existsSync(socketPath) || fs.existsSync(statePath)) throw new Error('fixture-already-exists');
let namespace = null, startTicks = null, bootIdSha256 = null;
try {
  const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  if (!/^[a-f0-9-]{36}$/.test(bootId)) throw new Error('invalid-boot-identity');
  bootIdSha256 = createHash('sha256').update(bootId).digest('hex');
  namespace = fs.readlinkSync('/proc/self/ns/pid');
  const stat = fs.readFileSync('/proc/self/stat', 'utf8');
  startTicks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
} catch { /* /proc is absent on the macOS subprocess unit-test host. */ }
const state = { schema_version: 2, instance_nonce: nonce, pid: process.pid, pid_namespace: namespace,
  start_ticks: startTicks, boot_id_sha256: bootIdSha256, service_script: fileURLToPath(import.meta.url), port: null,
  signal_count: 0, control_mutation_count: 0, ready: false };
function persist() {
  const temporary = statePath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(state) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, statePath);
}
function mutate() {
  state.control_mutation_count += 1;
  fs.writeFileSync(join(directory, 'attack-marker.txt'), 'M0_T02_CONTROL_ATTACK_REACHED', { mode: 0o600 });
  fs.writeFileSync(join(directory, 'session.json'), '{"synthetic_session":"unauthorized-control-write"}', { mode: 0o600 });
  persist();
}
process.on('SIGUSR1', () => { state.signal_count += 1; persist(); });
const ipc = net.createServer(socket => {
  socket.setTimeout(2000, () => socket.destroy());
  let input = '';
  socket.on('data', bytes => {
    input += bytes;
    if (input.length > 256) { socket.destroy(); return; }
    if (input.includes('\n')) {
      if (input === '{"operation":"mutate-synthetic-state"}\n') mutate();
      socket.end(JSON.stringify({ synthetic: true, state }) + '\n');
    }
  });
});
const web = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ synthetic: true, state })); return;
  }
  if (req.method === 'POST' && req.url === '/m0-t02/signal-positive') {
    let body = '', bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes <= 32) body += chunk;
    });
    req.on('end', () => {
      if (bytes !== 32 || body !== nonce) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ attempted: false, outcome: 'target_not_addressable', identity_matched: false })); return;
      }
      // The service signals only itself while executing this handler. Callers
      // cannot choose a PID or signal, and no numeric target can be recycled.
      process.kill(process.pid, 'SIGUSR1');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ attempted: true, outcome: 'signal_sent', identity_matched: true }));
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/m0-t02/tamper') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 256) req.destroy(); });
    req.on('end', () => {
      if (body !== '{"operation":"mutate-synthetic-state"}') { res.writeHead(400); res.end(); return; }
      mutate(); res.writeHead(200); res.end('synthetic-control-effect');
    });
    return;
  }
  res.writeHead(404); res.end();
});
web.requestTimeout = 3000;
await Promise.all([
  new Promise(resolve => ipc.listen(socketPath, resolve)),
  new Promise(resolve => web.listen(port, '127.0.0.1', resolve)),
]);
state.port = web.address().port;
state.ready = true;
persist();
setTimeout(() => process.exit(0), 120000);
console.log('m0-trusted-ready');
`;

// Pin the process before matching its identity. A PID reused after validation
// must never redirect the signal to another process; there is no os.kill fallback.
export const OWNED_SIGNAL_ATTEMPT = String.raw`
import os, pathlib, signal, hashlib, re

def signal_owned_target(target, read_bytes=lambda path: pathlib.Path(path).read_bytes(), read_link=os.readlink, send_signal=None, open_pidfd=None, close_pidfd=os.close):
    result = {'signal': 'SIGUSR1', 'attempted': False, 'outcome': 'target_not_addressable', 'identity_matched': False}
    handle = None
    try:
        pid, nonce = target['pid'], target['instance_nonce']
        if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 1 or not isinstance(nonce, str) or len(nonce) != 32:
            return result
        if not target.get('pid_namespace') or not target.get('start_ticks') or not target.get('service_script'):
            return result
        if 'boot_id_sha256' in target:
            target_boot = target['boot_id_sha256']
            if not isinstance(target_boot, str) or not re.fullmatch('[a-f0-9]{64}', target_boot):
                return result
            local_boot = read_bytes('/proc/sys/kernel/random/boot_id').strip()
            if not re.fullmatch(b'[a-f0-9-]{36}', local_boot):
                return result
            local_hash = hashlib.sha256(local_boot).hexdigest()
            result['target_boot_id_sha256'] = target_boot
            result['local_boot_id_sha256'] = local_hash
            result['kernel_identity_matched'] = local_hash == target_boot
            # A PID is meaningful only inside its owning kernel. This read-only
            # check also works on guests that do not expose pidfd APIs.
            if local_hash != target_boot:
                return result
        if read_link('/proc/self/ns/pid') != target['pid_namespace']:
            return result
        acquire = open_pidfd if open_pidfd is not None else getattr(os, 'pidfd_open', None)
        send = send_signal if send_signal is not None else getattr(signal, 'pidfd_send_signal', None)
        if not callable(acquire) or not callable(send):
            result['outcome'] = 'capability_unavailable'
            return result
        try: handle = acquire(pid, 0)
        except ProcessLookupError: return result
        except OSError:
            result['outcome'] = 'capability_unavailable'
            return result
        if read_link('/proc/' + str(pid) + '/ns/pid') != target['pid_namespace']:
            return result
        prefix = '/proc/' + str(pid)
        raw_stat = read_bytes(prefix + '/stat').decode()
        if raw_stat[raw_stat.rfind(')') + 2:].split()[19] != target['start_ticks']:
            return result
        if target['service_script'].encode() not in read_bytes(prefix + '/cmdline').split(b'\0'):
            return result
        if ('M0_T02_INSTANCE_NONCE=' + nonce).encode() not in read_bytes(prefix + '/environ').split(b'\0'):
            return result
        result['identity_matched'] = True
        result['attempted'] = True
        send(handle, signal.SIGUSR1, None, 0)
        result['outcome'] = 'signal_sent'
    except ProcessLookupError: result['outcome'] = 'target_exited'
    except PermissionError: result['outcome'] = 'permission_denied'
    except (OSError, ValueError, KeyError, IndexError, TypeError): pass
    finally:
        if handle is not None: close_pidfd(handle)
    return result
`;

export const TRUSTED_SIGNAL_CONTROL = String.raw`
import fs from 'node:fs';
let result = { attempted: false, outcome: 'target_not_addressable', identity_matched: false };
try {
  const raw = fs.readFileSync('/opt/m0-trusted/service-state.json', 'utf8');
  if (raw.length > 4096) throw new Error('invalid-state');
  const state = JSON.parse(raw);
  if (state?.schema_version !== 2 || state.ready !== true || !/^[a-f0-9]{32}$/.test(state.instance_nonce)
    || state.port !== 41239 || state.service_script !== '/tmp/m0-trusted-service.mjs') throw new Error('invalid-state');
  const response = await fetch('http://127.0.0.1:41239/m0-t02/signal-positive', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: state.instance_nonce,
    signal: AbortSignal.timeout(2000), redirect: 'error',
  });
  if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new Error('signal-rejected'); }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024) throw new Error('invalid-response');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (value?.attempted !== true || value.outcome !== 'signal_sent' || value.identity_matched !== true) throw new Error('invalid-response');
  result = { attempted: true, outcome: 'signal_sent', identity_matched: true };
} catch { process.exitCode = 1; }
// Fixed projection only: no state, nonce, response text, error or credential.
console.log(JSON.stringify(result));
`;

export const TRUSTED_HEALTH_CHECK = String.raw`
const response = await fetch('http://127.0.0.1:41239/health', { signal: AbortSignal.timeout(2000), redirect: 'error' });
if (response.status !== 200) throw new Error('trusted-health-unavailable');
console.log(JSON.stringify(await response.json()));
`;

export const SDK_CONTROL_ATTEMPTS = String.raw`
import json, http.client, urllib.request, urllib.error

def sdk_control_attempts(target, request_http=None):
    # Protocol verified in @cloudflare/sandbox@0.12.9's Process/File clients.
    # No caller-controlled URL, command, path, PID, or credentials are accepted.
    def actual(method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', 3000, timeout=2)
        try:
            encoded = None if body is None else json.dumps(body, separators=(',', ':'))
            connection.request(method, path, body=encoded, headers={'Content-Type': 'application/json', 'X-Sandbox-Id': target['project_sandbox_id'], **(headers or {})})
            response = connection.getresponse()
            raw = response.read(8193)
            value = None
            if len(raw) <= 8192:
                try: value = json.loads(raw)
                except (ValueError, UnicodeDecodeError): pass
            return {'http_status': response.status, 'response_bytes': len(raw), 'response_truncated': len(raw) > 8192,
                    'sdk_success': value.get('success') if isinstance(value, dict) and isinstance(value.get('success'), bool) else None,
                    'trusted_marker_returned': b'M0_TRUSTED_NON_SECRET_' in raw}
        except (OSError, ValueError, http.client.HTTPException):
            return {'http_status': None, 'response_bytes': 0, 'response_truncated': False, 'sdk_success': None, 'trusted_marker_returned': False}
        finally: connection.close()
    send = request_http or actual
    own = target['project_session_id']
    trusted = target['trusted_session_id']
    process_id = target['trusted_process_id']
    destination = target['trusted_sandbox_id']
    marker = target['attack_marker']
    attempts = [
        ('own_sdk_write', 'POST', '/api/write', {'path': '/workspace/m0-t02-sdk-positive.txt', 'content': target['positive_marker'], 'sessionId': own, 'encoding': 'utf-8'}, {}),
        ('foreign_session_read', 'POST', '/api/read', {'path': '/opt/m0-trusted/canary.txt', 'sessionId': trusted, 'encoding': 'utf-8'}, {}),
        ('foreign_session_write', 'POST', '/api/write', {'path': '/workspace/m0-t02-foreign-session.txt', 'content': marker, 'sessionId': trusted, 'encoding': 'utf-8'}, {}),
        ('forged_sandbox_write', 'POST', '/api/write', {'path': '/workspace/m0-t02-cross-scope.txt', 'content': marker, 'sessionId': own, 'sandboxId': destination, 'encoding': 'utf-8'}, {'X-Sandbox-Id': destination, 'Host': destination}),
        ('foreign_process_read', 'GET', '/api/process/' + process_id, None, {'X-Sandbox-Id': destination}),
        ('foreign_process_signal_rpc', 'DELETE', '/api/process/' + process_id, None, {'X-Sandbox-Id': destination}),
    ]
    return [{'name': name, 'method': method, 'path': path, **send(method, path, body, headers)} for name, method, path, body, headers in attempts]
`;

export const PROJECT_ISOLATION = String.raw`
import os, json, socket, pathlib, urllib.request, urllib.error, re
${OWNED_SIGNAL_ATTEMPT}
${SDK_CONTROL_ATTEMPTS}
target = json.loads(pathlib.Path('/tmp/m0-project-target.json').read_text())
if set(target) != {'pid', 'instance_nonce', 'pid_namespace', 'start_ticks', 'boot_id_sha256', 'service_script', 'project_session_id', 'trusted_session_id', 'trusted_process_id', 'trusted_sandbox_id', 'project_sandbox_id', 'attack_marker', 'positive_marker'}:
    raise ValueError('invalid_fixed_target')
if any(not isinstance(target[key], str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', target[key]) for key in ['instance_nonce', 'project_session_id', 'trusted_session_id', 'trusted_process_id', 'trusted_sandbox_id', 'project_sandbox_id', 'attack_marker', 'positive_marker']):
    raise ValueError('invalid_fixed_target')
if target['service_script'] != '/tmp/m0-trusted-service.mjs': raise ValueError('invalid_fixed_target')
prefix = b'M0_TRUSTED_NON_SECRET_'
observed = {'isolation_observation_version': 2, 'trusted_paths_readable': [], 'trusted_marker_in_process_environment': False, 'trusted_marker_in_process_command': False, 'platform_secret_variable_names_present': [], 'trusted_ipc_connectable': False, 'trusted_loopback_control_connectable': False}
for name in ['M0_PROBE_TOKEN', 'CLOUDFLARE_API_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'R2_SECRET_ACCESS_KEY']:
    if name in os.environ: observed['platform_secret_variable_names_present'].append(name)
for path in ['/opt/m0-trusted/canary.txt', '/opt/m0-trusted/session.json']:
    try:
        pathlib.Path(path).read_bytes()
        observed['trusted_paths_readable'].append(path)
    except OSError: pass
for directory in list(pathlib.Path('/proc').iterdir())[:4096]:
    if not directory.name.isdigit(): continue
    for source, observation_key in [('environ', 'trusted_marker_in_process_environment'), ('cmdline', 'trusted_marker_in_process_command')]:
        try:
            if prefix in (directory / source).read_bytes()[:65536]: observed[observation_key] = True
        except OSError: pass
connection = None
try:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(2)
    connection.connect('/opt/m0-trusted/control.sock')
    observed['trusted_ipc_connectable'] = True
    connection.sendall(b'{"operation":"mutate-synthetic-state"}\n')
    connection.recv(1024)
except OSError: pass
finally:
    if connection is not None: connection.close()
for name, address in [('trusted_loopback_control', 'http://127.0.0.1:41239/m0-t02/tamper'), ('cross_domain_control_rpc', 'http://m0-control.invalid/m0-t02/tamper')]:
    result = {'name': name, 'http_status': None, 'application_response_received': False}
    try:
        request = urllib.request.Request(address, data=b'{"operation":"mutate-synthetic-state"}', headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=2) as response:
            result['http_status'] = response.status
            result['application_response_received'] = True
            response.read(1024)
    except urllib.error.HTTPError as error:
        result['http_status'] = error.code
        result['application_response_received'] = True
    except OSError: pass
    observed.setdefault('control_http_attempts', []).append(result)
    if name == 'trusted_loopback_control': observed['trusted_loopback_control_connectable'] = result['application_response_received']
target = json.loads(pathlib.Path('/tmp/m0-project-target.json').read_text())
observed['raw_signal'] = signal_owned_target(target)
observed['sdk_control_attempts'] = sdk_control_attempts(target)
observed['own_sdk_control_http_reachable'] = any(row['http_status'] is not None for row in observed['sdk_control_attempts'])
print(json.dumps(observed))
`;

// Kept separately so byte parsing and proxy-accept behavior can be tested with
// fake sockets. This is embedded into the fixed project script below.
export const DNS_OVER_TCP_PROBE = String.raw`
import os, socket, struct, time

def dns_name(packet, offset):
    labels, visited = [], set()
    end = None
    for _ in range(128):
        if offset >= len(packet) or offset in visited: raise ValueError('invalid_dns_name')
        visited.add(offset)
        size = packet[offset]
        if size & 0xc0 == 0xc0:
            if offset + 1 >= len(packet): raise ValueError('truncated_dns_pointer')
            if end is None: end = offset + 2
            offset = ((size & 0x3f) << 8) | packet[offset + 1]
            continue
        if size & 0xc0: raise ValueError('invalid_dns_label')
        offset += 1
        if size == 0: return b'.'.join(labels).lower(), end if end is not None else offset
        if offset + size > len(packet): raise ValueError('truncated_dns_label')
        labels.append(packet[offset:offset + size])
        offset += size
    raise ValueError('dns_name_limit')

def inspect_dns_response(packet, transaction_id):
    if len(packet) < 12: raise ValueError('short_dns_header')
    response_id, flags, questions, answers, authorities, additional = struct.unpack('!HHHHHH', packet[:12])
    if response_id != transaction_id: raise ValueError('transaction_id_mismatch')
    if not flags & 0x8000 or flags & 0x7800: raise ValueError('not_standard_dns_response')
    if questions != 1: raise ValueError('question_count_mismatch')
    name, offset = dns_name(packet, 12)
    if offset + 4 > len(packet): raise ValueError('truncated_question')
    qtype, qclass = struct.unpack('!HH', packet[offset:offset + 4])
    offset += 4
    if name != b'example.com' or qtype != 1 or qclass != 1: raise ValueError('question_mismatch')
    # Validate message framing without trusting or exposing answer contents.
    for _ in range(answers + authorities + additional):
        _, offset = dns_name(packet, offset)
        if offset + 10 > len(packet): raise ValueError('truncated_resource_record')
        data_size = struct.unpack('!H', packet[offset + 8:offset + 10])[0]
        offset += 10 + data_size
        if offset > len(packet): raise ValueError('truncated_resource_data')
    if offset != len(packet): raise ValueError('unexpected_dns_trailing_bytes')
    return {'transaction_id_matches': True, 'question_matches': True, 'response_code': flags & 15, 'answer_count': answers, 'truncated': bool(flags & 0x0200)}

def probe_dns_over_tcp(create_connection=socket.create_connection, now=time.monotonic, random_bytes=os.urandom):
    observation = {'destination': '1.1.1.1:53', 'protocol': 'dns-over-tcp', 'query_name': 'example.com', 'query_type': 'A', 'transport_connected': False, 'query_sent': False, 'application_response_received': False, 'received_bytes': 0, 'outcome': 'not_attempted', 'response': None}
    connection = None
    deadline = now() + 5
    transaction_id = int.from_bytes(random_bytes(2), 'big')
    question = b'\x07example\x03com\x00' + struct.pack('!HH', 1, 1)
    query = struct.pack('!HHHHHH', transaction_id, 0x0100, 1, 0, 0, 0) + question

    def remaining():
        duration = deadline - now()
        if duration <= 0: raise TimeoutError('dns_probe_deadline')
        return duration

    def receive_exact(size):
        data = bytearray()
        while len(data) < size:
            connection.settimeout(remaining())
            chunk = connection.recv(size - len(data))
            if not chunk: raise EOFError('connection_closed_before_dns_response')
            data.extend(chunk)
            observation['received_bytes'] += len(chunk)
        return bytes(data)

    try:
        connection = create_connection(('1.1.1.1', 53), timeout=min(3, remaining()))
        observation['transport_connected'] = True
        connection.settimeout(remaining())
        connection.sendall(struct.pack('!H', len(query)) + query)
        observation['query_sent'] = True
        message_size = struct.unpack('!H', receive_exact(2))[0]
        if message_size < 12 or message_size > 4096: raise ValueError('dns_frame_size_out_of_bounds')
        packet = receive_exact(message_size)
        observation['response'] = inspect_dns_response(packet, transaction_id)
        observation['application_response_received'] = True
        observation['outcome'] = 'matching_dns_response'
    except TimeoutError: observation['outcome'] = 'timeout'
    except EOFError: observation['outcome'] = 'connection_closed_before_dns_response'
    except ValueError as error: observation['outcome'] = str(error)
    except OSError: observation['outcome'] = 'transport_error'
    finally:
        if connection is not None: connection.close()
    return observation
`;

export const PROJECT_EGRESS = String.raw`
import json, urllib.request, urllib.error
${DNS_OVER_TCP_PROBE}
observations = []
# Fixed destinations; no arbitrary outbound relay and no actual secret payload.
for url in ['http://m0-control.invalid/health', 'http://m0-control.invalid/billing/credit', 'https://example.com/', 'http://1.1.1.1/']:
    row = {'destination': url, 'http_status': None, 'transport_error': False}
    try:
        with urllib.request.urlopen(url, timeout=5) as response: row['http_status'] = response.status
    except urllib.error.HTTPError as error: row['http_status'] = error.code
    except Exception: row['transport_error'] = True
    observations.append(row)
print(json.dumps({'egress_observation_version': 2, 'http_attempts': observations, 'dns_over_tcp_attempt': probe_dns_over_tcp(), 'dns_exfiltration_tested': False}))
`;

export const TRUSTED_EGRESS = String.raw`
const observations = [];
for (const url of ['http://m0-control.invalid/health', 'http://m0-control.invalid/billing/credit', 'https://example.com/']) {
  const row = { destination: url, http_status: null, transport_error: false };
  try { const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'manual' }); row.http_status = response.status; await response.body?.cancel(); }
  catch { row.transport_error = true; }
  observations.push(row);
}
console.log(JSON.stringify({ http_attempts: observations }));
`;
