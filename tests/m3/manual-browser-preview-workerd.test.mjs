import test from 'node:test';
import assert from 'node:assert/strict';
import profiles from '../../services/browser-preview/runtime/assets/profiles.json' with {type:'json'};
import {makeFixture} from '../../services/browser-preview/runtime/fixtures.mjs';
import {unpackPreviewPackage} from '../../services/browser-preview/packager.ts';
import {manualPageFixture} from './manual-page-broker-fixture.mjs';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ready(f,revision){
 const path=f.base('alpha')+'/browser-preview?revisionId='+revision;
 for(let i=0;i<100;i++){
  const response=await f.request(path);
  if(response.status!==200)assert.fail(JSON.stringify({response,diagnostic:await f.read('/__fixture/preview-view?revision='+revision)}));
  if(response.body.build?.status==='ready')return response.body;
  if(['failed','unsupported'].includes(response.body.build?.status))assert.fail(JSON.stringify(response.body));
  await pause(100);
 }
 assert.fail(JSON.stringify({message:'manual preview did not become ready',diagnostic:await f.read('/__fixture/preview?revision='+revision),view:await f.read('/__fixture/preview-view?revision='+revision)}));
}

test('real author saves publish canonical manual previews, recover legacy missing discovery, and preserve history and access',{timeout:45000},async t=>{
 const f=await manualPageFixture(t,{browserPreviewTest:true}),model=await makeFixture(profiles[0]);
 const files=Object.fromEntries(model.files.map(row=>[row.path,Buffer.from(row.base64,'base64').toString('utf8')]));
 files['docs/data.json']='{"synthetic":true}';
 const save1=await f.save('alpha','manual-preview-v1',files);assert.equal(save1.status,200,JSON.stringify(save1));assert.equal(save1.body.status,'committed');
 const rev1=save1.body.revisionId;
 const indexed=await f.read('/__fixture/preview?revision='+rev1);assert.equal(indexed.discovery?.kind,'manual-save');assert.equal(indexed.discovery.receipt.revisionId,rev1);
 const first=await ready(f,rev1);assert.equal(first.sourceKind,'manual-save');assert.equal(first.canVerify,false);assert.equal(first.currentRevisionId,rev1);assert.equal(first.stale,false);
 const packageResponse=await f.rawRequest(f.base('alpha')+'/browser-preview/packages/'+first.build.packageIdentity,{headers:{'x-synthetic-user':'alpha',Origin:'http://127.0.0.1:8795'}});
 assert.equal(packageResponse.status,200);const unpacked=await unpackPreviewPackage(new Uint8Array(await packageResponse.arrayBuffer()));
 assert.equal(unpacked.manifest.revisionId,rev1);assert.equal(unpacked.manifest.filesSha256,save1.body.filesSha256);
 assert.equal(new TextDecoder().decode(unpacked.files.get('model/model.py')),files['model/model.py']);

 // Simulate an already-committed production version made before this code:
 // only the synthetic build/discovery index is removed, not the journal or R2 files.
 await f.read('/__fixture/preview?revision='+rev1+'&forget=1');
 assert.equal((await f.read('/__fixture/preview?revision='+rev1)).discovery,null);
 const denied=await f.request(f.base('alpha')+'/browser-preview?revisionId='+rev1,{user:'beta'});assert.equal(denied.status,404);
 assert.equal((await f.read('/__fixture/preview?revision='+rev1)).discovery,null,'foreign GET must not backfill');
 const recovered=await ready(f,rev1);assert.equal(recovered.build.packageIdentity,first.build.packageIdentity);

 const changed=files['model/model.py']+'\n# second committed revision\n';
 const save2=await f.save('alpha','manual-preview-v2',{'model/model.py':changed});assert.equal(save2.status,200,JSON.stringify(save2));assert.equal(save2.body.status,'committed');
 const rev2=save2.body.revisionId;assert.notEqual(rev2,rev1);
 const auto=await f.read('/__fixture/preview?revision='+rev2);assert.equal(auto.discovery?.kind,'manual-save','commit itself indexes the new revision');
 await f.restart();const second=await ready(f,rev2);assert.equal(second.currentRevisionId,rev2);assert.equal(second.canVerify,false);
 const historical=await ready(f,rev1);assert.equal(historical.stale,true);assert.equal(historical.currentRevisionId,rev2);
 const latest=await f.rawRequest(f.base('alpha')+'/browser-preview/packages/'+second.build.packageIdentity,{headers:{'x-synthetic-user':'alpha',Origin:'http://127.0.0.1:8795'}});
 assert.equal(latest.status,200);const unpacked2=await unpackPreviewPackage(new Uint8Array(await latest.arrayBuffer()));assert.equal(new TextDecoder().decode(unpacked2.files.get('model/model.py')),changed);assert.equal(unpacked2.manifest.filesSha256,save2.body.filesSha256);
 assert.equal((await f.request(f.base('alpha')+'/browser-preview?revisionId=unknown-revision')).status,404);
 assert.equal((await f.request(f.base('alpha')+'/browser-preview/packages/'+second.build.packageIdentity,{user:'beta'})).status,404);
 const result=await f.request(f.base('alpha')+'/browser-preview/verify',{method:'POST',body:{revisionId:rev2,packageIdentity:second.build.packageIdentity,parameters:{servers:2,customers:30,arrival_rate:0.8,service_rate:1},seed:7,intent:'experiment',idempotencyKey:'no-manual-verify'}});assert.notEqual(result.status,202);
 const journal=await f.read('/__fixture/diagnostics?user=alpha'),fences=(await f.db.prepare('SELECT state,terminal_status FROM catalog_manual_save_fences').all()).results;
 assert.equal(journal.turns,0);assert.equal(journal.sessions,0);assert.equal(f.manualPosts,2);assert.equal(f.outbound,0);assert.equal(fences.length,2);assert.ok(fences.every(x=>x.state==='released'&&x.terminal_status==='committed'));
});
