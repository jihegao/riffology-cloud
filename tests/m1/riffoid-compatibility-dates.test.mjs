import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const read=async path=>JSON.parse(await readFile(path,'utf8'));

test('entry fixture date stays separate while Gateway/rollback retain independently read live date',async()=>{
  const dates=await read('infra/riffoid-compatibility-dates.json');
  const frozen=await read(dates.gatewaySource.snapshot);
  const fresh=(await read('docs/evidence/riffoid-entry-date-correction-20261008.json')).liveReadback;
  const overlay=(await read('docs/riffoid-two-account-security-overlay.example.jsonc')).signedEntryProductionRequest;
  const rollback=(await read('infra/riffoid-forward-rollback.request.jsonc')).gateway;
  const entry=JSON.parse((await readFile('infra/wrangler.riffoid-entry.template.jsonc','utf8')).replace(/^\s*\/\/.*$/gm,''));
  assert.equal(fresh.compatibilityDate,'2026-09-09');
  assert.equal(frozen.cloudflareReadOnly.gateway.scriptRuntime.compatibility_date,fresh.compatibilityDate);
  assert.equal(dates.gatewayCompatibilityDate,fresh.compatibilityDate);
  assert.equal(dates.gatewaySource.versionId,fresh.versionId);
  assert.equal(rollback.compatibilityDate,fresh.compatibilityDate);
  assert.equal(overlay.compatibilityFlagsExactChange.gatewayCompatibilityDateUnchanged,fresh.compatibilityDate);
  assert.equal(entry.compatibility_date,'2026-09-06');
  assert.equal(dates.entryFixtureCompatibilityDate,entry.compatibility_date);
  assert.equal(overlay.compatibilityFlagsExactChange.entryFixtureCompatibilityDate,entry.compatibility_date);
  assert.notEqual(entry.compatibility_date,fresh.compatibilityDate);
  assert.deepEqual(fresh.compatibilityFlags,['nodejs_compat','nodejs_compat_do_not_populate_process_env']);
  assert.deepEqual(overlay.compatibilityFlagsExactChange.gatewayAfter,[...fresh.compatibilityFlags,'enable_request_signal']);
  assert.equal(overlay.cancellationContract.preHeaderFINIndependentDeploymentBlocker,false);
});

test('built forward rollback manifest inherits Gateway live date and leaves actual production freeze missing',{timeout:15000},async()=>{
  await promisify(execFile)(process.execPath,['scripts/m1/build-riffoid-forward-rollback.mjs']);
  const manifest=await read('.local/riffoid-forward-rollback/manifest.json');
  const fresh=(await read('docs/evidence/riffoid-entry-date-correction-20261008.json')).liveReadback;
  assert.equal(manifest.compatibilityDate,fresh.compatibilityDate);
  assert.equal(manifest.compatibilityDateSource.versionId,fresh.versionId);
  assert.deepEqual(manifest.compatibilityFlags,[...fresh.compatibilityFlags,'enable_request_signal']);
  assert.ok(manifest.exports.includes('EntryReplayGuard'));
  assert.equal(manifest.status,'LOCAL_BUILD_NOT_PRODUCTION_FROZEN');
  for(const missing of ['replayNamespaceId','migrationHistory','productionConfigurationSnapshot','assetsHashes'])assert.equal(manifest[missing],null,missing);
});
