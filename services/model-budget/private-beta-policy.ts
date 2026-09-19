import {acceptedInvitationProjectAdmission} from '../catalog/project-admission.ts';
import {catalogDatabase} from '../catalog/database.ts';
import {ProjectCatalog} from '../catalog/projects.ts';
import {sameScope, type TurnActor, type TurnScope} from '../turn/protocol.ts';
import type {ModelExecutionIsolationManifest} from './core.ts';

export const PRIVATE_BETA_CAPACITY_ACTOR = 'private-beta-capacity-v1';
export type PrivateBetaPolicy = {
  schemaVersion: 1; policyId: string; enabled: boolean;
  admission: 'accepted-invitation-personal-projects'; dayBoundary: 'UTC';
  profileSha256: string; startsAt: number; reviewAt: number;
  maxActiveTurns: number; maxCallsPerUserDay: number; maxCallsPerDay: number;
  maxNanodollarsPerUserDay: number; maxNanodollarsPerDay: number; maxNanodollarsTotal: number;
  maxNanodollarsPerTurn: number; maxCallsPerTurn: number;
  maxPendingCalls: number; maxPendingNanodollars: number;
  maxCallDurationMs: number; maxToolDurationMs:number; maxTurnDurationMs: number; releaseTimeoutMs: number;
  monitorIntervalMs: number; alertPercent: number;
  historicalIsolation: Array<{tenantId:string; manifests:ModelExecutionIsolationManifest[]}>;
};
const keys = 'schemaVersion policyId enabled admission dayBoundary profileSha256 startsAt reviewAt maxActiveTurns maxCallsPerUserDay maxCallsPerDay maxNanodollarsPerUserDay maxNanodollarsPerDay maxNanodollarsTotal maxNanodollarsPerTurn maxCallsPerTurn maxPendingCalls maxPendingNanodollars maxCallDurationMs maxToolDurationMs maxTurnDurationMs releaseTimeoutMs monitorIntervalMs alertPercent historicalIsolation'.split(' ');
export function privateBetaPolicy(raw: unknown): PrivateBetaPolicy|null {
  if(raw===undefined)return null;
  const value=typeof raw==='string'?JSON.parse(raw):raw;
  const fail=():never=>{throw Error('private-beta-policy-invalid');};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))return fail();
  const p=value as PrivateBetaPolicy;
  if(p.schemaVersion!==1||typeof p.enabled!=='boolean'||typeof p.policyId!=='string'||typeof p.profileSha256!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(p.policyId)||p.admission!=='accepted-invitation-personal-projects'||p.dayBoundary!=='UTC'||!/^[a-f0-9]{64}$/.test(p.profileSha256))return fail();
  for(const key of keys.filter(k=>k.startsWith('max')||['startsAt','reviewAt','releaseTimeoutMs','monitorIntervalMs','alertPercent'].includes(k))) {
    const n=value[key];if(!Number.isSafeInteger(n)||n<=0)return fail();
  }
  if(p.reviewAt<=p.startsAt||p.maxCallsPerTurn>64||p.maxActiveTurns>8||p.maxToolDurationMs>360_000||p.maxCallDurationMs>360_000||p.maxTurnDurationMs>900_000||p.maxCallDurationMs>p.maxTurnDurationMs||p.monitorIntervalMs<1000||p.monitorIntervalMs>60_000||p.alertPercent>=100||p.maxCallsPerUserDay>p.maxCallsPerDay||p.maxNanodollarsPerUserDay>p.maxNanodollarsPerDay||p.maxNanodollarsPerDay>p.maxNanodollarsTotal||p.maxNanodollarsPerTurn>p.maxNanodollarsPerUserDay||p.maxPendingNanodollars>p.maxNanodollarsTotal)return fail();
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
