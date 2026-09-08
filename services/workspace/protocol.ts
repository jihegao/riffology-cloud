import { quotaIdentifier, type LeaseRequest, type LeaseReference, type Acquisition, type Lease, type StopConfirmation } from '../quota/core.ts';
import type { ModelContentReceipt } from '../runtime/content.ts';

export const WORKSPACE_LAYOUT = 'm1-empty-v1' as const;
export type ModelContentRef = { modelVersionId:string; modelId:string; version:string; contentRef:string; contentSha256:string };
export type WorkspaceTask = {
  id: string; tenantId: string; projectId: string; workspaceId: string; generation: number;
  starterVersion: string; authVersion: number; createdAt: number; deadlineAt: number; modelContent?: ModelContentRef;
};
export type RuntimeIdentity = {
  taskId: string; tenantId: string; projectId: string; workspaceId: string; generation: number;
  runtimeId: string; leaseId: string;
};
export type RuntimeReadyReceipt = {
  receiptId: string; initializedAt: number; layoutVersion: typeof WORKSPACE_LAYOUT;
  markerSha256: string; checkpointRevision: string;
  modelContent?: ModelContentReceipt;
};
export type RuntimeStopReceipt = { confirmationId: string; observedAt: number; nativeRunning: false; fenced: true };
export type RuntimeFailureCode = 'startup-failed' | 'deadline' | 'scope-denied' | 'initialization-unknown' | 'stop-unknown' | 'unsupported-starter' |
  'model-content-missing' | 'model-content-oversize' | 'model-content-mismatch' | 'model-content-unknown';
export type RuntimeObservation = {
  identity: RuntimeIdentity; phase: 'pending' | 'runtime_ready' | 'stopped' | 'unknown' | 'failed';
  ready: RuntimeReadyReceipt | null; stop: RuntimeStopReceipt | null; failureCode: RuntimeFailureCode | null;
};
export type RuntimeInitialize = { task: WorkspaceTask; identity: RuntimeIdentity; markerNonce: string };
export interface RuntimePort {
  initialize(input: RuntimeInitialize): Promise<RuntimeObservation>;
  observe(identity: RuntimeIdentity): Promise<RuntimeObservation>;
  stop(identity: RuntimeIdentity): Promise<RuntimeObservation>;
}
export type WorkspaceReason = 'initialized' | 'quota-denied' | 'authority-revoked' | 'startup-failed' | 'deadline' | 'runtime-unknown' | 'stop-requested' | 'cleanup-unknown';
export type WorkspaceProjection = {
  taskId: string; tenantId: string; projectId: string; workspaceId: string; generation: number;
  sequence: number; receiptId: string; updatedAt: number; outcome: 'ready' | 'failed' | 'stopped' | 'unknown';
  reasonCode: WorkspaceReason; quotaReleased: boolean;
  runtimeReceipt: RuntimeReadyReceipt | null; stopReceipt: RuntimeStopReceipt | null;
};
export interface WorkspaceCatalogPort {
  taskKnown(task: WorkspaceTask): Promise<boolean>;
  verifyTask(task: WorkspaceTask): Promise<boolean>;
  project(receipt: WorkspaceProjection): Promise<{ applied: boolean }>;
}
export interface WorkspaceQuotaPort {
  acquire(request: LeaseRequest): Promise<Acquisition>;
  lookup(tenantId: string, operationId: string): Promise<Acquisition | null>;
  dispatch(reference: LeaseReference): Promise<{ authorized: boolean; lease: Lease }>;
  markUnknown(reference: LeaseReference): Promise<Lease>;
  confirmStopped(reference: LeaseReference, proof: StopConfirmation): Promise<{ released: boolean; lease: Lease }>;
}
export function workspaceAgentName(tenantId: string, workspaceId: string): string {
  quotaIdentifier(tenantId); quotaIdentifier(workspaceId); return `workspace:${tenantId}:${workspaceId}`;
}
export function runtimeName(identity: RuntimeIdentity): string { quotaIdentifier(identity.runtimeId); return identity.runtimeId; }
export function validateWorkspaceTask(value: WorkspaceTask): WorkspaceTask {
  const keys = ['id', 'tenantId', 'projectId', 'workspaceId', 'generation', 'starterVersion', 'authVersion', 'createdAt', 'deadlineAt'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.keys(value).length !== keys.length && Object.keys(value).length !== keys.length+1) || !keys.every(key => Object.hasOwn(value, key))) throw Error('invalid-workspace-task');
  for (const key of ['id', 'tenantId', 'projectId', 'workspaceId', 'starterVersion'] as const) quotaIdentifier(value[key]);
  for (const key of ['generation', 'authVersion', 'createdAt', 'deadlineAt'] as const) if (!Number.isSafeInteger(value[key]) || value[key] < 1) throw Error('invalid-workspace-task');
  if (value.deadlineAt <= value.createdAt) throw Error('invalid-workspace-task');
  const content=value.modelContent;
  if (content!==undefined) { if (!content || typeof content!=='object' || Object.keys(content).length!==5 || !/^[A-Za-z0-9._:-]{1,128}$/.test(content.modelVersionId) || !/^[A-Za-z0-9._-]{1,128}$/.test(content.modelId) || !/^[A-Za-z0-9._-]{1,64}$/.test(content.version) || typeof content.contentRef!=='string' || content.contentRef.length<1 || content.contentRef.length>512 || !/^[a-f0-9]{64}$/.test(content.contentSha256)) throw Error('invalid-workspace-task'); }
  const result={ id: value.id, tenantId: value.tenantId, projectId: value.projectId, workspaceId: value.workspaceId,
    generation: value.generation, starterVersion: value.starterVersion, authVersion: value.authVersion, createdAt: value.createdAt, deadlineAt: value.deadlineAt } as WorkspaceTask;
  if (content!==undefined) result.modelContent=structuredClone(content);
  return result;
}
/** Stable marker bytes shared by trusted coordinator and native runtime. No
 * project-controlled paths or code enter this payload. The nonce is public
 * integrity evidence, not a credential or an authentication substitute. */
export function canonicalWorkspaceMarker(identity: RuntimeIdentity, markerNonce: string): string {
  for (const key of ['taskId', 'tenantId', 'projectId', 'workspaceId', 'runtimeId', 'leaseId'] as const) quotaIdentifier(identity[key]);
  if (!Number.isSafeInteger(identity.generation) || identity.generation < 1) throw Error('invalid-runtime-identity');
  quotaIdentifier(markerNonce);
  return JSON.stringify({ schemaVersion: 1, layoutVersion: WORKSPACE_LAYOUT, taskId: identity.taskId, tenantId: identity.tenantId,
    projectId: identity.projectId, workspaceId: identity.workspaceId, generation: identity.generation,
    runtimeId: identity.runtimeId, leaseId: identity.leaseId, nonce: markerNonce });
}
export async function workspaceDigest(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
