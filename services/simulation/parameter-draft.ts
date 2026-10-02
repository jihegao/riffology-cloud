import {parameterDraftArguments} from './parameter-draft-input.ts';
import type {ModelInspection} from './source.ts';
import {resolveParameters,type ParameterValues} from './model-spec.ts';
import {experimentGroupRequest,type ExperimentGroupRequest} from './groups.ts';
import {normalizeToolCommand,toolCommandDigest,type ToolCommand} from '../tools/protocol.ts';
import type {ToolEffectReceipt} from '../tools/ledger.ts';
import {sameScope,turnId,type TurnScope} from '../turn/protocol.ts';

export type ExperimentParameterDraft={draftId:string;version:NonNullable<ModelInspection['version']>;parameters:ParameterValues;seed:number;comparison:ExperimentGroupRequest|null;updatedAt:number};
const KEY='simulation:parameter-draft',PREFIX='simulation:parameter-effect:';
function draftParameters(spec:NonNullable<ModelInspection['spec']>,raw:unknown){try{return resolveParameters(spec,raw);}catch(error){if(error instanceof Error&&error.message==='invalid-model-spec')throw Error('simulation-input-invalid');throw error;}}
export function readParameterDraft(storage:Pick<DurableObjectStorage,'kv'>,version:ModelInspection['version']){
 const draft=storage.kv.get<ExperimentParameterDraft>(KEY);
 return draft&&version&&draft.version.filesSha256===version.filesSha256&&draft.version.specSha256===version.specSha256?draft:null;
}
/** A platform draft effect uses the existing one-shot Tool Ledger. Its receipt
 * and draft commit atomically; observing an absent receipt never reapplies it. */
export async function parameterDraftEffect(input:{storage:Pick<DurableObjectStorage,'kv'|'transactionSync'|'sync'>;scope:TurnScope;command:ToolCommand;effectId:string;observeOnly:boolean;model:()=>Promise<ModelInspection>;authorize:()=>Promise<void>;assertCurrent:(version:NonNullable<ModelInspection['version']>)=>void;clock?:()=>number;maxGroupRuns?:number}):Promise<ToolEffectReceipt>{
 const {storage}=input,command=normalizeToolCommand(input.command),effectId=turnId(input.effectId),now=input.clock??Date.now;
 if(command.operation!=='experiment_parameters'||!sameScope(command.scope,input.scope))throw Error('parameter-draft-scope-denied');
 const digest=await toolCommandDigest(command),key=PREFIX+effectId;
 const prior=storage.kv.get<{digest:string;receipt:ToolEffectReceipt}>(key);
 if(prior){if(prior.digest!==digest)throw Error('tool-idempotency-conflict');return prior.receipt;}
 const receipt:ToolEffectReceipt={schemaVersion:1,scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,effectId,phase:'absent',outcome:null,errorCode:null,result:null,observedAt:now()};
 if(input.observeOnly)return receipt;
 let draft:ExperimentParameterDraft|null=null;
 try{
  await input.authorize();const model=await input.model(),args=parameterDraftArguments(command.arguments);
  if(!model.spec||!model.version||args.revisionId!==model.version.revisionId)throw Error('simulation-model-stale');
  const previous=readParameterDraft(storage,model.version),parameters=draftParameters(model.spec,{...(previous?.parameters??{}),...args.parameters});
  let comparison:ExperimentGroupRequest|null=null;
  if(args.comparison!==null){
   if(model.compiler)throw Error('compiler-group-unsupported');
   const value=args.comparison as {hypothesis?:unknown;interventions?:unknown;seeds?:unknown};
   if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='hypothesis,interventions,seeds')throw Error('simulation-input-invalid');
   comparison=experimentGroupRequest({...model.version,hypothesis:value.hypothesis,baseline:{label:'Baseline',parameters},interventions:value.interventions,seeds:value.seeds});
   if(comparison.seeds.length*(comparison.interventions.length+1)>(input.maxGroupRuns??8))throw Error('invited-runs-group-limit');
   comparison.interventions=comparison.interventions.map(c=>({...c,parameters:draftParameters(model.spec!,{...parameters,...c.parameters})}));
  }
  await input.authorize();input.assertCurrent(model.version);
  draft={draftId:command.commandId,version:model.version,parameters,seed:args.seed,comparison,updatedAt:now()};
  receipt.phase='terminal';receipt.outcome='completed';receipt.result={draft,executionSubmitted:false};
 }catch(error){receipt.phase='terminal';receipt.outcome='failed';receipt.errorCode=error instanceof Error&&/^[a-z0-9-]{1,100}$/.test(error.message)?error.message:'parameter-draft-denied';receipt.result={executionSubmitted:false};}
 receipt.observedAt=now();
 storage.transactionSync(()=>{const existing=storage.kv.get<{digest:string;receipt:ToolEffectReceipt}>(key);if(existing)throw Error('tool-idempotency-conflict');if(draft)storage.kv.put(KEY,draft);storage.kv.put(key,{digest,receipt});});
 await storage.sync();return receipt;
}
