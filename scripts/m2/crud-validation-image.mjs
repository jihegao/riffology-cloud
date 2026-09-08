const ACTIVE_COPY='COPY --chown=root:root --chmod=0444 services/trusted-pi/release-unconfigured.mjs /opt/riffology/trusted-pi/trusted-pi-release.mjs';
export function crudValidationDockerfile(source){
  if(typeof source!=='string'||source.split(ACTIVE_COPY).length!==2||!source.includes('services/trusted-pi/release-candidate.mjs /opt/riffology/trusted-pi/release-candidate.mjs'))throw Error('trusted-pi-product-dockerfile-drift');
  return source.replace(ACTIVE_COPY,[
    'COPY --chown=root:root --chmod=0444 scripts/m2/crud-validation-fixture.mjs /opt/riffology/trusted-pi/crud-validation-fixture.mjs',
    'COPY --chown=root:root --chmod=0444 scripts/m2/crud-validation-release.mjs /opt/riffology/trusted-pi/trusted-pi-release.mjs',
    'LABEL cn.gaojihe.riffology.validation-profile="m2-crud-fixture-v1"',
  ].join('\n'));
}
export const crudValidationProfile=Object.freeze({name:'m2-crud-fixture-v1',turnGate:true,providerGate:false,expectedTerminal:'completed',expectedErrorCode:null,externalModelCalls:0,mutationCount:20,recoveryReadCount:4,providerTransport:'in-process deterministic completions SSE fixture'});
