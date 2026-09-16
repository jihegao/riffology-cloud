import {G5_GLOBAL_ACTOR} from '../model-budget/g5-window.ts';
import type {G5ControlledWindow} from '../model-budget/g5-window-durable.ts';

const MAX_BODY=8192;
type Env={G5_OPERATOR_CAPABILITY:string;G5_WINDOW_GUARD:DurableObjectNamespace<G5ControlledWindow>};
const fail=(status:number,code:string)=>Response.json({ok:false,error:code},{status,headers:{'cache-control':'no-store'}});
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const exact=(value:unknown,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
const validSecret=(v:unknown):v is string=>typeof v==='string'&&v.length>=32&&v.length<=4096&&!/[\r\n]/.test(v);
async function digest(value:unknown){const bytes=new TextEncoder().encode(JSON.stringify(value)),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function sameSecret(a:string,b:string){const [x,y]=await Promise.all([digest(a),digest(b)]);let n=0;for(let i=0;i<x.length;i++)n|=x.charCodeAt(i)^y.charCodeAt(i);return n===0;}
async function body(request:Request){const declared=Number(request.headers.get('content-length')??0);if(!Number.isSafeInteger(declared)||declared<0||declared>MAX_BODY)throw Error('body-denied');const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.byteLength>MAX_BODY)throw Error('body-denied');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
function summarize(raw:any){
 if(raw?.schemaVersion!==1||!raw.activePolicy?.windowId||!Array.isArray(raw.windows)||!Array.isArray(raw.tasks)||!Array.isArray(raw.turns)||!Array.isArray(raw.calls))throw Error('guard-snapshot-invalid');
 const windowId=raw.activePolicy.windowId,windows=raw.windows.filter((v:any)=>v.window_id===windowId);if(windows.length>1)throw Error('guard-window-duplicate');
 const tasks=raw.tasks.filter((v:any)=>v.window_id===windowId),calls=raw.calls.filter((v:any)=>v.window_id===windowId),turns=raw.turns.filter((v:any)=>v.window_id===windowId),kind=(v:any)=>{try{return JSON.parse(v.document).kind;}catch{return 'invalid';}};
 const byTurn=new Map<string,number>();for(const call of calls)byTurn.set(call.turn_key,(byTurn.get(call.turn_key)??0)+(Number.isSafeInteger(call.accounted)?call.accounted:0));
 return {schemaVersion:1,authority:'g5-window-guard-only',windowId,profileSha256:raw.activePolicy.profilePin?.profileSha256??null,startedAt:windows[0]?.started_at??null,closed:windows[0]?.closed===1,counts:{tasks:tasks.length,projects:tasks.filter((v:any)=>kind(v)==='project').length,turns:tasks.filter((v:any)=>kind(v)==='turn').length,simulationRuns:tasks.filter((v:any)=>kind(v)==='simulation').length,serviceRuns:tasks.filter((v:any)=>kind(v)==='service').length,dispatches:calls.filter((v:any)=>v.dispatch_at!==null).length,openTurns:turns.filter((v:any)=>v.state==='open').length,guardPending:calls.filter((v:any)=>['reserved','dispatched','settling'].includes(v.state)).length,guardUnknown:calls.filter((v:any)=>v.state==='unknown').length,unconfirmedStarts:tasks.filter((v:any)=>v.start_at!==null&&v.start_confirmed===0).length},money:{guardAccountedNanodollars:calls.reduce((n:number,v:any)=>n+(Number.isSafeInteger(v.accounted)?v.accounted:0),0),guardMaxTurnNanodollars:Math.max(0,...byTurn.values())},completeLedgers:false};
}

export function createG5OperatorHandler(){return {async fetch(request:Request,env:Env):Promise<Response>{
 try{
  const url=new URL(request.url);if(request.method!=='POST'||url.pathname!=='/operate'||url.search||url.hash)return fail(404,'not-found');
  if(!validSecret(env.G5_OPERATOR_CAPABILITY))return fail(503,'operator-unconfigured');
  const auth=request.headers.get('authorization');if(!auth?.startsWith('Bearer ')||!await sameSecret(auth.slice(7),env.G5_OPERATOR_CAPABILITY))return fail(404,'not-found');
  const input=await body(request);if(!exact(input,['action','windowId',...(input?.action==='close'?['expectedSnapshotSha256','confirmation']:[])]))return fail(400,'input-invalid');
  if(typeof input.windowId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(input.windowId))return fail(400,'window-invalid');
  const guard=env.G5_WINDOW_GUARD.getByName(G5_GLOBAL_ACTOR),before=await guard.snapshot(),summary=summarize(before),snapshotSha256=await digest(before);
  if(summary.windowId!==input.windowId)return fail(409,'window-conflict');
  if(input.action==='snapshot')return json({ok:true,snapshotSha256,summary});
  if(input.action!=='close'||request.headers.get('x-g5-mutation')!=='close-admission'||input.confirmation!=='close-existing-window'||typeof input.expectedSnapshotSha256!=='string'||input.expectedSnapshotSha256!==snapshotSha256)return fail(409,'close-precondition-failed');
  if(summary.startedAt===null)return fail(409,'window-not-started');
  const acknowledgement=await guard.closeAdmission(),afterRaw=await guard.snapshot(),after=summarize(afterRaw);
  if(acknowledgement?.closed!==true||after.windowId!==input.windowId||after.closed!==true)return fail(503,'close-readback-unconfirmed');
  return json({ok:true,closed:true,windowId:input.windowId,beforeSnapshotSha256:snapshotSha256,afterSnapshotSha256:await digest(afterRaw),summary:after});
 }catch{return fail(503,'operator-unavailable');}
}};}

export default createG5OperatorHandler();
