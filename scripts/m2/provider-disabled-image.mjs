const ACTIVE_COPY = 'COPY --chown=root:root --chmod=0444 services/trusted-pi/release-unconfigured.mjs /opt/riffology/trusted-pi/trusted-pi-release.mjs';
const CANDIDATE_COPY = 'COPY --chown=root:root --chmod=0444 services/trusted-pi/release-candidate.mjs /opt/riffology/trusted-pi/trusted-pi-release.mjs';

/**
 * Build-only transformation for the local provider-disabled acceptance run.
 * The product Dockerfile remains fail closed; the generated Dockerfile changes
 * exactly its active release copy and records the validation profile in image
 * metadata. It is never used by a Wrangler product configuration.
 */
export function providerDisabledValidationDockerfile(source) {
  if (typeof source !== 'string' || source.split(ACTIVE_COPY).length !== 2
    || !source.includes('services/trusted-pi/release-candidate.mjs /opt/riffology/trusted-pi/release-candidate.mjs')) {
    throw new Error('trusted-pi-product-dockerfile-drift');
  }
  return source.replace(ACTIVE_COPY,
    `${CANDIDATE_COPY}\nLABEL cn.gaojihe.riffology.validation-profile="m2-provider-disabled-v1"`);
}

export const providerDisabledValidationProfile = Object.freeze({
  name: 'm2-provider-disabled-v1',
  turnGate: true,
  providerGate: false,
  expectedTerminal: 'failed',
  expectedErrorCode: 'pi-turn-failed',
  externalModelCalls: 0,
});
