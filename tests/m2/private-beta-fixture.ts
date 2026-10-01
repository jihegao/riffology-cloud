import {profile} from './production-profile-fixture.ts';
import {profileDigest} from '../../services/model-proxy/production-profile.ts';
import type {PrivateBetaPolicyV1,PrivateBetaPolicyV2} from '../../services/model-budget/private-beta-policy.ts';
export async function betaPolicy():Promise<PrivateBetaPolicyV1>{return {
 schemaVersion:1,policyId:'beta-test-v1',enabled:true,admission:'accepted-invitation-personal-projects',dayBoundary:'UTC',profileSha256:await profileDigest(profile),startsAt:Date.now()-1000,reviewAt:Date.now()+604800000,
 maxActiveTurns:2,maxCallsPerUserDay:80,maxCallsPerDay:240,maxNanodollarsPerUserDay:2000000000,maxNanodollarsPerDay:5000000000,maxNanodollarsTotal:20000000000,maxNanodollarsPerTurn:600000000,maxCallsPerTurn:32,maxPendingCalls:32,maxPendingNanodollars:2000000000,maxCallDurationMs:360000,maxToolDurationMs:60000,maxTurnDurationMs:900000,releaseTimeoutMs:60000,monitorIntervalMs:60000,alertPercent:80,historicalIsolation:[]};}

export function meterOnlyPolicy(p:PrivateBetaPolicyV1):PrivateBetaPolicyV2{
 const {maxCallsPerUserDay,maxCallsPerDay,maxNanodollarsPerUserDay,maxNanodollarsPerDay,maxNanodollarsTotal,maxNanodollarsPerTurn,maxCallsPerTurn,maxPendingCalls,maxPendingNanodollars,alertPercent,...gates}=p;
 return {...gates,schemaVersion:2,quotaMode:'meter-only',warningCallsPerMinute:20,warningNanodollarsPerMinute:1_000_000_000,billingPendingWarningMs:3_600_000};
}
