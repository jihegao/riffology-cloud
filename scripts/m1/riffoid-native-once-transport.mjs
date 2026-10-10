// Separate native transport: direct Node HTTPS, no fetch/SDK/MCP/proxy retry path.
// The publisher owns durable original-request intent/unknown handling.
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import {gunzipSync} from 'node:zlib';
import {hashBytes} from './riffoid-validation-evidence.mjs';
import {validateControlRequest} from './riffoid-validation-transport.mjs';
import {validateEntrypoint} from './riffoid-validation-mime.mjs';

// Low-level primitive also used with a loopback fixture by native fault tests.
// Production callers use nativeOnceTransport, which fixes HTTPS origin/scope.
export function singleNativeRequest(url,{method,headers,body,timeoutMS=15000,maxBytes=16*1024*1024,allowGzipGET=false}={}){
  const target=new URL(url);assert.ok(['https:','http:'].includes(target.protocol));
  assert.equal(target.username,'');assert.equal(target.password,'');assert.equal(target.hash,'');
  assert.ok(['GET','PUT'].includes(method));assert.ok(timeoutMS>0&&timeoutMS<=(method==='GET'?60000:15000));
  assert.equal(typeof allowGzipGET,'boolean');assert.ok(!allowGzipGET||method==='GET','gzip negotiation is GET-only');
  assert.ok(maxBytes>0&&maxBytes<=16*1024*1024);assert.ok(body===undefined||Buffer.isBuffer(body)||body instanceof Uint8Array);
  const secure=target.protocol==='https:',core=secure?https:http;
  // A new agent/socket per invocation. HTTP/1.1 only, no session cache/0-RTT,
  // ambient proxy, redirects, retry loop, stale pooled socket or fallback.
  const agent=new core.Agent({keepAlive:false,maxCachedSessions:0,maxSockets:1,proxyEnv:{},minVersion:'TLSv1.2',maxVersion:'TLSv1.2',rejectUnauthorized:true});
  const started=performance.now();
  return new Promise((resolve,reject)=>{
    let settled=false,request,timer;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);request?.destroy();agent.destroy();error?reject(error):resolve(value);};
    timer=setTimeout(()=>finish(Error('native request deadline; original outcome unknown; no retry')),timeoutMS);
    try{
      request=core.request(target,{method,agent,headers:{...headers,connection:'close','accept-encoding':allowGzipGET?'gzip':'identity',...(body?{'content-length':String(body.length)}:{})}},response=>{
        try{
          const status=response.statusCode;assert.ok(Number.isInteger(status));
          const values=new Map();for(let i=0;i<response.rawHeaders.length;i+=2){const k=response.rawHeaders[i].toLowerCase(),v=response.rawHeaders[i+1];values.set(k,[...(values.get(k)??[]),v]);}
          for(const k of ['location','content-type','cf-entrypoint','content-length','content-encoding'])assert.ok((values.get(k)?.length??0)<=1,'duplicate critical response header');
          assert.ok(!(status>=300&&status<400)&&!values.has('location'),'native redirect rejected; no follow');
          assert.ok([200,404].includes(status),'native request not acknowledged; original outcome unknown; no retry');
          const encoding=values.get('content-encoding')?.[0];assert.ok(!encoding||encoding==='identity'||allowGzipGET&&encoding==='gzip','encoded native body rejected');
          const mainModule=values.get('cf-entrypoint')?.[0]??null;if(mainModule!==null)validateEntrypoint(mainModule);
          const parts=[];let size=0;const peer=secure?response.socket.getPeerCertificate():null;
          if(secure)assert.equal(response.socket.authorized,true,'TLS validation required');
          response.on('data',part=>{size+=part.length;if(size>maxBytes)finish(Error('native response exceeds byte bound'));else parts.push(part);});
          response.once('aborted',()=>finish(Error('native response aborted; original outcome unknown; no retry')));
          response.once('error',()=>finish(Error('native response failed; original outcome unknown; no retry')));
          response.once('end',()=>{try{
            assert.ok(response.complete,'incomplete native response');assert.ok(performance.now()-started<timeoutMS,'late native evidence rejected');
            const wireBytes=Buffer.concat(parts),declared=values.get('content-length')?.[0];if(declared!==undefined){assert.match(declared,/^(?:0|[1-9][0-9]*)$/);assert.equal(Number(declared),wireBytes.length,'truncated native response');}
            const bytes=encoding==='gzip'?gunzipSync(wireBytes,{maxOutputLength:maxBytes}):wireBytes;
            assert.ok(bytes.length<=maxBytes);assert.ok(performance.now()-started<timeoutMS,'late native decoded evidence rejected');
            finish(null,{status,contentType:values.get('content-type')?.[0]??null,mainModule,bytes,bodySHA256:hashBytes(bytes),nativeObservation:{callerDispatches:1,automaticRetries:0,redirectsFollowed:0,elapsedMS:performance.now()-started,tlsAuthorized:secure,peerFingerprint256:peer?.fingerprint256??null,httpVersion:response.httpVersion,connectionReused:request.reusedSocket,contentEncoding:encoding??'identity',wireBytes:wireBytes.length,wireBodySHA256:hashBytes(wireBytes)}});
          }catch(e){finish(e);}});
        }catch(e){finish(e);}
      });
      request.once('error',()=>finish(Error('native request failed; original outcome unknown; no retry')));
      request.end(body);
    }catch(e){finish(e);}
  });
}

export function nativeOnceTransport({mode='read-only',scope,tokenForAccount,authorizeWrite,timeoutMS=15000,readTimeoutMS=timeoutMS,sourceReadTimeoutMS=readTimeoutMS}={}){
  assert.ok(Number.isSafeInteger(sourceReadTimeoutMS)&&sourceReadTimeoutMS>0&&sourceReadTimeoutMS<=60000);assert.ok(Number.isSafeInteger(readTimeoutMS)&&readTimeoutMS>0&&readTimeoutMS<=30000);assert.ok(Number.isSafeInteger(timeoutMS)&&timeoutMS>0&&timeoutMS<=15000);assert.ok(['read-only','live'].includes(mode));assert.equal(typeof tokenForAccount,'function');assert.ok(Array.isArray(scope)&&scope.length===2);
  for(const row of scope){assert.match(row.accountId,/^[a-f0-9]{32}$/);assert.match(row.zoneId,/^[a-f0-9]{32}$/);assert.ok(Array.isArray(row.workers)&&row.workers.every(w=>/^[a-z0-9_-]+$/.test(w)));}
  if(mode==='live')assert.equal(typeof authorizeWrite,'function','exact durable intent authorizer required');
  // These flags can change core TLS behavior before imports and must be absent.
  for(const key of ['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_USE_ENV_PROXY'])assert.ok(!process.env[key],'unsafe ambient Node transport setting');
  return Object.freeze({mode,async request({method='GET',path,body,contentType}){
    assert.ok(['GET','PUT'].includes(method));validateControlRequest(method,path);
    const parsed=new URL('https://api.cloudflare.com/client/v4'+path),id=path.match(/^\/accounts\/([a-f0-9]{32})\//)?.[1],zone=path.match(/^\/zones\/([a-f0-9]{32})(?:\/|$)/)?.[1];
    const row=scope.find(x=>id?x.accountId===id:x.zoneId===zone);assert.ok(row,'exact owned account/zone required');
    const script=path.match(/\/workers\/scripts\/([^/?]+)/)?.[1];if(script)assert.ok(row.workers.includes(script),'unrelated Worker rejected');
    if(method==='GET')assert.equal(body,undefined,'GET body forbidden');
    else {assert.equal(mode,'live');assert.ok(Buffer.isBuffer(body)||body instanceof Uint8Array);assert.ok(body.length>0&&body.length<=16*1024*1024);assert.match(contentType??'',/^multipart\/form-data; boundary=[A-Za-z0-9_-]{1,70}$/);await authorizeWrite({accountId:row.accountId,method,path,bodySHA256:hashBytes(body),bytes:body.length});}
    const token=await tokenForAccount(row.accountId);assert.ok(typeof token==='string'&&token.length>0&&!/[\r\n]/.test(token),'credential reference invalid');
    return singleNativeRequest(parsed,{method,headers:{authorization:'Bearer '+token,...(contentType?{'content-type':contentType}:{})},body,timeoutMS:method==='GET'?(/^\/accounts\/[a-f0-9]{32}\/workers\/scripts\/[a-z0-9_-]+$/.test(path)?sourceReadTimeoutMS:readTimeoutMS):timeoutMS,allowGzipGET:method==='GET'});
  }});
}
