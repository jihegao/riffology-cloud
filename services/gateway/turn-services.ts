import {managedProjectPolicy} from '../workspace/managed-route.ts';
import type { TurnActor, TurnScope } from '../turn/protocol.ts';
import { workspaceAgentName } from '../workspace/protocol.ts';
import { requireTurnRuntime, turnAdmissionStatus } from './turn-runtime-gate.ts';
import {traceTurnAdmission} from '../turn/admission-telemetry.ts';

interface WorkspaceTurnActor {
  managedAcceptanceStatus?(input:{scope:TurnScope;actor:TurnActor}):Promise<unknown>;
  cleanupManagedAcceptance?(input:{scope:TurnScope;actor:TurnActor}):Promise<unknown>;
  createSession(input: { scope: TurnScope; actor: TurnActor; key: string; body: { title: unknown } }): Promise<unknown>;
  submitTurn(input: { scope: TurnScope; actor: TurnActor; sessionId: string; key: string; body: { message: unknown } }): Promise<unknown>;
  cancelTurn(input: { scope: TurnScope; actor: TurnActor; turnId: string }): Promise<unknown>;
  replayTurnEvents(input: { scope: TurnScope; afterSequence: number; limit: number }): Promise<unknown>;
  turnSnapshot(input: { scope: TurnScope }): Promise<unknown>;
  listFiles(input:{scope:TurnScope}):Promise<unknown>;
  diffFiles(input:{scope:TurnScope}):Promise<unknown>;
  readArtifact(input:{scope:TurnScope;artifactId:string}):Promise<unknown>;
}

interface TurnServicesEnv {
  MANAGED_ACCEPTANCE_JSON?:string;
  MANAGED_TESTING_JSON?:string;
  MANAGED_TURN_RUNTIME?:{getByName:unknown};
  M2_TURNS_ENABLED: unknown;
  M2_TURN_RUNTIME_CONFIGURED?: unknown;
  M2_TURN_ADMISSION_TELEMETRY?:unknown;
  WORKSPACE_AGENT: { getByName(name: string): WorkspaceTurnActor };
}

export function createGatewayTurnServices(env: TurnServicesEnv) {
  const actor = (scope: TurnScope) => env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId, scope.workspaceId));
  return {
    async managedAcceptanceStatus(scope:TurnScope,caller:TurnActor){const stub=actor(scope);if(!stub.managedAcceptanceStatus)throw Error('managed-product-runtime-not-configured');return stub.managedAcceptanceStatus({scope,actor:caller});},
    async cleanupManagedAcceptance(scope:TurnScope,caller:TurnActor){const stub=actor(scope);if(!stub.cleanupManagedAcceptance)throw Error('managed-product-runtime-not-configured');return stub.cleanupManagedAcceptance({scope,actor:caller});},
    async createSession(scope: TurnScope, caller: TurnActor, key: string, body: { title: unknown }) {
      return actor(scope).createSession({ scope, actor: caller, key, body });
    },
    async submit(scope: TurnScope, caller: TurnActor, sessionId: string, key: string, body: { message: unknown }) {
      try{
        const managed=managedProjectPolicy(env.MANAGED_ACCEPTANCE_JSON,scope,env.MANAGED_TESTING_JSON);
        if(managed){if(!managed.enabled||managed.userId!==caller.userId)throw Error('managed-admission-denied');requireTurnRuntime('true',typeof env.MANAGED_TURN_RUNTIME?.getByName==='function');}
        else requireTurnRuntime(env.M2_TURNS_ENABLED,env.M2_TURN_RUNTIME_CONFIGURED!==false);
        const result=await actor(scope).submitTurn({scope,actor:caller,sessionId,key,body});
        traceTurnAdmission(env.M2_TURN_ADMISSION_TELEMETRY,'gateway',true);return result;
      }catch(error){traceTurnAdmission(env.M2_TURN_ADMISSION_TELEMETRY,'gateway',false,error);throw error;}
    },
    async cancel(scope: TurnScope, caller: TurnActor, turnId: string) {
      return actor(scope).cancelTurn({ scope, actor: caller, turnId });
    },
    async replay(scope: TurnScope, afterSequence: number, limit: number) {
      return actor(scope).replayTurnEvents({ scope, afterSequence, limit });
    },
    async snapshot(scope: TurnScope) {
      const value = await actor(scope).turnSnapshot({ scope });
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      return { ...(value as Record<string, unknown>), admission: managedProjectPolicy(env.MANAGED_ACCEPTANCE_JSON,scope,env.MANAGED_TESTING_JSON)?turnAdmissionStatus(managedProjectPolicy(env.MANAGED_ACCEPTANCE_JSON,scope,env.MANAGED_TESTING_JSON)?.enabled?'true':'false',typeof env.MANAGED_TURN_RUNTIME?.getByName==='function'):turnAdmissionStatus(env.M2_TURNS_ENABLED, env.M2_TURN_RUNTIME_CONFIGURED !== false) };
    },
    async files(scope:TurnScope){return actor(scope).listFiles({scope});},
    async diff(scope:TurnScope){return actor(scope).diffFiles({scope});},
    async artifact(scope:TurnScope,artifactId:string){return actor(scope).readArtifact({scope,artifactId});},
  };
}
