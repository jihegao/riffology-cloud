import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ProductTurnRuntimeClient } from '../../services/turn-runtime/client.ts';
import { ProductTurnRuntimeHost } from '../../services/turn-runtime/host.ts';
import type { ProductTurnRuntimeStorage } from '../../services/turn-runtime/core.ts';
import { turnRuntimeActorName, type TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';
import type { TurnRuntimePort, TurnRuntimeReceipt } from '../../services/turn/dispatcher.ts';

const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
const request={...identity,actor:{userId:'user-a',authVersion:1},message:'Build model',base:{workspace:null,session:null}};
const absent=(input:TurnRuntimeIdentity):TurnRuntimeReceipt=>({scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,phase:'absent',outcome:null,executionErrorCode:null,events:[],checkpoint:null,persistenceErrorCode:null,stopped:null,resourceDisposition:{status:'released',operationId:'legacy',leaseId:'legacy',turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,proofId:'runtime-absent',releasedAt:1}});

function namespace(ctxName:string,calls:string[]=[]){return {idFromName(name:string){calls.push(name);return {equals(other:unknown){return !!other&&typeof other==='object'&&(other as {name?:unknown}).name===name;}};},ctx:{id:{name:ctxName},storage:{}} as unknown as DurableObjectState};}
function sqliteState(name:string){const db=new DatabaseSync(':memory:'),storage={sql:{exec(query:string,...bindings:(string|number|null)[]){if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}const statement=db.prepare(query),rows=statement.columns().length?statement.all(...bindings):(statement.run(...bindings),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}},async sync(){},async setAlarm(){},async deleteAlarm(){}} as unknown as ProductTurnRuntimeStorage;return {db,ctx:{id:{name},storage} as unknown as DurableObjectState};}

test('server rejects a wrong actor and an unconfigured release before touching SQLite',async()=>{
  const expected=await turnRuntimeActorName(identity),wrong=namespace('wrong-actor'),right=namespace(expected);let releases=0;
  const wrongHost=new ProductTurnRuntimeHost(wrong.ctx,{PRODUCT_TURN_RUNTIME:wrong as never},()=>{releases++;throw Error('must-not-run');});
  await assert.rejects(wrongHost.accept(request),/actor-scope-denied/);assert.equal(releases,0);
  const rightHost=new ProductTurnRuntimeHost(right.ctx,{PRODUCT_TURN_RUNTIME:right as never},()=>{releases++;throw Error('product-turn-runtime-release-not-configured');});
  await assert.rejects(rightHost.accept(request),/release-not-configured/);assert.equal(releases,0);
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
  assert.match(durable,/release-gated/);assert.match(host,/M2_TURNS_ENABLED/);assert.match(host,/product-turn-runtime-release-not-configured/);assert.doesNotMatch(release,/M2_TURNS_ENABLED!=='true'/);
  const imports=`${durable}\n${host}\n${release}`.split('\n').filter(line=>line.startsWith('import ')).join('\n');assert.doesNotMatch(imports,/\.\.\/runtime\/durable|\bProjectRuntime\b/);
});

test('gate false rejects a fresh actor but permits maintenance of an existing saved runtime',async()=>{
  const expected=await turnRuntimeActorName(identity),fresh=sqliteState(expected);let factories=0;
  const ports=()=>({execution:{async start(){return {identity,phase:'terminal' as const,outcome:'completed' as const,events:[],stopped:{confirmationId:'stop-a',observedAt:Date.now(),nativeRunning:false as const,fenced:true as const}};},async observe(){throw Error('native-observe-must-not-run');},async cancel(){throw Error('native-cancel-must-not-run');},async release(){return {running:false};}},checkpoints:{async prepare(){return {operationId:`commit:${identity.scope.tenantId}:${identity.scope.projectId}:${identity.scope.workspaceId}:${identity.generation}:${identity.sessionId}:${identity.turnId}:${identity.dispatchId}`,inputSha256:'a'.repeat(64)};},async commit(){return {revisionId:'revision-a',objectKey:'turns/revision-a.json',filesSha256:'b'.repeat(64),sessionSha256:'c'.repeat(64),committedAt:Date.now()};},async reconcile(){return null;}}});
  const blocked=new ProductTurnRuntimeHost(fresh.ctx,{PRODUCT_TURN_RUNTIME:{idFromName(){return {equals(){return true;}};}},M2_TURNS_ENABLED:'false'},()=>{factories++;return ports();});
  await assert.rejects(blocked.accept(request),/release-not-configured/);assert.equal(factories,0);assert.equal(fresh.db.prepare("SELECT count(*) count FROM sqlite_master WHERE name='product_turn_runtime'").get()!.count,0);
  const existing=sqliteState(expected),enabled=new ProductTurnRuntimeHost(existing.ctx,{PRODUCT_TURN_RUNTIME:{idFromName(){return {equals(){return true;}};}},M2_TURNS_ENABLED:'true'},()=>ports());
  assert.equal((await enabled.accept(request)).phase,'terminal');
  existing.db.exec("UPDATE product_turn_release SET value=json_set(value,'$.begunAt',1,'$.nextAttemptAt',1,'$.absentSince',1)");
  let maintenanceReleases=0;const paused=new ProductTurnRuntimeHost(existing.ctx,{PRODUCT_TURN_RUNTIME:{idFromName(){return {equals(){return true;}};}},M2_TURNS_ENABLED:'false'},()=>{const value=ports();value.execution.release=async()=>{maintenanceReleases++;return {running:false};};return value;});
  await paused.alarm();assert.equal(maintenanceReleases,1);const released=JSON.parse(existing.db.prepare('SELECT value FROM product_turn_release').get()!.value as string);assert.ok(released.releasedAt);assert.equal(released.status,'released');
});

test('fresh admission requires exact true before factory or SQLite mutation',async()=>{
  for(const gate of [undefined,null,false,true,'TRUE',' true ','false']){
    const expected=await turnRuntimeActorName(identity),fresh=sqliteState(expected);let factories=0;const env={PRODUCT_TURN_RUNTIME:{idFromName(){return {equals(){return true;}};}},...(gate===undefined?{}:{M2_TURNS_ENABLED:gate})};
    await assert.rejects(new ProductTurnRuntimeHost(fresh.ctx,env as never,()=>{factories++;throw Error('factory-must-not-run');}).accept(request),/release-not-configured/);assert.equal(factories,0);assert.equal(fresh.db.prepare("SELECT count(*) count FROM sqlite_master WHERE name='product_turn_runtime'").get()!.count,0);
  }
});


test('cold observer on absent actor reads schema only and never initializes storage or release',async()=>{
 const expected=await turnRuntimeActorName(identity),right=namespace(expected),queries:string[]=[];let releases=0;
 const ctx={...right.ctx,storage:{sql:{exec(query:string){queries.push(query);return {toArray:()=>[]};}},transactionSync(){throw Error('unexpected write');},async sync(){throw Error('unexpected sync');}}} as unknown as DurableObjectState;
 const host=new ProductTurnRuntimeHost(ctx,{PRODUCT_TURN_RUNTIME:right as never},()=>{releases++;throw Error('unexpected release');});
 await assert.rejects(host.currentObserverExecution(identity),/observer-denied/);assert.equal(releases,0);assert.equal(queries.length,1);assert.match(queries[0]!,/^SELECT name FROM sqlite_master/);
});
