import { hasProbeAuthorization } from '../m0-cloud/auth.ts';
import { untilAbort } from '../m0-model-proxy/policy.ts';
export const HOST_ORIGIN = 'https://riffology-m0-pi-live-staging.jihe-gao.workers.dev';
export const LIVE_RUN = 'go-live-g0-20260906';
// v1 stopped before proxy initialization. This reviewed successor keeps the
// SAME model ledger and two-call allowance; it never resets supplier budget.
export const HOST_ATTEMPT = 'go-live-egress-v2-20260906';
export type LiveAction = 'accept' | 'report' | 'cleanup';
export async function handleLiveRequest(request: Request, secret: string | undefined, invoke: (action: LiveAction) => Promise<unknown>) {
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-riffology-m0-mode':'go-live-supervisor'}});
 if(!await hasProbeAuthorization(request,secret))return json({error:'operator-required'},401);
 const url=new URL(request.url), action=url.pathname.split('/').at(-1) as LiveAction;
 if(url.origin!==HOST_ORIGIN||url.search||url.hash||!['accept','report','cleanup'].includes(action)||url.pathname!==`/probe/${LIVE_RUN}/${action}`)return json({error:'route-denied'},404);
 if(request.method!==(action==='report'?'GET':'POST'))return json({error:'method-denied'},405);
 if(request.body){const reader=request.body.getReader(),ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),1000);
 try{let ended=false;for(let i=0;i<16;i++){const part=await untilAbort(reader.read(),ctrl.signal);if(part.done){ended=true;break;}if(part.value.byteLength)return json({error:'empty-body-required'},400);}if(!ended)return json({error:'empty-body-required'},400);}
 catch{return json({error:'empty-body-required'},400);}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}}
 try{return json(await invoke(action),action==='accept'?202:200);}catch{return json({error:'operation-unconfirmed',next:'read report; do not replay accept'},409);}
}
