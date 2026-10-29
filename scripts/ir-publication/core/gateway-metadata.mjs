/** Read/PUT representation adapter only. No transport or execution entry. */
import {buildGatewayMetadata as originalBuild,hashJSON} from './a2/ir-publication-candidate.mjs';
import {guard} from './io-boundary.mjs';
import {preservationProjection} from './collect-baseline.mjs';
const empty=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===0;
export function buildGatewayMetadata(baseline,options){
  // First retain the original complete-baseline and exact-preservation checks.
  const {baselineProjectionSha256,...metadataOptions}=options;
  guard(/^[a-f0-9]{64}$/.test(baselineProjectionSha256??''),'approved-preservation-baseline-required');
  const original=originalBuild(baseline,metadataOptions),placement=baseline.controls.settings.placement;
  guard(hashJSON(preservationProjection(baseline))===baselineProjectionSha256,'approved-preservation-baseline-drift');
  if(!Object.hasOwn(baseline.controls.settings,'placement')||!empty(placement))return original;
  guard(Object.hasOwn(original,'placement')&&empty(original.placement),'empty-placement-original-link');
  const wire={...original};delete wire.placement;
  guard(hashJSON({...wire,placement})===hashJSON(original),'only-empty-placement-wire-omission');
  return wire;
}
