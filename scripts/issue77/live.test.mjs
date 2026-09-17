import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {checkCandidate} from './live.mjs';
test('default operator invocation is preflight only and cannot read credentials or provision a Session',()=>{const output=JSON.parse(execFileSync(process.execPath,['scripts/issue77/live.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH}}));assert.equal(output.paidRequests,0);assert.equal(output.mode,'preflight-only');assert.equal(output.policy.maxTurns,6);assert.equal(output.policy.stopThresholdUsd,5);});
test('candidate conversion supplies reviewed adapter and never asserts a saved Revision or formal Run',async()=>{
 const identity={scope:{tenantId:'t',projectId:'p',workspaceId:'w',workspaceGeneration:1},sessionId:'s',turnId:'t',dispatchId:'d',generation:1};
 const binding={schemaVersion:1,backend:'managed-agents',identity,inputSha256:'a'.repeat(64),reservedAt:1,remoteSessionId:'rs',remoteTurnId:'rt'};
 const raw={schemaVersion:1,spec:{schemaVersion:1,researchQuestion:'Queue test',scope:'synthetic',entities:['customer'],mechanisms:['FCFS'],assumptions:[],parameters:{service_time:{type:'integer',default:3,minimum:1,maximum:5}},metrics:{completed:{}},limitations:['candidate'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}},files:{'model/model.py':'def run(config): return {}\n','app/requirements.lock':'{"schemaVersion":1,"packages":{}}','model/results.json':'[]'}};
 const encode=value=>new TextEncoder().encode(JSON.stringify(value));
 const result=await checkCandidate(encode(raw),binding,1);assert.equal(result.report.formalRevisionSaved,false);assert.equal(result.report.formalExperimentExecuted,false);assert.equal(result.snapshot.backendState.backend,'managed-agents');
 await assert.rejects(checkCandidate(encode({...raw,files:{...raw.files,'../escape':'x'}}),binding,1),/candidate-json-schema/);
 await assert.rejects(checkCandidate(encode({...raw,spec:{...raw.spec,execution:{...raw.spec.execution,entrypoint:'missing.py'}}}),binding,1));
});
