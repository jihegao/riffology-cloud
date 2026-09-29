import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {digest,inspectModel,simulationPlan} from '../../services/simulation/source.ts';
import {parseModelSpec} from '../../services/simulation/model-spec.ts';

const root=new URL('../fixtures/compiler-v01/model/',import.meta.url);
const business=readFileSync(new URL('business-ir.json',root));
const bundle=readFileSync(new URL('model.simpack',root));
const spec=JSON.parse(readFileSync(new URL('model-spec.json',root),'utf8'));
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));

async function frozen(overrides:Record<string,Uint8Array>={}){
 const archive=initialWorkspaceArchive({'model/model-spec.json':encode(spec),'model/business-ir.json':business,'model/model.simpack':bundle,...overrides});
 const source={kind:'saved-turn' as const,identity:{scope:{tenantId:'t',projectId:'p',workspaceId:'w',workspaceGeneration:1},sessionId:'s',turnId:'t',dispatchId:'d',generation:1},revision:{revisionId:'r',objectKey:'opaque',filesSha256:await digest(archive),sessionSha256:'a'.repeat(64),committedAt:1}};
 return {archive,source};
}

test('compiler v0.1 Revision binds saved Business and bundle to an inspected Plan',async()=>{
 const {archive,source}=await frozen(),plan=await simulationPlan(source,archive),view=await inspectModel(source,archive,true);
 assert.equal(plan.compiler?.bundleSha256,await digest(bundle));
 assert.equal(plan.compiler?.planFingerprint,'3584430f31d2fad37cba98fa7c2cd42bcc482d43640b10c0bee0f35eddf965fe');
 assert.equal(plan.compiler?.businessFingerprint,'58bc6d1abdc3339a071e387bd359ce92d7f22e57204182e30d991fc0e6b1e0de');
 assert.equal(plan.executionProfile,'sim-engine-compiler-0.1.0/v1');
 assert.equal(view.canRun,true);assert.deepEqual(view.compiler,plan.compiler);
 assert.equal(view.version?.filesSha256,await digest(archive));
 assert.deepEqual(parseModelSpec(spec).execution,spec.execution);
});

test('stale Business, corrupt bundle and stale Revision fail before a Run is admitted',async()=>{
 const edited=JSON.parse(business.toString());
 edited.payload.sections.support_activities.collections.activities[0].definition.jobs[0].durationMinutes=30;
 for(const overrides of [{'model/business-ir.json':encode(edited)},{'model/model.simpack':Uint8Array.from(bundle,byte=>byte^1)}] as Record<string,Uint8Array>[]){
  const {archive,source}=await frozen(overrides);const view=await inspectModel(source,archive,true);
  assert.equal(view.canRun,false);assert.equal(view.reasonCode,'compiler-bundle-invalid');
  await assert.rejects(simulationPlan(source,archive),/compiler-bundle-invalid/);
 }
 const {archive,source}=await frozen();
 await assert.rejects(simulationPlan({...source,revision:{...source.revision,filesSha256:'0'.repeat(64)}},archive),/simulation-source-mismatch/);
});

test('compiler declaration rejects parameters, unknown versions and traversal',()=>{
 for(const execution of [{...spec.execution,kind:'compiler-v02'},{...spec.execution,businessIr:'model/../business.json'},{...spec.execution,bundle:'model/other.zip'}])assert.throws(()=>parseModelSpec({...spec,execution}));
 assert.throws(()=>parseModelSpec({...spec,parameters:{capacity:{type:'integer',default:1}}}));
});
