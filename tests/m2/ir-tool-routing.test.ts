import assert from 'node:assert/strict';
import test from 'node:test';
import {validateToolCommand,type ToolCommand} from '../../services/tools/protocol.ts';
import {createProjectIrEffects} from '../../services/project-tools/ir-routing.ts';
import {toolCommandDigest} from '../../services/tools/protocol.ts';
import {ProjectFileEffectPort} from '../../services/project-tools/effect.ts';
import type {ToolEffectReceipt} from '../../services/tools/ledger.ts';
import {toolReceiptOperation} from '../../services/tools/receipt.ts';
const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const command=(operation:string,input:Record<string,unknown>):ToolCommand=>validateToolCommand({schemaVersion:1,scope,turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',deadlineAt:2000,operation:'ir',arguments:{operation,input}},()=>1000);
const artifact='.riffoid-ir/artifacts/'+'a'.repeat(64)+'/browser.json';
const runId='run-11111111-1111-4111-8111-111111111111';
const proof=(cmd:ToolCommand,result:Record<string,unknown>={}):ToolEffectReceipt=>({schemaVersion:1,scope,turnId:cmd.turnId,dispatchId:cmd.dispatchId,commandId:cmd.commandId,effectId:'effect-a',phase:'terminal',outcome:'completed',errorCode:null,result,observedAt:1000});
test('IR input accepts only the declared operation, references, replay identity and seed',()=>{
 for(const [op,input] of [['project_ir_check',{draftRef:'model/business-ir.draft.json'}],['project_ir_compile',{sealedRef:'.riffoid-ir/models/'+'a'.repeat(64)+'/business.json'}],['project_ir_run',{browserArtifactRef:artifact,runOptions:{seed:0}}],['project_ir_run',{sourceRunId:runId}],['project_ir_result',{runId}],['mode',{mode:'ir'}],['show',{}],['install',{}]] as Array<[string,Record<string,unknown>]>)assert.equal(command(op,input).operation,'ir');
 for(const [op,input] of [['bash',{script:'id'}],['mode',{mode:'other'}],['show',{scope:'other'}],['project_ir_run',{sourceRunId:runId,browserArtifactRef:artifact}],['project_ir_run',{browserArtifactRef:artifact,runOptions:{duration:90}}],['project_ir_run',{browserArtifactRef:artifact,runOptions:{seed:-1}}],['project_ir_compile',{sealedRef:'model/business-ir.json'}],['project_ir_check',{draftRef:'../outside'}]])assert.throws(()=>command(op as string,input as Record<string,unknown>));
 for(const name of ['check','compile','run','result','mode','show','install'])assert.equal(toolReceiptOperation('project_ir_'+name),'ir');
 assert.throws(()=>toolReceiptOperation('project_ir_arbitrary'));
});
test('run and result use only durable Workspace authority, with observe retaining the original effect',async()=>{
 let native=0;const calls:unknown[]=[],port=createProjectIrEffects({async execute(){native++;throw Error('native');},async observe(){native++;throw Error('native');}},()=>({async projectIrToolEffect(input){calls.push(input);return proof(input.command);},async projectIrRegisterEffect(){throw Error('not-registration');}}));
 const cmd=command('project_ir_run',{browserArtifactRef:artifact});await port.execute({command:cmd,effectId:'effect-a'});
 await port.observe({command:cmd,reference:{scope,turnId:cmd.turnId,dispatchId:cmd.dispatchId,commandId:cmd.commandId,effectId:'effect-a',digest:await toolCommandDigest(cmd)}});
 assert.equal(native,0);assert.deepEqual(calls,[{command:cmd,effectId:'effect-a',observeOnly:false},{command:cmd,effectId:'effect-a',observeOnly:true}]);
});
test('completed compilation registers once per original observation and strips payload before Ledger delivery',async()=>{
 let executes=0,observes=0,registers=0;const cmd=command('project_ir_compile',{sealedRef:'.riffoid-ir/models/'+'a'.repeat(64)+'/business.json'}),receipt=proof(cmd,{status:'succeeded',registration:{schema:'riffoid-ir.registration/v1'}});
 const port=createProjectIrEffects({async execute(){executes++;return receipt;},async observe(){observes++;return receipt;}},()=>({async projectIrToolEffect(){throw Error('not-run');},async projectIrRegisterEffect(input){registers++;assert.equal(input.effectId,'effect-a');assert.deepEqual(input.receipt,receipt);return {...input.receipt,result:{status:'succeeded'}};}}));
 assert.deepEqual((await port.execute({command:cmd,effectId:'effect-a'})).result,{status:'succeeded'});
 await port.observe({command:cmd,reference:{scope,turnId:cmd.turnId,dispatchId:cmd.dispatchId,commandId:cmd.commandId,effectId:'effect-a',digest:await toolCommandDigest(cmd)}});
 assert.deepEqual({executes,observes,registers},{executes:1,observes:1,registers:2});
});
test('uncertain file execution never registers and the fixed helper accepts a complete registration internally',async()=>{
 const cmd=command('show',{});let registrations=0;
 const uncertain={...proof(cmd),phase:'unknown' as const,outcome:null,errorCode:null,result:null};
 const port=createProjectIrEffects({async execute(){return uncertain;},async observe(){return uncertain;}},()=>({async projectIrToolEffect(){throw Error('not-run');},async projectIrRegisterEffect(){registrations++;throw Error('not-terminal');}}));
 assert.equal((await port.execute({command:cmd,effectId:'effect-a'})).phase,'unknown');assert.equal(registrations,0);
 let request='';const result={registration:{files:[{base64:'a'.repeat(200_000)}]}};
 const files=new ProjectFileEffectPort({async start(input){request=input.stdin;return {schemaVersion:1,effectId:'effect-a',phase:'exited',exitCode:0,stdout:JSON.stringify({ok:true,result}),stderr:''};},async observe(){throw Error('not-observe');}},()=>1000);
 assert.deepEqual((await files.execute({command:cmd,effectId:'effect-a'})).result,result);assert.equal(JSON.parse(request).operation,'ir');
});
