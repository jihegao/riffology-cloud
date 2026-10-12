import {requireOrigin} from '../../services/gateway/http.ts';

export const CANONICAL_APP_ORIGIN='https://app.riffoid.com';
export const EXISTING_APP_ORIGIN='https://m1.riff-demo.gaojihe.cn';

/** Offline probe only: no fetch, Worker export, config or production imports.
 * Shows the actual transport URL and retains browser Origin. The unchanged
 * Gateway must reject canonical writes through this hop; that is the expected
 * result, not a reason to rewrite Origin or trust forwarded identity headers.
 */
export function publicHopProbe(request:Request):Request {
  const incoming=new URL(request.url);
  if(incoming.origin!==CANONICAL_APP_ORIGIN||incoming.username||incoming.password)throw Error('entry-origin-denied');
  const host=request.headers.get('host');
  if(host!==null&&host!==incoming.host)throw Error('entry-host-denied');
  if(request.headers.has('upgrade'))throw Error('upgrade-not-prepared');
  if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(request.method))throw Error('method-not-prepared');
  if(!['GET','HEAD'].includes(request.method))requireOrigin(request,CANONICAL_APP_ORIGIN);
  const target=new URL(EXISTING_APP_ORIGIN);
  // Do not resolve the client path as a URL: //attacker.test remains a path.
  target.pathname=incoming.pathname;target.search=incoming.search;
  const headers=new Headers();
  for(const name of ['accept','accept-language','content-type','cookie','origin','referer','sec-fetch-site','sec-fetch-mode','sec-fetch-dest','idempotency-key','last-event-id']){
    const value=request.headers.get(name);if(value!==null)headers.set(name,value);
  }
  const init:RequestInit&{duplex:'half'}={method:request.method,headers,redirect:'manual',signal:request.signal,duplex:'half'};
  if(!['GET','HEAD'].includes(request.method))init.body=request.body;
  return new Request(target,init);
}

/** Response contract checks for fixtures; deliberately no cookie/URL rewriting.
 * A future edge must preserve separate Set-Cookie fields and forward a stream
 * without consuming it. This function returns the original Response object.
 */
export function canonicalResponseProbe(response:Response):Response {
  for(const cookie of response.headers.getSetCookie()){
    if(/;\s*domain\s*=/i.test(cookie))throw Error('cookie-domain-not-prepared');
  }
  const location=response.headers.get('location');
  if(location!==null){
    const target=new URL(location,CANONICAL_APP_ORIGIN);
    if(target.origin!==CANONICAL_APP_ORIGIN)throw Error('noncanonical-location');
    if(/[\\\r\n]/.test(location))throw Error('invalid-location');
  }
  return response;
}
