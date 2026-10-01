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
import {parseReuseAcceptanceArgs} from './runtime-reuse-acceptance-contract.mjs';
const acceptance=parseReuseAcceptanceArgs(process.argv.slice(2));
const crud=true,lazy=true,verticalProject=false;
const projectDockerfile=verticalProject?'services/project-tools/Dockerfile.vertical':'services/project-tools/Dockerfile.cloud';
const profile=crud?crudValidationProfile:providerDisabledValidationProfile;

const root = process.cwd();
const runId = `m2-runtime-reuse-${lazy?"lazy-":""}${crud?"crud-fixture":"provider-disabled"}-${new Date().toISOString().replace(/[^0-9]/g, '')}`;
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
  cwd: root, env: dockerEnv, encoding: 'utf8', timeout: args[0]==='build'?900_000:180_000, maxBuffer: 8 * 1024 * 1024,
}).trim();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const bounded = async (promise, milliseconds) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('local-acceptance-deadline')), milliseconds); })]); }
  finally { clearTimeout(timer); }
};
const observedContainers=new Map();
const containerFacts = (before) => docker('ps', '-a', '--format', '{{.ID}} {{.Names}}').split('\n').filter(Boolean).flatMap(line=>{
  const [id,name]=line.split(' ');if(before.has(id)||!name.startsWith(`workerd-${worker}-`))return [];
  let value;try{value=JSON.parse(docker('inspect',id))[0];}catch(error){if(/no such object/i.test(String(error.stderr)))return [];throw error;}
  const fact={id,name,image:value.Config.Image,imageId:value.Image,status:value.State.Status,running:value.State.Running};observedContainers.set(id,fact);return [fact];
});

mkdirSync(evidenceDirectory, { recursive: false, mode: 0o700 });
mkdirSync(stateDirectory, { recursive: false, mode: 0o700 });
const beforeContainers = new Set(docker('ps', '-aq').split('\n').filter(Boolean));
const productDockerfile = readFileSync('Dockerfile.trusted-pi.cloud', 'utf8');
const validationDockerfile = (crud?crudValidationDockerfile:providerDisabledValidationDockerfile)(productDockerfile);
const result = {
  schemaVersion: 1, runId, status: 'running',
  scope:'local Workerd + real Docker SDK + Gateway/Workspace/Runtime/ledgers/RevisionStore; ten sequential saved Turns, Session switch, native reuse; deterministic provider only, no cloud or paid calls',
  validationProfile: profile, lazyProject:lazy, acceptance, nativeAcceptance:true,
  projectImageProfile: {dockerfile:projectDockerfile,networkBoundary:verticalProject?'local Workerd deny-all egress; existing translated-amd64 seccomp exception':'production child seccomp fence'},
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
  docker('build', '--platform', 'linux/amd64', '--progress', 'plain', '--tag', images.project, '--file', projectDockerfile, 'services/project-tools');
  execFileSync('/opt/homebrew/bin/docker', ['build', '--platform', 'linux/amd64', '--progress', 'plain', '--tag', images.trusted, '--file', '-', '.'], {
    cwd: root, env: dockerEnv, input: validationDockerfile, encoding: 'utf8', timeout: 900_000, maxBuffer: 16 * 1024 * 1024,
  });
  for (const [role, image] of Object.entries(images)) {
    const inspected = JSON.parse(docker('image', 'inspect', image))[0];
    result.images[role] = { tag: image, id: inspected.Id, os: inspected.Os, architecture: inspected.Architecture, sizeBytes: inspected.Size };
    assert.equal(`${inspected.Os}/${inspected.Architecture}`, 'linux/amd64');
  }
  for(const role of ['project','trusted']){try{const module=role==='project'?'process_quiescence':'runtime_supervisor';docker('run','--rm','--network','none','--entrypoint','python3',images[role],'-c',`import os,sys;sys.path.insert(0,'/opt/riffology');from ${module} import pidfd_open;fd=pidfd_open(os.getpid());os.close(fd)`);}catch(error){throw Error('native-pidfd-unsupported:'+role+':'+String(error.stderr??error));}}
  assert.equal(docker('image', 'inspect', proxyImage, '--format', '{{.Id}}'), 'sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8');
  const projectEnvironment=JSON.parse(docker('image','inspect',images.project))[0].Config.Env;
  assert.equal(projectEnvironment.includes('RIFFOLOGY_PROJECT_PLATFORM_EGRESS_FENCE=workerd-deny-all-v1'),verticalProject);
  const activeProfile = docker('image', 'inspect', images.trusted, '--format', '{{index .Config.Labels "cn.gaojihe.riffology.validation-profile"}}');
  assert.equal(activeProfile, profile.name);

  const wrapper = `import gateway from './services/gateway/index.ts';
import {turnRuntimeActorName} from './services/turn-runtime/identity.ts';
export {ProductionModelBudget,TrustedPiCapacity,TenantQuota,WorkspaceAgent,ProjectRuntime,ProductTurnRuntime,RevisionStore,ToolArtifactStore,TenantModelBudget,TrustedPiSandbox,ToolBridgeService,ModelProxyService,ContainerProxy} from './services/gateway/index.ts';
import {ToolBridgeAgent as ProductToolBridgeAgent} from './services/tools/durable.ts';
export class ToolBridgeAgent extends ProductToolBridgeAgent{async run(input){try{return await super.run(input);}catch(error){console.error('validation-tool-error',error instanceof Error?error.message:'unknown','deadlineDistanceMs',input.deadlineAt-Date.now());throw error;}}}
import {ProjectToolSandbox as NativeProjectToolSandbox} from './services/sandbox/classes.ts';
import {sandboxActorIds} from './services/sandbox/identity.ts';
export class ProjectToolSandbox extends NativeProjectToolSandbox{
 constructor(ctx,env){super(ctx,env);this.validationStorage=ctx.storage;}
 async count(name){const counts=this.validationStorage.kv.get('validation-native-counts')??{};counts[name]=(counts[name]??0)+1;this.validationStorage.kv.put('validation-native-counts',counts);await this.validationStorage.sync();}
 validationCounts(){return this.validationStorage.kv.get('validation-native-counts')??{};}
 async writeFile(...args){await this.count('sdkWrite');return super.writeFile(...args);}
 async readFile(...args){await this.count('sdkRead');return super.readFile(...args);}
 async startProcess(...args){await this.count('sdkStartProcess');return super.startProcess(...args);}
 async destroy(...args){await this.count('sdkDestroy');return super.destroy(...args);}
 async restoreWorkspace(...args){await this.count('restore');return super.restoreWorkspace(...args);}
 async prepareWorkspaceOnce(...args){await this.count('prepare');return super.prepareWorkspaceOnce(...args);}
 async freezeWorkspace(...args){await this.count('freeze');return super.freezeWorkspace(...args);}
 async abortWorkspace(...args){await this.count('abort');return super.abortWorkspace(...args);}
}
import {workspaceAgentName} from './services/workspace/protocol.ts';
import {trustedPiCapacityActorName} from './services/capacity/client.ts';
import {toolBridgeActorName} from './services/tools/identity.ts';
import {PRODUCTION_MONEY_ACTOR} from './services/model-budget/production-money.ts';
import {modelBudgetTenantName} from './services/model-budget/core.ts';
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(['/__validation/reuse-audit','/__validation/reuse-retire','/__validation/reuse-drain'].includes(url.pathname)){
  const identity=await request.json(),owner=env.WORKSPACE_AGENT.getByName(workspaceAgentName(identity.scope.tenantId,identity.scope.workspaceId)),capacity=env.TRUSTED_PI_CAPACITY.getByName(trustedPiCapacityActorName()),binding=await owner.workspaceRuntimeBinding({identity});
  if(url.pathname.endsWith('reuse-retire'))return Response.json(await capacity.retirePair({scope:binding.lease.scope,leaseId:binding.lease.leaseId,leaseEpoch:binding.lease.leaseEpoch},'gate-disabled'));
  if(url.pathname.endsWith('reuse-drain')){await owner.drainRuntimeLease({ref:{scope:binding.lease.scope,leaseId:binding.lease.leaseId,leaseEpoch:binding.lease.leaseEpoch}});return Response.json(await capacity.pairedSnapshot());}
  return Response.json({binding,pair:await capacity.pairedSnapshot(),runtime:await env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity)).workspaceRuntimeState(identity),ledgers:await Promise.all([env.TENANT_MODEL_BUDGET.getByName(modelBudgetTenantName(identity.scope.tenantId)).turnSettlement(identity.scope.tenantId,identity),env.PRODUCTION_MODEL_BUDGET.getByName(PRODUCTION_MONEY_ACTOR).turnSettlement(identity),env.TOOL_BRIDGE_AGENT.getByName(await toolBridgeActorName(identity.scope,identity.turnId,identity.dispatchId)).turnSettlement(identity)])});
 }

 if(url.pathname==='/__validation/project-counts'){const identity=await request.json(),ids=await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId);return Response.json(await env.PROJECT_SANDBOX.getByName(ids.project).validationCounts());}
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
        TENANT_QUOTA_CAPACITY: text('1'), TENANT_QUOTA_POLICY_VERSION: text('m1-v1'), M2_TURNS_ENABLED: text('true'), M2_WORKSPACE_RUNTIME_REUSE_ENABLED:text('true'), M2_WORKSPACE_RUNTIME_VERSION:text(sourceBefore.sha256), PRODUCTION_MODEL_BUDGET:binding('ProductionModelBudget'), M2_LAZY_PROJECT_ENABLED:text(lazy?'true':'false'), M2_TURN_OPERATION_TELEMETRY:text('true'),
        M2_MODEL_PROVIDER_ENABLED: text('false'), M2_MODEL_BUDGET_POLICY_VERSION: text('m2-token-v1'), M2_MODEL_PROVIDER: text('opencode-go'), M2_MODEL_ID: text('gpt-5.6-luna'),
        M2_MODEL_MAX_INPUT_TOKENS_PER_CALL: text('262144'), M2_MODEL_MAX_OUTPUT_TOKENS_PER_CALL: text('4096'), M2_MODEL_CAPABILITY_TTL_MS: text('120000'),
        MODEL_BUDGET_POLICY_VERSION: text('m2-token-v1'), MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN: text('4'), MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN: text('2'),
        MODEL_BUDGET_MAX_INPUT_TOKENS_PER_CALL: text('262144'), MODEL_BUDGET_MAX_OUTPUT_TOKENS_PER_CALL: text('4096'), MODEL_BUDGET_MAX_RESERVED_TOKENS_PER_TURN: text('532480'),
        M2_MODEL_PROXY_REQUEST_KEY: text(key()), M2_TOOL_BRIDGE_REQUEST_KEY: text(key()), M2_MODEL_TURN_CAPABILITY_KEY: text(key()), M2_PROJECT_EFFECT_CAPABILITY_KEY: text(key()), M2_OPENCODE_GO_API_KEY: text('provider-disabled'),
        TENANT_QUOTA: binding('TenantQuota'), WORKSPACE_AGENT: binding('WorkspaceAgent'), PROJECT_RUNTIME: binding('ProjectRuntime'), PRODUCT_TURN_RUNTIME: binding('ProductTurnRuntime'), REVISION_STORE: binding('RevisionStore'),
        TRUSTED_PI_CAPACITY:binding('TrustedPiCapacity'), TRUSTED_PI_CAPACITY_LIMIT:text('1'), TRUSTED_PI_CAPACITY_POLICY_VERSION:text('m2-trusted-pi-v1'), TENANT_MODEL_BUDGET: binding('TenantModelBudget'), PROJECT_SANDBOX: binding('ProjectToolSandbox'), TRUSTED_PI_SANDBOX: binding('TrustedPiSandbox'), TOOL_BRIDGE_AGENT: binding('ToolBridgeAgent'), TOOL_ARTIFACT_STORE: binding('ToolArtifactStore'),
        MODEL_PROXY: workerBinding('ModelProxyService'), TOOL_BRIDGE: workerBinding('ToolBridgeService'),
      },
      exports: {
        ProductionModelBudget:{type:'durable-object',storage:'sqlite'}, TrustedPiCapacity:{type:'durable-object',storage:'sqlite'}, TenantQuota: { type: 'durable-object', storage: 'sqlite' }, WorkspaceAgent: { type: 'durable-object', storage: 'sqlite' },
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
  for (const filename of ['0001_catalog.sql', '0002_auth.sql', '0003_provisioning.sql', '0004_operator_invitations.sql', '0005_initial_operator.sql', '0006_model_catalog.sql','0007_model_content_checks.sql','0010_project_budget_routes.sql','0012_project_archives.sql']) {
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
    if (JSON.stringify(result.observations.at(-1)) !== JSON.stringify(view)) {result.observations.push(view);(result.stageTimes??=[]).push({...view,observedAt:Date.now()});}
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
    const deadline = Date.now() + 480_000;
    do {
      const response = await bounded(mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}`, { method: 'GET', headers }), 10_000);
      assert.equal(response.status, 200);
      currentSnapshot = await response.json();
      const liveTrusted=containerFacts(beforeContainers).filter(f=>f.image===images.trusted&&f.running);
      for(const native of liveTrusted){try{const sample=JSON.parse(docker('exec',native.id,'python3','-c',`import os,json,sys
sys.path.insert(0,'/opt/riffology')
import runtime_supervisor as r
state=r.read_state(os.open('/var/lib/riffology/runtime-control',os.O_RDONLY|os.O_DIRECTORY))
processes=[]
for entry in os.listdir('/proc'):
 if not entry.isdigit(): continue
 try:
  if os.stat('/proc/'+entry).st_uid != 10002: continue
  stat=open('/proc/'+entry+'/stat').read(); rest=stat[stat.rfind(')')+2:].split()
  if open('/proc/'+entry+'/comm').read().strip()=='node': processes.append({'pid':int(entry),'startTicks':int(rest[19])})
 except (FileNotFoundError,ProcessLookupError): pass
print(json.dumps({'state':state,'processes':processes}))`));(result.nativeProcessSamples??=[]).push({turnId,containerId:native.id,...sample});}catch(error){(result.nativeSampleErrors??=[]).push(String(error.stderr??error).slice(0,500));}}

      const current = currentSnapshot.turns[turnId];
      const view = { stage, status: current.status, executionOutcome: current.executionOutcome, persistenceOutcome: current.persistenceOutcome };
      if (JSON.stringify(result.observations.at(-1)) !== JSON.stringify(view)) {result.observations.push(view);(result.stageTimes??=[]).push({...view,observedAt:Date.now()});}
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
  const projectCounts=async identity=>{const response=await mf.dispatchFetch(origin+'/__validation/project-counts',{method:'POST',body:JSON.stringify(identity)});assert.equal(response.status,200);const counts=await response.json();if(lazy&&!crud)assert.deepEqual(counts,{});return counts;};
  // Sequential admission is deliberate: no queued competitor should retire the pair.
  const bucket = await mf.getR2Bucket('WORKSPACE_CHECKPOINTS', worker);
  const validation=async(path,body)=>{const response=await bounded(mf.dispatchFetch(origin+'/__validation/'+path,{method:'POST',body:JSON.stringify(body)}),10000);assert.equal(response.status,200,await response.clone().text());return response.json();};
  result.turns=[];let currentSession=session,previous=null,firstLease=null;
  for(let index=1;index<=10;index++){
    if(index===6){const response=await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/sessions`,{method:'POST',headers:{...headers,'idempotency-key':'reuse-session-second'},body:JSON.stringify({title:'Second isolated Session'})});assert.equal(response.status,201);currentSession=(await response.json()).session;assert.notEqual(currentSession.id,session.id);}
    const message=index===1?'Inspect the blank project and report readiness.':'Continue from the saved checkpoint and report readiness again.';
    const response=await mf.dispatchFetch(`${origin}/api/workspaces/${project.workspace_id}/sessions/${currentSession.id}/turns`,{method:'POST',headers:{...headers,'idempotency-key':`reuse-turn-${index}`},body:JSON.stringify({message})});assert.equal(response.status,202,await response.clone().text());
    const submitted=await response.json(),turn=await assertProviderDisabledTurn(submitted.turn.id,`turn-${index}`),manifest=await readManifest(bucket,turn);
    assert.equal(manifest.identity.sessionId,currentSession.id);if(previous)assert.deepEqual(manifest.base.workspace,previous.checkpoint);if(index===6)assert.equal(manifest.base.session,null);
    const archive=new Uint8Array(await (await bucket.get(manifest.files.objectKey)).arrayBuffer());assert.equal(hash(archive),turn.checkpoint.filesSha256);
    const sessionBytes=await (await bucket.get(manifest.piSession.objectKey)).text();assert.equal(hash(sessionBytes),turn.checkpoint.sessionSha256);
    const events=await readAllEvents(),tools=events.events.filter(event=>event.turnId===submitted.turn.id&&event.type==='tool.completed');assert.equal(tools.length,index===1?21:4);assert.ok(tools.every(event=>event.payload.isError===false));
    const handoffDeadline=Date.now()+60000;let audit;do{audit=await validation('reuse-audit',manifest.identity);const disposition=audit.runtime.resourceDisposition.status;if(disposition==='handed-off')break;assert.ok(!['released','recovery-hold'].includes(disposition),'saved-turn-did-not-reuse');await new Promise(resolve=>setTimeout(resolve,1000));}while(Date.now()<handoffDeadline);assert.equal(audit.runtime.resourceDisposition.status,'handed-off');assert.equal(audit.pair.active.status,'idle');assert.deepEqual(audit.runtime.checkpoint,turn.checkpoint);
    for(const ledger of audit.ledgers){assert.equal(ledger.closed,true);assert.equal(ledger.pending,0);assert.equal(ledger.active,0);assert.equal(ledger.unknown,0);assert.deepEqual(ledger.identity,manifest.identity);}
    firstLease??=audit.pair.active.ref;assert.deepEqual(audit.pair.active.ref,firstLease);assert.equal(audit.pair.active.binding.bindingEpoch,index);
    const facts=containerFacts(beforeContainers),roles={};for(const role of ['project','trusted']){const candidates=facts.filter(f=>f.image===images[role]&&f.running);assert.equal(candidates.length,1);roles[role]=candidates[0];}
    const native=JSON.parse(docker('exec',roles.trusted.id,'python3','-c',"import sys,json,os;sys.path.insert(0,'/opt/riffology');import runtime_supervisor as r;print(json.dumps(r.read_state(os.open('/var/lib/riffology/runtime-control',os.O_RDONLY|os.O_DIRECTORY))))"));assert.equal(native.status,'sealed');assert.equal(native.used.length,index);assert.ok(native.spawnToken);assert.ok(!result.turns.some(t=>t.native.spawnToken===native.spawnToken));
    const samples=(result.nativeProcessSamples??[]).filter(s=>s.turnId===submitted.turn.id&&s.state?.epoch===native.epoch&&s.state?.spawnToken===native.spawnToken);const processIdentities=[...new Set(samples.flatMap(s=>s.processes.map(p=>`${p.pid}:${p.startTicks}`)))];assert.ok(processIdentities.length>0,'fresh-Pi-subprocess-not-observed');for(const previousTurn of result.turns)assert.ok(processIdentities.every(p=>!previousTurn.processIdentities.includes(p)));
    if(result.turns.length)for(const role of ['project','trusted'])assert.equal(roles[role].id,result.turns[0].roles[role].id);
    result.turns.push({index,turn,manifest,audit,roles,native,processIdentities,toolEvents:tools});previous=turn;
  }
  const last=result.turns.at(-1);await validation('reuse-retire',last.manifest.identity);
  const releaseDeadline=Date.now()+480000;let released;
  do{released=await validation('reuse-drain',last.manifest.identity);if(released.active===null||released.active.status==='released')break;await new Promise(r=>setTimeout(r,5000));}while(Date.now()<releaseDeadline);
  assert.ok(released.active===null||released.active.status==='released','normal-retirement-guard-not-complete');result.normalRelease=released;
  assert.equal(outboundFetches,0);result.externalWorkerFetches=outboundFetches;
  result.status='passed';
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
  result.observedContainers=[...observedContainers.values()];
  result.resourceCounts={project:result.observedContainers.filter(item=>item.image===images.project).length,trustedPi:result.observedContainers.filter(item=>item.image===images.trusted).length};
  result.sourceAfter = sourceSnapshot(root);
  result.sourceStable = result.sourceBefore.sha256 === result.sourceAfter.sha256;
  if (!result.sourceStable) { result.status = 'failed'; failure ??= Error('source-changed-during-local-acceptance'); }
  result.validationDockerfileSha256 = hash(validationDockerfile);
  writeFileSync(resolve(evidenceDirectory, 'primary-review.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ evidenceDirectory, status: result.status, error: result.error, sourceStable: result.sourceStable, modelBudget: result.modelBudget && { attempts: result.modelBudget.attempts, dispatchedCalls: result.modelBudget.dispatchedCalls }, externalWorkerFetches: result.externalWorkerFetches, cleanup: result.cleanup }, null, 2));
}
if (failure) process.exitCode = 1;
