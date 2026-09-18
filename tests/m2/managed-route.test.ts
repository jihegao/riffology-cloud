import assert from 'node:assert/strict';
import test from 'node:test';
import {managedAcceptancePolicy,managedProjectPolicy,requireManagedAdmission,managedProductActorName,resolveManagedRoute} from '../../services/workspace/managed-route.ts';
import {createGatewayTurnServices} from '../../services/gateway/turn-services.ts';
const scope={tenantId:'tenant',projectId:'synthetic',workspaceId:'workspace',workspaceGeneration:1};
const policy={schemaVersion:1 as const,policyId:'issue77-production-v1',scope,userId:'owner',enabled:true,syntheticOnly:true as const,maxTurns:6 as const,maxSessions:2 as const,observedStopUsd:5 as const,maxDurationMs:7200000 as const,maxTurnObservationMs:300000 as const,maxSimulationRuns:12 as const};
test('Managed policy rejects widened budgets and schema drift',()=>{
 assert.deepEqual(managedAcceptancePolicy(JSON.stringify(policy)),policy);
 for(const mutation of [{maxTurns:7},{maxSessions:3},{observedStopUsd:6},{maxDurationMs:7200001},{maxTurnObservationMs:300001},{maxSimulationRuns:13},{syntheticOnly:false},{extra:true},{enabled:'true'}])assert.throws(()=>managedAcceptancePolicy({...policy,...mutation}));
});
test('Managed routing is exact scope and cannot rollover a pinned policy',()=>{
 assert.equal(managedProjectPolicy(policy,{...scope,workspaceGeneration:2}),null);
 assert.equal(managedProjectPolicy(policy,{...scope,projectId:'other'}),null);
 assert.deepEqual(requireManagedAdmission(policy,policy,scope,'owner'),policy);
 for(const current of [undefined,{...policy,enabled:false},{...policy,policyId:'new-window'},{...policy,userId:'other'}])assert.throws(()=>requireManagedAdmission(current,policy,scope,'owner'));
 assert.throws(()=>requireManagedAdmission(policy,policy,scope,'other'));
 assert.equal(managedProductActorName(scope),managedProductActorName({...scope,workspaceGeneration:2}));
});
test('Gateway opens only the pinned Managed scope and owner while global Pi gate remains closed',async()=>{
 let calls=0;
 const stub={async submitTurn(){calls++;return {accepted:true};},async createSession(){},async cancelTurn(){},async replayTurnEvents(){},async turnSnapshot(){return {};},async listFiles(){},async diffFiles(){},async readArtifact(){}};
 const services=createGatewayTurnServices({M2_TURNS_ENABLED:'false',MANAGED_ACCEPTANCE_JSON:JSON.stringify(policy),MANAGED_TURN_RUNTIME:{getByName(){}},WORKSPACE_AGENT:{getByName(){return stub;}}});
 assert.deepEqual(await services.submit(scope,{userId:'owner',authVersion:1},'session','key',{message:'synthetic FCFS'}),{accepted:true});
 await assert.rejects(services.submit(scope,{userId:'other',authVersion:1},'session','key',{message:'x'}),/managed-admission-denied/);
 await assert.rejects(services.submit({...scope,projectId:'other'},{userId:'owner',authVersion:1},'session','key',{message:'x'}),/turn_runtime_not_ready/);
 assert.equal(calls,1);
 assert.equal(((await services.snapshot(scope)) as {admission:{state:string}}).admission.state,'enabled');
 assert.equal(((await services.snapshot({...scope,projectId:'other'})) as {admission:{state:string}}).admission.state,'maintenance');
});
test('Gateway rejects a configured Managed project when its binding is absent even if Pi enabled',async()=>{
 const services=createGatewayTurnServices({M2_TURNS_ENABLED:'true',MANAGED_ACCEPTANCE_JSON:JSON.stringify(policy),WORKSPACE_AGENT:{getByName(){throw Error('must-not-resolve');}}});
 await assert.rejects(services.submit(scope,{userId:'owner',authVersion:1},'session','key',{message:'x'}),/turn_runtime_unavailable/);
});

test('Persistent backend selection survives closed/removed config and rejects Pi history switching',()=>{
 assert.deepEqual(resolveManagedRoute(undefined,scope,policy,true),policy);
 assert.deepEqual(resolveManagedRoute({...policy,enabled:false},scope,policy,true),policy);
 assert.throws(()=>resolveManagedRoute(policy,scope,null,true),/existing-turn-history/);
 assert.equal(resolveManagedRoute(undefined,scope,null,true),null);
 assert.throws(()=>resolveManagedRoute(policy,{...scope,workspaceGeneration:2},policy,true),/scope-conflict/);
});
