import test from 'node:test';
import assert from 'node:assert/strict';
import { OperatorCatalog } from '../../services/catalog/admin.ts';
import { digest, type Principal } from '../../services/catalog/contracts.ts';
import { SqliteCatalog } from './sqlite-database.ts';

const operator:Principal={userId:'operator',authVersion:1};
const owner:Principal={userId:'owner',authVersion:1};
function fixture(){
  const db=new SqliteCatalog();db.seed('owner');db.seed('operator');
  const now=Date.now();
  db.sqlite.prepare(`INSERT INTO catalog_platform_roles(user_id,role,status,granted_by,created_at,updated_at) VALUES (?,'operator','active',NULL,?,?)`).run(operator.userId,now,now);
  return {db,admin:new OperatorCatalog(db,()=>1_800_000_000_000)};
}

test('operator scope is independent from tenant ownership and is rechecked for every call',async()=>{
  const {db,admin}=fixture();
  try{
    for(const call of [()=>admin.overview(owner),()=>admin.tenants(owner),()=>admin.invitations(owner),()=>admin.audit(owner),()=>admin.issue(owner,'owner-key',{email:'x@example.test',expiresInDays:7})])await assert.rejects(call(),{message:'not_found'});
    assert.equal(db.count('catalog_operator_intents'),0);
    assert.equal((await admin.overview(operator)).tenants,2);
    db.sqlite.prepare("UPDATE catalog_platform_roles SET status='revoked',updated_at=? WHERE user_id=?").run(1_800_000_000_001,operator.userId);
    await assert.rejects(admin.overview(operator),{message:'not_found'});
    db.sqlite.prepare("UPDATE catalog_platform_roles SET status='active',updated_at=? WHERE user_id=?").run(1_800_000_000_002,operator.userId);
    db.sqlite.prepare("UPDATE catalog_users SET auth_version=2,updated_at=? WHERE id=?").run(1_800_000_000_003,operator.userId);
    await assert.rejects(admin.overview(operator),{message:'not_found'});
  }finally{db.sqlite.close();}
});

test('invitation issue stores only a token hash and preserves idempotent intent',async()=>{
  const {db,admin}=fixture();
  try{
    const created=await admin.issue(operator,'issue-a',{email:'  Alice@Example.Test ',expiresInDays:7});
    assert.match(created.token!,/^[0-9a-f]{64}$/);assert.equal(created.replayed,false);
    assert.equal(created.invitation.normalized_email,'alice@example.test');
    const stored=db.sqlite.prepare('SELECT token_hash,normalized_email FROM catalog_invitations WHERE id=?').get(created.invitation.id)!;
    assert.equal(stored.token_hash,await digest(created.token!));assert.equal(stored.normalized_email,'alice@example.test');
    assert.notEqual(stored.token_hash,created.token);
    const replay=await admin.issue(operator,'issue-a',{email:'alice@example.test',expiresInDays:7});
    assert.equal(replay.invitation.id,created.invitation.id);assert.equal(replay.replayed,true);assert.equal(replay.token,null);
    assert.equal(db.count('catalog_invitations'),1);assert.equal(db.count('catalog_operator_intents'),1);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action='invitation.issue'").get()!.n,1);
    await assert.rejects(admin.issue(operator,'issue-a',{email:'other@example.test',expiresInDays:7}),{message:'idempotency_conflict'});
  }finally{db.sqlite.close();}
});

test('concurrent issue and lost response create one invitation and do not reveal its token twice',async()=>{
  const {db,admin}=fixture();
  try{
    const results=await Promise.all(Array.from({length:12},()=>admin.issue(operator,'concurrent',{email:'same@example.test',expiresInDays:1})));
    assert.equal(new Set(results.map(result=>result.invitation.id)).size,1);
    assert.equal(results.filter(result=>result.token!==null).length,1);
    assert.equal(db.count('catalog_invitations'),1);assert.equal(db.count('catalog_operator_intents'),1);assert.equal(db.count('catalog_audit_log'),1);

    db.loseCommitResponse=true;
    await assert.rejects(admin.issue(operator,'lost-response',{email:'lost@example.test',expiresInDays:30}),/lost committed response/);
    db.loseCommitResponse=false;
    const retry=await admin.issue(operator,'lost-response',{email:'lost@example.test',expiresInDays:30});
    assert.equal(retry.replayed,true);assert.equal(retry.token,null);
    assert.equal(db.count('catalog_invitations'),2);assert.equal(db.count('catalog_operator_intents'),2);assert.equal(db.count('catalog_audit_log'),2);
  }finally{db.sqlite.close();}
});

test('revoke is idempotent, audited once, and cannot revoke an accepted invitation',async()=>{
  const {db,admin}=fixture();
  try{
    const created=await admin.issue(operator,'revoke-me',{email:'revoke@example.test',expiresInDays:7});
    const first=await admin.revoke(operator,created.invitation.id,{});assert.equal(first.state,'revoked');
    const second=await admin.revoke(operator,created.invitation.id,{});assert.equal(second.state,'revoked');
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action='invitation.revoke'").get()!.n,1);
    const accepted=await admin.issue(operator,'accepted',{email:'accepted@example.test',expiresInDays:7});
    db.seed('accepted-user');
    db.sqlite.prepare("UPDATE catalog_users SET normalized_email='accepted@example.test' WHERE id='accepted-user'").run();
    db.sqlite.prepare("UPDATE catalog_invitations SET state='accepted',accepted_by='accepted-user',accepted_at=? WHERE id=?").run(1_800_000_000_001,accepted.invitation.id);
    await assert.rejects(admin.revoke(operator,accepted.invitation.id,{}),{message:'not_found'});
    await assert.rejects(admin.revoke(owner,created.invitation.id,{}),{message:'not_found'});
  }finally{db.sqlite.close();}
});

test('accepted invitation access revoke and restore fence old sessions without mutating invitation or tenant history',async()=>{
  const {db,admin}=fixture();
  try{
    const accepted=await admin.issue(operator,'accepted-access',{email:'accepted@example.test',expiresInDays:7});
    db.seed('accepted-user');
    db.sqlite.prepare("UPDATE catalog_users SET normalized_email='accepted@example.test' WHERE id='accepted-user'").run();
    db.sqlite.prepare("UPDATE catalog_invitations SET state='accepted',accepted_by='accepted-user',accepted_at=? WHERE id=?").run(1_800_000_000_001,accepted.invitation.id);
    const listed=(await admin.invitations(operator)).find(item=>item.id===accepted.invitation.id)!;
    assert.equal(listed.access_state,'active');

    const revoked=await admin.access(operator,accepted.invitation.id,{action:'revoke'});
    assert.equal(revoked.state,'accepted');assert.equal(revoked.access_state,'revoked');
    const user=db.sqlite.prepare("SELECT status,auth_version FROM catalog_users WHERE id='accepted-user'").get()!;
    assert.deepEqual({...user},{status:'revoked',auth_version:2});
    assert.equal(db.sqlite.prepare("SELECT status FROM catalog_tenants WHERE id='tenant-accepted-user'").get()!.status,'active');
    assert.equal(db.sqlite.prepare("SELECT status FROM catalog_memberships WHERE tenant_id='tenant-accepted-user'").get()!.status,'active');
    assert.deepEqual({...db.sqlite.prepare("SELECT state,revoked_at FROM catalog_invitations WHERE id=?").get(accepted.invitation.id)!},{state:'accepted',revoked_at:null});
    const revokeAudit=db.sqlite.prepare("SELECT action,target_type,target_id,tenant_id,request_id,reason_code FROM catalog_audit_log WHERE action LIKE '%.access.revoke' ORDER BY action").all();
    assert.equal(revokeAudit.length,2);assert.equal(new Set(revokeAudit.map(row=>row.request_id)).size,1);
    assert.deepEqual(revokeAudit.map(row=>row.target_type).sort(),['invitation','user']);
    assert.equal(revokeAudit.every(row=>row.tenant_id==='tenant-accepted-user'&&row.reason_code==='accepted-invitation-access-revoke-v1'),true);

    await admin.access(operator,accepted.invitation.id,{action:'revoke'});
    assert.equal(db.sqlite.prepare("SELECT auth_version FROM catalog_users WHERE id='accepted-user'").get()!.auth_version,2);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action LIKE '%.access.revoke'").get()!.n,2);

    const restored=await admin.access(operator,accepted.invitation.id,{action:'restore'});
    assert.equal(restored.access_state,'active');
    assert.deepEqual({...db.sqlite.prepare("SELECT status,auth_version FROM catalog_users WHERE id='accepted-user'").get()!},{status:'active',auth_version:2});
    const restoreAudit=db.sqlite.prepare("SELECT action,target_type,request_id,reason_code FROM catalog_audit_log WHERE action LIKE '%.access.restore' ORDER BY action").all();
    assert.equal(restoreAudit.length,2);assert.equal(new Set(restoreAudit.map(row=>row.request_id)).size,1);
    assert.equal(restoreAudit.every(row=>row.reason_code==='accepted-invitation-access-restore-v1'),true);
    await admin.access(operator,accepted.invitation.id,{action:'restore'});
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action LIKE '%.access.restore'").get()!.n,2);
  }finally{db.sqlite.close();}
});

test('accepted invitation access operations fail closed for unsafe lifecycle and operator targets',async()=>{
  const {db,admin}=fixture();
  try{
    const accepted=await admin.issue(operator,'blocked-access',{email:'blocked@example.test',expiresInDays:7});
    db.seed('blocked-user');
    db.sqlite.prepare("UPDATE catalog_users SET normalized_email='blocked@example.test' WHERE id='blocked-user'").run();
    db.sqlite.prepare("UPDATE catalog_invitations SET state='accepted',accepted_by='blocked-user',accepted_at=? WHERE id=?").run(1_800_000_000_001,accepted.invitation.id);
    db.sqlite.prepare("UPDATE catalog_memberships SET status='revoked' WHERE user_id='blocked-user'").run();
    await assert.rejects(admin.access(operator,accepted.invitation.id,{action:'revoke'}),{message:'not_found'});
    db.sqlite.prepare("UPDATE catalog_memberships SET status='active' WHERE user_id='blocked-user'").run();
    db.sqlite.prepare("UPDATE catalog_tenants SET status='suspended' WHERE owner_user_id='blocked-user'").run();
    await assert.rejects(admin.access(operator,accepted.invitation.id,{action:'revoke'}),{message:'not_found'});
    db.sqlite.prepare("UPDATE catalog_tenants SET status='active' WHERE owner_user_id='blocked-user'").run();
    db.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES ('blocked-user','operator','active',?,?)").run(1_800_000_000_000,1_800_000_000_000);
    await assert.rejects(admin.access(operator,accepted.invitation.id,{action:'revoke'}),{message:'not_found'});
    await assert.rejects(admin.access(owner,accepted.invitation.id,{action:'revoke'}),{message:'not_found'});
    await assert.rejects(admin.access(operator,accepted.invitation.id,{action:'invalid'}),{message:'invalid_input'});
    assert.deepEqual({...db.sqlite.prepare("SELECT status,auth_version FROM catalog_users WHERE id='blocked-user'").get()!},{status:'active',auth_version:1});
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action LIKE '%.access.%'").get()!.n,0);
  }finally{db.sqlite.close();}
});

test('overview, tenant list and audit expose platform metadata without project content fields',async()=>{
  const {db,admin}=fixture();
  try{
    await admin.issue(operator,'summary',{email:'summary@example.test',expiresInDays:7});
    const overview=await admin.overview(operator);assert.deepEqual({...overview,updatedAt:0},{tenants:2,activeTenants:2,projects:0,provisioningProjects:0,failedProjects:0,pendingInvitations:1,unknownOutbox:0,updatedAt:0});
    const tenants=await admin.tenants(operator);assert.equal(tenants.length,2);
    for(const tenant of tenants){assert.deepEqual(Object.keys(tenant).sort(),['created_at','failed','id','projects','provisioning','ready','status']);assert.ok(!Object.hasOwn(tenant,'owner_user_id'));}
    const events=await admin.audit(operator);assert.equal(events[0].action,'invitation.issue');
    assert.ok(!Object.hasOwn(events[0],'normalized_email'));assert.ok(!Object.hasOwn(events[0],'token_hash'));
  }finally{db.sqlite.close();}
});
