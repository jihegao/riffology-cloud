import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {fetch,ProxyAgent} from 'undici';

const GOOGLE_TOKEN='https://oauth2.googleapis.com/token';
const GOOGLE_JWKS='https://www.googleapis.com/oauth2/v3/certs';
const OPENCODE_RESPONSES='https://opencode.ai/zen/go/v1/responses';
const MAX_OAUTH_REQUEST_BYTES=16*1024,MAX_MODEL_REQUEST_BYTES=2*1024*1024,UPSTREAM_TIMEOUT_MS=10_000,MODEL_TIMEOUT_MS=130_000;
const TOKEN_FIELDS=Object.freeze(['client_id','client_secret','code','code_verifier','grant_type','redirect_uri']);

const equal=(a,b)=>{const left=Buffer.from(a??''),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
const denied=()=>new Response('{"error":"outbound_denied"}',{status:403,headers:{'content-type':'application/json','cache-control':'no-store'}});
const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,12);
const fieldEvidence=params=>Object.fromEntries([...new Set(params.keys())].sort().map(name=>{const values=params.getAll(name);return [name,{count:values.length,values:values.map(value=>({bytes:Buffer.byteLength(value),sha256:digest(value)}))}];}));
async function boundedResponse(response,maximum=1024*1024){
  const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>maximum)throw Error('upstream-response-too-large');
  const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);const chunks=[];let size=0;
  try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>maximum)throw Error('upstream-response-too-large');chunks.push(Buffer.from(item.value));}}finally{if(size>maximum)await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
function modelEvidence(bytes,contentType){const eventTypes=[],usageFields=[];let eventCount=0,errorType=null;if(contentType==='text/event-stream'){try{const text=bytes.toString('utf8');for(const frame of text.replaceAll('\r\n','\n').split(/\n\n+/u))for(const line of frame.split('\n').filter(value=>value.startsWith('data:'))){const data=line.slice(5).trimStart();if(!data||data==='[DONE]')continue;const row=JSON.parse(data);eventCount++;if(typeof row?.type==='string'&&/^[a-z][a-z0-9._-]{0,63}$/.test(row.type))eventTypes.push(row.type);if(row?.response?.usage&&typeof row.response.usage==='object')for(const key of Object.keys(row.response.usage))if(/^[a-z][a-z0-9_]{0,63}$/.test(key))usageFields.push(key);}}catch{/* Worker parser owns validity */}}else try{const row=JSON.parse(bytes.toString('utf8')),value=row?.error?.type;if(typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value))errorType=value;}catch{}return {eventTypes:[...new Set(eventTypes)].sort(),eventCount,usageFields:[...new Set(usageFields)].sort(),errorType};}

export function createGoogleOAuthOutboundService({capability,googleClientId,googleClientSecret,redirectUri,proxyUrl=process.env.HTTPS_PROXY??process.env.https_proxy,fetchImpl=fetch,telemetry=()=>{}}={}){
  if(typeof capability!=='string'||capability.length<32)throw Error('google-oauth-egress-capability-required');
  if(!proxyUrl)throw Error('google-oauth-https-proxy-required');
  const parsedProxy=new URL(proxyUrl);if(!['http:','https:'].includes(parsedProxy.protocol))throw Error('google-oauth-https-proxy-invalid');
  const dispatcher=new ProxyAgent(proxyUrl);let tokenRequests=0;
  return async(request)=>{
    const url=request.url,oauth=url===GOOGLE_TOKEN||url===GOOGLE_JWKS,model=url===OPENCODE_RESPONSES;
    if(!oauth&&!model)return denied();
    const capabilityMatch=!oauth||equal(request.headers.get('x-riffology-oauth-egress'),capability);
    if(url===GOOGLE_JWKS&&request.method!=='GET'||url===GOOGLE_TOKEN&&request.method!=='POST'||model&&request.method!=='POST'){
      telemetry({event:'outbound-denied',target:url===GOOGLE_TOKEN?'google-token':url===GOOGLE_JWKS?'google-jwks':'opencode',reason:'method',method:request.method,capabilityMatch});return denied();
    }
    const body=request.method==='POST'?Buffer.from(await request.arrayBuffer()):undefined,maximum=model?MAX_MODEL_REQUEST_BYTES:MAX_OAUTH_REQUEST_BYTES;
    if(body&&body.length>maximum){telemetry({event:'outbound-denied',target:url===GOOGLE_TOKEN?'google-token':'opencode',reason:'body-too-large',bodyBytes:body.length,capabilityMatch});return denied();}
    const contentType=request.headers.get('content-type')??'';
    if(url===GOOGLE_TOKEN&&!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')||model&&!contentType.toLowerCase().startsWith('application/json')){telemetry({event:'outbound-denied',target:url===GOOGLE_TOKEN?'google-token':'opencode',reason:'content-type',contentType:contentType.split(';')[0],capabilityMatch});return denied();}
    if(url===GOOGLE_TOKEN){
      const params=new URLSearchParams(body?.toString('utf8')),fields=[...new Set(params.keys())].sort(),validFields=fields.length===TOKEN_FIELDS.length&&fields.every((name,index)=>name===TOKEN_FIELDS[index])&&TOKEN_FIELDS.every(name=>params.getAll(name).length===1&&params.get(name));
      tokenRequests+=1;
      const evidence={event:'google-token-received',count:tokenRequests,method:request.method,contentType:contentType.split(';')[0],incomingContentLength:request.headers.get('content-length'),bodyBytes:body?.length??0,bodySha256:digest(body??Buffer.alloc(0)),fields,fieldEvidence:fieldEvidence(params),capabilityMatch,validFields,grantTypeMatch:params.get('grant_type')==='authorization_code',clientIdMatch:!googleClientId||params.get('client_id')===googleClientId,clientSecretMatch:!googleClientSecret||params.get('client_secret')===googleClientSecret,redirectUriMatch:!redirectUri||params.get('redirect_uri')===redirectUri};
      telemetry(evidence);
      const denialReason=!capabilityMatch?'capability':!validFields?'fields':!evidence.grantTypeMatch?'grant-type':!evidence.clientIdMatch?'client-id':!evidence.clientSecretMatch?'client-secret':!evidence.redirectUriMatch?'redirect-uri':null;
      if(denialReason){telemetry({event:'outbound-denied',target:'google-token',count:tokenRequests,reason:denialReason});return denied();}
      telemetry({event:'google-token-request',count:tokenRequests,upstreamHost:'oauth2.googleapis.com',transport:'undici-proxy-agent'});
    }else if(url===GOOGLE_JWKS&&!capabilityMatch){telemetry({event:'outbound-denied',target:'google-jwks',reason:'capability'});return denied();
    }
    const headers=new Headers({accept:request.headers.get('accept')??(model?'text/event-stream':'application/json')});
    if(body){headers.set('content-type',contentType);headers.set('content-length',String(body.length));}
    if(model){for(const name of ['authorization','x-client-request-id','x-opencode-session']){const value=request.headers.get(name);if(value)headers.set(name,value);}let keys=[];try{const parsed=JSON.parse(body?.toString('utf8')??'');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))keys=Object.keys(parsed).filter(key=>/^[a-z][a-z0-9_]{0,63}$/.test(key)).sort();}catch{}telemetry({event:'opencode-request-received',endpoint:'responses',method:request.method,contentType:contentType.split(';')[0],bodyBytes:body?.length??0,jsonKeys:keys,authorizationPresent:headers.has('authorization'),clientRequestIdPresent:headers.has('x-client-request-id'),sessionHeaderPresent:headers.has('x-opencode-session')});}
    try{
      const started=Date.now(),upstream=await fetchImpl(url,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(model?MODEL_TIMEOUT_MS:UPSTREAM_TIMEOUT_MS),dispatcher});
      if(upstream.status>=300&&upstream.status<400)return new Response('{"error":"outbound_redirect_denied"}',{status:502,headers:{'content-type':'application/json'}});
      if(oauth){const payload=await boundedResponse(upstream),parsed=(()=>{try{return JSON.parse(payload.toString('utf8'));}catch{return null;}})(),error=upstream.ok?null:typeof parsed?.error==='string'&&/^[a-z_]{1,64}$/.test(parsed.error)?parsed.error:'unclassified';telemetry({event:url===GOOGLE_TOKEN?'google-token-response':'google-jwks-response',count:url===GOOGLE_TOKEN?tokenRequests:undefined,status:upstream.status,error,durationMs:Date.now()-started,responseBytes:payload.length,responseSha256:digest(payload)});return new Response(payload,{status:upstream.status,headers:{'content-type':upstream.headers.get('content-type')??'application/json','content-length':String(payload.length),'cache-control':'no-store'}});}
      const payload=await boundedResponse(upstream,1_100_000),responseContentType=upstream.headers.get('content-type')?.split(';')[0].trim()??'application/octet-stream',requestId=upstream.headers.get('x-request-id');telemetry({event:'opencode-upstream-response',status:upstream.status,contentType:responseContentType,durationMs:Date.now()-started,responseBytes:payload.length,requestIdPresent:requestId!==null,...modelEvidence(payload,responseContentType)});const responseHeaders=new Headers({'content-type':upstream.headers.get('content-type')??responseContentType,'content-length':String(payload.length),'cache-control':'no-store'});if(requestId)responseHeaders.set('x-request-id',requestId);return new Response(payload,{status:upstream.status,headers:responseHeaders});
    }catch(error){telemetry({event:'outbound-failure',target:oauth?'google':model?'opencode':'denied',error:error instanceof Error?error.name:'Error'});return new Response('{"error":"outbound_failed"}',{status:502,headers:{'content-type':'application/json','cache-control':'no-store'}});}
  };
}

export function googleOAuthEgress(options={}){
  const capability=randomBytes(32).toString('base64url');
  return {capability,outboundService:createGoogleOAuthOutboundService({capability,...options})};
}
