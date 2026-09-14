const MESSAGES={
 'export-too-large':'研究包超过当前 16 MiB 或历史记录容量限制，未生成部分文件。',
 'export-sensitive-file':'保存版本包含凭据或私密配置文件名。请检查模型源文件并保存清理后的版本；历史引用也需要检查。',
 'export-result-missing':'某个已完成运行的结果文件缺失，无法生成完整研究包。',
 'export-source-mismatch':'保存的来源或结果校验不一致，导出已停止。',
 'export-evidence-mismatch':'结论引用与保存的运行记录不一致，导出已停止。',
 'export-model-spec-invalid':'保存的模型说明或执行文件不完整，请修复并保存后导出。',
 'export-dependencies-invalid':'保存的依赖锁无效，无法生成可复现的运行环境说明。',
 'export-model-changed':'模型在准备导出时发生变化，请重新导出当前保存版本。',
 'export-busy':'已有导出正在处理，请稍后重试。',
};
const MAX_BYTES=16*1024*1024;
export function createExportPanel({root,fetcher=fetch}){
 let context=null,generation=0,busy=false,controller=null;
 function render(message=''){
  root.replaceChildren();if(!context)return;
  const title=document.createElement('h2');title.textContent='Export · 可复现研究包';const description=document.createElement('p');description.textContent='下载当前保存模型及全部实验历史、结果和证据引用。包含历史模型版本与失败、取消记录；可在本地按 README 重放。';
  const button=document.createElement('button');button.type='button';button.className='button';button.disabled=busy;button.textContent=busy?'正在准备完整研究包…':'下载项目研究包 (.zip)';button.onclick=()=>void download();
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent=message;root.append(title,description,button,status);
 }
 async function download(){
  if(!context||busy)return;const token=generation,current=context;busy=true;const requestController=new AbortController();controller=requestController;const timeout=setTimeout(()=>requestController.abort(),60000);let response;render();
  try{
   response=await fetcher(`/api/workspaces/${encodeURIComponent(current.workspaceId)}/research-export`,{credentials:'same-origin',headers:{accept:'application/zip'},signal:requestController.signal});
   if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(MESSAGES[error.error]||`导出未完成（${response.status}），请检查登录状态或稍后重试。`);}
   if(response.headers.get('content-type')?.split(';')[0]!=='application/zip'||Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('研究包响应无效或超过容量限制，未下载。');
   const hash=response.headers.get('x-riffology-export-sha256');if(!hash||!/^[a-f0-9]{64}$/.test(hash)||!response.body)throw Error('研究包缺少完整性标识，未下载。');
   const reader=response.body.getReader(),parts=[];let size=0;
   try{for(;;){const value=await reader.read();if(value.done)break;size+=value.value.byteLength;if(size>MAX_BYTES)throw Error('研究包超过容量限制，未下载。');parts.push(value.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');if(digest!==hash||bytes[0]!==0x50||bytes[1]!==0x4b)throw Error('研究包完整性校验失败，未下载。');
   if(token!==generation||current!==context)return;
   const filename=/filename="([A-Za-z0-9_-]+\.zip)"/.exec(response.headers.get('content-disposition')||'')?.[1]||'riffology-project.zip';
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),link=document.createElement('a');link.href=url;link.download=filename;root.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);busy=false;render('研究包已下载并通过完整性校验。解压后阅读 README.md，运行 replay.py 验证与重放。');
  }catch(error){if(token===generation){busy=false;render(error.name==='AbortError'?'导出等待超时；可重新请求，导出不会重新运行实验。':error.message||'导出未完成，请重试。');}}
  finally{clearTimeout(timeout);await response?.body?.cancel().catch(()=>{});if(token===generation){busy=false;controller=null;}}
 }
 function enter(value){leave();if(!value||typeof value.workspaceId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.workspaceId))throw Error('invalid-export-context');context=value;render();}
 function leave(){generation++;controller?.abort();controller=null;busy=false;context=null;root.replaceChildren();}
 return {enter,leave};
}
