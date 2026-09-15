import {createHash} from 'node:crypto';
import {collectProductRuntimeObservation} from './g5-runtime-observation-collector.mjs';
const ORIGIN='https://m1.riff-demo.gaojihe.cn';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=value=>createHash('sha256').update(value).digest('hex');
const windows=[['warm-chain',10],['pure-conversation',1],['cold-control',2],['idle-recovery',1],['cancellation',3],['container-loss',2],['fairness',2],['cold-fallback',1]];
/** Immutable scenario plan, not executed intent records and not authorization. */
export function runtimeScenarioPlan(windowId){
  if(typeof windowId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(windowId))throw Error('runtime-window-id-invalid');
  return Object.freeze(windows.flatMap(([phase,count])=>Array.from({length:count},(_,i)=>{
    const intentKey=`g5-${windowId}-${phase}-${i+1}`,nonce=digest(intentKey).slice(0,32),file=`${intentKey}.txt`;
    return Object.freeze({intentKey,phase,index:i+1,sessionSlot:phase==='warm-chain'&&i>=5?2:1,requiresSessionSwitch:phase==='warm-chain'&&i===5,queuedNeverStart:phase==='cancellation'&&i===0,nonce,file,message:phase==='pure-conversation'?'Say one finite synthetic greeting without calling any tools.':`Make exactly one successful project_write to ${file} containing ${nonce}, then exactly one successful project_read of that file. Include ${nonce} in your final response. If a tool fails stop without retrying. Do not make other mutations.`});
  })));
}
/** Ordinary read-only reconciliation: uncertainty remains uncertainty; absence never authorizes replay. */
export function reconcileTurnIntent(intent,observation){
  const turns=observation?.product?.turns;
  if(!Array.isArray(turns))throw Error('runtime-reconcile-observation-invalid');
  if(!intent?.turnId)return {state:'unknown',reason:'submission-identity-not-reconciled',mayResubmit:false};
  const matches=turns.filter(turn=>turn.turnId===intent.turnId);
  if(matches.length!==1)return {state:'unknown',reason:'turn-identity-absent-or-conflicting',mayResubmit:false};
  const turn=matches[0];
  if(turn.sessionId!==intent.sessionId)return {state:'blocked',reason:'turn-session-mismatch',mayResubmit:false};
  return {state:['completed','failed','cancelled','interrupted'].includes(turn.status)?'terminal':'pending',turn,mayResubmit:false,cloudAcceptance:false};
}
/** Preparation entry point. The actual existing collector cannot provide native authority. */
export async function prepareRuntimeLiveWindow({windowId,auth,execute=false,fetchImpl=globalThis.fetch,shouldAbort=()=>false}={}){
  const plan=runtimeScenarioPlan(windowId);
  if(execute!==true)return {status:'blocked',reason:'explicit-execute-required',admittedTurns:0,cloudAcceptance:false};
  const observation=await collectProductRuntimeObservation({...auth,fetchImpl,shouldAbort});
  return {schemaVersion:1,status:'blocked',phase:'authority-preflight',reason:'runtime-authority-not-exposed',admittedTurns:0,plannedTurns:plan.length,observation,cloudAcceptance:false};
}
/** Dormant ordinary Turn transport for future reviewed authority adapter. Never retries a POST.
 * Persist-before-send journal methods must durably sync; runtime preflight does not invoke this.
 * Existing pending/unknown intents block even if HTTP idempotency could deduplicate them. */
export async function submitOrdinaryTurnOnce({workspaceId,sessionId,cookie,intent,journal,execute=false,fetchImpl=globalThis.fetch,shouldAbort=()=>false}={}){
  if(execute!==true)throw Error('turn-submit-explicit-execute-required');
  if(!UUID.test(workspaceId??'')||!UUID.test(sessionId??'')||typeof cookie!=='string'||cookie.length<8||cookie.length>8192||/[\r\n]/.test(cookie)||typeof intent?.intentKey!=='string'||!/^g5-[A-Za-z0-9_-]{1,150}$/.test(intent.intentKey)||typeof intent.message!=='string'||intent.message.length<1||intent.message.length>16000)throw Error('turn-submit-input-invalid');
  if(!journal?.read||!journal?.persist)throw Error('turn-submit-durable-journal-required');
  if(await journal.read(intent.intentKey))return {state:'reconcile-only',mayResubmit:false};
  if(shouldAbort())throw Error('turn-submit-aborted');
  const record={intentKey:intent.intentKey,workspaceId,sessionId,messageSha256:digest(intent.message),state:'delivery-unknown',turnId:null};
  await journal.persist(record); // Failure aborts before network; no replay on uncertain acknowledgement.
  if(shouldAbort())return {state:'delivery-unknown',mayResubmit:false};
  try{
    const url=`${ORIGIN}/api/workspaces/${workspaceId}/sessions/${sessionId}/turns`;
    const response=await fetchImpl(url,{method:'POST',headers:{cookie,origin:ORIGIN,accept:'application/json','content-type':'application/json','idempotency-key':intent.intentKey},body:JSON.stringify({message:intent.message}),redirect:'error',signal:AbortSignal.timeout(20000)});
    if(response.url&&response.url!==url||![200,202].includes(response.status))throw Error('turn-submit-response-unconfirmed');
    const body=await response.json();
    if(!UUID.test(body?.turn?.id??'')||body.turn.sessionId!==sessionId)throw Error('turn-submit-identity-unconfirmed');
    await journal.persist({...record,state:'submitted',turnId:body.turn.id});
    return {state:'submitted',turnId:body.turn.id,mayResubmit:false,cloudAcceptance:false};
  }catch{return {state:'delivery-unknown',mayResubmit:false,cloudAcceptance:false};}
}
