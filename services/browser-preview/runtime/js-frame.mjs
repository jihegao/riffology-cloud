// This opaque frame receives only an exact package identity, validated model trace,
// and the package-pinned frontend source. It has no app API or credential broker.
import {MESSAGE_SCHEMA,validateRunRequest,validateTrace} from './protocol.mjs';
import {JS_LIMITS,drawFrontendScene,sceneSelection,validateFrontendEvent,validateFrontendManifest,validateFrontendScene} from './js-scene.mjs';
let port,worker,workerUrl,moduleUrl,request,trace,manifest,canvas,context,scene,index=0,token=0,renderSequence=0,events=0,eventWindowStarted=0,eventWindowCount=0,invalid=0,rendering=false,queued=null,stopped=false;
const exact=(value,fields)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(',');
// Opaque sandboxed frames cannot launch blob module Workers in Chromium. The
// fixed controller therefore runs in a classic Worker and captures its channel
// and intrinsics inside a sibling closure before authored code runs. Authored
// code receives no privileged lexical binding and cannot replace the captured
// channel through prototype or global poisoning.
const workerController=`'use strict';(()=>{const safePost=self.postMessage.bind(self),safeClone=self.structuredClone.bind(self),safeFreeze=Object.freeze,safeValues=Object.values,safeDefine=Object.defineProperty,safeString=String,safeAdd=self.addEventListener.bind(self);const denied=()=>{throw Error('runtime-js-capability-denied')};for(const name of ['Worker','SharedWorker','importScripts','fetch','XMLHttpRequest','WebSocket','EventSource','BroadcastChannel','indexedDB','caches','cookieStore','postMessage']){try{safeDefine(self,name,{value:denied,writable:false,configurable:false})}catch{}}let base=null,renderFunction=null;const freeze=value=>{if(value&&typeof value==='object'){safeFreeze(value);for(const child of safeValues(value))freeze(child);}return value;};safeAdd('message',async event=>{if(event.isTrusted!==true)return;const message=event.data;try{if(message.type==='initialize'){const candidate=self.__riffologyRender;if(typeof candidate!=='function')throw Error('runtime-js-export-invalid');renderFunction=candidate;try{safeDefine(self,'__riffologyRender',{value:null,writable:false,configurable:false})}catch{}base=freeze(message.base);safePost({type:'initialized'});return;}if(message.type!=='render'||!renderFunction)return;const context=freeze(safeClone({...base,index:message.index,snapshot:message.snapshot,event:message.event}));const scene=await renderFunction(context);safePost({type:'scene',sequence:message.sequence,index:message.index,token:message.token,scene});}catch(error){safePost({type:'error',text:safeString(error?.message??error).slice(0,1024)});}});})();\n`;
function classicFrontend(source){
 const declaration=/^([ \t]*)export[ \t]+(async[ \t]+)?function[ \t]+render[ \t]*\([ \t]*context[ \t]*\)/gm,matches=[...source.matchAll(declaration)];
 if(matches.length!==1)throw Error('runtime-js-export-invalid');
 const transformed=source.replace(declaration,(_match,indent,asyncKeyword)=>`${indent}${asyncKeyword??''}function render(context)`);
 if(/^\s*(?:import|export)\b/m.test(transformed))throw Error('runtime-js-export-invalid');
 return workerController+`self.__riffologyRender=(()=>{${transformed}\nreturn render;})();`;
}
function send(type,extra={}){if(!request||!port)return;port.postMessage({schema:MESSAGE_SCHEMA,type,requestId:request.requestId,packageIdentity:request.packageIdentity,...extra});}
function stop(){stopped=true;worker?.terminate();worker=null;if(workerUrl)URL.revokeObjectURL(workerUrl);if(moduleUrl)URL.revokeObjectURL(moduleUrl);workerUrl=moduleUrl=null;canvas?.remove();canvas=null;trace=null;scene=null;request=null;queued=null;rendering=false;}
function fail(code,error=code){send('error',{code,text:String(error?.message??error).slice(0,1024)});stop();}
function allowedEvent(event){const now=performance.now();if(now-eventWindowStarted>=1000){eventWindowStarted=now;eventWindowCount=0;}if(events>=JS_LIMITS.eventsPerSession||eventWindowCount>=JS_LIMITS.eventsPerSecond)return false;validateFrontendEvent(event,manifest.width,manifest.height);events++;eventWindowCount++;return true;}
function render(nextIndex,nextToken,event=null){
 if(stopped||!worker||rendering){queued={index:nextIndex,token:nextToken,event};return;}
 if(!Number.isSafeInteger(nextIndex)||nextIndex<0||nextIndex>=trace.snapshots.length||!Number.isSafeInteger(nextToken)||nextToken<0)return;
 if(event!==null&&!allowedEvent(event))return;
 rendering=true;index=nextIndex;token=nextToken;
 worker.postMessage({type:'render',sequence:++renderSequence,index,token,snapshot:trace.snapshots[index],event});
 send('paint-dispatched',{index,token});
}
function pointer(event){
 if(!scene||rendering)return;const bounds=canvas.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
 const x=Math.max(0,Math.min(manifest.width,Math.round((event.clientX-bounds.left)*manifest.width/bounds.width))),y=Math.max(0,Math.min(manifest.height,Math.round((event.clientY-bounds.top)*manifest.height/bounds.height)));
 const selected=sceneSelection(scene,x,y),frontendEvent=selected?{type:'select',id:selected}:{type:'pointer',x,y,button:event.button};render(index,0,frontendEvent);
}
self.addEventListener('message',event=>{
 if(port||event.source!==parent||!event.data||event.data.type!=='connect'||event.ports.length!==1)return;
 port=event.ports[0];port.onmessage=event=>{
  const message=event.data;if(message?.type==='terminate'){stop();return;}
  if(message?.type==='paint'){
   if(!request||!exact(message,['type','requestId','packageIdentity','index','token'])||message.requestId!==request.requestId||message.packageIdentity!==request.packageIdentity)return;
   render(message.index,message.token);return;
  }
  if(message?.type!=='initialize'||worker||request)return;
  try{
   const payload=message.payload;
   if(!exact(payload,['request','revisionId','trace','visualization','frontend'])||!payload.request||payload.request.packageIdentity!==payload.frontend?.packageIdentity)throw Error('runtime-js-initialize-invalid');
   if(typeof payload.revisionId!=='string'||payload.revisionId.length<1||payload.revisionId.length>128||!exact(payload.frontend,['packageIdentity','manifest','source'])||typeof payload.frontend.source!=='string'||new TextEncoder().encode(payload.frontend.source).byteLength>JS_LIMITS.sourceBytes)throw Error('runtime-js-initialize-invalid');
   request=validateRunRequest(payload.request);trace=validateTrace(payload.trace);manifest=validateFrontendManifest(payload.frontend.manifest);
   canvas=document.createElement('canvas');canvas.width=manifest.width;canvas.height=manifest.height;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Isolated JavaScript model frontend using validated local trace');canvas.addEventListener('pointerdown',pointer);document.body.append(canvas);context=canvas.getContext('2d');
   workerUrl=URL.createObjectURL(new Blob([classicFrontend(payload.frontend.source)],{type:'text/javascript'}));worker=new Worker(workerUrl);
   worker.onmessage=event=>{const message=event.data;if(message?.type==='initialized'){render(0,0);return;}if(message?.type==='error'){fail('runtime-js-render-failed',message.text);return;}if(!exact(message,['type','sequence','index','token','scene'])||message.type!=='scene'||message.sequence!==renderSequence||message.index!==index||message.token!==token){if(++invalid>=32)fail('runtime-js-worker-message-invalid');return;}try{scene=validateFrontendScene(message.scene,manifest.width,manifest.height);drawFrontendScene(context,scene,manifest.width,manifest.height);rendering=false;send(token===0&&index===0&&events===0?'ready':'painted',{index,token});if(queued){const next=queued;queued=null;render(next.index,next.token,next.event);}}catch(error){fail('runtime-js-scene-invalid',error);}};
   worker.onerror=event=>fail('runtime-js-worker-failed',event.message);
   worker.postMessage({type:'initialize',base:{revisionId:payload.revisionId,packageIdentity:request.packageIdentity,parameters:request.input.parameters,seed:request.input.seed}});
  }catch(error){fail('runtime-js-initialize-invalid',error);}
 };port.start();port.postMessage({type:'connected'});
});
