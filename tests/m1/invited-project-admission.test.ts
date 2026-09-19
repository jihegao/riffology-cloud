import test from 'node:test';
import assert from 'node:assert/strict';
import {Admission,type VerifiedIdentity} from '../../services/catalog/admission.ts';
import {OperatorCatalog} from '../../services/catalog/admin.ts';
import {acceptedInvitationProjectAdmission,INVITED_PROJECT_POLICY_VERSION} from '../../services/catalog/project-admission.ts';
import {gateway} from '../../services/gateway/app.ts';
import {HttpError} from '../../services/gateway/http.ts';
import {SqliteCatalog} from './sqlite-database.ts';

const origin='https://invited-project.test';

async function acceptedFixture(){
  const db=new SqliteCatalog(),now=Date.now();db.seed('operator');
  db.sqlite.prepare(`INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES ('operator','operator','active',?,?)`).run(now,now);
  const admin=new OperatorCatalog(db),issued=await admin.issue({userId:'operator',authVersion:1},'invite-user',{email:'invited@example.test',expiresInDays:7});
  const identity:VerifiedIdentity={subject:'auth-invited',email:'invited@example.test',emailVerified:true,platformVersion:1};
  const admission=new Admission(db),{tenantId}=await admission.accept(identity,issued.token!),principal=await admission.principal(identity);
  return {db,identity,principal,tenantId,invitationId:issued.invitation.id};
}

test('accepted operator invitation resolves only under the independent project flag',async()=>{
  const f=await acceptedFixture();
  try{
    assert.equal(await acceptedInvitationProjectAdmission(f.db,undefined,f.principal,f.tenantId),null);
    assert.equal(await acceptedInvitationProjectAdmission(f.db,'false',f.principal,f.tenantId),null);
    assert.deepEqual(await acceptedInvitationProjectAdmission(f.db,'true',f.principal,f.tenantId),{
      kind:'accepted-invitation',invitationId:f.invitationId,policyVersion:INVITED_PROJECT_POLICY_VERSION,
    });
    f.db.seed('foreign');
    assert.equal(await acceptedInvitationProjectAdmission(f.db,'true',f.principal,'tenant-foreign'),null);
  }finally{f.db.sqlite.close();}
});

test('pending, expired, revoked and non-operator invitations never grant project admission',async()=>{
  const db=new SqliteCatalog(),now=Date.now();db.seed('operator');db.seed('owner');
  try{
    db.sqlite.prepare(`INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES ('operator','operator','active',?,?)`).run(now,now);
    const admin=new OperatorCatalog(db),pending=await admin.issue({userId:'operator',authVersion:1},'pending',{email:'pending@example.test',expiresInDays:1});
    assert.equal(await acceptedInvitationProjectAdmission(db,'true',{userId:'owner',authVersion:1},'tenant-owner'),null);
    await admin.revoke({userId:'operator',authVersion:1},pending.invitation.id,{});
    assert.equal(await acceptedInvitationProjectAdmission(db,'true',{userId:'owner',authVersion:1},'tenant-owner'),null);
    db.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,state,issued_by,created_at,expires_at)
      VALUES ('expired-invite',?,'expired@example.test','pending','operator',?,?)`).run('e'.repeat(64),now-2_000,now-1_000);
    assert.equal(await acceptedInvitationProjectAdmission(db,'true',{userId:'owner',authVersion:1},'tenant-owner'),null);
    db.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,state,created_at,expires_at)
      VALUES ('unissued',?,'owner@example.test','pending',?,?)`).run('f'.repeat(64),now,now+60_000);
    db.sqlite.prepare(`UPDATE catalog_invitations SET state='accepted',accepted_by='owner',accepted_at=? WHERE id='unissued'`).run(now+1);
    assert.equal(await acceptedInvitationProjectAdmission(db,'true',{userId:'owner',authVersion:1},'tenant-owner'),null);
  }finally{db.sqlite.close();}
});

test('current user, auth version, membership and Tenant status are fail-closed',async()=>{
  const f=await acceptedFixture();
  try{
    f.db.sqlite.prepare("UPDATE catalog_users SET status='revoked' WHERE id=?").run(f.principal.userId);
    assert.equal(await acceptedInvitationProjectAdmission(f.db,'true',f.principal,f.tenantId),null);
    f.db.sqlite.prepare("UPDATE catalog_users SET status='active',auth_version=2 WHERE id=?").run(f.principal.userId);
    assert.equal(await acceptedInvitationProjectAdmission(f.db,'true',f.principal,f.tenantId),null);
    const current={...f.principal,authVersion:2};
    f.db.sqlite.prepare("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id=?").run(f.tenantId);
    assert.equal(await acceptedInvitationProjectAdmission(f.db,'true',current,f.tenantId),null);
    f.db.sqlite.exec("UPDATE catalog_memberships SET status='active'");
    f.db.sqlite.prepare("UPDATE catalog_tenants SET status='suspended' WHERE id=?").run(f.tenantId);
    assert.equal(await acceptedInvitationProjectAdmission(f.db,'true',current,f.tenantId),null);
  }finally{f.db.sqlite.close();}
});

test('invited project uses ordinary idempotency, has no budget route and writes scoped policy audit',async()=>{
  const f=await acceptedFixture();let enabled:unknown='true',fallbackCalls=0;
  try{
    const services={origin,database:f.db,identity:async()=>f.identity,admitProject:async(principal:typeof f.principal,tenantId:string)=>{
      const admission=await acceptedInvitationProjectAdmission(f.db,enabled,principal,tenantId);
      if(admission)return {projectAdmission:admission};
      fallbackCalls++;throw new HttpError('g5_admission_disabled',409);
    }};
    const request=(key='create-one')=>gateway(new Request(`${origin}/api/tenants/${f.tenantId}/projects`,{method:'POST',headers:{origin,'content-type':'application/json','idempotency-key':key},body:JSON.stringify({title:'Invited project',starterVersion:'blank-v1'})}),services);
    const first=await request();assert.equal(first.status,202);const value=await first.json() as {project:{id:string};replayed:boolean};assert.equal(value.replayed,false);
    const replay=await request();assert.equal(replay.status,200);assert.equal((await replay.json() as {replayed:boolean}).replayed,true);
    assert.equal(f.db.count('catalog_projects'),1);assert.equal(f.db.count('catalog_workspaces'),1);assert.equal(f.db.count('catalog_outbox'),1);
    assert.equal(f.db.count('catalog_project_budget_routes'),0);assert.equal(fallbackCalls,0);
    const audit=f.db.sqlite.prepare("SELECT actor_user_id,tenant_id,target_id,reason_code,request_id,outcome FROM catalog_audit_log WHERE action='project.admission'").get()!;
    assert.deepEqual({...audit},{actor_user_id:f.principal.userId,tenant_id:f.tenantId,target_id:value.project.id,reason_code:INVITED_PROJECT_POLICY_VERSION,request_id:f.invitationId,outcome:'completed'});
    enabled='false';assert.equal((await request('create-two')).status,409);assert.equal(fallbackCalls,1);assert.equal(f.db.count('catalog_projects'),1);
  }finally{f.db.sqlite.close();}
});

test('invited admission identity is immutable across an idempotent replay',async()=>{
  const f=await acceptedFixture();
  try{
    const catalog=(await import('../../services/catalog/projects.ts')).ProjectCatalog;
    const projects=new catalog(f.db,new Set(['blank-v1'])),body={title:'Audit identity',starterVersion:'blank-v1'};
    const admission=(await acceptedInvitationProjectAdmission(f.db,'true',f.principal,f.tenantId))!;
    await projects.create(f.principal,f.tenantId,'same-key',body,undefined,admission);
    await assert.rejects(projects.create(f.principal,f.tenantId,'same-key',body),{message:'idempotency_conflict'});
    await assert.rejects(projects.create(f.principal,f.tenantId,'same-key',body,undefined,{...admission,invitationId:'forged'}),{message:'idempotency_conflict'});
  }finally{f.db.sqlite.close();}
});

test('project creation rechecks the admitted invitation identity atomically',async()=>{
  const f=await acceptedFixture();
  try{
    const {ProjectCatalog}=await import('../../services/catalog/projects.ts');
    const projects=new ProjectCatalog(f.db,new Set(['blank-v1']));
    const admission=(await acceptedInvitationProjectAdmission(f.db,'true',f.principal,f.tenantId))!;
    const admin=new OperatorCatalog(f.db),issued=await admin.issue({userId:'operator',authVersion:1},'other-invite',{email:'other@example.test',expiresInDays:7});
    const otherIdentity:VerifiedIdentity={subject:'auth-other',email:'other@example.test',emailVerified:true,platformVersion:1};
    await new Admission(f.db).accept(otherIdentity,issued.token!);
    await assert.rejects(projects.create(f.principal,f.tenantId,'wrong-invitation',{title:'Must not exist',starterVersion:'blank-v1'},undefined,{...admission,invitationId:issued.invitation.id}),{message:'not_found'});
    assert.equal(f.db.count('catalog_projects'),0);
    assert.equal((f.db.sqlite.prepare("SELECT count(*) AS n FROM catalog_audit_log WHERE action='project.admission'").get() as {n:number}).n,0);
  }finally{f.db.sqlite.close();}
});
