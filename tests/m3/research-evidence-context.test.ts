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
