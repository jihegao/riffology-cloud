/** Resource limits for the ordinary invited-user route. No call or money quotas.
 * The one-container release configuration bounds concurrency to one; raising
 * that limit requires a separate measured capacity change. */
export type InvitedRunsPolicy={schemaVersion:1;policyId:string;enabled:boolean;maxActiveRuns:1;maxRunsPerUser:1;maxGroupRuns:number;durationMs:number;releaseGuardMs:number;quietMs:number};
export const INVITED_RUN_CAPACITY_ACTOR='invited-run-capacity-v1';
// Bounded alarm/stop-observation/readback grace after the full assignment guard.
// This never extends the native execution deadline or returns occupied capacity.
export const INVITED_RUN_CONFIRMATION_GRACE_MS=120000;
export function invitedRunsPolicy(raw:unknown):InvitedRunsPolicy|null{
 if(raw===undefined)return null;
 const p=(typeof raw==='string'?JSON.parse(raw):raw) as InvitedRunsPolicy;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='durationMs,enabled,maxActiveRuns,maxGroupRuns,maxRunsPerUser,policyId,quietMs,releaseGuardMs,schemaVersion'||p.schemaVersion!==1||typeof p.enabled!=='boolean'||!/^[-A-Za-z0-9_]{1,128}$/.test(p.policyId)||p.maxActiveRuns!==1||p.maxRunsPerUser!==1||!Number.isSafeInteger(p.maxGroupRuns)||p.maxGroupRuns<4||p.maxGroupRuns>8||!Number.isSafeInteger(p.durationMs)||p.durationMs<1000||p.durationMs>600000||!Number.isSafeInteger(p.releaseGuardMs)||p.releaseGuardMs<360000||p.releaseGuardMs>900000||!Number.isSafeInteger(p.quietMs)||p.quietMs<30000||p.quietMs>p.releaseGuardMs)throw Error('invited-runs-policy-invalid');
 return structuredClone(p);
}
export type InvitedRunAdmission={kind:'invited-runs';policyId:string};
