// Open only for the approved single UI model Turn, then close on terminal,
// unknown, scope overrun, timeout or error. Never sends a model request itself.
import {readFile,writeFile,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {workerScriptContentV2Sha256} from './g5-a-cloud-host.mjs';
const base='/home/g/.private/riffology-cloud/g5-a/mac-v5-recovery-20260917-frozen',root='/home/g/apps/riffology-cloud-g5-mac-recovery-e346e6f';
const require=createRequire(import.meta.url),{ProxyAgent,Agent,setGlobalDispatcher}=require('undici');if(!process.env.HTTPS_PROXY)throw Error('proxy-required');setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
const read=async p=>JSON.parse(await readFile(p,'utf8')),save=(n,v)=>writeFile(base+'/'+n,JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const creds=Object.fromEntries((await readFile('/home/g/.private/riffology-cloud/g5-a/rollover-20260917-v8/credentials.env','utf8')).split(/\r?\n/).filter(Boolean).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const accountId='8b0d70250211aa10d89e20605a1c7e5e',workerName='riffology-m1-gateway-staging',windowId='g5-20260917-mac-v5-A',prefix=`https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const worker='/workers/scripts/'+workerName;
const api=async(path,method='GET',body,direct=false)=>{const token=path.startsWith('/ai-gateway/')?creds.CLOUDFLARE_AI_GATEWAY_READ_TOKEN:creds.CLOUDFLARE_API_TOKEN;if(!token)throw Error('scoped-api-token-missing');const r=await fetch(prefix+path,{method,headers:{authorization:'Bearer '+token,...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),...(direct?{dispatcher:new Agent()}:{}),signal:AbortSignal.timeout(60000)});const j=await r.json();if(!r.ok||!j.success)throw Error('cloudflare-'+r.status+'-'+JSON.stringify(j.errors));return j.result;};
const operate=async(action,extra={},mutation)=>{const r=await fetch('https://riffology-g5-mac-v5-operator-20260917.jihe-gao.workers.dev/operate',{method:'POST',headers:{authorization:'Bearer '+creds.G5_OPERATOR_CAPABILITY,'content-type':'application/json',...(mutation?{'x-g5-mutation':mutation}:{})},body:JSON.stringify({action,windowId,...extra}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok||!j.ok)throw Error('operator-'+r.status+'-'+(j.error??'invalid'));return j;};
const stage=v=>console.log(JSON.stringify(v)),gates=['G5_ADMISSION_ENABLED','M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED','PRODUCTION_MODEL_ENABLED','M4_SIMULATION_ENABLED','M3_SERVICE_ENABLED'];
const prepared=await read(base+'/prepared.json'),closed=await read(base+'/closed-readback.json'),config=await read(base+'/closed.jsonc');
const current=await api(worker+'/settings'),active=(await api(worker+'/deployments')).deployments?.[0];
if(active?.versions?.length!==1||active.versions[0].version_id!==closed.versionId||gates.some(k=>current.bindings.find(b=>b.name===k)?.text!=='false'))throw Error('closed-release-precondition');
const sourceSha256=await workerScriptContentV2Sha256({accountId,workerName,apiToken:creds.CLOUDFLARE_API_TOKEN,fetcher:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(60000)})});if(sourceSha256!==prepared.sourceSha256)throw Error('source-drift');
const state=await operate('snapshot');if(state.summary.rolloverReceiptSha256!==prepared.rolloverReceiptSha256||state.summary.startedAt!==null||state.summary.tasks!==0||state.summary.dispatches!==0||Object.entries(state.summary).some(([k,v])=>/(Unknown|Pending)$/.test(k)&&v!==0))throw Error('window-not-pristine');
const gateway=await api('/ai-gateway/gateways/riffology-g5-20260916');if(gateway.authentication!==true||gateway.collect_logs!==false||gateway.cache_ttl!==0||gateway.cache_invalidate_on_update!==false)throw Error('gateway-privacy-drift');
const run=args=>{const r=spawnSync(root+'/node_modules/.bin/wrangler',args,{cwd:root,env:{...process.env,CLOUDFLARE_API_TOKEN:creds.CLOUDFLARE_API_TOKEN},encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});if(r.status!==0)throw Error('container-inventory-command-failed');return JSON.parse(r.stdout);};
const apps=run(['containers','list','--json','--config',base+'/closed.jsonc']),inventory=[];
for(const name of config.containers.map(c=>c.name)){
 const matches=apps.filter(a=>a.name===name);if(matches.length!==1)throw Error('container-app-conflict');const app=matches[0];let token=null,seen=new Set();
 do{const page=run(['containers','instances',app.id,'--json','--per-page','100',...(token?['--page-token',token]:[]),'--config',base+'/closed.jsonc']);if(page.result_info?.page_token!==token||!Array.isArray(page.instances))throw Error('container-pagination-invalid');if(page.instances.some(i=>i.state!=='inactive'))throw Error('container-not-quiescent');inventory.push({name,appId:app.id,instances:page.instances.length});token=page.result_info.next_page_token??null;if(token&&seen.has(token))throw Error('container-pagination-loop');seen.add(token);}while(token);
}
const evidence={at:new Date().toISOString(),sourceSha256,closedVersionId:closed.versionId,windowId,summary:state.summary,gateway:{id:gateway.id,authentication:gateway.authentication,collect_logs:gateway.collect_logs,cache_ttl:gateway.cache_ttl},inventory};await save('preflight-'+Date.now()+'.json',evidence);stage({stage:'single-model-preflight-passed',windowId,inventory});
if(process.argv[2]!=='--execute-one-model')process.exit(0);
const lock=await open(base+'/open-once.lock','wx',0o600);await lock.close();
const metadata=await read(base+'/upload-metadata.json');metadata.annotations={'workers/tag':'g5-mac-v5-one-model-e346e6f','workers/message':'One user-authorized synthetic model Turn; automatic close, no server Simulation or Service'};
for(const b of metadata.bindings){if(['G5_ADMISSION_ENABLED','M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED','PRODUCTION_MODEL_ENABLED'].includes(b.name))b.text='true';if(b.name==='PRODUCTION_MONEY_POLICY_JSON'){const money=JSON.parse(b.text);money.enabled=true;b.text=JSON.stringify(money);}}
const bytes=await readFile(base+'/bundle/index.js');if(createHash('sha256').update(bytes).digest('hex')!==prepared.sourceSha256)throw Error('bundle-drift');
const form=new FormData();form.set('metadata',JSON.stringify(metadata));form.set('index.js',new Blob([bytes],{type:'application/javascript+module'}),'index.js');
const uploaded=await api(worker+'/versions','POST',form);await save('open-upload.json',uploaded);if(!uploaded.id)throw Error('open-version-id-missing');
const candidate=await api(worker+'/versions/'+uploaded.id);for(const b of metadata.bindings){const actual=candidate.resources.bindings.find(a=>a.name===b.name);for(const k of ['type','text','namespace_id','database_id','bucket_name','service','entrypoint'])if((b[k]??null)!==(actual?.[k]??null))throw Error('open-binding-drift-'+b.name+'-'+k);}
let attemptedOpen=false,reason='error',last=null,failure;
try{
 if((await api(worker+'/deployments')).deployments?.[0].id!==active.id)throw Error('concurrent-deployment');
 attemptedOpen=true;await api(worker+'/deployments','POST',{strategy:'percentage',versions:[{version_id:uploaded.id,percentage:100}]});
 const live=await api(worker+'/settings');for(const b of metadata.bindings.filter(b=>b.type==='plain_text'))if(live.bindings.find(a=>a.name===b.name)?.text!==b.text)throw Error('open-readback-drift');
 const stopAt=Date.now()+900000;await save('open-readback.json',{versionId:uploaded.id,openedAt:new Date().toISOString(),stopAt,scope:{projects:1,turns:1,maxDispatches:8,simulationRuns:0,serviceRuns:0}});stage({stage:'gates-open-for-one-ui-model',versionId:uploaded.id,stopAt});
 let previous='';while(Date.now()<stopAt){const observed=await operate('snapshot');last=observed;const s=observed.summary,serial=JSON.stringify(s);if(serial!==previous){await save('watch-'+Date.now()+'.json',observed);stage({stage:'window-observed',summary:s});previous=serial;}
  if(Object.entries(s).some(([k,v])=>/Unknown$/.test(k)&&v>0)){reason='new-unknown';break;}
  if(s.tasks>2||s.projects>1||s.turns>1||s.dispatches>8||s.simulationRuns!==0||s.serviceRuns!==0){reason='scope-overrun';break;}
  if(s.tasks===2&&s.turns===1&&s.dispatches>0&&Object.entries(s).filter(([k])=>/Pending$/.test(k)).every(([,v])=>v===0)){reason='turn-terminal';break;}
  await new Promise(r=>setTimeout(r,3000));
 }if(reason==='error')reason='15-minute-deadline';
}catch(e){failure={message:e.message};}
finally{
 if(attemptedOpen){let closeResult;
  for(let attempt=0;attempt<3;attempt++){try{const d=await api(worker+'/deployments','POST',{strategy:'percentage',versions:[{version_id:closed.versionId,percentage:100}]},attempt>0);const active=(await api(worker+'/deployments','GET',undefined,attempt>0)).deployments?.[0];const version=await api(worker+'/versions/'+closed.versionId,'GET',undefined,attempt>0);if(active.versions.length!==1||active.versions[0].version_id!==closed.versionId||active.versions[0].percentage!==100||gates.some(k=>version.resources.bindings.find(b=>b.name===k)?.text!=='false'))throw Error('gate-close-readback');closeResult={closed:true,deploymentId:d.id,versionId:closed.versionId};break;}catch(e){closeResult={closed:false,message:e.message};}}
  await save('watch-gate-close.json',closeResult);stage({stage:'watch-gate-close',...closeResult});if(!closeResult.closed)throw Error('gate-close-unconfirmed');
  try{const s=await operate('snapshot');if(s.summary.startedAt!==null&&!s.summary.closed)await operate('close',{expectedSnapshotSha256:s.snapshotSha256,confirmation:'close-existing-window'},'close-admission');last=await operate('snapshot');}catch(e){failure??={message:e.message};}
 }
 await save('watch-result.json',{reason,failure,last});stage({stage:'single-model-window-stopped',reason,failure,summary:last?.summary});
}
if(failure)process.exitCode=1;
