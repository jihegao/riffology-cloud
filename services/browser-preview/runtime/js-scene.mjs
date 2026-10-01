export const JS_FRONTEND_SCHEMA='riffology.browser-js/v1';
export const JS_HOST_API='riffology.browser-host/v1';
export const JS_SCENE_SCHEMA='riffology.browser-scene/v1';
export const JS_LIMITS=Object.freeze({sourceBytes:131072,sceneBytes:262144,marks:2048,eventsPerSecond:32,eventsPerSession:2048,textLength:128,idLength:128});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,fields)=>object(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(',');
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const color=value=>typeof value==='string'&&/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value);
const optionalId=value=>value===undefined||typeof value==='string'&&value.length>=1&&value.length<=JS_LIMITS.idLength;
const bounded=(value,maximum)=>finite(value)&&value>=0&&value<=maximum;
function size(value,maximum){let bytes;try{bytes=new TextEncoder().encode(JSON.stringify(value)).byteLength;}catch{throw Error('runtime-js-scene-invalid');}if(bytes>maximum)throw Error('runtime-js-scene-limit');}
export function validateFrontendManifest(value){
 if(!exact(value,['schema','hostApi','entry','width','height'])||value.schema!==JS_FRONTEND_SCHEMA||value.hostApi!==JS_HOST_API||value.entry!=='frontend/main.mjs'||value.width!==600||value.height!==420)throw Error('runtime-js-manifest-invalid');
 return value;
}
export function validateFrontendEvent(value,width=600,height=420){
 if(value===null)return value;
 if(exact(value,['type','x','y','button'])&&value.type==='pointer'&&bounded(value.x,width)&&bounded(value.y,height)&&Number.isInteger(value.button)&&value.button>=0&&value.button<=4)return value;
 if(exact(value,['type','id'])&&value.type==='select'&&typeof value.id==='string'&&value.id.length>=1&&value.id.length<=JS_LIMITS.idLength)return value;
 throw Error('runtime-js-event-invalid');
}
export function validateFrontendScene(value,width=600,height=420){
 if(!(exact(value,['schema','marks'])||exact(value,['schema','background','marks']))||value.schema!==JS_SCENE_SCHEMA||value.background!==undefined&&!color(value.background)||!Array.isArray(value.marks)||value.marks.length>JS_LIMITS.marks)throw Error('runtime-js-scene-invalid');
 size(value,JS_LIMITS.sceneBytes);
 const ids=new Set();
 for(const mark of value.marks){
  if(!object(mark)||!['rect','circle','line','text'].includes(mark.kind))throw Error('runtime-js-mark-invalid');
  if(mark.kind==='rect'){
   if(!(exact(mark,['kind','x','y','width','height','fill'])||exact(mark,['kind','id','x','y','width','height','fill']))||!optionalId(mark.id)||!bounded(mark.x,width)||!bounded(mark.y,height)||!finite(mark.width)||!finite(mark.height)||mark.width<=0||mark.height<=0||mark.x+mark.width>width||mark.y+mark.height>height||!color(mark.fill))throw Error('runtime-js-mark-invalid');
  }else if(mark.kind==='circle'){
   if(!(exact(mark,['kind','x','y','radius','fill'])||exact(mark,['kind','id','x','y','radius','fill']))||!optionalId(mark.id)||!bounded(mark.x,width)||!bounded(mark.y,height)||!finite(mark.radius)||mark.radius<=0||mark.x-mark.radius<0||mark.y-mark.radius<0||mark.x+mark.radius>width||mark.y+mark.radius>height||!color(mark.fill))throw Error('runtime-js-mark-invalid');
  }else if(mark.kind==='line'){
   if(!exact(mark,['kind','x1','y1','x2','y2','stroke','width'])||![mark.x1,mark.x2].every(v=>bounded(v,width))||![mark.y1,mark.y2].every(v=>bounded(v,height))||!color(mark.stroke)||!finite(mark.width)||mark.width<=0||mark.width>32)throw Error('runtime-js-mark-invalid');
  }else if(!((exact(mark,['kind','x','y','text','fill','size'])||exact(mark,['kind','id','x','y','text','fill','size']))&&optionalId(mark.id)&&bounded(mark.x,width)&&bounded(mark.y,height)&&typeof mark.text==='string'&&mark.text.length<=JS_LIMITS.textLength&&color(mark.fill)&&finite(mark.size)&&mark.size>=8&&mark.size<=64))throw Error('runtime-js-mark-invalid');
  if(mark.id!==undefined){if(ids.has(mark.id))throw Error('runtime-js-mark-invalid');ids.add(mark.id);}
 }
 return value;
}
export function drawFrontendScene(context,scene,width=600,height=420){
 context.clearRect(0,0,width,height);context.fillStyle=scene.background??'#ffffff';context.fillRect(0,0,width,height);
 for(const mark of scene.marks){
  if(mark.kind==='rect'){context.fillStyle=mark.fill;context.fillRect(mark.x,mark.y,mark.width,mark.height);}
  else if(mark.kind==='circle'){context.beginPath();context.arc(mark.x,mark.y,mark.radius,0,Math.PI*2);context.fillStyle=mark.fill;context.fill();}
  else if(mark.kind==='line'){context.beginPath();context.moveTo(mark.x1,mark.y1);context.lineTo(mark.x2,mark.y2);context.strokeStyle=mark.stroke;context.lineWidth=mark.width;context.stroke();}
  else{context.fillStyle=mark.fill;context.font=`${mark.size}px system-ui, sans-serif`;context.fillText(mark.text,mark.x,mark.y);}
 }
}
export function sceneSelection(scene,x,y){
 for(let i=scene.marks.length-1;i>=0;i--){const mark=scene.marks[i];if(!mark.id)continue;if(mark.kind==='rect'&&x>=mark.x&&x<=mark.x+mark.width&&y>=mark.y&&y<=mark.y+mark.height)return mark.id;if(mark.kind==='circle'&&(x-mark.x)**2+(y-mark.y)**2<=mark.radius**2)return mark.id;if(mark.kind==='text'&&x>=mark.x&&x<=mark.x+mark.text.length*mark.size*.7&&y>=mark.y-mark.size&&y<=mark.y)return mark.id;}
 return null;
}
