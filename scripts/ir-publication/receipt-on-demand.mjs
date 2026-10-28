/** Exact local operator demand/response files only. No browser, fetch or latest scan. */
import {open,mkdir,lstat,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {need,ownedBytes,pinned,sha,hashJSON,REQUEST,fresh,current,Stop,deepFreeze} from './local-guards.mjs';
export const QUIESCENCE_PATH='/api/admin/private-beta/maintenance/quiescence';
export const DEMAND_DIRECTORY='/private/tmp/riffoid-ir-quiescence-demands-20261019-560ada22';
export const RESPONSE_PREFIX='riffoid-ir-quiescence-demand-560ada22-';
const NONCE=/^[a-f0-9]{32}$/;
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&hashJSON(Object.keys(value).sort())===hashJSON([...expected].sort());
function descriptor(stream){
  need(stream&&['directory','prefix','demandDirectory'].every(k=>Object.hasOwn(stream,k))&&Object.keys(stream).every(k=>['directory','prefix','demandDirectory'].includes(k))&&stream.directory==='/Users/jihegao/Downloads'&&stream.prefix===RESPONSE_PREFIX&&stream.demandDirectory===DEMAND_DIRECTORY,'fixed-on-demand-operator-descriptor');return stream;
}
function assertLogical(q,facts){
  const fields=['actualContainerReleaseVerified','checkedAt','control','hold','ledger','ledgerBefore','native','quiescent','requestId','revision','schemaVersion'];
  need(keys(q,fields)&&q.schemaVersion===1&&q.requestId===REQUEST&&Number.isSafeInteger(q.checkedAt)&&q.revision===5&&q.quiescent===true&&q.actualContainerReleaseVerified===false,'actual-logical-quiescence-body');
  fresh(q.checkedAt);need(hashJSON(q.hold)===hashJSON(facts.newIrMaintenance.hold)&&hashJSON(q.control)===hashJSON(facts.newIrMaintenance.control),'same-actual-ir-hold-and-control');
  need(q.hold?.requestId===REQUEST&&q.hold.policySha256===q.control.policySha256&&q.hold.controlRevision===19&&q.control.revision===19&&q.control.policySha256===q.control.pinnedPolicySha256&&q.control.enabled===true&&q.control.paused===false,'same-active-original-ir-barrier');
  for(const ledger of [q.ledgerBefore,q.ledger])need(ledger?.scope==='original-beta-ledger-only'&&ledger.quiescent===true&&ledger.activeSlots===0&&ledger.quarantinedSlots===0&&ledger.unresolvedCalls===0,'actual-logical-ledgers-not-quiescent');
  need(q.native?.actor==='trusted-pi-capacity:application'&&typeof q.native.policyVersion==='string'&&q.native.policyVersion.length>0&&q.native.quiescent===true&&q.native.coldUnresolved===0&&q.native.pairUnresolved===0&&q.native.actualContainerReleaseVerified===false,'actual-native-ledger-not-quiescent');
}
function assertDemand(value,{stream,facts,phase,nonce}){
  need(keys(value,['schema','requestId','phase','demandNonce','notBefore','expiresAt','origin','method','path','targetFile','factsCore'])&&value.schema==='riffoid-ir.operator-quiescence-demand/v1'&&value.requestId===REQUEST&&value.phase===phase&&/^[a-z][a-z0-9-]{0,65}$/.test(phase)&&NONCE.test(nonce)&&value.demandNonce===nonce,'exact-original-operator-demand');
  need(Number.isSafeInteger(value.notBefore)&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>value.notBefore&&value.expiresAt-value.notBefore<=90000&&value.expiresAt<=Date.parse(facts.endsAt),'bounded-original-operator-demand');
  need(value.origin===facts.publicOrigin&&new URL(value.origin).origin===value.origin&&new URL(value.origin).protocol==='https:'&&value.method==='GET'&&value.path===QUIESCENCE_PATH&&value.targetFile===stream.prefix+nonce+'.json','fixed-operator-demand-target');
  need(keys(value.factsCore,['requestId','hold','control'])&&value.factsCore.requestId===REQUEST&&hashJSON(value.factsCore.hold)===hashJSON(facts.newIrMaintenance.hold)&&hashJSON(value.factsCore.control)===hashJSON(facts.newIrMaintenance.control),'same-demand-original-hold-control');
}
async function directory(){
  await mkdir(DEMAND_DIRECTORY,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const st=await lstat(DEMAND_DIRECTORY);need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0&&await realpath(DEMAND_DIRECTORY)===DEMAND_DIRECTORY,'private-canonical-demand-directory');
}
async function writeDemand(demand){
  await directory();const file=join(DEMAND_DIRECTORY,'demand-'+demand.demandNonce+'.json'),raw=Buffer.from(JSON.stringify(demand,null,2)+'\n'),h=await open(file,'wx',0o600);
  try{await h.writeFile(raw);await h.sync();}finally{await h.close();}
  const dir=await open(DEMAND_DIRECTORY,'r');try{await dir.sync();}finally{await dir.close();}return {file,bytes:raw.length,sha256:sha(raw)};
}
async function parseResponse(raw,{stream,facts,phase,nonce,reference,expectedDemandReference}){
  let value;try{value=JSON.parse(raw);}catch{throw new Stop('exact-operator-response-json');}
  need(keys(value,['schema','observedAt','method','path','requestId','httpStatus','body','demandNonce'])&&value.schema==='riffoid-ir.operator-browser-response/v1'&&value.method==='GET'&&value.path===QUIESCENCE_PATH&&value.requestId===REQUEST&&value.demandNonce===nonce&&value.httpStatus===200,'exact-operator-quiescence-response');
  const file=join(DEMAND_DIRECTORY,'demand-'+nonce+'.json');need(!expectedDemandReference||expectedDemandReference.file===file,'original-demand-reference-filename');const demandRaw=expectedDemandReference?await pinned(expectedDemandReference,16384):await ownedBytes(file,16384),demand=JSON.parse(demandRaw);assertDemand(demand,{stream,facts,phase,nonce});
  const at=fresh(value.observedAt);need(at>=demand.notBefore&&at<=demand.expiresAt,'operator-response-within-original-demand');assertLogical(value.body,facts);
  need(value.body.checkedAt>=demand.notBefore-2000&&value.body.checkedAt<=at+2000&&at-value.body.checkedAt<=15000,'operator-browser-and-server-demand-order');
  return {receipt:value,reference,raw,demand:deepFreeze(demand),demandReference:{file,bytes:demandRaw.length,sha256:sha(demandRaw)}};
}
function pause(signal,ms){return new Promise((resolve,reject)=>{const stop=()=>{clearTimeout(t);signal?.removeEventListener('abort',stop);reject(new Stop('exact-demand-wait-aborted'));},t=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});});}
export async function demandFreshQuiescence({stream,facts,phase,signal,deadline}={}){
  descriptor(stream);current(signal,deadline);need(/^[a-z][a-z0-9-]{0,65}$/.test(phase),'fixed-demand-phase');const notBefore=Date.now(),expiresAt=Math.min(deadline,notBefore+90000),nonce=randomBytes(16).toString('hex');
  const demand={schema:'riffoid-ir.operator-quiescence-demand/v1',requestId:REQUEST,phase,demandNonce:nonce,notBefore,expiresAt,origin:facts.publicOrigin,method:'GET',path:QUIESCENCE_PATH,targetFile:stream.prefix+nonce+'.json',factsCore:{requestId:REQUEST,hold:facts.newIrMaintenance.hold,control:facts.newIrMaintenance.control}};
  assertDemand(demand,{stream,facts,phase,nonce});const began=performance.now(),demandReference=await writeDemand(demand),file=join(stream.directory,demand.targetFile);
  for(;;){current(signal,deadline);need(Date.now()<expiresAt&&performance.now()-began<90000,'exact-demand-response-timeout');let raw;
    try{raw=await ownedBytes(file,256*1024);}catch(e){if(e.code==='ENOENT'){await pause(signal,100);continue;}throw e;}
    current(signal,deadline);need(Date.now()<=expiresAt&&performance.now()-began<=90000,'exact-demand-response-timeout');
    return parseResponse(raw,{stream,facts,phase,nonce,reference:{file,bytes:raw.length,sha256:sha(raw)},expectedDemandReference:demandReference});
  }
}
export async function recheckExactQuiescence(logical,{stream,facts,signal,deadline}={}){
  descriptor(stream);current(signal,deadline);const raw=await pinned(logical.reference,256*1024),checked=await parseResponse(raw,{stream,facts,phase:logical.demand.phase,nonce:logical.demand.demandNonce,reference:logical.reference,expectedDemandReference:logical.demandReference});current(signal,deadline);return checked;
}
