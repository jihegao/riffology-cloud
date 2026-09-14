import type {TurnOperationTrace} from '../turn/operation-telemetry.ts';
import {sameTurnRuntimeIdentity,turnRuntimeIdentity,type TurnRuntimeIdentity} from './identity.ts';
import {turnBaseCheckpoints,turnDigest,sha,turnId,type TurnBaseCheckpoints} from '../turn/protocol.ts';
import {sandboxActorIds} from '../sandbox/identity.ts';
import {ProjectWorkspaceLifecycle,type ProjectWorkspaceRpc} from './workspace.ts';

export type ProjectPreparationReceipt={operationId:string;sha256:string;bytes:number};
export type ProjectPreparationObservation={status:'ready';receipt:ProjectPreparationReceipt}|{status:'unknown'|'closed'};
export interface LazyProjectRpc extends ProjectWorkspaceRpc{
  prepareWorkspaceOnce(identity:TurnRuntimeIdentity,base:TurnBaseCheckpoints,archive:Uint8Array|null,operationId:string,deadlineAt:number):Promise<ProjectPreparationObservation>;
  observeWorkspacePreparation(identity:TurnRuntimeIdentity,operationId:string):Promise<ProjectPreparationObservation>;
}
type Storage=Pick<DurableObjectStorage,'kv'|'transactionSync'|'sync'|'sql'>;
type State={schemaVersion:1;identity:TurnRuntimeIdentity;mode:'lazy'|'eager';base:TurnBaseCheckpoints|null;operationId:string|null;status:'unrequested'|'reserved'|'unknown'|'ready';closed:boolean;receipt:ProjectPreparationReceipt|null};
const KEY='product-project-preparation-v1';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function projectPreparationReceipt(raw:ProjectPreparationReceipt){if(!raw||Object.keys(raw).sort().join(',')!=='bytes,operationId,sha256'||!Number.isSafeInteger(raw.bytes)||raw.bytes<1||raw.bytes>56*1024*1024)throw Error('project-preparation-receipt-invalid');return {operationId:turnId(raw.operationId),sha256:sha(raw.sha256),bytes:raw.bytes};}
async function emptyArchiveSha(){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(10240)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
/** A separate durable dispatch protocol, selected before native admission.
 * Legacy runtime rows keep eager preparation even after the feature is enabled. */
export class LazyProjectLifecycle{
  #active:Promise<void>|null=null;
  private storage:Storage;private identity:TurnRuntimeIdentity;private workspace:ProjectWorkspaceLifecycle;private resolve:(actorId:string)=>LazyProjectRpc;private trace?:TurnOperationTrace;
  constructor(storage:Storage,identity:TurnRuntimeIdentity,workspace:ProjectWorkspaceLifecycle,resolve:(actorId:string)=>LazyProjectRpc,enabled:boolean,trace?:TurnOperationTrace){
    this.storage=storage;this.identity=turnRuntimeIdentity(identity);this.workspace=workspace;this.resolve=resolve;this.trace=trace;
    storage.transactionSync(()=>{
      const saved=this.read();if(saved)return;
      const exists=storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_runtime'").toArray().length&&storage.sql.exec('SELECT singleton FROM product_turn_runtime WHERE singleton=1').toArray().length;
      storage.kv.put(KEY,{schemaVersion:1,identity:this.identity,mode:enabled&&!exists?'lazy':'eager',base:null,operationId:null,status:'unrequested',closed:false,receipt:null} satisfies State);
    });
  }
  private read():State|null{
    const s=this.storage.kv.get<State>(KEY);if(!s)return null;
    if(Object.keys(s).sort().join(',')!=='base,closed,identity,mode,operationId,receipt,schemaVersion,status'||s.schemaVersion!==1||!sameTurnRuntimeIdentity(turnRuntimeIdentity(s.identity),this.identity)||!['lazy','eager'].includes(s.mode)||!['unrequested','reserved','unknown','ready'].includes(s.status)||typeof s.closed!=='boolean')throw Error('project-preparation-state-invalid');
    if(s.base!==null)turnBaseCheckpoints(s.base);if(s.operationId!==null)turnId(s.operationId);if(s.receipt!==null)projectPreparationReceipt(s.receipt);if(s.status==='ready'&&!s.receipt||s.status!=='unrequested'&&(!s.base||!s.operationId))throw Error('project-preparation-state-invalid');return s;
  }
  private async change(fn:(s:State)=>void){this.storage.transactionSync(()=>{const s=this.read()!;fn(s);this.storage.kv.put(KEY,s);});await this.storage.sync();}
  private emit(metric:'project_prepare_result'|'project_skipped_count',started:number,value:number){try{this.trace?.({route:'turn.operation',metric,stage:'project-preparation',reasonCategory:'none',attempt:1,durationMs:Math.max(0,Math.min(1_000_000_000,Math.floor(performance.now()-started))),value,correlationId:this.identity.dispatchId});}catch{}}
  get lazy(){return this.read()!.mode==='lazy';}
  async prepare(identity:TurnRuntimeIdentity,rawBase:TurnBaseCheckpoints){
    this.bound(identity);if(!this.lazy)return this.workspace.prepare(identity,rawBase);
    const base=turnBaseCheckpoints(rawBase);await this.workspace.verifiedBase(identity,base);
    const operationId='prepare-'+(await turnDigest({identity,base,purpose:'lazy-project'})).slice(0,56);
    await this.change(s=>{if(s.closed)throw Error('project-preparation-closed');if(s.base&&!same(s.base,base))throw Error('project-preparation-conflict');s.base=base;s.operationId=operationId;});
  }
  private bound(identity:TurnRuntimeIdentity){if(!sameTurnRuntimeIdentity(turnRuntimeIdentity(identity),this.identity))throw Error('project-preparation-scope-denied');}
  private async target(){return this.resolve((await sandboxActorIds(this.identity.scope,this.identity.turnId,this.identity.dispatchId)).project);}
  /** authorize reads the Runtime's persisted cancel/terminal/deadline state.
   * An observe-only delivery cannot reserve preparation or replay restore. */
  async ensure(deadlineAt:number,observeOnly:boolean,authorize:()=>void){
    authorize();if(!this.lazy)return;
    if(this.#active){await this.#active;authorize();return;}
    const work=this.advance(deadlineAt,observeOnly,authorize);this.#active=work;
    try{await work;}finally{if(this.#active===work)this.#active=null;}
  }
  private async advance(deadlineAt:number,observeOnly:boolean,authorize:()=>void){
    const started=performance.now();const initial=this.read()!;if(initial.closed||!initial.base||!initial.operationId)throw Error('project-preparation-closed');
    if(initial.status==='ready'){authorize();return;}
    if(observeOnly&&initial.status==='unrequested')throw Error('project-preparation-unknown');
    const dispatch=initial.status==='unrequested';
    if(dispatch)await this.change(s=>{authorize();if(s.closed||s.status!=='unrequested')throw Error('project-preparation-conflict');s.status='reserved';});
    try{
      authorize();const state=this.read()!,target=await this.target();authorize();
      const archive=dispatch?await this.workspace.verifiedBase(this.identity,state.base!):null;authorize();
      const observed=dispatch?await target.prepareWorkspaceOnce(this.identity,state.base!,archive,state.operationId!,deadlineAt):await target.observeWorkspacePreparation(this.identity,state.operationId!);
      authorize();if(observed.status!=='ready')throw Error('project-preparation-unknown');const receipt=projectPreparationReceipt(observed.receipt),expectedSha=state.base!.workspace?.filesSha256??state.base!.initial?.filesSha256??await emptyArchiveSha();authorize();if(receipt.operationId!==state.operationId||receipt.sha256!==expectedSha)throw Error('project-preparation-unknown');
      await this.change(s=>{authorize();if(s.closed)throw Error('project-preparation-closed');s.status='ready';s.receipt=receipt;});this.emit('project_prepare_result',started,1);
    }catch(error){await this.change(s=>{if(s.status!=='ready')s.status='unknown';});this.emit('project_prepare_result',started,0);throw error;}
  }
  async frozenFiles(identity:TurnRuntimeIdentity,rawBase:TurnBaseCheckpoints){
    this.bound(identity);if(!this.lazy)return this.workspace.frozenFiles(identity,rawBase);
    const base=turnBaseCheckpoints(rawBase);await this.change(s=>{if(!same(s.base,base))throw Error('project-preparation-conflict');s.closed=true;});
    const s=this.read()!;
    if(s.status==='unrequested'){const started=performance.now(),files=await this.workspace.verifiedBase(identity,base)??new Uint8Array(10240);this.emit('project_skipped_count',started,1);return files;}
    if(s.status!=='ready')throw Error('project-preparation-unknown');
    return this.workspace.frozenFiles(identity,base);
  }
  async abort(identity:TurnRuntimeIdentity){
    this.bound(identity);if(!this.lazy)return this.workspace.abort(identity);
    await this.change(s=>{s.closed=true;});if(this.read()!.status==='unrequested')return;
    await this.workspace.abort(identity);
  }
}
