/** Versioned, project-owned description of a Python simulation model. */

export type ParameterType = 'number' | 'integer' | 'enum' | 'boolean';
export type ParameterDefinition = {
  type: ParameterType;
  default: number | string | boolean;
  unit?: string;
  minimum?: number;
  maximum?: number;
  values?: string[];
};
export type MetricDefinition = { unit?: string; description?: string };
export type ModelSpec = {
  schemaVersion: 1;
  researchQuestion: string;
  scope: string;
  entities: string[];
  mechanisms: string[];
  assumptions: string[];
  parameters: Record<string, ParameterDefinition>;
  metrics: Record<string, MetricDefinition>;
  limitations: string[];
  execution: { entrypoint: string; dependencyLock: string };
};
export type ParameterValues = Record<string, number | string | boolean>;

const PARAMETER_TYPES = new Set<ParameterType>(['number', 'integer', 'enum', 'boolean']);
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function reject(): never { throw new Error('invalid-model-spec'); }
function object(raw: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) reject();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const allowed = new Set([...keys, ...optional]);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !allowed.has(key))) reject();
  if (keys.some(key => !Object.hasOwn(descriptors, key))) reject();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as string]!;
    if (!('value' in descriptor) || !descriptor.enumerable) reject();
    result[key as string] = descriptor.value;
  }
  return result;
}
function text(raw: unknown, code = 'invalid-model-spec'): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 4096 || /[\u0000-\u001f\u007f]/u.test(raw)) throw Error(code);
  return raw;
}
function name(raw: string): string { if (!NAME.test(raw)) reject(); return raw; }
function finite(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw) > Number.MAX_SAFE_INTEGER) reject();
  return raw;
}
function list(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > 256) reject();
  return raw.map(item => text(item));
}
function path(raw: unknown, root: string, suffix: string): string {
  if (typeof raw !== 'string' || raw.normalize('NFC') !== raw || raw.length > 240 || !raw.endsWith(suffix) || /[\p{C}\\%]/u.test(raw)) reject();
  const parts = raw.split('/');
  if (parts.length < 2 || parts[0] !== root || parts.some(part => !part || part === '.' || part === '..' || part === '.riffology')) reject();
  return raw;
}
function map(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) reject();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(Object.getOwnPropertyDescriptors(raw))) {
    if (typeof key !== 'string' || !NAME.test(key)) reject();
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
    if (!('value' in descriptor) || !descriptor.enumerable) reject();
    result[key] = descriptor.value;
  }
  return result;
}
function parameter(raw: unknown): ParameterDefinition {
  const value = object(raw, ['type', 'default'], ['unit', 'minimum', 'maximum', 'values']);
  if (typeof value.type !== 'string' || !PARAMETER_TYPES.has(value.type as ParameterType)) reject();
  const type = value.type as ParameterType;
  if (value.unit !== undefined && (typeof value.unit !== 'string' || value.unit.length > 128)) reject();
  const minimum = value.minimum === undefined ? undefined : finite(value.minimum);
  const maximum = value.maximum === undefined ? undefined : finite(value.maximum);
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) reject();
  let values: string[] | undefined;
  if (type === 'enum') {
    if (!Array.isArray(value.values) || value.values.length < 1 || value.values.length > 128) reject();
    values = value.values.map(item => text(item, 'invalid-model-spec-parameter'));
    if (new Set(values).size !== values.length) reject();
  } else if (value.values !== undefined) reject();
  const def = value.default;
  if (type === 'boolean') { if (typeof def !== 'boolean' || minimum !== undefined || maximum !== undefined) reject(); }
  else if (type === 'enum') { if (typeof def !== 'string' || !values!.includes(def)) reject(); }
  else {
    const n = finite(def);
    if (type === 'integer' && !Number.isSafeInteger(n)) reject();
    if (minimum !== undefined && n < minimum || maximum !== undefined && n > maximum) reject();
  }
  return { type, default: def as ParameterDefinition['default'], ...(value.unit === undefined ? {} : { unit: value.unit as string }), ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }), ...(values === undefined ? {} : { values }) };
}
function metric(raw: unknown): MetricDefinition {
  const value = object(raw, [], ['unit', 'description']);
  if (value.unit !== undefined && (typeof value.unit !== 'string' || value.unit.length > 128)) reject();
  if (value.description !== undefined) text(value.description);
  return { ...(value.unit === undefined ? {} : { unit: value.unit as string }), ...(value.description === undefined ? {} : { description: value.description as string }) };
}

export function parseModelSpec(raw: unknown): ModelSpec {
  const value = object(raw, ['schemaVersion', 'researchQuestion', 'scope', 'entities', 'mechanisms', 'assumptions', 'parameters', 'metrics', 'limitations', 'execution']);
  if (value.schemaVersion !== 1) reject();
  const parameters: Record<string, ParameterDefinition> = {};
  for (const [key, item] of Object.entries(map(value.parameters))) parameters[name(key)] = parameter(item);
  const metrics: Record<string, MetricDefinition> = {};
  for (const [key, item] of Object.entries(map(value.metrics))) metrics[name(key)] = metric(item);
  const execution = object(value.execution, ['entrypoint', 'dependencyLock']);
  const entrypoint = path(execution.entrypoint, 'model', '.py'), dependencyLock = path(execution.dependencyLock, 'app', '.lock');
  return { schemaVersion: 1, researchQuestion: text(value.researchQuestion), scope: text(value.scope), entities: list(value.entities), mechanisms: list(value.mechanisms), assumptions: list(value.assumptions), parameters, metrics, limitations: list(value.limitations), execution: { entrypoint, dependencyLock } };
}

export function resolveParameters(spec: ModelSpec, raw: unknown = {}): ParameterValues {
  const model = parseModelSpec(spec), supplied = map(raw), result: ParameterValues = {};
  for (const key of Object.keys(supplied)) if (!Object.hasOwn(model.parameters, key)) reject();
  for (const [key, definition] of Object.entries(model.parameters)) {
    const value = Object.hasOwn(supplied, key) ? supplied[key] : definition.default;
    parameter({ ...definition, default: value });
    result[key] = value as ParameterValues[string];
  }
  return result;
}

export function validateMetrics(spec: ModelSpec, raw: unknown): Record<string, number> {
  const model = parseModelSpec(spec), supplied = map(raw), result: Record<string, number> = {};
  for (const [key, value] of Object.entries(supplied)) {
    if (!Object.hasOwn(model.metrics, key)) reject();
    result[key] = finite(value);
  }
  for (const key of Object.keys(model.metrics)) if (!Object.hasOwn(result, key)) reject();
  return result;
}
