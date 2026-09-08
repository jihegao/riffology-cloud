import test from 'node:test';
import assert from 'node:assert/strict';
import { Admission } from '../../services/catalog/admission.ts';
import { OperatorCatalog } from '../../services/catalog/admin.ts';
import { digest } from '../../services/catalog/contracts.ts';
import { bootstrapInitialOperator, parseBootstrapArgs } from '../../scripts/m1/bootstrap-operator.mjs';
import { SqliteCatalog } from './sqlite-database.ts';

const token='e'.repeat(64),email='initial@example.test';
function runner(db){return async sql=>/^\s*select/i.test(sql)?db.sqlite.prepare(sql).all():void db.sqlite.exec(sql);}

test('offline initial invitation stores only a hash and exact retries reconcile one intent',async()=>{
  const db=new SqliteCatalog();
  try{
    const commands=[],run=async sql=>{commands.push(sql);return runner(db)(sql);};
    const first=await bootstrapInitialOperator({email},{token,runSql:run,now:1_800_000_000_000,invitationId:'bootstrap-first'});
    assert.deepEqual(first,{status:'invitation-ready',invitationId:'bootstrap-first',replayed:false,recoveredAfterWriteError:false});
    const stored=db.sqlite.prepare('SELECT token_hash,purpose,issued_by FROM catalog_invitations').get();
    assert.equal(stored.token_hash,await digest(token));assert.notEqual(stored.token_hash,token);assert.equal(stored.purpose,'initial_operator');assert.equal(stored.issued_by,null);
    assert.equal(db.count('catalog_operator_bootstrap'),1);assert.equal(db.count('catalog_platform_roles'),0);
    assert.equal(commands.some(command=>command.includes(token)),false);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action='operator.bootstrap.invite'").get().n,1);
    const replay=await bootstrapInitialOperator({email},{token,runSql:runner(db),now:1_800_000_000_100,invitationId:'bootstrap-second'});
    assert.equal(replay.replayed,true);assert.equal(replay.invitationId,'bootstrap-first');
    await assert.rejects(bootstrapInitialOperator({email},{token:'f'.repeat(64),runSql:runner(db)}),/bootstrap_conflict/);
    assert.equal(db.count('catalog_invitations'),1);assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM catalog_operator_bootstrap').all()).includes(token),false);
  }finally{db.sqlite.close();}
});

test('offline write response loss is resolved by exact hash readback without another credential',async()=>{
  const db=new SqliteCatalog();let first=true;
  try{
    const run=async sql=>{
      if(first){first=false;db.sqlite.exec(sql);throw Error('lost response');}
      return runner(db)(sql);
    };
    const result=await bootstrapInitialOperator({email},{token,runSql:run,now:1_800_000_000_000,invitationId:'bootstrap-lost'});
    assert.equal(result.recoveredAfterWriteError,true);assert.equal(result.invitationId,'bootstrap-lost');assert.equal(db.count('catalog_invitations'),1);
  }finally{db.sqlite.close();}
});

test('verified acceptance atomically grants the initial operator and concurrent replay is harmless',async()=>{
  const db=new SqliteCatalog();
  try{
    await bootstrapInitialOperator({email},{token,runSql:runner(db),now:Date.now()-1000,invitationId:'bootstrap-accept'});
    const identity={subject:'google-initial',email,emailVerified:true,platformVersion:1};
    const admission=new Admission(db),results=await Promise.all([admission.accept(identity,token),admission.accept(identity,token)]);
    assert.equal(results[0].tenantId,results[1].tenantId);assert.equal(db.count('catalog_platform_roles'),1);
    const principal=await admission.principal(identity);assert.equal((await new OperatorCatalog(db).overview(principal)).activeTenants,1);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action='platform_role.grant'").get().n,1);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action='invitation.accept'").get().n,1);
    const reconciled=await bootstrapInitialOperator({email},{token,runSql:runner(db),invitationId:'unused'});assert.equal(reconciled.status,'operator-ready');
  }finally{db.sqlite.close();}
});

test('ordinary invitations never grant operator and bootstrap acceptance rolls back on every injected admission failure',async()=>{
  const ordinary=new SqliteCatalog();
  try{
    const now=Date.now();ordinary.sqlite.prepare(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,created_at,expires_at) VALUES ('ordinary',?,?,?,?)`).run(await digest(token),email,now,now+60_000);
    await new Admission(ordinary).accept({subject:'ordinary',email,emailVerified:true,platformVersion:1},token);
    assert.equal(ordinary.count('catalog_platform_roles'),0);
  }finally{ordinary.sqlite.close();}
  for(let failAt=0;failAt<5;failAt++){
    const db=new SqliteCatalog();
    try{
      await bootstrapInitialOperator({email},{token,runSql:runner(db),now:Date.now()-1000,invitationId:`bootstrap-fail-${failAt}`});
      db.failAt=failAt;
      await assert.rejects(new Admission(db).accept({subject:`failed-${failAt}`,email,emailVerified:true,platformVersion:1},token));
      assert.equal(db.count('catalog_users'),0);assert.equal(db.count('catalog_platform_roles'),0);
      assert.equal(db.sqlite.prepare("SELECT state FROM catalog_invitations").get().state,'pending');
      assert.equal(db.sqlite.prepare("SELECT count(*) n FROM catalog_audit_log WHERE action='platform_role.grant'").get().n,0);
    }finally{db.sqlite.close();}
  }
});

test('bootstrap fails closed if an operator appears, and purpose/bootstrap metadata are immutable',async()=>{
  const db=new SqliteCatalog();
  try{
    await bootstrapInitialOperator({email},{token,runSql:runner(db),now:Date.now()-1000,invitationId:'bootstrap-fenced'});
    db.seed('existing');const now=Date.now();db.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES ('existing','operator','active',?,?)").run(now,now);
    await assert.rejects(new Admission(db).accept({subject:'blocked',email,emailVerified:true,platformVersion:1},token));
    assert.equal(db.sqlite.prepare("SELECT state FROM catalog_invitations WHERE id='bootstrap-fenced'").get().state,'pending');
    await assert.rejects(async()=>db.sqlite.prepare("UPDATE catalog_invitations SET purpose='user' WHERE id='bootstrap-fenced'").run(),/purpose-immutable/);
    await assert.rejects(async()=>db.sqlite.prepare("DELETE FROM catalog_operator_bootstrap").run(),/bootstrap-immutable/);
  }finally{db.sqlite.close();}
  const existing=new SqliteCatalog();
  try{
    existing.seed('operator');const now=Date.now();existing.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES ('operator','operator','active',?,?)").run(now,now);
    await assert.rejects(bootstrapInitialOperator({email},{token,runSql:runner(existing),now,invitationId:'bootstrap-too-late'}),/bootstrap_write_unconfirmed/);
    assert.equal(existing.count('catalog_operator_bootstrap'),0);
  }finally{existing.sqlite.close();}
});

test('bootstrap CLI requires one explicit database location and never accepts the token as an argument',()=>{
  assert.deepEqual(parseBootstrapArgs(['invite','--email',' Initial@Example.Test ','--database','catalog','--config','infra/config.jsonc','--local']),{mode:'invite',email:'initial@example.test',database:'catalog',config:'infra/config.jsonc',location:'local'});
  for(const args of [[],['invite','--email',email],['invite','--email',email,'--database','db','--config','x','--local','--remote'],['invite','--email',email,'--database','db','--config','x','--token',token,'--local']])assert.throws(()=>parseBootstrapArgs(args));
});
