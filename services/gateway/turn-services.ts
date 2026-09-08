import type { TurnActor, TurnScope } from '../turn/protocol.ts';
import { workspaceAgentName } from '../workspace/protocol.ts';
import { requireTurnRuntime } from './turn-runtime-gate.ts';

interface WorkspaceTurnActor {
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
  M2_TURNS_ENABLED: unknown;
  WORKSPACE_AGENT: { getByName(name: string): WorkspaceTurnActor };
}

export function createGatewayTurnServices(env: TurnServicesEnv) {
  const actor = (scope: TurnScope) => env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId, scope.workspaceId));
  return {
    async createSession(scope: TurnScope, caller: TurnActor, key: string, body: { title: unknown }) {
      return actor(scope).createSession({ scope, actor: caller, key, body });
    },
    async submit(scope: TurnScope, caller: TurnActor, sessionId: string, key: string, body: { message: unknown }) {
      requireTurnRuntime(env.M2_TURNS_ENABLED);
      return actor(scope).submitTurn({ scope, actor: caller, sessionId, key, body });
    },
    async cancel(scope: TurnScope, caller: TurnActor, turnId: string) {
      return actor(scope).cancelTurn({ scope, actor: caller, turnId });
    },
    async replay(scope: TurnScope, afterSequence: number, limit: number) {
      return actor(scope).replayTurnEvents({ scope, afterSequence, limit });
    },
    async snapshot(scope: TurnScope) {
      return actor(scope).turnSnapshot({ scope });
    },
    async files(scope:TurnScope){return actor(scope).listFiles({scope});},
    async diff(scope:TurnScope){return actor(scope).diffFiles({scope});},
    async artifact(scope:TurnScope,artifactId:string){return actor(scope).readArtifact({scope,artifactId});},
  };
}
