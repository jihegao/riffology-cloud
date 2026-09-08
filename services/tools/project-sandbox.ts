import { issueProjectEffectCapability } from '../sandbox/capability.ts';
import { sandboxActorIds } from '../sandbox/policy.ts';
import type { ProjectToolSandbox } from '../sandbox/classes.ts';
import { positive, sameScope, turnId } from '../turn/protocol.ts';
import { normalizeToolCommand, toolCommandDigest, type ToolCommand } from './protocol.ts';
import type { ToolCommandReference, ToolEffectReceipt } from './ledger.ts';
import type { ToolEffectPort } from './dispatcher.ts';

type ProjectSandboxRpc=Pick<ProjectToolSandbox,'executeFileEffect'|'observeFileEffect'>;
type Resolver=(actorId:string)=>ProjectSandboxRpc;

/** Platform-side adapter used only after ToolDispatcher's durable Ledger has
 * granted execute or observe. It derives the Project Sandbox actor from the
 * immutable command identity and never accepts an actor id from Pi or users. */
export class ProjectSandboxFileEffects implements ToolEffectPort{
  #key:string;#clock:()=>number;#resolve:Resolver;
  constructor(key:string,resolver:Resolver,clock:()=>number=Date.now){
    this.#key=key;this.#clock=clock;this.#resolve=resolver;
  }
  async #target(commandInput:ToolCommand,effectIdInput:string):Promise<{command:ToolCommand;effectId:string;actorId:string;sandbox:ProjectSandboxRpc;capability:Awaited<ReturnType<typeof issueProjectEffectCapability>>}>{
    const command=normalizeToolCommand(commandInput),effectId=turnId(effectIdInput),now=positive(this.#clock());
    const actorId=(await sandboxActorIds(command.scope,command.turnId,command.dispatchId)).project;
    const capability=await issueProjectEffectCapability(this.#key,{actorId,command,effectId,expiresAt:now+5*60_000},()=>now);
    return {command,effectId,actorId,sandbox:this.#resolve(actorId),capability};
  }
  async execute(input:{command:ToolCommand;effectId:string}):Promise<ToolEffectReceipt>{
    const target=await this.#target(input.command,input.effectId);
    return target.sandbox.executeFileEffect({command:target.command,effectId:target.effectId,capability:target.capability});
  }
  async observe(input:{reference:ToolCommandReference;command:ToolCommand}):Promise<ToolEffectReceipt>{
    const command=normalizeToolCommand(input.command),reference=input.reference;
    if(reference.turnId!==command.turnId||reference.dispatchId!==command.dispatchId||reference.commandId!==command.commandId||!sameScope(reference.scope,command.scope)||reference.digest!==await toolCommandDigest(command))throw Error('project-sandbox-reference-mismatch');
    const target=await this.#target(command,reference.effectId);
    return target.sandbox.observeFileEffect({reference,command:target.command,capability:target.capability});
  }
}
