import assert from 'node:assert/strict';
import test from 'node:test';
import {turnOperationEvent,turnOperationTracer} from '../../services/turn/operation-telemetry.ts';

const event={route:'turn.operation' as const,metric:'release_hold_age' as const,stage:'release' as const,reasonCategory:'release_pending' as const,attempt:2,durationMs:31_000,value:1,correlationId:'release:opaque-7'};

test('turn operation telemetry accepts only the bounded metric schema',()=>{
  assert.deepEqual(turnOperationEvent(event),event);
  for(const invalid of [{...event,tenantId:'tenant-secret'},{...event,reasonCategory:'raw-upstream-failure'},{...event,correlationId:'contains whitespace'},{...event,value:-1},{...event,durationMs:1.5}])assert.throws(()=>turnOperationEvent(invalid),/invalid-turn-operation-telemetry/);
});

test('turn operation telemetry is opt-in and never serializes rejected input',()=>{
  assert.equal(turnOperationTracer(undefined),undefined);assert.equal(turnOperationTracer('false'),undefined);
  const lines:string[]=[];const original=console.error;console.error=value=>{lines.push(String(value));};
  try{turnOperationTracer('true')?.(event);}finally{console.error=original;}
  assert.equal(lines.length,1);assert.deepEqual(JSON.parse(lines[0].slice('turn-operation '.length)),event);assert.equal(lines[0].includes('tenant-secret'),false);
});
