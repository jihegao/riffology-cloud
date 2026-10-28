import test from 'node:test';
import assert from 'node:assert/strict';
import {d1ReadResults,durableReadResults,matchFrozenProjects,matchPublicationReferences,metadataHash,summarizeCapturedLedgers} from '../../scripts/model/project-purge-inventory.mjs';

const d1=(...rows)=>({status:200,success:true,errors:[],result:rows.map(results=>({success:true,results,meta:{rows_written:0,changes:0,changed_db:false,served_by_primary:true}}))});
const durable=(...rows)=>({status:200,success:true,errors:[],result:{results:rows.map(values=>{const columns=Object.keys(values[0]??{});return {columns,rows:values.map(row=>columns.map(k=>row[k])),meta:{rows_written:0}};})}});
function fixture(){
  const identities=[1,2].map(n=>({created_at:100+n,generation:1,owner_user_id:'owner',project_id:'project-'+n,tenant_id:'tenant',workspace_generation:1,workspace_id:'workspace-'+n}));
  const digest=metadataHash(identities),audit={schema:'riffology-extensibility-audit/v1',targetIdentityDigest:digest,targetIdentityFields:Object.keys(identities[0]).reverse(),projectCount:2,ownerCount:1,
    projects:identities.map(p=>({project_sha256:metadataHash(p.project_id),tenant_sha256:metadataHash(p.tenant_id),workspace_sha256:metadataHash(p.workspace_id),identity_sha256:metadataHash(p),generation:1,workspace_generation:1})).reverse(),
    associatedModelVersionCount:1,submissionCount:1,associatedModelVersionSha256:[metadataHash('version')],associatedSubmissionSha256:[metadataHash('submission')]};
  const newer={...identities[0],project_id:'new-project',workspace_id:'new-workspace',created_at:200};
  const response=d1([...identities,newer].reverse()),inventory=matchFrozenProjects(audit,response,digest);
  const references=d1([{project_id:'project-2',source_model_version_id:'version'}],[{id:'version'}],[{id:'submission',project_id:'project-1',workspace_id:'workspace-1',tenant_id:'tenant'}],[]);
  const beta=durable([{project_id:'project-1',status:'released',n:2},{project_id:'new-project',status:'active',n:1}],[]);
  const ledgers=['legacy','g5','pi'].map(ledger=>({ledger,tenant:'tenant',response:durable(ledger==='legacy'?[{project_id:'project-1',status:'unknown',reconciliation:'pending',n:1,isolated:1}]:[])}));
  const quotas=[{tenant:'tenant',response:durable([])}];
  return {identities,digest,audit,response,inventory,references,beta,ledgers,quotas};
}

test('matches canonical original identity digest, independent of public hash order; later projects stay excluded',()=>{
  const f=fixture();assert.deepEqual(f.inventory.targets,f.identities);
  assert.deepEqual(f.inventory.summary,{targetIdentityDigest:f.digest,matchedProjects:2,excludedProjects:1,ownerCount:1});
  assert.equal(f.inventory.excluded[0].project_id,'new-project');
  const wrong={...f.audit,targetIdentityDigest:'f'.repeat(64)};
  assert.throws(()=>matchFrozenProjects(wrong,f.response,'f'.repeat(64)),/manifest-digest-conflict/);
});

test('a missing project, identity drift, duplicated row or duplicated frozen item cannot select a deletion scope',()=>{
  const f=fixture();
  for(const field of ['tenant_id','owner_user_id','workspace_id','created_at','generation','workspace_generation']){
    const response=structuredClone(f.response),row=response.result[0].results.find(r=>r.project_id==='project-1');row[field]=typeof row[field]==='number'?row[field]+1:'changed';
    assert.throws(()=>matchFrozenProjects(f.audit,response,f.digest),/identity-drift/);
  }
  assert.throws(()=>matchFrozenProjects(f.audit,d1([f.identities[0]]),f.digest),/target-missing/);
  assert.throws(()=>matchFrozenProjects(f.audit,d1([...f.identities,f.identities[0]]),f.digest),/duplicate-project/);
  const duplicate={...f.audit,projects:[f.audit.projects[0],f.audit.projects[0]]};
  assert.throws(()=>matchFrozenProjects(duplicate,f.response,f.digest),/frozen-scope-invalid/);
});

test('D1 HTTP success does not hide SQL errors, writes, missing statements or non-primary reads',()=>{
  for(const change of [r=>{r.result[0].success=false;},r=>{r.result[0].error='denied';},r=>{r.result[0].meta.rows_written=1;},r=>{r.result[0].meta.changes=1;},r=>{r.result[0].meta.changed_db=true;},r=>{r.result[0].meta.served_by_primary=false;},r=>{delete r.result[0].meta;},r=>{r.errors=[{message:'failed'}];}]){
    const response=d1([]);change(response);assert.throws(()=>d1ReadResults(response,1),/d1-read-unconfirmed/);
  }
  assert.throws(()=>d1ReadResults(d1([]),2),/d1-read-unconfirmed/);
});

test('DO access errors and missing tables remain unconfirmed, even inside HTTP-200 success envelopes',()=>{
  for(const error of ['access to _cf_KV.key is prohibited: SQLITE_AUTH','no such table: model_calls: SQLITE_ERROR']){
    assert.throws(()=>durableReadResults({status:200,success:true,errors:[],result:{results:[],error}},1),/durable-read-unconfirmed/);
  }
  const response=durable([{n:1}]);response.result.results[0].meta.rows_written=1;
  assert.throws(()=>durableReadResults(response,1),/durable-read-unconfirmed/);
  const malformed=durable([{n:1}]);malformed.result.results[0].rows=[[]];
  assert.throws(()=>durableReadResults(malformed,1),/durable-read-unconfirmed/);
});

test('new external copies are reported without recursively adding their projects or claiming complete shared references',()=>{
  const f=fixture();f.references.result[0].results.push({project_id:'new-project',source_model_version_id:'version'});
  const result=matchPublicationReferences(f.audit,f.inventory,f.references);
  assert.equal(result.copyReferences,2);assert.deepEqual(result.outsideProjectReferences,[{projectSha256:metadataHash('new-project'),modelVersionSha256:metadataHash('version')}]);
  assert.equal(result.sharedObjectDeletionReady,false);assert.equal(f.inventory.targets.length,2);
  f.references.result[2].results[0].workspace_id='new-workspace';
  assert.throws(()=>matchPublicationReferences(f.audit,f.inventory,f.references),/submission-scope-conflict/);
});

test('missing publication targets are not treated as prior successful deletion',()=>{
  const f=fixture();f.references.result[1].results=[];
  assert.throws(()=>matchPublicationReferences(f.audit,f.inventory,f.references),/reference-target-missing/);
});

test('ledger-only results retain isolated unknowns, distinguish outside activity and cannot attest physical release',()=>{
  const f=fixture(),result=summarizeCapturedLedgers(f.inventory,f.beta,f.ledgers,f.quotas);
  assert.equal(result.targetBetaOccupiedSlots,0);assert.equal(result.outsideBetaOccupiedSlots,1);assert.equal(result.targetBetaUnresolvedCalls,0);
  assert.deepEqual(result.historicalUnresolvedCalls,[{ledger:'legacy',projectSha256:metadataHash('project-1'),status:'unknown',reconciliation:'pending',count:1,isolationRows:1}]);
  assert.deepEqual(result.targetUnreleasedTenantQuotaLeases,[]);assert.equal(result.physicalReleaseVerified,false);assert.equal(result.isolationDocumentsVerified,false);
  assert.doesNotMatch(JSON.stringify(result),/project-1|new-project|workspace-|owner/);
});

test('every original tenant and ledger must be covered exactly once; foreign, missing or repeated authorities fail',()=>{
  const f=fixture();
  for(const ledgers of [f.ledgers.slice(1),[...f.ledgers,f.ledgers[0]],[...f.ledgers,{...f.ledgers[0],tenant:'foreign'}]])assert.throws(()=>summarizeCapturedLedgers(f.inventory,f.beta,ledgers,f.quotas),/ledger-coverage-invalid/);
  assert.throws(()=>summarizeCapturedLedgers(f.inventory,f.beta,f.ledgers,[]),/quota-coverage-invalid/);
  const invalid=structuredClone(f.ledgers);invalid[0].response=durable([{project_id:null,status:'unknown',n:1,isolated:0}]);
  assert.throws(()=>summarizeCapturedLedgers(f.inventory,f.beta,invalid,f.quotas),/ledger-row-invalid/);
});
