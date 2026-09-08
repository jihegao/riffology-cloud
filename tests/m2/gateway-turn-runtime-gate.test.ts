import assert from 'node:assert/strict';
import test from 'node:test';
import { requireTurnRuntime } from '../../services/gateway/turn-runtime-gate.ts';
import { HttpError } from '../../services/gateway/http.ts';
import { createGatewayTurnServices } from '../../services/gateway/turn-services.ts';

const scope = { tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', workspaceGeneration: 1 };
const actor = { userId: 'user-a', authVersion: 1 };

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

test('disabled admission returns before resolving or mutating WorkspaceAgent', async () => {
  let resolutions = 0;
  const services = createGatewayTurnServices({
    M2_TURNS_ENABLED: 'false',
    WORKSPACE_AGENT: {
      getByName() {
        resolutions += 1;
        throw new Error('must-not-resolve');
      },
    },
  });

  await assert.rejects(
    services.submit(scope, actor, 'session-a', 'request-a', { message: 'Build model' }),
    (error: unknown) => error instanceof HttpError && error.status === 503 && error.message === 'turn_runtime_not_ready',
  );
  assert.equal(resolutions, 0);
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
          async turnSnapshot() { throw new Error('unused'); },
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
    { scope, actor, sessionId: 'session-a', key: 'request-a', body: { message: 'Build model' } },
  ]);
});

test('saved Files and Artifacts remain readable through the derived workspace actor while new Turn admission is disabled',async()=>{
  const calls:unknown[]=[];const services=createGatewayTurnServices({M2_TURNS_ENABLED:'false',WORKSPACE_AGENT:{getByName(name){calls.push(name);return {async listFiles(input){calls.push(['files',input]);return {schemaVersion:1,revision:null,files:[]};},async diffFiles(input){calls.push(['diff',input]);return {schemaVersion:1,revision:null,summary:{added:0,modified:0,deleted:0},changes:[]};},async readArtifact(input){calls.push(['artifact',input]);return {receipt:{artifactId:'artifact-a'},content:new Uint8Array()};},async createSession(){throw Error('unused');},async submitTurn(){throw Error('unused');},async cancelTurn(){throw Error('unused');},async replayTurnEvents(){throw Error('unused');},async turnSnapshot(){throw Error('unused');}};}}});
  assert.deepEqual(await services.files(scope),{schemaVersion:1,revision:null,files:[]});assert.deepEqual(await services.diff(scope),{schemaVersion:1,revision:null,summary:{added:0,modified:0,deleted:0},changes:[]});assert.deepEqual(await services.artifact(scope,'artifact-a'),{receipt:{artifactId:'artifact-a'},content:new Uint8Array()});assert.deepEqual(calls,['workspace:tenant-a:workspace-a',['files',{scope}],'workspace:tenant-a:workspace-a',['diff',{scope}],'workspace:tenant-a:workspace-a',['artifact',{scope,artifactId:'artifact-a'}]]);
});
