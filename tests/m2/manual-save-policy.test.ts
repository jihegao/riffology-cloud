import test from 'node:test';
import assert from 'node:assert/strict';
import {manualSaveCapability,assertManualSaveBody} from '../../services/workspace/manual-save-policy.ts';
const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},actor={userId:'ordinary-owner',authVersion:1};
const policy={schema:'manual-save-policy/v1',enabled:true,startsAt:1000,endsAt:2000,scope,actor};
const env=(value:unknown=policy)=>({APP_ORIGIN:'https://app.riffoid.com',MANUAL_SAVE_POLICY_JSON:JSON.stringify(value)});
test('manual production permission is default denied and binds every scope/actor component',()=>{
 assert.equal(manualSaveCapability({},scope,actor,1500).canRead,false);
 assert.equal(manualSaveCapability(env(),scope,actor,1500).canWrite,true);
 for(const key of ['tenantId','projectId','workspaceId','workspaceGeneration'] as const){const other={...scope,[key]:key==='workspaceGeneration'?2:'other'};assert.equal(manualSaveCapability(env(),other,actor,1500).canRead,false);}
 for(const other of [{...actor,userId:'operator'},{...actor,authVersion:2}])assert.equal(manualSaveCapability(env(),scope,other,1500).canRead,false);
 for(const p of [null,{}, {...policy,extra:true},{...policy,enabled:'true'},{...policy,endsAt:policy.startsAt+86400001},{...policy,startsAt:1.5}])assert.equal(manualSaveCapability(env(p),scope,actor,1500).canRead,false);
});
test('stopped or expired approved scope retains recovery but cannot start a new save',()=>{
 for(const [p,now]of [[policy,999],[policy,2000],[{...policy,enabled:false},1500]] as const){const c=manualSaveCapability(env(p),scope,actor,now);assert.equal(c.canRead,true);assert.equal(c.canRecover,true);assert.equal(c.canWrite,false);}
});
test('a bounded current grant preserves a stopped scope recovery without widening either grant',()=>{
 const old={...policy,enabled:false},nextScope={...scope,projectId:'port',workspaceId:'port-workspace'},nextActor={...actor,authVersion:2};
 const next={...policy,scope:nextScope,actor:nextActor,startsAt:1500,endsAt:2500},multi={schema:'manual-save-policy/v2',recovery:old,current:next};
 const prior=manualSaveCapability(env(multi),scope,actor,1600),port=manualSaveCapability(env(multi),nextScope,nextActor,1600);
 assert.equal(prior.canRead,true);assert.equal(prior.canRecover,true);assert.equal(prior.canWrite,false);
 assert.equal(port.canRead,true);assert.equal(port.canRecover,true);assert.equal(port.canWrite,true);
 assert.equal(manualSaveCapability(env(multi),nextScope,actor,1600).canRead,false);
 const expired=manualSaveCapability(env(multi),nextScope,nextActor,2500);assert.equal(expired.canWrite,false);assert.equal(expired.canRecover,true);
 for(const value of [
  {...multi,unexpected:true}, {...multi,recovery:null}, {...multi,recovery:{...old,enabled:true}},
  {...multi,current:{...old}}, {...multi,current:{...next,endsAt:next.startsAt+86400001}},
  {...multi,current:{...next,extra:true}},
 ])for(const [target,owner]of [[scope,actor],[nextScope,nextActor]] as const)assert.equal(manualSaveCapability(env(value),target,owner,1600).canRead,false);
});
test('production requests have a UTF8 small text envelope below signed Entry capacity',()=>{
 const body={changes:[{encoding:'utf8',content:'hello'}],deletes:[]};assert.equal(assertManualSaveBody(env(),scope,actor,body).maxRequestBytes,24576);
 for(const change of [{encoding:'base64',content:'AA=='},{encoding:'utf8',content:'x\0y'}])assert.throws(()=>assertManualSaveBody(env(),scope,actor,{...body,changes:[change]}),/invalid/);
 assert.throws(()=>assertManualSaveBody(env(),scope,actor,{...body,changes:[{encoding:'utf8',content:'中'.repeat(2731)}]}),/limit/);
 assert.throws(()=>assertManualSaveBody(env(),scope,actor,{...body,deletes:Array(9).fill('a')}),/limit/);
 assert.throws(()=>assertManualSaveBody(env(),scope,actor,{...body,padding:'x'.repeat(24576)}),/limit/);
});
