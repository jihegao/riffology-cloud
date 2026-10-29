// Exact five function bodies extracted from reviewed source SHA9a866f44; no transport/auth entry.
import {resolve} from 'node:path';
import {BASE,PUT,ACCOUNT,WORKER,GuardError,guard,sha,save} from './prepare-gateway-replacement.mjs';
const ACCOUNT_BASE='/accounts/'+ACCOUNT,ZONE='c97b548800561fada1a912c234696db1',putPath=PUT;
export function allowedRequest(method,path,kind='oauth'){
 if(typeof path!=='string'||path.includes('..')||path.includes('#')||path.includes('%')||path.includes('\\'))return false;
 if(method==='POST')return kind==='oauth'&&path===BASE+'/assets-upload-session'||kind==='asset'&&path===ACCOUNT_BASE+'/workers/assets/upload?base64=true';
 if(method==='PUT')return kind==='oauth'&&path===putPath;
 if(method!=='GET'||kind!=='oauth')return false;
 return [BASE+'/settings',BASE+'/deployments?per_page=1&page=1',BASE+'/versions?deployable=true',BASE+'/content/v2',BASE+'/schedules',BASE+'/subdomain',ACCOUNT_BASE+'/workers/domains?service='+WORKER,ACCOUNT_BASE+'/workers/durable_objects/namespaces?per_page=1000&page=1',`/zones/${ZONE}/workers/routes`].includes(path)||new RegExp('^'+BASE+'/versions/[a-f0-9-]{36}$').test(path);
}

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
