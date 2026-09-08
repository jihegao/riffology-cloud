import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { serializeSignedCookie } from 'better-call';
import { createAuth } from '../../services/gateway/auth.ts';
import { SqliteCatalog } from '../../tests/m1/sqlite-database.ts';
import { digest } from '../../services/catalog/contracts.ts';
import { workspaceAgentName } from '../../services/workspace/protocol.ts';
import { checkpointKey } from '../../services/runtime/core.ts';
import { initialCheckpoint } from '../../services/runtime/starter.ts';
import { modelContentKey } from '../../services/runtime/content.ts';
import { buildModelPackage } from './model-package.mjs';
import { sourceSnapshot } from '../m0/source-inventory.mjs';

// Real local Workerd, native Docker, SQLite DO, D1, R2. Authentication uses a
// fixture library session in an isolated database, never Google or a public bypass.
const root=process.cwd(),runId=`m1-workspace-${new Date().toISOString().replace(/[^0-9]/g,'')}`;
const directory=resolve('docs/evidence/runs',runId),stateDirectory=resolve('.local',runId);
mkdirSync(directory,{recursive:false});mkdirSync(stateDirectory,{recursive:false});
const origin='https://workspace-local.test',worker=runId,image='riffology-m0-project:20260905T155750Z-167375ff';
const proxyImage='cloudflare/proxy-everything@sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8';
const docker=(...args)=>execFileSync('docker',['--context','colima-riffology-m0',...args],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}).trim();
async function bounded(actual,ms){let timer;try{return await Promise.race([actual,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('local-probe-deadline')),ms);})]);}finally{clearTimeout(timer);}}
const beforeIds=new Set(docker('ps','-aq').split('\n').filter(Boolean));
const result={runId,status:'running',scope:'local Workerd + native Docker + D1/DO/R2; fixture session; no Google/cloud/provider calls',sourceBefore:sourceSnapshot(root),observations:[],cleanup:[]};
const secret=crypto.randomUUID()+crypto.randomUUID();let mf,failed;
try{
 result.imageId=docker('image','inspect',image,'--format','{{.Id}}');
 assert.equal(docker('image','inspect',proxyImage,'--format','{{.Id}}'),'sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8');
 const modelSource=resolve(stateDirectory,'official-model-source');mkdirSync(resolve(modelSource,'model'),{recursive:true});mkdirSync(resolve(modelSource,'docs'),{recursive:true});
 writeFileSync(resolve(modelSource,'model','main.py'),'def describe():\n    return "official queue model"\n',{flag:'wx'});
 writeFileSync(resolve(modelSource,'docs','README.md'),'# Official queue model\n',{flag:'wx'});
 const packagePath=resolve(stateDirectory,'official-model.json'),modelPackage=await buildModelPackage(modelSource,packagePath);
 result.modelPackage={bytes:modelPackage.bytes,sha256:modelPackage.sha256,fileCount:modelPackage.fileCount,contentBytes:modelPackage.contentBytes};
 const wrapper=`import gateway from './services/gateway/index.ts';
export {TenantQuota,WorkspaceAgent,ProjectRuntime} from './services/gateway/index.ts';
import {workspaceAgentName} from './services/workspace/protocol.ts';
export default {async fetch(request,env,ctx){
 if(new URL(request.url).pathname==='/__fixture/report'){
  const task=await request.json();const state=await env.WORKSPACE_AGENT.getByName(workspaceAgentName(task.tenantId,task.workspaceId)).report(task);
  return Response.json(state);
 }
 return gateway.fetch(request,env,ctx);
}};`;
 const bundle=await build({stdin:{contents:wrapper,resolveDir:root,sourcefile:'local-only-fixture.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const binding=name=>({type:'durable-object',worker,exportName:name});const text=value=>({type:'text',value});
 mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},resourcePersistencePath:stateDirectory,
  containerEngine:{localDocker:{socketPath:'unix:///Users/gaojihe/.colima/riffology-m0/docker.sock',containerEgressInterceptorImage:proxyImage}},
  workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env'],
   manifest:{mainModule:'gateway.mjs',modules:{'gateway.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},
   env:{CATALOG:{type:'d1',id:runId,name:runId},WORKSPACE_CHECKPOINTS:{type:'r2',name:runId},MODEL_CONTENT:{type:'r2',name:runId+'-model-content'},
    APP_ORIGIN:text(origin),BETTER_AUTH_SECRET:text(secret),GOOGLE_CLIENT_ID:text('fixture-only'),GOOGLE_CLIENT_SECRET:text('fixture-only'),
    TENANT_QUOTA_CAPACITY:text('1'),TENANT_QUOTA_POLICY_VERSION:text('m1-v1'),TENANT_QUOTA:binding('TenantQuota'),WORKSPACE_AGENT:binding('WorkspaceAgent'),PROJECT_RUNTIME:binding('ProjectRuntime')},
   exports:{TenantQuota:{type:'durable-object',storage:'sqlite'},WorkspaceAgent:{type:'durable-object',storage:'sqlite'},ProjectRuntime:{type:'durable-object',storage:'sqlite',container:{imageName:image}}}},
   dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('outbound-disabled',{status:403})}}}]});
 await mf.ready;const db=await mf.getD1Database('CATALOG',worker);
 for(const filename of ['0001_catalog.sql','0002_auth.sql','0003_provisioning.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql']){
  const schema=readFileSync(`services/catalog/migrations/${filename}`,'utf8').replace(/--[^\n]*/g,'');
  for(const statement of schema.match(/\s*CREATE\s+TRIGGER[\s\S]*?\bEND\s*;|[^;]+;/gi)||[])await db.prepare(statement.trim()).run();
 }
 const fixture=new SqliteCatalog(),now=Date.now();let cookie,token,userId,modelRef;
 try{
  fixture.sqlite.exec(readFileSync('services/catalog/migrations/0002_auth.sql','utf8'));token='f'.repeat(64);
  fixture.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES ('native-invite',?,'native@example.test',?,?)`).run(await digest(token),now,now+300000);
  const auth=createAuth({database:fixture.sqlite,catalog:fixture,origin,secret,googleClientId:'fixture-only',googleClientSecret:'fixture-only'}),context=await auth.$context;
  const user=await context.internalAdapter.createUser({name:'Native fixture',email:'native@example.test',emailVerified:true},{method:'oauth',oauth:{providerId:'google'}});
  userId=user.id;
  const session=await context.internalAdapter.createSession(user.id);
  for(const table of ['auth_user','auth_session','catalog_invitations'])for(const row of fixture.sqlite.prepare(`SELECT * FROM ${table}`).all()){
   const keys=Object.keys(row);await db.prepare(`INSERT INTO ${table} (${keys.map(key=>`"${key}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...keys.map(key=>row[key])).run();
  }
  cookie=(await serializeSignedCookie(context.authCookies.sessionToken.name,session.token,secret)).split(';')[0];
 }finally{fixture.sqlite.close();}
 const headers={cookie,origin,'content-type':'application/json'};
 const accepted=await mf.dispatchFetch(origin+'/api/invitations/accept',{method:'POST',headers,body:JSON.stringify({token})});assert.equal(accepted.status,200);
 const {tenantId}=await accepted.json();
 const catalogUser=await db.prepare('SELECT id FROM catalog_users WHERE identity_issuer=? AND identity_subject=?').bind('better-auth',userId).first();assert.ok(catalogUser?.id);
 modelRef={modelVersionId:'official-queue-version-1',modelId:'queue',version:'1.0.0',contentRef:'models/queue/1.0.0.json',contentSha256:modelPackage.sha256};
 await db.prepare(`INSERT INTO catalog_model_versions(id,model_id,version,status,title,description,starter_version,content_ref,content_sha256,last_transition_id,created_by,created_at,validated_at,published_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(modelRef.modelVersionId,modelRef.modelId,modelRef.version,'published','Official queue model','Local official package acceptance','blank-v1',modelRef.contentRef,modelRef.contentSha256,'local-publish',catalogUser.id,now,now,now).run();
 const modelBucket=await mf.getR2Bucket('MODEL_CONTENT',worker);await modelBucket.put(modelContentKey(modelRef),readFileSync(packagePath),{httpMetadata:{contentType:'application/json'}});
 result.modelRef=modelRef;
 const created=await mf.dispatchFetch(`${origin}/api/tenants/${tenantId}/projects`,{method:'POST',headers:{...headers,'idempotency-key':'native-model-create'},body:JSON.stringify({title:'Official model initialization',modelId:'queue',modelVersion:'1.0.0'})});
 assert.equal(created.status,202);const {project}=await created.json();result.projectId=project.id;
 const row=await db.prepare('SELECT * FROM catalog_outbox WHERE project_id=?').bind(project.id).first();
 const task={id:row.id,tenantId,projectId:project.id,workspaceId:project.workspace_id,generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:row.created_at,deadlineAt:row.deadline_at};
 task.modelContent={modelVersionId:row.source_model_version_id,modelId:row.source_model_id,version:row.source_model_version,contentRef:row.source_content_ref,contentSha256:row.source_content_sha256};
 assert.deepEqual(task.modelContent,result.modelRef);
 const readState=async()=>{const response=await mf.dispatchFetch(origin+'/__fixture/report',{method:'POST',body:JSON.stringify(task)});return response.json();};
 let state;const deadline=Date.now()+90000;
 do{
  state=await bounded(readState(),10000);const view={phase:state.phase,reason:state.reasonCode,projection:state.projection?.outcome??null,confirmed:state.projectionConfirmed,calls:state.calls};
  if(JSON.stringify(result.observations.at(-1)?.state)!==JSON.stringify(view)){result.observations.push({at:new Date().toISOString(),state:view});console.log(JSON.stringify(view));}
  if(state.projectionConfirmed)break;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }while(Date.now()<deadline);
 result.finalState=structuredClone(state);
 assert.equal(state.projection?.outcome,'ready');assert.equal(state.projectionConfirmed,true);assert.equal(state.quotaReleased,true);assert.equal(state.stopReceipt.nativeRunning,false);
 const bucket=await mf.getR2Bucket('WORKSPACE_CHECKPOINTS',worker),artifact=await bucket.get(checkpointKey(state.identity));assert.ok(artifact);
 assert.equal(state.runtimeReceipt.modelContent.contentSha256,modelPackage.sha256);assert.equal(state.runtimeReceipt.modelContent.fileCount,2);assert.equal(state.runtimeReceipt.modelContent.contentBytes,modelPackage.contentBytes);
 const checkpoint=await initialCheckpoint({task,identity:state.identity,markerNonce:state.markerNonce},state.runtimeReceipt.modelContent);assert.equal(await artifact.text(),checkpoint.text);assert.equal(state.runtimeReceipt.checkpointRevision,checkpoint.revision);
 writeFileSync(resolve(directory,'checkpoint.json'),checkpoint.text,{flag:'wx'});
 assert.equal((await db.prepare('SELECT status FROM catalog_projects WHERE id=?').bind(project.id).first()).status,'ready');
 result.status='passed';
}catch(error){failed=error;result.status='failed';result.error=String(error.message).slice(0,3000);}
finally{
 if(mf)try{await mf.dispose();}catch(error){result.disposeError=String(error.message).slice(0,500);result.status='failed';failed??=error;}
 const ids=docker('ps','-aq').split('\n').filter(id=>id&&!beforeIds.has(id));
 for(const id of ids){
  const info=JSON.parse(docker('inspect',id))[0];
  if(![image,proxyImage].includes(info.Config.Image)){result.cleanup.push({id,unrelatedImage:true});continue;}
  docker('rm','-f',id);result.cleanup.push({id,image:info.Config.Image,removed:true});
 }
 result.sourceAfter=sourceSnapshot(root);result.sourceStable=result.sourceBefore.sha256===result.sourceAfter.sha256;
 writeFileSync(resolve(directory,'workspace-local.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({directory,status:result.status,error:result.error,cleanup:result.cleanup},null,2));
}
if(failed)process.exitCode=1;
