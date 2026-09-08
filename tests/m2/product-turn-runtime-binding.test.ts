import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ProductTurnRuntimeClient } from '../../services/turn-runtime/client.ts';
import { ProductTurnRuntimeHost } from '../../services/turn-runtime/host.ts';
import { turnRuntimeActorName, type TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';
import type { TurnRuntimePort, TurnRuntimeReceipt } from '../../services/turn/dispatcher.ts';

const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
const request={...identity,actor:{userId:'user-a',authVersion:1},message:'Build model',base:{workspace:null,session:null}};
const absent=(input:TurnRuntimeIdentity):TurnRuntimeReceipt=>({scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,phase:'absent',outcome:null});

function namespace(ctxName:string,calls:string[]=[]){return {idFromName(name:string){calls.push(name);return {equals(other:unknown){return !!other&&typeof other==='object'&&(other as {name?:unknown}).name===name;}};},ctx:{id:{name:ctxName},storage:{}} as unknown as DurableObjectState};}

test('server rejects a wrong actor and an unconfigured release before touching SQLite',async()=>{
  const expected=await turnRuntimeActorName(identity),wrong=namespace('wrong-actor'),right=namespace(expected);let releases=0;
  const wrongHost=new ProductTurnRuntimeHost(wrong.ctx,{PRODUCT_TURN_RUNTIME:wrong as never},()=>{releases++;throw Error('must-not-run');});
  await assert.rejects(wrongHost.accept(request),/actor-scope-denied/);assert.equal(releases,0);
  const rightHost=new ProductTurnRuntimeHost(right.ctx,{PRODUCT_TURN_RUNTIME:right as never},()=>{releases++;throw Error('product-turn-runtime-release-not-configured');});
  await assert.rejects(rightHost.accept(request),/release-not-configured/);assert.equal(releases,1);
});

test('client derives one exact runtime actor and forwards the validated submitting actor',async()=>{
  const names:string[]=[],inputs:Array<{method:string;value:unknown}>=[],stub:TurnRuntimePort={
    async accept(value){inputs.push({method:'accept',value:structuredClone(value)});return absent(value);},
    async observe(value){inputs.push({method:'observe',value:structuredClone(value)});return absent(value);},
    async cancel(value){inputs.push({method:'cancel',value:structuredClone(value)});return absent(value);},
  },client=new ProductTurnRuntimeClient({getByName(name){names.push(name);return stub;}});
  await client.accept(request);await client.observe(identity);await client.cancel(identity);
  assert.deepEqual(names,[await turnRuntimeActorName(identity),await turnRuntimeActorName(identity),await turnRuntimeActorName(identity)]);
  assert.deepEqual(inputs,[{method:'accept',value:request},{method:'observe',value:identity},{method:'cancel',value:identity}]);
  const other={...identity,sessionId:'session-b'};await client.observe(other);assert.notEqual(names[3],names[0]);
});

test('malformed accept input fails before resolving any actor',async()=>{
  let resolved=0;const client=new ProductTurnRuntimeClient({getByName(){resolved++;throw Error('must-not-resolve');}});
  await assert.rejects(client.accept({...request,message:'\u0000'}),/turn-message/);assert.equal(resolved,0);
  await assert.rejects(client.accept({...request,base:{workspace:{revisionId:'bad'},session:null}} as never),/checkpoint/);assert.equal(resolved,0);
});

test('production binding has an explicit fail-closed release and imports no M1 runtime',()=>{
  const durable=readFileSync(new URL('../../services/turn-runtime/durable.ts',import.meta.url),'utf8'),host=readFileSync(new URL('../../services/turn-runtime/host.ts',import.meta.url),'utf8'),release=readFileSync(new URL('../../services/turn-runtime/release-gated.ts',import.meta.url),'utf8');
  assert.match(durable,/release-gated/);assert.match(release,/M2_TURNS_ENABLED!=='true'/);assert.match(release,/product-turn-runtime-release-not-configured/);
  const imports=`${durable}\n${host}\n${release}`.split('\n').filter(line=>line.startsWith('import ')).join('\n');assert.doesNotMatch(imports,/\.\.\/runtime\/durable|\bProjectRuntime\b/);
});
