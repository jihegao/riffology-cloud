import { ContainerProxy, getSandbox, Sandbox, type ExecResult } from '@cloudflare/sandbox';
import { PROJECT_EGRESS, PROJECT_ISOLATION, TRUSTED_EGRESS, TRUSTED_SERVICE, TRUSTED_SIGNAL_CONTROL, TRUSTED_HEALTH_CHECK } from './runtime.ts';
import { boundarySandboxId } from './auth.ts';
import { handleProbeRequest, type ProbeOperations } from './worker.ts';

export { ContainerProxy };
export interface Env extends M0BoundaryEnv {
  /** Operator-supplied evidence label; never inferred from successful execution. */
  M0_EXECUTION_ENVIRONMENT?: 'local-docker-workerd' | 'cloudflare-vm';
}

// These are distinct Container applications / DO namespaces in Wrangler config.
// SDK sessions inside one VM are deliberately NOT used as security boundaries.
export class TrustedSandbox extends Sandbox<Env> {
  override enableInternet = false;
  override allowedHosts = ['m0-control.invalid'];
  override sleepAfter = '60s';
  override envVars = {};
}
export class ProjectSandbox extends Sandbox<Env> {
  override enableInternet = false;
  override allowedHosts: string[] = [];
  override sleepAfter = '60s';
  override envVars = {};
}

TrustedSandbox.outbound = async request => {
  const url = new URL(request.url);
  // A synthetic positive control, not a model proxy or privileged Tool Bridge.
  if (url.hostname === 'm0-control.invalid' && url.pathname === '/health' && !url.search && request.method === 'GET') {
    return Response.json({ synthetic: true, service: 'm0-outbound-positive-control' }, { headers: { 'cache-control': 'no-store' } });
  }
  return new Response('M0 policy denied', { status: 403 });
};
ProjectSandbox.outbound = async () => new Response('M0 policy denied', { status: 403 });

function sandboxSet(env: Env, runId: string) {
  const options = { normalizeId: true, enableDefaultSession: false, keepAlive: false, sleepAfter: '60s' } as const;
  return {
    trusted: getSandbox(env.TrustedSandbox, boundarySandboxId(runId, 'trusted'), options),
    alpha: getSandbox(env.ProjectSandbox, boundarySandboxId(runId, 'alpha'), options),
    bravo: getSandbox(env.ProjectSandbox, boundarySandboxId(runId, 'bravo'), options),
  };
}
type ProbeSandbox = TrustedSandbox | ProjectSandbox;
type ProbePhase = 'probe_start' | 'trusted_files_setup' | 'trusted_permissions' | 'trusted_runtime_files'
  | 'trusted_session_create' | 'project_session_create' | 'trusted_process_start' | 'trusted_port_wait'
  | 'signal_positive_control_exec' | 'trusted_state_before' | 'signal_positive_control_verify'
  | 'project_target_setup' | 'project_probe_exec' | 'trusted_independent_readback' | 'report_assembly';
type ProbeErrorCode = 'runtime_operation_failed' | 'command_unsuccessful' | 'command_output_too_large'
  | 'command_output_invalid_json' | 'trusted_state_unavailable' | 'trusted_state_invalid'
  | 'trusted_permissions_failed' | 'signal_positive_control_failed';
const SIGNAL_OUTCOMES = ['signal_sent', 'target_not_addressable', 'capability_unavailable', 'target_exited', 'permission_denied'] as const;
type SignalDiagnostic = {
  exec_success: boolean; exit_code: number | null; attempted: boolean | null; identity_matched: boolean | null;
  outcome: typeof SIGNAL_OUTCOMES[number] | 'unreported' | 'invalid';
  observed_signal_count: number | null; instance_nonce_matches: boolean | null;
};
type ProbeProgress = { phase: ProbePhase; signal_positive_control?: SignalDiagnostic };
class ProbeOperationError extends Error {
  readonly code: ProbeErrorCode;
  constructor(code: ProbeErrorCode) { super(code); this.code = code; }
}
function signalDiagnostic(result: ExecResult): SignalDiagnostic {
  return { exec_success: result.success === true,
    exit_code: Number.isSafeInteger(result.exitCode) && Math.abs(result.exitCode) <= 65536 ? result.exitCode : null,
    attempted: null, identity_matched: null, outcome: 'unreported', observed_signal_count: null, instance_nonce_matches: null };
}
function addSignalObservation(diagnostic: SignalDiagnostic, value: unknown): void {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  diagnostic.attempted = typeof record.attempted === 'boolean' ? record.attempted : null;
  diagnostic.identity_matched = typeof record.identity_matched === 'boolean' ? record.identity_matched : null;
  diagnostic.outcome = SIGNAL_OUTCOMES.find(outcome => outcome === record.outcome) ?? 'invalid';
}
async function cleanupSandboxes(sandboxes: Record<string, ProbeSandbox>): Promise<Record<string, string>> {
  const results = await Promise.all(Object.entries(sandboxes).map(async ([name, sandbox]) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([sandbox.destroy(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('CleanupTimeout')), 15000); })]);
      return [name, 'destroy_acknowledged'];
    } catch { return [name, 'cleanup_not_confirmed']; }
    finally { clearTimeout(timeout); }
  }));
  return Object.fromEntries(results);
}
async function runWithCleanup(runId: string, operation: string, sandboxes: Record<string, ProbeSandbox>, probe: (progress: ProbeProgress) => Promise<unknown>): Promise<unknown> {
  let observations: unknown;
  let status = 'observations_collected';
  const progress: ProbeProgress = { phase: 'probe_start' };
  try { observations = await probe(progress); }
  catch (error) {
    status = 'probe_error';
    // Only locally constructed enums and projected primitive diagnostics leave
    // this catch. Never expose SDK errors, command output or environment values.
    observations = { error: error instanceof ProbeOperationError ? error.code : 'runtime_operation_failed',
      phase: progress.phase, ...(progress.signal_positive_control ? { signal_positive_control: progress.signal_positive_control } : {}) };
  }
  const cleanup = await cleanupSandboxes(sandboxes);
  if (Object.values(cleanup).some(value => value !== 'destroy_acknowledged')) status = 'cleanup_incomplete';
  return { schema_version: 1, protocol: 'm0-v1', run_id: runId, operation, observed_at: new Date().toISOString(), status, gate_decision: 'not_evaluated', observations, cleanup };
}
function fixedJsonOutput(result: ExecResult): unknown {
  if (!result.success || result.exitCode !== 0) throw new ProbeOperationError('command_unsuccessful');
  if (result.stdout.length > 16384) throw new ProbeOperationError('command_output_too_large');
  try { return JSON.parse(result.stdout.trim()); }
  catch { throw new ProbeOperationError('command_output_invalid_json'); }
}
async function sha256(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
}

type ServiceState = { schema_version: 2; instance_nonce: string; pid: number; pid_namespace: string | null; start_ticks: string | null;
  boot_id_sha256: string;
  service_script: string; port: number; signal_count: number; control_mutation_count: number; ready: boolean };
async function serviceState(sandbox: ProbeSandbox): Promise<ServiceState> {
  const file = await sandbox.readFile('/opt/m0-trusted/service-state.json', { encoding: 'utf-8' });
  if (!file.success || file.content.length > 4096) throw new ProbeOperationError('trusted_state_unavailable');
  let state: ServiceState;
  try { state = JSON.parse(file.content) as ServiceState; }
  catch { throw new ProbeOperationError('trusted_state_invalid'); }
  if (!state || state.schema_version !== 2 || !/^[a-f0-9]{32}$/.test(state.instance_nonce) || !Number.isSafeInteger(state.pid) || state.pid <= 1
    || !/^[a-f0-9]{64}$/.test(state.boot_id_sha256 ?? '')
    || state.service_script !== '/tmp/m0-trusted-service.mjs' || state.port !== 41239 || state.ready !== true
    || !Number.isSafeInteger(state.signal_count) || state.signal_count < 0
    || !Number.isSafeInteger(state.control_mutation_count) || state.control_mutation_count < 0) throw new ProbeOperationError('trusted_state_invalid');
  return state;
}

function operations(env: Env): ProbeOperations {
  return {
    async isolation(runId) {
      const { trusted, alpha } = sandboxSet(env, runId);
      return runWithCleanup(runId, 'G0-T02', { trusted, alpha }, async progress => {
        const canary = `M0_TRUSTED_NON_SECRET_${crypto.randomUUID()}`;
        const session = JSON.stringify({ synthetic_session: true, marker: canary });
        const instanceNonce = crypto.randomUUID().replaceAll('-', '');
        const positiveMarker = `M0_POSITIVE_${crypto.randomUUID().replaceAll('-', '')}`;
        const attackMarker = `M0_ATTACK_${crypto.randomUUID().replaceAll('-', '')}`;
        const trustedProcessId = `m0-t02-${instanceNonce}`;
        const trustedSessionId = `m0-t02-t-${instanceNonce}`;
        const projectSessionId = `m0-t02-p-${instanceNonce}`;
        progress.phase = 'trusted_files_setup';
        await trusted.mkdir('/opt/m0-trusted', { recursive: true });
        await trusted.writeFile('/opt/m0-trusted/canary.txt', canary);
        await trusted.writeFile('/opt/m0-trusted/session.json', session);
        await trusted.writeFile('/workspace/m0-t02-cross-scope.txt', canary);
        await trusted.writeFile('/workspace/m0-t02-foreign-session.txt', canary);
        progress.phase = 'trusted_permissions';
        const permissions = await trusted.exec('chmod 700 /opt/m0-trusted && chmod 600 /opt/m0-trusted/canary.txt /opt/m0-trusted/session.json', { timeout: 5000 });
        if (!permissions.success) throw new ProbeOperationError('trusted_permissions_failed');
        progress.phase = 'trusted_runtime_files';
        await trusted.writeFile('/tmp/m0-trusted-service.mjs', TRUSTED_SERVICE);
        await trusted.writeFile('/tmp/m0-trusted-signal.mjs', TRUSTED_SIGNAL_CONTROL);
        await trusted.writeFile('/tmp/m0-trusted-health.mjs', TRUSTED_HEALTH_CHECK);
        progress.phase = 'trusted_session_create';
        const trustedShell = await trusted.createSession({ id: trustedSessionId });
        progress.phase = 'project_session_create';
        await alpha.createSession({ id: projectSessionId });
        progress.phase = 'trusted_process_start';
        const process = await trustedShell.startProcess('node /tmp/m0-trusted-service.mjs', {
          processId: trustedProcessId, env: { M0_TRUSTED_CANARY: canary, M0_T02_INSTANCE_NONCE: instanceNonce }, autoCleanup: false,
        });
        progress.phase = 'trusted_port_wait';
        await process.waitForPort(41239, { path: '/health', status: 200, timeout: 15000 });
        progress.phase = 'signal_positive_control_exec';
        const signalResult = await trusted.exec('node /tmp/m0-trusted-signal.mjs', { timeout: 5000 });
        const signalControl = progress.signal_positive_control = signalDiagnostic(signalResult);
        addSignalObservation(signalControl, fixedJsonOutput(signalResult));
        progress.phase = 'trusted_state_before';
        let before = await serviceState(trusted);
        for (let attempt = 0; before.signal_count !== 1 && attempt < 10; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 50)); before = await serviceState(trusted);
        }
        signalControl.observed_signal_count = before.signal_count;
        signalControl.instance_nonce_matches = before.instance_nonce === instanceNonce;
        progress.phase = 'signal_positive_control_verify';
        if (signalControl.attempted !== true || signalControl.outcome !== 'signal_sent' || before.signal_count !== 1 || before.instance_nonce !== instanceNonce) throw new ProbeOperationError('signal_positive_control_failed');
        // Public target identifiers only: canary, Session and Worker token stay trusted.
        progress.phase = 'project_target_setup';
        await alpha.writeFile('/tmp/m0-project-target.json', JSON.stringify({
          pid: before.pid, instance_nonce: instanceNonce, pid_namespace: before.pid_namespace, start_ticks: before.start_ticks, boot_id_sha256: before.boot_id_sha256,
          service_script: before.service_script, project_session_id: projectSessionId, trusted_session_id: trustedSessionId,
          trusted_process_id: trustedProcessId, trusted_sandbox_id: env.TrustedSandbox.idFromName(boundarySandboxId(runId, 'trusted')).toString(),
          project_sandbox_id: env.ProjectSandbox.idFromName(boundarySandboxId(runId, 'alpha')).toString(),
          positive_marker: positiveMarker, attack_marker: attackMarker,
        }));
        await alpha.writeFile('/tmp/m0-project-isolation.py', PROJECT_ISOLATION);
        progress.phase = 'project_probe_exec';
        const projectObservations = fixedJsonOutput(await alpha.exec('python3 /tmp/m0-project-isolation.py', { timeout: 35000 }));
        // Read through the separate trusted VM capability after the project probe.
        // Never decide preservation from the project script's own JSON.
        progress.phase = 'trusted_independent_readback';
        const [fileAfter, sessionAfter, serviceStatus, after, crossScopeAfter, foreignSessionTrustedAfter, attackExists, positiveAfter, forgedAfter, foreignSessionProjectAfter, healthResult] = await Promise.all([
          trusted.readFile('/opt/m0-trusted/canary.txt', { encoding: 'utf-8' }),
          trusted.readFile('/opt/m0-trusted/session.json', { encoding: 'utf-8' }),
          process.getStatus(),
          serviceState(trusted),
          trusted.readFile('/workspace/m0-t02-cross-scope.txt', { encoding: 'utf-8' }),
          trusted.readFile('/workspace/m0-t02-foreign-session.txt', { encoding: 'utf-8' }),
          trusted.exists('/opt/m0-trusted/attack-marker.txt'),
          alpha.readFile('/workspace/m0-t02-sdk-positive.txt', { encoding: 'utf-8' }).catch(() => null),
          alpha.readFile('/workspace/m0-t02-cross-scope.txt', { encoding: 'utf-8' }).catch(() => null),
          alpha.readFile('/workspace/m0-t02-foreign-session.txt', { encoding: 'utf-8' }).catch(() => null),
          trusted.exec('node /tmp/m0-trusted-health.mjs', { timeout: 5000 }),
        ]);
        const health = fixedJsonOutput(healthResult) as { synthetic?: boolean; state?: ServiceState };
        progress.phase = 'report_assembly';
        return {
          isolation_observation_version: 2,
          execution_environment: env.M0_EXECUTION_ENVIRONMENT ?? 'unrecorded',
          topology: 'separate_trusted_and_project_sandbox_instances',
          worker_verified: {
            trusted_canary_unchanged: fileAfter.success && fileAfter.content === canary,
            synthetic_session_unchanged: sessionAfter.success && sessionAfter.content === session,
            trusted_service_status: serviceStatus, trusted_service_running: serviceStatus === 'running',
            expected_canary_sha256: await sha256(canary), signal_positive_control_delivered: before.signal_count === 1,
            trusted_signal_count_before: before.signal_count, trusted_signal_count_after: after.signal_count,
            trusted_signal_count_unchanged: after.signal_count === before.signal_count,
            trusted_control_mutation_count_unchanged: after.control_mutation_count === 0 && before.control_mutation_count === 0,
            trusted_service_instance_unchanged: after.instance_nonce === instanceNonce && after.pid === before.pid && after.start_ticks === before.start_ticks && after.pid_namespace === before.pid_namespace,
            trusted_boot_identity_unchanged: before.boot_id_sha256 === after.boot_id_sha256,
            trusted_boot_id_sha256: before.boot_id_sha256,
            trusted_service_health_matches: health.synthetic === true && health.state?.instance_nonce === instanceNonce && health.state?.pid === before.pid && health.state?.signal_count === before.signal_count && health.state?.control_mutation_count === 0,
            trusted_cross_scope_file_unchanged: crossScopeAfter.success && crossScopeAfter.content === canary
              && foreignSessionTrustedAfter.success && foreignSessionTrustedAfter.content === canary,
            trusted_attack_marker_absent: attackExists.success && attackExists.exists === false,
            project_sdk_positive_control_observed: positiveAfter?.success === true && positiveAfter.content === positiveMarker,
            project_forged_scope_write_confined: forgedAfter?.success === true && forgedAfter.content === attackMarker && crossScopeAfter.content === canary,
            project_foreign_session_write_confined: foreignSessionProjectAfter?.success === true && foreignSessionProjectAfter.content === attackMarker
              && foreignSessionTrustedAfter.success && foreignSessionTrustedAfter.content === canary,
            expected_positive_marker_sha256: await sha256(positiveMarker), expected_attack_marker_sha256: await sha256(attackMarker),
            observed_canary_sha256: fileAfter.success ? await sha256(fileAfter.content) : null,
            observed_cross_scope_sha256: crossScopeAfter.success ? await sha256(crossScopeAfter.content) : null,
            observed_positive_marker_sha256: positiveAfter?.success ? await sha256(positiveAfter.content) : null,
            observed_forged_marker_sha256: forgedAfter?.success ? await sha256(forgedAfter.content) : null,
            observed_foreign_session_marker_sha256: foreignSessionProjectAfter?.success ? await sha256(foreignSessionProjectAfter.content) : null,
          },
          untrusted_project_observations: projectObservations,
          script_sha256: await sha256(PROJECT_ISOLATION),
          limits: ['Synthetic session only; not the Pi restore test.', 'Project output and project SDK state are diagnostic; trusted-VM capability readback is independent.', 'Actual SIGUSR1 positive control and fixed foreign process-ID signal RPC are covered; raw POSIX signals are sent only after exact owned-process identity matching, otherwise target_not_addressable is explicit.', 'A numeric PID is not a cross-VM capability; the probe never guesses PIDs or signals unrelated processes.', 'Fixed localhost SDK requests and one synthetic cross-domain control route do not prove a production Tool Bridge or a compromised SDK daemon secure.', 'Local Docker/Workerd results cannot close the cloud isolation gate.'],
        };
      });
    },
    async tenancy(runId) {
      const { alpha, bravo } = sandboxSet(env, runId);
      return runWithCleanup(runId, 'G0-T04-vm-files', { alpha, bravo }, async () => {
        const expected = { alpha: `M0_ALPHA_NON_SECRET_${crypto.randomUUID()}`, bravo: `M0_BRAVO_NON_SECRET_${crypto.randomUUID()}` };
        await Promise.all([alpha, bravo].map(sandbox => sandbox.mkdir('/workspace/m0', { recursive: true })));
        await Promise.all([alpha.writeFile('/workspace/m0/owner.txt', expected.alpha), bravo.writeFile('/workspace/m0/owner.txt', expected.bravo)]);
        const [alphaRead, bravoRead] = await Promise.all([alpha.readFile('/workspace/m0/owner.txt', { encoding: 'utf-8' }), bravo.readFile('/workspace/m0/owner.txt', { encoding: 'utf-8' })]);
        return { worker_verified: { alpha_content_matches: alphaRead.success && alphaRead.content === expected.alpha, bravo_content_matches: bravoRead.success && bravoRead.content === expected.bravo, contents_differ: alphaRead.content !== bravoRead.content }, limits: ['Scoped capability fixtures are a separate HTTP probe.', 'No production login, service URL, WebSocket or Artifact store is implemented here.'] };
      });
    },
    async egress(runId) {
      const { trusted, alpha } = sandboxSet(env, runId);
      return runWithCleanup(runId, 'G0-T09', { trusted, alpha }, async () => {
        await Promise.all([trusted.writeFile('/tmp/m0-trusted-egress.mjs', TRUSTED_EGRESS), alpha.writeFile('/tmp/m0-project-egress.py', PROJECT_EGRESS)]);
        const [trustedResult, projectResult] = await Promise.all([
          trusted.exec('node /tmp/m0-trusted-egress.mjs', { timeout: 20000 }),
          alpha.exec('python3 /tmp/m0-project-egress.py', { timeout: 30000 }),
        ]);
        return {
          egress_observation_version: 2,
          execution_environment: ['local-docker-workerd', 'cloudflare-vm'].includes(env.M0_EXECUTION_ENVIRONMENT ?? '') ? env.M0_EXECUTION_ENVIRONMENT : 'unrecorded',
          environment_label_source: 'operator_configuration_requires_artifact_confirmation',
          trusted_runtime_observations: fixedJsonOutput(trustedResult),
          untrusted_project_observations: fixedJsonOutput(projectResult),
          worker_policy: { trusted_allowlist: ['m0-control.invalid'], project_allowlist: [], default_internet: false, credentials_injected: false, privileged_routes_implemented: false },
          limits: ['Runtime output does not substitute for independent policy/traffic review.', 'Local Docker/Workerd interception is not cloud VM network evidence.', 'Transport connect alone may be a local proxy accepting the connection; it does not establish application reachability.', 'A matching DNS response, including REFUSED, demonstrates a DNS application response and must not be reported as deny-all passing; it does not authenticate the responder or prove arbitrary internet access.', 'Model proxy and dependency allowlist are not implemented.', 'Only the fixed non-secret example.com DNS-over-TCP query is tested; DNS exfiltration and all protocol variants are not covered.'],
        };
      });
    },
    async cleanup(runId) {
      return { run_id: runId, operation: 'cleanup', gate_decision: 'not_evaluated', cleanup: await cleanupSandboxes(sandboxSet(env, runId)) };
    },
  };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleProbeRequest(request, env, operations(env));
  },
};
