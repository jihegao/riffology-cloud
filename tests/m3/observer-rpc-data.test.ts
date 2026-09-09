import test from 'node:test';
import assert from 'node:assert/strict';
import {observerRpcData,observerRpcPendingData} from '../../services/preview/observer-rpc-data.ts';
test('RPC aggregate metadata is disposed once while data remains available to strict validation',()=>{
 let disposed=0;const raw={field:{value:1},[Symbol.dispose](){assert.equal(this,raw);disposed++;}};
 const copy=observerRpcData(raw);assert.deepEqual(copy,{field:{value:1}});assert.equal(disposed,1);assert.equal(Object.hasOwn(copy,Symbol.dispose),false);
 assert.deepEqual(observerRpcData({field:'plain'}),{field:'plain'});
});
test('unrecognized symbols and accessors are rejected without invoking getters, including cleanup on failure',()=>{
 let getters=0,disposals=0;
 for(const raw of [{get field(){getters++;return 1;},[Symbol.dispose](){disposals++;}},{[Symbol('other')]:1,[Symbol.dispose](){disposals++;}}])assert.throws(()=>observerRpcData(raw),/observer-rpc-data-invalid/);
 assert.equal(getters,0);assert.equal(disposals,2);
 assert.throws(()=>observerRpcData({get [Symbol.dispose](){getters++;return ()=>{};}}),/observer-rpc-data-invalid/);assert.equal(getters,0);
});
test('RPC data cannot alter the detached object prototype',()=>{
 const copy=observerRpcData(JSON.parse('{"__proto__":{"polluted":true},"field":1}'));
 assert.equal(Object.getPrototypeOf(copy),Object.prototype);assert.equal(Object.hasOwn(copy,'__proto__'),true);assert.equal(({} as {polluted?:boolean}).polluted,undefined);
});
test('authorization aggregate is disposed after its deadline race has already rejected',async()=>{
 let resolve!:(value:object)=>void,disposed=0;
 const pending=observerRpcPendingData(new Promise<object>(done=>{resolve=done;}));
 await assert.rejects(Promise.race([pending,Promise.reject(Error('deadline'))]),/deadline/);
 assert.equal(disposed,0);resolve({grant:1,[Symbol.dispose](){disposed++;}});
 assert.deepEqual(await pending,{grant:1});assert.equal(disposed,1);
});
test('late malformed aggregates still dispose and cannot replace the deadline failure',async()=>{
 let resolve!:(value:object)=>void,disposed=0,getters=0;
 const pending=observerRpcPendingData(new Promise<object>(done=>{resolve=done;}));
 await assert.rejects(Promise.race([pending,Promise.reject(Error('deadline'))]),/deadline/);
 resolve({get grant(){getters++;return 1;},[Symbol.dispose](){disposed++;}});
 await assert.rejects(pending,/observer-rpc-data-invalid/);assert.equal(disposed,1);assert.equal(getters,0);
});
