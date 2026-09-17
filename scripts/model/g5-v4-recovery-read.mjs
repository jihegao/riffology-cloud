// One-shot private readback for the explicitly authorized v4 recovery.
// Run on AMD128: credentials remain on their owning host. No model admission.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const old='/home/g/.private/riffology-cloud/g5-a/rollover-20260917-v8';
const base='/home/g/.private/riffology-cloud/g5-a/v4-mac-recovery-20260917-proxy';
const root='/home/g/apps/riffology-cloud-g5-a-integration';
const require=createRequire(root+'/package.json');
const {ProxyAgent,setGlobalDispatcher}=require('undici');
const proxy=process.env.HTTPS_PROXY??process.env.https_proxy??process.env.HTTP_PROXY;
if(proxy)setGlobalDispatcher(new ProxyAgent(proxy));
const creds=Object.fromEntries((await readFile(old+'/credentials.env','utf8')).split(/\r?\n/).filter(Boolean).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const account='8b0d70250211aa10d89e20605a1c7e5e',name='riffology-g5-v4-recovery-read-20260917';
const api=async(path,method='GET',body)=>{const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{method,headers:{authorization:'Bearer '+creds.CLOUDFLARE_API_TOKEN,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});return {status:r.status,...await r.json()};};
const absent=await api('/workers/scripts/'+name+'/settings');
if(!absent.errors?.some(e=>e.code===10007))throw Error('temporary-operator-not-confirmed-absent');
await mkdir(base,{recursive:true,mode:0o700});
const save=(file,value)=>writeFile(base+'/'+file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const gates=['G5_ADMISSION_ENABLED','M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED','PRODUCTION_MODEL_ENABLED','M4_SIMULATION_ENABLED','M3_SERVICE_ENABLED'];
const before=await api('/workers/scripts/riffology-m1-gateway-staging/settings');
if(!before.success||gates.some(k=>before.result.bindings.find(b=>b.name===k)?.text!=='false'))throw Error('main-gates-not-closed');
await save('settings-before.json',before.result);
const secret=randomBytes(32).toString('hex');
const source=`export default {async fetch(r,env){if(r.method!=='GET'||r.headers.get('authorization')!=='Bearer '+env.CAP)return new Response('',{status:404});const g=env.GUARD.getByName('g5-controlled-global-v1');const snapshot=await g.snapshot();if(snapshot.activePolicy?.windowId!=='g5-20260917-rollover-v4-A')return new Response('',{status:409});return Response.json({snapshot,summary:await g.operatorSnapshot(),failure:await g.inspectProviderFailure({windowId:'g5-20260917-rollover-v4-A',turnId:'186efac1-2555-4b24-92da-81ae43d343ec'})},{headers:{'cache-control':'no-store'}});}};`;
await writeFile(base+'/read-worker.mjs',source,{flag:'wx',mode:0o600});
await save('read-worker.jsonc',{name,account_id:account,main:base+'/read-worker.mjs',compatibility_date:'2026-09-17',workers_dev:true,preview_urls:false,observability:{enabled:false},vars:{CAP:secret},durable_objects:{bindings:[{name:'GUARD',class_name:'G5ControlledWindow',script_name:'riffology-m1-gateway-staging'}]}});
const run=args=>spawnSync(root+'/node_modules/.bin/wrangler',args,{cwd:root,env:{...process.env,CLOUDFLARE_API_TOKEN:creds.CLOUDFLARE_API_TOKEN},encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});
try{
 console.log(JSON.stringify({stage:'deploy-read-operator'}));
 const deployed=run(['deploy','--config',base+'/read-worker.jsonc']);
 if(deployed.status!==0)throw Error('read-operator-deploy-failed');
 const sub=await api('/workers/subdomain');if(!sub.result?.subdomain)throw Error('subdomain-unavailable');
 const r=await fetch('https://'+name+'.'+sub.result.subdomain+'.workers.dev/',{headers:{authorization:'Bearer '+secret},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('read-operator-http-'+r.status);
 const result=await r.json();await save('source-authority.json',result);
 console.log(JSON.stringify({stage:'source-read',summary:result.summary,failure:result.failure}));
}finally{
 const removal=await api('/workers/scripts/'+name,'DELETE');const check=await api('/workers/scripts/'+name+'/settings');
 const deleted=check.errors?.some(e=>e.code===10007)===true;await save('read-operator-cleanup.json',{status:removal.status,deleted});console.log(JSON.stringify({stage:'read-operator-cleanup',deleted}));if(!deleted)throw Error('read-operator-cleanup-unconfirmed');
}
