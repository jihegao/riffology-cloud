import type {ToolCommand} from '../tools/protocol.ts';
import type {ToolEffectReceipt} from '../tools/ledger.ts';
import type {ToolEffectPort} from '../tools/dispatcher.ts';

export interface ProjectIrEffectAuthority {
 projectIrToolEffect(input:{command:ToolCommand;effectId:string;observeOnly:boolean}):Promise<ToolEffectReceipt>;
 projectIrRegisterEffect(input:{command:ToolCommand;effectId:string;receipt:ToolEffectReceipt}):Promise<ToolEffectReceipt>;
}
/** The original durable command/effect identity is passed through unchanged.
 * Observing never dispatches Project Tools or creates a replacement run. */
export function createProjectIrEffects(files:ToolEffectPort,authority:(command:ToolCommand)=>ProjectIrEffectAuthority):ToolEffectPort{
 const direct=(command:ToolCommand)=>command.arguments.operation==='project_ir_run'||command.arguments.operation==='project_ir_result';
 const register=async(command:ToolCommand,effectId:string,receipt:ToolEffectReceipt)=>{
  if(receipt.phase!=='terminal'||receipt.outcome!=='completed')return receipt;
  return authority(command).projectIrRegisterEffect({command,effectId,receipt});
 };
 return {
  async execute(input){
   if(input.command.operation!=='ir')throw Error('project-ir-operation-required');
   if(direct(input.command))return authority(input.command).projectIrToolEffect({...input,observeOnly:false});
   return register(input.command,input.effectId,await files.execute(input));
  },
  async observe(input){
   if(input.command.operation!=='ir')throw Error('project-ir-operation-required');
   if(direct(input.command))return authority(input.command).projectIrToolEffect({command:input.command,effectId:input.reference.effectId,observeOnly:true});
   return register(input.command,input.reference.effectId,await files.observe(input));
  },
 };
}
