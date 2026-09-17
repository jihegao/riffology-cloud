import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { productionProfile, profileDigest, conservativeCost } from '../../services/model-proxy/production-profile.ts';
export const tasks=[
 {id:'create-model',prompt:'Create a queue model with explicit arrivals, service process, assumptions, parameters, metrics and limitations. Save a valid Model Spec and run the Python validation.'},
 {id:'parameter-change',prompt:'Change the arrival-rate parameter using the experiment controls. Run a baseline and an intervention without editing model source. Explain the exact saved result IDs.'},
 {id:'mechanism-change',prompt:'Add abandonment after a waiting threshold. Update the mechanism, assumptions and Model Spec together; validate Python and save the new model revision.'},
 {id:'repair-validation',prompt:'Inspect the seeded Python validation failure. Fix its cause, run validation again, and cite the failed validation Tool Ledger evidence and repaired saved Revision separately.'},
 {id:'measured-evidence',prompt:'Compare baseline and intervention across the fixed seeds. Explain the measured difference using persisted evidence cards and exact Experiment, Run, metric and artifact references.'},
 {id:'reopen-continue',prompt:'Reopen the saved project, inspect its actual files and prior results, then extend the model and validate the saved revision. Keep old-version results marked as historical.'},
];
const positive=(v,label)=>{if(!Number.isSafeInteger(v)||v<1)throw Error(`missing-or-invalid-${label}`);return v;};
const hash=(v,label)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw Error(`missing-or-invalid-${label}`);return v;};
/** Offline only: validates a proposed bounded evaluation, never contacts any
 * account/provider, reads credentials, or interprets this manifest as approval. */
export async function benchmarkPlan(input){
 const p=productionProfile(input.profile),profileSha256=await profileDigest(p);
 if(hash(input.profileSha256,'profile-hash')!==profileSha256)throw Error('profile-hash-mismatch');
 hash(input.runtimeSha256,'runtime-hash');hash(input.taskFixturesSha256,'task-fixtures-hash');hash(input.privacyEvidenceSha256,'privacy-evidence');hash(input.gatewayNoRetryEvidenceSha256,'gateway-retry-evidence');
 for(const key of ['operator','accountReference','authorizationReference','rateCardSource','rateCardCheckedAt','deadline'])if(typeof input[key]!=='string'||!input[key].trim())throw Error(`missing-${key}`);
 if(!/^https:\/\//.test(input.rateCardSource)||!Number.isFinite(Date.parse(input.rateCardCheckedAt))||!Number.isFinite(Date.parse(input.deadline)))throw Error('invalid-source-or-date');
 const maxCallsPerTask=positive(input.maxCallsPerTask,'calls-per-task'),concurrency=positive(input.concurrency,'concurrency');if(maxCallsPerTask>32||concurrency>4)throw Error('evaluation-bound-too-large');
 const perCall=conservativeCost(p,p.limits.maxInputTokens,p.limits.maxOutputTokens),perTask=BigInt(perCall)*BigInt(maxCallsPerTask),total=perTask*18n;
 const globalCap=positive(input.globalCapNanodollars,'global-cap'),turnCap=positive(input.turnCapNanodollars,'turn-cap');
 if(total>BigInt(globalCap)||perTask>BigInt(turnCap))throw Error('manifest-budget-too-small-for-worst-case');
 positive(input.targets?.p95TurnMs,'latency-target');positive(input.targets?.maxCostPerAcceptedTaskNanodollars,'accepted-task-cost-target');
 return {schemaVersion:1,kind:'offline-evaluation-plan-not-authorization',profileSha256,attempts:tasks.flatMap(task=>[1,2,3].map(repeat=>({...task,repeat,maxCalls:maxCallsPerTask}))),concurrency,maximumNanodollars:Number(total),stopOn:['deadline','global-cap','unknown-charge','credential-boundary-failure','fabricated-execution-claim'],requiredEvidence:['ordinary-user-UI','tool-events','saved-files','revision','Python-result','Run-artifacts','provider-usage','money-ledger'],proposedMinimum:{acceptedTasks:16,perCategory:2,securityOrFabricationFailures:0}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==3)throw Error('usage: node scripts/model/benchmark-plan.mjs manifest.json (offline validation only)');const input=JSON.parse(await readFile(process.argv[2],'utf8'));process.stdout.write(JSON.stringify(await benchmarkPlan(input),null,2)+'\n');}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
