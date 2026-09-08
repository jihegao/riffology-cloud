import {modelContentKey} from '../../services/runtime/content.ts';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { serializeSignedCookie } from 'better-call';
import { createAuth } from '../../services/gateway/auth.ts';
import { SqliteCatalog } from '../../tests/m1/sqlite-database.ts';
import { digest } from '../../services/catalog/contracts.ts';
import { checkpointKey } from '../../services/runtime/core.ts';
import { initialCheckpoint, initialFiles } from '../../services/runtime/starter.ts';
import { sourceSnapshot } from '../m0/source-inventory.mjs';
import { providerDisabledValidationDockerfile, providerDisabledValidationProfile } from './provider-disabled-image.mjs';
import { crudValidationDockerfile, crudValidationProfile } from './crud-validation-image.mjs';
import { crudExpectedFiles } from './crud-validation-fixture.mjs';
const crud=process.argv.slice(2).includes('--crud');
if(process.argv.slice(2).some(arg=>arg!=='--crud'))throw Error('invalid-validation-argument');
const profile=crud?crudValidationProfile:providerDisabledValidationProfile;

const root = process.cwd();
const runId = `m2-product-turn-${crud?"crud-fixture":"provider-disabled"}-${new Date().toISOString().replace(/[^0-9]/g, '')}`;
const evidenceDirectory = resolve('docs/evidence/runs', runId);
const stateDirectory = resolve('.local', runId);
const origin = 'https://m2-product-turn-local.test';
const worker = runId;
const sourceBefore = sourceSnapshot(root);
const suffix = sourceBefore.sha256.slice(0, 12);
const images = {
  runtime: `riffology-m2-runtime:${suffix}`,
  project: `riffology-m2-project-sandbox:${suffix}`,
  trusted: `riffology-m2-trusted-pi-provider-disabled:${suffix}`,
};
const proxyImage = 'cloudflare/proxy-everything@sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8';
const socketPath = process.env.RIFFOLOGY_DOCKER_SOCKET || 'unix:///Users/gaojihe/.colima/default/docker.sock';
if (!/^unix:\/\/\/[^\0]+\/docker\.sock$/.test(socketPath)) throw new Error('invalid-riffology-docker-socket');
const dockerEnv = { ...process.env, DOCKER_HOST: socketPath, DOCKER_CONFIG: resolve('.local/docker-empty') };
const docker = (...args) => execFileSync('/opt/homebrew/bin/docker', args, {
  cwd: root, env: dockerEnv, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
}).trim();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const bounded = async (promise, milliseconds) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('local-acceptance-deadline')), milliseconds); })]); }
  finally { clearTimeout(timer); }
};
const containerFacts = (before) => docker('ps', '-aq').split('\n').filter((id) => id && !before.has(id)).map((id) => {
  const value = JSON.parse(docker('inspect', id))[0];
  return { id, name: value.Name.replace(/^\//, ''), image: value.Config.Image, imageId: value.Image, status: value.State.Status, running: value.State.Running };
});

mkdirSync(evidenceDirectory, { recursive: false, mode: 0o700 });
mkdirSync(stateDirectory, { recursive: false, mode: 0o700 });
const beforeContainers = new Set(docker('ps', '-aq').split('\n').filter(Boolean));
const productDockerfile = readFileSync('Dockerfile.trusted-pi.cloud', 'utf8');
const validationDockerfile = (crud?crudValidationDockerfile:providerDisabledValidationDockerfile)(productDockerfile);
const result = {
  schemaVersion: 1, runId, status: 'running',
  scope: crud?'local Workerd + native Docker + production Pi/ToolBridge/Ledger/Revision; deterministic provider fixture; 20 file mutations plus mkdir setup; Files/Diff and container-loss restore; no cloud or external model call':'local Workerd + native Docker + D1/DO/R2 + production release assembly; provider disabled; container-loss restore and corrupt-base rejection; no cloud or external model call',
  validationProfile: profile,
  sourceBefore,
  images: {},
  observations: [],
  cleanup: [],
  externalWorkerFetches: 0,
};
let mf;
let failure;

try {
  result.dockerEngineMemoryBytes = Number(JSON.parse(docker('info', '--format', '{{json .MemTotal}}')));
  if (!Number.isSafeInteger(result.dockerEngineMemoryBytes) || result.dockerEngineMemoryBytes < 3 * 1024 ** 3) throw Error('local-container-engine-memory-below-3gib');
  docker('build', '--platform', 'linux/amd64', '--progress', 'plain', '--tag', images.runtime, '--file', 'services/runtime/Dockerfile.cloud', 'services/runtime');
  docker('build', '--platform', 'linux/amd64', '--progress', 'plain', '--tag', images.project, '--file', 'services/project-tools/Dockerfile.cloud', 'services/project-tools');
  execFileSync('/opt/homebrew/bin/docker', ['build', '--platform', 'linux/amd64', '--progress', 'plain', '--tag', images.trusted, '--file', '-', '.'], {
    cwd: root, env: dockerEnv, input: validationDockerfile, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
  });
  for (const [role, image] of Object.entries(images)) {
    const inspected = JSON.parse(docker('image', 'inspect', image))[0];
    result.images[role] = { tag: image, id: inspected.Id, os: inspected.Os, architecture: inspected.Architecture, sizeBytes: inspected.Size };
    assert.equal(`${inspected.Os}/${inspected.Architecture}`, 'linux/amd64');
  }
  assert.equal(docker('image', 'inspect', proxyImage, '--format', '{{.Id}}'), 'sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8');
  const activeProfile = docker('image', 'inspect', images.trusted, '--format', '{{index .Config.Labels "cn.gaojihe.riffology.validation-profile"}}');
  assert.equal(activeProfile, profile.name);

  const wrapper = `import gateway from './services/gateway/index.ts';
import {turnRuntimeActorName} from './services/turn-runtime/identity.ts';
export {TenantQuota,WorkspaceAgent,ProjectRuntime,ProductTurnRuntime,RevisionStore,ToolArtifactStore,TenantModelBudget,ProjectToolSandbox,TrustedPiSandbox,ToolBridgeService,ModelProxyService,ContainerProxy} from './services/gateway/index.ts';
import {ToolBridgeAgent as ProductToolBridgeAgent} from './services/tools/durable.ts';
export class ToolBridgeAgent extends ProductToolBridgeAgent{async run(input){try{return await super.run(input);}catch(error){console.error('validation-tool-error',error instanceof Error?error.message:'unknown','deadlineDistanceMs',input.deadlineAt-Date.now());throw error;}}}
import {workspaceAgentName} from './services/workspace/protocol.ts';
import {modelBudgetTenantName} from './services/model-budget/core.ts';
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(url.pathname==='/__validation/workspace-report'){
  const task=await request.json();return Response.json(await env.WORKSPACE_AGENT.getByName(workspaceAgentName(task.tenantId,task.workspaceId)).report(task));
 }
 if(url.pathname==='/__validation/model-budget'){
  const identity=await request.json();const tenantId=identity.scope.tenantId;
  return Response.json(await env.TENANT_MODEL_BUDGET.getByName(modelBudgetTenantName(tenantId)).snapshot(tenantId,identity));
 }
 if(url.pathname==='/__validation/product-runtime-observe'){
  const input=await request.json();try{return Response.json({observation:await env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(input.actorIdentity)).observe(input.requestIdentity)});}
  catch(error){return Response.json({error:error instanceof Error?error.message:'unknown'},{status:409});}
 }
 return gateway.fetch(request,env,ctx);
}};`;
  const bundle = await build({
    stdin: { contents: wrapper, resolveDir: root, sourcefile: 'm2-product-turn-local-validation.ts', loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2024',
    mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'],
    external: ['cloudflare:workers', 'node:*'], logLevel: 'silent',
  });
  const binding = (name) => ({ type: 'durable-object', worker, exportName: name });
  const text = (value) => ({ type: 'text', value });
  const workerBinding = (exportName) => ({ type: 'worker', worker, exportName });
  const secret = crypto.randomUUID() + crypto.randomUUID();
  const key = () => crypto.randomUUID() + crypto.randomUUID();
  let outboundFetches = 0;
  const config = { host: '127.0.0.1', port: 0, inspectorPort: 0, cf: {}, telemetry: { enabled: false }, resourcePersistencePath: stateDirectory,
    containerEngine: { localDocker: { socketPath, containerEgressInterceptorImage: proxyImage } },
    workers: [{ config: { type: 'worker', name: worker, compatibilityDate: '2026-09-06', compatibilityFlags: ['nodejs_compat', 'nodejs_compat_do_not_populate_process_env'],
      manifest: { mainModule: 'gateway.mjs', modules: { 'gateway.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } },
      env: {
        CATALOG: { type: 'd1', id: runId, name: runId }, WORKSPACE_CHECKPOINTS: { type: 'r2', name: runId }, MODEL_CONTENT: { type: 'r2', name: runId+'-models' },
        APP_ORIGIN: text(origin), BETTER_AUTH_SECRET: text(secret), GOOGLE_CLIENT_ID: text('fixture-only'), GOOGLE_CLIENT_SECRET: text('fixture-only'),
        TENANT_QUOTA_CAPACITY: text('1'), TENANT_QUOTA_POLICY_VERSION: text('m1-v1'), M2_TURNS_ENABLED: text('true'),
        M2_MODEL_PROVIDER_ENABLED: text('false'), M2_MODEL_BUDGET_POLICY_VERSION: text('m2-token-v1'), M2_MODEL_PROVIDER: text('opencode-go'), M2_MODEL_ID: text('gpt-5.6-luna'),
        M2_MODEL_MAX_INPUT_TOKENS_PER_CALL: text('262144'), M2_MODEL_MAX_OUTPUT_TOKENS_PER_CALL: text('4096'), M2_MODEL_CAPABILITY_TTL_MS: text('120000'),
        MODEL_BUDGET_POLICY_VERSION: text('m2-token-v1'), MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN: text('4'), MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN: text('2'),
        MODEL_BUDGET_MAX_INPUT_TOKENS_PER_CALL: text('262144'), MODEL_BUDGET_MAX_OUTPUT_TOKENS_PER_CALL: text('4096'), MODEL_BUDGET_MAX_RESERVED_TOKENS_PER_TURN: text('532480'),
        M2_MODEL_PROXY_REQUEST_KEY: text(key()), M2_TOOL_BRIDGE_REQUEST_KEY: text(key()), M2_MODEL_TURN_CAPABILITY_KEY: text(key()), M2_PROJECT_EFFECT_CAPABILITY_KEY: text(key()), M2_OPENCODE_GO_API_KEY: text('provider-disabled'),
        TENANT_QUOTA: binding('TenantQuota'), WORKSPACE_AGENT: binding('WorkspaceAgent'), PROJECT_RUNTIME: binding('ProjectRuntime'), PRODUCT_TURN_RUNTIME: binding('ProductTurnRuntime'), REVISION_STORE: binding('RevisionStore'),
        TENANT_MODEL_BUDGET: binding('TenantModelBudget'), PROJECT_SANDBOX: binding('ProjectToolSandbox'), TRUSTED_PI_SANDBOX: binding('TrustedPiSandbox'), TOOL_BRIDGE_AGENT: binding('ToolBridgeAgent'), TOOL_ARTIFACT_STORE: binding('ToolArtifactStore'),
        MODEL_PROXY: workerBinding('ModelProxyService'), TOOL_BRIDGE: workerBinding('ToolBridgeService'),
      },
      exports: {
        TenantQuota: { type: 'durable-object', storage: 'sqlite' }, WorkspaceAgent: { type: 'durable-object', storage: 'sqlite' },
        ProductTurnRuntime: { type: 'durable-object', storage: 'sqlite' }, RevisionStore: { type: 'durable-object', storage: 'sqlite' }, ToolArtifactStore: { type: 'durable-object', storage: 'sqlite' }, TenantModelBudget: { type: 'durable-object', storage: 'sqlite' }, ToolBridgeAgent: { type: 'durable-object', storage: 'sqlite' },
        ProjectRuntime: { type: 'durable-object', storage: 'sqlite', container: { imageName: images.runtime } },
        ProjectToolSandbox: { type: 'durable-object', storage: 'sqlite', container: { imageName: images.project } },
        TrustedPiSandbox: { type: 'durable-object', storage: 'sqlite', container: { imageName: images.trusted } },
        ToolBridgeService: { type: 'worker' }, ModelProxyService: { type: 'worker' },
      },
    }, dev: { unsafeRegisterWorker: false, outboundService: { type: 'fetcher', handler: () => { outboundFetches++; return new Response('outbound-disabled', { status: 403 }); } } } }],
  };
  const start = () => new Miniflare(config);
  mf = start();
  await mf.ready;
  const db = await mf.getD1Database('CATALOG', worker);
  for (const filename of ['0001_catalog.sql', '0002_auth.sql', '0003_provisioning.sql', '0004_operator_invitations.sql', '0005_initial_operator.sql', '0006_model_catalog.sql','0007_model_content_checks.sql']) {
    const schema = readFileSync(`services/catalog/migrations/${filename}`, 'utf8').replace(/--[^\n]*/g, '');
    for (const statement of schema.match(/\s*CREATE\s+TRIGGER[\s\S]*?\bEND\s*;|[^;]+;/gi) || []) await db.prepare(statement.trim()).run();
  }
  const fixture = new SqliteCatalog();
  let cookie, secondCookie;
  const invitationToken = 'f'.repeat(64);
  const secondInvitationToken = 'e'.repeat(64);
  try {
    fixture.sqlite.exec(readFileSync('services/catalog/migrations/0002_auth.sql', 'utf8'));
    const now = Date.now();
    fixture.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES ('m2-native-invite',?,'m2-native@example.test',?,?)`).run(await digest(invitationToken), now, now + 300_000);
    fixture.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES ('m2-native-invite-second',?,'m2-native-second@example.test',?,?)`).run(await digest(secondInvitationToken), now, now + 300_000);
    const auth = createAuth({ database: fixture.sqlite, catalog: fixture, origin, secret, googleClientId: 'fixture-only', googleClientSecret: 'fixture-only' });
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({ name: 'M2 native fixture', email: 'm2-native@example.test', emailVerified: true }, { method: 'oauth', oauth: { providerId: 'google' } });
    const session = await context.internalAdapter.createSession(user.id);
    const secondUser = await context.internalAdapter.createUser({ name: 'M2 native second fixture', email: 'm2-native-second@example.test', emailVerified: true }, { method: 'oauth', oauth: { providerId: 'google' } });
    const secondSession = await context.internalAdapter.createSession(secondUser.id);
    for (const table of ['auth_user', 'auth_session', 'catalog_invitations']) for (const row of fixture.sqlite.prepare(`SELECT * FROM ${table}`).all()) {
      const keys = Object.keys(row);
      await db.prepare(`INSERT INTO ${table} (${keys.map((name) => `"${name}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...keys.map((name) => row[name])).run();
    }
    cookie = (await serializeSignedCookie(context.authCookies.sessionToken.name, session.token, secret)).split(';')[0];
    secondCookie = (await serializeSignedCookie(context.authCookies.sessionToken.name, secondSession.token, secret)).split(';')[0];
  } finally { fixture.sqlite.close(); }
  const headers = { cookie, origin, 'content-type': 'application/json' };
  const secondHeaders = { cookie: secondCookie, origin, 'content-type': 'application/json' };
  const accepted = await mf.dispatchFetch(`${origin}/api/invitations/accept`, { method: 'POST', headers, body: JSON.stringify({ token: invitationToken }) });
  assert.equal(accepted.status, 200);
  const { tenantId } = await accepted.json();
  const secondAccepted = await mf.dispatchFetch(`${origin}/api/invitations/accept`, { method: 'POST', headers: secondHeaders, body: JSON.stringify({ token: secondInvitationToken }) });
  assert.equal(secondAccepted.status, 200);
  const { tenantId: secondTenantId } = await secondAccepted.json();
  assert.notEqual(secondTenantId, tenantId);
  const officialFiles=crud?{'docs/initial-model.txt':'Official package baseline\n','model/starter.py':'print("initial model")\n'}:{};
  let modelRef;
  if(crud){
    const serialized=JSON.stringify({schemaVersion:1,files:Object.entries(officialFiles).sort(([a],[b])=>a<b?-1:1).map(([path,content])=>({path,bytes:Buffer.byteLength(content),sha256:hash(content),contentBase64:Buffer.from(content).toString('base64')}))});
    modelRef={modelVersionId:'crud-official-version',modelId:'crud-official',version:'1',contentRef:'models/crud-official/1.json',contentSha256:hash(serialized)};
    const owner=await db.prepare('SELECT owner_user_id FROM catalog_tenants WHERE id=?').bind(tenantId).first();const now=Date.now();
    await db.prepare("INSERT INTO catalog_model_versions(id,model_id,version,status,title,description,starter_version,content_ref,content_sha256,last_transition_id,created_by,created_at,validated_at,published_at) VALUES(?,?,?,'published','Local official initial source','Test fixture','blank-v1',?,?,'local-fixture-publish',?,?,?,?)").bind(modelRef.modelVersionId,modelRef.modelId,modelRef.version,modelRef.contentRef,modelRef.contentSha256,owner.owner_user_id,now,now,now).run();
    await (await mf.getR2Bucket('MODEL_CONTENT',worker)).put(modelContentKey(modelRef),serialized);
  }
  const created = await mf.dispatchFetch(`${origin}/api/tenants/${tenantId}/projects`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'm2-native-create' }, body: JSON.stringify(crud?{title:'M2 official model CRUD acceptance',modelId:modelRef.modelId,modelVersion:modelRef.version}:{ title: 'M2 provider-disabled acceptance', starterVersion: 'blank-v1' }) });
  assert.equal(created.status, 202);
  const { project } = await created.json();
  const row = await db.prepare('SELECT * FROM catalog_outbox WHERE project_id=?').bind(project.id).first();
  const task = { id: row.id, tenantId, projectId: project.id, workspaceId: project.workspace_id, generation: 1, starterVersion: 'blank-v1', authVersion: 1, createdAt: row.created_at, deadlineAt: row.deadline_at };
  if(modelRef)task.modelContent=modelRef;
  const workspaceReport = async () => (await mf.dispatchFetch(`${origin}/__validation/workspace-report`, { method: 'POST', body: JSON.stringify(task) })).json();
  let workspaceState;
  const workspaceDeadline = Date.now() + 90_000;
  do {
    workspaceState = await bounded(workspaceReport(), 10_000);
    const view = { stage: 'workspace', phase: workspaceState.phase, projection: workspaceState.projection?.outcome ?? null, confirmed: workspaceState.projectionConfirmed === true };
    if (JSON.stringify(result.observations.at(-1)) !== JSON.stringify(view)) result.observations.push(view);
    if (workspaceState.projectionConfirmed) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  } while (Date.now() < workspaceDeadline);
  assert.equal(workspaceState.projection?.outcome, 'ready');
  assert.equal(workspaceState.projectionConfirmed, true);
  const initialObject = await (await mf.getR2Bucket('WORKSPACE_CHECKPOINTS', worker)).get(checkpointKey(workspaceState.identity));
  assert.ok(initialObject);
  assert.equal(await initialObject.text(), (await initialCheckpoint({ task, identity: workspaceState.identity, markerNonce: workspaceState.markerNonce },workspaceState.runtimeReceipt.modelContent)).text);
  const expectedInitialFiles={'README.md':initialFiles({task,identity:workspaceState.identity,markerNonce:workspaceState.markerNonce})['README.md'],...officialFiles};
  const expectedCrudFiles={...expectedInitialFiles,...crudExpectedFiles};
  const beforeTurnFilesResponse=await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/files`,{headers});
  assert.equal(beforeTurnFilesResponse.status,200);const beforeTurnFiles=await beforeTurnFilesResponse.json();
  assert.equal(beforeTurnFiles.revision,null);assert.deepEqual(beforeTurnFiles.files.map(file=>file.path),['README.md','app','docs','experiments','model','results',...Object.keys(officialFiles)].sort());
  result.initialFiles=beforeTurnFiles;
  result.containersAfterProvisioning = containerFacts(beforeContainers);

  const sessionResponse = await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/sessions`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'm2-native-session' }, body: JSON.stringify({ title: 'Provider disabled validation' }) });
  assert.equal(sessionResponse.status, 201);
  const { session } = await sessionResponse.json();
  const waitForTurn = async (turnId, stage) => {
    let currentSnapshot;
    const deadline = Date.now() + 120_000;
    do {
      const response = await bounded(mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}`, { method: 'GET', headers }), 10_000);
      assert.equal(response.status, 200);
      currentSnapshot = await response.json();
      const current = currentSnapshot.turns[turnId];
      const view = { stage, status: current.status, executionOutcome: current.executionOutcome, persistenceOutcome: current.persistenceOutcome };
      if (JSON.stringify(result.observations.at(-1)) !== JSON.stringify(view)) result.observations.push(view);
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(current.status)) return current;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    } while (Date.now() < deadline);
    assert.fail(`${stage}-deadline`);
  };
  const assertProviderDisabledTurn = async (turnId, stage) => {
    const current = await waitForTurn(turnId, stage);
    assert.equal(current.status, profile.expectedTerminal);
    assert.equal(current.executionOutcome, crud?'completed':'failed');
    assert.equal(current.errorCode, profile.expectedErrorCode);
    assert.equal(current.persistenceOutcome, 'saved');
    assert.ok(current.checkpoint);
    return current;
  };
  const readAllEvents=async()=>{
    let cursor=0;const events=[];
    for(let page=0;page<20;page++){
      const response=await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/events?after_sequence=${cursor}&limit=200`,{method:'GET',headers});assert.equal(response.status,200);
      const value=await response.json();assert.equal(value.snapshotRequired,false);events.push(...value.events);
      if(!value.hasMore)return {events};assert.ok(value.nextSequence>cursor);cursor=value.nextSequence;
    }throw Error('validation-event-page-bound');
  };
  const checkCrudViews=async(recovered)=>{
    const read=async(path)=>{const response=await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/${path}`,{method:'GET',headers});assert.equal(response.status,200);return response.json();};
    const files=await read('files'),diff=await read('diff');
    assert.deepEqual(files.files.filter(item=>item.type==='file').map(item=>item.path).sort(),Object.keys(expectedCrudFiles).sort());
    for(const entry of files.files.filter(item=>item.type==='file'))assert.equal(entry.size,Buffer.byteLength(expectedCrudFiles[entry.path]));
    if(recovered){assert.deepEqual(diff.summary,{added:0,modified:0,deleted:0});assert.deepEqual(diff.changes,[]);}
    else{assert.deepEqual(diff.summary,{added:4,modified:0,deleted:0});assert.ok(diff.changes.every(item=>item.change==='added'));}
    return {files,diff};
  };
  const readManifest = async (bucket, turn) => {
    const object = await bucket.get(turn.checkpoint.objectKey);
    assert.ok(object);
    return JSON.parse(await object.text());
  };
  const readBudget = async (identity) => {
    const response = await mf.dispatchFetch(`${origin}/__validation/model-budget`, { method: 'POST', body: JSON.stringify(identity) });
    assert.equal(response.status, 200);
    const value = await response.json();
    assert.equal(value.attempts, 0);
    assert.equal(value.dispatchedCalls, 0);
    assert.deepEqual(value.records, []);
    return value;
  };
  const turnResponse = await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/sessions/${session.id}/turns`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'm2-native-turn' }, body: JSON.stringify({ message: 'Inspect the blank project and report readiness.' }) });
  assert.equal(turnResponse.status, 202);
  const submitted = await turnResponse.json();
  const queuedResponses=await Promise.all(['a','b'].map(suffix=>mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/sessions/${session.id}/turns`,{method:'POST',headers:{...headers,'idempotency-key':`m2-native-turn-queued-cancel-${suffix}`},body:JSON.stringify({message:`Queued turn ${suffix} must never reach the Runtime.`})})));
  for(const response of queuedResponses)assert.equal(response.status,202);const queuedSubmissions=await Promise.all(queuedResponses.map(response=>response.json()));
  const queueSnapshotResponse=await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}`,{method:'GET',headers});assert.equal(queueSnapshotResponse.status,200);const queueSnapshot=await queueSnapshotResponse.json();assert.equal(queueSnapshot.activeTurnId,submitted.turn.id);
  const queuedCancelled=[];for(const queuedSubmitted of queuedSubmissions){assert.equal(queueSnapshot.turns[queuedSubmitted.turn.id].status,'queued');const response=await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/turns/${queuedSubmitted.turn.id}/cancel`,{method:'POST',headers,body:'{}'});assert.equal(response.status,200);const cancelled=await response.json();assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.dispatchId,undefined);assert.equal(cancelled.checkpoint,null);queuedCancelled.push(cancelled);}
  const turn = await assertProviderDisabledTurn(submitted.turn.id, 'first-turn');
  const events = await readAllEvents();
  assert.ok(events.events.some((event) => event.turnId === submitted.turn.id && event.type === 'provider.status' && event.payload.state === 'requesting'));
  assert.ok(events.events.some((event) => event.turnId === submitted.turn.id && event.type === 'provider.status' && event.payload.state === (crud?'responding':'error') && event.payload.status === (crud?200:503)));
  const bucket = await mf.getR2Bucket('WORKSPACE_CHECKPOINTS', worker);
  const manifest = await readManifest(bucket, turn);
  const budget = await readBudget(manifest.identity);
  if(crud){
    const completed=events.events.filter(event=>event.turnId===submitted.turn.id&&event.type==='tool.completed');
    result.crudToolEvents=completed;
    const sessionBytes=await (await bucket.get(manifest.piSession.objectKey)).text();
    const toolResults=[];const visit=value=>{if(!value||typeof value!=='object')return;if(value.role==='toolResult')toolResults.push({toolName:value.toolName,toolCallId:value.toolCallId,isError:value.isError,content:value.content});for(const child of Object.values(value))visit(child);};visit(JSON.parse(sessionBytes));result.crudToolResults=toolResults;
    assert.equal(completed.length,21);assert.ok(completed.every(event=>event.payload.isError===false));
    result.crudFirst=await checkCrudViews(false);
    const archive=new Uint8Array(await (await bucket.get(manifest.files.objectKey)).arrayBuffer());
    const contents=JSON.parse(execFileSync('python3',['-c','import sys,tarfile,io,json; t=tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({m.name:t.extractfile(m).read().decode() for m in t if m.isfile()}))'],{input:archive,encoding:'utf8'}));
    assert.deepEqual(contents,expectedCrudFiles);result.crudArchiveContents=contents;
  }
  const deniedObjectsBefore=(await bucket.list({limit:100})).objects.map(item=>item.key).sort();const deniedContainersBefore=containerFacts(beforeContainers).map(item=>item.id).sort();
  const deniedRequests=[];
  for(const [name,url,init] of [
    ['workspace-snapshot',`${origin}/api/workspaces/${project.workspace_id}`,{method:'GET',headers:secondHeaders}],
    ['workspace-session',`${origin}/api/workspaces/${project.workspace_id}/sessions`,{method:'POST',headers:{...secondHeaders,'idempotency-key':'cross-tenant-session'},body:JSON.stringify({title:'denied'})}],
    ['workspace-events',`${origin}/api/workspaces/${project.workspace_id}/events?after_sequence=0&limit=10`,{method:'GET',headers:secondHeaders}],
    ['tenant-projects',`${origin}/api/tenants/${tenantId}/projects`,{method:'GET',headers:secondHeaders}],
    ['workspace-cancel',`${origin}/api/workspaces/${project.workspace_id}/turns/${submitted.turn.id}/cancel`,{method:'POST',headers:secondHeaders,body:'{}'}],
  ]){const response=await mf.dispatchFetch(url,init);assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'not_found'});deniedRequests.push({name,status:response.status});}
  const identityMutations=[
    {field:'tenantId',requestIdentity:{...manifest.identity,scope:{...manifest.identity.scope,tenantId:secondTenantId}}},
    {field:'projectId',requestIdentity:{...manifest.identity,scope:{...manifest.identity.scope,projectId:'other-project'}}},
    {field:'workspaceId',requestIdentity:{...manifest.identity,scope:{...manifest.identity.scope,workspaceId:'other-workspace'}}},
    {field:'generation',requestIdentity:{...manifest.identity,scope:{...manifest.identity.scope,workspaceGeneration:2},generation:2}},
    {field:'sessionId',requestIdentity:{...manifest.identity,sessionId:'other-session'}},
    {field:'turnId',requestIdentity:{...manifest.identity,turnId:'other-turn'}},
    {field:'dispatchId',requestIdentity:{...manifest.identity,dispatchId:'other-dispatch'}},
  ];
  const runtimeIdentityDenials=[];for(const mutation of identityMutations){const response=await mf.dispatchFetch(`${origin}/__validation/product-runtime-observe`,{method:'POST',body:JSON.stringify({actorIdentity:manifest.identity,requestIdentity:mutation.requestIdentity})});assert.equal(response.status,409);const body=await response.json();assert.match(body.error,/scope-denied|generation-conflict/);runtimeIdentityDenials.push({field:mutation.field,status:response.status,error:body.error});}
  assert.deepEqual((await bucket.list({limit:100})).objects.map(item=>item.key).sort(),deniedObjectsBefore);assert.deepEqual(containerFacts(beforeContainers).map(item=>item.id).sort(),deniedContainersBefore);
  assert.equal(outboundFetches, 0);
  const replay = await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/sessions/${session.id}/turns`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'm2-native-turn' }, body: JSON.stringify({ message: 'Inspect the blank project and report readiness.' }) });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).turn.id, submitted.turn.id);
  result.containersAfterFirstTurn = containerFacts(beforeContainers);
  const destroyable = result.containersAfterFirstTurn.filter((item) => [images.project, images.trusted, proxyImage].includes(item.image));
  assert.ok(destroyable.some((item) => item.image === images.project));
  assert.ok(destroyable.some((item) => item.image === images.trusted));
  for (const item of destroyable) docker('rm', '-f', item.id);
  const survivingIds = new Set(docker('ps', '-aq').split('\n').filter(Boolean));
  assert.ok(destroyable.every((item) => !survivingIds.has(item.id)));
  result.destroyedBeforeRestore = destroyable.map((item) => ({ ...item, removed: true }));

  const restoredResponse = await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/sessions/${session.id}/turns`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'm2-native-turn-restore' }, body: JSON.stringify({ message: 'Continue from the saved checkpoint and report readiness again.' }) });
  assert.equal(restoredResponse.status, 202);
  const restoredSubmitted = await restoredResponse.json();
  const restoredTurn = await assertProviderDisabledTurn(restoredSubmitted.turn.id, 'restored-turn');
  assert.notEqual(restoredTurn.checkpoint.revisionId, turn.checkpoint.revisionId);
  const restoredManifest = await readManifest(bucket, restoredTurn);
  assert.deepEqual(restoredManifest.base.workspace, turn.checkpoint);
  assert.deepEqual(restoredManifest.base.session, turn.checkpoint);
  assert.equal(restoredManifest.identity.sessionId, session.id);
  assert.equal(restoredManifest.identity.turnId, restoredSubmitted.turn.id);
  assert.equal(restoredManifest.files.sha256, manifest.files.sha256);
  assert.notEqual(restoredManifest.piSession.sha256, manifest.piSession.sha256);
  const restoredBudget = await readBudget(restoredManifest.identity);
  const allEvents = await readAllEvents();
  assert.ok(allEvents.events.some((event) => event.turnId === restoredSubmitted.turn.id && event.type === 'provider.status' && event.payload.state === 'requesting'));
  assert.ok(allEvents.events.some((event) => event.turnId === restoredSubmitted.turn.id && event.type === 'provider.status' && event.payload.state === (crud?'responding':'error') && event.payload.status === (crud?200:503)));
  if(crud){
    const completed=allEvents.events.filter(event=>event.turnId===restoredSubmitted.turn.id&&event.type==='tool.completed');
    assert.equal(completed.length,4);assert.ok(completed.every(event=>event.payload.isError===false));
    result.crudRestored=await checkCrudViews(true);
  }
  result.containersAfterRestoredTurn = containerFacts(beforeContainers);
  const restoredSandboxContainers = result.containersAfterRestoredTurn.filter((item) => [images.project, images.trusted].includes(item.image));
  assert.ok(restoredSandboxContainers.some((item) => item.image === images.project));
  assert.ok(restoredSandboxContainers.some((item) => item.image === images.trusted));
  assert.ok(restoredSandboxContainers.every((item) => !destroyable.some((prior) => prior.id === item.id)));
  const beforeCorruption = await bucket.list({ limit: 100 });
  assert.ok(beforeCorruption.objects.some((item) => item.key === turn.checkpoint.objectKey));
  assert.ok(beforeCorruption.objects.some((item) => item.key === restoredTurn.checkpoint.objectKey));
  const manifestsBeforeCorruption = beforeCorruption.objects.filter((item) => item.key.startsWith('turns/')).length;
  assert.equal(manifestsBeforeCorruption, 2);
  const destroyableBeforeCorruption = result.containersAfterRestoredTurn.filter((item) => [images.project, images.trusted, proxyImage].includes(item.image));
  for (const item of destroyableBeforeCorruption) docker('rm', '-f', item.id);
  await bucket.delete(restoredManifest.piSession.objectKey);
  assert.equal(await bucket.get(restoredManifest.piSession.objectKey), null);
  result.corruptBaseInjection = {
    deletedObjectKey: restoredManifest.piSession.objectKey,
    deletedSha256: restoredManifest.piSession.sha256,
    containersDestroyed: destroyableBeforeCorruption.map((item) => ({ ...item, removed: true })),
  };

  const corruptBaseResponse = await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/sessions/${session.id}/turns`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'm2-native-turn-corrupt-base' }, body: JSON.stringify({ message: 'Continue after the unavailable saved base.' }) });
  assert.equal(corruptBaseResponse.status, 202);
  const corruptBaseSubmitted = await corruptBaseResponse.json();
  const corruptBaseTurn = await waitForTurn(corruptBaseSubmitted.turn.id, 'corrupt-base-turn');
  assert.equal(corruptBaseTurn.status, 'failed');
  assert.equal(corruptBaseTurn.executionOutcome, 'failed');
  assert.equal(corruptBaseTurn.errorCode, 'turn-base-unavailable');
  assert.equal(corruptBaseTurn.persistenceOutcome, 'failed');
  assert.equal(corruptBaseTurn.persistenceErrorCode, 'turn-checkpoint-unknown');
  assert.equal(corruptBaseTurn.checkpoint, null);
  const faultEvents = await readAllEvents();
  const corruptBaseEvents = faultEvents.events.filter((event) => event.turnId === corruptBaseSubmitted.turn.id);
  assert.ok(corruptBaseEvents.some((event) => event.type === 'turn.checkpointing'));
  assert.ok(corruptBaseEvents.some((event) => event.type === 'turn.failed'));
  assert.ok(corruptBaseEvents.every((event) => event.type !== 'provider.status' && !event.type.startsWith('tool.')));
  result.containersAfterCorruptBaseTurn = containerFacts(beforeContainers);
  assert.ok(result.containersAfterCorruptBaseTurn.every((item) => ![images.project, images.trusted].includes(item.image)));
  const listed = await bucket.list({ limit: 100 });
  assert.equal(listed.objects.filter((item) => item.key.startsWith('turns/')).length, manifestsBeforeCorruption);
  assert.equal(outboundFetches, 0);
  result.identity = manifest.identity;
  result.tenantId = tenantId;
  result.projectId = project.id;
  result.workspaceId = project.workspace_id;
  result.sessionId = session.id;
  result.secondTenantId = secondTenantId;
  result.turn = turn;
  result.turns = { first: turn, queuedCancelled, restored: restoredTurn, corruptBase: corruptBaseTurn };
  result.deniedRequests = deniedRequests;
  result.runtimeIdentityDenials = runtimeIdentityDenials;
  result.events = faultEvents.events;
  result.r2Objects = listed.objects.map((item) => ({ key: item.key, size: item.size, etag: item.etag }));
  result.modelBudget = budget;
  result.modelBudgets = { first: budget, restored: restoredBudget };
  result.manifests = {
    first: { identity: manifest.identity, base: manifest.base, files: manifest.files, piSession: manifest.piSession },
    restored: { identity: restoredManifest.identity, base: restoredManifest.base, files: restoredManifest.files, piSession: restoredManifest.piSession },
  };
  result.restoreAssertions = {
    priorContainersDestroyed: true,
    freshProjectAndTrustedPiContainers: true,
    workspaceBaseMatchesFirstCheckpoint: true,
    sessionBaseMatchesFirstCheckpoint: true,
    workspaceArchiveHashPreserved: true,
    piSessionAdvanced: true,
    corruptBaseRejectedBeforeSandboxAllocation: true,
    corruptBaseCreatedNoRevision: true,
    queuedCancellationNeverDispatched: true,
    secondTenantDeniedBeforeRuntime: true,
    runtimeActorRejectedSevenIdentityMutations: true,
  };
  result.externalWorkerFetches = outboundFetches;

  await mf.dispose();
  mf = start();
  await mf.ready;
  const recoveredResponse = await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}`, { method: 'GET', headers });
  assert.equal(recoveredResponse.status, 200);
  const recovered = await recoveredResponse.json();
  assert.equal(recovered.turns[submitted.turn.id].status, profile.expectedTerminal);
  assert.deepEqual(recovered.turns[submitted.turn.id].checkpoint, turn.checkpoint);
  assert.equal(recovered.turns[restoredSubmitted.turn.id].status, profile.expectedTerminal);
  assert.deepEqual(recovered.turns[restoredSubmitted.turn.id].checkpoint, restoredTurn.checkpoint);
  assert.equal(recovered.turns[corruptBaseSubmitted.turn.id].status, 'failed');
  assert.equal(recovered.turns[corruptBaseSubmitted.turn.id].errorCode, 'turn-base-unavailable');
  assert.equal(recovered.turns[corruptBaseSubmitted.turn.id].persistenceErrorCode, 'turn-checkpoint-unknown');
  assert.equal(recovered.turns[corruptBaseSubmitted.turn.id].checkpoint, null);
  for(const queuedSubmitted of queuedSubmissions){assert.equal(recovered.turns[queuedSubmitted.turn.id].status,'cancelled');assert.equal(recovered.turns[queuedSubmitted.turn.id].checkpoint,null);}
  result.recoveredAfterWorkerdRestart = {
    first: { status: recovered.turns[submitted.turn.id].status, checkpoint: recovered.turns[submitted.turn.id].checkpoint },
    restored: { status: recovered.turns[restoredSubmitted.turn.id].status, checkpoint: recovered.turns[restoredSubmitted.turn.id].checkpoint },
    corruptBase: { status: recovered.turns[corruptBaseSubmitted.turn.id].status, errorCode: recovered.turns[corruptBaseSubmitted.turn.id].errorCode, persistenceErrorCode: recovered.turns[corruptBaseSubmitted.turn.id].persistenceErrorCode, checkpoint: recovered.turns[corruptBaseSubmitted.turn.id].checkpoint },
    queuedCancelled: queuedSubmissions.map(item=>({status:recovered.turns[item.turn.id].status,checkpoint:recovered.turns[item.turn.id].checkpoint})),
  };
  result.status = 'passed';
} catch (error) {
  failure = error;
  result.status = 'failed';
  result.error = String(error?.stack ?? error).slice(0, 6000);
} finally {
  if (mf) try { await mf.dispose(); } catch (error) { result.disposeError = String(error?.message ?? error).slice(0, 500); result.status = 'failed'; failure ??= error; }
  const facts = containerFacts(beforeContainers);
  for (const item of facts) {
    if (![...Object.values(images), proxyImage].includes(item.image)) { result.cleanup.push({ id: item.id, unrelatedImage: item.image }); continue; }
    docker('rm', '-f', item.id);
    result.cleanup.push({ id: item.id, image: item.image, removed: true });
  }
  result.sourceAfter = sourceSnapshot(root);
  result.sourceStable = result.sourceBefore.sha256 === result.sourceAfter.sha256;
  if (!result.sourceStable) { result.status = 'failed'; failure ??= Error('source-changed-during-local-acceptance'); }
  result.validationDockerfileSha256 = hash(validationDockerfile);
  writeFileSync(resolve(evidenceDirectory, 'primary-review.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ evidenceDirectory, status: result.status, error: result.error, sourceStable: result.sourceStable, modelBudget: result.modelBudget && { attempts: result.modelBudget.attempts, dispatchedCalls: result.modelBudget.dispatchedCalls }, externalWorkerFetches: result.externalWorkerFetches, cleanup: result.cleanup }, null, 2));
}
if (failure) process.exitCode = 1;
