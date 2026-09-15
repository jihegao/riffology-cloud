import assert from 'node:assert/strict';
import { PROTOCOL_VERSION, validateSnapshot, validateTrace, metricEntries } from './protocol.js';

const gridSnapshot = {
  schemaVersion: PROTOCOL_VERSION,
  frame: 0,
  time: 0,
  space: { type: 'grid', width: 2, height: 2, torus: true },
  agents: [{ id: 'a', type: 'resident', state: 'group-a', x: 0, y: 1 }],
  metrics: { unhappy: 1, happy_fraction: 0.5, note: 'ignored' },
};

assert.equal(validateSnapshot(gridSnapshot), gridSnapshot);
assert.deepEqual(metricEntries(gridSnapshot), [['happy_fraction', 0.5], ['unhappy', 1]]);
assert.equal(validateTrace({ snapshots: [gridSnapshot, { ...gridSnapshot, frame: 1, time: 1 }] }).snapshots.length, 2);

assert.throws(() => validateSnapshot({ ...gridSnapshot, schemaVersion: 'wrong' }), /unsupported schemaVersion/);
assert.throws(() => validateSnapshot({ ...gridSnapshot, agents: [{ ...gridSnapshot.agents[0], x: 2 }] }), /outside the grid/);
assert.throws(() => validateSnapshot({ ...gridSnapshot, agents: [gridSnapshot.agents[0], { ...gridSnapshot.agents[0] }] }), /duplicate agent id/);
assert.throws(() => validateTrace({ snapshots: [gridSnapshot, { ...gridSnapshot, frame: 1, time: -1 }] }), /time must be a non-negative/);
assert.throws(() => validateTrace({ snapshots: [gridSnapshot, { ...gridSnapshot, frame: 0, time: 1 }] }), /frames must increase strictly/);

const laneSnapshot = {
  schemaVersion: PROTOCOL_VERSION,
  frame: 3,
  time: 2.5,
  space: { type: 'lane', lanes: ['queue', 'server-1'] },
  agents: [{ id: '2', type: 'customer', state: 'waiting', lane: 'queue', position: 1 }],
  metrics: { queue_length: 1 },
};
assert.equal(validateSnapshot(laneSnapshot), laneSnapshot);

console.log('mesa-browser-runtime protocol tests passed');
