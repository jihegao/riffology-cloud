/** The function is never called in this preparation. Secret frame is RAM/FD4.
 * FD3 has nonsecret scope/deadline metadata only; no argv/env credential input.
 */
import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {need,Stop,sha,hashJSON,REQUEST,ACCOUNT,WORKER,USER_SHA,SCOPES,current,fresh} from './local-guards.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url)),HELPER=join(ROOT,'cf_native_credential.py');
// Fixed helper Guard codes only. Unknown text/status never becomes output.
const HELPER_FAILURE_CODES=new Set([
  'bounded-existing-auth-config','bounded-existing-oauth-token','bounded-identity-content-length','bounded-identity-headers','bounded-identity-json','bounded-private-credential-metadata','bounded-private-owner-request','complete-identity-body','distinct-private-request-result-pipes','duplicate-json-key','duplicate-root-auth-field','exact-existing-six-oauth-scopes','existing-auth-config-encoding','existing-auth-field-required','existing-oauth-expiration','existing-oauth-expired-no-refresh','existing-oauth-valid-through-bounded-attempt-no-refresh','existing-wrangler-oauth-unavailable','fixed-explicit-loopback-proxy','fixed-native-credential-helper-source','fixed-native-credential-request','fixed-native-helper-no-arguments','fresh-validated-owner-preflight-required','identity-content-encoding','identity-deadline','identity-get-only',
  'identity-http-400','identity-http-401','identity-http-403','identity-http-404','identity-http-408','identity-http-409','identity-http-413','identity-http-422','identity-http-429','identity-http-500','identity-http-502','identity-http-503','identity-http-504',
  'identity-success-envelope','incomplete-root-auth-escape','input-changed','invalid-json','invalid-root-auth-comment','invalid-root-auth-escape','invalid-root-auth-scope-array','invalid-root-auth-string','invalid-root-auth-unicode','native-credential-deadline','native-credential-disabled-before-auth','native-private-helper-stopped','nonfinite-json','owned-bounded-regular-input','owned-private-pipe-required','root-auth-assignment-required','root-auth-key-required','root-auth-scope-array-required','root-auth-string-required','root-auth-tables-forbidden','same-existing-cloudflare-account-required','same-existing-cloudflare-user-required','unknown-root-auth-field','unparsed-root-auth-content','unterminated-root-auth-scope-array','unterminated-root-auth-string'
]);
function safeHelperFailure(parts,size){
  if(size<=0||size>8192)return null;const raw=Buffer.concat(parts);
  try{
    const v=JSON.parse(raw.toString('utf8')),keys=['code','credentialBodyLogged','identityGetCounts','operation','refreshAttempts','retryAttempts','schema'];
    if(!v||Object.keys(v).sort().join(',')!==keys.join(',')||v.schema!=='riffoid-ir.native-oauth-fd-stopped/v1'||!HELPER_FAILURE_CODES.has(v.code)||v.refreshAttempts!==0||v.retryAttempts!==0||v.credentialBodyLogged!==false)return null;
    const counts=v.identityGetCounts;if(!counts||Object.keys(counts).sort().join(',')!=='account,user'||![0,1].includes(counts.user)||![0,1].includes(counts.account))return null;
    const expected={'disabled-before-auth':[0,0],'existing-wrangler-read':[0,0],'get-user':[1,0],'get-account':[1,1]}[v.operation];
    if(!expected||counts.user!==expected[0]||counts.account!==expected[1])return null;
    return v.code; // The sole retained diagnostic; never the raw JSON/body.
  }catch{return null;}finally{raw.fill(0);}
}
export async function loadExistingCredentialVault({mode,facts,preflight,proxy,helperSha256,manifestSha256,signal,deadline}={}){
  current(signal,deadline);need(facts.requestId===REQUEST,'fixed-owner-request');
  const request={schema:'riffoid-ir.native-oauth-fd-request/v1',executionEnabled:true,mode,requestId:REQUEST,accountId:ACCOUNT,worker:WORKER,expectedUserIdSha256:USER_SHA,requiredScopes:SCOPES,preparationManifestSha256:manifestSha256,helperSourceSha256:helperSha256,factsCanonicalSha256:hashJSON(facts),preflight,preflightCanonicalSha256:hashJSON(preflight),deadlineUnix:deadline/1000,proxy};
  const body=Buffer.from(JSON.stringify(request));need(body.length<=16384,'private-owner-request-limit');
  const raw=await new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/python3',['-I','-B',HELPER],{cwd:ROOT,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['ignore','ignore','pipe','pipe','pipe'],windowsHide:true});
    const parts=[],diagnosticParts=[];let size=0,stderrBytes=0,stopped=null,finished=false,killTimer,unknownTimer;
    const wipe=()=>{for(const p of [...parts,...diagnosticParts])p.fill(0);};
    const stop=code=>{if(stopped)return;stopped=code;if(child.pid)child.kill('SIGTERM');killTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},1000);unknownTimer=setTimeout(()=>finish(new Stop('credential-helper-close-unconfirmed')),2500);};
    const abort=()=>stop('credential-helper-parent-aborted');
    const timer=setTimeout(()=>stop('credential-helper-hard-timeout'),Math.min(45000,deadline-Date.now()));
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(unknownTimer);signal?.removeEventListener('abort',abort);body.fill(0);wipe();error?reject(error):resolve(value);};
    child.stdio[4].on('data',b=>{if(finished){b.fill(0);return;}size+=b.length;if(size>32768){b.fill(0);stop('private-credential-frame-limit');return;}parts.push(b);});
    child.stderr.on('data',b=>{stderrBytes+=b.length;if(!finished&&stderrBytes<=8192)diagnosticParts.push(Buffer.from(b));b.fill(0);if(stderrBytes>8192)stop('credential-helper-stderr-limit');});
    child.stdio[3].on('error',()=>{});child.stdio[4].on('error',()=>stop('private-credential-pipe-stopped'));
    child.once('error',()=>finish(new Stop('credential-helper-start-stopped')));
    child.once('close',code=>{if(stopped)return finish(new Stop(stopped));if(code!==0||stderrBytes!==0)return finish(new Stop((code!==0?safeHelperFailure(diagnosticParts,stderrBytes):null)??'credential-helper-rejected-no-refresh'));const value=Buffer.concat(parts);finish(null,value);});
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});child.stdio[3].end(body);
  });
  let master,metadata;
  try{
    current(signal,deadline);need(raw.length>=8,'private-credential-frame');const n=raw.readUInt32BE(0),m=raw.readUInt32BE(4);need(n>0&&n<=4096&&m>20&&m<16384&&raw.length===8+n+m,'complete-private-credential-frame');
    metadata=JSON.parse(raw.subarray(8,8+n).toString('ascii'));const token=raw.subarray(8+n);need(token.every(x=>x>=33&&x<=126),'private-credential-byte-shape');
    need(metadata.schema==='riffoid-ir.native-oauth-fd-result/v1'&&metadata.mode===mode&&metadata.requestId===REQUEST&&metadata.accountId===ACCOUNT&&metadata.worker===WORKER&&metadata.expectedUserIdSha256===USER_SHA&&hashJSON([...metadata.scopes].sort())===hashJSON([...SCOPES].sort())&&metadata.factsCanonicalSha256===hashJSON(facts)&&metadata.preflightCanonicalSha256===hashJSON(preflight)&&metadata.helperSourceSha256===helperSha256&&metadata.deadlineUnix===deadline/1000&&metadata.expiresAtUnix>deadline/1000+120&&metadata.refreshAttempts===0&&metadata.retryAttempts===0&&metadata.credentialBodyLogged===false,'actual-private-credential-identity-and-scope');fresh(metadata.identityVerifiedAtUnix*1000);
    need(Array.isArray(metadata.identityResponses)&&metadata.identityResponses.length===2&&metadata.identityResponses[0].path==='/user'&&metadata.identityResponses[1].path==='/accounts/'+ACCOUNT&&metadata.identityResponses.every(x=>x.status===200&&x.bytes>0&&x.bytes<=65536&&/^[a-f0-9]{64}$/.test(x.sha256)),'actual-fixed-identity-get-receipts');
    master=Buffer.from(token);
  }finally{raw.fill(0);}
  let closed=false;
  return Object.freeze({safeMetadata:metadata,close(){if(closed)return;closed=true;master.fill(0);master=null;},
    async credentialProvider(input){current(input?.signal,deadline);need(!closed&&input?.accountId===ACCOUNT&&input.worker===WORKER&&input.requestId===REQUEST&&Date.now()/1000+120<metadata.expiresAtUnix,'same-live-owner-credential-scope');return Buffer.from(master);}
  });
}
