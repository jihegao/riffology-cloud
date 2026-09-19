import assert from 'node:assert/strict';
import test from 'node:test';
import {G5TerminalReconciliation} from '../../services/workspace/g5-terminal-reconciliation.ts';

class Storage{
  readonly values=new Map<string,unknown>();syncs=0;
  readonly kv={
    get:<T>(key:string)=>structuredClone(this.values.get(key)) as T|undefined,
    put:(key:string,value:unknown)=>{this.values.set(key,structuredClone(value));},
  };
  readonly sync=async()=>{this.syncs++;};
}

test('unsettled G5 terminal state is persisted and skipped across reconstruction',async()=>{
  const storage=new Storage(),first=new G5TerminalReconciliation(storage as unknown as DurableObjectStorage,()=>1234);let attempts=0;
  assert.equal(await first.run('turn-a',async()=>{attempts++;throw Error('g5-authority-turn-unsettled');}),'blocked');
  assert.deepEqual(first.read('turn-a'),{schemaVersion:1,status:'blocked',reasonCode:'g5-authority-turn-unsettled',blockedAt:1234});
  const reopened=new G5TerminalReconciliation(storage as unknown as DurableObjectStorage,()=>5678);
  assert.equal(await reopened.run('turn-a',async()=>{attempts++;}),'skipped-blocked');
  assert.equal(attempts,1);assert.equal(storage.syncs,1);
});

test('successful settlement stays retry-free without inventing a blocked record',async()=>{
  const storage=new Storage(),reconciliation=new G5TerminalReconciliation(storage as unknown as DurableObjectStorage,()=>1234);let attempts=0;
  assert.equal(await reconciliation.run('turn-success',async()=>{attempts++;}),'completed');
  assert.equal(attempts,1);assert.equal(reconciliation.read('turn-success'),null);assert.equal(storage.syncs,0);
});

test('unexpected failures remain visible and are not converted to settlement evidence',async()=>{
  const storage=new Storage(),reconciliation=new G5TerminalReconciliation(storage as unknown as DurableObjectStorage,()=>1234);let attempts=0;
  await assert.rejects(reconciliation.run('turn-failure',async()=>{attempts++;throw Error('g5-authority-turn-route-mismatch');}),/g5-authority-turn-route-mismatch/);
  assert.equal(attempts,1);assert.equal(reconciliation.read('turn-failure'),null);assert.equal(storage.syncs,0);
});
