export class CatalogError extends Error {
  readonly status: number;
  constructor(code: 'invalid_input' | 'not_found' | 'idempotency_conflict' | 'not_ready') {
    super(code); this.status = code === 'invalid_input' ? 400 : code === 'not_found' ? 404 : 409;
  }
}
/** Only a server-verified authentication adapter may construct this context. */
export interface Principal { userId: string; authVersion: number }
export interface CreateProject { title: string; starterVersion?: string; modelId?: string; modelVersion?: string }
export interface Project {
  id: string; tenant_id: string; workspace_id: string; title: string; starter_version: string;
  source_model_version_id?: string | null; source_model_id?: string | null; source_model_version?: string | null; source_digest?: string | null;
  status: 'provisioning' | 'ready' | 'failed' | 'deleting'; generation: number;
  created_at: number; updated_at: number;
}
export function opaqueId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new CatalogError('invalid_input');
  return value;
}
export function modelReference(value: unknown, maxLength = 128): string {
  if (typeof value !== 'string' || value.length > maxLength || !/^[A-Za-z0-9._-]+$/.test(value)) throw new CatalogError('invalid_input');
  return value;
}
export function createProjectInput(value: unknown, allowedStarters: ReadonlySet<string>): CreateProject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('invalid_input');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(k => !['title', 'starterVersion', 'modelId', 'modelVersion'].includes(k))) throw new CatalogError('invalid_input');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120 || /[\u0000-\u001f\u007f]/u.test(input.title)) throw new CatalogError('invalid_input');
  const model = typeof input.modelId === 'string' || typeof input.modelVersion === 'string';
  if (model) {
    return { title: input.title.trim(), modelId: modelReference(input.modelId), modelVersion: modelReference(input.modelVersion, 64) };
  }
  if (typeof input.starterVersion !== 'string' || !allowedStarters.has(input.starterVersion)) throw new CatalogError('invalid_input');
  return { title: input.title.trim(), starterVersion: input.starterVersion };
}
export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}
