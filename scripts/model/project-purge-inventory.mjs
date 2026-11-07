import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const FROZEN_PURGE_DIGEST='e418ac2d10eba71eda7a7cb276e5cd325359dd26027fb5adaa0609049a010640';
const identityFields=['created_at','generation','owner_user_id','project_id','tenant_id','workspace_generation','workspace_id'];
const hashPattern=/^[a-f0-9]{64}$/;
export const metadataHash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail=code=>{throw Error('project-purge-'+code);};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(value);
const compare=(a,b)=>a<b?-1:a>b?1:0;

/** Reject HTTP-200 SQL failures and metadata that cannot prove a SELECT-only capture. */
export function d1ReadResults(response,expectedStatements){
  if(response?.success!==true||response.status!==200||response.error||!Array.isArray(response.errors)||response.errors.length||!Array.isArray(response.result)||response.result.length!==expectedStatements)fail('d1-read-unconfirmed');
  for(const result of response.result){
    const m=result?.meta;
    if(result?.success!==true||result.error||!Array.isArray(result.results)||!m||m.rows_written!==0||m.changes!==0||m.changed_db!==false||m.served_by_primary!==true)fail('d1-read-unconfirmed');
  }
  return response.result.map(result=>result.results);
}

export function durableReadResults(response,expectedStatements){
  const results=response?.result?.results;
  if(response?.success!==true||response.status!==200||response.error||response.result?.error||!Array.isArray(response.errors)||response.errors.length||!Array.isArray(results)||results.length!==expectedStatements)fail('durable-read-unconfirmed');
  return results.map(result=>{
    if(result.error||result.meta?.rows_written!==0||!Array.isArray(result.columns)||new Set(result.columns).size!==result.columns.length||!result.columns.every(k=>typeof k==='string')||!Array.isArray(result.rows))fail('durable-read-unconfirmed');
    return result.rows.map(row=>{
      if(!Array.isArray(row)||row.length!==result.columns.length)fail('durable-read-unconfirmed');
      return Object.fromEntries(result.columns.map((key,i)=>[key,row[i]]));
    });
  });
}

/** Identity match only. This is never a release proof or permission to delete. */
export function matchFrozenProjects(audit,response,expectedDigest){
  if(!hashPattern.test(expectedDigest)||audit?.targetIdentityDigest!==expectedDigest||audit.schema!=='riffology-extensibility-audit/v1'||audit.projectCount!==audit.projects?.length||audit.projects.length===0||JSON.stringify([...audit.targetIdentityFields].sort())!==JSON.stringify(identityFields))fail('frozen-scope-invalid');
  const [rows]=d1ReadResults(response,1),byHash=new Map(),seen=new Set();
  for(const row of rows){
    for(const key of ['project_id','tenant_id','workspace_id','owner_user_id'])if(!identifier(row[key]))fail('identity-invalid');
    for(const key of ['generation','workspace_generation','created_at'])if(!Number.isSafeInteger(row[key])||row[key]<(key==='created_at'?0:1))fail('identity-invalid');
    if(seen.has(row.project_id))fail('duplicate-project');seen.add(row.project_id);byHash.set(metadataHash(row.project_id),row);
  }
  const targetHashes=new Set(),targets=[];
  for(const frozen of audit.projects){
    if(![frozen.project_sha256,frozen.tenant_sha256,frozen.workspace_sha256,frozen.identity_sha256].every(h=>hashPattern.test(h))||targetHashes.has(frozen.project_sha256))fail('frozen-scope-invalid');
    targetHashes.add(frozen.project_sha256);
    const row=byHash.get(frozen.project_sha256);if(!row)fail('target-missing');
    const identity=Object.fromEntries(identityFields.map(key=>[key,row[key]]));
    if(metadataHash(identity)!==frozen.identity_sha256||metadataHash(row.tenant_id)!==frozen.tenant_sha256||metadataHash(row.workspace_id)!==frozen.workspace_sha256||row.generation!==frozen.generation||row.workspace_generation!==frozen.workspace_generation)fail('identity-drift');
    targets.push(identity);
  }
  targets.sort((a,b)=>compare(a.project_id,b.project_id));
  // The original digest orders rows by original project ID, with sorted object keys.
  // Sorting the public project hashes produces a different, invalid digest.
  if(metadataHash(targets)!==expectedDigest)fail('manifest-digest-conflict');
  if(new Set(targets.map(row=>row.owner_user_id)).size!==audit.ownerCount)fail('owner-count-conflict');
  return {targets,excluded:rows.filter(row=>!targetHashes.has(metadataHash(row.project_id))),summary:{targetIdentityDigest:expectedDigest,matchedProjects:targets.length,excludedProjects:rows.length-targets.length,ownerCount:audit.ownerCount}};
}

export function matchPublicationReferences(audit,inventory,response){
  const [copies,versions,submissions]=d1ReadResults(response,4);
  const targetIds=new Set(inventory.targets.map(row=>row.project_id));
  const frozenVersions=new Set(audit.associatedModelVersionSha256),frozenSubmissions=new Set(audit.associatedSubmissionSha256);
  if(frozenVersions.size!==audit.associatedModelVersionCount||frozenSubmissions.size!==audit.submissionCount)fail('reference-scope-invalid');
  const matchedVersions=versions.filter(row=>frozenVersions.has(metadataHash(row.id))),matchedSubmissions=submissions.filter(row=>frozenSubmissions.has(metadataHash(row.id)));
  if(matchedVersions.length!==frozenVersions.size||matchedSubmissions.length!==frozenSubmissions.size)fail('reference-target-missing');
  for(const row of matchedSubmissions){const target=inventory.targets.find(t=>t.project_id===row.project_id);if(!target||target.tenant_id!==row.tenant_id||target.workspace_id!==row.workspace_id)fail('submission-scope-conflict');}
  const related=copies.filter(row=>frozenVersions.has(metadataHash(row.source_model_version_id)));
  const outside=related.filter(row=>!targetIds.has(row.project_id));
  return {matchedModelVersions:matchedVersions.length,matchedSubmissions:matchedSubmissions.length,copyReferences:related.length,outsideProjectReferences:outside.map(row=>({projectSha256:metadataHash(row.project_id),modelVersionSha256:metadataHash(row.source_model_version_id)})),sharedObjectDeletionReady:false};
}

/** Summarize only the captured ledgers; never infer physical release from them. */
export function summarizeCapturedLedgers(inventory,betaResponse,ledgerResponses,quotaResponses){
  const targetIds=new Set(inventory.targets.map(t=>t.project_id)),tenantIds=new Set(inventory.targets.map(t=>t.tenant_id));
  const classify=rows=>{
    for(const row of rows)if(!identifier(row.project_id)||!Number.isSafeInteger(row.n)||row.n<1)fail('ledger-row-invalid');
    return {inside:rows.filter(r=>targetIds.has(r.project_id)),outside:rows.filter(r=>!targetIds.has(r.project_id))};
  };
  const [slots,calls]=durableReadResults(betaResponse,2);
  if(slots.some(r=>!['admitting','active','quarantined','released'].includes(r.status))||calls.some(r=>!['reserved','dispatched','unknown'].includes(r.status)))fail('ledger-row-invalid');
  const activeSlots=classify(slots.filter(r=>r.status!=='released')),betaCalls=classify(calls);
  const ledgerKeys=new Set(),unknown=[];
  for(const entry of ledgerResponses){
    const key=entry.ledger+':'+entry.tenant;
    if(!['legacy','g5','pi'].includes(entry.ledger)||!tenantIds.has(entry.tenant)||ledgerKeys.has(key))fail('ledger-coverage-invalid');ledgerKeys.add(key);
    const [rows]=durableReadResults(entry.response,1);
    for(const row of classify(rows).inside){
      if(!['reserved','dispatched','unknown'].includes(row.status)||!Number.isSafeInteger(row.isolated)||row.isolated<0||row.isolated>row.n)fail('ledger-row-invalid');
      unknown.push({ledger:entry.ledger,projectSha256:metadataHash(row.project_id),status:row.status,reconciliation:row.reconciliation,count:row.n,isolationRows:row.isolated});
    }
  }
  if(ledgerKeys.size!==tenantIds.size*3)fail('ledger-coverage-invalid');
  const quotaTenants=new Set(),leases=[];
  for(const entry of quotaResponses){
    if(!tenantIds.has(entry.tenant)||quotaTenants.has(entry.tenant))fail('quota-coverage-invalid');quotaTenants.add(entry.tenant);
    const [rows]=durableReadResults(entry.response,1);
    for(const row of classify(rows).inside){if(!['held','dispatched','unknown'].includes(row.status))fail('ledger-row-invalid');leases.push({projectSha256:metadataHash(row.project_id),status:row.status,count:row.n});}
  }
  if(quotaTenants.size!==tenantIds.size)fail('quota-coverage-invalid');
  const sum=rows=>rows.reduce((n,r)=>n+r.n,0);
  return {targetBetaOccupiedSlots:sum(activeSlots.inside),outsideBetaOccupiedSlots:sum(activeSlots.outside),targetBetaUnresolvedCalls:sum(betaCalls.inside),historicalUnresolvedCalls:unknown,targetUnreleasedTenantQuotaLeases:leases,physicalReleaseVerified:false,isolationDocumentsVerified:false};
}

// Offline CLI: no credentials, fetches, writes, deletion SQL or execution retries.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [auditPath,inventoryPath,referencesPath,betaPath,ledgerPath,quotaPath]=process.argv.slice(2);
  if(process.argv.length!==8)throw Error('usage: node scripts/model/project-purge-inventory.mjs AUDIT INVENTORY REFERENCES BETA LEDGERS QUOTA');
  const read=file=>JSON.parse(readFileSync(file,'utf8'));
  const audit=read(auditPath),inventory=matchFrozenProjects(audit,read(inventoryPath),FROZEN_PURGE_DIGEST);
  console.log(JSON.stringify({schema:'riffology-project-purge-preflight/v1',scope:inventory.summary,references:matchPublicationReferences(audit,inventory,read(referencesPath)),ledgers:summarizeCapturedLedgers(inventory,read(betaPath),read(ledgerPath),read(quotaPath)),deletionReady:false},null,2));
}
