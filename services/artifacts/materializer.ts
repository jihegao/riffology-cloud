import { jsonPayload } from '../turn/protocol.ts';
import type { ToolEffectReceipt } from '../tools/ledger.ts';
import type { ToolCommand } from '../tools/protocol.ts';
import { toolArtifactDescriptor, toolArtifactReceipt, type ToolArtifactIdentity, type ToolArtifactStoreRpc } from './protocol.ts';

const encoder=new TextEncoder();
function reject(code:string):never{throw Error(code);}
function identity(command:ToolCommand,receipt:ToolEffectReceipt):ToolArtifactIdentity{
  if(command.operation!=='read'&&command.operation!=='list'&&command.operation!=='search')reject('tool-result-artifact-operation-denied');
  return {scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,effectId:receipt.effectId,operation:command.operation};
}
function receiptFor(value:unknown,descriptor:Awaited<ReturnType<typeof toolArtifactDescriptor>>){
  const receipt=toolArtifactReceipt(value);
  if(receipt.artifactId!==descriptor.artifactId||receipt.operation!==descriptor.identity.operation||receipt.mediaType!==descriptor.descriptor.mediaType||receipt.bytes!==descriptor.descriptor.bytes||receipt.sha256!==descriptor.descriptor.sha256)reject('tool-artifact-receipt-conflict');
  return receipt;
}
export interface ToolResultMaterializer{materialize(receipt:ToolEffectReceipt,command:ToolCommand):Promise<ToolEffectReceipt>}
export class ToolArtifactMaterializer implements ToolResultMaterializer{
  #store:ToolArtifactStoreRpc;
  constructor(store:ToolArtifactStoreRpc){if(!store?.materialize||!store?.reconcile)reject('tool-artifact-store-required');this.#store=store;}
  async materialize(receipt:ToolEffectReceipt,command:ToolCommand):Promise<ToolEffectReceipt>{
    if(receipt.phase!=='terminal'||receipt.outcome!=='completed'||receipt.result===null)return receipt;
    const content=encoder.encode(JSON.stringify(receipt.result));if(content.byteLength<=16384)return {...receipt,result:jsonPayload(receipt.result)};
    const artifactIdentity=identity(command,receipt),input={identity:artifactIdentity,mediaType:'application/json' as const,content},intent=await toolArtifactDescriptor(input);
    let saved;
    try{saved=receiptFor((await this.#store.materialize(input)).receipt,intent);}
    catch(error){const recovered=await this.#store.reconcile(artifactIdentity,{operationId:intent.operationId,inputSha256:intent.inputSha256});if(!recovered)throw error;saved=recovered;}
    return {...receipt,result:jsonPayload({kind:'artifact',artifact:receiptFor(saved,intent)})};
  }
}
