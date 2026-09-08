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
