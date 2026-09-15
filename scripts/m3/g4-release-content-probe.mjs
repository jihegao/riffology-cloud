import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {probeWorkerConfig,probeWorkerName,probeWorkerOrigin,probeWorkerPath,trustedPiProbeActor,validateProbeDeployment,probeDeploymentArgs,probeDeleteArgs,probeWorkerMissing} from './trusted-pi-platform-probe.mjs';
export const MODULES=Object.freeze(['trusted-pi-release.mjs','release-candidate.mjs','product-model-transport.mjs','product-tool-bridge.mjs','research-context.mjs','trusted-pi-turn-host.mjs']);
export const FIXED_PROGRAM=`const{readFile,stat}=await import('node:fs/promises');const{createHash}=await import('node:crypto');const paths=${JSON.stringify(MODULES)};const modules=[];for(const name of paths){const path='/opt/riffology/trusted-pi/'+name,bytes=await readFile(path),s=await stat(path);modules.push({name,sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length,uid:s.uid,gid:s.gid,mode:s.mode&511});}const m=await import('/opt/riffology/trusted-pi/release-candidate.mjs');const out={schemaVersion:1,modules,generationContract:m.BROWSER_PREVIEW_GENERATION_CONTRACT,adapterSha256:m.BROWSER_PREVIEW_SERVER_ADAPTER_SHA256,adapterActualSha256:createHash('sha256').update(m.BROWSER_PREVIEW_SERVER_ADAPTER).digest('hex')};const text=JSON.stringify(out);if(Buffer.byteLength(text)>16384)throw Error('bounded-output');console.log(text);`;
export const FIXED_COMMAND='node --input-type=module -e '+"'"+FIXED_PROGRAM.replaceAll("'","'\\''")+"'";
export function frozenProbe(token){
 if(!/^[a-f0-9]{24}$/.test(token))throw Error('probe-token-invalid');
 const scope={tenantId:'probe-'+token,projectId:'probe-'+token,workspaceId:'probe-'+token,workspaceGeneration:1};
 const identity={scope,sessionId:'session-'+token,turnId:'turn-'+token+'-a',dispatchId:'dispatch-'+token+'-a',generation:1};
 return {identity,actor:trustedPiProbeActor(scope,identity.turnId,identity.dispatchId)};
}
export function workerSource(actor,identity){if(!/^m2-t-[a-z2-7]{52}$/.test(actor))throw Error('probe-actor-invalid');const token=identity?.scope?.tenantId?.slice(6),frozen=frozenProbe(token);if(frozen.actor!==actor||JSON.stringify(frozen.identity)!==JSON.stringify(identity))throw Error('probe-identity-invalid');return `import{DurableObject}from'cloudflare:workers';export class ProbeFaultReceipt extends DurableObject{};export default{async fetch(req,env){if(req.headers.get('x-probe-capability')!==env.PROBE_CAPABILITY)return new Response(null,{status:404});const url=new URL(req.url);if(!url.search&&url.pathname===env.PROBE_PATH_PREFIX+'/health'&&req.method==='GET')return Response.json({ok:true});if(url.search||url.pathname!==env.PROBE_PATH_PREFIX+'/rpc'||req.method!=='POST')return new Response(null,{status:404});const raw=await req.text();if(raw.length>64)return new Response(null,{status:400});const input=JSON.parse(raw);if(Object.keys(input).length!==1)return new Response(null,{status:400});const stub=env.TRUSTED_PI_SANDBOX.getByName('${actor}');if(input.action==='content'){const r=await stub.exec(${JSON.stringify(FIXED_COMMAND)},{cwd:'/opt/riffology/trusted-pi',env:{},timeout:10000});if(!r.success||r.exitCode!==0||typeof r.stdout!=='string'||new TextEncoder().encode(r.stdout).length>16384)throw Error('content-unconfirmed');return Response.json({ok:true,value:JSON.parse(r.stdout)});}if(input.action==='destroy'){const value=await stub.destroyAndReleaseState(${JSON.stringify(identity)});if(typeof value?.running!=='boolean')throw Error('destroy-state-unconfirmed');return Response.json({ok:true,destroyAcknowledged:value.running===false,nativeStopImmediatelyObserved:value.running===false,running:value.running});}return new Response(null,{status:400});}};`;}
export async function waitHealth(read,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),deadlineMs=120000,stableMs=3000,pollMs=1000}={}){
 const end=now()+deadlineMs;let since=null;
 while(now()<end){try{const v=await read();if(v?.ok!==true)throw Error('health-shape');since??=now();if(now()-since>=stableMs)return;}catch{since=null;}await sleep(Math.min(pollMs,Math.max(0,end-now())));}
 throw Error('probe-health-unconfirmed');
}
export async function destroyBounded(exactIdentity,destroy,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),deadlineMs=180000,maxAttempts=5}={}){
 const end=now()+deadlineMs;let last='destroy-unconfirmed';
 for(let n=0;n<maxAttempts&&now()<end;n++){await exactIdentity();try{const v=await destroy();if(v?.ok!==true||v.destroyAcknowledged!==true||v.running!==false||v.nativeStopImmediatelyObserved!==true)throw Error('destroy-shape');return v;}catch(e){last=e.message;}await sleep(Math.min(3000,Math.max(0,end-now())));}
 throw Error(last);
}
const hash=b=>createHash('sha256').update(b).digest('hex');
export function validateContent(value,expected){
 if(value?.schemaVersion!==1||!Array.isArray(value.modules)||value.modules.length!==6)throw Error('content-shape-invalid');
 for(let i=0;i<6;i++){const row=value.modules[i],want=expected.modules[i];if(row.name!==MODULES[i]||want?.name!==MODULES[i]||row.sha256!==want.sha256||row.byteLength!==want.byteLength||row.uid!==0||row.gid!==0||(row.mode&0o022)!==0)throw Error('module-content-mismatch');}
 if(value.modules[0].sha256!==value.modules[1].sha256||value.adapterSha256!=='fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898'||value.adapterActualSha256!==value.adapterSha256||JSON.stringify(value.generationContract)!==JSON.stringify(expected.generationContract))throw Error('generation-policy-mismatch');return value;
}
/** Execution is opt-in. Persisted intent is reused after transport uncertainty;
 * content is never retried automatically. Root performs full inventory signoff. */
export async function run({root,config,manifest,directory,resume=false,deleteAfterRootQuiet=false}){
 root=resolve(root);directory=resolve(directory);mkdirSync(directory,{recursive:true,mode:0o700});
 const wrangler=resolve(root,'node_modules/.bin/wrangler');
 const command=(args,json=false)=>{const r=spawnSync(wrangler,args,{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});if(r.status!==0)throw Error('cloud-command-unconfirmed');return json?JSON.parse(r.stdout):r.stdout;};
 const save=(name,value)=>writeFileSync(resolve(directory,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
 const expected=JSON.parse(readFileSync(manifest,'utf8'));if(!/^[a-f0-9-]{36}$/.test(expected.workerVersionId)||!/^source-[a-f0-9]{40}$/.test(expected.workerTag)||!/^registry\.cloudflare\.com\/[^\s]+@sha256:[a-f0-9]{64}$/.test(expected.image))throw Error('expected-release-invalid');
 const checkMain=()=>{const d=command(['deployments','status','--json','--config',config],true);if(d.versions?.length!==1||d.versions[0].percentage!==100||d.versions[0].version_id!==expected.workerVersionId)throw Error('main-version-changed');const v=command(['versions','view',expected.workerVersionId,'--json','--config',config],true);if(v.annotations?.['workers/tag']!==expected.workerTag)throw Error('main-source-changed');const apps=command(['containers','list','--json','--config',config],true),a=apps.filter(x=>x.name==='riffology-m3-trusted-pi-staging'&&x.image===expected.image);if(a.length!==1)throw Error('main-image-mismatch');return {deployment:d,versionId:v.id,tag:v.annotations['workers/tag'],app:{id:a[0].id,name:a[0].name,image:a[0].image,version:a[0].version}};};
 const before=checkMain();save('main-before.json',before);
 let intent;if(resume){intent=JSON.parse(readFileSync(resolve(directory,'intent.json'),'utf8'));if(intent.manifestSha256!==hash(readFileSync(manifest)))throw Error('intent-manifest-changed');}else{const token=randomBytes(12).toString('hex'),scope={tenantId:'probe-'+token,projectId:'probe-'+token,workspaceId:'probe-'+token,workspaceGeneration:1};intent={schemaVersion:1,token,name:probeWorkerName(token),...frozenProbe(token),capability:randomBytes(32).toString('hex'),manifestSha256:hash(readFileSync(manifest)),createdAt:Date.now(),stage:'persisted-before-deploy'};writeFileSync(resolve(directory,'intent.json'),JSON.stringify(intent,null,2)+'\n',{mode:0o600,flag:'wx'});}
 const frozen=frozenProbe(intent.token);if(resume&&intent.identity===undefined&&intent.actor===frozen.actor&&intent.name===probeWorkerName(intent.token)){intent.identity=frozen.identity;save('intent.json',intent);}
 if(intent.actor!==frozen.actor||JSON.stringify(intent.identity)!==JSON.stringify(frozen.identity))throw Error('intent-identity-mismatch');
 const main=resolve(directory,'probe.mjs'),configPath=resolve(directory,'wrangler.jsonc'),source=workerSource(intent.actor,intent.identity);writeFileSync(main,source);save('source-receipt.json',{sha256:hash(source),fixedCommandSha256:hash(FIXED_COMMAND),actor:intent.actor});save('wrangler.jsonc',probeWorkerConfig(main,intent.capability,intent.name));
 const health=async()=>{const r=await fetch(probeWorkerOrigin(intent.name)+'/health',{headers:{'x-probe-capability':intent.capability},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('probe-health-unconfirmed');return r.json();};
 const exactProbe=()=>{const d=command(['deployments','status','--name',intent.name,'--json','--config',configPath],true);if(d.versions?.length!==1||d.versions[0].percentage!==100)throw Error('probe-version-unconfirmed');const v=command(['versions','view',d.versions[0].version_id,'--name',intent.name,'--json','--config',configPath],true);return validateProbeDeployment(d,v,{workerName:intent.name,versionTag:'probe-'+intent.token,capability:intent.capability});};
 const rpc=async action=>{const r=await fetch(probeWorkerOrigin(intent.name)+'/rpc',{method:'POST',headers:{'content-type':'application/json','x-probe-capability':intent.capability},body:JSON.stringify({action}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('probe-rpc-unconfirmed');return r.json();};
 let failure=null,cleanup=null,owned=resume;
 try{
  if(!resume){const prior=spawnSync(wrangler,['deployments','status','--name',intent.name,'--json','--config',configPath],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});if(!probeWorkerMissing(prior))throw Error('probe-name-preexistence-unconfirmed');owned=true;command(probeDeploymentArgs(configPath,'probe-'+intent.token));}
  save('probe-version.json',exactProbe());
  await waitHealth(health);
  if(resume){save('resume.json',{status:'observation-only',actor:intent.actor,reason:'never-replay-content-after-delivery-unknown'});}
  if(!resume){const result=await rpc('content');validateContent(result.value,expected);save('content.json',{status:'passed',scope:'actual-cloud-sdk-default-session; no-model',actor:intent.actor,value:result.value});checkMain();}
 }catch(e){failure=e.message;save('failure.json',{status:'unconfirmed',reason:failure,actor:intent.actor});}
 finally{try{if(!owned)throw Error('probe-not-owned-no-cleanup');cleanup=await destroyBounded(exactProbe,()=>rpc('destroy'));save('destroy.json',cleanup);
  if(deleteAfterRootQuiet){if(!resume)throw Error('root-quiet-finalization-requires-resume');exactProbe();command(probeDeleteArgs(intent.name,configPath));}
  save('cleanup.json',{destroyAcknowledged:true,nativeStopImmediatelyObserved:true,running:false,workerDeletionAcknowledged:deleteAfterRootQuiet,nativeStopConfirmed:false,externalInactiveAndQuietProof:false,pendingRootQuiet:!deleteAfterRootQuiet,requiresRootFiveAppInventory:true,requiresRootRouteAbsenceProof:deleteAfterRootQuiet});
 }catch(e){save('cleanup.json',{status:'unconfirmed',reason:e.message,actor:intent.actor,requiresRecovery:true});failure??=e.message;}save('main-after.json',checkMain());}

 if(failure)throw Error(failure);return {status:resume?'cleanup-acknowledged':'content-passed',cleanup,externalInventorySignoff:false,nativeStopConfirmed:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(!args.includes('--execute'))throw Error('explicit --execute required; creates native probe and temporary Worker');
 const get=key=>{const i=args.indexOf(key);if(i<0||!args[i+1])throw Error('missing '+key);return args[i+1];};
 await run({root:get('--root'),config:get('--config'),manifest:get('--manifest'),directory:get('--directory'),resume:args.includes('--resume'),deleteAfterRootQuiet:args.includes('--delete-after-root-quiet')});
}
