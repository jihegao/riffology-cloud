import test from 'node:test';
import assert from 'node:assert/strict';
import {manualPageFixture,scopes} from './manual-page-broker-fixture.mjs';

const files=version=>({
 'app/views.json':JSON.stringify({schema:'project.views/v1',files:['app/home.html','app/report.html','docs/data.json'],views:[{id:'home',title:'Home',entrypoint:'app/home.html'},{id:'report',title:'Report',entrypoint:'app/report.html'}]}),
 'app/home.html':'<h1>Home '+version+'</h1>',
 'app/report.html':'<h1>Report '+version+'</h1>',
 'docs/data.json':JSON.stringify({version}),
});
const currentPath=identity=>'/__fixture/current?identity='+identity;

test('real Workspace current authority checks cached package against canonical manual head without rebuilding its archive',{timeout:60000},async t=>{
 const f=await manualPageFixture(t);
 assert.equal((await f.save('alpha','current-v1',files('V1'))).body.status,'committed');
 assert.deepEqual(await f.read(currentPath('0'.repeat(64))),{current:false});
 assert.equal((await f.read('/__fixture/package-reads')).reads,0,'missing cache must not rebuild a package');
 const first=(await f.read(f.base('alpha')+'/project-views')).package;
 assert.equal((await f.read('/__fixture/package-reads')).reads,1);
 assert.deepEqual(await f.read(currentPath(first.packageIdentity)),{current:true});
 assert.deepEqual(await f.read(currentPath('f'.repeat(64))),{current:false});
 const keys=(await f.bucket.list()).objects.map(object=>object.key).sort();
 assert.equal((await f.read('/__fixture/package-reads')).reads,1);

 assert.equal((await f.save('alpha','current-v2',files('V2'))).body.status,'committed');
 assert.deepEqual(await f.read(currentPath(first.packageIdentity)),{current:false});
 assert.equal((await f.read('/__fixture/package-reads')).reads,1,'V2 invalidation must not call projectViews or read/repackage the new archive');
 const second=(await f.read(f.base('alpha')+'/project-views')).package;
 assert.notEqual(second.packageIdentity,first.packageIdentity);assert.notEqual(second.revisionId,first.revisionId);
 assert.deepEqual(await f.read(currentPath(second.packageIdentity)),{current:true});
 assert.deepEqual(await f.read(currentPath(first.packageIdentity)),{current:false});
 assert.equal((await f.read('/__fixture/package-reads')).reads,2);

 const foreign=await f.request(currentPath(second.packageIdentity),{user:'beta'});assert.equal(foreign.status,403);assert.deepEqual(foreign.body,{error:'denied'});
 await f.db.prepare("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(scopes.alpha.tenantId,'alpha').run();
 const revoked=await f.request(currentPath(second.packageIdentity));assert.equal(revoked.status,403);assert.deepEqual(revoked.body,{error:'denied'});
 assert.equal((await f.read('/__fixture/package-reads')).reads,2,'revoked access must not rebuild or deliver the package');
 await f.db.prepare("UPDATE catalog_memberships SET status='active' WHERE tenant_id=? AND user_id=?").bind(scopes.alpha.tenantId,'alpha').run();
 assert.deepEqual(await f.read(currentPath(second.packageIdentity)),{current:true});

 // Only the derived cache marker is lost. The real Revision, journal, fences,
 // Catalog and R2 persist through an actual Workerd reconstruction.
 await f.read('/__fixture/drop-package-authority');
 assert.deepEqual(await f.read(currentPath(second.packageIdentity)),{current:false});
 assert.equal((await f.read('/__fixture/package-reads')).reads,2);
 await f.restart();
 assert.deepEqual(await f.read(currentPath(second.packageIdentity)),{current:false});
 assert.equal((await f.read('/__fixture/package-reads')).reads,0);
 const restored=(await f.read(f.base('alpha')+'/project-views')).package;
 assert.deepEqual(restored,second);assert.deepEqual(await f.read(currentPath(second.packageIdentity)),{current:true});
 assert.equal((await f.read('/__fixture/package-reads')).reads,1);
 const journal=await f.read('/__fixture/diagnostics?user=alpha'),fences=(await f.db.prepare('SELECT state,terminal_status FROM catalog_manual_save_fences').all()).results;
 assert.equal(f.manualPosts,2);assert.equal(f.outbound,0);assert.equal(journal.turns,0);assert.equal(journal.sessions,0);assert.equal(journal.active,null);
 assert.deepEqual(journal.operations.map(operation=>operation.status),['committed','committed']);
 assert.ok(fences.every(fence=>fence.state==='released'&&fence.terminal_status==='committed'));
 const afterKeys=(await f.bucket.list()).objects.map(object=>object.key);assert.ok(keys.every(key=>afterKeys.includes(key)),'original immutable files remain present');
});
