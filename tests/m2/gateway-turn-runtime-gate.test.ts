import assert from 'node:assert/strict';
import test from 'node:test';
import { requireTurnRuntime, turnAdmissionStatus } from '../../services/gateway/turn-runtime-gate.ts';
import { HttpError } from '../../services/gateway/http.ts';
import { createGatewayTurnServices } from '../../services/gateway/turn-services.ts';
import {turnAdmissionErrorCode} from '../../services/turn/admission-telemetry.ts';

const scope = { tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', workspaceGeneration: 1 };
const actor = { userId: 'user-a', authVersion: 1 };

test('admission projection makes the closed gate explicit and non-retryable', () => {
  assert.deepEqual(turnAdmissionStatus('false'), { state: 'maintenance', reasonCode: 'turn_runtime_not_ready', retryable: false });
  assert.deepEqual(turnAdmissionStatus('true'), { state: 'enabled', reasonCode: null, retryable: true });
  assert.deepEqual(turnAdmissionStatus('true', false), { state: 'unavailable', reasonCode: 'turn_runtime_unavailable', retryable: true });
});

test('turn admission fails closed unless the product runtime is explicitly enabled', () => {
  for (const value of [undefined, null, false, 'false', 'TRUE', '1']) {
    assert.throws(() => requireTurnRuntime(value), (error: unknown) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).message, 'turn_runtime_not_ready');
      assert.equal((error as HttpError).status, 503);
      return true;
    });
  }
  assert.doesNotThrow(() => requireTurnRuntime('true'));
});

test('disabled admission reads persisted backend without submitting a turn', async () => {
  let resolutions = 0;
  const services = createGatewayTurnServices({
    M2_TURNS_ENABLED: 'false',
    WORKSPACE_AGENT: {
      getByName() {
        resolutions += 1;
        return {async turnSnapshot(){return {runtimeBackend:'pi'};},async submitTurn(){throw Error('must-not-submit');}} as any;
      },
    },
  });

  await assert.rejects(
    services.submit(scope, actor, 'session-a', 'request-a', { message: 'Build model' }),
    (error: unknown) => error instanceof HttpError && error.status === 503 && error.message === 'turn_runtime_not_ready',
  );
  assert.equal(resolutions, 1);
});

test('enabled admission derives the workspace actor and forwards one exact request', async () => {
  const calls: unknown[] = [];
  const services = createGatewayTurnServices({
    M2_TURNS_ENABLED: 'true',
    WORKSPACE_AGENT: {
      getByName(name) {
        calls.push(name);
        return {
          async submitTurn(input) { calls.push(input); return { accepted: true }; },
          async createSession() { throw new Error('unused'); },
          async cancelTurn() { throw new Error('unused'); },
          async replayTurnEvents() { throw new Error('unused'); },
          async turnSnapshot() { return {runtimeBackend:'pi'}; },
          async listFiles() { throw new Error('unused'); },
          async diffFiles() { throw new Error('unused'); },
          async readArtifact() { throw new Error('unused'); },
        };
      },
    },
  });

  assert.deepEqual(await services.submit(scope, actor, 'session-a', 'request-a', { message: 'Build model' }), { accepted: true });
  assert.deepEqual(calls, [
    'workspace:tenant-a:workspace-a',
    'workspace:tenant-a:workspace-a',
    { scope, actor, sessionId: 'session-a', key: 'request-a', body: { message: 'Build model' } },
  ]);
});

test('workspace snapshot carries admission without changing the private actor payload', async () => {
  const calls: unknown[] = [];
  const services = createGatewayTurnServices({ M2_TURNS_ENABLED: 'false', WORKSPACE_AGENT: { getByName() {
    return { async turnSnapshot(input) { calls.push(input); return { schemaVersion: 3, sessions: {}, turns: {} }; },
      async createSession() { throw Error('unused'); }, async submitTurn() { throw Error('unused'); }, async cancelTurn() { throw Error('unused'); },
      async replayTurnEvents() { throw Error('unused'); }, async listFiles() { throw Error('unused'); }, async diffFiles() { throw Error('unused'); }, async readArtifact() { throw Error('unused'); } };
  } } });
  assert.deepEqual(await services.snapshot(scope), { schemaVersion: 3, sessions: {}, turns: {}, admission: { state: 'maintenance', reasonCode: 'turn_runtime_not_ready', retryable: false } });
  assert.deepEqual(calls, [{ scope }]);
});

test('saved Files and Artifacts remain readable through the derived workspace actor while new Turn admission is disabled',async()=>{
  const calls:unknown[]=[];const services=createGatewayTurnServices({M2_TURNS_ENABLED:'false',WORKSPACE_AGENT:{getByName(name){calls.push(name);return {async listFiles(input){calls.push(['files',input]);return {schemaVersion:1,revision:null,files:[]};},async diffFiles(input){calls.push(['diff',input]);return {schemaVersion:1,revision:null,summary:{added:0,modified:0,deleted:0},changes:[]};},async readArtifact(input){calls.push(['artifact',input]);return {receipt:{artifactId:'artifact-a'},content:new Uint8Array()};},async createSession(){throw Error('unused');},async submitTurn(){throw Error('unused');},async cancelTurn(){throw Error('unused');},async replayTurnEvents(){throw Error('unused');},async turnSnapshot(){return {runtimeBackend:'pi'};}};}}});
  assert.deepEqual(await services.files(scope),{schemaVersion:1,revision:null,files:[]});assert.deepEqual(await services.diff(scope),{schemaVersion:1,revision:null,summary:{added:0,modified:0,deleted:0},changes:[]});assert.deepEqual(await services.artifact(scope,'artifact-a'),{receipt:{artifactId:'artifact-a'},content:new Uint8Array()});assert.deepEqual(calls,['workspace:tenant-a:workspace-a',['files',{scope}],'workspace:tenant-a:workspace-a',['diff',{scope}],'workspace:tenant-a:workspace-a',['artifact',{scope,artifactId:'artifact-a'}]]);
});

test('staging turn admission telemetry emits only its fixed schema and redacts unstructured errors',async()=>{
  const lines:string[]=[];const original=console.error;console.error=(value?:unknown)=>{lines.push(String(value));};
  try{
    const services=createGatewayTurnServices({M2_TURNS_ENABLED:'true',M2_TURN_ADMISSION_TELEMETRY:'true',WORKSPACE_AGENT:{getByName(){return {async submitTurn(){throw Error('upstream included opaque-private-value');},async createSession(){throw Error('unused');},async cancelTurn(){throw Error('unused');},async replayTurnEvents(){throw Error('unused');},async turnSnapshot(){return {runtimeBackend:'pi'};},async listFiles(){throw Error('unused');},async diffFiles(){throw Error('unused');},async readArtifact(){throw Error('unused');}};}}});
    await assert.rejects(services.submit(scope,actor,'session-sensitive','request-sensitive',{message:'private prompt'}));
  }finally{console.error=original;}
  assert.equal(lines.length,1);assert.equal(lines[0].startsWith('turn-admission '),true);
  assert.deepEqual(JSON.parse(lines[0].slice('turn-admission '.length)),{route:'turn.submit',stage:'gateway',transportSuccess:false,errorCode:'unclassified'});
  assert.equal(lines[0].includes('opaque-private-value'),false);assert.equal(lines[0].includes('private prompt'),false);assert.equal(lines[0].includes('session-sensitive'),false);
  assert.equal(turnAdmissionErrorCode(Error('turn_runtime_not_ready')),'turn_runtime_not_ready');assert.equal(turnAdmissionErrorCode(Error('workspace-not-ready')),'workspace-not-ready');
  const identifier=['a1234567','89ab','4cde','8fab',['012345','6789ab'].join('')].join('-');
  for(const value of ['session-sensitive','private-secret','tenant-a',identifier,'arbitrary-short-slug'])assert.equal(turnAdmissionErrorCode(Error(value)),'unclassified');
});

test('opening the Pi runtime for developer mode does not reopen a historical G5 route',async()=>{
 for(const developer of [false,true]){
  let submitted=0;
  const services=createGatewayTurnServices({M2_TURNS_ENABLED:'true',G5_CONTROLLED_WINDOW_JSON:'{}',G5_ADMISSION_ENABLED:'false',WORKSPACE_AGENT:{getByName:()=>({
   async turnSnapshot(){return {runtimeBackend:'pi',...(developer?{piDeveloperState:{billingMode:'observe',blocked:null}}:{})};},async submitTurn(){submitted++;return {accepted:true};}
  } as any)}});
  assert.equal((await services.snapshot(scope) as any).admission.state,developer?'enabled':'maintenance');
  if(developer)await services.submit(scope,actor,'session','key',{message:'synthetic'});
  else await assert.rejects(services.submit(scope,actor,'session','key',{message:'synthetic'}),/turn_runtime_not_ready/);
  assert.equal(submitted,developer?1:0);
 }
});
