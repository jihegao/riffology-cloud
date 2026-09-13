import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelSpec, resolveParameters, validateMetrics } from '../../services/simulation/model-spec.ts';

const spec = { schemaVersion: 1, researchQuestion: 'How does capacity affect waiting?', scope: 'airport check-in', entities: ['passenger'], mechanisms: ['queue'], assumptions: ['FCFS'], parameters: { counters: { type: 'integer', default: 4, minimum: 1, maximum: 10, unit: 'count' }, priority: { type: 'enum', default: 'normal', values: ['normal', 'priority'] }, abandonment: { type: 'boolean', default: false }, rate: { type: 'number', default: 1.5 } }, metrics: { meanWait: { unit: 'min', description: 'mean waiting time' }, throughput: {} }, limitations: ['no abandonment'], execution: { entrypoint: 'model/run.py', dependencyLock: 'app/requirements.lock' } };

test('parses a strict versioned model spec and resolves defaults/overrides', () => {
  const parsed = parseModelSpec(spec);
  assert.equal(parsed.execution.entrypoint, 'model/run.py');
  assert.deepEqual(resolveParameters(parsed, { counters: 6, priority: 'priority' }), { counters: 6, priority: 'priority', abandonment: false, rate: 1.5 });
  assert.deepEqual(validateMetrics(parsed, { meanWait: 2.5, throughput: 12 }), { meanWait: 2.5, throughput: 12 });
});

test('rejects unknown fields, parameters, invalid bounds, enum values, and metrics', () => {
  assert.throws(() => parseModelSpec({ ...spec, extra: true }));
  assert.throws(() => resolveParameters(spec as never, { unknown: 1 }));
  assert.throws(() => resolveParameters(spec as never, { counters: 11 }));
  assert.throws(() => resolveParameters(spec as never, { priority: 'other' }));
  assert.throws(() => validateMetrics(spec as never, { meanWait: 1, throughput: Number.NaN }));
  assert.throws(() => validateMetrics(spec as never, { meanWait: 1 }));
});

test('rejects unsafe Python paths and non-finite or wrong-type values', () => {
  assert.throws(() => parseModelSpec({ ...spec, execution: { entrypoint: 'model/../run.py', dependencyLock: 'app/requirements.lock' } }));
  assert.throws(() => parseModelSpec({ ...spec, parameters: { ...spec.parameters, counters: { type: 'integer', default: 1.2 } } }));
  assert.throws(() => parseModelSpec({ ...spec, parameters: { ...spec.parameters, rate: { type: 'number', default: Infinity } } }));
});
