import {HttpError} from '../gateway/http.ts';
import {clientIp} from './signature.ts';

export const VALIDATION_PREFIX='/__riffoid-validation/';
export const VALIDATION_ACTOR='riffoid-entry-replay-v1:0';
export const VALIDATION_CASE_HEADER='x-riffoid-validation-case';
export const VALIDATION_TABLE='riffoid_validation_budget_v1';
export const VALIDATION_MAX_WINDOW_MS=120_000,VALIDATION_CLEANUP_MS=30_000;
export const VALIDATION_INVOCATION_MS=45_000,VALIDATION_FETCH_MS=5_000;
export const validationCanonical='https://app.riffoid.com';
export const validationTransport='https://riffoid-transport.gaojihe.cn';
export type ValidationSlot='A'|'B';
export type ValidationAction='observe'|'begin'|'primary'|'replay'|'expired';
export interface ValidationConfig {version:1;run:string;notBefore:number;expires:number;ips:{A:string;B:string};}
export interface ValidationClaim {run:string;slot:ValidationSlot;action:ValidationAction;}
export interface ValidationEnv {RIFFOID_VALIDATION_CONFIG_JSON?:string;}
export interface ValidationTopology {canonical:string;transport:string;proxied:boolean;authentication?:string;}
export function validationConfig(env:ValidationEnv):ValidationConfig {
  try{
    const raw=env.RIFFOID_VALIDATION_CONFIG_JSON;
    if(typeof raw!=='string'||raw.length>1024)throw Error('config');
    const c=JSON.parse(raw) as ValidationConfig;
    if(!c||Object.keys(c).sort().join(',')!=='expires,ips,notBefore,run,version'||c.version!==1||
      typeof c.run!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(c.run)||
      !Number.isSafeInteger(c.notBefore)||!Number.isSafeInteger(c.expires)||c.notBefore<0||
      c.expires-c.notBefore<VALIDATION_INVOCATION_MS||c.expires-c.notBefore>VALIDATION_MAX_WINDOW_MS||
      !c.ips||Object.keys(c.ips).sort().join(',')!=='A,B'||typeof c.ips.A!=='string'||typeof c.ips.B!=='string'||
      clientIp(c.ips.A)!==c.ips.A||clientIp(c.ips.B)!==c.ips.B||c.ips.A===c.ips.B)throw Error('config');
    return c;
  }catch{throw new HttpError('validation_not_configured',503);}
}
export function validationTime(c:ValidationConfig,cleanup=false):void {
  const now=Date.now();
  if(cleanup?now<c.expires||now>=c.expires+VALIDATION_CLEANUP_MS:now<c.notBefore||now>=c.expires)
    throw new HttpError('validation_closed',403);
}
export function validationTopology(t:ValidationTopology):void {
  if(!t.proxied||t.canonical!==validationCanonical||t.transport!==validationTransport||t.authentication!=='signed-entry-v1')
    throw new HttpError('validation_topology_denied',503);
}
export function validationRoute(request:Request,c:ValidationConfig):{slot:ValidationSlot;operation:'ui'|'observe'|'run'|'cleanup'} {
  const u=new URL(request.url),m=/^\/__riffoid-validation\/([A-Za-z0-9_-]{16,64})\/(A|B)\/(ui|observe|run|cleanup)$/.exec(u.pathname);
  if(!m||m[1]!==c.run||request.url.slice(u.origin.length)!==u.pathname)throw new HttpError('validation_scope_denied',403);
  return {slot:m[2] as ValidationSlot,operation:m[3] as 'ui'|'observe'|'run'|'cleanup'};
}
/** Fixed empty native body only; no clone/tee, no arbitrary signing input. */
export async function validationEmptyBody(request:Request):Promise<void> {
  const length=request.headers.get('content-length');
  if(request.headers.has('content-encoding')||request.headers.has('transfer-encoding')||length!==null&&length!=='0')
    throw new HttpError('validation_body_denied',403);
  if(!request.body)return;
  const reader=request.body.getReader();let timer:ReturnType<typeof setTimeout>|undefined;
  let aborted:()=>void=()=>{};
  const stop=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new HttpError('validation_body_denied',403)),VALIDATION_FETCH_MS);
    aborted=()=>reject(new HttpError('validation_cancelled',403));
  });request.signal.addEventListener('abort',aborted,{once:true});
  try{
    if(request.signal.aborted)throw new HttpError('validation_cancelled',403);
    // Bound zero-length chunk streams as well as bytes.
    for(let i=0;i<8;i++){const value=await Promise.race([reader.read(),stop]);if(value.done)return;
      if(value.value.byteLength)throw new HttpError('validation_body_denied',403);}
    throw new HttpError('validation_body_denied',403);
  }finally{clearTimeout(timer);request.signal.removeEventListener('abort',aborted);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function validationNoCredentials(request:Request):void {
  if(['cookie','authorization','upgrade','x-riffoid-client-ip'].some(h=>request.headers.has(h)))
    throw new HttpError('validation_credentials_denied',403);
}
export function validationClaimAllowed(value:ValidationClaim,c:ValidationConfig):boolean {
  return Boolean(value&&Object.keys(value).sort().join(',')==='action,run,slot'&&value.run===c.run&&
    (value.slot==='A'||value.slot==='B')&&['observe','begin','primary','replay','expired'].includes(value.action)&&
    (value.slot==='A'||!['replay','expired'].includes(value.action)));
}
export const validationBits:Record<ValidationAction,number>={observe:1,begin:2,primary:4,replay:8,expired:16};
export function validationRequiredMask(action:ValidationAction):number {
  return {observe:0,begin:1,primary:3,replay:7,expired:15}[action];
}
