import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedResearchContext} from '../../services/simulation/research-context.ts';
import type {EvidenceView} from '../../services/simulation/evidence.ts';
test('research context preserves whole evidence identities with explicit truncation under 60KB',()=>{
 const evidence=Array.from({length:5},(_,i)=>({claimId:String(i),evidenceValidity:'recorded',references:[{runId:'run-'+i,artifactSha256:'a'.repeat(64)}],assumptions:['x'.repeat(18000)]})) as unknown as EvidenceView[];
 const result=boundedResearchContext({model:{spec:{}},experiments:Array(6).fill({runId:'run'}),experimentGroups:Array(3).fill({groupId:'group',hypothesis:'x'.repeat(10000)}),evidence});
 assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength<=60000);assert.equal(result.truncated.evidence,true);assert.equal(result.truncated.experiments,true);assert.equal(result.truncated.experimentGroups,true);assert.equal(result.evidencePolicy.agentText,'unverified-interpretation');for(const item of result.evidence)assert.deepEqual(item.references,evidence.find(e=>e.claimId===item.claimId)!.references);
});
test('research context reports pagination and rejects an oversized unprunable model',()=>{
 const result=boundedResearchContext({model:null,experiments:[],experimentGroups:[],evidence:[],hasMoreEvidence:true});assert.equal(result.truncated.evidence,true);assert.throws(()=>boundedResearchContext({model:{text:'a'.repeat(61000)},experiments:[],experimentGroups:[],evidence:[]}),/research-context-too-large/);
});

test('large design contents do not displace measured evidence or break bounded research context',()=>{
 const model={spec:{},artifacts:{revisionId:'design-revision',filesSha256:'f'.repeat(64),manifest:{schema:'riffology.model-artifacts/v1',files:[{path:'design/notes.md',role:'document'}],views:[]},contents:{'design/notes.md':'x'.repeat(128*1024)}}};
 const result=boundedResearchContext({model,experiments:[{runId:'measured-run'}],experimentGroups:[],evidence:[]});
 const summary=result.model as {artifacts:Record<string,unknown>};
 assert.equal(summary.artifacts.contents,undefined);assert.equal(summary.artifacts.contentsOmitted,true);assert.equal(summary.artifacts.revisionId,'design-revision');assert.deepEqual(summary.artifacts.manifest,model.artifacts.manifest);
 assert.equal(result.experiments.length,1);assert.equal(result.truncated.experiments,false);assert.equal(model.artifacts.contents['design/notes.md'].length,128*1024);
});
