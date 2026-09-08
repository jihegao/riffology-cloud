import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sourceSnapshot } from '../m0/source-inventory.mjs';

// Native-kernel evidence only: no Docker, UID 10001, SDK or Cloudflare claim.
const runId = 'm3-network-fence-native-' + new Date().toISOString().replace(/[^0-9]/g, '');
const directory = resolve('docs/evidence/runs', runId);
mkdirSync(directory, { recursive: true });
const before = sourceSnapshot(process.cwd());
const moduleSource = readFileSync('services/project-tools/project_network_fence.py', 'utf8');
const facts = { schemaVersion: 1, runId, environment: 'ssh-AMD128-native-kernel', modelCalls: 0, cloudGatePassed: false, dockerValidated: false, projectUidValidated: false, sandboxSdkValidated: false, sourceBefore: before.sha256, passed: false };
const program = `FENCE_SOURCE = ${JSON.stringify(moduleSource)}\n` + String.raw`
import ctypes, errno, http.client, json, os, pathlib, platform, signal, socket, subprocess, sys, tempfile, traceback
assert sys.platform == 'linux' and platform.machine() == 'x86_64'
assert os.getuid() != 0, 'must-not-run-as-root'
namespace = {}; exec(compile(FENCE_SOURCE, '<in-memory-project-network-fence>', 'exec'), namespace)

def timeout(*args): raise TimeoutError('native-fence-probe-timeout')
signal.signal(signal.SIGALRM, timeout); signal.alarm(25)
pid = None; sockets = []; read_fd = write_fd = None

def receive_line(stream):
    line = stream.readline(65537)
    assert line and len(line) <= 65536, 'missing-or-oversized-child-result'
    message = json.loads(line)
    assert 'error' not in message, message
    return message

try:
    with tempfile.TemporaryDirectory(prefix='riffology-network-fence-') as temporary:
        ipv4 = socket.socket(); ipv4.bind(('127.0.0.1', 0)); ipv4.listen(); ipv4.settimeout(8); sockets.append(ipv4)
        ipv6 = socket.socket(socket.AF_INET6); ipv6.bind(('::1', 0)); ipv6.listen(); sockets.append(ipv6)
        unix = socket.socket(socket.AF_UNIX); unix_path = temporary + '/probe.sock'; unix.bind(unix_path); unix.listen(); sockets.append(unix)
        targets = [(socket.AF_INET, ipv4.getsockname()), (socket.AF_INET6, ipv6.getsockname()), (socket.AF_UNIX, unix_path)]
        read_fd, write_fd = os.pipe()
        pid = os.fork()
        if pid == 0:
            os.close(read_fd); os.setsid()
            for listener in sockets: listener.close()
            def report(value):
                data = (json.dumps(value) + '\n').encode()
                assert len(data) < 4096
                assert os.write(write_fd, data) == len(data)
            try:
                baseline = socket.socket(); baseline.settimeout(5); baseline.connect(targets[0][1]); baseline.sendall(b'baseline'); baseline.close()
                namespace['install']()
                denied = []
                for family, address in targets:
                    connection = socket.socket(family)
                    try:
                        connection.connect(address)
                        raise AssertionError('connect-unexpectedly-allowed')
                    except OSError as error:
                        assert error.errno == errno.EPERM, repr(error)
                        denied.append(family.name)
                    finally: connection.close()
                lib = ctypes.CDLL('libseccomp.so.2')
                lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
                lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
                libc = ctypes.CDLL(None, use_errno=True); libc.syscall.restype = ctypes.c_long
                uring = []
                for name in ['io_uring_setup', 'io_uring_enter', 'io_uring_register']:
                    number = lib.seccomp_syscall_resolve_name(name.encode()); assert number >= 0
                    ctypes.set_errno(0)
                    result = libc.syscall(ctypes.c_long(number), ctypes.c_long(-1), ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0))
                    assert result == -1 and ctypes.get_errno() == errno.EPERM, name
                    uring.append(name)
                # A fresh interpreter reached through fork/exec inherits both NNP and BPF.
                child_code = "import socket,errno,pathlib; s=socket.socket(); assert s.connect_ex(('127.0.0.1'," + str(targets[0][1][1]) + "))==errno.EPERM; assert 'NoNewPrivs:\\t1' in pathlib.Path('/proc/self/status').read_text(); print('inherited')"
                descendant = subprocess.run([sys.executable, '-B', '-c', child_code], capture_output=True, text=True, timeout=5, close_fds=True)
                assert descendant.returncode == 0 and descendant.stdout.strip() == 'inherited', descendant.stderr
                http_server = socket.socket(); http_server.bind(('127.0.0.1', 0)); http_server.listen(); http_server.settimeout(5)
                report({'stage': 'listening-after-fence', 'port': http_server.getsockname()[1]})
                accepted, _ = http_server.accept()
                accepted.settimeout(5)
                request = b''
                while b'\r\n\r\n' not in request:
                    chunk = accepted.recv(1024); assert chunk; request += chunk; assert len(request) <= 4096
                assert request.startswith(b'GET /health HTTP/1.1\r\n')
                accepted.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok')
                accepted.close(); http_server.close()
                report({'stage': 'complete', 'connectDenied': denied, 'ioUringDenied': uring, 'forkExecInherited': True, 'listenAcceptResponseAfterFence': True})
                os.close(write_fd); os._exit(0)
            except BaseException:
                report({'error': traceback.format_exc()}); os._exit(1)
        os.close(write_fd); write_fd = None
        accepted, _ = ipv4.accept()
        with accepted:
            accepted.settimeout(5); assert accepted.recv(32) == b'baseline'
        with os.fdopen(read_fd, 'r') as stream:
            read_fd = None
            ready = receive_line(stream); assert ready['stage'] == 'listening-after-fence'
            connection = http.client.HTTPConnection('127.0.0.1', ready['port'], timeout=5)
            try:
                connection.request('GET', '/health'); response = connection.getresponse()
                assert response.status == 200 and response.read(3) == b'ok'
            finally: connection.close()
            completed = receive_line(stream); assert completed['stage'] == 'complete'
        _, status = os.waitpid(pid, 0); assert status == 0, status
        pid = None
        for listener in sockets: listener.close()
    assert not pathlib.Path(temporary).exists(), 'temporary-socket-directory-remains'
    print(json.dumps({'passed': True, 'machine': platform.machine(), 'kernel': platform.release(), 'uid': os.getuid(), 'baselineIpv4Connect': True, 'temporaryDirectoryRemoved': True, **completed}))
finally:
    signal.alarm(0)
    if pid is not None:
        # Only this probe's child group; never inspect/kill unrelated remote processes.
        try: os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            try: os.kill(pid, signal.SIGKILL)
            except ProcessLookupError: pass
        try: os.waitpid(pid, 0)
        except ChildProcessError: pass
    for listener in sockets: listener.close()
    for fd in [read_fd, write_fd]:
        if fd is not None:
            try: os.close(fd)
            except OSError: pass
`;
try {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', 'AMD128', 'python3', '-B', '-'], { input: program, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
  writeFileSync(resolve(directory, 'ssh-output.json'), JSON.stringify({ status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }, null, 2) + '\n', { flag: 'wx' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  facts.native = JSON.parse(result.stdout.trim());
  assert.equal(facts.native.passed, true);
  assert.equal(facts.native.baselineIpv4Connect, true);
  assert.deepEqual(facts.native.connectDenied, ['AF_INET', 'AF_INET6', 'AF_UNIX']);
  assert.deepEqual(facts.native.ioUringDenied, ['io_uring_setup', 'io_uring_enter', 'io_uring_register']);
  assert.equal(facts.native.forkExecInherited, true);
  assert.equal(facts.native.listenAcceptResponseAfterFence, true);
  assert.equal(facts.native.temporaryDirectoryRemoved, true);
  facts.passed = true;
} catch (error) {
  facts.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  facts.sourceAfter = sourceSnapshot(process.cwd()).sha256;
  facts.sourceStableDuringCheck = facts.sourceBefore === facts.sourceAfter;
  if (!facts.sourceStableDuringCheck) { facts.passed = false; process.exitCode = 1; }
  writeFileSync(resolve(directory, 'native-network-fence.json'), JSON.stringify(facts, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ runId, passed: facts.passed, sourceStableDuringCheck: facts.sourceStableDuringCheck, cloudGatePassed: false }));
}
