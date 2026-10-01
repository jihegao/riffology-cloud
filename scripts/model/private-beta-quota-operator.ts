/** Temporary deployment-only operator. Never import into the product Gateway.
 * Freeze its scope in a private local config, use a separate capability secret,
 * and remove this Worker after independent migration readback. No resume,
 * replay, provider, tool, project or ledger-edit binding exists. */
import {PRIVATE_BETA_CAPACITY_ACTOR,privateBetaPolicy} from '../../services/model-budget/private-beta-policy.ts';
import {turnDigest,type TurnActor} from '../../services/turn/protocol.ts';
import type {PrivateBetaCapacity} from '../../services/model-budget/private-beta-capacity.ts';
type Scope={schemaVersion:1;actor:typeof PRIVATE_BETA_CAPACITY_ACTOR;expiresAt:number;operator:TurnActor;policySha256s:[string,string];migration?:{previousPolicy:unknown;expectedPolicySha256:string;expectedLedgerSha256:string}};
type Env={PRIVATE_BETA_QUOTA_OPERATOR_CAPABILITY:string;PRIVATE_BETA_QUOTA_OPERATOR_SCOPE_JSON:string;PRIVATE_BETA_CAPACITY:DurableObjectNamespace<PrivateBetaCapacity>};
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const fail=(status:number,error:string)=>response({ok:false,error},status);
async function sameSecret(a:string,b:string){const [x,y]=await Promise.all([turnDigest(a),turnDigest(b)]);let n=0;for(let i=0;i<x.length;i++)n|=x.charCodeAt(i)^y.charCodeAt(i);return n===0;}
async function body(r:Request){const reader=r.body?.getReader();if(!reader)throw Error('operator-input-invalid');let length=0;const chunks:Uint8Array[]=[];try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>4096){await reader.cancel();throw Error('operator-input-invalid');}chunks.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
async function scope(raw:string):Promise<Scope>{
 const s=JSON.parse(raw);
 if(!exact(s,['schemaVersion','actor','expiresAt','operator','policySha256s',...(s.migration===undefined?[]:['migration'])])||s.schemaVersion!==1||s.actor!==PRIVATE_BETA_CAPACITY_ACTOR||!Number.isSafeInteger(s.expiresAt)||Number(s.expiresAt)<=Date.now()||Number(s.expiresAt)>Date.now()+30*60_000||!exact(s.operator,['userId','authVersion'])||typeof s.operator.userId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(s.operator.userId)||!Number.isSafeInteger(s.operator.authVersion)||Number(s.operator.authVersion)<1||!Array.isArray(s.policySha256s)||s.policySha256s.length!==2||!s.policySha256s.every(hash)||s.policySha256s[0]===s.policySha256s[1])throw Error('operator-scope-invalid');
 if(s.migration!==undefined){
  const m=s.migration;
  if(!exact(m,['previousPolicy','expectedPolicySha256','expectedLedgerSha256'])||!hash(m.expectedLedgerSha256)||m.expectedPolicySha256!==s.policySha256s[0])throw Error('operator-scope-invalid');
  const previous=privateBetaPolicy(m.previousPolicy);if(previous?.schemaVersion!==1||await turnDigest({...previous,enabled:false})!==m.expectedPolicySha256)throw Error('operator-scope-invalid');
 }
 return s as Scope;
}
export default {async fetch(request:Request,env:Env){
 try{
  const url=new URL(request.url);if(request.method!=='POST'||url.pathname!=='/operate'||url.search||url.hash)return fail(404,'not-found');
  const capability=env.PRIVATE_BETA_QUOTA_OPERATOR_CAPABILITY;
  if(typeof capability!=='string'||capability.length<48||capability.length>4096||/[\r\n]/.test(capability))return fail(503,'operator-unconfigured');
  const auth=request.headers.get('authorization');if(!auth?.startsWith('Bearer ')||auth.length>4103||!await sameSecret(auth.slice(7),capability))return fail(404,'not-found');
  const frozen=await scope(env.PRIVATE_BETA_QUOTA_OPERATOR_SCOPE_JSON),input=await body(request);
  if(!exact(input,['action',...(input?.action==='snapshot'?[]:['confirmation'])])||!['snapshot','pause','remove-quotas'].includes(String(input.action)))return fail(400,'operator-input-invalid');
  const cap=env.PRIVATE_BETA_CAPACITY.getByName(PRIVATE_BETA_CAPACITY_ACTOR);
  const state=await cap.migrationState(),snapshot=await cap.snapshot();
  if(state.actor!==frozen.actor||state.pinnedPolicySha256!==snapshot.pinnedPolicySha256||!frozen.policySha256s.includes(snapshot.policySha256)||!snapshot.pinnedPolicySha256||!frozen.policySha256s.includes(snapshot.pinnedPolicySha256))return fail(409,'operator-policy-conflict');
  if(Date.now()>=frozen.expiresAt)return fail(409,'operator-scope-expired');
  if(input.action==='snapshot')return response({ok:true,state,snapshot});
  if(input.action==='pause'){
   if(input.confirmation!=='pause-original-pool'||request.headers.get('x-beta-mutation')!=='pause')return fail(409,'operator-mutation-denied');
   return response({ok:true,acknowledgement:await cap.pause(frozen.operator)});
  }
  if(!frozen.migration||input.confirmation!=='remove-only-call-fee-quotas'||request.headers.get('x-beta-mutation')!==frozen.policySha256s[1]||snapshot.policySha256!==frozen.policySha256s[1]||snapshot.paused!==true||state.paused!==true)return fail(409,'operator-mutation-denied');
  const acknowledgement=await cap.removeQuotas(frozen.migration,frozen.operator);
  if(acknowledgement.policySha256!==frozen.policySha256s[1])return fail(503,'operator-readback-unconfirmed');
  return response({ok:true,acknowledgement});
 }catch(error){const code=error instanceof Error?error.message:'';return fail(503,/^(private-beta|operator)-[a-z0-9-]{1,96}$/.test(code)?code:'operator-unavailable');}
}};
