import {createBrowserPreviewRuntime,browserPreviewRequest} from './browser-preview.js';
import {msg,t,uiError,errorMessage,formatNumber} from './i18n.js';
import {bindValue} from './i18n-bindings.js';

const MAX_RUNS=8,MAX_HISTORY=20,MAX_BYTES=1048576;
const activeStatuses=new Set(['preparing','running']);
const statuses=new Set(['preparing','running','completed','failed','cancelled','interrupted']);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const clone=value=>structuredClone(value);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function validRecord(record){
  return object(record)&&record.execution==='browser-local'&&id(record.id)&&['single','comparison'].includes(record.kind)&&statuses.has(record.status)&&hash(record.version?.filesSha256)&&hash(record.version?.specSha256)&&
    (record.version.revisionId===null||id(record.version.revisionId))&&Array.isArray(record.seeds)&&record.seeds.length>0&&record.seeds.length<=MAX_RUNS&&record.seeds.every(seed=>Number.isSafeInteger(seed)&&seed>=0&&seed<=4294967295)&&
    Array.isArray(record.configurations)&&record.configurations.length>0&&record.configurations.length<=4&&record.configurations.every(config=>object(config)&&typeof config.label==='string'&&config.label.length<=80&&object(config.parameters))&&
    object(record.metrics)&&Object.keys(record.metrics).length<=64&&Array.isArray(record.runs)&&record.runs.length===record.seeds.length*record.configurations.length&&record.runs.length<=MAX_RUNS&&
    record.runs.every(run=>object(run)&&['queued',...statuses].includes(run.status)&&object(run.parameters)&&Number.isSafeInteger(run.seed)&&typeof run.configurationId==='string'&&Number(run.configurationId)>=0&&Number(run.configurationId)<record.configurations.length&&
      (run.metrics===null||object(run.metrics)&&Object.values(run.metrics).every(Number.isFinite)));
}

function parameters(spec,values){
  if(!values||Array.isArray(values)||typeof values!=='object'||Object.keys(values).some(key=>!Object.hasOwn(spec.parameters,key)))throw uiError('localRuns.invalidInput');
  const resolved={};
  for(const [key,definition] of Object.entries(spec.parameters)){
    const value=Object.hasOwn(values,key)?values[key]:definition.default;
    const valid=definition.type==='boolean'?typeof value==='boolean':definition.type==='enum'?definition.values.includes(value):typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER&&(definition.type!=='integer'||Number.isSafeInteger(value))&&(definition.minimum===undefined||value>=definition.minimum)&&(definition.maximum===undefined||value<=definition.maximum);
    if(!valid)throw uiError('localRuns.invalidInput');resolved[key]=value;
  }
  return resolved;
}

// Browser records never enter the Experiment, Evidence or publication APIs.
// Only bounded metrics are persisted; traces and live frames are released per child.
export function createLocalRuns({api,doc=globalThis.document,runtimeFactory=createBrowserPreviewRuntime}){
  const win=doc.defaultView,requests=new Set(),listeners=new Set();
  let scope=null,records=[],operation=null,acquisition=null,epoch=0,notice='',storageHealthy=true;
  const key=()=>`riffology:local-runs:v1:${scope.tenantId}:${scope.projectId}:${scope.workspaceId}`;
  const notify=()=>{for(const listener of listeners)listener();};
  const save=()=>{
    const text=JSON.stringify({schemaVersion:1,scope:{tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId},records});
    if(text.length>MAX_BYTES)throw uiError('localRuns.storageFailed');
    try{win.localStorage.setItem(key(),text);}catch{throw uiError('localRuns.storageFailed');}
  };
  const eligible=model=>!!scope&&storageHealthy&&!scope.readOnly&&!!model?.spec&&!!model.version&&!model.reasonCode&&!model.compiler;
  function restore(recover){
    try{
      const raw=win.localStorage.getItem(key());if(raw?.length>MAX_BYTES)throw uiError('localRuns.storageFailed');
      const saved=JSON.parse(raw||'null');
      if(saved){
        if(saved.schemaVersion!==1||saved.scope?.tenantId!==scope.tenantId||saved.scope?.projectId!==scope.projectId||saved.scope?.workspaceId!==scope.workspaceId||!Array.isArray(saved.records)||saved.records.length>MAX_HISTORY)throw uiError('localRuns.storageFailed');
        if(saved.records.some(record=>!validRecord(record)))throw uiError('localRuns.storageFailed');records=saved.records;
        let interrupted=false;
        for(const record of records)if(recover&&activeStatuses.has(record.status)){
          record.status='interrupted';for(const run of record.runs)if(['queued','running'].includes(run.status))run.status='interrupted';interrupted=true;
        }
        if(interrupted){save();notice=msg('localRuns.interrupted');}
      }
    }catch{records=[];storageHealthy=false;notice=msg('localRuns.storageFailed');}
  }
  async function enter(value){
    leave();if(!id(value?.tenantId)||!id(value?.projectId)||!id(value?.workspaceId))throw uiError('localRuns.invalidInput');scope={...value};storageHealthy=true;
    const token=epoch;
    if(win.navigator.locks){await win.navigator.locks.request(`riffology:local-execution:${scope.tenantId}`,{ifAvailable:true},lock=>{if(token===epoch&&scope){restore(!!lock);if(!lock)notice=msg('localRuns.busy');}});}else restore(true);
    notify();
  }
  function stop(status='cancelled'){
    const op=operation;if(!op)return;operation=null;epoch++;
    for(const request of requests)request.abort();
    op.engine?.runtime.dispose();op.mount.remove();
    op.record.status=status;for(const run of op.record.runs)if(['queued','running'].includes(run.status))run.status=status;
    try{save();}catch{notice=msg('localRuns.storageFailed');}notify();
  }
  function leave(){stop('interrupted');acquisition=null;epoch++;for(const request of requests)request.abort();scope=null;records=[];notice='';notify();}
  async function execute(kind,model,input){
    if(operation||acquisition)throw uiError('localRuns.busy');if(!scope)throw uiError('localRuns.unavailable');
    const capturedModel=clone(model),capturedInput=clone(input),waiting={epoch};acquisition=waiting;notify();
    try{
      const run=lock=>{
        if(waiting.epoch!==epoch||!scope)return;
        if(win.navigator.locks&&!lock)throw uiError('localRuns.busy');
        restore(true);if(!storageHealthy)throw uiError('localRuns.storageFailed');
        return executeLocked(kind,capturedModel,capturedInput);
      };
      if(win.navigator.locks)await win.navigator.locks.request(`riffology:local-execution:${scope.tenantId}`,{ifAvailable:true},run);else await run(null);
    }finally{if(acquisition===waiting){acquisition=null;notify();}}
  }
  async function executeLocked(kind,model,input){
    if(operation)throw uiError('localRuns.busy');if(!eligible(model))throw uiError('localRuns.unavailable');
    const captured=clone(model),version=captured.version;
    if(!hash(version.filesSha256)||!hash(version.specSha256))throw uiError('localRuns.invalidInput');
    const seeds=kind==='single'?[input.seed]:input.seeds;
    if(!Array.isArray(seeds)||!seeds.length||new Set(seeds).size!==seeds.length||seeds.some(seed=>!Number.isSafeInteger(seed)||seed<0||seed>4294967295))throw uiError('localRuns.invalidInput');
    const configurations=kind==='single'?[{label:t('localRuns.single'),parameters:parameters(captured.spec,input.parameters)}]:[input.baseline,...input.interventions].map((config,index)=>({configurationId:String(index),label:config.label,parameters:parameters(captured.spec,config.parameters)}));
    if(configurations.length*seeds.length>MAX_RUNS)throw uiError('localRuns.groupLimit');
    if(records.length>=MAX_HISTORY)throw uiError('localRuns.historyFull');
    const record={id:win.crypto.randomUUID(),execution:'browser-local',kind,status:'preparing',createdAt:new Date().toISOString(),version:clone(version),packageIdentity:null,runtime:null,hypothesis:kind==='comparison'?input.hypothesis:'',configurations,seeds,metrics:clone(captured.spec.metrics||{}),runs:configurations.flatMap((config,index)=>seeds.map(seed=>({configurationId:String(index),parameters:clone(config.parameters),seed,status:'queued',metrics:null})))};
    const previous=records;records=[record,...records];
    try{save();}catch(error){records=previous;throw error;}
    const mount=doc.createElement('div');mount.hidden=true;doc.body.append(mount);
    const op={record,mount,engine:null,epoch:++epoch};operation=op;notice='';notify();
    const valid=()=>scope&&operation===op&&epoch===op.epoch;
    const request=(url,options={})=>browserPreviewRequest(api,url,options,requests);
    const base=`/api/workspaces/${encodeURIComponent(scope.workspaceId)}/browser-preview`;
    const stateUrl=base+(version.revisionId?'?revisionId='+encodeURIComponent(version.revisionId):'');
    try{
      const state=await request(stateUrl);if(!valid())return;
      if(state.build?.status!=='ready'||!hash(state.build.packageIdentity))throw uiError('localRuns.packageUnavailable');
      if(version.revisionId&&state.build.revisionId!==version.revisionId)throw uiError('localRuns.identityMismatch');
      const bytes=await request(`${base}/packages/${state.build.packageIdentity}`,{responseType:'bytes'});if(!valid())return;
      // API byte mode is explicit, so authenticated JSON responses cannot become a package.
      op.engine=await runtimeFactory({delivery:state.delivery,request,win,visualRoot:mount,metricRoot:doc.createElement('div')});
      if(!valid()){op.engine.runtime.dispose();return;}
      const loaded=await op.engine.runtime.load(bytes);if(!valid())return;
      const manifest=loaded.manifest;
      if(manifest.projectId!==scope.projectId||manifest.packageIdentity!==state.build.packageIdentity||manifest.revisionId!==state.build.revisionId||manifest.filesSha256!==version.filesSha256||manifest.sources.find(source=>source.path==='model/model-spec.json')?.sha256!==version.specSha256)throw uiError('localRuns.identityMismatch');
      record.packageIdentity=manifest.packageIdentity;record.runtime=clone(manifest.runtime);record.version.revisionId=manifest.revisionId;
      record.status='running';save();notify();
      for(const run of record.runs){
        if(!valid())return;
        // Authorization is rechecked between children; failures never fall back to cloud.
        const current=await request(stateUrl);if(!valid())return;
        if(current.build?.status!=='ready'||current.build.packageIdentity!==record.packageIdentity)throw uiError('localRuns.identityMismatch');
        run.status='running';save();notify();
        try{
          const trace=await op.engine.runtime.run({parameters:clone(run.parameters),seed:run.seed},mount);if(!valid())return;
          const metrics=trace.snapshots?.at(-1)?.metrics;
          if(!metrics||Object.keys(record.metrics).some(key=>typeof metrics[key]!=='number'||!Number.isFinite(metrics[key])))throw uiError('localRuns.invalidResult');
          run.metrics=Object.fromEntries(Object.keys(record.metrics).map(key=>[key,metrics[key]]));run.status='completed';
        }catch(error){if(!valid())return;run.status='failed';run.error=String(errorMessage(error)).slice(0,1024);}
        finally{op.engine.runtime.cancel();}
        save();notify();
        if(run.status==='failed'){for(const pending of record.runs)if(pending.status==='queued')pending.status='cancelled';break;}
      }
      record.status=record.runs.every(run=>run.status==='completed')?'completed':'failed';
    }catch(error){
      if(!valid())return;record.status='failed';record.error=String(errorMessage(error)).slice(0,1024);
      for(const run of record.runs)if(['queued','running'].includes(run.status))run.status='cancelled';
    }finally{
      op.engine?.runtime.dispose();mount.remove();
      if(valid()){operation=null;try{save();}catch{notice=msg('localRuns.storageFailed');}notify();}
    }
  }
  function selector(mode,onChange,disabled){
    const label=doc.createElement('label');label.append(bindValue(doc.createElement('span'),msg('localRuns.execution')));
    const select=doc.createElement('select');select.name='execution';select.disabled=disabled;
    for(const value of ['local','cloud']){const option=doc.createElement('option');option.value=value;bindValue(option,msg(value==='local'?'localRuns.local':'localRuns.cloud'));select.append(option);}
    select.value=mode;select.onchange=()=>onChange(select.value);label.append(select);return label;
  }
  function renderHistory(root,kind,currentVersion){
    const node=(tag,text,className)=>{const value=doc.createElement(tag);if(text!==undefined)bindValue(value,text);if(className)value.className=className;return value;};
    root.append(node('h3',msg('localRuns.history')),node('p',msg('localRuns.boundary'),'meta'));
    if(records.length){
      const download=node('button',msg('localRuns.export'),'button');download.type='button';download.onclick=()=>{
        const url=win.URL.createObjectURL(new win.Blob([JSON.stringify({schemaVersion:1,execution:'browser-local',scope,records},null,2)],{type:'application/json'}));
        const link=doc.createElement('a');link.href=url;link.download='riffology-local-runs.json';doc.body.append(link);link.click();link.remove();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);
      };root.append(download);
    }
    if(notice)root.append(node('p',notice,'model-warning'));
    const history=records.filter(record=>record.kind===kind);
    if(!history.length)root.append(node('p',msg('localRuns.empty')));
    for(const record of history){
      const article=node('article',undefined,'local-run-record');article.dataset.localRunId=record.id;
      article.append(node('h4',record.hypothesis||msg('localRuns.single')),node('p',msg('localRuns.record',()=>({status:t('localRuns.status.'+record.status),id:record.id,revision:record.version.revisionId}))));
      if(currentVersion&&(currentVersion.filesSha256!==record.version.filesSha256||currentVersion.specSha256!==record.version.specSha256))article.append(node('p',msg('localRuns.stale'),'model-warning'));
      if(record.error)article.append(node('p',record.error,'model-warning'));
      if(operation?.record===record){const cancel=node('button',msg('localRuns.cancel'),'button');cancel.type='button';cancel.onclick=()=>stop();article.append(cancel);}
      if(kind==='comparison'){
        const table=node('table');table.append(node('caption',msg('localRuns.comparison')));
        const header=node('tr');for(const key of ['compare.column.metric','compare.column.count','compare.column.mean','compare.column.baseline','compare.column.delta'])header.append(node('th',msg(key)));table.append(header);
        for(const [index,config]of record.configurations.entries())for(const metric of Object.keys(record.metrics)){
          const samples=record.runs.filter(run=>run.configurationId===String(index)&&run.status==='completed'&&Number.isFinite(run.metrics?.[metric]));
          const baseline=record.runs.filter(run=>run.configurationId==='0'&&run.status==='completed'&&Number.isFinite(run.metrics?.[metric]));
          const mean=runs=>runs.length?runs.reduce((sum,run)=>sum+run.metrics[metric]/runs.length,0):null;
          const value=mean(samples),baseMean=mean(baseline),format=number=>number!==null?formatNumber(number,{maximumSignificantDigits:6}):'—';
          const row=node('tr');for(const text of [`${config.label} / ${metric}`,msg('compare.samples',{valid:samples.length,missing:record.seeds.length-samples.length,error:''}),format(value),format(baseMean),format(value!==null&&baseMean!==null?value-baseMean:null)])row.append(node('td',text));table.append(row);
        }
        const scroll=node('div',undefined,'comparison-table');scroll.append(table);article.append(scroll);
      }else if(record.runs[0]?.metrics)article.append(node('pre',JSON.stringify(record.runs[0].metrics,null,2)));
      const details=node('details');details.append(node('summary',msg('localRuns.details')),node('pre',JSON.stringify(record,null,2)));article.append(details);root.append(article);
    }
  }
  win.addEventListener('pagehide',()=>stop('interrupted'));
  win.addEventListener('storage',event=>{if(scope&&event.key===key()&&!operation&&!acquisition){restore(false);notify();}});
  return {enter,leave,execute,cancel:()=>stop(),eligible,selector,renderHistory,get busy(){return !!operation||!!acquisition;},subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener);}};
}
