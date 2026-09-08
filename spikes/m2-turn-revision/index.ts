import { DurableObject } from 'cloudflare:workers';
import { ProductTurnRuntimeCore, type ProductTurnRuntimeStorage, type TurnCheckpointPort, type TurnExecutionObservation, type TurnExecutionPort } from '../../services/turn-runtime/core.ts';
import type { TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';
import { R2TurnRevisionPort, R2TurnRevisionReader, type FrozenTurnSnapshotPort } from '../../services/turn-runtime/revision.ts';
import { revisionCommitDigestInput, revisionCommitIntent } from '../../services/turn-runtime/revision-store-client.ts';
import { turnDigest } from '../../services/turn/protocol.ts';

interface Env{TURN_REVISION_PROBE:DurableObjectNamespace<TurnRevisionProbe>;TURN_REVISIONS:R2Bucket}
const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-local',projectId:'project-local',workspaceId:'workspace-local',workspaceGeneration:1},sessionId:'session-local',turnId:'turn-local',dispatchId:'dispatch-local',generation:1};
const actor={userId:'user-local',authVersion:1};
const encoder=new TextEncoder();

class FixtureExecution implements TurnExecutionPort{
  readonly #storage:ProductTurnRuntimeStorage;
  constructor(storage:ProductTurnRuntimeStorage){this.#storage=storage;storage.transactionSync(()=>storage.sql.exec('CREATE TABLE IF NOT EXISTS probe_counts (name TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT;'));}
  #increment(name:string){this.#storage.transactionSync(()=>this.#storage.sql.exec('INSERT INTO probe_counts VALUES(?,1) ON CONFLICT(name) DO UPDATE SET value=value+1',name));}
  #terminal(expected:TurnRuntimeIdentity):TurnExecutionObservation{const runtimeIdentity={scope:expected.scope,sessionId:expected.sessionId,turnId:expected.turnId,dispatchId:expected.dispatchId,generation:expected.generation};return {identity:runtimeIdentity,phase:'terminal',outcome:'completed',events:[{eventId:'event-local',type:'assistant.message',at:Date.now(),payload:{text:'local fixture completed'}}],stopped:{confirmationId:'stop-local',observedAt:Date.now(),nativeRunning:false,fenced:true}};}
  async start(input:TurnRuntimeIdentity&{actor:typeof actor;message:string}){this.#increment('start');await this.#storage.sync();return this.#terminal(input);}
  async observe(expected:TurnRuntimeIdentity){this.#increment('observe');await this.#storage.sync();return this.#terminal(expected);}
  async cancel(expected:TurnRuntimeIdentity){this.#increment('cancel');await this.#storage.sync();return this.#terminal(expected);}
}

export class TurnRevisionProbe extends DurableObject<Env>{
  readonly #runtime:ProductTurnRuntimeCore;
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);const storage=ctx.storage as ProductTurnRuntimeStorage,execution=new FixtureExecution(storage),snapshots:FrozenTurnSnapshotPort={freeze:async expected=>{storage.transactionSync(()=>storage.sql.exec('INSERT INTO probe_counts VALUES(?,1) ON CONFLICT(name) DO UPDATE SET value=value+1','freeze'));await storage.sync();return {identity:expected,filesArchive:encoder.encode('canonical-local-project-archive-v1'),piSession:encoder.encode('{"format":"riffology-pi-session-v1","fixture":true}')};}},reader=new R2TurnRevisionReader(env.TURN_REVISIONS),checkpoints:TurnCheckpointPort={
      async prepare(input){return revisionCommitIntent(input,await snapshots.freeze(input.identity,input.base));},
      async commit(input,intent){const snapshot=await snapshots.freeze(input.identity,input.base),actual=await revisionCommitIntent(input,snapshot);if(JSON.stringify(actual)!==JSON.stringify(intent))throw Error('revision-probe-intent-conflict');return new R2TurnRevisionPort(env.TURN_REVISIONS,{async freeze(){return snapshot;}}).commit(input);},
      async reconcile(expected,intent){const saved=await reader.inspect(expected);if(!saved)return null;const digest=await turnDigest(revisionCommitDigestInput({identity:expected,outcome:saved.outcome,executionErrorCode:saved.executionErrorCode,base:saved.base},saved.files.sha256,saved.files.size,saved.piSession.sha256,saved.piSession.size));if(digest!==intent.inputSha256)throw Error('revision-probe-intent-conflict');return saved.receipt;},
    };this.#runtime=new ProductTurnRuntimeCore(storage,execution,checkpoints);}
  #counts(){const rows=this.ctx.storage.sql.exec<{name:string;value:number}>('SELECT name,value FROM probe_counts ORDER BY name').toArray();return Object.fromEntries(rows.map(row=>[row.name,row.value]));}
  async accept(){const result=await this.#runtime.accept({...identity,actor,message:'Build the local revision fixture',base:{workspace:null,session:null}}),objects=await this.env.TURN_REVISIONS.list();return {result,counts:this.#counts(),objects:objects.objects.map(item=>({key:item.key,size:item.size})).sort((a,b)=>a.key.localeCompare(b.key))};}
  async observe(){const result=await this.#runtime.observe(identity),objects=await this.env.TURN_REVISIONS.list();return {result,counts:this.#counts(),objects:objects.objects.map(item=>({key:item.key,size:item.size})).sort((a,b)=>a.key.localeCompare(b.key))};}
}

export default {async fetch(request:Request,env:Env){const url=new URL(request.url);if(url.search)return new Response('not found',{status:404});const stub=env.TURN_REVISION_PROBE.getByName('m2-turn-revision-probe');if(request.method==='POST'&&url.pathname==='/accept')return Response.json(await stub.accept());if(request.method==='GET'&&url.pathname==='/observe')return Response.json(await stub.observe());return new Response('not found',{status:404});}} satisfies ExportedHandler<Env>;
