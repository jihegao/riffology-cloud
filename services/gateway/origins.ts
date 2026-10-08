import {HttpError} from './http.ts';

export interface AppOriginConfiguration {
  APP_ORIGIN:string;
  APP_TRANSPORT_ORIGIN?:string;
  TWO_ACCOUNT_AUTH_MODE?:string;
  LEGACY_RECOVERY_ORIGIN?:string;
  LEGACY_RECOVERY_UNTIL?:string;
  BROWSER_PREVIEW_EXECUTION_ORIGIN?:string;
}
export type AppTopology={canonical:string;transport:string;recovery?:string;recoveryUntil?:number;proxied:boolean;authentication?:'disabled'|'shared-limited'};

/** Configured origins only. Host and forwarding headers never configure routing. */
export function publicHttpsOrigin(value:string):URL {
  const url=new URL(value);
  if(url.origin!==value||url.protocol!=='https:'||url.username||url.password||url.port||
    url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname.includes(':')||/^\d+(?:\.\d+){3}$/.test(url.hostname))throw Error('invalid-public-origin');
  return url;
}
export function appTopology(env:AppOriginConfiguration):AppTopology {
  if(env.APP_TRANSPORT_ORIGIN===undefined){
    if(env.TWO_ACCOUNT_AUTH_MODE!==undefined||env.LEGACY_RECOVERY_ORIGIN!==undefined||env.LEGACY_RECOVERY_UNTIL!==undefined)throw Error('incomplete-origin-topology');
    return {canonical:env.APP_ORIGIN,transport:env.APP_ORIGIN,proxied:false};
  }
  const canonical=publicHttpsOrigin(env.APP_ORIGIN),transport=publicHttpsOrigin(env.APP_TRANSPORT_ORIGIN);
  if(canonical.origin===transport.origin)throw Error('transport-origin-overlap');
  const authentication=env.TWO_ACCOUNT_AUTH_MODE??'disabled';
  if(authentication!=='disabled'&&authentication!=='shared-limited')throw Error('invalid-two-account-auth-mode');
  const result:AppTopology={authentication,canonical:canonical.origin,transport:transport.origin,proxied:true};
  if(env.LEGACY_RECOVERY_ORIGIN!==undefined||env.LEGACY_RECOVERY_UNTIL!==undefined){
    if(!env.LEGACY_RECOVERY_ORIGIN||!env.LEGACY_RECOVERY_UNTIL)throw Error('incomplete-recovery-topology');
    const recovery=publicHttpsOrigin(env.LEGACY_RECOVERY_ORIGIN),until=Date.parse(env.LEGACY_RECOVERY_UNTIL);
    if(recovery.origin===canonical.origin||recovery.origin===transport.origin||!Number.isSafeInteger(until)||new Date(until).toISOString()!==env.LEGACY_RECOVERY_UNTIL)throw Error('invalid-recovery-topology');
    result.recovery=recovery.origin;result.recoveryUntil=until;
  }
  if(env.BROWSER_PREVIEW_EXECUTION_ORIGIN){
    const execution=publicHttpsOrigin(env.BROWSER_PREVIEW_EXECUTION_ORIGIN),site=(url:URL)=>url.hostname.split('.').slice(-2).join('.');
    if(execution.origin===transport.origin||site(execution)===site(canonical)||result.recovery&&site(execution)===site(new URL(result.recovery)))throw Error('execution-site-not-isolated');
  }
  return result;
}
export function requireRequestHost(request:Request):void {
  const url=new URL(request.url),host=request.headers.get('host');
  if(url.username||url.password||host!==null&&host!==url.host)throw new HttpError('origin_denied',403);
}
