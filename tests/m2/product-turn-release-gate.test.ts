import assert from 'node:assert/strict';
import test from 'node:test';
import { productTurnRuntimeRelease } from '../../services/turn-runtime/release-gated.ts';
import type { TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';

const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1};
function state(){const values=new Map();return {storage:{kv:{get(key:string){return values.get(key);},put(key:string,value:unknown){values.set(key,value);}},sql:{exec(){return {toArray:()=>[]};}},transactionSync(fn:()=>unknown){return fn();},async sync(){}}} as unknown as DurableObjectState;}
const sandboxes={project(){throw Error('must-not-resolve-eagerly');},trustedPi(){throw Error('must-not-resolve-eagerly');}};
const capacity={lookup(){throw Error('unused');},dispatch(){throw Error('unused');},confirmReleased(){throw Error('unused');}};

test('maintenance release assembly ignores the admission gate while still requiring exact dependencies',()=>{
  for(const gate of [undefined,null,false,true,'TRUE',' true ','false']){
    let touched=0;
    const revision={prepareCommit(){},commitPrepared(){},commit(){},reconcileCommit(){},abandonCommit(){},observe(){},restore(){},load(){},gc(){}};
    const namespace={idFromName(){touched++;throw Error('must-not-resolve-eagerly');},getByName(){touched++;throw Error('must-not-resolve-eagerly');}};
    const env={M2_TURNS_ENABLED:gate,PRODUCT_TURN_RUNTIME:{},REVISION_STORE:{getByName(){return revision;}},PROJECT_SANDBOX:namespace,TRUSTED_PI_SANDBOX:namespace,TRUSTED_PI_CAPACITY:{getByName(){return capacity;}}};
    const release=productTurnRuntimeRelease(state(),env as never,identity,sandboxes as never);assert.ok(release.execution);assert.equal(touched,0);
  }
});

test('enabled production release requires RevisionStore and Sandbox bindings without resolving Sandbox actors eagerly',()=>{
  const namespace={idFromName(){throw Error('must-not-resolve-eagerly');},getByName(){throw Error('must-not-resolve-eagerly');}};
  const revision={prepareCommit(){},commitPrepared(){},commit(){},reconcileCommit(){},abandonCommit(){},observe(){},restore(){},load(){},gc(){}};
  for(const missing of ['REVISION_STORE','PROJECT_SANDBOX','TRUSTED_PI_SANDBOX','TRUSTED_PI_CAPACITY'] as const){
    const env:{[key:string]:unknown}={M2_TURNS_ENABLED:'true',PRODUCT_TURN_RUNTIME:{},REVISION_STORE:{getByName(){return revision;}},PROJECT_SANDBOX:namespace,TRUSTED_PI_SANDBOX:namespace,TRUSTED_PI_CAPACITY:{getByName(){return capacity;}}};delete env[missing];
    assert.throws(()=>productTurnRuntimeRelease(state(),env as never,identity,sandboxes as never),/dependencies-required/);
  }
  const release=productTurnRuntimeRelease(state(),{M2_TURNS_ENABLED:'true',PRODUCT_TURN_RUNTIME:{},REVISION_STORE:{getByName(){return revision;}},PROJECT_SANDBOX:namespace,TRUSTED_PI_SANDBOX:namespace,TRUSTED_PI_CAPACITY:{getByName(){return capacity;}}} as never,identity,sandboxes as never);
  assert.ok(release.execution);assert.ok(release.checkpoints);
});

test('lazy admission requires the first-tool Workspace authority binding',()=>{const namespace={idFromName(){throw Error('unused');},getByName(){throw Error('unused');}},env={M2_LAZY_PROJECT_ENABLED:'true',REVISION_STORE:{getByName(){return {};}},PROJECT_SANDBOX:namespace,TRUSTED_PI_SANDBOX:namespace,TRUSTED_PI_CAPACITY:{getByName(){return capacity;}}};assert.throws(()=>productTurnRuntimeRelease(state(),env as never,identity,sandboxes as never),/dependencies-required/);});
