// Private, bounded operator for the approved v5 recovery; credentials stay remote.
import {readFile,writeFile,open} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const base='/home/g/.private/riffology-cloud/g5-a/mac-v5-recovery-20260917-frozen',root='/home/g/apps/riffology-cloud-g5-mac-recovery-e346e6f';
const require=createRequire(import.meta.url),{ProxyAgent,setGlobalDispatcher}=require('undici');if(!process.env.HTTPS_PROXY)throw Error('proxy-required');setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
const read=async p=>JSON.parse(await readFile(p,'utf8')),save=(n,v)=>writeFile(base+'/'+n,JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const creds=Object.fromEntries((await readFile('/home/g/.private/riffology-cloud/g5-a/rollover-20260917-v8/credentials.env','utf8')).split(/\r?\n/).filter(Boolean).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const account='8b0d70250211aa10d89e20605a1c7e5e',name='riffology-g5-mac-v5-operator-20260917',windowId='g5-20260917-mac-v5-A';
const api=async(path,method='GET')=>{const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{method,headers:{authorization:'Bearer '+creds.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(30000)});return {status:r.status,...await r.json()};};
const operate=async(action,extra={},mutation)=>{const r=await fetch(`https://${name}.jihe-gao.workers.dev/operate`,{method:'POST',headers:{authorization:'Bearer '+creds.G5_OPERATOR_CAPABILITY,'content-type':'application/json',...(mutation?{'x-g5-mutation':mutation}:{})},body:JSON.stringify({action,windowId,...extra}),signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.ok)throw Error('operator-'+r.status+'-'+(j.error??'unknown'));return j;};
const mode=process.argv[2];
if(mode==='cleanup'){
 const before=await api('/workers/scripts/'+name+'/settings');if(before.success)await api('/workers/scripts/'+name,'DELETE');
 const after=await api('/workers/scripts/'+name+'/settings'),deleted=after.errors?.some(e=>e.code===10007)===true;await save('operator-cleanup.json',{deleted});console.log(JSON.stringify({deleted}));if(!deleted)throw Error('cleanup-unconfirmed');
}else if(mode==='register'||mode==='register-existing'){
 const before=await api('/workers/scripts/'+name+'/settings');if(mode==='register'&&!before.errors?.some(e=>e.code===10007))throw Error('operator-not-confirmed-absent');
 if(mode==='register-existing'&&(!before.success||before.result.bindings.find(b=>b.name==='G5_OPERATOR_CAPABILITY')?.text!==creds.G5_OPERATOR_CAPABILITY||before.result.bindings.find(b=>b.name==='G5_WINDOW_GUARD')?.script_name!=='riffology-m1-gateway-staging'))throw Error('owned-operator-conflict');
 const gates=['G5_ADMISSION_ENABLED','M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED','PRODUCTION_MODEL_ENABLED','M4_SIMULATION_ENABLED','M3_SERVICE_ENABLED'],main=await api('/workers/scripts/riffology-m1-gateway-staging/settings');if(!main.success||gates.some(k=>main.result.bindings.find(b=>b.name===k)?.text!=='false'))throw Error('gates-not-closed');
 if(mode==='register'){
  await save('operator.jsonc',{name,account_id:account,main:root+'/services/g5-operator/index.ts',compatibility_date:'2026-09-17',workers_dev:true,preview_urls:false,observability:{enabled:false},vars:{G5_OPERATOR_CAPABILITY:creds.G5_OPERATOR_CAPABILITY},durable_objects:{bindings:[{name:'G5_WINDOW_GUARD',class_name:'G5ControlledWindow',script_name:'riffology-m1-gateway-staging'}]}});
  const deployed=spawnSync(root+'/node_modules/.bin/wrangler',['deploy','--config',base+'/operator.jsonc'],{cwd:root,env:{...process.env,CLOUDFLARE_API_TOKEN:creds.CLOUDFLARE_API_TOKEN},encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});if(deployed.status!==0)throw Error('operator-deploy-failed');
 }
 const beforeState=await operate('snapshot');await save('before-register.json',beforeState);
 if(beforeState.summary.startedAt!==null||beforeState.summary.tasks!==0||beforeState.summary.dispatches!==0||beforeState.summary.rolloverReceiptSha256!==null)throw Error('window-not-pristine');
 const binding=await read(base+'/rollover-binding.json');const inspection=await operate('inspectProviderFailure',{payload:{windowId:binding.sourceWindowId,turnId:binding.quarantines.at(-1).sourceTurnId}});if(inspection.value.receiptSha256!==binding.quarantines.at(-1).sourceAuthorityReceiptSha256)throw Error('v4-authority-drift');await save('source-pre-register.json',inspection);
 const lock=await open(base+'/register-once.lock','wx',0o600);await lock.close();
 const result=await operate('rollover',{binding,expectedSnapshotSha256:beforeState.snapshotSha256,confirmation:'register-one-time-rollover'},'register-rollover');await save('register-result.json',result);
 const after=await operate('snapshot');await save('after-register.json',after);const prepared=await read(base+'/prepared.json');if(after.summary.rolloverReceiptSha256!==prepared.rolloverReceiptSha256||after.summary.startedAt!==null||after.summary.tasks!==0||after.summary.dispatches!==0)throw Error('rollover-readback-conflict');console.log(JSON.stringify({stage:'rollover-registered',summary:after.summary}));
}else if(mode==='close'){
 const before=await operate('snapshot');const result=before.summary.closed?before:await operate('close',{expectedSnapshotSha256:before.snapshotSha256,confirmation:'close-existing-window'},'close-admission');const after=await operate('snapshot');await save('manual-close-'+Date.now()+'.json',{result,after});if(!after.summary.closed)throw Error('guard-close-unconfirmed');console.log(JSON.stringify({stage:'guard-closed',summary:after.summary}));
}else if(mode==='snapshot'){
 const result=await operate('snapshot');await save('snapshot-'+Date.now()+'.json',result);console.log(JSON.stringify(result));
}else if(mode==='ancestors'){
 const binding=await read(base+'/rollover-binding.json'),results=[];
 for(const q of binding.quarantines){const result=await operate('inspectProviderFailure',{payload:{windowId:q.sourceWindowId,turnId:q.sourceTurnId}});if(result.value.receiptSha256!==q.sourceAuthorityReceiptSha256||result.value.calls[0]?.money.reserved!==q.sourceReservedNanodollars)throw Error('ancestor-drift');results.push({windowId:q.sourceWindowId,receiptSha256:result.value.receiptSha256,reserved:q.sourceReservedNanodollars,tokenStatus:result.value.calls[0].token.status,unchanged:true});}
 await save('ancestor-readback.json',results);console.log(JSON.stringify({stage:'all-ancestors-unchanged',results}));
}else if(mode==='failure'){
 const turnId=process.argv[3];if(!/^[a-f0-9-]{36}$/.test(turnId??''))throw Error('turn-id-required');const result=await operate('inspectProviderFailure',{payload:{windowId,turnId}});await save('failure-'+Date.now()+'.json',result);console.log(JSON.stringify(result));
}else throw Error('mode-required');
