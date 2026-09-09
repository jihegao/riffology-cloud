import {normalizeObserverCommand,OBSERVER_LIMITS,parseObserverState,type ObserverCommand} from './observer-protocol.ts';

export type ObserverArtifactKind='state'|'view'|'screenshot';
export type ObserverArtifactReceipt={schemaVersion:1;artifactId:string;kind:ObserverArtifactKind;mediaType:'application/json'|'image/png';bytes:number;sha256:string};
export type ObserverArtifactBucket=Pick<R2Bucket,'get'|'put'>;
export interface ObserverArtifactInventoryPort{
 claim(command:ObserverCommand,receipt:ObserverArtifactReceipt):Promise<{shouldPut:boolean}>;
 beforePut?(command:ObserverCommand,receipt:ObserverArtifactReceipt):void;
 putSettled(command:ObserverCommand,receipt:ObserverArtifactReceipt,acknowledged:boolean):Promise<void>;
 verified(command:ObserverCommand,receipt:ObserverArtifactReceipt):Promise<void>;
}
const encoder=new TextEncoder(),hex=/^[a-f0-9]{64}$/,limits={state:OBSERVER_LIMITS.stateBytes,view:512*1024,screenshot:OBSERVER_LIMITS.screenshotBytes};
function denied():never{throw Error('observer-artifact-invalid');}
function kindOf(value:unknown):ObserverArtifactKind{if(value!=='state'&&value!=='view'&&value!=='screenshot')denied();return value;}
export function observerArtifactReceipt(raw:unknown):ObserverArtifactReceipt{
 if(!raw||typeof raw!=='object'||Object.getPrototypeOf(raw)!==Object.prototype)denied();
 const keys=['schemaVersion','artifactId','kind','mediaType','bytes','sha256'];
 if(Reflect.ownKeys(raw).length!==keys.length)denied();
 const data:Record<string,unknown>={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(raw,key);if(!d||!d.enumerable||!('value'in d))denied();data[key]=d.value;}
 const kind=kindOf(data.kind),mediaType=kind==='screenshot'?'image/png':'application/json';
 if(data.schemaVersion!==1||typeof data.artifactId!=='string'||!hex.test(data.artifactId)||typeof data.sha256!=='string'||!hex.test(data.sha256)||data.mediaType!==mediaType||!Number.isSafeInteger(data.bytes)||(data.bytes as number)<1||(data.bytes as number)>limits[kind])denied();
 return {schemaVersion:1,artifactId:data.artifactId,kind,mediaType,bytes:data.bytes as number,sha256:data.sha256};
}
function jsonDepth(value:unknown,depth=0):void{if(depth>OBSERVER_LIMITS.jsonDepth)denied();if(typeof value==='number'&&!Number.isFinite(value))denied();if(value&&typeof value==='object')for(const item of Object.values(value))jsonDepth(item,depth+1);}
function contentBytes(kind:ObserverArtifactKind,raw:Uint8Array):Uint8Array{
 if(!(raw instanceof Uint8Array)||raw.byteLength<1||raw.byteLength>limits[kind])denied();const bytes=Uint8Array.from(raw);
 if(kind==='state')parseObserverState(bytes);
 else if(kind==='view'){let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}catch{denied();}if(!value||typeof value!=='object'||Array.isArray(value))denied();jsonDepth(value);}
 else{
  // Header sanity only: this does not decode PNG pixels or verify all chunks/CRCs.
  const signature=[137,80,78,71,13,10,26,10];if(bytes.length<33||signature.some((v,i)=>bytes[i]!==v))denied();
  const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(d.getUint32(8)!==13||d.getUint32(12)!==0x49484452||d.getUint32(16)!==OBSERVER_LIMITS.screenshotWidth||d.getUint32(20)!==OBSERVER_LIMITS.screenshotHeight||bytes[26]!==0||bytes[27]!==0||!([0,1].includes(bytes[28]!)))denied();
  const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};if(!depths[bytes[25]!]?.includes(bytes[24]!))denied();
 }
 return bytes;
}
async function digest(bytes:Uint8Array):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function descriptor(command:ObserverCommand,kind:ObserverArtifactKind,sha256:string,bytes:number):Promise<{receipt:ObserverArtifactReceipt;objectKey:string}>{
 const artifactId=await digest(encoder.encode(JSON.stringify({schemaVersion:1,command,kind,sha256,bytes})));
 const s=command.scope,objectKey=`observer-artifacts/${s.tenantId}/${s.projectId}/${s.workspaceId}/${s.workspaceGeneration}/${command.turnId}/${command.dispatchId}/${command.commandId}/${artifactId}`;
 return {receipt:{schemaVersion:1,artifactId,kind,mediaType:kind==='screenshot'?'image/png':'application/json',bytes,sha256},objectKey};
}
/** Identity and historical normalization are not authorization. Keep this store private. */
export async function observerArtifactDescriptor(raw:ObserverCommand,rawKind:ObserverArtifactKind,content:Uint8Array):Promise<{receipt:ObserverArtifactReceipt;objectKey:string}>{const command=normalizeObserverCommand(raw),kind=kindOf(rawKind),bytes=contentBytes(kind,content);return descriptor(command,kind,await digest(bytes),bytes.byteLength);}
async function boundedRead(bucket:ObserverArtifactBucket,key:string,max:number,signal?:AbortSignal):Promise<Uint8Array|null>{
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const aborted=()=>{if(reader)void reader.cancel().catch(()=>{});};
 let rejectAbort:(reason:Error)=>void=()=>{};
 const expired=new Promise<never>((_,reject)=>{rejectAbort=reject;});void expired.catch(()=>{});
 const abort=()=>{aborted();rejectAbort(Error('observer-artifact-read-cancelled'));};
 const live=()=>{if(signal?.aborted)throw Error('observer-artifact-read-cancelled');};
 signal?.addEventListener('abort',abort,{once:true});
 try{
  live();
  const pending=bucket.get(key);
  void pending.then(object=>{if(signal?.aborted&&object)void object.body.cancel().catch(()=>{});},()=>{});
  const object=await Promise.race([pending,expired]);live();if(!object)return null;
  if(!Number.isSafeInteger(object.size)||object.size<1||object.size>max){void object.body.cancel().catch(()=>{});denied();}
  reader=object.body.getReader();const chunks:Uint8Array[]=[];let size=0,count=0;
  while(true){live();const item=await Promise.race([reader.read(),expired]);live();if(item.done)break;if(!(item.value instanceof Uint8Array)||++count>OBSERVER_LIMITS.resourceChunks||(size+=item.value.byteLength)>max)denied();chunks.push(Uint8Array.from(item.value));}
  if(size!==object.size)denied();const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return result;
 }catch(error){aborted();throw error;}finally{signal?.removeEventListener('abort',abort);reader?.releaseLock();}
}
export class R2ObserverArtifacts{
 readonly #bucket:ObserverArtifactBucket;readonly #inventory:ObserverArtifactInventoryPort|undefined;
 constructor(bucket:ObserverArtifactBucket,inventory?:ObserverArtifactInventoryPort){if(typeof bucket?.get!=='function'||typeof bucket?.put!=='function')denied();this.#bucket=bucket;this.#inventory=inventory;}
 async save(raw:ObserverCommand,rawKind:ObserverArtifactKind,content:Uint8Array):Promise<ObserverArtifactReceipt>{
  const command=normalizeObserverCommand(raw),kind=kindOf(rawKind),bytes=contentBytes(kind,content),expected=await descriptor(command,kind,await digest(bytes),bytes.byteLength);
  const claim=this.#inventory?await this.#inventory.claim(command,expected.receipt):{shouldPut:true};
  if(claim.shouldPut){
   // Revalidate the persistent execution fence after the claim's durability
   // await. No asynchronous gap is allowed between this check and dispatch.
   this.#inventory?.beforePut?.(command,expected.receipt);
   let acknowledged=false;
   try{await this.#bucket.put(expected.objectKey,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:expected.receipt.mediaType}});acknowledged=true;}catch{/* Readback may confirm content, but never clears uncertain write delivery. */}
   await this.#inventory?.putSettled(command,expected.receipt,acknowledged);
  }
  await this.read(command,expected.receipt);await this.#inventory?.verified(command,expected.receipt);return expected.receipt;
 }
 async read(raw:ObserverCommand,rawReceipt:ObserverArtifactReceipt,signal?:AbortSignal):Promise<Uint8Array>{
  if(signal?.aborted)throw Error('observer-artifact-read-cancelled');
  const command=normalizeObserverCommand(raw),receipt=observerArtifactReceipt(rawReceipt),expected=await descriptor(command,receipt.kind,receipt.sha256,receipt.bytes);
  if(expected.receipt.artifactId!==receipt.artifactId)denied();
  const bytes=await boundedRead(this.#bucket,expected.objectKey,receipt.bytes,signal);if(!bytes||bytes.byteLength!==receipt.bytes||await digest(bytes)!==receipt.sha256)denied();if(signal?.aborted)throw Error('observer-artifact-read-cancelled');return contentBytes(receipt.kind,bytes);
 }
}
