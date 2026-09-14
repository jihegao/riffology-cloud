import {sameTurnRuntimeIdentity,turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {turnBaseCheckpoints,turnDigest,turnId,type TurnBaseCheckpoints} from '../turn/protocol.ts';
import {projectPreparationReceipt,type ProjectPreparationObservation,type ProjectPreparationReceipt} from '../turn-runtime/lazy-project.ts';
type Storage=Pick<DurableObjectStorage,'kv'|'transactionSync'|'sync'>;
type Record={schemaVersion:1;identity:TurnRuntimeIdentity;operationId:string;inputSha256:string;status:'reserved'|'ready';closed:boolean;receipt:ProjectPreparationReceipt|null};
const KEY='project-workspace-preparation-v1',CLOSED='project-workspace-preparation-closed-v1';
/** Actor-local once-only restore receipt. Observe never invokes a native read,
 * SDK session, or container start. An interrupted restore remains unknown. */
export class ProjectPreparationLedger{
  private storage:Storage;private running:()=>boolean;private active:Promise<ProjectPreparationObservation>|null=null;
  constructor(storage:Storage,running:()=>boolean){this.storage=storage;this.running=running;}
  private read(identity:TurnRuntimeIdentity,operationId?:string){
    const saved=this.storage.kv.get<Record>(KEY);if(!saved)return null;
    if(saved.schemaVersion!==1||!sameTurnRuntimeIdentity(turnRuntimeIdentity(saved.identity),identity)||operationId!==undefined&&saved.operationId!==operationId||!['reserved','ready'].includes(saved.status)||typeof saved.closed!=='boolean')throw Error('project-preparation-conflict');return saved;
  }
  private closed(identity:TurnRuntimeIdentity){const saved=this.storage.kv.get<TurnRuntimeIdentity>(CLOSED);if(!saved)return false;if(!sameTurnRuntimeIdentity(turnRuntimeIdentity(saved),identity))throw Error('project-preparation-conflict');return true;}
  observe(raw:TurnRuntimeIdentity,operationId:string):ProjectPreparationObservation{
    const identity=turnRuntimeIdentity(raw),saved=this.read(identity,turnId(operationId));
    if(this.closed(identity)||saved?.closed)return {status:'closed'};
    return saved?.status==='ready'&&saved.receipt&&this.running()?{status:'ready',receipt:saved.receipt}:{status:'unknown'};
  }
  assertDispatchUsable(raw:Pick<TurnRuntimeIdentity,'scope'|'turnId'|'dispatchId'>){const saved=this.storage.kv.get<Record>(KEY);if(this.storage.kv.get(CLOSED))throw Error('project-preparation-unavailable');if(!saved)return;if(JSON.stringify(raw.scope)!==JSON.stringify(saved.identity.scope)||raw.turnId!==saved.identity.turnId||raw.dispatchId!==saved.identity.dispatchId)throw Error('project-preparation-conflict');this.assertUsable(saved.identity);}
  assertUsable(identity:TurnRuntimeIdentity){const saved=this.read(identity);if(this.closed(identity)||saved&&(saved.closed||saved.status!=='ready'||!this.running()))throw Error('project-preparation-unavailable');}
  async close(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);this.storage.transactionSync(()=>{const s=this.read(identity);this.closed(identity);this.storage.kv.put(CLOSED,identity);if(s)this.storage.kv.put(KEY,{...s,closed:true});});await this.storage.sync();}
  async prepare(raw:TurnRuntimeIdentity,rawBase:TurnBaseCheckpoints,operationId:string,deadlineAt:number,restore:()=>Promise<{sha256:string;bytes:number}>):Promise<ProjectPreparationObservation>{
    const identity=turnRuntimeIdentity(raw),base=turnBaseCheckpoints(rawBase);turnId(operationId);
    if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now())throw Error('project-preparation-expired');
    const inputSha256=await turnDigest({identity,base,operationId,deadlineAt});let dispatch=false;
    this.storage.transactionSync(()=>{if(this.closed(identity))throw Error('project-preparation-closed');const saved=this.read(identity,operationId);if(saved){if(saved.inputSha256!==inputSha256)throw Error('project-preparation-conflict');return;}dispatch=true;this.storage.kv.put(KEY,{schemaVersion:1,identity,operationId,inputSha256,status:'reserved',closed:false,receipt:null} satisfies Record);});
    if(!dispatch)return this.active??this.observe(identity,operationId);
    const work=(async()=>{await this.storage.sync();if(this.read(identity)?.closed||Date.now()>=deadlineAt)throw Error('project-preparation-expired');const receipt=projectPreparationReceipt({operationId,...await restore()});
      this.storage.transactionSync(()=>{const saved=this.read(identity,operationId)!;if(saved.closed||Date.now()>=deadlineAt||!this.running())throw Error('project-preparation-closed');this.storage.kv.put(KEY,{...saved,status:'ready',receipt});});await this.storage.sync();return this.observe(identity,operationId);
    })();this.active=work;try{return await work;}finally{if(this.active===work)this.active=null;}
  }
}
