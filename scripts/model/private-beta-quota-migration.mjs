import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {privateBetaPolicy,privateBetaPolicyGates,PRIVATE_BETA_CAPACITY_ACTOR} from '../../services/model-budget/private-beta-policy.ts';
import {turnDigest} from '../../services/turn/protocol.ts';

/** Offline proposal only. Inputs come from the same paused live authority; no
 * network, provider request, ledger write or automatic operation happens here. */
export async function prepareQuotaMigration(previousRaw,state,snapshot,warnings={warningCallsPerMinute:60,warningNanodollarsPerMinute:1_000_000_000,billingPendingWarningMs:3_600_000}){
 const previousPolicy=privateBetaPolicy(previousRaw);
 if(previousPolicy?.schemaVersion!==1)throw Error('quota-migration-v1-required');
 const expectedPolicySha256=await turnDigest({...previousPolicy,enabled:false});
 if(state?.actor!==PRIVATE_BETA_CAPACITY_ACTOR||state.pinnedPolicySha256!==expectedPolicySha256||snapshot?.pinnedPolicySha256!==expectedPolicySha256||snapshot.policySha256!==expectedPolicySha256||state.paused!==true||snapshot.paused!==true||snapshot.schemaVersion!==1)throw Error('quota-migration-authority-mismatch');
 for(const field of ['ledgerSha256','slotSha256','callSha256','alertSha256','operationSha256'])if(typeof state[field]!=='string'||!/^[a-f0-9]{64}$/.test(state[field]))throw Error('quota-migration-state-invalid');
 for(const field of ['slotCount','callCount','operationCount','alertCount'])if(!Number.isSafeInteger(state[field])||state[field]<0)throw Error('quota-migration-state-invalid');
 if(!Array.isArray(snapshot.usage)||snapshot.usage.some(row=>!Number.isSafeInteger(row.calls)||row.calls<0||!Number.isSafeInteger(row.reservedNanodollars)||row.reservedNanodollars<0)||snapshot.usage.reduce((n,row)=>n+row.calls,0)!==state.callCount)throw Error('quota-migration-usage-mismatch');
 const nextPolicy=privateBetaPolicy({...privateBetaPolicyGates(previousPolicy),schemaVersion:2,enabled:previousPolicy.enabled,quotaMode:'meter-only',...warnings});
 const nextPolicySha256=await turnDigest({...nextPolicy,enabled:false});
 return {schemaVersion:1,kind:'offline-private-beta-quota-migration-plan',actor:PRIVATE_BETA_CAPACITY_ACTOR,previousPolicy,nextPolicy,expectedPolicySha256,nextPolicySha256,
  rpc:{method:'removeQuotas',arguments:{previousPolicy,expectedPolicySha256,expectedLedgerSha256:state.ledgerSha256}},
  before:{state,snapshot},preserve:{slotSha256:state.slotSha256,callSha256:state.callSha256,alertSha256:state.alertSha256,operationSha256:state.operationSha256,slotCount:state.slotCount,callCount:state.callCount,alertCount:state.alertCount,operationCount:state.operationCount,paused:true},
  postconditions:['Same actor; configured and pinned policy SHA equal nextPolicySha256.','Original slot/call/alert hashes and pause unchanged; exactly one migration and audit appended; original audits retained.','Private provider/tool request count unchanged.','No automatic resume; original unknown/release holds require original-authority reconciliation.']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [oldPolicyPath,statePath,snapshotPath,outputPath]=process.argv.slice(2);
 if(!outputPath)throw Error('usage: node scripts/model/private-beta-quota-migration.mjs v1-policy.json migration-state.json snapshot.json private-plan.json');
 const parse=async path=>JSON.parse(await readFile(path,'utf8'));
 const plan=await prepareQuotaMigration(await parse(oldPolicyPath),await parse(statePath),await parse(snapshotPath));
 await writeFile(outputPath,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
 process.stdout.write(JSON.stringify({actor:plan.actor,expectedPolicySha256:plan.expectedPolicySha256,nextPolicySha256:plan.nextPolicySha256,operationPrepared:true,operationExecuted:false})+'\n');
}
