import { sandboxActorIds } from '../sandbox/policy.ts';
import {
  scope as validateScope,
  turnId,
  type TurnScope,
} from '../turn/protocol.ts';

export async function toolBridgeActorName(
  rawScope: TurnScope,
  rawTurnId: string,
  rawDispatchId: string,
): Promise<string> {
  const scope = validateScope(rawScope);
  const turn = turnId(rawTurnId);
  const dispatch = turnId(rawDispatchId);
  const project = (await sandboxActorIds(scope, turn, dispatch)).project;

  return `m2-b-${project.slice('m2-p-'.length)}`;
}
