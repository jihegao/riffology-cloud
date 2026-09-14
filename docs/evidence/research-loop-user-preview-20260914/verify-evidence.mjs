import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
const sha256 = name => createHash('sha256').update(readFileSync(join(root, name))).digest('hex');
const version = value => JSON.stringify(value);

const release = read('release-readback.json');
const cloud = read('final-cloud-readback.json');
assert.equal(release.sourceCommit, cloud.sourceCommit);
assert.equal(version(release.worker), version(cloud.worker));
assert(Object.values(release.gates).every(Boolean));
assert(Object.values(cloud.gates).every(Boolean));
assert.equal(cloud.workspace.admission, 'enabled');
for (const key of ['activeTurnId', 'resourceWait', 'releaseHold', 'recoveryHold']) assert.equal(cloud.workspace[key], null);
assert.equal(cloud.containers.nonInactiveTotal, 0);
for (const value of Object.values(cloud.containers).filter(value => typeof value === 'object')) {
  assert.equal(value.nonInactive, 0);
  assert.equal(value.total, value.inactive);
}

const original = read('original-experiment.json');
const originalClaim = read('evidence-claim.json');
assert.equal(original.status, 'completed');
assert.equal(original.progress.completed, original.progress.total);
assert.equal(originalClaim.experimentId, original.groupId);
assert.equal(originalClaim.evidenceValidity, 'verified');
assert.equal(originalClaim.stale, false);
assert.equal(originalClaim.referenceCount, original.runs.length);
assert.equal(version(originalClaim.revisionId), version(original.version.revisionId));

const change = read('assumption-change.json');
const experiment = read('assumption-experiment.json');
const claim = read('assumption-evidence-claim.json');
const workspace = read('final-workspace-readback.json');
const modelSpec = read('assumption-model/model-spec.json');
assert.equal(change.persistenceOutcome, 'saved');
assert.equal(change.persistenceErrorCode, null);
assert.equal(change.savedVersion.specSha256, sha256('assumption-model/model-spec.json'));
assert(modelSpec.mechanisms.includes('deterministic service duration equal to 1/service_rate'));
assert(modelSpec.assumptions.includes('Each served customer has deterministic service duration equal to 1/service_rate'));
assert.equal(version(change.savedVersion.revisionId), version(experiment.version.revisionId));
assert.equal(change.savedVersion.filesSha256, experiment.version.filesSha256);
assert.equal(change.savedVersion.specSha256, experiment.version.specSha256);
assert.equal(experiment.status, 'completed');
assert.equal(experiment.progress.completed, experiment.progress.total);
assert(experiment.runs.every(run => run.status === 'completed' && run.released && run.summaryCsvSha256));
assert.equal(claim.experimentId, experiment.groupId);
assert.equal(claim.evidenceValidity, 'verified');
assert.equal(claim.stale, false);
assert.equal(claim.olderRevision, false);
assert.equal(claim.references.length, experiment.runs.length);
for (const reference of claim.references) {
  const run = experiment.runs.find(candidate => candidate.runId === reference.runId);
  assert(run);
  assert.equal(reference.artifactSha256, run.artifactSha256);
}
assert.equal(workspace.model.version.revisionId, experiment.version.revisionId);
assert.equal(workspace.model.version.filesSha256, experiment.version.filesSha256);
assert.equal(workspace.model.version.specSha256, experiment.version.specSha256);
assert.equal(workspace.acceptedAssumptionExperiment.groupId, experiment.groupId);
assert.equal(workspace.verifiedAssumptionClaimId, claim.claimId);

const manifest = read('export-manifest.json');
const replay = read('export-replay.json');
assert.equal(manifest.exportId, replay.exportId);
assert.equal(replay.verifyOnly.verified, true);
assert.equal(replay.matches, true);
assert(Object.values(replay.metrics).every(metric => metric.matches));
assert(Object.values(replay.outputs).every(Boolean));
assert(manifest.runs.some(run => run.runId === replay.runId && run.status === 'completed'));

console.log(JSON.stringify({
  status: 'passed',
  sourceCommit: cloud.sourceCommit,
  originalGroupId: original.groupId,
  assumptionRevisionId: experiment.version.revisionId,
  assumptionGroupId: experiment.groupId,
  assumptionClaimId: claim.claimId,
  exportId: manifest.exportId,
  nonInactiveTotal: cloud.containers.nonInactiveTotal
}, null, 2));
