import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const LEGACY_APP_ORIGIN='https://m1.riff-demo.gaojihe.cn';
export const RIFFOID_APP_ORIGIN='https://app.riffoid.com';
const APP_ALLOWLIST=new Set([LEGACY_APP_ORIGIN,RIFFOID_APP_ORIGIN]);
function exactHttpsOrigin(value){
  const url=new URL(value);
  if(url.origin!==value||url.protocol!=='https:'||url.username||url.password)throw Error('invalid-origin');
  return url;
}
/** Offline preparation only. No Gateway imports this module; no network or writes. */
export function domainPacket({canonicalOrigin,executionOrigin}){
  if(!APP_ALLOWLIST.has(canonicalOrigin))throw Error('app-origin-not-allowlisted');
  const execution=exactHttpsOrigin(executionOrigin);
  // Match the currently enforced last-two-hostname-label isolation rule.
  for(const value of APP_ALLOWLIST){
    const app=exactHttpsOrigin(value);
    if(app.hostname.split('.').slice(-2).join('.')===execution.hostname.split('.').slice(-2).join('.'))throw Error('execution-site-not-isolated');
  }
  return Object.freeze({
    canonicalOrigin,
    recoveryOrigin:canonicalOrigin===RIFFOID_APP_ORIGIN?LEGACY_APP_ORIGIN:RIFFOID_APP_ORIGIN,
    executionOrigin,
    authBaseURL:canonicalOrigin,
    trustedOrigins:Object.freeze([canonicalOrigin]),
    googleCallback:canonicalOrigin+'/api/auth/callback/google',
    apiBase:'/api',
    frameAncestors:Object.freeze([...APP_ALLOWLIST]),
    copyBrowserStorage:false,
    replayPendingRequests:false,
  });
}
/** Proposed dispatch policy for review, not an active routing implementation. */
export function appRequestMode(request,packet){
  // Revalidate the packet. Never derive auth configuration from Host or forwarded headers.
  const checked=domainPacket(packet),url=new URL(request.url);
  if(!APP_ALLOWLIST.has(url.origin))return 'deny';
  if(request.headers.get('upgrade'))return 'deny';
  const read=request.method==='GET'||request.method==='HEAD';
  if(url.origin===checked.recoveryOrigin)return read?'recovery-read-only':'deny';
  if(!read&&(request.headers.get('origin')!==checked.canonicalOrigin||request.headers.get('sec-fetch-site')==='cross-site'))return 'deny';
  return 'canonical';
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3)throw Error('usage: node scripts/m1/riffoid-domain-preflight.mjs <non-secret-input.json>');
  console.log(JSON.stringify(domainPacket(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));
}
