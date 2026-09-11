import assert from 'node:assert/strict';
import test from 'node:test';
import { productTurnRuntimeRelease } from '../../services/turn-runtime/release-gated.ts';
import type { TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';

const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1};
const sandboxes={project(){throw Error('must-not-resolve-eagerly');},trustedPi(){throw Error('must-not-resolve-eagerly');}};
const capacity={lookup(){throw Error('unused');},dispatch(){throw Error('unused');},confirmReleased(){throw Error('unused');}};

test('maintenance release assembly ignores the admission gate while still requiring exact dependencies',()=>{
  for(const gate of [undefined,null,false,true,'TRUE',' true ','false']){
    let touched=0;
    const revision={commit(){},reconcileCommit(){},abandonCommit(){},observe(){},restore(){},load(){},gc(){}};
    const namespace={idFromName(){touched++;throw Error('must-not-resolve-eagerly');},getByName(){touched++;throw Error('must-not-resolve-eagerly');}};
    const env={M2_TURNS_ENABLED:gate,PRODUCT_TURN_RUNTIME:{},REVISION_STORE:{getByName(){return revision;}},PROJECT_SANDBOX:namespace,TRUSTED_PI_SANDBOX:namespace,TRUSTED_PI_CAPACITY:{getByName(){return capacity;}}};
    const release=productTurnRuntimeRelease({} as DurableObjectState,env as never,identity,sandboxes as never);assert.ok(release.execution);assert.equal(touched,0);
  }
});

test('enabled production release requires RevisionStore and Sandbox bindings without resolving Sandbox actors eagerly',()=>{
  const namespace={idFromName(){throw Error('must-not-resolve-eagerly');},getByName(){throw Error('must-not-resolve-eagerly');}};
  const revision={commit(){},reconcileCommit(){},abandonCommit(){},observe(){},restore(){},load(){},gc(){}};
  for(const missing of ['REVISION_STORE','PROJECT_SANDBOX','TRUSTED_PI_SANDBOX','TRUSTED_PI_CAPACITY'] as const){
    const env:{[key:string]:unknown}={M2_TURNS_ENABLED:'true',PRODUCT_TURN_RUNTIME:{},REVISION_STORE:{getByName(){return revision;}},PROJECT_SANDBOX:namespace,TRUSTED_PI_SANDBOX:namespace,TRUSTED_PI_CAPACITY:{getByName(){return capacity;}}};delete env[missing];
    assert.throws(()=>productTurnRuntimeRelease({} as DurableObjectState,env as never,identity,sandboxes as never),/dependencies-required/);
  }
  const release=productTurnRuntimeRelease({} as DurableObjectState,{M2_TURNS_ENABLED:'true',PRODUCT_TURN_RUNTIME:{},REVISION_STORE:{getByName(){return revision;}},PROJECT_SANDBOX:namespace,TRUSTED_PI_SANDBOX:namespace,TRUSTED_PI_CAPACITY:{getByName(){return capacity;}}} as never,identity,sandboxes as never);
  assert.ok(release.execution);assert.ok(release.checkpoints);
});
