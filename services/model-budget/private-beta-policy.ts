import {acceptedInvitationProjectAdmission} from '../catalog/project-admission.ts';
import {catalogDatabase} from '../catalog/database.ts';
import {ProjectCatalog} from '../catalog/projects.ts';
import {sameScope, type TurnActor, type TurnScope} from '../turn/protocol.ts';
import {modelBudgetTenantName,type ModelExecutionIsolationManifest} from './core.ts';

export const PRIVATE_BETA_CAPACITY_ACTOR = 'private-beta-capacity-v1';
type PrivateBetaGates = {
  policyId: string; enabled: boolean;
  admission: 'accepted-invitation-personal-projects'; dayBoundary: 'UTC';
  profileSha256: string; startsAt: number; reviewAt: number; maxActiveTurns: number;
  maxCallDurationMs: number; maxToolDurationMs:number; maxTurnDurationMs: number; releaseTimeoutMs: number;
  monitorIntervalMs: number;
  historicalIsolation: Array<{tenantId:string; manifests:ModelExecutionIsolationManifest[]}>;
};
export type PrivateBetaPolicyV1 = PrivateBetaGates & {
  schemaVersion: 1; maxCallsPerUserDay: number; maxCallsPerDay: number;
  maxNanodollarsPerUserDay: number; maxNanodollarsPerDay: number; maxNanodollarsTotal: number;
  maxNanodollarsPerTurn: number; maxCallsPerTurn: number;
  maxPendingCalls: number; maxPendingNanodollars: number; alertPercent: number;
};
export type PrivateBetaPolicyV2 = PrivateBetaGates & {
  schemaVersion: 2; quotaMode: 'meter-only';
  warningCallsPerMinute: number; warningNanodollarsPerMinute: number; billingPendingWarningMs: number;
};
export type PrivateBetaPolicy = PrivateBetaPolicyV1 | PrivateBetaPolicyV2;
const gateKeys = 'policyId enabled admission dayBoundary profileSha256 startsAt reviewAt maxActiveTurns maxCallDurationMs maxToolDurationMs maxTurnDurationMs releaseTimeoutMs monitorIntervalMs historicalIsolation'.split(' ');
const quotaKeys = 'maxCallsPerUserDay maxCallsPerDay maxNanodollarsPerUserDay maxNanodollarsPerDay maxNanodollarsTotal maxNanodollarsPerTurn maxCallsPerTurn maxPendingCalls maxPendingNanodollars alertPercent'.split(' ');
const meterKeys = 'quotaMode warningCallsPerMinute warningNanodollarsPerMinute billingPendingWarningMs'.split(' ');
/** All execution gates must be byte-equivalent through quota removal. */
export function privateBetaPolicyGates(p:PrivateBetaPolicy){return Object.fromEntries(gateKeys.map(key=>[key,key==='enabled'?false:p[key as keyof PrivateBetaGates]]));}
export function privateBetaPolicy(raw: unknown): PrivateBetaPolicy|null {
  if(raw===undefined)return null;
  const value=typeof raw==='string'?JSON.parse(raw):raw;
  const fail=():never=>{throw Error('private-beta-policy-invalid');};
  if(!value||typeof value!=='object'||Array.isArray(value))return fail();
  const keys=['schemaVersion',...gateKeys,...(value.schemaVersion===1?quotaKeys:value.schemaVersion===2?meterKeys:[])];
  if(Object.keys(value).sort().join(',')!==[...keys].sort().join(','))return fail();
  const p=value as PrivateBetaPolicy;
  if(![1,2].includes(p.schemaVersion)||typeof p.enabled!=='boolean'||typeof p.policyId!=='string'||typeof p.profileSha256!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(p.policyId)||p.admission!=='accepted-invitation-personal-projects'||p.dayBoundary!=='UTC'||!/^[a-f0-9]{64}$/.test(p.profileSha256))return fail();
  for(const key of keys.filter(k=>k.startsWith('max')||k.startsWith('warning')||['startsAt','reviewAt','releaseTimeoutMs','monitorIntervalMs','alertPercent','billingPendingWarningMs'].includes(k))) {
    const n=value[key];if(!Number.isSafeInteger(n)||n<=0)return fail();
  }
  if(p.reviewAt<=p.startsAt||p.maxActiveTurns>8||p.maxToolDurationMs>360_000||p.maxCallDurationMs>360_000||p.maxTurnDurationMs>900_000||p.maxCallDurationMs>p.maxTurnDurationMs||p.monitorIntervalMs<1000||p.monitorIntervalMs>60_000)return fail();
  if(p.schemaVersion===1&&(p.maxCallsPerTurn>64||p.alertPercent>=100||p.maxCallsPerUserDay>p.maxCallsPerDay||p.maxNanodollarsPerUserDay>p.maxNanodollarsPerDay||p.maxNanodollarsPerDay>p.maxNanodollarsTotal||p.maxNanodollarsPerTurn>p.maxNanodollarsPerUserDay||p.maxPendingNanodollars>p.maxNanodollarsTotal))return fail();
  if(p.schemaVersion===2&&(p.quotaMode!=='meter-only'||p.billingPendingWarningMs<60_000))return fail();
  if(!Array.isArray(p.historicalIsolation)||p.historicalIsolation.length>32)return fail();
  const tenants=new Set<string>();
  for(const h of p.historicalIsolation){
    if(!h||Object.keys(h).sort().join(',')!=='manifests,tenantId'||typeof h.tenantId!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(h.tenantId)||tenants.has(h.tenantId)||!Array.isArray(h.manifests)||h.manifests.length!==2)return fail();
    tenants.add(h.tenantId);
    for(const [i,m] of h.manifests.entries()){
      if(!m||Object.keys(m).sort().join(',')!=='ledger,proofs,schemaVersion'||m.schemaVersion!==1||m.ledger!==['legacy','g5'][i]||!Array.isArray(m.proofs)||m.proofs.length>256)return fail();
      const calls=new Set<string>();
      for(const proof of m.proofs){if(!proof||Object.keys(proof).sort().join(',')!=='callKey,proofDigest'||!/^[a-f0-9]{64}$/.test(proof.callKey)||!/^[a-f0-9]{64}$/.test(proof.proofDigest)||calls.has(proof.callKey))return fail();calls.add(proof.callKey);}
    }
  }
  return structuredClone(p);
}

/** A routing candidate is never an authorization decision. */
export function privateBetaCandidate(raw:unknown){return privateBetaPolicy(raw)?.enabled===true;}
export async function authorizePrivateBeta(db:D1Database,scope:TurnScope,actor:TurnActor) {
  const database=catalogDatabase(db);
  if(!await acceptedInvitationProjectAdmission(database,'true',actor,scope.tenantId))throw Error('private-beta-admission-denied');
  const allowed=await new ProjectCatalog(database,new Set()).workspace(actor,scope.workspaceId);
  if(!sameScope(allowed,scope))throw Error('private-beta-admission-denied');
}

export type PrivateBetaHistoricalLedger={getByName(name:string):{
  assertExecutionQuiet(tenantId:string):Promise<unknown>;
  assertExecutionIsolated(tenantId:string,manifest:ModelExecutionIsolationManifest):Promise<unknown>;
}};
/** Reuse the original historical authorities, never a new project/window. An
 * accepted immutable proof only isolates its exact original execution blocker;
 * absent proofs still require the old ledger to be execution-quiet. */
export async function assertPrivateBetaHistoricalIsolation(policy:PrivateBetaPolicy,tenantId:string,legacy:PrivateBetaHistoricalLedger|undefined,g5:PrivateBetaHistoricalLedger|undefined){
  if(!legacy||!g5)throw Error('private-beta-historical-ledger-unavailable');
  const entry=policy.historicalIsolation.find(h=>h.tenantId===tenantId);
  for(const ledger of ['legacy','g5'] as const){
    const manifest=entry?.manifests.find(m=>m.ledger===ledger)??{schemaVersion:1 as const,ledger,proofs:[]};
    const authority=(ledger==='legacy'?legacy:g5).getByName(modelBudgetTenantName(tenantId));
    if(manifest.proofs.length)await authority.assertExecutionIsolated(tenantId,manifest);
    else await authority.assertExecutionQuiet(tenantId);
  }
}
