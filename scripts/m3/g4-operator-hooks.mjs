import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const execute=promisify(execFile);

export function readonlyApiPath(p){
 assert(typeof p==='string'&&(/^\/api\/me$/.test(p)||/^\/api\/tenants\/[A-Za-z0-9_%.-]+\/g4-window$/.test(p)||/^\/api\/workspaces\/[A-Za-z0-9_%.-]+\/g4-compute-counts$/.test(p)),'readonly-api-path-denied');
 for(const part of p.split('/'))assert(!['.','..'].includes(decodeURIComponent(part))&&!decodeURIComponent(part).includes('/'),'readonly-api-path-denied');return p;
}
export async function createReadonlyApi(auth,{cdpUrl,connect,fetchImpl=fetch}={}){
 const origin=new URL(auth.origin);assert.equal(origin.origin,auth.origin);assert.equal(origin.protocol,'https:');
 if(!cdpUrl)return {get:async p=>{const r=await fetchImpl(auth.origin+readonlyApiPath(p),{method:'GET',headers:{cookie:auth.cookie},redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return r.json();},close:async()=>{}};
 const endpoint=new URL(cdpUrl);assert(['http:','ws:'].includes(endpoint.protocol)&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash,'cdp-endpoint-denied');
 const proxyKeys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'],prior=new Map(proxyKeys.map(k=>[k,process.env[k]]));let browser;
 try{for(const k of proxyKeys)delete process.env[k];if(!connect){const {chromium}=await import('playwright');connect=(url,options)=>chromium.connectOverCDP(url,options);}browser=await connect(cdpUrl,{timeout:10000});}finally{for(const [k,v]of prior)if(v===undefined)delete process.env[k];else process.env[k]=v;}
 try{
  const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>{try{return new URL(p.url()).origin===auth.origin;}catch{return false;}});assert(pages.length>0,'authenticated-origin-page-absent');const page=pages[0];
  return {get:async p=>{readonlyApiPath(p);let timer;const evaluation=page.evaluate(async({origin,path})=>{if(location.origin!==origin)throw Error('api-origin-changed');const r=await fetch(origin+path,{method:'GET',credentials:'include',redirect:'error',signal:AbortSignal.timeout(10000)});if(r.status!==200)throw Error('readonly-api-unconfirmed');return r.json();},{origin:auth.origin,path:p});try{return await Promise.race([evaluation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('readonly-cdp-timeout')),12000);})]);}finally{clearTimeout(timer);}},close:async()=>{await browser.close();}};
 }catch(e){await browser.close();throw e;}
}

export async function main(){
const {privateJson}=await import('./g4-ordinary-browser-helpers.mjs');
const mode=process.argv[2];assert(['guard','counts'].includes(mode));
let input='';for await(const b of process.stdin){input+=b;assert(input.length<65536);}const intent=JSON.parse(input);
const auth=privateJson(process.env.G4_AUTH_FILE),policy=privateJson(process.env.G4_WINDOW_POLICY_FILE),release=privateJson(process.env.G4_RELEASE_RECEIPT_FILE);
for(const k of ['userId','tenantId']){assert.equal(intent[k],auth[k]);assert.equal(auth[k],policy[k]);}assert.equal(intent.origin,auth.origin);assert.equal(release.ready,true);
const cli=path.resolve('node_modules/wrangler/bin/wrangler.js');
async function cloud(args){const r=await execute(process.execPath,[cli,...args,'--json','--config',process.env.G4_APP_CONFIG],{timeout:15000,maxBuffer:1048576});return JSON.parse(r.stdout);}
const deployment=await cloud(['deployments','status']);assert.equal(deployment.versions.length,1);assert.equal(deployment.versions[0].percentage,100);assert.equal(deployment.versions[0].version_id,release.workerVersionId);
const version=await cloud(['versions','view',release.workerVersionId]);assert.equal(version.annotations['workers/tag'],release.workerTag);
const vars=Object.fromEntries(version.resources.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));assert.deepEqual(JSON.parse(vars.G4_CONTROLLED_WINDOW_JSON),policy);
for(const gate of ['M2_TURNS_ENABLED','M4_SIMULATION_ENABLED','M2_MODEL_PROVIDER_ENABLED'])assert.equal(vars[gate],'true');
const transport=await createReadonlyApi(auth,{cdpUrl:process.env.G4_API_CDP_URL});
try{
const api=transport.get;
const me=await api('/api/me');assert.equal(me.userId,auth.userId);assert(me.tenants.some(t=>t.id===auth.tenantId));
const releaseIdentity=release.workerVersionId+':'+release.workerTag;
let result;
if(mode==='guard'){
 const raw=await api('/api/tenants/'+encodeURIComponent(auth.tenantId)+'/g4-window');const window=raw.window??raw;
 assert.equal(window.configured,true);assert.deepEqual(window.policy,policy);
 const calls=window.calls;assert(Array.isArray(calls)&&Array.isArray(window.tasks));assert.equal(calls.filter(c=>['reserved','dispatched','unknown'].includes(c.state)).length,0,'unsettled charge: observe same identity only');
 const occupied=calls.reduce((n,c)=>{assert(Number.isSafeInteger(c.accounted)&&c.accounted>=0);return n+BigInt(c.accounted);},0n);assert(occupied<=BigInt(policy.totalNanodollars));
 const remaining={usd:Number(BigInt(policy.totalNanodollars)-occupied)/1e9,turnUsd:5,upstreamCalls:32-calls.filter(c=>c.dispatch_at!==null).length,serverRuns:16-window.tasks.filter(t=>t.kind==='run').length};
 const dueAt=window.deadlineAt??Date.now()+policy.durationMs;assert(dueAt>Date.now());assert(remaining.usd>0);
 if(intent.kind==='turn')assert(remaining.upstreamCalls>0);
 if(['run','verify','service','group'].includes(intent.kind)){assert(Number.isInteger(intent.runCount)&&intent.runCount>0);assert(remaining.serverRuns>=intent.runCount);}
 result={approved:true,ready:true,intentId:intent.intentId,origin:auth.origin,userId:auth.userId,tenantId:auth.tenantId,releaseIdentity,observedAt:Date.now(),dueAt,startedAt:window.startedAt,deadlineIsProvisional:window.startedAt===null,totalUsd:20,remaining,window};
}else{
 assert(typeof intent.workspaceId==='string');const raw=await api('/api/workspaces/'+encodeURIComponent(intent.workspaceId)+'/g4-compute-counts');assert.equal(raw.readOnly,true);assert.equal(raw.noAddedCalls,true);assert.equal(raw.scope.tenantId,auth.tenantId);assert.equal(raw.scope.workspaceId,intent.workspaceId);
 const attempt=(v,k)=>{assert.equal(v.supported,true,'missing actual native instrumentation');assert.equal(v.noAddedCalls,true);assert(Number.isSafeInteger(v.attempts[k])&&v.attempts[k]>=0);return v.attempts[k];};
 const native=raw.nativeDispatches;assert(Array.isArray(native)&&native.length>0);let tools=0,pi=0,piTasks=0;
 for(const n of native){assert.equal(n.toolLedger.supported,true);assert(Number.isSafeInteger(n.toolLedger.dispatched));tools+=n.toolLedger.dispatched+attempt(n.projectTools,'execControl')+attempt(n.projectTools,'execFilework')+attempt(n.projectTools,'startProcess')+attempt(n.projectTools,'init');pi+=attempt(n.trustedPi,'init')+attempt(n.trustedPi,'startProcess')+attempt(n.trustedPi,'execControl')+attempt(n.trustedPi,'execFilework');piTasks+=attempt(n.trustedPi,'taskStart');}
 result={userId:auth.userId,tenantId:auth.tenantId,workspaceId:intent.workspaceId,releaseIdentity,observedAt:Date.now(),counts:{modelUpstreamDispatches:raw.provider.dispatched,simulationStarts:raw.durableFences.simulation.startClaimed,projectRuntimeStarts:['taskStart','init','execControl','execFilework','startProcess'].reduce((n,k)=>n+attempt(raw.projectRuntime.counter,k),0),projectToolDispatches:tools,trustedPiStarts:pi,trustedPiTaskDispatches:piTasks},semantics:'durable admissions and before-call native attempts; successful executions not inferred',externalInventoryRequired:true,raw};
}
const after=await api('/api/me');assert.equal(after.userId,auth.userId);assert(after.tenants.some(t=>t.id===auth.tenantId));
assert(process.env.G4_COLLECTION_DIR);fs.mkdirSync(process.env.G4_COLLECTION_DIR,{recursive:true,mode:0o700});fs.writeFileSync(path.join(process.env.G4_COLLECTION_DIR,mode+'-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify(result));

}finally{await transport.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
