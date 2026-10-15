import {manualSaveRequest,manualDigest,type ManualSaveOperation,type ManualSaveRequest,type ManualSaveBase,type ManualRevisionReceipt,type ManualCommitInput,type ManualSaveRejection} from '../turn-runtime/manual-save.ts';
import type {TurnJournal} from '../turn/journal.ts';
import type {TurnScope,TurnActor} from '../turn/protocol.ts';

// Serialize replays with the original request through its external awaits. A
// receipt absent while another local commit is still in flight is not failure.
const queues=new WeakMap<object,Promise<unknown>>();
export function serializeManualSave<T>(owner:object,operation:()=>Promise<T>):Promise<T>{
 const prior=queues.get(owner)??Promise.resolve();
 const next=prior.catch(()=>{}).then(operation);queues.set(owner,next);
 void next.finally(()=>{if(queues.get(owner)===next)queues.delete(owner);}).catch(()=>{});return next;
}
export function manualOperationResult(operation:ManualSaveOperation){return {operationId:operation.identity.operationId,status:operation.status==='aborted'?'rejected' as const:operation.status,revisionId:operation.receipt?.revisionId??operation.base.revisionId,filesSha256:operation.receipt?.filesSha256??operation.base.filesSha256,source:'manual-save' as const};}
export function manualRejectionResult(rejection:ManualSaveRejection){return {operationId:rejection.identity.operationId,status:'rejected' as const,reasonCode:rejection.reasonCode,requestSha256:rejection.requestSha256,source:'manual-save' as const};}
const preflightErrors=new Set(['invalid-manual-save','invalid-manual-save-path','invalid-manual-save-content','invalid-manual-artifacts','invalid-turn-identifier','invalid-turn-sha','invalid-turn-integer','manual-save-limit','manual-save-base-conflict','manual-save-workspace-busy']);
type Prepared={filesArchive:Uint8Array;unchanged:boolean};
type Options={journal:TurnJournal;scope:TurnScope;actor:TurnActor;key:string;body:unknown;authorize:()=>Promise<void>;
 current:()=>Promise<{base:ManualSaveBase;prepare:(request:ManualSaveRequest)=>Promise<Prepared>}>;
 reconcile:(operation:ManualSaveOperation)=>Promise<ManualRevisionReceipt|null>;
 commit:(input:ManualCommitInput)=>Promise<ManualRevisionReceipt>;
 publish:(operation:ManualSaveOperation,receipt:ManualRevisionReceipt|null,status?:'committed'|'unchanged')=>Promise<ManualSaveOperation>;
 acquireFence:(operation:ManualSaveOperation)=>Promise<{state:'pending'|'released'}>;
 releaseFence:(operation:ManualSaveOperation)=>Promise<void>;
 abandonUnacquired:(operation:ManualSaveOperation)=>Promise<{state:'pending'|'released';terminal:{status:string;revisionId:string|null}|null}>;
};
/** Internal repair in the caller's serialized lane; never exposes old content. */
export async function recoverManualSaveAuthorization(options:Pick<Options,'journal'|'scope'|'actor'|'authorize'|'abandonUnacquired'>,key?:string){
 const {journal,scope,actor,authorize}=options;await authorize();
 for(const prior of journal.manualSaveRecoveryCandidates(scope,actor)){
  const proof=await options.abandonUnacquired(prior);
  if(proof.state!=='released'||proof.terminal?.status!=='aborted'||proof.terminal.revisionId!==null)throw Error('manual-save-workspace-busy');
  await journal.abortManualSave(scope,prior.identity.actor,prior.identity.operationId);
 }
 await authorize();
 return key!==undefined&&journal.manualSaveRecoveryCandidates(scope,actor,key).some(op=>op.status==='aborted');
}
export function retiredManualSaveResult(key:string,requestSha256?:string){return {operationId:key,status:'rejected' as const,reasonCode:'manual-save-authorization-changed',...(requestSha256?{requestSha256}:{}),source:'manual-save' as const};}
/** Caller supplies the existing journal and immutable store, never a second head. */
export async function runManualSave(options:Options){return serializeManualSave(options.journal,async()=>{
 const {journal,scope,actor,key,authorize}=options;
 const retired=await recoverManualSaveAuthorization(options,key);
 let operation:ManualSaveOperation|null=null,writeStarted=false,originalAbsent=false,fenced=false,compensated=false,requestSha256:string|undefined;
 const fence=async(op:ManualSaveOperation)=>{const result=await options.acquireFence(op);if(result.state==='released'&&op.status==='pending')throw Error('manual-save-fence-released-pending');fenced=true;};
 const finish=async(op:ManualSaveOperation)=>{operation=op;await options.releaseFence(op);return {...manualOperationResult(op),requestSha256};};
 try{
  const raw=JSON.stringify(options.body);if(typeof raw!=='string')throw Error('invalid-manual-save');requestSha256=await manualDigest(raw);
  if(retired)return retiredManualSaveResult(key,requestSha256);
  const rejection=journal.getManualSaveRejection(scope,actor,key);
  if(rejection){if(rejection.requestSha256!==requestSha256)throw Error('manual-save-idempotency-conflict');await authorize();return manualRejectionResult(rejection);}
  const request=manualSaveRequest(options.body),digest=await manualDigest(JSON.stringify(request));
  operation=journal.getManualSave(scope,actor,key);
  if(operation){
   if(operation.inputSha256!==digest)throw Error('manual-save-idempotency-conflict');
   await fence(operation);
   if(operation.status!=='pending'){await authorize();return await finish(operation);}
   const receipt=await options.reconcile(operation);
   if(receipt){await authorize();return await finish(await options.publish(operation,receipt));}
   originalAbsent=true;
  }
  const current=await options.current();
  if(operation&&JSON.stringify(operation.base)!==JSON.stringify(current.base))throw Error('manual-save-base-conflict');
  await authorize();
  if(!operation){operation=(await journal.reserveManualSave(scope,actor,key,request.base,digest,current.base)).operation;originalAbsent=true;await fence(operation);}
  const prepared=await current.prepare(request);
  if(prepared.unchanged){await authorize();return await finish(await options.publish(operation,null,'unchanged'));}
  await authorize();writeStarted=true;
  const receipt=await options.commit({identity:operation.identity,base:request.base,inputSha256:digest,filesArchive:prepared.filesArchive,artifacts:request.artifacts,committedAt:operation.createdAt});
  await authorize();return await finish(await options.publish(operation,receipt));
 }catch(error){
  if(operation?.status==='pending'&&!fenced&&!writeStarted){
   // Atomically tombstone an absent Catalog lease before releasing the journal
   // reservation. A pending lease (including a lost acquire ACK) stays held.
   const abandoned=await options.abandonUnacquired(operation);
   if(abandoned.state==='released'&&abandoned.terminal?.status==='aborted'&&abandoned.terminal.revisionId===null){operation=await journal.abortManualSave(scope,actor,key);compensated=true;}
  }
  // Auth errors never reveal an operation or convert unknown writes into failure.
  await authorize();
  if(compensated&&operation)return {...manualOperationResult(operation),requestSha256};
  if(operation?.status==='pending'&&!writeStarted){
   // This serial lane has observed no receipt and has not issued a new write.
   // A reconcile/fence failure is unknown and cannot authorize an abort.
   if(!originalAbsent||!fenced)throw error;
   return await finish(await journal.abortManualSave(scope,actor,key));
  }
  const original=journal.getManualSave(scope,actor,key),code=error instanceof Error?error.message:'';
  if(!original&&requestSha256&&preflightErrors.has(code)){const rejection=await journal.rejectManualSave(scope,actor,key,requestSha256,code);await authorize();return manualRejectionResult(rejection);}
  throw error;
 }
 });}
