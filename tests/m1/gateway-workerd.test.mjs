import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {serializeSignedCookie} from 'better-call';
import {createAuth} from '../../services/gateway/auth.ts';
import {SqliteCatalog} from './sqlite-database.ts';
import {digest} from '../../services/catalog/contracts.ts';
import {workspaceAgentName} from '../../services/workspace/protocol.ts';

test('actual gateway starts in Workerd with D1 and rejects unauthenticated callers', {timeout:45000}, async()=>{
  const bundle=await build({entryPoints:['services/gateway/index.ts'],bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
  const env={CATALOG:{type:'d1',id:'gateway-test',name:'gateway-test'},APP_ORIGIN:{type:'text',value:'https://gateway-local.test'},BETTER_AUTH_SECRET:{type:'text',value:'local-workerd-fixture-secret-00000000000000000'},GOOGLE_CLIENT_ID:{type:'text',value:'local-fixture'},GOOGLE_CLIENT_SECRET:{type:'text',value:'local-fixture'},TENANT_QUOTA_CAPACITY:{type:'text',value:'1'},TENANT_QUOTA_POLICY_VERSION:{type:'text',value:'m1-v1'},INVITED_PROJECT_ADMISSION_ENABLED:{type:'text',value:'true'},G5_CONTROLLED_WINDOW_JSON:{type:'text',value:'{}'},G5_ADMISSION_ENABLED:{type:'text',value:'false'},TENANT_QUOTA:{type:'durable-object',worker:'gateway-test',exportName:'TenantQuota'}};
  env.WORKSPACE_AGENT={type:'durable-object',worker:'gateway-test',exportName:'WorkspaceAgent'};
  env.MODEL_CONTENT={type:'r2',name:'gateway-test-models'};
  env.PROJECT_RUNTIME={type:'durable-object',worker:'gateway-test',exportName:'ProjectRuntime'};
  const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},workers:[{config:{type:'worker',name:'gateway-test',compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env'],manifest:{mainModule:'gateway.mjs',modules:{'gateway.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env,exports:{TenantQuota:{type:'durable-object',storage:'sqlite'},WorkspaceAgent:{type:'durable-object',storage:'sqlite'},ProjectRuntime:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('outbound-disabled',{status:403})}}}]});
  try{
    await mf.ready;const db=await mf.getD1Database('CATALOG','gateway-test');
    const authSchema=await readFile('services/catalog/migrations/0002_auth.sql','utf8');
    for(const filename of ['0001_catalog.sql','0002_auth.sql','0003_provisioning.sql','0004_operator_invitations.sql','0005_initial_operator.sql','0006_model_catalog.sql','0007_model_content_checks.sql','0010_project_budget_routes.sql','0012_project_archives.sql']){
      const schema=(await readFile(`services/catalog/migrations/${filename}`,'utf8')).replace(/--[^\n]*/g,'');
      const statements=schema.match(/\s*CREATE\s+TRIGGER[\s\S]*?\bEND\s*;|[^;]+;/gi)||[];
      for(const statement of statements)await db.prepare(statement.trim()).run();
    }
    const missing=await mf.dispatchFetch('https://gateway-local.test/api/me');assert.equal(missing.status,401);
    const forged=await mf.dispatchFetch('https://gateway-local.test/api/me',{headers:{cookie:'riffology.session_token=forged'}});assert.equal(forged.status,401);
    const signedOut=await mf.dispatchFetch('https://gateway-local.test/api/auth/get-session');assert.equal(signedOut.status,200);assert.equal(await signedOut.json(),null);
    const cross=await mf.dispatchFetch('https://gateway-local.test/api/auth/sign-out',{method:'POST',headers:{origin:'https://attacker.test','content-type':'application/json'},body:'{}'});assert.equal(cross.status,403);
    // Fixture identity is created by the actual auth library locally, then its
    // ordinary DB records are copied into test D1. There is no public auth bypass
    // and this does not claim that Google OAuth has been exercised.
    const fixture=new SqliteCatalog();
    try{
      fixture.sqlite.exec(authSchema);const now=Date.now(),token='e'.repeat(64);
      fixture.sqlite.prepare(`INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES ('issuer','test-only','issuer','issuer@example.test',?,?)`).run(now,now);
      fixture.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,issued_by,created_at,expires_at) VALUES ('workerd-invite',?,'workerd@example.test','issuer',?,?)`).run(await digest(token),now,now+60000);
      const auth=createAuth({database:fixture.sqlite,catalog:fixture,origin:'https://gateway-local.test',secret:env.BETTER_AUTH_SECRET.value,googleClientId:'local-fixture',googleClientSecret:'local-fixture'});
      const context=await auth.$context;
      const user=await context.internalAdapter.createUser({name:'Fixture',email:'workerd@example.test',emailVerified:true},{method:'oauth',oauth:{providerId:'google'}});
      const session=await context.internalAdapter.createSession(user.id);
      for(const table of ['catalog_users','auth_user','auth_session','catalog_invitations'])for(const row of fixture.sqlite.prepare(`SELECT * FROM ${table}`).all()){
        const keys=Object.keys(row);await db.prepare(`INSERT INTO ${table} (${keys.map(key=>`"${key}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).bind(...keys.map(key=>row[key])).run();
      }
      const cookie=(await serializeSignedCookie(context.authCookies.sessionToken.name,session.token,env.BETTER_AUTH_SECRET.value)).split(';')[0];
      const headers={cookie,origin:'https://gateway-local.test','content-type':'application/json'};
      const accepted=await mf.dispatchFetch('https://gateway-local.test/api/invitations/accept',{method:'POST',headers,body:JSON.stringify({token})});assert.equal(accepted.status,200);
      const {tenantId}=await accepted.json();
      const owner=await db.prepare('SELECT owner_user_id FROM catalog_tenants WHERE id=?').bind(tenantId).first();
      await db.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES (?,'operator','active',?,?)").bind(owner.owner_user_id,now,now).run();
      const modelSource='print("official")\n',packageText=JSON.stringify({schemaVersion:1,files:[{path:'model/main.py',bytes:new TextEncoder().encode(modelSource).length,sha256:await digest(modelSource),contentBase64:Buffer.from(modelSource).toString('base64')}]});
      const modelBody={modelId:'workerd-model',version:'1',title:'Verified official model',description:'Local storage verification',starterVersion:'blank-v1',contentRef:'workerd-model/1.json',contentSha256:await digest(packageText)};
      const modelRequest=async(path,key,body={})=>mf.dispatchFetch('https://gateway-local.test'+path,{method:'POST',headers:{...headers,'idempotency-key':key},body:JSON.stringify(body)});
      const draftResponse=await modelRequest('/api/admin/models','workerd-model-create',modelBody);assert.equal(draftResponse.status,201);const draft=await draftResponse.json();
      const path='/api/admin/models/'+draft.id;
      assert.equal((await modelRequest(path+'/validate','workerd-model-validate')).status,409,'missing package cannot validate');
      const bucket=await mf.getR2Bucket('MODEL_CONTENT','gateway-test'),objectKey='model-content/'+modelBody.contentRef;
      const upload=async(body)=>mf.dispatchFetch('https://gateway-local.test'+path+'/content',{method:'POST',headers:{...headers,'idempotency-key':'workerd-model-upload'},body});
      assert.equal((await upload('{}')).status,409,'wrong digest cannot upload');
      assert.equal(await bucket.get(objectKey),null);
      assert.equal((await upload(packageText)).status,200);
      assert.equal(await (await bucket.get(objectKey)).text(),packageText);
      const uploadReplay=await upload(packageText);assert.equal(uploadReplay.status,200);assert.equal((await uploadReplay.json()).replayed,true);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM catalog_model_audit_log WHERE action='model.uploaded'").first()).n,1);

      assert.equal((await modelRequest(path+'/validate','workerd-model-validate')).status,200);
      await bucket.delete(objectKey);
      assert.equal((await modelRequest(path+'/publish','workerd-model-publish')).status,409,'published requires bytes still matching');
      await bucket.put(objectKey,packageText);
      assert.equal((await modelRequest(path+'/publish','workerd-model-publish')).status,200);
      await bucket.delete(objectKey);
      const publicationReplay=await modelRequest(path+'/publish','workerd-model-publish');assert.equal(publicationReplay.status,200);assert.equal((await publicationReplay.json()).replayed,true);
      assert.equal((await db.prepare('SELECT count(*) AS n FROM catalog_model_content_checks').first()).n,1);
      const create=await mf.dispatchFetch(`https://gateway-local.test/api/tenants/${tenantId}/projects`,{method:'POST',headers:{...headers,'idempotency-key':'workerd-create'},body:JSON.stringify({title:'Real durable acceptance',starterVersion:'blank-v1'})});
      const createBody=await create.text();assert.equal(create.status,202,createBody);const {project}=JSON.parse(createBody);assert.equal(project.status,'provisioning');
      assert.equal((await db.prepare('SELECT count(*) AS n FROM catalog_project_budget_routes').first()).n,0);
      const admissionAudit=await db.prepare("SELECT actor_user_id,tenant_id,target_id,reason_code,request_id,outcome FROM catalog_audit_log WHERE action='project.admission'").first();
      assert.equal(admissionAudit.actor_user_id,owner.owner_user_id);assert.equal(admissionAudit.tenant_id,tenantId);assert.equal(admissionAudit.target_id,project.id);
      assert.equal(admissionAudit.reason_code,'accepted-invitation-project-v1');assert.equal(admissionAudit.request_id,'workerd-invite');assert.equal(admissionAudit.outcome,'completed');
      const outbox=await db.prepare('SELECT * FROM catalog_outbox WHERE project_id=?').bind(project.id).first();assert.equal(outbox.state,'processing');assert.equal(outbox.actor_auth_version,1);
      const namespace=await mf.getDurableObjectNamespace('WORKSPACE_AGENT','gateway-test');
      const task={id:outbox.id,tenantId,projectId:project.id,workspaceId:project.workspace_id,generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:outbox.created_at,deadlineAt:outbox.deadline_at};
      const state=await namespace.get(namespace.idFromName(workspaceAgentName(tenantId,project.workspace_id))).report(task);
      assert.equal(state.task.id,outbox.id);assert.equal(state.task.authVersion,1);assert.ok(state.wakeAt);assert.equal(state.runtimeReceipt,null);
      const forbidden=await mf.dispatchFetch('https://gateway-local.test/api/runtime/initialize',{method:'POST',headers,body:'{}'});assert.equal(forbidden.status,404);
    }finally{fixture.sqlite.close();}
  }finally{await mf.dispose();}
});
