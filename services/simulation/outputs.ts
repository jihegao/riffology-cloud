import {digest} from './source.ts';
export type SimulationOutput={path:string;sha256:string;size:number;mediaType:string};
const media:Record<string,string>={txt:'text/plain',csv:'text/csv',json:'application/json',png:'image/png'};
/** Native root collects only sealed files. Validate again before immutable R2 publication. */
export async function publishOutputs(bucket:R2Bucket,prefix:string,raw:unknown):Promise<SimulationOutput[]>{
 if(raw===undefined)return [];
 if(!Array.isArray(raw)||raw.length>4)throw Error('simulation-result-invalid');
 let total=0;const seen=new Set<string>(),checked=[];
 for(const value of raw){
  if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='data,mediaType,path,sha256,size'||typeof value.path!=='string'||!/^\w[\w-]*\.(txt|csv|json|png)$/.test(value.path)||value.path==='result.json'||seen.has(value.path)||typeof value.data!=='string'||value.data.length>21848)throw Error('simulation-result-invalid');
  seen.add(value.path);let bytes:Uint8Array;
  try{bytes=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));}catch{throw Error('simulation-result-invalid');}
  total+=bytes.length;
  if(bytes.length>16384||total>32768||value.size!==bytes.length||value.sha256!==await digest(bytes)||value.mediaType!==media[value.path.split('.').at(-1)!])throw Error('simulation-result-invalid');
  checked.push({bytes,metadata:{path:value.path,sha256:value.sha256,size:value.size,mediaType:value.mediaType} as SimulationOutput});
 }
 for(const {bytes,metadata} of checked){
  const key=`${prefix}/outputs/${metadata.sha256}`;
  await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:metadata.mediaType}});
  const stored=await bucket.get(key);if(!stored||stored.size!==bytes.length||await digest(new Uint8Array(await stored.arrayBuffer()))!==metadata.sha256)throw Error('simulation-result-unconfirmed');
 }
 return checked.map(value=>value.metadata);
}
