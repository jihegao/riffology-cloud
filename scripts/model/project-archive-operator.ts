/** Temporary deployment-only metadata operator; never import into the Gateway.
 * Bind the existing Catalog/Workspace namespace, freeze a short private scope,
 * retain every request key, and remove the Worker after independent readback. */
import {ProjectArchives} from '../../services/catalog/project-archives.ts';
import {CatalogError,opaqueId,type Principal} from '../../services/catalog/contracts.ts';
import {catalogDatabase,type Database} from '../../services/catalog/database.ts';
import {createGatewayProjectArchives,type ProjectArchiveActor} from '../../services/gateway/project-archive-services.ts';
import {workspaceAgentName} from '../../services/workspace/protocol.ts';
import {turnDigest} from '../../services/turn/protocol.ts';
type Item={project_id:string;tenant_id:string;owner_user_id:string;workspace_id:string;generation:number;auth_version:number;created_at:number};
type Attempt={projectId:string;dryRunRequestKey:string;archiveRequestKey:string};
type Scope={schemaVersion:1;expiresAt:number;operator:Principal;cutoffAt:number;freezeRequestKey:string;manifest?:{id:string;digest:string;items:Item[];attempts:Attempt[]}};
type Env={PROJECT_ARCHIVE_OPERATOR_CAPABILITY:string;PROJECT_ARCHIVE_OPERATOR_SCOPE_JSON:string;CATALOG:D1Database;WORKSPACE_AGENT:{getByName(name:string):ProjectArchiveActor}};
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===[...keys].sort().join();
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const positive=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const itemKeys=['project_id','tenant_id','owner_user_id','workspace_id','generation','auth_version','created_at'];
const normalize=(v:Item)=>Object.fromEntries(itemKeys.map(k=>[k,v[k as keyof Item]]));
function expires(s:Scope){if(Date.now()>=s.expiresAt)throw Error('operator-scope-expired');}
function response(value:unknown,status=200){let text=JSON.stringify(value);if(new TextEncoder().encode(text).length>256*1024){status=503;text='{"ok":false,"error":"operator-response-limit"}';}return new Response(text,{status,headers:{'content-type':'application/json','cache-control':'no-store'}});}
const fail=(status:number,error:string)=>response({ok:false,error},status);
async function sameSecret(a:string,b:string){const [x,y]=await Promise.all([turnDigest(a),turnDigest(b)]);let n=0;for(let i=0;i<x.length;i++)n|=x.charCodeAt(i)^y.charCodeAt(i);return n===0;}
async function input(r:Request){const reader=r.body?.getReader();if(!reader)throw Error('operator-input-invalid');let length=0;const chunks:Uint8Array[]=[];try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>4096){await reader.cancel();throw Error('operator-input-invalid');}chunks.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
async function frozen(raw:string):Promise<Scope>{
 const s=JSON.parse(raw);
 if(!exact(s,['schemaVersion','expiresAt','operator','cutoffAt','freezeRequestKey',...(s?.manifest===undefined?[]:['manifest'])])||s.schemaVersion!==1||!Number.isSafeInteger(s.expiresAt)||Number(s.expiresAt)<=Date.now()||Number(s.expiresAt)>Date.now()+30*60_000||!exact(s.operator,['userId','authVersion'])||!positive(s.operator.authVersion)||!Number.isSafeInteger(s.cutoffAt)||Number(s.cutoffAt)<0||Number(s.cutoffAt)>Date.now())throw Error('operator-scope-invalid');
 opaqueId(s.operator.userId);opaqueId(s.freezeRequestKey);if(String(s.freezeRequestKey).length>120)throw Error('operator-scope-invalid');
 if(s.manifest!==undefined){const m=s.manifest;if(!exact(m,['id','digest','items','attempts'])||m.id!=='archive-'+s.freezeRequestKey||!hash(m.digest)||!Array.isArray(m.items)||m.items.length>1000||!Array.isArray(m.attempts)||m.attempts.length!==m.items.length)throw Error('operator-scope-invalid');
  const projects=new Set<string>(),keys=new Set<string>();for(let i=0;i<m.items.length;i++){const item=m.items[i],attempt=m.attempts[i];if(!exact(item,itemKeys)||!positive(item.generation)||!positive(item.auth_version)||!Number.isSafeInteger(item.created_at)||Number(item.created_at)<0||Number(item.created_at)>Number(s.cutoffAt)||!exact(attempt,['projectId','dryRunRequestKey','archiveRequestKey'])||attempt.projectId!==item.project_id)throw Error('operator-scope-invalid');for(const k of ['project_id','tenant_id','owner_user_id','workspace_id'])opaqueId(item[k]);for(const key of [attempt.dryRunRequestKey,attempt.archiveRequestKey]){const checked=opaqueId(key);if(keys.has(checked))throw Error('operator-scope-invalid');keys.add(checked);}if(projects.has(String(item.project_id))||i>0&&String(m.items[i-1].project_id)>=String(item.project_id))throw Error('operator-scope-invalid');projects.add(String(item.project_id));}
  if(await turnDigest({cutoffAt:s.cutoffAt,items:m.items.map(v=>normalize(v as Item))})!==m.digest)throw Error('operator-scope-invalid');
 }
 return s as Scope;
}
export default {async fetch(request:Request,env:Env){
 try{
  const url=new URL(request.url);if(request.method!=='POST'||url.pathname!=='/operate'||url.search||url.hash)return fail(404,'not-found');
  const capability=env.PROJECT_ARCHIVE_OPERATOR_CAPABILITY;if(typeof capability!=='string'||capability.length<48||capability.length>4096||/[\r\n]/.test(capability))return fail(503,'operator-unconfigured');
  const auth=request.headers.get('authorization');if(!auth?.startsWith('Bearer ')||auth.length>4103||!await sameSecret(auth.slice(7),capability))return fail(404,'not-found');
  const s=await frozen(env.PROJECT_ARCHIVE_OPERATOR_SCOPE_JSON),body=await input(request);expires(s);
  if(request.headers.get('content-type')!=='application/json'||!exact(body,['action','confirmation',...(['dry-run','archive'].includes(String(body?.action))?['projectId']:[])])||!['freeze','read-manifest','dry-run','archive'].includes(String(body.action)))return fail(400,'operator-input-invalid');
  const source=catalogDatabase(env.CATALOG),db:Database={query:q=>source.query(q),batch:batch=>{expires(s);return source.batch(batch);}},archives=new ProjectArchives(db);
  if(body.action==='freeze'){
   if(s.manifest||body.confirmation!=='freeze-invited-project-metadata'||request.headers.get('x-project-archive-mutation')!==s.freezeRequestKey)return fail(409,'operator-mutation-denied');
   const manifest=await archives.freeze(s.operator,s.cutoffAt,s.freezeRequestKey);expires(s);return response({ok:true,manifest});
  }
  const m=s.manifest;if(!m||request.headers.get('x-project-archive-mutation')!==m.digest)return fail(409,'operator-mutation-denied');
  const confirmation=body.action==='read-manifest'?'read-frozen-project-metadata':body.action==='dry-run'?'check-frozen-project-archive':'archive-frozen-project';if(body.confirmation!==confirmation)return fail(409,'operator-mutation-denied');
  const manifest=await archives.manifest(s.operator,m.id);expires(s);
  if(manifest.cutoff_at!==s.cutoffAt||manifest.digest!==m.digest||!same(manifest.items.map(normalize),m.items.map(normalize)))return fail(409,'operator-manifest-conflict');
  if(body.action==='read-manifest')return response({ok:true,manifest});
  const at=m.items.findIndex(item=>item.project_id===body.projectId);if(at<0)return fail(409,'operator-item-denied');const item=m.items[at]!,attempt=m.attempts[at]!,actorName=workspaceAgentName(item.tenant_id,item.workspace_id);
  const namespace={getByName(name:string):ProjectArchiveActor{if(name!==actorName)throw Error('operator-item-denied');const original=env.WORKSPACE_AGENT.getByName(name);return {async prepareProjectArchive(value){expires(s);const result=await original.prepareProjectArchive(value);expires(s);return result;},async finishProjectArchive(value){expires(s);await original.finishProjectArchive(value);},abortProjectArchive:value=>original.abortProjectArchive(value)};}};
  expires(s);const acknowledgement=await createGatewayProjectArchives(archives,namespace).transition(s.operator,item.tenant_id,item.project_id,'archive',body.action==='dry-run'?attempt.dryRunRequestKey:attempt.archiveRequestKey,m.id,body.action==='dry-run');expires(s);
  return response({ok:true,acknowledgement});
 }catch(error){const code=error instanceof Error?error.message:'';return fail(error instanceof CatalogError?409:503,/^operator-[a-z0-9-]{1,96}$/.test(code)?code:error instanceof CatalogError?error.message:'operator-unavailable');}
}};
