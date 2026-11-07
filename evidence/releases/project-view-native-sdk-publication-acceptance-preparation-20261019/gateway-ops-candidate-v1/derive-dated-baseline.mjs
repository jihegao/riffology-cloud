// One offline derivation. Original raw families and hashes remain authoritative.
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateDatedBaseline,projectDatedBaseline} from './dated-baseline.mjs';
import {save,buildMetadata,PINS} from './prepare-gateway-replacement.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url)),F=resolve(ROOT,'..'),APP='/Users/jihegao/apps/riffology-cloud',OLD='/Users/jihegao/.codex/worktrees/jhg46-pi-maintenance-admission/riffology-cloud/.local/jhg46-next-stage-preparation-20261018/gateway-ops-execution-v1';
const hash=b=>createHash('sha256').update(b).digest('hex'),refs=[];
async function raw(file,expected,method){const b=await readFile(file);if(hash(b)!==expected)throw Error('original-family-source-drift');refs.push({file,bytes:b.length,sha256:hash(b),method});return JSON.parse(b);}
const old=await raw(OLD+'/baseline-complete.private.json','4386ea1a12dc21191bb382cfb3728c2ad3390a4fff4ca5dcae7b466040729e1e','original section-derived full family records retained; dated expectation only');
const after=await raw(OLD+'/publication-attempts/f953bc1e-3ea1-4786-821c-26ecf68916a0/after.private.json','9a74070de069a05efb24dd641ceec1750d01b3f27000a5a7d6cd1722be2ee631','actual known original5a840 sender after snapshot; module identity only');
const targetOuter=await raw(APP+'/.local/jhg46-native-resource-host-rollout-acceptance-execution-20261018/browser-gate/listed-target-current-reconciliation.tool-result.private.json','14607e9f04ebe1073363ed9d4a7e4e6558a9a59965fe9da61657ee7f829b0e63','actual complete original current ec8/v13 target+two versions result');
const target=JSON.parse(targetOuter.content[0].text);if(target.credentialValueGuardPassed!==true)throw Error('target-credential-guard');
const settings=await raw(F+'/baseline-current-reads-v1/settings.private.json','2989f5427bd7571d64a53f2bb8a7d8c098eefb536688db3464319a8d5323d04c','root actual29GET segmented current settings result; deployment bracketed');
const version=await raw(F+'/baseline-current-reads-v1/version.private.json','d28e9bed33904c90b300b9cff3cdc5ab6c756be318ff12a6bbfabb7f35deb765','root actual29GET segmented current version4f887 result; deployment bracketed');
const deployments=await raw(F+'/baseline-current-reads-v1/deployments.private.json','ba809b05bfa01cf30149f18a9162a4ac7c79b284b75620f92a9ff0c74b548d89','root actual29GET current sole100percent deployment result');
await raw(F+'/baseline-current-reads-v1/safe-receipt.json','b5444106522453ac32daa498125352568b3d1f62975dcd9dafc798413cfe8368','actual GET trace/fragment reassembly/credential guard receipt');
const b={schema:'jhg46-sdk-dated-family-baseline/private-v1',accountId:old.accountId,worker:old.worker,derivedAt:new Date().toISOString(),notOriginalCompleteSnapshot:true,notExecutionWitness:true,notFresh:true,controls:{...structuredClone(old.controls),settings,deployments},version,source:after.source,apps:old.apps.map(a=>a.id===target.exactTarget.id?structuredClone(target.exactTarget):structuredClone(a)),appVersions:{...structuredClone(old.appVersions),[target.exactTarget.id]:structuredClone(target.versions)},familyProvenance:refs,coverage:'Current3 Worker families from actual29GET; unchanged controls/other15 apps/all original versions are dated original raw families; ec8 target+complete two versions original actual reconciliation. Entire combined stable/control matches final original54GET authority. Future fresh before/after remains mandatory.'};
validateDatedBaseline(b);const complete=await save(resolve(ROOT,'baseline-expectation.private.json'),b),safe=await save(resolve(ROOT,'baseline-expectation.safe.json'),projectDatedBaseline(b)),metadata=await save(resolve(ROOT,'metadata-without-jwt.private.json'),buildMetadata(b,{requestId:PINS.requestId}));
console.log(JSON.stringify({schema:'jhg46-sdk-dated-family-derivation/v1',complete,safe,metadata,strictStable64d4AndControl47cffMatched:true,credentialsRead:false,networkRequests:0,cloudWrites:0}));
