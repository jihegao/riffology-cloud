import test from 'node:test';
import assert from 'node:assert/strict';
import { Admission } from '../../services/catalog/admission.ts';
import { digest } from '../../services/catalog/contracts.ts';
import { SqliteCatalog } from './sqlite-database.ts';
const token='a'.repeat(64);
const identity={subject:'google-user-a',email:'Alice@example.test',emailVerified:true,platformVersion:1};
async function fixture(expires=Date.now()+60000){
  const db=new SqliteCatalog(),now=Date.now()-1000;
  db.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES ('invite',?,'alice@example.test',?,?)`).run(await digest(token),now,expires);
  return {db,admission:new Admission(db)};
}
test('invitation requires verified matching email and token; concurrent retry grants one personal tenant',async()=>{
  const {db,admission}=await fixture();
  try{
    for(const [id,t] of [[{...identity,emailVerified:false},token],[{...identity,email:'bob@example.test'},token],[identity,'b'.repeat(64)]] as const)await assert.rejects(admission.accept(id,t),{message:'not_found'});
    assert.equal(db.count('catalog_users'),0);
    const accepted=await Promise.all([admission.accept(identity,token),admission.accept(identity,token)]);
    assert.equal(accepted[0].tenantId,accepted[1].tenantId);
    for(const table of ['catalog_users','catalog_tenants','catalog_memberships','catalog_audit_log'])assert.equal(db.count(table),1);
    assert.equal(db.sqlite.prepare('SELECT state FROM catalog_invitations').get()!.state,'accepted');
    const p=await admission.principal(identity);assert.equal(p.authVersion,1);
    await assert.rejects(admission.accept({...identity,subject:'other-identity'},token),{message:'not_found'});
  }finally{db.sqlite.close();}
});
test('revoked and expired invitations cannot create platform accounts',async()=>{
  for(const mode of ['expired','revoked']){
    const {db,admission}=await fixture(mode==='expired'?Date.now()-10:Date.now()+60000);
    try{
      if(mode==='revoked')db.sqlite.prepare("UPDATE catalog_invitations SET state='revoked',revoked_at=?").run(Date.now());
      await assert.rejects(admission.accept(identity,token),{message:'not_found'});
      assert.equal(db.count('catalog_users'),0);assert.equal(db.count('catalog_tenants'),0);
    }finally{db.sqlite.close();}
  }
});
test('late invitation transaction failure rolls back admission and allows safe retry',async()=>{
  const {db,admission}=await fixture();
  try{
    db.failAt=4;await assert.rejects(admission.accept(identity,token),/injected SQL failure/);
    assert.equal(db.count('catalog_users'),0);assert.equal(db.count('catalog_tenants'),0);
    assert.equal(db.sqlite.prepare('SELECT state FROM catalog_invitations').get()!.state,'pending');
    db.failAt=-1;await admission.accept(identity,token);
  }finally{db.sqlite.close();}
});
test('session platform version cannot follow a revoked account version forward',async()=>{
  const {db,admission}=await fixture();
  try{
    await admission.accept(identity,token);db.sqlite.exec('UPDATE catalog_users SET auth_version=2');
    await assert.rejects(admission.principal(identity),{message:'not_found'});
    const p=await admission.principal({...identity,platformVersion:2});assert.equal(p.authVersion,2);
    db.sqlite.exec("UPDATE catalog_users SET status='revoked'");
    await assert.rejects(admission.principal({...identity,platformVersion:2}),{message:'not_found'});
  }finally{db.sqlite.close();}
});
