// Pure bodies extracted verbatim; no import of old preparer/publisher, pins or credentials.
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
export class GuardError extends Error{constructor(code){super(code);this.code=code;}}
export const guard=(ok,code)=>{if(!ok)throw new GuardError(code);};
export const sha=b=>createHash('sha256').update(b).digest('hex');
export const ACCOUNT='8b0d70250211aa10d89e20605a1c7e5e',WORKER='riffology-m1-gateway-staging';
const BASE='/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER,putPath=BASE+'?bindings_inherit=strict';
const apps=new Set(['a03156a6-9bf5-43fb-8b7f-a1f5b8d1a650','a03628c4-f032-461f-a65b-612ccac11a06']);
export function allowedRequest(method,path,kind='oauth'){
 if(typeof path!=='string'||path.includes('..')||path.includes('#')||path.includes('%')||path.includes('\\'))return false;
 if(method==='PUT')return kind==='oauth'&&path===putPath;
 if(method!=='POST')return false;
 if(kind==='asset')return path==='/accounts/'+ACCOUNT+'/workers/assets/upload?base64=true';
 if(kind!=='oauth')return false;
 if(path===BASE+'/assets-upload-session')return true;
 return [...apps].some(id=>path==='/accounts/'+ACCOUNT+'/containers/applications/'+id+'/rollouts');
}
export async function save(path,value){const b=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n'),f=await open(path,'wx',0o600);try{await f.writeFile(b);await f.sync();}finally{await f.close();}return {bytes:b.length,sha256:sha(b)};}

export async function boundedResponse(response,max=16*1024*1024){
 guard(response.status<300||response.status>=400,'redirect-denied');
 const reader=response.body?.getReader();guard(reader,'response-body-missing');const parts=[];let total=0;
 try{for(;;){const{done,value}=await reader.read();if(done)break;total+=value.length;guard(total<=max,'response-body-limit');parts.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}
 return Buffer.concat(parts);
}

export async function freezeMultipart(metadata,module){
 const f=new FormData();f.set('metadata',JSON.stringify(metadata));f.set('index.js',new Blob([module],{type:'application/javascript+module'}),'index.js');
 const request=new Request('https://api.cloudflare.com/client/v4'+putPath,{method:'PUT',body:f});
 return {body:Buffer.from(await request.arrayBuffer()),contentType:request.headers.get('content-type')};
}

export function validateBuckets(session,manifest){
 guard(typeof session?.jwt==='string'&&session.jwt.length<16384&&Array.isArray(session.buckets)&&session.buckets.length<=100,'asset-session-shape');
 let claims;try{claims=JSON.parse(Buffer.from(session.jwt.split('.')[1],'base64url'));}catch{throw new GuardError('asset-session-jwt-shape');}
 guard(claims.wrangler_single_asset_uploads!==true,'asset-upload-protocol-changed');
 const known=new Set(Object.values(manifest).map(x=>x.hash)),seen=new Set();
 for(const bucket of session.buckets){guard(Array.isArray(bucket)&&bucket.length>0&&bucket.length<=1000,'asset-bucket-shape');for(const h of bucket){guard(typeof h==='string'&&known.has(h)&&!seen.has(h),'asset-bucket-unknown-or-duplicate');seen.add(h);}}
 return [...seen];
}

export async function sendOnce({directory,key,method,path,body,contentType,credentialKind='oauth',client,requestId}){
 guard(/^[a-z0-9-]+$/.test(key)&&allowedRequest(method,path,credentialKind),'write-allowlist');
 const intent={schema:'project-view-single-write-intent/v1',key,requestId,method,path,bodySha256:sha(body),bodyBytes:body.length,contentType,requestedAt:new Date().toISOString(),automaticRetry:false};
 await save(resolve(directory,key+'-intent.json'),intent); // wx survives lost ACK and blocks reuse.
 try{const result=await client(method,path,{body,contentType,credentialKind,requestId});await save(resolve(directory,key+'-ack.private.json'),result);return result;}catch(e){await save(resolve(directory,key+'-unknown.json'),{requestId,key,outcome:'unknown-or-rejected-stop',code:e instanceof GuardError?e.code:'transport-or-response-error',noRetry:true});throw e;}
}
