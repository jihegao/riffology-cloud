import {createHash} from 'node:crypto';
const ORIGIN='https://m1.riff-demo.gaojihe.cn';
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
  const snapshot=JSON.parse(bytes.toString('utf8'));
  if(snapshot?.schemaVersion!==3||!snapshot.turns||typeof snapshot.turns!=='object'||!snapshot.sessions||typeof snapshot.sessions!=='object')throw Error('runtime-observation-snapshot-invalid');
  // Keep raw session/message content private; public projection contains no Cookie or message.
  const turns=Object.entries(snapshot.turns).map(([turnId,turn])=>({turnId,sessionId:turn.sessionId,status:turn.status,runtimeGeneration:turn.runtimeGeneration??null,executionOutcome:turn.executionOutcome??null,persistenceOutcome:turn.persistenceOutcome??null,checkpoint:turn.checkpoint??null}));
  return {schemaVersion:1,status:'blocked',cloudAcceptance:false,qualificationOnly:true,source:{kind:'ordinary-authenticated-product-get',url,observedAt,httpStatus:200,rawSha256:createHash('sha256').update(bytes).digest('hex')},product:{activeTurnId:snapshot.activeTurnId??null,releaseHoldPresent:snapshot.releaseHold!==null&&snapshot.releaseHold!==undefined,recoveryHoldPresent:snapshot.recoveryHold!==null&&snapshot.recoveryHold!==undefined,turns},unavailableFacts:[...unavailableRuntimeFacts]};
}
