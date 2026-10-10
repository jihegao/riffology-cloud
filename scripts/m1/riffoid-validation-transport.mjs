// Raw HTTP transport. Authentication belongs to the caller's existing authorized
// channel; this module never reads tokens, private keys or credential files.
import assert from 'node:assert/strict';
import {hashBytes} from './riffoid-validation-evidence.mjs';
export function validateControlRequest(method,path){
    const parsed=new URL('https://api.cloudflare.com/client/v4'+path);assert.equal(parsed.hash,'');
    const pathname=parsed.pathname.slice('/client/v4'.length);assert.equal(path.split('?')[0],pathname,'path normalization forbidden');
    assert.ok(/^\/zones\/[a-f0-9]{32}(?:\/logpush\/jobs|\/rulesets\/phases\/http_log_custom_fields\/entrypoint)?$/.test(pathname)||/^\/accounts\/[a-f0-9]{32}\/(?:logpush\/jobs|workers\/observability\/destinations|workers\/scripts(?:\/[a-z0-9_-]+(?:\/(?:settings|script-settings|deployments|versions(?:\/[a-zA-Z0-9_-]+)?|content\/v2|tails))?)?|containers\/applications(?:\/[a-zA-Z0-9_-]+)?|workers\/durable_objects\/namespaces(?:\/[a-zA-Z0-9_-]+)?)$/.test(pathname),'unsupported control-plane path');
    const keys=[...parsed.searchParams.keys()];assert.equal(new Set(keys).size,keys.length);
    const allowed=method==='PUT'?['bindings_inherit']:pathname.endsWith('/destinations')?['page','perPage']:pathname.endsWith('/containers/applications')?['per_page','page_token']:[];assert.ok(keys.every(k=>allowed.includes(k)));
    for(const[k,v]of parsed.searchParams)assert.ok(k==='page_token'?/^[A-Za-z0-9_.~=-]{1,512}$/.test(v):k==='bindings_inherit'?v==='strict':/^\d{1,4}$/.test(v));
    if(method==='PUT')assert.ok(/\/workers\/scripts\/[a-z0-9_-]+\?bindings_inherit=strict$/.test(path),'only existing Worker upload permitted');
}
export function cloudflareTransport({authorizedFetch,mode='dry-run',timeoutMS=15000,maxBytes=16*1024*1024}={}){
  assert.ok(['dry-run','read-only','live'].includes(mode));
  assert.ok(Number.isSafeInteger(timeoutMS)&&timeoutMS>0&&timeoutMS<=30000);
  return Object.freeze({mode,async request({method='GET',path,body,contentType}){
    assert.ok(['GET','PUT'].includes(method));
    validateControlRequest(method,path);
    if(mode==='dry-run')return {dryRun:true,method,path,bytes:body?.length??0,bodySHA256:body?hashBytes(body):null};
    if(method!=='GET')assert.equal(mode,'live','writes forbidden in read-only mode');
    assert.equal(typeof authorizedFetch,'function','existing authenticated fetch channel required');
    const controller=new AbortController();let timer;
    try{
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('transport timeout; original request unknown; no retry'));},timeoutMS);});
      return await Promise.race([(async()=>{
        const response=await authorizedFetch('https://api.cloudflare.com/client/v4'+path,{method,body,headers:contentType?{'content-type':contentType}:{},signal:controller.signal,redirect:'error',cache:'no-store'});
        assert.ok(response instanceof Response,'raw HTTP Response with headers/bytes required');
        assert.ok(!response.headers.has('location'),'redirect forbidden');
        const reader=response.body?.getReader();assert.ok(reader);const parts=[];let n=0;
        try{while(true){const v=await reader.read();if(v.done)break;n+=v.value.length;assert.ok(n<=maxBytes,'bounded control-plane response');parts.push(Buffer.from(v.value));}}
        finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
        const bytes=Buffer.concat(parts);assert.ok([200,404].includes(response.status),'control-plane request not acknowledged; no retry');
        return {status:response.status,contentType:response.headers.get('content-type'),mainModule:response.headers.get('cf-entrypoint'),bytes,bodySHA256:hashBytes(bytes)};
      })(),timeout]);
    }finally{clearTimeout(timer);controller.abort();}
  }});
}
export function jsonResult(raw){
  assert.equal(raw.status,200);assert.ok(raw.contentType?.startsWith('application/json'));
  const d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw.bytes));assert.equal(d.success,true);assert.ok(d.result);return d;
}

// Official SDK raw-response bridge; reuse a caller's already-authenticated client.
// Read-only here: no token/environment/credential loader and no SDK PUT path.
export function sdkReadOnlyFetch(client){
  assert.equal(typeof client?.get,'function');
  return async(url,options)=>{
    const u=new URL(url);assert.equal(u.origin,'https://api.cloudflare.com');assert.ok(u.pathname.startsWith('/client/v4/'));assert.equal(options.method,'GET');
    const path=u.pathname.slice('/client/v4'.length)+u.search;validateControlRequest('GET',path);
    const promise=client.get(path,{headers:options.headers,signal:options.signal,maxRetries:0,timeout:15000,fetchOptions:{redirect:'error',cache:'no-store'}});assert.equal(typeof promise?.asResponse,'function','decoded connector results cannot substitute for raw Response');
    const raw=await promise.asResponse();assert.ok(raw?.body&&typeof raw.headers?.get==='function');assert.ok(!raw.headers.has('location'));
    const headers=new Headers();for(const k of ['content-type','cf-entrypoint']){const v=raw.headers.get(k);if(v!==null)headers.set(k,v);}
    return new Response(raw.body,{status:raw.status,headers});
  };
}

// Decoded connector metadata is sufficient for configuration inventories only.
// It is explicitly never source/body/header evidence and cannot read G5 settings.
export function connectorMetadataTransport({execute,accountId,zoneId,worker}){
  assert.equal(typeof execute,'function');assert.match(accountId,/^[a-f0-9]{32}$/);assert.match(zoneId,/^[a-f0-9]{32}$/);assert.match(worker,/^[a-z0-9_-]+$/);
  return Object.freeze({mode:'read-only',async request({method='GET',path}){
    assert.equal(method,'GET');validateControlRequest(method,path);const u=new URL('https://api.cloudflare.com/client/v4'+path),p=u.pathname.slice('/client/v4'.length);
    const permitted=[`/zones/${zoneId}`,`/zones/${zoneId}/logpush/jobs`,`/zones/${zoneId}/rulesets/phases/http_log_custom_fields/entrypoint`,`/accounts/${accountId}/logpush/jobs`,`/accounts/${accountId}/workers/observability/destinations`,`/accounts/${accountId}/workers/scripts/${worker}/tails`,`/accounts/${accountId}/containers/applications`];
    assert.ok(permitted.includes(p)||p.startsWith(`/accounts/${accountId}/containers/applications/`),'exact metadata scope required');
    const r=await execute({method:'GET',path:p,query:Object.fromEntries(u.searchParams)});assert.ok(Number.isInteger(r.status)&&typeof r.success==='boolean','structured API receipt required; never infer HTTP status from error text');
    return {status:r.status,contentType:'application/json',bytes:Buffer.from(JSON.stringify(r)),mainModule:null,provenance:'connector decoded configuration; not raw HTTP bytes'};
  }});
}
