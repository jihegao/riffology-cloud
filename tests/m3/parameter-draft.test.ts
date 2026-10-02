import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,scope} from './run-fixture.ts';
import {parameterDraftEffect,readParameterDraft} from '../../services/simulation/parameter-draft.ts';
import type {ModelInspection} from '../../services/simulation/source.ts';
import type {ToolCommand} from '../../services/tools/protocol.ts';
const version={revisionId:'rev-a',filesSha256:'a'.repeat(64),specSha256:'b'.repeat(64)};
const model:ModelInspection={version,spec:{schemaVersion:1,researchQuestion:'Fire',scope:'forest',entities:['tree'],mechanisms:['burn'],assumptions:[],limitations:[],parameters:{density:{type:'number',default:0.7,minimum:0,maximum:1},initial_fires:{type:'integer',default:3,minimum:1,maximum:10}},metrics:{burned:{}},execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}},canRun:true,reasonCode:null};
function setup(t:Parameters<typeof fixture>[0]){
 const f=fixture(t);f.db.exec('CREATE TABLE kv(k TEXT PRIMARY KEY,v TEXT)');
 const storage={...f.storage,kv:{get:<T,>(k:string):T|undefined=>{const r=f.db.prepare('SELECT v FROM kv WHERE k=?').get(k);return r?JSON.parse(String(r.v)):undefined;},put:(k:string,v:unknown)=>{f.db.prepare('INSERT OR REPLACE INTO kv VALUES(?,?)').run(k,JSON.stringify(v));}}} as unknown as Pick<DurableObjectStorage,'kv'|'sync'|'transactionSync'>;
 const command:ToolCommand={schemaVersion:1,scope,turnId:'turn-a',dispatchId:'dispatch-a',commandId:'cmd-a',deadlineAt:5000,operation:'experiment_parameters',arguments:{revisionId:'rev-a',parameters:{density:0.5,initial_fires:1},seed:42,comparison:{hypothesis:'Compare densities',interventions:[{label:'Density 0.6',parameters:{density:0.6}}],seeds:[42,43]}}};
 const input={storage,scope,command,effectId:'effect-a',observeOnly:false,model:async()=>structuredClone(model),authorize:async()=>{},assertCurrent:()=>{},clock:()=>f.now};return {f,storage,input};
}
test('draft and original tool receipt survive ACK loss/restart; observe never reapplies parameters or submits Runs',async t=>{
 const {f,storage,input}=setup(t);f.failNextSync();await assert.rejects(parameterDraftEffect(input),/injected-ack-loss/);f.reopen();const draft=readParameterDraft(storage,version)!;assert.deepEqual(draft.parameters,{density:0.5,initial_fires:1});assert.deepEqual(draft.comparison!.interventions[0]!.parameters,{density:0.6,initial_fires:1});assert.deepEqual(draft.comparison!.seeds,[42,43]);
 const receipt=await parameterDraftEffect({...input,observeOnly:true,authorize:async()=>{throw Error('revoked');}});assert.equal(receipt.outcome,'completed');assert.equal(receipt.result!.executionSubmitted,false);assert.equal(f.db.prepare("SELECT count(*) n FROM kv WHERE k LIKE 'simulation:run:%'").get()!.n,0);
 assert.equal(readParameterDraft(storage,{...version,revisionId:'new-identical-files'})!.draftId,'cmd-a');assert.equal(readParameterDraft(storage,{...version,filesSha256:'f'.repeat(64)}),null);
 await assert.rejects(parameterDraftEffect({...input,command:{...input.command,arguments:{...input.command.arguments,seed:43}}}),/tool-idempotency-conflict/);
});
for(const reason of ['scope','revoked','stale','range','group-limit','compiler'])test(`parameter draft rejects ${reason} before any draft mutation`,async t=>{
 const {storage,input}=setup(t);
 if(reason==='scope'){await assert.rejects(parameterDraftEffect({...input,scope:{...scope,projectId:'other-project'}}),/scope-denied/);return;}
 if(reason==='revoked')input.authorize=async()=>{throw Error('private-beta-admission-denied');};
 if(reason==='stale')input.command.arguments.revisionId='old-rev';
 if(reason==='range')input.command.arguments.parameters={density:2};
 if(reason==='group-limit')(input.command.arguments.comparison as {seeds:number[]}).seeds=[1,2,3,4,5];
 if(reason==='compiler')input.model=async()=>({...model,compiler:{} as NonNullable<ModelInspection['compiler']>});
 const receipt=await parameterDraftEffect(input);assert.equal(receipt.outcome,'failed');assert.equal(receipt.result!.executionSubmitted,false);assert.equal(readParameterDraft(storage,version),null);
 assert.deepEqual(await parameterDraftEffect({...input,observeOnly:true}),receipt);
});
test('observe missing receipt remains absent; final authorization and current-model fence reject yielded changes',async t=>{
 const {storage,input}=setup(t);assert.equal((await parameterDraftEffect({...input,observeOnly:true})).phase,'absent');let checks=0;input.authorize=async()=>{if(++checks===2)throw Error('parameter-draft-turn-denied');};assert.equal((await parameterDraftEffect(input)).outcome,'failed');assert.equal(readParameterDraft(storage,version),null);
 const next={...input,command:{...input.command,commandId:'cmd-b'},effectId:'effect-b',authorize:async()=>{},assertCurrent:()=>{throw Error('simulation-model-stale');}};assert.equal((await parameterDraftEffect(next)).errorCode,'simulation-model-stale');assert.equal(readParameterDraft(storage,version),null);
});
