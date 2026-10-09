import {HttpError} from '../gateway/http.ts';
import {g5ReadHeaders} from '../gateway/transport-headers.ts';
import {requireRequestHost} from '../gateway/origins.ts';
import type {ValidationClaim} from './validation-policy.ts';

export const forwardedHeaders=['accept','accept-language','content-type','cookie','origin','referer','sec-fetch-site','sec-fetch-mode','sec-fetch-dest','idempotency-key','last-event-id','range','if-none-match','if-modified-since','user-agent',...g5ReadHeaders] as const;
export const proofHeader='x-riffoid-entry-proof',signatureHeader='x-riffoid-entry-signature',clientIpHeader='x-riffoid-client-ip';
export const SIGNATURE_LIFETIME_MS=30_000,FUTURE_SKEW_MS=5_000,MAX_HEADER_BYTES=16_384;
export const REPLAY_RPC_TIMEOUT_MS=2_000;
const encoder=new TextEncoder(),algorithm={name:'ECDSA',namedCurve:'P-256'},signAlgorithm={name:'ECDSA',hash:'SHA-256'};
let smallBodies=0,largeBodies=0;
let smallRequests=0,largeRequests=0;
/** Holds the bounded request-body allocation through response headers, not
 * through a long-lived SSE response. No queue or overload retry. */
export function signedRequestCapacity(request:Request):()=>void {
  if(request.body===null)return ()=>{};
  const large=request.method==='POST'&&/^\/api\/admin\/models\/[A-Za-z0-9_-]{1,128}\/content$/.test(new URL(request.url).pathname);
  if(large?largeRequests>=1:smallRequests>=32)throw new HttpError('entry_body_capacity',503);
  if(large)largeRequests++;else smallRequests++;
  let released=false;return ()=>{if(released)return;released=true;if(large)largeRequests--;else smallRequests--;};
}
export type Proof=[version:'riffoid-entry-v1',kid:string,canonical:string,transport:string,method:string,pathQuery:string,issued:number,expires:number,nonce:string,ip:string,bodyHash:string,headerHash:string];
export interface SigningEnv {ENTRY_SIGNING_KEY_ID?:string;ENTRY_SIGNING_PRIVATE_JWK?:string;ENTRY_NATIVE_IP_BOUNDARY?:string;}
export interface ReplayClaim {nonce:string;issued:number;expires:number;}
export interface ReplayNamespace {getByName(name:string):{
  claim(value:ReplayClaim):Promise<'accepted'|'replay'|'full'>;
  validationTake?(value:ValidationClaim):Promise<'accepted'|'spent'>;
  validationCleanup?(run:string):Promise<number>;
};}
export interface VerificationEnv {ENTRY_SIGNING_PUBLIC_KEYS_JSON?:string;ENTRY_REPLAY?:ReplayNamespace;}
export function base64url(bytes:Uint8Array):string {return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decode(value:string,size?:number):Uint8Array<ArrayBuffer> {
  if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw new HttpError('entry_proof_denied',403);
  const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
  if(base64url(bytes)!==value||size!==undefined&&bytes.length!==size)throw new HttpError('entry_proof_denied',403);return bytes;
}
export async function sha256(value:Uint8Array|string):Promise<string> {return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):Uint8Array.from(value))));}
export function clientIp(value:string|null):string {
  if(value===null||value.length>45)throw new HttpError('entry_ip_denied',403);
  if(/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)&&value.split('.').every(part=>Number(part)<=255))return value;
  if(!/^[0-9a-fA-F:.]+$/.test(value)||!value.includes(':'))throw new HttpError('entry_ip_denied',403);
  try{return new URL(`http://[${value}]/`).hostname.slice(1,-1);}catch{throw new HttpError('entry_ip_denied',403);}
}
export function forwarded(input:Headers):Headers {
  const result=new Headers();for(const name of forwardedHeaders){const value=input.get(name);if(value!==null)result.set(name,value);}
  if(encoder.encode(JSON.stringify([...result])).length>MAX_HEADER_BYTES)throw new HttpError('entry_headers_too_large',431);
  result.set('cache-control','no-store');return result;
}
async function headersHash(headers:Headers):Promise<string> {return sha256(JSON.stringify(forwardedHeaders.map(name=>[name,headers.get(name)])));}
export function pathQuery(request:Request):string {const url=new URL(request.url);if(url.hash)throw new HttpError('entry_proof_denied',403);return request.url.slice(url.origin.length);}
function keyId(value:unknown):asserts value is string {if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(value))throw Error('entry-key-config');}
function jwk(value:unknown,privateKey:boolean):JsonWebKey {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('entry-key-config');
  const key=value as Record<string,unknown>,expected=privateKey?['kty','crv','x','y','d']:['kty','crv','x','y'];
  if(Object.keys(key).length!==expected.length||expected.some(k=>!Object.hasOwn(key,k))||key.kty!=='EC'||key.crv!=='P-256')throw Error('entry-key-config');
  for(const name of expected.filter(n=>!['kty','crv'].includes(n)))if(typeof key[name]!=='string'||decode(key[name] as string,32).length!==32)throw Error('entry-key-config');
  return key as JsonWebKey;
}
export function validTime(issued:number,expires:number,now:number):boolean {return Number.isSafeInteger(issued)&&Number.isSafeInteger(expires)&&issued>=0&&expires-issued===SIGNATURE_LIFETIME_MS&&issued<=now+FUTURE_SKEW_MS&&now<expires;}
/** Request uploads are bounded and verified before any application side effect.
 * Responses (including SSE) are never read by the signature protocol. */
export async function signedBody(request:Request):Promise<Uint8Array> {
  const large=request.method==='POST'&&/^\/api\/admin\/models\/[A-Za-z0-9_-]{1,128}\/content$/.test(new URL(request.url).pathname);
  const maximum=large?8*1024*1024:32_768,timeoutMs=large?30_000:5_000;
  const declared=request.headers.get('content-length');
  const transfer=request.headers.get('transfer-encoding');
  // The platform HTTP parser already removes chunk framing from Request.body.
  // Accept one chunked framing only; never pass it downstream, accept stacked
  // encodings or ambiguous Content-Length + Transfer-Encoding.
  if(request.headers.has('content-encoding')||transfer!==null&&(transfer.toLowerCase()!=='chunked'||declared!==null)||declared!==null&&(!/^(0|[1-9]\d*)$/.test(declared)||!Number.isSafeInteger(Number(declared))))throw new HttpError('entry_body_ambiguous',400);
  if(declared!==null&&Number(declared)>maximum)throw new HttpError('body_too_large',413);
  if(['GET','HEAD'].includes(request.method)&&request.body!==null)throw new HttpError('entry_body_ambiguous',400);
  if(request.body===null){if(declared!==null&&Number(declared)!==0)throw new HttpError('entry_body_ambiguous',400);return new Uint8Array();}
  if(large?largeBodies>=1:smallBodies>=32)throw new HttpError('entry_body_capacity',503);
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0,timer:ReturnType<typeof setTimeout>|undefined;
  if(large)largeBodies++;else smallBodies++;
  let rejectAbort:()=>void=()=>{};
  const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new HttpError('request_timeout',408)),timeoutMs);rejectAbort=()=>reject(new HttpError('request_cancelled',408));});
  request.signal.addEventListener('abort',rejectAbort,{once:true});
  try{
    if(request.signal.aborted)throw new HttpError('request_cancelled',408);
    for(let count=0;count<8192;count++){
      const chunk=await Promise.race([reader.read(),expired]);
      if(chunk.done){if(declared!==null&&Number(declared)!==size)throw new HttpError('entry_body_ambiguous',400);const all=new Uint8Array(size);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}return all;}
      size+=chunk.value.byteLength;if(size>maximum)throw new HttpError('body_too_large',413);parts.push(Uint8Array.from(chunk.value));
    }throw new HttpError('body_too_large',413);
  }finally{if(large)largeBodies--;else smallBodies--;clearTimeout(timer);request.signal.removeEventListener('abort',rejectAbort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
function withBody(request:Request,headers:Headers,bytes:Uint8Array):Request {
  return new Request(request.url,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:bytes.slice().buffer,redirect:'manual',cache:'no-store',signal:request.signal});
}
export async function signEntry(request:Request,native:Request,canonical:string,env:SigningEnv,now?:number):Promise<Request> {
  if(new URL(native.url).origin!==canonical||native.method!==request.method||pathQuery(native)!==pathQuery(request))throw new HttpError('entry_source_denied',403);
  if(env.ENTRY_NATIVE_IP_BOUNDARY!=='cloudflare-direct-visitor-waf-v1'||!env.ENTRY_SIGNING_PRIVATE_JWK)throw new HttpError('entry_signing_not_configured',503);
  // WAF's platform-calculated upstream_zone gate is mandatory. This header is
  // defense in depth, never a replacement for that gate or a source credential.
  if(native.headers.has('cf-worker'))throw new HttpError('entry_source_denied',403);
  keyId(env.ENTRY_SIGNING_KEY_ID);
  const ip=clientIp(native.headers.get('cf-connecting-ip'));
  const key=await crypto.subtle.importKey('jwk',jwk(JSON.parse(env.ENTRY_SIGNING_PRIVATE_JWK),true),algorithm,false,['sign']);
  const bytes=await signedBody(native),headers=forwarded(request.headers),nonce=base64url(crypto.getRandomValues(new Uint8Array(32)));
  const issued=now??Date.now();
  const proof:Proof=['riffoid-entry-v1',env.ENTRY_SIGNING_KEY_ID,canonical,new URL(request.url).origin,request.method,pathQuery(request),issued,issued+SIGNATURE_LIFETIME_MS,nonce,ip,await sha256(bytes),await headersHash(headers)];
  const payload=encoder.encode(JSON.stringify(proof));
  if(payload.byteLength>1536)throw new HttpError('entry_proof_too_large',414);
  headers.set(proofHeader,base64url(payload));headers.set(signatureHeader,base64url(new Uint8Array(await crypto.subtle.sign(signAlgorithm,key,payload))));
  return withBody(request,headers,bytes);
}
export async function verifyEntry(request:Request,canonical:string,transport:string,env:VerificationEnv,now=Date.now()):Promise<Request> {
  requireRequestHost(request);
  if(request.headers.has('upgrade')||!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(request.method))throw new HttpError('entry_proof_denied',403);
  if(!env.ENTRY_SIGNING_PUBLIC_KEYS_JSON||!env.ENTRY_REPLAY)throw new HttpError('entry_verifier_not_configured',503);
  const ring=JSON.parse(env.ENTRY_SIGNING_PUBLIC_KEYS_JSON) as Record<string,unknown>;
  if(!ring||typeof ring!=='object'||Array.isArray(ring)||Object.keys(ring).length<1||Object.keys(ring).length>2)throw Error('entry-key-config');
  for(const [kid,value] of Object.entries(ring)){keyId(kid);jwk(value,false);}
  const encoded=request.headers.get(proofHeader),signature=request.headers.get(signatureHeader);
  if(!encoded||encoded.length>2048||!signature||signature.length!==86)throw new HttpError('entry_proof_denied',403);
  const payload=decode(encoded);let text:string,proof:Proof;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(payload);proof=JSON.parse(text) as Proof;}catch{throw new HttpError('entry_proof_denied',403);}
  if(!Array.isArray(proof)||proof.length!==12||JSON.stringify(proof)!==text||proof[0]!=='riffoid-entry-v1')throw new HttpError('entry_proof_denied',403);
  const [,kid,audience,target,method,path,issued,expires,nonce,ip,bodyHash,headerHash]=proof;
  if(typeof kid!=='string'||!Object.hasOwn(ring,kid)||audience!==canonical||target!==transport||new URL(request.url).origin!==transport||method!==request.method||path!==pathQuery(request)||!validTime(issued,expires,now)||typeof nonce!=='string'||typeof ip!=='string'||typeof bodyHash!=='string'||typeof headerHash!=='string')throw new HttpError('entry_proof_denied',403);
  decode(nonce,32);decode(bodyHash,32);decode(headerHash,32);if(clientIp(ip)!==ip)throw new HttpError('entry_ip_denied',403);
  const headers=forwarded(request.headers);
  if(await headersHash(headers)!==headerHash)throw new HttpError('entry_proof_denied',403);
  const key=await crypto.subtle.importKey('jwk',jwk(ring[kid],false),algorithm,false,['verify']);
  if(!await crypto.subtle.verify(signAlgorithm,key,decode(signature,64),payload))throw new HttpError('entry_proof_denied',403);
  // Consume once BEFORE body/auth. A failed read/tampered body burns the nonce;
  // no retry/reissue is authorized by the transport. Application keys stay original.
  let claimed:'accepted'|'replay'|'full',timer:ReturnType<typeof setTimeout>|undefined;
  let abort:()=>void=()=>{};
  const unavailable=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),REPLAY_RPC_TIMEOUT_MS);abort=()=>reject(Error('cancelled'));});
  request.signal.addEventListener('abort',abort,{once:true});
  try{if(request.signal.aborted)throw Error('cancelled');claimed=await Promise.race([env.ENTRY_REPLAY.getByName(replayShard(nonce)).claim({nonce,issued,expires}),unavailable]);}catch{throw new HttpError('entry_replay_unavailable',503);}finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
  if(claimed!=='accepted')throw new HttpError(claimed==='replay'?'entry_replay_denied':'entry_replay_unavailable',claimed==='replay'?403:503);
  const bytes=await signedBody(request);
  if(await sha256(bytes)!==bodyHash)throw new HttpError('entry_proof_denied',403);
  // Recheck expiry/cancellation after blocking body/storage work; never run auth
  // on a request that became stale while queued or uploading.
  if(!validTime(issued,expires,Date.now())||request.signal.aborted)throw new HttpError('entry_proof_denied',403);
  headers.set(clientIpHeader,ip);return withBody(request,headers,bytes);
}
export function replayShard(nonce:string):string {decode(nonce,32);return 'riffoid-entry-replay-v1:'+String('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(nonce[0]!));}
