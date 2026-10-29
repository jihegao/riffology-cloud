/** Narrow GET-only supplement. Definition only; no factory is constructed here. */
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import {need,Stop,ACCOUNT,WORKER,REQUEST,current} from './local-guards.mjs';
import {boundedTask} from './core/io-boundary.mjs';
const APPS=Object.freeze(['a03156a6-9bf5-43fb-8b7f-a1f5b8d1a650','a03628c4-f032-461f-a65b-612ccac11a06']);
const BASE='/accounts/'+ACCOUNT+'/containers',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function classifyProxy(value){if(value===null)return null;const u=new URL(value);need(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&u.port&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash,'fixed-physical-loopback-proxy');return {hostname:u.hostname.replace(/^\[|\]$/g,''),port:Number(u.port)};}
export function createNativePhysicalConnection({facts,credentialProvider,proxyUrl=null,knownOriginalRollout=null}={}){
  need(facts?.requestId===REQUEST&&typeof credentialProvider==='function','fixed-physical-owner-scope');
  need(!process.env.NODE_DEBUG&&!process.env.SSLKEYLOGFILE&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!process.execArgv.some(x=>/--(?:tls-keylog|trace-tls|inspect)/.test(x))&&!/--(?:tls-keylog|trace-tls|inspect)/.test(process.env.NODE_OPTIONS??''),'private-physical-runtime');
  const deadline=Math.min(Date.parse(facts.endsAt),Date.now()+900000),proxy=classifyProxy(proxyUrl),lifetime=new AbortController(),active=new Set(),discovered=new Map(),placementPaths=new Set();
  const original=knownOriginalRollout?structuredClone(knownOriginalRollout):null;
  if(original)need(APPS.includes(original.appId)&&UUID.test(original.rolloutId??'')&&['originalAckSha256','originalIntentSha256','initialBodySha256'].every(k=>/^[a-f0-9]{64}$/.test(original[k]??''))&&original.targetConfiguration?.image===facts.registryByApp?.[original.appId]?.receipt?.imageReference,'same-phase-original-rollout-get-capability');
  let closed=false,provider=credentialProvider;
  const check=()=>{current(lifetime.signal,deadline);need(!closed,'native-physical-wire-closed');};
  function close(){if(closed)return;closed=true;lifetime.abort();for(const item of active)item.destroy();active.clear();discovered.clear();placementPaths.clear();provider=null;}
  function classify(path){need(typeof path==='string'&&path.length<=512&&!path.includes('?')&&!path.includes('#')&&!path.includes('\\'),'fixed-physical-get-path');for(const app of APPS){const root=BASE+'/applications/'+app+'/deployments';if(path===root)return {kind:'list',app};if(path===BASE+'/dash/applications/'+app+'/instances')return {kind:'dash',app};if(path.startsWith(root+'/')){const id=path.slice(root.length+1);if(UUID.test(id)&&discovered.get(app)?.has(id))return {kind:'detail',app,id};if(placementPaths.has(path))return {kind:'placements',app};}}if(original&&path===BASE+'/applications/'+original.appId+'/rollouts/'+original.rolloutId)return {kind:'original-rollout',app:original.appId,id:original.rolloutId};throw new Stop('undiscovered-or-out-of-scope-physical-get');}
  function observe(route,raw){if(raw.status!==200)return;let e;try{e=JSON.parse(raw.body);}catch{return;}if(e?.success!==true||!Object.hasOwn(e,'result'))return;const rows=route.kind==='list'?e.result:route.kind==='detail'?[e.result]:null;if(!Array.isArray(rows)||!rows.every(x=>UUID.test(x?.id??'')&&x.app_id===route.app&&x.account_id===ACCOUNT&&(route.kind!=='detail'||x.id===route.id)))return;if(route.kind==='list'){if(new Set(rows.map(x=>x.id)).size!==rows.length)return;discovered.set(route.app,new Set(rows.map(x=>x.id)));}for(const row of rows){const path=BASE+'/applications/'+route.app+'/deployments/'+row.id+'/placements';if(discovered.get(route.app)?.has(row.id)&&(row.placements_ref==='/deployments/'+row.id+'/placements'||row.placements_ref===path))placementPaths.add(path);}}
  function agentFor(url,signal){
    const agent=new https.Agent({keepAlive:false,maxSockets:1,rejectUnauthorized:true});
    if(proxy)agent.createConnection=(_options,callback)=>{
      let tunnel,secure,called=false;const done=(e,socket)=>{if(called)return;called=true;callback(e,socket);};
      const abort=()=>{tunnel?.destroy();secure?.destroy();done(new Stop('native-request-aborted'));};
      signal.addEventListener('abort',abort,{once:true});
      tunnel=http.request({host:proxy.hostname,port:proxy.port,method:'CONNECT',path:url.hostname+':443',headers:{host:url.hostname+':443'},agent:false,signal,maxHeaderSize:32768});
      active.add(tunnel);tunnel.once('close',()=>active.delete(tunnel));
      tunnel.once('connect',(res,socket,head)=>{if(signal.aborted||res.statusCode!==200||head.length){socket.destroy();done(new Stop('fixed-connect-tunnel-rejected'));return;}
        secure=tls.connect({socket,servername:url.hostname,rejectUnauthorized:true,minVersion:'TLSv1.2'});active.add(secure);secure.once('close',()=>{active.delete(secure);signal.removeEventListener('abort',abort);});secure.once('secureConnect',()=>done(null,secure));secure.once('error',()=>done(new Stop('native-tls-failed')));
      });
      tunnel.once('error',()=>done(new Stop('native-connect-failed')));tunnel.end();
    };
    return agent;
  }
  async function wire({url,method='GET',body=null,contentType=null,authorization=null,signal,maxBytes=16*1024*1024,maxMs=20000}){
    check();const child=new AbortController(),joined=signal?AbortSignal.any([signal,lifetime.signal,child.signal]):AbortSignal.any([lifetime.signal,child.signal]);
    const ms=Math.min(maxMs,deadline-Date.now());need(ms>0&&!joined.aborted,'native-request-expired');const timer=setTimeout(()=>child.abort(),ms),agent=agentFor(url,joined);
    try{return await new Promise((resolve,reject)=>{let finished=false,res,req;const fail=code=>{if(finished)return;finished=true;res?.destroy();req?.destroy();reject(new Stop(code));};
      const abort=()=>fail('native-request-aborted');joined.addEventListener('abort',abort,{once:true});
      const headers={'accept-encoding':'identity',connection:'close'};
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
        res.once('end',()=>{if(finished)return;if(joined.aborted||!res.complete||length!==undefined&&Number(length)!==size){fail('native-response-incomplete');return;}finished=true;joined.removeEventListener('abort',abort);const bytes=Buffer.concat(chunks);resolve({body:bytes,status:res.statusCode,contentType:res.headers['content-type']??'application/octet-stream'});});
        res.once('close',()=>active.delete(res));
      });
      // HTTPS emits this entity exactly once. There is no redirect handler,
      // retry loop, fetch middleware, cookie jar, inherited global agent or log.
      active.add(req);req.once('close',()=>{active.delete(req);joined.removeEventListener('abort',abort);});req.once('error',()=>fail(joined.aborted?'native-request-aborted':'native-request-failed'));req.end(body);
    });}finally{clearTimeout(timer);agent.destroy();authorization=null;}
  }
  return Object.freeze({fullWireResponses:true,close,request(input){
    need(input?.method==='GET'&&Object.keys(input).every(k=>['method','path','signal'].includes(k)),'physical-wire-get-only');const route=classify(input.path);check();
    return boundedTask(async signal=>{check();const supplied=await provider({accountId:ACCOUNT,worker:WORKER,requestId:REQUEST,signal});need(supplied instanceof Uint8Array&&supplied.byteLength>20&&supplied.byteLength<16384,'private-physical-credential-bytes');const owned=Buffer.from(supplied);supplied.fill(0);let authorization;
      try{need(!signal.aborted&&owned.every(x=>x>=33&&x<=126),'private-physical-credential-shape');authorization=owned.toString('ascii');const raw=await wire({url:new URL('https://api.cloudflare.com/client/v4'+input.path),method:'GET',authorization,signal});need(!signal.aborted,'physical-get-late-after-stop');observe(route,raw);return new Response(raw.body,{status:raw.status,headers:{'content-type':raw.contentType,'content-length':String(raw.body.length)}});}finally{owned.fill(0);authorization=null;}
    },{deadline,maxMs:20000,signal:input.signal,onLateValue:r=>r?.body?.cancel()});
  }});
}
