import {msg,errorMessage} from './i18n.js';
import {bindValue} from './i18n-bindings.js';

/** Only the authenticated workbench owns this editor. No page-port write API. */
export function createManualSavePanel({root,api,onSaved=()=>{}}){
 const doc=root.ownerDocument,win=doc.defaultView;
 let context=null,epoch=0,state=null,busy=false,pending=null;
 let limits={maxRequestBytes:4*1024*1024,maxFileBytes:262144,maxChanges:64,textOnly:false};
 const changes=new Map(),deletes=new Set(),artifacts=new Map();
 const el=(tag,key)=>{const n=doc.createElement(tag);if(key)bindValue(n,()=>msg('manualSave.'+key));return n;};
 const title=el('h3','title'),help=el('p','help'),status=el('p'),summary=el('ul');status.setAttribute('role','status');
 const path=el('input'),content=el('textarea'),upload=el('input'),mark=el('input'),artifactTitle=el('input');
 path.type='text';path.autocomplete='off';content.rows=10;upload.type='file';upload.multiple=true;mark.type='checkbox';
 const field=(key,node)=>{const label=el('label');label.append(el('span',key),node);return label;};
 const load=el('button','load'),stage=el('button','stage'),remove=el('button','remove'),save=el('button','save'),check=el('button','check'),refresh=el('button','refresh');
 const controls=[path,content,upload,mark,artifactTitle,load,stage,remove,save,refresh];
 for(const b of [load,stage,remove,save,check,refresh])b.type='button';
 const recovery=el('section'),requestText=el('textarea'),restore=el('button','restore');requestText.rows=6;restore.type='button';recovery.append(field('originalRequest',requestText),restore);
 const actions=el('div');actions.className='manual-save-actions';actions.append(stage,remove,save,check,refresh);
 root.classList.add('manual-save-panel');
 root.append(title,help,field('path',path),load,field('content',content),field('upload',upload),field('mark',mark),field('artifactTitle',artifactTitle),summary,actions,recovery,status);
 const storageKey=()=>`riffology:manual-save:${context?.tenantId}:${context?.workspaceId}`;
 const current=(token)=>context&&token===epoch;
 function message(key){bindValue(status,()=>msg('manualSave.'+key));}
 function remember(){if(pending)win.sessionStorage.setItem(storageKey(),JSON.stringify({key:pending.key,operationId:pending.operationId,requestSha256:pending.requestSha256}));else win.sessionStorage.removeItem(storageKey());}
 function render(){
  const locked=!context?.canWrite||!state||busy||Boolean(pending);
  for(const n of controls)n.disabled=locked;
  refresh.disabled=!context?.canRead||busy||Boolean(pending);
  check.hidden=!pending;check.disabled=busy||!context?.canRecover;
  recovery.hidden=!pending;restore.disabled=busy||!context?.canRecover||!pending?.requestSha256;requestText.disabled=busy||!context?.canRecover;
  summary.replaceChildren();
  for(const [p,value]of changes){const li=el('li');const operation=state?.files?.some(f=>f.path===p)?'~':'+';const bytes=new TextEncoder().encode(value.content).length;bindValue(li,()=>`${operation} ${p} (${bytes})`);summary.append(li);}
  for(const p of deletes){const li=el('li');bindValue(li,()=>`− ${p}`);summary.append(li);}
  for(const [p,value]of artifacts){const li=el('li');const label=el('span','userUpload');li.append(label,doc.createTextNode(`: ${value.title||p} (${p})`));summary.append(li);}
 }
 function pathValue(){const p=path.value.trim();if(!p||p.length>1024||p.startsWith('/')||p.split('/').some(s=>!s||s==='.'||s==='..'))throw Error(String(msg('manualSave.invalidPath')));return p;}
 function stageValue(p,encoding,value){if(changes.size>=limits.maxChanges&&!changes.has(p))throw Error(String(msg('manualSave.tooLarge')));changes.set(p,{path:p,encoding,content:value});deletes.delete(p);}
 function fail(error){bindValue(status,()=>errorMessage(error));}
 async function reload(){
  if(!context||pending||busy)return;const token=epoch;busy=true;render();
  try{const value=await api(`/api/workspaces/${encodeURIComponent(context.workspaceId)}/manual-saves`);if(!current(token))return;
   if(!value?.base||!Array.isArray(value.files)||!Array.isArray(value.artifacts))throw Error(String(msg('manualSave.unavailable')));
   state=value;changes.clear();deletes.clear();artifacts.clear();for(const a of value.artifacts)artifacts.set(a.path,a);message('ready');
  }catch(error){if(current(token)){state=null;fail(error);}}finally{if(current(token)){busy=false;render();}}
 }
 function finish(result,postResponse=false){
  if(result?.operationId!==pending.key||postResponse&&result?.status==='rejected'&&result.requestSha256!==pending.requestSha256)throw Error(String(msg('manualSave.unknown')));
  if(!result||!['committed','unchanged','rejected','pending','unknown'].includes(result.status))throw Error(String(msg('manualSave.unknown')));
  if(result.operationId){pending.operationId=result.operationId;remember();}
  if(['pending','unknown'].includes(result.status)){message('unknown');return false;}
  pending=null;remember();if(result.status==='rejected'){message('rejected');return false;}
  changes.clear();deletes.clear();onSaved(result);message(result.status==='unchanged'?'unchanged':'saved');return true;
 }
 async function submit(observe=false){
  if(!context||busy||(observe?!context.canRecover:!context.canWrite||!state||pending))return;
  const token=epoch,basePath=`/api/workspaces/${encodeURIComponent(context.workspaceId)}/manual-saves`;let completed=false;
  if(!observe){
   const body={schema:'project.manual-save/v1',base:state.base,changes:[...changes.values()],deletes:[...deletes],artifacts:[...artifacts.values()]};
   const bytes=body.changes.reduce((sum,c)=>sum+(c.encoding==='base64'?atob(c.content).length:new TextEncoder().encode(c.content).length),0);
   if(body.changes.length+body.deletes.length>limits.maxChanges||body.artifacts.length>16||bytes>2*1024*1024||new TextEncoder().encode(JSON.stringify(body)).length>limits.maxRequestBytes){message('tooLarge');return;}
   pending={key:win.crypto.randomUUID(),body};requestText.value=JSON.stringify(body);
  }
  busy=true;render();message('saving');
  try{let result,postResponse=false;
   if(pending.body)pending.requestSha256=[...new Uint8Array(await win.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(pending.body))))].map(n=>n.toString(16).padStart(2,'0')).join('');
   if(!current(token))return;
   try{remember();}catch{if(!observe){pending=null;message('storageFailed');}else message('unknown');return;}
   if(observe){try{result=await api(`${basePath}/${encodeURIComponent(pending.operationId||pending.key)}`);if(current(token)&&result?.status==='pending'&&pending.body){postResponse=true;result=await api(basePath,{method:'POST',headers:{'Idempotency-Key':pending.key},body:JSON.stringify(pending.body)});}}catch(error){if(!current(token))return;if(error.status!==404||!pending.body)throw error;postResponse=true;result=await api(basePath,{method:'POST',headers:{'Idempotency-Key':pending.key},body:JSON.stringify(pending.body)});}}
   else{postResponse=true;result=await api(basePath,{method:'POST',headers:{'Idempotency-Key':pending.key},body:JSON.stringify(pending.body)});}
   if(!current(token))return;completed=finish(result,postResponse);
  }catch(error){if(current(token)){message('unknown');}}finally{if(current(token)){busy=false;render();if(completed)await reload();}}
 }
 load.onclick=async()=>{if(!context||busy||pending)return;const token=epoch;busy=true;render();try{const p=pathValue(),value=await api(`/api/workspaces/${encodeURIComponent(context.workspaceId)}/manual-saves?path=${encodeURIComponent(p)}`);if(!current(token))return;if(value.encoding!=='utf8')throw Error(String(msg('manualSave.binary')));content.value=value.content;mark.checked=artifacts.has(p);artifactTitle.value=artifacts.get(p)?.title??'';}catch(error){if(current(token))fail(error);}finally{if(current(token)){busy=false;render();}}};
 stage.onclick=()=>{try{const p=pathValue();if(new TextEncoder().encode(content.value).length>limits.maxFileBytes)throw Error(String(msg('manualSave.tooLarge')));stageValue(p,'utf8',content.value);if(mark.checked)artifacts.set(p,{path:p,title:artifactTitle.value.trim()||p});else artifacts.delete(p);message('staged');render();}catch(error){fail(error);}};
 remove.onclick=()=>{try{const p=pathValue();changes.delete(p);deletes.add(p);artifacts.delete(p);message('staged');render();}catch(error){fail(error);}};
 upload.onchange=async()=>{if(!context||busy||pending)return;const token=epoch;busy=true;render();try{for(const file of upload.files){if(file.size>limits.maxFileBytes)throw Error(String(msg('manualSave.tooLarge')));const bytes=new Uint8Array(await file.arrayBuffer());if(!current(token))return;if(limits.textOnly){let text;try{text=new TextDecoder('utf8',{fatal:true}).decode(bytes);}catch{throw Error(String(msg('manualSave.binary')));}if(text.includes('\0'))throw Error(String(msg('manualSave.binary')));stageValue(file.webkitRelativePath||file.name,'utf8',text);}else{let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);stageValue(file.webkitRelativePath||file.name,'base64',btoa(binary));}}message('staged');}catch(error){if(current(token))fail(error);}finally{if(current(token)){busy=false;upload.value='';render();}}};
 restore.onclick=async()=>{
  if(!context?.canRecover||busy||!pending?.requestSha256)return;
  const token=epoch,original=pending;busy=true;render();let accepted=false;
  try{
   if(new TextEncoder().encode(requestText.value).length>limits.maxRequestBytes)throw Error('invalid');
   const body=JSON.parse(requestText.value),digest=[...new Uint8Array(await win.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body))))].map(n=>n.toString(16).padStart(2,'0')).join('');
   if(!current(token)||pending!==original)return;
   if(digest!==original.requestSha256)throw Error('mismatch');
   pending.body=body;accepted=true;
  }catch{if(current(token))message('requestMismatch');}finally{if(current(token)){busy=false;render();}}
  if(accepted&&current(token))await submit(true);
 };
 save.onclick=()=>void submit();check.onclick=()=>void submit(true);refresh.onclick=()=>void reload();
 function leave(){epoch++;context=null;state=null;pending=null;busy=false;changes.clear();deletes.clear();artifacts.clear();path.value='';content.value='';artifactTitle.value='';requestText.value='';mark.checked=false;root.hidden=true;render();}
 async function enter(value){leave();context={...value,canRead:value.canWrite,canRecover:value.canWrite};if(!value.canWrite){render();return;}const token=epoch;if(value.resolveCapability){root.hidden=true;try{const capability=await api(`/api/workspaces/${encodeURIComponent(value.workspaceId)}/manual-saves?capability=1`);if(!current(token))return;context={...value,canRead:value.canWrite&&capability.canRead===true,canWrite:value.canWrite&&capability.canWrite===true,canRecover:value.canWrite&&capability.canRecover===true};limits=capability;bindValue(help,()=>msg(limits.textOnly?'manualSave.restrictedHelp':'manualSave.help'));}catch{if(current(token))leave();return;}}root.hidden=!context.canRead;try{const prior=JSON.parse(win.sessionStorage.getItem(storageKey()));if(prior&&typeof prior.key==='string')pending={key:prior.key,operationId:prior.operationId,requestSha256:typeof prior.requestSha256==='string'&&/^[a-f0-9]{64}$/.test(prior.requestSha256)?prior.requestSha256:undefined};}catch{}if(pending){message('unknown');render();}else if(context.canRead)void reload();}
 leave();return {enter,leave,reload};
}
