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

test('maintenance quiescence GET requires a current operator and exact original request; false proof remains visible with HTTP409',async()=>{
 const db=new SqliteCatalog(),now=Date.now(),calls:unknown[]=[];let ready=false,unavailable=false;
 try{
  for(const user of ['owner','operator'])db.sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES(?,'better-auth',?,?,?,?)").run(user,user,user+'@example.test',now,now);
  db.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES('operator','operator','active',?,?)").run(now,now);
  const proof=()=>({quiescent:ready,revision:1,hold:{requestId:'maint_1'},ledger:{quiescent:true},native:{quiescent:ready,pairUnresolved:ready?0:1},actualContainerReleaseVerified:false});
  const privateBeta={snapshot:async()=>{throw Error('mutable-snapshot-forbidden');},pause:async()=>{throw Error('pause-forbidden');},resume:async()=>{throw Error('resume-forbidden');},maintenanceQuiescence:async(...args:unknown[])=>{calls.push(args);if(unavailable)throw Error('private-beta-maintenance-proof-unavailable');return proof();}};
  const call=(user:string|null,query='?requestId=maint_1',method='GET')=>gateway(new Request(origin+'/api/admin/private-beta/maintenance/quiescence'+query,{method,headers:{origin}}),{origin,database:db,identity:async()=>user?({subject:user,email:user+'@example.test',emailVerified:true,platformVersion:1}):null,privateBeta});
  assert.equal((await call(null)).status,401);assert.equal((await call('owner')).status,404);assert.equal(calls.length,0);
  for(const query of ['','?requestId=','?other=1','?requestId=maint_1&other=1','?requestId=maint_1&requestId=maint_1'])assert.equal((await call('operator',query)).status,400);
  assert.equal((await call('operator','?requestId=maint_1','POST')).status,400);assert.equal(calls.length,0);
  const blocked=await call('operator');assert.equal(blocked.status,409);assert.deepEqual(await blocked.json(),proof());
  assert.deepEqual(calls.pop(),['maint_1',{userId:'operator',authVersion:1}]);
  ready=true;const quiet=await call('operator');assert.equal(quiet.status,200);assert.deepEqual(await quiet.json(),proof());calls.pop();
  unavailable=true;assert.equal((await call('operator')).status,409);assert.equal(calls.length,1);
  db.sqlite.prepare("UPDATE catalog_platform_roles SET status='revoked' WHERE user_id='operator'").run();assert.equal((await call('operator')).status,404);assert.equal(calls.length,1);
 }finally{db.sqlite.close();}
});

test('maintenance uses the existing current-operator boundary, exact CAS input and an independent pure status port',async()=>{
 const db=new SqliteCatalog(),now=Date.now(),calls:unknown[]=[];
 try{
  for(const user of ['owner','operator'])db.sqlite.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES(?,'better-auth',?,?,?,?)").run(user,user,user+'@example.test',now,now);
  db.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES('operator','operator','active',?,?)").run(now,now);
  const input={requestId:'maint_1',expectedRevision:0,expectedPolicySha256:'a'.repeat(64)};
  const privateBeta={snapshot:async()=>{throw Error('mutating-snapshot-forbidden');},pause:async()=>{throw Error('pause-forbidden');},resume:async()=>{throw Error('resume-forbidden');},maintenanceStatus:async(...args:unknown[])=>{calls.push(['status',...args]);return {revision:0,hold:null};},beginMaintenance:async(...args:unknown[])=>{calls.push(['begin',...args]);return {receipt:{revision:1}};},endMaintenance:async(...args:unknown[])=>{calls.push(['end',...args]);throw Error('private-beta-maintenance-release-unconfirmed');}};
  const call=(user:string|null,method='GET',body?:unknown,source=origin,query='')=>gateway(new Request(origin+'/api/admin/private-beta/maintenance'+query,{method,headers:{origin:source,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{origin,database:db,identity:async()=>user?({subject:user,email:user+'@example.test',emailVerified:true,platformVersion:1}):null,privateBeta});
  assert.equal((await call(null)).status,401);assert.equal((await call('owner')).status,404);
  assert.equal((await call('owner','POST',{action:'begin',...input})).status,404);assert.equal(calls.length,0);
  assert.equal((await call('operator','POST',{action:'begin',...input},'https://evil.test')).status,403);assert.equal(calls.length,0);
  for(const body of [{action:'pause',...input},{action:'begin',...input,extra:true},{action:'begin',...input,expectedRevision:-1},{action:'begin',...input,expectedPolicySha256:'bad'},{action:'begin',...input,requestId:''}])assert.equal((await call('operator','POST',body)).status,400);
  assert.equal((await call('operator','POST',{action:'begin',...input},origin,'?requestId=maint_1')).status,400);
  for(const query of ['?other=1','?requestId=maint_1&requestId=maint_1','?requestId='])assert.equal((await call('operator','GET',undefined,origin,query)).status,400);
  assert.equal(calls.length,0);
  assert.equal((await call('operator','GET',undefined,origin,'?requestId=maint_1')).status,200);
  assert.deepEqual(calls.pop(),['status','maint_1',{userId:'operator',authVersion:1}]);
  assert.equal((await call('operator','POST',{action:'begin',...input})).status,200);
  assert.deepEqual(calls.pop(),['begin',input,{userId:'operator',authVersion:1}]);
  assert.equal((await call('operator','POST',{action:'end',...input,expectedRevision:1})).status,409);assert.equal(calls.length,1);
  db.sqlite.prepare("UPDATE catalog_platform_roles SET status='revoked' WHERE user_id='operator'").run();
  assert.equal((await call('operator')).status,404);assert.equal((await call('operator','POST',{action:'end',...input})).status,404);assert.equal(calls.length,1);
 }finally{db.sqlite.close();}
});
