import test from 'node:test';
import assert from 'node:assert/strict';
import {EvidenceLedger} from '../../services/simulation/evidence.ts';
import {evidenceGroup} from '../../services/simulation/evidence-adapter.ts';
import {groupFixture,scope,actor,plan} from './group-fixture.ts';
async function complete(f:ReturnType<typeof groupFixture>){for(let i=0;i<35;i++){for(const id of f.starts)f.complete(id);await f.tick(200);}}
test('a model rejection excludes all matching completed Runs from group summaries after reopen',async t=>{
 const f=groupFixture(t),g=await f.groups.submit(actor,'g',f.request,plan,'image',()=>true);await complete(f);const before=await f.groups.view(await f.groups.get(g.groupId),null);assert.equal(before.progress.completed,4);assert.equal(before.summary[0]!.metrics.wait!.count,2);
 const ledger=new EvidenceLedger(f.storage,scope,{run:id=>f.host.get(id),group:async id=>evidenceGroup(await f.groups.get(id),scope),artifact:async()=>{throw Error('not-needed');},source:async()=>{throw Error('not-needed');}},()=>f.q.now);await ledger.reject({scope:'model',runId:g.children[0]!.runId,reason:'Incorrect arrival assumptions'},actor);f.reopen();const after=await f.groups.view(await f.groups.get(g.groupId),null);assert.equal(after.status,'completed');assert.equal(after.progress.completed,4);assert.equal(after.progress.rejected,4);for(const config of after.summary){assert.equal(config.metrics.wait!.count,0);assert.equal(config.metrics.wait!.mean,null);assert.equal(config.metrics.wait!.delta,null);}assert.equal(after.runs[0]!.evidenceRejection?.reason,'Incorrect arrival assumptions');assert.ok((await f.host.get(g.children[0]!.runId)).result);
});
test('run rejection only excludes that sample and preserves expected denominator',async t=>{
 const f=groupFixture(t),g=await f.groups.submit(actor,'g',f.request,plan,'image',()=>true);await complete(f);const ledger=new EvidenceLedger(f.storage,scope,{run:id=>f.host.get(id),group:async id=>evidenceGroup(await f.groups.get(id),scope),artifact:async()=>null,source:async()=>new Uint8Array()});await ledger.reject({scope:'run',runId:g.children[0]!.runId,reason:'Invalid sample'},actor);const after=await f.groups.view(await f.groups.get(g.groupId),null);assert.equal(after.progress.rejected,1);assert.equal(after.summary[0]!.metrics.wait!.count,1);assert.equal(after.summary[0]!.metrics.wait!.missing,1);assert.equal(after.summary[1]!.metrics.wait!.count,2);
});
