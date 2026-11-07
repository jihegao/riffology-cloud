import { sha256Hex } from '../browser-preview/runtime/sha256.mjs';
const encoder = new TextEncoder();

export const RESOURCE_LIMITS = Object.freeze({ files: 16, fileBytes: 8192, totalBytes: 24576 });
const hash = content => sha256Hex(encoder.encode(content));
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const size = value => encoder.encode(value).byteLength;
const fail = code => { throw Error(`project-resource-${code}`); };
export function resourceKind(path) {
  if (path === 'AGENTS.md') return 'agents';
  if (/^\.pi\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(path)) return 'skill';
  if (/^\.pi\/prompts\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path)) return 'prompt';
  return null;
}
/** Deliberately bounded scalar frontmatter. No YAML tags, aliases, includes,
 * interpolation or filesystem discovery is evaluated in the trusted process. */
export function resourceText(path, content) {
  const kind = resourceKind(path);
  if (!kind || typeof content !== 'string' || content.includes('\0') || content.includes('\r') || size(content) > RESOURCE_LIMITS.fileBytes) fail('invalid-text');
  let body = content, metadata = {};
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---\n', 4);
    if (end < 0) fail('frontmatter-invalid');
    for (const line of content.slice(4, end).split('\n')) {
      if (!line.trim()) continue;
      const match = /^(name|description|disable-model-invocation): ([^\n]+)$/.exec(line);
      if (!match || Object.hasOwn(metadata, match[1])) fail('frontmatter-invalid');
      let value = match[2];
      if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { fail('frontmatter-invalid'); } }
      if (typeof value !== 'string' || /[&*!{}\[\]]/.test(value)) fail('frontmatter-invalid');
      metadata[match[1]] = value;
    }
    body = content.slice(end + 5);
  }
  if (!body.trim()) fail('empty-text');
  const name = kind === 'skill' ? path.split('/')[2] : kind === 'prompt' ? path.split('/')[2].slice(0, -3) : 'AGENTS';
  if (metadata.name !== undefined && metadata.name !== name) fail('name-mismatch');
  if (kind === 'skill' && (!metadata.description?.trim() || metadata.description.length > 1024)) fail('description-required');
  if (metadata['disable-model-invocation'] !== undefined && !['true', 'false'].includes(metadata['disable-model-invocation'])) fail('frontmatter-invalid');
  return { kind, path, name, description: metadata.description ?? '', manualOnly: metadata['disable-model-invocation'] === 'true', body };
}
const DIAGNOSTIC_CODES = new Set(['invalid-text', 'frontmatter-invalid', 'empty-text', 'name-mismatch', 'description-required', 'file-limit', 'encoding-invalid']);
function checkedDiagnostics(raw = []) {
  if (!Array.isArray(raw) || raw.length > RESOURCE_LIMITS.files) fail('diagnostics-invalid');
  return raw.map(d => {
    if (!d || Object.keys(d).sort().join(',') !== 'code,path,sha256' || typeof d.path !== 'string' || size(d.path) > 512 || !resourceKind(d.path) || !DIAGNOSTIC_CODES.has(d.code) || !/^[a-f0-9]{64}$/.test(d.sha256)) fail('diagnostics-invalid');
    return {path:d.path, code:d.code, sha256:d.sha256};
  }).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export function freezeProjectResources({ scope, revisionId, filesSha256, files, diagnostics: rawDiagnostics }) {
  if (!scope || !id(scope.tenantId) || !id(scope.projectId) || !(revisionId === null || id(revisionId)) || !/^[a-f0-9]{64}$/.test(filesSha256)) fail('source-invalid');
  if (!Array.isArray(files) || files.length > RESOURCE_LIMITS.files) fail('count-limit');
  const diagnostics = checkedDiagnostics(rawDiagnostics);
  const seen = new Set(); let total = 0;
  if (files.length + diagnostics.length > RESOURCE_LIMITS.files) fail('count-limit');
  for (const d of diagnostics) { if (seen.has(d.path)) fail('duplicate-path'); seen.add(d.path); }
  const resources = files.map(({ path, content }) => {
    const text = resourceText(path, content);
    if (seen.has(path)) fail('duplicate-path');
    seen.add(path); total += size(content);
    if (total > RESOURCE_LIMITS.totalBytes) fail('total-limit');
    return { path, kind: text.kind, content, sha256: hash(content) };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const frozen = { schema: 'project.resources/v1', scope: { tenantId: scope.tenantId, projectId: scope.projectId }, revisionId, filesSha256, resources, ...(diagnostics.length ? {diagnostics} : {}) };
  return { ...frozen, sha256: hash(JSON.stringify(frozen)) };
}
export function validateProjectResources(raw, scope) {
  if (!raw || raw.schema !== 'project.resources/v1' || raw.scope?.tenantId !== scope?.tenantId || raw.scope?.projectId !== scope?.projectId) fail('scope-denied');
  const checked = freezeProjectResources({ ...raw, files: raw.resources });
  if (JSON.stringify(checked) !== JSON.stringify(raw)) fail('digest-mismatch');
  return checked;
}

/** Provenance is inert checkpoint metadata, never a resource or permission source. */
export function validateResourceProvenance(raw, scope) {
  if (raw === null) return null;
  if (!raw || raw.schema !== 'project.resources/v1' || raw.scope?.tenantId !== scope?.tenantId || raw.scope?.projectId !== scope?.projectId || !Array.isArray(raw.resources) || raw.resources.length > RESOURCE_LIMITS.files || !(raw.revisionId === null || id(raw.revisionId)) || !/^[a-f0-9]{64}$/.test(raw.filesSha256) || !/^[a-f0-9]{64}$/.test(raw.sha256)) fail('provenance-invalid');
  const diagnostics = checkedDiagnostics(raw.diagnostics);
  const expectedKeys = ['filesSha256','resources','revisionId','schema','scope','sha256',...(Object.hasOwn(raw,'diagnostics')?['diagnostics']:[])].sort().join(',');
  if (Object.keys(raw).sort().join(',') !== expectedKeys || Object.keys(raw.scope).sort().join(',') !== 'projectId,tenantId') fail('provenance-invalid');
  if (raw.resources.length + diagnostics.length > RESOURCE_LIMITS.files) fail('provenance-invalid');
  const seen = new Set();
  for (const d of diagnostics) { if (seen.has(d.path)) fail('provenance-invalid'); seen.add(d.path); }
  for (const r of raw.resources) {
    if (!r || Object.keys(r).sort().join(',') !== ['kind','loaded','path','sha256',...(Object.hasOwn(r,'loadedFromHistory')?['loadedFromHistory']:[])].sort().join(',') || resourceKind(r.path) === null || resourceKind(r.path) !== r.kind || seen.has(r.path) || !/^[a-f0-9]{64}$/.test(r.sha256) || typeof r.loaded !== 'boolean' || Object.hasOwn(r,'loadedFromHistory') && (typeof r.loadedFromHistory !== 'boolean' || r.loadedFromHistory && !r.loaded)) fail('provenance-invalid');
    seen.add(r.path);
  }
  return structuredClone(raw);
}
