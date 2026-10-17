import {isolatedBrowserMain} from './isolated-browser.mjs';
import {PROJECT_VIEW_FRAME_HTML} from './frame.mjs';

export const PROJECT_VIEW_BROWSER_PROGRAM='await ('+isolatedBrowserMain.toString()+')();';
const encoder=new TextEncoder(),MAX_FRAME=2*1024*1024,MAX_LINE=3*1024*1024;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys)=>object(value)&&Object.keys(value).sort().join(',')===keys.sort().join(',');
const bytes=value=>encoder.encode(JSON.stringify(value)).byteLength;
const failure=()=>Error('project-view-runtime-pipe-invalid');
/** No HTTP server or container port. The browser's sole host transport is the
 * fixed process's standard IO; all output is bounded, untrusted page data. */
export function createProjectViewRuntimePipe(process,input,options={}){
 if(!process?.stdin||!process.stdout)throw Error('project-view-runtime-pipe-unavailable');
 const writer=process.stdin.getWriter(),reader=process.stdout.getReader();
 let closing=false,failed=false,frame=null,messages=[],messageBytes=0,pending=0,queuedBytes=0,networkEvents=0,capturePending=false;
 let writeTail=Promise.resolve(),finish,finishReject;
 const finished=new Promise((resolve,reject)=>{finish=resolve;finishReject=reject;});
 void finished.catch(()=>{});
 function abort(){
  if(failed)return;failed=true;
  // EOF may arrive after process exit. A late exec.kill() can raise an
  // uncaught platform error; reject the protocol and let Runtime destroy the
  // original container/process tree. EOF itself is never cleanup proof.
  void writer.abort(failure()).catch(()=>{});void reader.cancel().catch(()=>{});
  finishReject(failure());
 }
 function write(value,max=70*1024){
  if(failed||closing&&value.type!=='close')return Promise.reject(failure());
  const line=encoder.encode(JSON.stringify(value)+'\n');
  if(line.byteLength>max||pending>=16||queuedBytes+line.byteLength>4*1024*1024){abort();return Promise.reject(failure());}
  pending++;queuedBytes+=line.byteLength;
  const work=writeTail.then(()=>{
   if(failed||closing&&value.type!=='close')throw failure();
   options.beforeWrite?.(value.type);
   return writer.write(line);
  });
  writeTail=work.catch(()=>{});
  return work.catch(error=>{abort();throw error;}).finally(()=>{pending--;queuedBytes-=line.byteLength;});
 }
 function observe(value){
  if(!object(value))throw failure();
  if(value.type==='broker'){
   if(!exact(value,['type','message'])||!object(value.message))throw failure();
   const length=bytes(value.message);
   if(length>4096||messages.length>=32||messageBytes+length>128*1024)throw failure();
   messages.push(value.message);messageBytes+=length;
  }else if(value.type==='frame'){
   if(!exact(value,['type','base64','width','height'])||value.width!==800||value.height!==600||typeof value.base64!=='string'||value.base64.length>Math.ceil(MAX_FRAME/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64))throw failure();
   const image=Uint8Array.from(atob(value.base64),c=>c.charCodeAt(0));
   if(image.length<33||image.length>MAX_FRAME||[137,80,78,71,13,10,26,10].some((n,i)=>image[i]!==n)||new DataView(image.buffer).getUint32(16)!==800||new DataView(image.buffer).getUint32(20)!==600)throw failure();
   capturePending=false;frame={base64:value.base64,width:800,height:600};
  }else if(value.type==='network'){
   if(!exact(value,['type','event','error'])||!['requestfailed','websocket-error'].includes(value.event)||typeof value.error!=='string'||!(value.error==='request-failed'||/^net::ERR_[A-Z0-9_]{1,80}$/.test(value.error))||++networkEvents>64)throw failure();
  }else throw failure();
 }
 const drain=(async()=>{
  // Bound allocation as well as bytes: one-byte chunks must not create
  // millions of retained objects before the line limit is reached.
  const line=new Uint8Array(MAX_LINE);let size=0;
  try{
   for(;;){
    const item=await reader.read();if(item.done)break;
    if(!(item.value instanceof Uint8Array))throw failure();
    let start=0;
    while(start<item.value.byteLength){
     const newline=item.value.indexOf(10,start),end=newline<0?item.value.byteLength:newline,part=item.value.subarray(start,end);
     if(size+part.byteLength>MAX_LINE)throw failure();line.set(part,size);size+=part.byteLength;
     if(newline<0)break;
     observe(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(line.subarray(0,size))));size=0;start=newline+1;
    }
   }
   if(size||!closing)throw failure();
   await process.exitCode;finish();
  }catch{abort();}
  finally{reader.releaseLock();}
 })();
 void drain.catch(abort);
 const ready=write({type:'init',package:input.pkg,view:input.view,frameHtml:PROJECT_VIEW_FRAME_HTML},4*1024*1024);
 return {
  ready,finished,
  send(command){if(closing||failed)return Promise.reject(failure());return write(command);},
  capture(){if(closing||failed)return Promise.reject(failure());if(capturePending)return Promise.resolve();capturePending=true;return write({type:'capture'});},
  poll(){if(failed)throw failure();const result={messages,...(frame?{frame}:{})};messages=[];messageBytes=0;frame=null;return result;},
  async close(){
   if(closing)return;closing=true;
   try{await write({type:'close'});await writer.close();}
   catch{abort();}
   finally{messages=[];messageBytes=0;frame=null;}
  },
 };
}
