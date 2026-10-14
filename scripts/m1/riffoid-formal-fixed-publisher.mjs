// Fixed reviewed formal payloads only. No OAuth, resources or T derivation here.
import assert from 'node:assert/strict';
import {hashJSON,hashBytes,stateMetadata} from './riffoid-validation-evidence.mjs';
import {collectReadback} from './riffoid-validation-publisher.mjs';
import {assertPreservationReadback} from './riffoid-validation-resources.mjs';
import {jsonResult} from './riffoid-validation-transport.mjs';
import {formalNativeIntentAuthorizer,formalFixedPhases} from './riffoid-formal-native-intent-authorizer.mjs';
const order=['gatewayCanonical','executionCanonical','entryEnabled'];
export class FormalFixedPublisher{
 constructor({frozenPlan,liveCapability,transport,journal}){
  this.frozenPlan=structuredClone(frozenPlan);this.frozenPlanSHA256=hashJSON(frozenPlan);
  this.liveCapability=structuredClone(liveCapability);this.transport=transport;this.journal=journal;
  this.busy=false;this.pending=null;this.cursor=0;this.spent=new Set();this.abortQueue=null;
  assert.equal(transport.mode,'live');
  assert.equal(this.liveCapability.frozenPlanSHA256,this.frozenPlanSHA256);
  assert.equal(this.frozenPlan.formalT,null,'T cannot be invented before acceptance');
  assert.equal(this.frozenPlan.recoveryUntil,null);
  assert.equal(this.frozenPlan.guardStatus,'FRESH_POST_PROTOCOL_BASELINE_AND_ACCEPTANCE_SCOPE_REVIEWED');
  assert.deepEqual(Object.keys(this.frozenPlan.requests).sort(),[...formalFixedPhases].sort());
  assert.deepEqual(Object.keys(this.frozenPlan.postProtocolBaselines).sort(),['entry','execution','gateway']);
  this.current=structuredClone(this.frozenPlan.postProtocolBaselines);
  this.artifacts=Object.fromEntries(Object.entries(this.frozenPlan.baselines).map(([w,b])=>[w,{metadata:b.metadata,modules:b.modules}]));
  for(const [w,b] of Object.entries(this.current)){
   assert.equal(b.worker,this.frozenPlan.baselines[w].worker);
   assert.equal(b.metadataSHA256,hashJSON(stateMetadata(this.artifacts[w].metadata)));
   assert.equal(b.modulesSHA256,hashJSON(this.artifacts[w].modules));
   assert.match(b.resourcesSHA256,/^[a-f0-9]{64}$/);
   assert.match(b.version,/^[a-f0-9-]{36}$/);assert.match(b.deployment,/^[a-f0-9-]{36}$/);
  }
  this.authorizeWrite=formalNativeIntentAuthorizer({publisher:this,journal});
 }
 get allowedPhase(){return this.abortQueue?this.abortQueue[0]??null:order[this.cursor]??null;}
 async assertOwned(){assert.equal((await this.journal.lockState()).owned,true,'original publisher lock lost');}
 async verify(w,artifact,expected){
  const a=this.frozenPlan.accounts[w],r=await collectReadback(this.transport,a,expected.worker,artifact,this.frozenPlan.preservation[w],{timeoutMS:180000,perGETTimeoutMS:30000,sourceGETTimeoutMS:60000});
  assertPreservationReadback(r,this.frozenPlan.preservation[w].assets,{accountId:a,worker:expected.worker});
  assert.equal(r.pipelineGuardPassed,true);assert.equal(r.resourcesSHA256,expected.resourcesSHA256);
  return r;
 }
 async beginKnownFailureRollback(failure){
  assert.equal(this.busy,false);assert.equal(this.pending,null);assert.equal(this.abortQueue,null);
  assert.equal(await this.journal.hasPending(),false,'unknown write permits GET only');
  assert.ok(this.cursor>0);assert.equal(failure.frozenPlanSHA256,this.frozenPlanSHA256);
  assert.equal(failure.outcome,'known-failure');assert.ok(typeof failure.reason==='string'&&failure.reason.length>0&&failure.reason.length<512);
  assert.deepEqual(failure.current,this.current,'failure must name the exact confirmed deployment states');
  assert.equal(this.liveCapability.failureDisposition,'exact-close-forward-rollback');
  const queue=[...(this.cursor===3?['entryClose']:[]),'gatewayRollback',...(this.cursor>=2?['executionRollback']:[]),...(this.cursor===3?['entryRollback']:[])];
  await this.journal.append('formal_failure_decision','decision',{...failure,queue,recordedAt:Date.now()});this.abortQueue=queue;
 }
 async publish(phase,body){
  assert.equal(this.busy,false);assert.equal(this.pending,null);assert.equal(await this.journal.hasPending(),false);
  assert.equal(phase,this.allowedPhase);assert.equal(this.spent.has(phase),false);
  assert.equal(hashJSON(this.frozenPlan),this.frozenPlanSHA256);
  const q=this.frozenPlan.requests[phase],p=this.frozenPlan.phases[phase],w=p.worker,prior=this.current[w];
  assert.ok(Buffer.isBuffer(body));assert.equal(hashBytes(body),q.bodySHA256);assert.equal(body.length,q.bytes);
  assert.equal(q.accountId,this.frozenPlan.accounts[w]);assert.equal(q.worker,prior.worker);
  this.busy=true;this.spent.add(phase);let locked=false;
  try{
   await this.journal.lock();locked=true;
   // Each original request verifies complete target state. Before exposing the
   // entry, independently bracket both already changed backend deployments too.
   for(const target of phase==='entryEnabled'?['gateway','execution',w]:[w]){
    const expected=this.current[target],pre=await this.verify(target,this.artifacts[target],expected);
    assert.equal(pre.version,expected.version);assert.equal(pre.deployment,expected.deployment);
   }
   await this.assertOwned();const startedAt=Date.now();
   const intent={frozenPlanSHA256:this.frozenPlanSHA256,phase,requestId:q.requestId,accountId:q.accountId,worker:q.worker,
    priorVersion:prior.version,priorDeployment:prior.deployment,priorMetadataSHA256:prior.metadataSHA256,
    priorModulesSHA256:prior.modulesSHA256,priorResourcesSHA256:prior.resourcesSHA256,bodySHA256:q.bodySHA256,bytes:q.bytes,startedAt};
   await this.journal.append(q.requestId,'intent',intent);
   this.pending={requestId:q.requestId,phase,prior:structuredClone(prior),startedAt};
   const ack=jsonResult(await this.transport.request({method:'PUT',path:q.path,contentType:q.contentType,body}));
   assert.equal(ack.result.id,prior.worker);
   const receipt=await this.verify(w,p,prior);await this.assertOwned();
   assert.equal(receipt.metadataSHA256,p.metadataSHA256);assert.equal(receipt.modulesSHA256,p.modulesSHA256);
   const next={worker:prior.worker,version:receipt.version,deployment:receipt.deployment,metadataSHA256:receipt.metadataSHA256,modulesSHA256:receipt.modulesSHA256,resourcesSHA256:receipt.resourcesSHA256};
   await this.journal.append(q.requestId,'terminal',{phase,requestId:q.requestId,receipt,ackScript:ack.result.id,readbackAt:Date.now()});
   this.current[w]=next;this.artifacts[w]=structuredClone(p);this.pending=null;
   if(this.abortQueue)this.abortQueue.shift();else this.cursor++;
   return {phase,requestId:q.requestId,...receipt,formalT:null,recoveryUntil:null};
  }catch(error){
   if(this.pending)await this.journal.append(q.requestId,'unknown',{phase,requestId:q.requestId,reportDueAt:Date.now()+600000,
    stopFurtherTest:true,automaticRetry:false,automaticRollback:false,requiredAction:'GET original identity only; await separate recovery decision'}).catch(()=>{});
   throw error;
  }finally{
   this.busy=false;if(locked&&!this.pending&&(await this.journal.lockState()).owned)await this.journal.unlock();
  }
 }
}
