/** DEFINITION ONLY in this preparation: no caller instantiates this factory.
 * Fixed native HTTP, no credential loader, redirects, retries or Registry paths.
 * The owner supplies a one-use owned Uint8Array from private memory/inherited FD;
 * neither this module nor its CLI reads OAuth files, argv or env credentials.
 */
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import {readFile,lstat} from 'node:fs/promises';
import {ACCOUNT,ACCOUNT_BASE,BASE,PUT,WORKER,APP_IDS,LIMITS,isId,allowedGet,allowedWrite} from './fixed-target.mjs';
import {guard,GuardError,sha,apiEnvelope,boundedTask} from './io-boundary.mjs';
import {assertExecutionFacts,loadFinalClosure} from './load-final-closure.mjs';
import {normalizeAckVersion} from './gateway-readback.mjs';
import {hashJSON,imageOnlyRolloutRequest} from './a2/ir-publication-candidate.mjs';
import {validateBuckets} from './a2/reviewed-wire-primitives.mjs';

export function classifiedProxy(value){
  if(value===null)return null;
  const u=new URL(value);guard(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&u.port&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash,'fixed-loopback-connect-proxy');
  return {hostname:u.hostname.replace(/^\[|\]$/g,''),port:Number(u.port)};
}
export function canonicalRead(path,discovered){
  guard(typeof path==='string'&&path.length<=32768&&allowedGet(path,discovered),'fixed-native-get-path');
  const u=new URL('https://api.cloudflare.com/client/v4'+path),seen=new Set();
  for(const [k,v]of u.searchParams){guard(!seen.has(k),'duplicate-query-field');seen.add(k);
    if(['page','per_page'].includes(k))guard(/^[1-9][0-9]*$/.test(v)&&Number.isSafeInteger(Number(v))&&Number(v)<=(k==='per_page'?100:LIMITS.maxPages),'fixed-page-query');
    else if(k==='page_token')guard(v.length>0&&v.length<=16384,'fixed-token-query');
    else guard(k==='service'&&v===WORKER,'unclassified-get-query');
  }
  return u;
}
function quietNativeRuntime(){
  // Node's debug/keylog switches can expose private HTTP headers outside this
  // module. Refuse before the owner credential callback could be invoked.
  guard(!process.env.NODE_DEBUG&&!process.env.SSLKEYLOGFILE&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!process.execArgv.some(x=>/--(?:tls-keylog|trace-tls|inspect)/.test(x))&&!/--(?:tls-keylog|trace-tls|inspect)/.test(process.env.NODE_OPTIONS??''),'private-http-runtime-required');
}
export function createNativeOwnerConnection({facts,credentialProvider,proxyUrl=null}={}){
  quietNativeRuntime();assertExecutionFacts(facts);guard(typeof credentialProvider==='function','private-memory-credential-provider-required');
  const proxy=classifiedProxy(proxyUrl),origin=new URL(facts.publicOrigin);
  guard(origin.protocol==='https:'&&origin.origin===facts.publicOrigin&&!origin.port&&!origin.username&&!origin.password,'fixed-public-origin');
  const deadline=Math.min(Date.parse(facts.endsAt),Date.now()+LIMITS.publicationMs),lifetime=new AbortController(),active=new Set();
  const appIds=[],versionIds=[],apps=new Map(),rolloutIds=new Map(),sentWrites=new Set();
  let closed=false,provider=credentialProvider,frozenPromise=null,session=null,completion=null;
  const check=()=>guard(!closed&&!lifetime.signal.aborted&&Date.now()<deadline,'native-transport-closed-or-expired');
  const frozen=async signal=>{check();frozenPromise??=loadFinalClosure(facts,{signal,deadline:Math.min(deadline,Date.now()+60000)});return frozenPromise;};
  function close(){if(closed)return;closed=true;lifetime.abort();for(const x of active)x.destroy();active.clear();provider=null;session=null;completion=null;frozenPromise=null;}
  function agentFor(url,signal){
    const agent=new https.Agent({keepAlive:false,maxSockets:1,rejectUnauthorized:true});
    if(proxy)agent.createConnection=(_options,callback)=>{
      let tunnel,secure,called=false;const done=(e,socket)=>{if(called)return;called=true;callback(e,socket);};
      const abort=()=>{tunnel?.destroy();secure?.destroy();done(new GuardError('native-request-aborted'));};
      signal.addEventListener('abort',abort,{once:true});
      tunnel=http.request({host:proxy.hostname,port:proxy.port,method:'CONNECT',path:url.hostname+':443',headers:{host:url.hostname+':443'},agent:false,signal,maxHeaderSize:32768});
      active.add(tunnel);tunnel.once('close',()=>active.delete(tunnel));
      tunnel.once('connect',(res,socket,head)=>{if(signal.aborted||res.statusCode!==200||head.length){socket.destroy();done(new GuardError('fixed-connect-tunnel-rejected'));return;}
        secure=tls.connect({socket,servername:url.hostname,rejectUnauthorized:true,minVersion:'TLSv1.2'});active.add(secure);secure.once('close',()=>{active.delete(secure);signal.removeEventListener('abort',abort);});secure.once('secureConnect',()=>done(null,secure));secure.once('error',()=>done(new GuardError('native-tls-failed')));
      });
      tunnel.once('error',()=>done(new GuardError('native-connect-failed')));tunnel.end();
    };
    return agent;
  }
  async function wire({url,method='GET',body=null,contentType=null,authorization=null,signal,maxBytes=LIMITS.maxJsonBytes,maxMs=LIMITS.requestMs}){
    check();const child=new AbortController(),joined=signal?AbortSignal.any([signal,lifetime.signal,child.signal]):AbortSignal.any([lifetime.signal,child.signal]);
    const ms=Math.min(maxMs,deadline-Date.now());guard(ms>0&&!joined.aborted,'native-request-expired');const timer=setTimeout(()=>child.abort(),ms),agent=agentFor(url,joined);
    try{return await new Promise((resolve,reject)=>{let finished=false,res,req;const fail=code=>{if(finished)return;finished=true;res?.destroy();req?.destroy();reject(new GuardError(code));};
      const abort=()=>fail('native-request-aborted');joined.addEventListener('abort',abort,{once:true});
      const headers={'accept-encoding':'identity',connection:'close'};
      if(url.origin===origin.origin)Object.assign(headers,{'user-agent':'node',accept:'*/*','accept-language':'*','sec-fetch-mode':'cors'});
      if(authorization)headers.authorization='Bearer '+authorization;
      if(body){headers['content-type']=contentType;headers['content-length']=String(body.length);}
      req=https.request({protocol:'https:',hostname:url.hostname,port:443,path:url.pathname+url.search,method,headers,agent,signal:joined,rejectUnauthorized:true,minVersion:'TLSv1.2',maxHeaderSize:32768},response=>{
        res=response;active.add(res);const chunks=[];let size=0;
        if(res.statusCode>=300&&res.statusCode<400){fail('native-redirect-denied');return;}
        const length=res.headers['content-length'],encoding=res.headers['content-encoding'];
        if(encoding&&encoding!=='identity'){fail('native-content-encoding-unclassified');return;}
        if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>maxBytes)){fail('native-response-content-limit');return;}
        res.on('data',chunk=>{if(finished)return;size+=chunk.length;if(size>maxBytes){fail('native-response-body-limit');return;}chunks.push(chunk);});
        res.once('error',()=>fail('native-response-failed'));res.once('aborted',()=>fail('native-response-incomplete'));
        res.once('end',()=>{if(finished)return;if(joined.aborted||!res.complete||length!==undefined&&Number(length)!==size){fail('native-response-incomplete');return;}finished=true;joined.removeEventListener('abort',abort);const bytes=Buffer.concat(chunks);const evidenceHeaders={};for(const name of ['content-type','content-length','cf-ray','cf-request-id','date'])if(typeof res.headers[name]==='string')evidenceHeaders[name]=res.headers[name];resolve({body:bytes,status:res.statusCode,contentType:res.headers['content-type']??'application/octet-stream',evidenceHeaders});});
        res.once('close',()=>active.delete(res));
      });
      // HTTPS emits this entity exactly once. There is no redirect handler,
      // retry loop, fetch middleware, cookie jar, inherited global agent or log.
      active.add(req);req.once('close',()=>{active.delete(req);joined.removeEventListener('abort',abort);});req.once('error',()=>fail(joined.aborted?'native-request-aborted':'native-request-failed'));req.end(body);
    });}finally{clearTimeout(timer);agent.destroy();authorization=null;}
  }
  async function authorization(kind,assetSession,signal){
    check();guard(!signal?.aborted,'native-request-aborted');if(kind==='asset'){guard(session&&assetSession?.jwt===session.jwt,'known-memory-asset-session-required');return session.jwt;}
    guard(kind==='oauth'&&provider,'native-credential-kind');
    const supplied=await provider({accountId:ACCOUNT,worker:WORKER,requestId:facts.requestId,signal});
    guard(supplied instanceof Uint8Array&&supplied.byteLength>0&&supplied.byteLength<16384,'private-owned-credential-bytes-required');
    const owned=Buffer.from(supplied);supplied.fill(0);
    try{guard(!signal?.aborted,'native-request-aborted');guard([...owned].every(x=>x>=33&&x<=126),'private-credential-byte-shape');return owned.toString('ascii');}finally{owned.fill(0);}
  }
  function observe(o,raw){
    // Never hide a fully received original response behind semantic parsing.
    // The caller first persists its hash/known ACK, then applies strict guards.
    // Invalid IDs cannot expand this transport's fixed discovered GET scope.
    let result;try{result=apiEnvelope(raw).result;}catch{return null;}
    const url=new URL('https://api.cloudflare.com/client/v4'+o.path),p=url.pathname.slice('/client/v4'.length);
    if(o.method==='GET'&&p===BASE+'/versions'&&Array.isArray(result?.items))for(const row of result.items)if(isId(row?.id)&&!versionIds.includes(row.id))versionIds.push(row.id);
    if(o.method==='GET'&&p===ACCOUNT_BASE+'/containers/applications'&&Array.isArray(result))for(const row of result)if(isId(row?.id)&&!appIds.includes(row.id))appIds.push(row.id);
    if(o.method==='GET'){const id=appIds.find(id=>p===ACCOUNT_BASE+'/containers/applications/'+id);if(id&&result?.id===id)apps.set(id,result);}
    if(o.method==='POST'&&p===BASE+'/assets-upload-session')return result;
    if(o.method==='POST'&&p===ACCOUNT_BASE+'/workers/assets/upload'&&result?.jwt)completion=result.jwt;
    if(o.method==='PUT'){try{const id=normalizeAckVersion(result?.deployment_id);if(!versionIds.includes(id))versionIds.push(id);}catch{/* Higher layer stops from known ACK; never infer a version. */}}
    if(o.method==='POST'){const id=APP_IDS.find(id=>p===ACCOUNT_BASE+'/containers/applications/'+id+'/rollouts');if(id&&isId(result?.id))rolloutIds.set(result.id,id);}
    return null;
  }
  async function validateWrite(o,body){
    guard(o.requestId===facts.requestId&&allowedWrite(o.method,o.path,o.credentialKind??'oauth'),'fixed-original-native-write');
    guard(Buffer.isBuffer(body)&&body.length<=150*1024*1024&&typeof o.contentType==='string','native-frozen-request-body');const f=await frozen(o.signal);
    const key=o.path+(o.credentialKind==='asset'?' '+sha(body):'');guard(!sentWrites.has(key),'native-original-request-already-used');
    if(o.path===BASE+'/assets-upload-session'){const parsed=JSON.parse(body);guard(hashJSON(parsed)===hashJSON({manifest:f.manifest}),'native-fixed-asset-manifest');}
    else if(o.credentialKind==='asset'){
      guard(session&&o.assetSession?.jwt===session.jwt,'native-asset-session-binding');const form=await new Response(body,{headers:{'content-type':o.contentType}}).formData(),addresses=[];
      for(const [address,value]of form){guard(value instanceof Blob&&f.assetBytes.has(address),'native-fixed-upload-address');const encoded=await value.text(),bytes=Buffer.from(encoded,'base64');guard(bytes.toString('base64')===encoded&&bytes.equals(f.assetBytes.get(address)),'native-fixed-upload-full-bytes');addresses.push(address);}
      const bucket=hashJSON(addresses.sort());guard(session.bucketHashes.has(bucket)&&!session.uploaded.has(bucket),'native-server-requested-bucket-only');session.uploaded.add(bucket);
    }else if(o.method==='PUT'){
      guard(session&&session.uploaded.size===session.bucketHashes.size,'native-all-assets-completed');const ref=facts.gatewayClosure.bundle,st=await lstat(ref.file);guard(st.isFile()&&!st.isSymbolicLink()&&st.size===ref.bytes&&st.size<=LIMITS.maxModuleBytes,'native-bounded-module-path');const bytes=await readFile(ref.file);guard(bytes.length===ref.bytes&&sha(bytes)===ref.sha256,'native-frozen-module-path-drift');
      const form=await new Response(body,{headers:{'content-type':o.contentType}}).formData();guard([...form.keys()].length===2&&form.has('metadata')&&form.get('index.js')instanceof Blob,'native-single-frozen-module-body');
      const actual=Buffer.from(await form.get('index.js').arrayBuffer());guard(actual.equals(bytes),'native-single-frozen-module-bytes');
      const metadata=JSON.parse(form.get('metadata'));guard(typeof completion==='string'&&metadata.assets?.jwt===completion,'native-known-memory-completion-only');
    }else{
      const appId=APP_IDS.find(id=>o.path===ACCOUNT_BASE+'/containers/applications/'+id+'/rollouts'),r=facts.registryByApp?.[appId];
      const expected=imageOnlyRolloutRequest(apps.get(appId),r?.receipt?.imageReference,{description:facts.releaseMessage,registryReadback:r?.receipt,registryReadbackOwnerSeal:r?.ownerSeal});guard(hashJSON(JSON.parse(body))===hashJSON(expected),'native-fixed-image-only-body');
    }
    sentWrites.add(key);return f;
  }
  const asResponse=raw=>new Response(raw.body,{status:raw.status,headers:{...raw.evidenceHeaders,'content-type':raw.contentType,'content-length':String(raw.body.length)}});
  return Object.freeze({fullWireResponses:true,transportKind:'fixed-native-https-no-retry',close,
    async request(input){try{return await boundedTask(async requestSignal=>{const o={...input,signal:requestSignal};
      check();guard(o&&['GET','PUT','POST'].includes(o.method),'fixed-native-method');let url,body=null,f;
      if(o.method==='GET'){
        const rollout=[...rolloutIds].find(([id,app])=>o.path===ACCOUNT_BASE+'/containers/applications/'+app+'/rollouts/'+id);
        url=rollout?new URL('https://api.cloudflare.com/client/v4'+o.path):canonicalRead(o.path,{appIds,versionIds});
        guard(o.body===undefined&&!o.assetSession,'native-get-has-no-body-or-capability');
      }else{body=Buffer.from(o.body);f=await validateWrite(o,body);url=new URL('https://api.cloudflare.com/client/v4'+o.path);}
      const signal=o.signal?AbortSignal.any([o.signal,lifetime.signal]):lifetime.signal;
      const auth=await authorization(o.credentialKind??'oauth',o.assetSession,signal);
      const raw=await wire({url,method:o.method,body,contentType:o.contentType,authorization:auth,signal,maxMs:o.method==='GET'?LIMITS.requestMs:LIMITS.writeMs,maxBytes:o.path===BASE+'/content/v2'?LIMITS.maxModuleBytes:LIMITS.maxJsonBytes});
      if(raw.status>=200&&raw.status<300&&o.path!==BASE+'/content/v2'){
        const result=observe(o,raw);
        if(o.method==='POST'&&o.path===BASE+'/assets-upload-session'){try{validateBuckets(result,f.manifest);session={jwt:result.jwt,bucketHashes:new Set(result.buckets.map(x=>hashJSON([...x].sort()))),uploaded:new Set()};completion=result.buckets.length?null:result.jwt;}catch{session=null;completion=null;/* Return full original ACK; publisher guards stop before more requests. */}}
      }
      check();return asResponse(raw);
    },{deadline,maxMs:input?.method==='GET'?LIMITS.requestMs:LIMITS.writeMs,signal:input?.signal,onLateValue:r=>r?.body?.cancel()});}catch(e){close();throw e instanceof GuardError?e:new GuardError('native-private-transport-stopped');}},
    async publicGet({origin:requestedOrigin,path,credentials,signal}){try{return await boundedTask(async requestSignal=>{
      check();guard(requestedOrigin===origin.origin&&credentials==='omit','native-public-origin-and-credentials');const f=await frozen(requestSignal),known=new Set([...f.assets.map(x=>x.path),...(f.build.frame?[f.build.frame.path]:[])]);
      guard(known.has(path)&&!path.includes('?')&&!path.includes('#'),'native-fixed-public-asset');const url=new URL(path,origin);guard(url.origin===origin.origin&&url.pathname===path,'native-public-path');
      const raw=await wire({url,signal:requestSignal,maxBytes:LIMITS.maxAssetBytes});check();return asResponse(raw);
    },{deadline,maxMs:LIMITS.requestMs,signal,onLateValue:r=>r?.body?.cancel()});}catch(e){close();throw e instanceof GuardError?e:new GuardError('native-private-public-read-stopped');}}
  });
}
