import { sameTurnRuntimeIdentity, turnRuntimeIdentity, type TurnRuntimeIdentity } from '../turn-runtime/identity.ts';

export type TurnSandboxFenceStorage=Pick<DurableObjectStorage,'kv'|'transactionSync'|'sync'>;
type DispatchIdentity=Pick<TurnRuntimeIdentity,'scope'|'turnId'|'dispatchId'|'generation'>;
type CancelState='idle'|'pending'|'confirmed';
type FenceState={identity:TurnRuntimeIdentity|null;dispatch:DispatchIdentity;fenced:boolean;cancelState:CancelState};
const KEY='turn-sandbox-fence-v1';

function reject(code:string):never{throw Error(code);}
function dispatch(raw:Pick<TurnRuntimeIdentity,'scope'|'turnId'|'dispatchId'>):DispatchIdentity{
  const identity=turnRuntimeIdentity({...raw,sessionId:'sandbox-fence',generation:raw.scope.workspaceGeneration});
  return {scope:identity.scope,turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation};
}
function sameDispatch(a:DispatchIdentity,b:DispatchIdentity):boolean{return JSON.stringify(a)===JSON.stringify(b);}
function state(value:unknown):FenceState|null{
  if(value===undefined)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-turn-sandbox-fence');
  const raw=value as Record<string,unknown>;
  if(raw.schemaVersion===1){
    const keys=['schemaVersion','identity','fenced'];if(Object.keys(raw).length!==keys.length||keys.some(key=>!Object.hasOwn(raw,key))||typeof raw.fenced!=='boolean')reject('invalid-turn-sandbox-fence');
    const identity=turnRuntimeIdentity(raw.identity);return {identity,dispatch:dispatch(identity),fenced:raw.fenced,cancelState:'idle'};
  }
  const version=raw.schemaVersion,keys=version===2?['schemaVersion','dispatch','sessionId','fenced']:version===3?['schemaVersion','dispatch','sessionId','fenced','cancelReserved']:['schemaVersion','dispatch','sessionId','fenced','cancelState'];
  if((version!==2&&version!==3&&version!==4)||Object.keys(raw).length!==keys.length||keys.some(key=>!Object.hasOwn(raw,key))||typeof raw.fenced!=='boolean'||(version===3&&typeof raw.cancelReserved!=='boolean')||(version===4&&!['idle','pending','confirmed'].includes(raw.cancelState as string))||(raw.sessionId!==null&&typeof raw.sessionId!=='string'))reject('invalid-turn-sandbox-fence');
  const bound=dispatch(raw.dispatch as DispatchIdentity),identity=raw.sessionId===null?null:turnRuntimeIdentity({...bound,sessionId:raw.sessionId});
  // Schema 3 persisted intent before attempting SIGTERM, so a reserved bit is
  // only evidence of unresolved delivery and must remain retryable.
  return {identity,dispatch:bound,fenced:raw.fenced,cancelState:version===4?raw.cancelState as CancelState:version===3&&raw.cancelReserved?'pending':'idle'};
}
function release(value:unknown):{running:boolean}{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||typeof (value as {running?:unknown}).running!=='boolean')reject('invalid-turn-sandbox-release');
  return {running:(value as {running:boolean}).running};
}

/** Actor-local fence for lifecycle-affecting Sandbox calls. The durable bit
 * prevents calls delivered after a restart; the in-memory counter keeps a
 * release proof pending while an earlier RPC can still resume in this actor. */
export class TurnSandboxFence{
  readonly #storage:TurnSandboxFenceStorage;
  #inFlight=0;#cleanupTail:Promise<void>=Promise.resolve();#activeCancel:Promise<{dispatched:boolean}>|null=null;
  constructor(storage:TurnSandboxFenceStorage){if(!storage?.kv||!storage.transactionSync||!storage.sync)reject('turn-sandbox-fence-storage-required');this.#storage=storage;}
  #read(expected?:TurnRuntimeIdentity):FenceState|null{
    const saved=state(this.#storage.kv.get<unknown>(KEY));
    if(saved&&expected&&(!sameDispatch(saved.dispatch,dispatch(expected))||(saved.identity!==null&&!sameTurnRuntimeIdentity(saved.identity,expected))))reject('turn-sandbox-fence-scope-denied');
    return saved;
  }
  async #bind(raw:TurnRuntimeIdentity,fenced:boolean):Promise<TurnRuntimeIdentity>{
    const identity=turnRuntimeIdentity(raw);
    this.#storage.transactionSync(()=>{const saved=this.#read(identity);if(saved?.fenced&&!fenced)reject('turn-sandbox-fenced');if(!saved)this.#storage.kv.put(KEY,{schemaVersion:4,dispatch:dispatch(identity),sessionId:identity.sessionId,fenced,cancelState:'idle'});else if(saved.identity===null||fenced&&!saved.fenced||saved.cancelState!=='idle')this.#storage.kv.put(KEY,{schemaVersion:4,dispatch:saved.dispatch,sessionId:identity.sessionId,fenced:fenced||saved.fenced,cancelState:saved.cancelState});});
    await this.#storage.sync();return identity;
  }
  async #cleanup<T>(operation:()=>Promise<T>):Promise<T>{
    const result=this.#cleanupTail.catch(()=>{}).then(operation);this.#cleanupTail=result.then(()=>{},()=>{});return result;
  }
  async assertOpen(raw:TurnRuntimeIdentity):Promise<void>{const identity=turnRuntimeIdentity(raw);if(this.#read(identity)?.fenced)reject('turn-sandbox-fenced');}
  /** Owns one logical native cancellation below the ProductRuntime -> Sandbox
   * RPC boundary. Pending delivery is retryable after actor loss: the operation
   * must observe the exact process and signal only while it is still active. */
  async cancelOnce(raw:TurnRuntimeIdentity,operation:()=>Promise<boolean>):Promise<{dispatched:boolean}>{
    const identity=await this.#bind(raw,false),saved=this.#read(identity)!;if(saved.cancelState==='confirmed')return {dispatched:false};if(this.#activeCancel)return this.#activeCancel;
    const pending=this.#reconcileCancel(identity,operation).finally(()=>{if(this.#activeCancel===pending)this.#activeCancel=null;});this.#activeCancel=pending;return pending;
  }
  async #reconcileCancel(identity:TurnRuntimeIdentity,operation:()=>Promise<boolean>):Promise<{dispatched:boolean}>{
    this.#storage.transactionSync(()=>{const saved=this.#read(identity)!;if(saved.fenced)reject('turn-sandbox-fenced');if(saved.cancelState==='idle')this.#storage.kv.put(KEY,{schemaVersion:4,dispatch:saved.dispatch,sessionId:identity.sessionId,fenced:false,cancelState:'pending'});});await this.#storage.sync();
    if(this.#read(identity)?.fenced)reject('turn-sandbox-fenced');this.#inFlight++;
    try{const dispatched=await operation();this.#storage.transactionSync(()=>{const saved=this.#read(identity)!;if(saved.fenced)reject('turn-sandbox-fenced');this.#storage.kv.put(KEY,{schemaVersion:4,dispatch:saved.dispatch,sessionId:identity.sessionId,fenced:false,cancelState:'confirmed'});});await this.#storage.sync();return {dispatched};}
    finally{this.#inFlight--;}
  }
  identityForDispatch(raw:Pick<TurnRuntimeIdentity,'scope'|'turnId'|'dispatchId'>):TurnRuntimeIdentity{
    const saved=this.#read();if(!saved||saved.identity===null)reject('turn-sandbox-unbound');
    if(!sameDispatch(saved.dispatch,dispatch(raw)))reject('turn-sandbox-fence-scope-denied');return structuredClone(saved.identity);
  }
  isFenced(raw:TurnRuntimeIdentity):boolean{const identity=turnRuntimeIdentity(raw);return this.#read(identity)?.fenced===true;}
  isDispatchFenced(raw:Pick<TurnRuntimeIdentity,'scope'|'turnId'|'dispatchId'>):boolean{
    const expected=dispatch(raw),saved=this.#read();if(!saved)return false;if(!sameDispatch(saved.dispatch,expected))reject('turn-sandbox-fence-scope-denied');return saved.fenced;
  }
  async runDispatch<T>(raw:Pick<TurnRuntimeIdentity,'scope'|'turnId'|'dispatchId'>,operation:()=>Promise<T>,cleanup:()=>Promise<{running:boolean}>):Promise<T>{
    const expected=dispatch(raw);this.#storage.transactionSync(()=>{const saved=this.#read();if(saved&&!sameDispatch(saved.dispatch,expected))reject('turn-sandbox-fence-scope-denied');if(saved?.fenced)reject('turn-sandbox-fenced');if(!saved)this.#storage.kv.put(KEY,{schemaVersion:4,dispatch:expected,sessionId:null,fenced:false,cancelState:'idle'});});await this.#storage.sync();
    const saved=this.#read();if(!saved||!sameDispatch(saved.dispatch,expected)||saved.fenced)reject('turn-sandbox-fenced');this.#inFlight++;
    let value:T,fenced=false;try{value=await operation();fenced=this.#read()?.fenced===true;}finally{if(this.#read()?.fenced)try{await this.#cleanup(cleanup);}catch{}this.#inFlight--;}
    if(fenced)reject('turn-sandbox-fenced');return value!;
  }
  async run<T>(raw:TurnRuntimeIdentity,operation:()=>Promise<T>,cleanup:()=>Promise<{running:boolean}>):Promise<T>{
    const identity=await this.#bind(raw,false);
    // No await between the last durable check and the in-flight reservation.
    if(this.#read(identity)?.fenced)reject('turn-sandbox-fenced');this.#inFlight++;
    let value:T,fenced=false;
    try{
      value=await operation();fenced=this.#read(identity)?.fenced===true;
    }finally{
      if(this.#read(identity)?.fenced)try{await this.#cleanup(cleanup);}catch{}
      this.#inFlight--;
    }
    if(fenced)reject('turn-sandbox-fenced');return value!;
  }
  async fence(raw:TurnRuntimeIdentity,cleanup:()=>Promise<{running:boolean}>):Promise<{running:boolean}>{
    const identity=await this.#bind(raw,true),observed=release(await this.#cleanup(cleanup));this.#read(identity);
    return {running:observed.running||this.#inFlight>0};
  }
}
