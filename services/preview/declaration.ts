/** Project data only: this declaration never grants platform capabilities. */
export const PREVIEW_DECLARATION_PATH = 'app/preview.json';

export type PreviewDeclaration = {
  schemaVersion: 1;
  runtime: 'python';
  entrypoint: string;
  dependencyLock: string;
  port: 8080;
  healthPath: string;
  observation?: { pagePath: string; statePath: string };
};

function reject(): never { throw new Error('invalid-preview-declaration'); }

/** Read descriptors before values so an accessor cannot run during parsing. */
function dataObject(raw: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Object.getPrototypeOf(raw) !== Object.prototype) reject();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) reject();
  if (required.some(key => !Object.hasOwn(descriptors, key))) reject();
  const values: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key as string]!;
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) reject();
    values[key as string] = descriptor.value;
  }
  return values;
}

function projectPath(raw: unknown, roots: string[], suffix: string): string {
  if (typeof raw !== 'string' || raw.normalize('NFC') !== raw || /[\p{C}\\%]/u.test(raw)
    || new TextEncoder().encode(raw).byteLength > 240 || !raw.endsWith(suffix)) reject();
  const parts = raw.split('/');
  if (parts.length < 2 || !roots.includes(parts[0]!)
    || parts.some(part => !part || part === '.' || part === '..' || part === '.riffology')) reject();
  return raw;
}

function localPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 256 || !/^\/(?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?$/.test(raw)
    || raw.split('/').some(part => part === '.' || part === '..')) reject();
  return raw;
}

/** Parses an already decoded JSON object into a detached, closed declaration.
 * File existence, locked dependencies and readiness are verified by the host. */
export function parsePreviewDeclaration(raw: unknown): PreviewDeclaration {
  const value = dataObject(raw, ['schemaVersion', 'runtime', 'entrypoint', 'dependencyLock', 'port', 'healthPath'], ['observation']);
  if (value.schemaVersion !== 1 || value.runtime !== 'python' || value.port !== 8080) reject();
  const entrypoint = projectPath(value.entrypoint, ['app', 'model'], '.py');
  const dependencyLock = projectPath(value.dependencyLock, ['app'], '.lock');
  if (entrypoint === dependencyLock) reject();
  const healthPath = localPath(value.healthPath);
  const result: PreviewDeclaration = { schemaVersion: 1, runtime: 'python', entrypoint, dependencyLock, port: 8080, healthPath };
  if (Object.hasOwn(value, 'observation')) {
    const observation = dataObject(value.observation, ['pagePath', 'statePath']);
    const pagePath = localPath(observation.pagePath), statePath = localPath(observation.statePath);
    if (pagePath === statePath || pagePath === healthPath || statePath === healthPath) reject();
    result.observation = { pagePath, statePath };
  }
  return result;
}
