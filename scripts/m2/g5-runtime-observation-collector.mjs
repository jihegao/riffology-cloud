import {createHash} from 'node:crypto';
const ORIGIN='https://m1.riff-demo.gaojihe.cn';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const HASH=/^[a-f0-9]{64}$/;
const STATUS=new Set(['queued','running','cancelling','checkpointing','completed','failed','cancelled','interrupted']);
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const unavailableRuntimeFacts=Object.freeze(['warm-lease-and-pair-authority','binding-epoch-authority','native-project-pi-pid-start-identities','three-ledger-settlement-receipts','paired-fifo-capacity-rows','two-domain-native-absence-and-guard-proofs']);
/** One real, fixed-origin product GET. Does not invent a missing runtime RPC. */
export async function collectProductRuntimeObservation({workspaceId,cookie,fetchImpl=globalThis.fetch,now=()=>Date.now(),shouldAbort=()=>false}={}) {
  if(!ID.test(workspaceId??'')||typeof cookie!=='string'||cookie.length<8||cookie.length>8192||/[\r\n]/.test(cookie))throw Error('runtime-observation-auth-invalid');
  if(shouldAbort())throw Error('runtime-observation-aborted');
  const url=`${ORIGIN}/api/workspaces/${workspaceId}`,observedAt=now();
  const response=await fetchImpl(url,{method:'GET',headers:{cookie,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.url&&response.url!==url)throw Error('runtime-observation-response-origin-invalid');
  if(response.status!==200)throw Error('runtime-observation-product-get-failed');
  if(!response.body)throw Error('runtime-observation-body-missing');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024){await reader.cancel();throw Error('runtime-observation-snapshot-too-large');}chunks.push(Buffer.from(value));} } finally {reader.releaseLock();}
  const bytes=Buffer.concat(chunks,size);
  const snapshot=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(snapshot?.schemaVersion!==3||!object(snapshot.scope)||snapshot.scope.workspaceId!==workspaceId||!object(snapshot.turns)||!object(snapshot.sessions))throw Error('runtime-observation-snapshot-invalid');
  if(snapshot.activeTurnId!==null&&!ID.test(snapshot.activeTurnId??''))throw Error('runtime-observation-active-turn-invalid');
  const checkpoint=value=>{if(value===null)return null;if(!object(value)||!HASH.test(value.revisionId??'')||!HASH.test(value.filesSha256??'')||!HASH.test(value.sessionSha256??'')||!Number.isSafeInteger(value.committedAt)||value.committedAt<1)throw Error('runtime-observation-checkpoint-invalid');return {revisionId:value.revisionId,filesSha256:value.filesSha256,sessionSha256:value.sessionSha256,committedAt:value.committedAt};};
  for(const [turnId,turn] of Object.entries(snapshot.turns)){
    if(!ID.test(turnId)||!object(turn)||turn.id!==turnId||!ID.test(turn.sessionId??'')||!STATUS.has(turn.status)||!Object.hasOwn(turn,'checkpoint')||!Object.hasOwn(turn,'runtimeGeneration')||!(turn.runtimeGeneration===null||Number.isSafeInteger(turn.runtimeGeneration)&&turn.runtimeGeneration>0)||!['completed','failed','cancelled','interrupted',null].includes(turn.executionOutcome)||!['saved','failed',null].includes(turn.persistenceOutcome))throw Error('runtime-observation-turn-invalid');
    const session=snapshot.sessions[turn.sessionId];
    if(!object(session)||session.id!==turn.sessionId||session.scope?.workspaceId!==workspaceId||turn.scope?.workspaceId!==workspaceId)throw Error('runtime-observation-session-scope-invalid');
    checkpoint(turn.checkpoint);
  }
  if(shouldAbort())throw Error('runtime-observation-aborted');
  // Keep raw session/message content private; public projection contains no Cookie or message.
  const turns=Object.entries(snapshot.turns).map(([turnId,turn])=>({turnId,sessionId:turn.sessionId,status:turn.status,runtimeGeneration:turn.runtimeGeneration??null,executionOutcome:turn.executionOutcome??null,persistenceOutcome:turn.persistenceOutcome??null,checkpoint:checkpoint(turn.checkpoint)}));
  return {schemaVersion:1,status:'blocked',cloudAcceptance:false,qualificationOnly:true,source:{kind:'ordinary-authenticated-product-get',url,observedAt,httpStatus:200,rawSha256:createHash('sha256').update(bytes).digest('hex')},product:{activeTurnId:snapshot.activeTurnId??null,releaseHoldPresent:snapshot.releaseHold!==null&&snapshot.releaseHold!==undefined,recoveryHoldPresent:snapshot.recoveryHold!==null&&snapshot.recoveryHold!==undefined,turns},unavailableFacts:[...unavailableRuntimeFacts]};
}
