import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { providerDisabledValidationDockerfile, providerDisabledValidationProfile } from '../../scripts/m2/provider-disabled-image.mjs';

test('provider-disabled validation image activates only the reviewed candidate in generated build input', () => {
  const product = readFileSync(new URL('../../Dockerfile.trusted-pi.cloud', import.meta.url), 'utf8');
  const generated = providerDisabledValidationDockerfile(product);
  assert.match(product, /release-unconfigured\.mjs \/opt\/riffology\/trusted-pi\/trusted-pi-release\.mjs/);
  assert.doesNotMatch(product, /validation-profile/);
  assert.match(generated, /release-candidate\.mjs \/opt\/riffology\/trusted-pi\/trusted-pi-release\.mjs/);
  assert.match(generated, /m2-provider-disabled-v1/);
  assert.doesNotMatch(generated, /release-unconfigured\.mjs \/opt\/riffology\/trusted-pi\/trusted-pi-release\.mjs/);
  assert.deepEqual(providerDisabledValidationProfile, {
    name: 'm2-provider-disabled-v1', turnGate: true, providerGate: false,
    expectedTerminal: 'failed', expectedErrorCode: 'pi-turn-failed', externalModelCalls: 0,
  });
});
