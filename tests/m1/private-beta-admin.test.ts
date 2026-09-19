import test from 'node:test';
import assert from 'node:assert/strict';
import {gateway} from '../../services/gateway/app.ts';
import {SqliteCatalog} from './sqlite-database.ts';
const origin='http://gateway.test';
test('Private Beta controls require current operator identity and same-origin mutation; normal users cannot inspect or pause capacity',async()=>{
 const db=new SqliteCatalog(),now=Date.now();
 try{
  for(const user of ['owner','operator']){db.sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES(?,'better-auth',?,?,?,?)").run(user,user,user+'@example.test',now,now);}
  db.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES('operator','operator','active',?,?)").run(now,now);
  let pauses=0,reads=0,resumes=0;
  const privateBeta={snapshot:async()=>{reads++;return {active:1,paused:false};},pause:async()=>{pauses++;return {paused:true};},resume:async()=>{resumes++;throw Error('private-beta-release-unconfirmed');}};
  const call=(user:string,method='GET',body?:unknown,source=origin)=>gateway(new Request(origin+'/api/admin/private-beta',{method,headers:{origin:source,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{origin,database:db,identity:async()=>({subject:user,email:user+'@example.test',emailVerified:true,platformVersion:1}),privateBeta});
  assert.equal((await call('owner')).status,404);assert.equal((await call('owner','POST',{action:'pause'})).status,404);assert.equal(reads+pauses,0);
  assert.equal((await call('operator')).status,200);assert.equal(reads,1);
  assert.equal((await call('operator','POST',{action:'pause'},'https://evil.test')).status,403);assert.equal(pauses,0);
  assert.equal((await call('operator','POST',{action:'replay'})).status,400);
  assert.equal((await call('operator','POST',{action:'pause',provider:'other'})).status,400);
  assert.equal((await call('operator','POST',{action:'pause'})).status,200);assert.equal(pauses,1);
  assert.equal((await call('operator','POST',{action:'resume'})).status,409);assert.equal(resumes,1);
  db.sqlite.prepare("UPDATE catalog_platform_roles SET status='revoked' WHERE user_id='operator'").run();
  assert.equal((await call('operator','POST',{action:'pause'})).status,404);assert.equal(pauses,1);
 }finally{db.sqlite.close();}
});
