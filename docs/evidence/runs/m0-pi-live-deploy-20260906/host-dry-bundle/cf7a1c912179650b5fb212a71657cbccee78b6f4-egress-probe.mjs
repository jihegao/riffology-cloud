import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const PROXY = 'https://riffology-m0-model-proxy-go-live-staging.jihe-gao.workers.dev';
const WHEEL = Object.freeze({ filename: 'simpy-4.1.1-py3-none-any.whl', bytes: 27224,
  url: 'https://files.pythonhosted.org/packages/48/72/920ed1224c94a8a5a69e6c1275ac7fe4eb911ba8feffddf469f1629d47f3/simpy-4.1.1-py3-none-any.whl',
  sha256: '7c5ae380240fd2238671160e4830956f8055830a8317edf5c05e495b3823cd88' });
const INVALID_CAP = `Bearer m0p.go-live-g0-20260906.${'0'.repeat(64)}.${'0'.repeat(64)}`;
const SECRET_NAMES = ['M0_GO_API_KEY', 'M0_PROBE_TOKEN', 'M0_PI_LIVE_PROBE_TOKEN', 'M0_MODEL_PROXY_OPERATOR_TOKEN', 'MODEL_PROXY', 'CHECKPOINTS', 'CLOUDFLARE_API_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENCODE_API_KEY'];
const ITEM_MS = 4000, TOTAL_MS = 35000;
const hash = value => createHash('sha256').update(value).digest('hex');
const nativeFetch = globalThis.fetch;
const reject = code => { throw new Error(code); };
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
function category(error) {
  const codes = [], queue = [error];
  for (let index = 0; index < queue.length && index < 16; index++) {
    const value = queue[index]; if (!value || typeof value !== 'object') continue;
    if (typeof value.code === 'string') codes.push(value.code);
    if (value.cause) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors.slice(0, 8));
  }
  if (codes.some(code => typeof code === 'string' && /CERT|TLS|SSL|UNABLE_TO_VERIFY|SELF_SIGNED/.test(code))) return 'tls-unconfirmed';
  if (codes.length && codes.every(code => ['EPERM', 'EACCES'].includes(code))) return 'os-permission-denied';
  if (codes.length && codes.every(code => ['ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED'].includes(code))) return 'transport-unreachable';
  if (error?.name === 'AbortError' || codes.includes('ETIMEDOUT')) return 'timeout-unconfirmed';
  return 'transport-unconfirmed';
}
function bounded(operation, signal, ms = ITEM_MS) {
  const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal]);
  let timer, listener;
  const stopped = new Promise((_, fail) => {
    listener = () => fail(new DOMException('Fixed diagnostic deadline', 'AbortError'));
    combined.addEventListener('abort', listener, { once: true });
    if (combined.aborted) listener();
    timer = setTimeout(() => controller.abort(), ms);
  });
  return Promise.race([Promise.resolve().then(() => { combined.throwIfAborted(); return operation(combined); }), stopped])
    .finally(() => { clearTimeout(timer); combined.removeEventListener('abort', listener); controller.abort(); });
}

// Fixed child program: never accepts a hostname, server, port or arbitrary code.
// Default platform DNS is an explicit exception, separate from external DNS.
const NETWORK_PROGRAM = `
const dns=require('node:dns'),net=require('node:net');
const id=process.argv[1];let socket,resolver,done=false;
function finish(status,category){if(done)return;done=true;socket?.destroy();resolver?.cancel();process.stdout.write(JSON.stringify({status,category})+'\\n',()=>process.exit(0));}
function error(e){finish('unconfirmed',['EPERM','EACCES'].includes(e?.code)?'os-permission-denied':['ENETUNREACH','EHOSTUNREACH','ECONNREFUSED'].includes(e?.code)?'transport-unreachable':'transport-unconfirmed');}
setTimeout(()=>finish('unconfirmed','timeout-unconfirmed'),3400);
if(id==='external-dns'){resolver=new dns.Resolver({timeout:3000,tries:1});resolver.setServers(['8.8.8.8']);resolver.resolve4('example.com',(e,a)=>e?error(e):finish(a.length?'reachable':'unconfirmed',a.length?'external-dns-resolved':'transport-unconfirmed'));}
else if(id==='non-http-port'){socket=net.connect({host:'1.1.1.1',port:8443});socket.once('connect',()=>finish('reachable','tcp-connected'));socket.once('error',error);}
else if(id==='platform-resolver'){dns.lookup('example.com',(e,a)=>e?error(e):finish(a?'resolved':'unconfirmed',a?'platform-resolver-exception':'transport-unconfirmed'));}
else finish('unconfirmed','invalid-fixed-probe');
`;

/** Only used with internally constructed command/argv. No shell; no inherited
 * model/operator credentials. SIGKILL is attempted on this owned process group
 * on cancellation. The supervisor still owns final VM/process cleanup. */
function execute({ command, args, cwd, signal }) {
  return new Promise(resolveResult => {
    let child, ended = false, stdout = '', outputBytes = 0, timedOut = false, errorSeen = false;
    const env = { PIP_CONFIG_FILE: '/dev/null', PIP_NO_INDEX: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONNOUSERSITE: '1' };
    for (const name of ['PATH', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) if (process.env[name] !== undefined) env[name] = process.env[name];
    const kill = () => { timedOut = true; if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } } };
    const finish = (exitCode, exitSignal) => {
      if (ended) return; ended = true; clearTimeout(timer); signal.removeEventListener('abort', kill);
      resolveResult({ exitCode, signal: exitSignal, timedOut, errorSeen, stdout, outputBytes });
    };
    const timer = setTimeout(() => { kill(); finish(null, null); }, 3900);
    signal.addEventListener('abort', kill, { once: true });
    if (signal.aborted) { kill(); finish(null, null); return; }
    try {
      child = spawn(command, args, { cwd, env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const read = (chunk, keep) => { outputBytes += chunk.length; if (outputBytes > 4096) { errorSeen = true; kill(); } else if (keep) stdout += chunk.toString('utf8'); };
      child.stdout.on('data', chunk => read(chunk, true)); child.stderr.on('data', chunk => read(chunk, false));
      child.once('error', () => { errorSeen = true; }); child.once('close', finish);
    } catch { errorSeen = true; finish(null, null); }
  });
}

function httpCases(role) {
  const fixedHeaders = { authorization: INVALID_CAP, 'content-type': 'application/json' };
  const cases = role === 'trusted' ? [
    ['trusted-management', PROXY + '/probe/go-live-g0-20260906/status', 'GET', fixedHeaders],
    ['trusted-top-up', PROXY + '/billing/top-up', 'POST', fixedHeaders, '{}'],
    ['trusted-price-change', PROXY + '/billing/prices', 'POST', fixedHeaders, '{}'],
    ['trusted-settlement', PROXY + '/billing/settle', 'POST', fixedHeaders, '{}'],
    ['trusted-path-change', PROXY + '/v1/chat/completions/other', 'POST', fixedHeaders, '{}'],
    ['trusted-query-change', PROXY + '/v1/chat/completions?route=other', 'POST', fixedHeaders, '{}'],
    ['trusted-address-header', PROXY + '/v1/chat/completions', 'POST', { ...fixedHeaders, 'x-upstream-url': 'https://example.com/' }, '{}'],
    ['trusted-address-body', PROXY + '/v1/chat/completions', 'POST', fixedHeaders, '{"url":"https://example.com/"}'],
    ['trusted-method-change', PROXY + '/v1/chat/completions', 'GET', fixedHeaders],
  ] : [
    ['project-wheel-path-change', WHEEL.url + '.other', 'GET'],
    ['project-wheel-query-change', WHEEL.url + '?route=other', 'GET'],
    ['project-wheel-header-change', WHEEL.url, 'GET', { 'x-upstream-url': 'https://example.com/' }],
    ['project-wheel-post', WHEEL.url, 'POST', { 'content-type': 'application/json' }, '{}'],
  ];
  return cases.map(([id, url, method, headers, body]) => ({ id, url, method, headers, body, expect: 'handler-denial' })).concat([
    { id: 'arbitrary-domain', url: 'https://example.com/', expect: 'network-observation' },
    { id: 'direct-go', url: 'https://opencode.ai/zen/go/v1/models', expect: 'network-observation' },
    { id: 'metadata-ip', url: 'http://169.254.169.254/latest/meta-data/', expect: 'network-observation' },
    ...(role === 'project' ? [
      { id: 'project-top-up', url: PROXY + '/billing/top-up', method: 'POST', body: '{}', expect: 'network-observation' },
      { id: 'project-price-change', url: PROXY + '/billing/prices', method: 'POST', body: '{}', expect: 'network-observation' },
      { id: 'project-settlement', url: PROXY + '/billing/settle', method: 'POST', body: '{}', expect: 'network-observation' },
      { id: 'project-model-proxy', url: PROXY + '/probe/go-live-g0-20260906/status', expect: 'network-observation' },
      { id: 'project-wheel', url: WHEEL.url, expect: 'wheel' }] : []),
  ]);
}

/** Fixed G0-T09 VM diagnostic. Output contains no response/error text, URLs,
 * credentials or command stdout. Native execution is cloud-network evidence;
 * injection requires BOTH dependencies and is always offline-injected. A
 * timeout/unreachable result is not attributed to the egress policy. */
export async function runEgressProbe(input, options = {}) {
  const start = Date.now();
  if (!fields(input, ['role', 'outputDirectory']) || !['trusted', 'project'].includes(input.role)
    || typeof input.outputDirectory !== 'string' || !isAbsolute(input.outputDirectory) || resolve(input.outputDirectory) === '/'
    || !fields(options, ['transport', 'exec']) || (typeof options.transport === 'function') !== (typeof options.exec === 'function')
    || options.transport !== undefined && typeof options.transport !== 'function' || options.exec !== undefined && typeof options.exec !== 'function') reject('invalid-fixed-egress-input');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') reject('tls-verification-required');
  await mkdir(input.outputDirectory, { recursive: true, mode: 0o700 });
  const info = await lstat(input.outputDirectory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(input.outputDirectory) !== resolve(input.outputDirectory)) reject('canonical-egress-directory-required');
  const directory = await mkdtemp(join(input.outputDirectory, 'fixed-egress-'));
  const total = new AbortController(), timer = setTimeout(() => total.abort(), Math.max(1, TOTAL_MS - (Date.now() - start)));
  const transport = options.transport ?? nativeFetch, exec = options.exec ?? execute;
  const rows = [], secretPresence = Object.fromEntries(SECRET_NAMES.map(name => [name, Object.hasOwn(process.env, name)]));
  let wheel = null, peakConcurrency = 0, active = 0, cleanupConfirmed = false;
  async function httpProbe(item) {
    let status = null;
    try {
      return await bounded(async signal => {
        const request = new Request(item.url, { method: item.method ?? 'GET', headers: item.headers, body: item.body, redirect: 'manual', signal });
        const pending = Promise.resolve().then(() => transport(request));
        void pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
        const response = await pending; status = response.status;
        let reader;
        try {
          if (response.redirected || response.url && response.url !== item.url || status >= 300 && status < 400 || response.headers.has('location')) return { category: 'redirect-unconfirmed' };
          reader = response.body?.getReader(); const chunks = []; let count = 0, reads = 0;
          if (!reader) return { category: 'empty-response-unconfirmed' };
          const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
          try {
            while (true) {
              signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
              if (part.done) break;
              count += part.value.byteLength;
              if (++reads > 1024 || count > (item.expect === 'wheel' ? WHEEL.bytes : 2048)) return { category: 'response-limit-unconfirmed' };
              chunks.push(part.value);
            }
          } finally { signal.removeEventListener('abort', abort); }
          const content = Buffer.concat(chunks), tag = response.headers.get('x-riffology-m0-egress') === 'fixed-v1';
          if (item.expect === 'wheel') {
            const verified = status === 200 && tag && count === WHEEL.bytes && hash(content) === WHEEL.sha256;
            if (verified) wheel = content;
            return { category: verified ? 'pinned-wheel-verified' : 'wheel-integrity-unconfirmed', wheelBytesVerified: count === WHEEL.bytes, wheelSha256Verified: hash(content) === WHEEL.sha256 };
          }
          let denied = false; try { denied = JSON.parse(content.toString('utf8')).error === 'egress-policy-denied'; } catch {}
          if (item.expect === 'network-observation' && status === 520 && content.equals(Buffer.from('Origin is disallowed'))) return { category: 'sdk-host-policy-denied' };
          return { category: status === 403 && tag && denied ? 'policy-denied' : status === 502 && tag ? 'upstream-unconfirmed' : 'http-response-unattributed' };
        } finally { if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); } else void response.body?.cancel().catch(() => {}); }
      }, total.signal).then(result => ({ ...result, status }));
    } catch (error) { return { status, category: category(error) }; }
  }
  async function processProbe(id, command, args) {
    try {
      const result = await bounded(signal => exec({ probeId: id, command, args, cwd: directory, signal, timeoutMs: ITEM_MS }), total.signal);
      if (result.exitCode !== 0 || result.signal !== null && result.signal !== undefined || result.timedOut || result.errorSeen
        || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > 4096) return { status: 'unconfirmed', category: result.timedOut ? 'timeout-unconfirmed' : 'execution-unconfirmed' };
      const value = JSON.parse(result.stdout);
      const allowed = ['os-permission-denied', 'transport-unreachable', 'transport-unconfirmed', 'timeout-unconfirmed', 'external-dns-resolved', 'tcp-connected', 'platform-resolver-exception', 'installed-pinned-simpy'];
      if (!allowed.includes(value.category) || !['unconfirmed', 'reachable', 'resolved', 'installed'].includes(value.status)) return { status: 'unconfirmed', category: 'execution-unconfirmed' };
      return { status: value.status, category: value.category };
    } catch (error) { return { status: 'unconfirmed', category: category(error) }; }
  }
  try {
    const tasks = httpCases(input.role).map(item => ({ id: item.id, expect: item.expect, run: () => httpProbe(item) }));
    for (const id of ['external-dns', 'non-http-port', 'platform-resolver']) tasks.push({ id, expect: id === 'platform-resolver' ? 'platform-exception' : 'supplementary-network', run: () => processProbe(id, process.execPath, ['-e', NETWORK_PROGRAM, id]) });
    let index = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (index < tasks.length) {
        const task = tasks[index++]; active++; peakConcurrency = Math.max(peakConcurrency, active);
        try { rows.push({ id: task.id, expect: task.expect, ...await task.run() }); } finally { active--; }
      }
    }));
    if (input.role === 'project') {
      if (!wheel) rows.push({ id: 'project-install-import', expect: 'installation', status: 'not-run', category: 'verified-wheel-required' });
      else {
        const filename = join(directory, WHEEL.filename), target = join(directory, 'package');
        await writeFile(filename, wheel, { flag: 'wx', mode: 0o600 });
        const install = await bounded(signal => exec({ probeId: 'project-install', command: '/usr/local/bin/python3', cwd: directory, signal, timeoutMs: ITEM_MS,
          args: ['-m', 'pip', '--isolated', 'install', '--no-index', '--no-deps', '--disable-pip-version-check', '--no-cache-dir', '--quiet', '--target', target, filename] }), total.signal);
        if (install.exitCode !== 0 || install.timedOut || install.errorSeen || install.signal) rows.push({ id: 'project-install-import', expect: 'installation', status: 'unconfirmed', category: 'installation-unconfirmed' });
        else rows.push({ id: 'project-install-import', expect: 'installation', ...await processProbe('project-import', '/usr/local/bin/python3', ['-I', '-c',
          "import sys,pathlib,json; sys.path.insert(0,sys.argv[1]); import simpy; assert simpy.__version__=='4.1.1'; assert pathlib.Path(simpy.__file__).resolve().is_relative_to(pathlib.Path(sys.argv[1]).resolve()); print(json.dumps({'status':'installed','category':'installed-pinned-simpy'}))", target]) });
      }
    }
  } catch { rows.push({ id: 'overall', expect: 'completion', status: 'unconfirmed', category: 'overall-unconfirmed' }); }
  finally {
    clearTimeout(timer); total.abort();
    try {
      await bounded(() => rm(directory, { recursive: true }), new AbortController().signal, Math.max(1, Math.min(2000, TOTAL_MS - (Date.now() - start))));
      cleanupConfirmed = true;
    } catch {}
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const httpRows = rows.filter(row => ['handler-denial', 'network-observation', 'wheel'].includes(row.expect));
  const requiredHttpBoundaryPassed = httpRows.length === httpCases(input.role).length && httpRows.every(row => row.expect === 'handler-denial'
    ? row.category === 'policy-denied' : row.expect === 'wheel' ? row.category === 'pinned-wheel-verified'
      : ['policy-denied', 'sdk-host-policy-denied'].includes(row.category));
  const supplementary = rows.filter(row => row.expect === 'supplementary-network');
  const supplementaryNetworkConfirmed = supplementary.length === 2 && supplementary.every(row => row.category === 'os-permission-denied');
  const supplementaryNetworkReachable = supplementary.some(row => row.status === 'reachable' || ['external-dns-resolved', 'tcp-connected'].includes(row.category));
  const dependencyInstallationPassed = input.role === 'trusted' || rows.some(row => row.id === 'project-install-import' && row.category === 'installed-pinned-simpy');
  return { schemaVersion: 1, operation: 'G0-T09-fixed-egress', role: input.role, evidenceMode: options.transport ? 'offline-injected' : 'cloud-network',
    passed: requiredHttpBoundaryPassed && dependencyInstallationPassed && !supplementaryNetworkReachable && !rows.some(row => row.id === 'overall')
      && cleanupConfirmed && !Object.values(secretPresence).some(Boolean) && Date.now() - start <= TOTAL_MS,
    requiredHttpBoundaryPassed, dependencyInstallationPassed, supplementaryNetworkConfirmed, supplementaryNetworkReachable,
    rows, secretPresence, tlsVerificationEnabled: true, realProviderCalls: 0, maxConcurrency: 4, peakConcurrency, perItemTimeoutMs: ITEM_MS,
    totalTimeoutMs: TOTAL_MS, elapsedMs: Date.now() - start, cleanupConfirmed, gateReviewRequired: true,
    networkPolicyAttribution: 'Tagged 403 proves the fixed handler; exact SDK 520 proves host rejection. Supplementary DNS/TCP errors remain unconfirmed and do not replace HTTP proof; a reachable result fails the boundary.',
    platformResolverException: true };
}
