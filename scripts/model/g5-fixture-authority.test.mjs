import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {G5FixtureAuthorityAdapter,createSeededFailureOperatorIntent,seededFailureArchitectureAudit,validateSeededFailureOperatorReceipt} from './g5-fixture-authority.mjs';

const H='a'.repeat(64),J='b'.repeat(64),K='c'.repeat(64),L='d'.repeat(64);
const fixtures=JSON.parse(await readFile(new URL('./benchmark-task-fixtures/fixtures.json',import.meta.url)));
const source=(revisionId='revision-a',filesSha256=H)=>({revisionId,filesSha256,specSha256:J});
const refs=names=>names.map(name=>({name,satisfied:true,references:[{kind:'revision',id:'revision-a',sha256:H}]}));
function response(intent){return {schemaVersion:1,fixtureId:intent.fixtureId,category:intent.category,dependsOn:intent.dependsOn,workspaceId:intent.workspaceId,sessionId:intent.sessionId,turnId:intent.turnId,source:intent.source,sourceRelation:intent.sourceRelation,requiredEvidence:refs(intent.requiredEvidence),domainChecks:refs(intent.domainChecks),seededFailureReceiptSha256:intent.seededFailure?.receiptSha256??null,receiptSha256:K};}

test('fixture adapter enforces dependsOn and unchanged source before calling authority',async()=>{
 const calls=[],adapter=new G5FixtureAuthorityAdapter({fixtures,port:{async inspectFixtureTask(intent){calls.push(intent);return response(intent);}}}),create=fixtures.sequence[0],parameter=fixtures.sequence[1];
 const first=await adapter.inspect({task:create,workspaceId:'workspace-a',sessionId:'session-a',turnId:'turn-a',version:source()});assert.equal(first.fixtureId,create.fixtureId);
 await assert.rejects(adapter.inspect({task:parameter,workspaceId:'workspace-a',sessionId:'session-a',turnId:'turn-b',version:source('revision-b',L)}),/source-relation/);assert.equal(calls.length,1);
 const second=await adapter.inspect({task:parameter,workspaceId:'workspace-a',sessionId:'session-a',turnId:'turn-b',version:source('revision-b')});assert.deepEqual(second.dependsOn,{fixtureId:create.fixtureId,receiptSha256:K});assert.equal(second.source.revisionId,'revision-b');assert.equal(calls.length,2);
});

test('authority receipt requires every named evidence and domain assertion with references',async()=>{
 const task=fixtures.sequence[0],adapter=new G5FixtureAuthorityAdapter({fixtures,port:{async inspectFixtureTask(intent){const raw=response(intent);raw.requiredEvidence.pop();return raw;}}});
 await assert.rejects(adapter.inspect({task,workspaceId:'workspace-a',sessionId:'session-a',turnId:'turn-a',version:source()}),/required-evidence/);
});

test('seeded failure intent binds exact frozen bytes, scope and current head; receipt binds failed SyntaxError artifact',()=>{
 const task=fixtures.sequence[3],scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},intent=createSeededFailureOperatorIntent({windowId:'g5-a-window',fixture:task,scope,sessionId:'session-a',currentVersion:source(),asset:fixtures.assets.seededFailure,predecessorAuthorityReceiptSha256:K});
 assert.equal(intent.mutation.sha256,fixtures.assets.seededFailure.sha256);assert.equal(intent.expectedCurrentHead.filesSha256,H);
 const receipt={schemaVersion:1,purpose:intent.purpose,windowId:intent.windowId,fixtureId:intent.fixtureId,scope,sessionId:intent.sessionId,baseHead:intent.expectedCurrentHead,injectedHead:source('failure-revision',L),mutation:intent.mutation,validationArtifact:{artifactId:'failure-artifact',artifactSha256:H,sourceSha256:intent.mutation.sha256,revisionId:'failure-revision',outcome:'failed',phase:'Python compile validation',exception:'SyntaxError',cause:'missing-colon-after-run-definition'},taskReceiptSha256:J,receiptSha256:K};
 assert.equal(validateSeededFailureOperatorReceipt(receipt,intent).validationArtifact.outcome,'failed');
 assert.throws(()=>validateSeededFailureOperatorReceipt({...receipt,validationArtifact:{...receipt.validationArtifact,sourceSha256:J}},intent),/artifact-invalid/);
 assert.throws(()=>createSeededFailureOperatorIntent({windowId:'g5-a-window',fixture:task,scope,sessionId:'session-a',currentVersion:source(),asset:{...fixtures.assets.seededFailure,base64:Buffer.from('different').toString('base64')},predecessorAuthorityReceiptSha256:K}),/asset-invalid/);
});

test('repair acceptance requires a separately bound operator receipt and moves away from failed head',async()=>{
 const adapter=new G5FixtureAuthorityAdapter({fixtures,port:{async inspectFixtureTask(intent){return response(intent);}}});
 const [create,parameter,mechanism,repair]=fixtures.sequence;
 await adapter.inspect({task:create,workspaceId:'workspace-a',sessionId:'session-a',turnId:'turn-a',version:source('revision-a',H)});
 await adapter.inspect({task:parameter,workspaceId:'workspace-a',sessionId:'session-a',turnId:'turn-b',version:source('revision-b',H)});
 const mechanismVersion=source('revision-c',L);await adapter.inspect({task:mechanism,workspaceId:'workspace-a',sessionId:'session-a',turnId:'turn-c',version:mechanismVersion});
 await assert.rejects(adapter.inspect({task:repair,workspaceId:'workspace-a',sessionId:'session-a',turnId:'turn-d',version:source('revision-d',L)}),/seeded-failure-proof-required/);
 const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},intent=createSeededFailureOperatorIntent({windowId:'g5-a-window',fixture:repair,scope,sessionId:'session-a',currentVersion:mechanismVersion,asset:fixtures.assets.seededFailure,predecessorAuthorityReceiptSha256:K});
 const receipt={schemaVersion:1,purpose:intent.purpose,windowId:intent.windowId,fixtureId:intent.fixtureId,scope,sessionId:intent.sessionId,baseHead:intent.expectedCurrentHead,injectedHead:source('failure-revision',K),mutation:intent.mutation,validationArtifact:{artifactId:'failure-artifact',artifactSha256:H,sourceSha256:intent.mutation.sha256,revisionId:'failure-revision',outcome:'failed',phase:'Python compile validation',exception:'SyntaxError',cause:'missing-colon-after-run-definition'},taskReceiptSha256:J,receiptSha256:K};
 adapter.recordSeededFailure(repair,receipt,{windowId:'g5-a-window',scope,sessionId:'session-a',currentVersion:mechanismVersion});
 const accepted=await adapter.inspect({task:repair,workspaceId:'workspace-a',sessionId:'session-a',turnId:'turn-d',version:source('revision-d',L)});assert.equal(accepted.fixtureId,repair.fixtureId);
});

test('architecture audit refuses to claim an executable seeded failure path',()=>{
 const audit=seededFailureArchitectureAudit();assert.equal(audit.supported,false);assert.equal(audit.authorized,false);assert.equal(audit.code,'g5-seeded-failure-authority-not-implemented');assert.equal(audit.missing.length,5);assert.deepEqual(audit.options.map(v=>[v.id,v.normalTasks,v.maximumProbes]),[['A',64,2],['B',63,3]]);
});
