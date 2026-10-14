import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createControlledPiSession } from '../../services/runtime/controlled-pi.mjs';
import { createProductModelTransport } from '../../services/trusted-pi/product-model-transport.mjs';
import { BROWSER_PREVIEW_SERVER_ADAPTER, BROWSER_PREVIEW_SERVER_ADAPTER_SHA256, PRODUCT_PI_MAX_INPUT_TOKENS, PRODUCT_PI_MAX_OUTPUT_TOKENS, PRODUCT_PI_MODEL, PRODUCT_PI_PROVIDER, PRODUCT_PI_REQUEST_TIMEOUT_MS, createProductTrustedPiRelease } from '../../services/trusted-pi/release-candidate.mjs';

const now=1_800_000_000_000,identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2},actor={userId:'user-a',authVersion:3};
function release(log,responseBody='data: [DONE]\n\n'){return createProductTrustedPiRelease({clock:()=>now,modelFetch:async(input,init)=>{log.push({kind:'model',request:new Request(input,init)});return new Response(responseBody,{headers:{'content-type':'text/event-stream'}});},toolFetch:async(input,init)=>{const request=new Request(input,init);if(new URL(request.url).pathname==='/v1/research'){log.push({kind:'research',request});return Response.json({model:null,experiments:[]});}const command=await request.clone().json();log.push({kind:'tool',request});return Response.json({schemaVersion:1,scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,digest:'a'.repeat(64),deadlineAt:Math.min(now+115000,command.executionDeadlineAt),operation:command.operation,status:'completed',effectId:'effect-a',acceptedAt:now,updatedAt:now,dispatchedAt:now,unknownAt:null,finishedAt:now,lastObservedAt:now,outcome:'completed',errorCode:null,result:{text:'ok'},command:null});}});}
function textResponseFixture(){
  const item={type:'message',id:'message-fixture',role:'assistant',status:'completed',content:[{type:'output_text',text:'Offline Responses fixture.',annotations:[]}]};
  return [{type:'response.created',response:{id:'response-fixture'}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'response-fixture',status:'completed',output:[item],usage:{input_tokens:10,output_tokens:4,total_tokens:14,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}}].map(event=>`data: ${JSON.stringify(event)}\n\n`).join('');
}

test('candidate fixes one Responses model, simulation policy and eight remote tools',async t=>{
  assert.equal(PRODUCT_PI_MODEL,'gpt-6-luna');
  assert.equal(PRODUCT_PI_REQUEST_TIMEOUT_MS,115_000);
  const options=await release([]).resolveOptions({identity,actor,executionDeadlineAt:now+600000});assert.deepEqual(options.selectedModel,{provider:PRODUCT_PI_PROVIDER,id:PRODUCT_PI_MODEL});assert.deepEqual(options.allowedModels,[options.selectedModel]);assert.equal(options.providerDefinitions[0].config.api,'openai-responses');assert.equal(options.providerDefinitions[0].config.baseUrl,'https://model-proxy.riffology.internal/v1');assert.equal(options.providerDefinitions[0].config.models[0].contextWindow,PRODUCT_PI_MAX_INPUT_TOKENS);assert.equal(options.providerDefinitions[0].config.models[0].maxTokens,PRODUCT_PI_MAX_OUTPUT_TOKENS);assert.match(options.systemPrompt,/project_\*/);assert.match(options.systemPrompt,/call the appropriate project tool again/);assert.deepEqual(options.fixedSkills.map(value=>value.name),['simulation']);assert.deepEqual(options.bridge.definitions.map(value=>value.name),['project_read','project_read_page','project_write','project_edit','project_list','project_search','project_install_preview_adapter','project_set_experiment_parameters','project_bash']);
  const host=await createControlledPiSession({...options,trustedCwd:'/var/lib/riffology/pi',scope:{tenantId:'tenant-a',projectId:'project-a',sessionId:'session-a'}});t.after(()=>host.dispose());assert.deepEqual(host.inspect().model,options.selectedModel);assert.deepEqual(host.inspect().tools,options.bridge.definitions.map(value=>value.name));assert.ok(host.inspect().systemPrompt.includes(options.fixedSkills[0].content));
});

test('legacy GPT 5.6 Luna checkpoint resumes through GPT 6 Luna without authorizing legacy dispatch',async t=>{
  const responseBody=textResponseFixture();
  const log=[],wireRequests=[],options=await release(log,responseBody).resolveOptions({identity,actor,executionDeadlineAt:now+600000});
  assert.deepEqual(options.allowedHistoryModels,[{provider:PRODUCT_PI_PROVIDER,id:'gpt-5.6-luna'}]);
  const hostOptions={...options,trustedCwd:'/var/lib/riffology/pi',scope:{tenantId:'tenant-a',projectId:'project-a',sessionId:'session-a'},providerFetch:async(input,init)=>{
    wireRequests.push(await new Request(input,init).clone().json());
    return options.providerFetch(input,init);
  }};
  const initial=await createControlledPiSession(hostOptions);t.after(()=>initial.dispose());
  assert.equal((await initial.prompt('A prior saved conversation.')).outcome,'completed');
  // Synthetic historical checkpoint; production records are never rewritten.
  const legacy=initial.snapshot();
  for(const entry of legacy.entries){
    if(entry.type==='model_change')entry.modelId='gpt-5.6-luna';
    if(entry.message?.role==='assistant')entry.message.model='gpt-5.6-luna';
  }
  const before=structuredClone(legacy),restored=await createControlledPiSession({...hostOptions,snapshot:legacy});t.after(()=>restored.dispose());
  assert.deepEqual(legacy,before,'restore cannot mutate the supplied historical checkpoint');
  assert.deepEqual(restored.inspect().allowedModels,[{provider:PRODUCT_PI_PROVIDER,id:'gpt-6-luna'}]);
  assert.equal(restored.inspect().messages.find(message=>message.role==='assistant').model,'gpt-5.6-luna');
  assert.equal(log.filter(entry=>entry.kind==='model').length,1,'restore sends no provider request');
  assert.equal((await restored.prompt('Continue the saved conversation.')).outcome,'completed');
  assert.equal(wireRequests.length,2);
  for(const payload of wireRequests){assert.equal(payload.model,'gpt-6-luna');assert.equal(payload.max_output_tokens,PRODUCT_PI_MAX_OUTPUT_TOKENS);assert.equal(payload.store,false);}
  const saved=restored.snapshot();
  assert.deepEqual(saved.entries.slice(0,before.entries.length),before.entries);
  assert.equal(saved.entries.filter(entry=>entry.type==='model_change').at(-1).modelId,'gpt-6-luna');
  assert.equal(restored.inspect().messages.filter(message=>message.role==='assistant').at(-1).model,'gpt-6-luna');
  await assert.rejects(createControlledPiSession({...hostOptions,selectedModel:{provider:PRODUCT_PI_PROVIDER,id:'gpt-5.6-luna'},snapshot:legacy}),/Model is not allowed/);
  for(const entryType of ['model_change','assistant']){
    const unknown=structuredClone(legacy);
    if(entryType==='model_change')unknown.entries.find(entry=>entry.type==='model_change').modelId='unknown-history';
    else unknown.entries.find(entry=>entry.message?.role==='assistant').message.model='unknown-history';
    await assert.rejects(createControlledPiSession({...hostOptions,snapshot:unknown}),/Session (assistant )?model is not allowed/);
  }
  assert.throws(()=>options.onProviderPayload({payload:{model:'gpt-5.6-luna',input:[],stream:true,store:false},model:{...options.selectedModel,api:'openai-responses',baseUrl:'https://model-proxy.riffology.internal/v1'}}),/invalid-product-model-payload/);
  await assert.rejects(options.providerFetch('https://model-proxy.riffology.internal/v1/responses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'gpt-5.6-luna',input:[],stream:true,store:false,max_output_tokens:PRODUCT_PI_MAX_OUTPUT_TOKENS})}),/product-model-payload-policy-denied/);
  assert.equal(log.filter(entry=>entry.kind==='model').length,2,'blocked legacy and unknown history send no additional provider request');
});

test('migration-capable runtime supports an explicitly pinned rollback while retaining GPT 6 history',async t=>{
  const log=[],responseBody=textResponseFixture(),options=await release(log,responseBody).resolveOptions({identity,actor,executionDeadlineAt:now+600000});
  const scope={tenantId:'tenant-a',projectId:'project-a',sessionId:'session-a'},hostOptions={...options,trustedCwd:'/var/lib/riffology/pi',scope};
  const upgraded=await createControlledPiSession(hostOptions);t.after(()=>upgraded.dispose());
  assert.equal((await upgraded.prompt('Save a GPT 6 conversation.')).outcome,'completed');
  const snapshot=upgraded.snapshot(),before=structuredClone(snapshot),selectedModel={provider:PRODUCT_PI_PROVIDER,id:'gpt-5.6-luna'};
  const rollbackIdentity={...identity,turnId:'rollback-turn',dispatchId:'rollback-dispatch'},rollbackWire=[];
  // An explicitly reviewed rollback release keeps this migration-aware runtime
  // but replaces the sole dispatch model, its transport, and historical policy.
  const transport=createProductModelTransport({identity:rollbackIdentity,actor,provider:PRODUCT_PI_PROVIDER,model:selectedModel.id,maxInputTokensPerCall:PRODUCT_PI_MAX_INPUT_TOKENS,maxOutputTokensPerCall:PRODUCT_PI_MAX_OUTPUT_TOKENS,requestTimeoutMs:PRODUCT_PI_REQUEST_TIMEOUT_MS},{clock:()=>now,executionDeadlineAt:now+600000,fetchImpl:async()=>new Response(responseBody,{headers:{'content-type':'text/event-stream'}})});
  const rollbackOptions={...hostOptions,...transport,selectedModel,allowedModels:[selectedModel],allowedHistoryModels:[options.selectedModel],snapshot,
    providerDefinitions:options.providerDefinitions.map(definition=>({...definition,config:{...definition.config,models:definition.config.models.map(model=>({...model,id:selectedModel.id}))}})),
    providerFetch:async(input,init)=>{rollbackWire.push(await new Request(input,init).clone().json());return transport.providerFetch(input,init);}};
  const rollback=await createControlledPiSession(rollbackOptions);t.after(()=>rollback.dispose());
  assert.equal(rollback.inspect().messages.find(message=>message.role==='assistant').model,'gpt-6-luna');
  assert.deepEqual(rollback.inspect().allowedModels,[selectedModel]);
  assert.equal((await rollback.prompt('Continue after an explicit rollback.')).outcome,'completed');
  assert.equal(rollbackWire.length,1);assert.equal(rollbackWire[0].model,'gpt-5.6-luna');
  assert.deepEqual(snapshot,before);assert.deepEqual(rollback.snapshot().entries.slice(0,before.entries.length),before.entries);
  assert.equal(rollback.snapshot().entries.filter(entry=>entry.type==='model_change').at(-1).modelId,'gpt-5.6-luna');
  await assert.rejects(createControlledPiSession({...rollbackOptions,selectedModel:options.selectedModel}),/Model is not allowed/);
  assert.equal(rollbackWire.length,1,'GPT 6 history cannot authorize a GPT 6 rollback dispatch');
});

test('checkpoint model policy rejects malformed and duplicate release inputs before dispatch',async()=>{
  const log=[],options=await release(log).resolveOptions({identity,actor,executionDeadlineAt:now+600000}),legacy={provider:PRODUCT_PI_PROVIDER,id:'gpt-5.6-luna'};
  for(const allowedHistoryModels of [null,{},[{...legacy,id:'*'}],[legacy,legacy],[{...legacy,modelId:'other'}]]){
    await assert.rejects(createControlledPiSession({...options,trustedCwd:'/var/lib/riffology/pi',scope:{tenantId:'tenant-a',projectId:'project-a',sessionId:'session-a'},allowedHistoryModels}),/history model/);
  }
  assert.equal(log.filter(entry=>entry.kind==='model').length,0);
});
test('candidate gives compiler v0.1 a source-preserving public CLI authoring contract',async()=>{
  const options=await release([]).resolveOptions({identity,actor,executionDeadlineAt:now+600000}),skill=options.fixedSkills[0].content;
  assert.match(skill,/public sim-engine 0\.1\.0 CLI only through bounded project_bash/);
  assert.match(skill,/sim-engine seal model\/business-ir\.draft\.json model\/business-ir\.json; sim-engine validate model\/business-ir\.json; sim-engine compile model\/business-ir\.json model\/model\.simpack/);
  assert.match(skill,/"kind":"compiler-v01","businessIr":"model\/business-ir\.json","bundle":"model\/model\.simpack"/);
  assert.match(skill,/Set parameters to an empty object for compiler-v01/);
  assert.match(skill,/only finite numeric run metrics/);
  assert.match(skill,/Do not declare string stop_reason as a numeric metric/);
  assert.match(skill,/do not execute the saved bundle online, create a Run or durable result, verify an Experiment or Evidence claim/);
  assert.match(skill,/Do not use sim-engine run or Browser Preview as a substitute/);
  assert.match(skill,/Do not import package internals, call repository scripts, hand-write a \.simpack/);
});
test('candidate installs canonical preview adapter through an identity-bound project write',async()=>{
  const log=[],options=await release(log).resolveOptions({identity,actor,executionDeadlineAt:now+600000});
  await options.bridge.execute({scope:{tenantId:'tenant-a',projectId:'project-a',sessionId:'session-a'},name:'project_install_preview_adapter',toolCallId:'install-adapter',args:{}});
  const command=await log.find(value=>value.kind==='tool').request.json();
  assert.equal(command.operation,'write');assert.equal(command.arguments.path,'model/run.py');assert.equal(command.arguments.content,BROWSER_PREVIEW_SERVER_ADAPTER);
  assert.equal(BROWSER_PREVIEW_SERVER_ADAPTER_SHA256,(await import('node:crypto')).createHash('sha256').update(command.arguments.content).digest('hex'));
});
test('candidate model and tool transports bind the same immutable Turn without ambient authority',async()=>{
  const log=[],options=await release(log).resolveOptions({identity,actor,executionDeadlineAt:now+600000}),approved=options.onProviderPayload({payload:{model:PRODUCT_PI_MODEL,input:[],stream:true,store:false},model:{...options.selectedModel,api:'openai-responses',baseUrl:'https://model-proxy.riffology.internal/v1'}});await options.providerFetch('https://model-proxy.riffology.internal/v1/responses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(approved)});await options.bridge.execute({scope:{tenantId:'tenant-a',projectId:'project-a',sessionId:'session-a'},name:'project_list',toolCallId:'tool-call-a',args:{path:''}});assert.equal(log.filter(value=>value.kind==='research').length,1);const modelEnvelope=await log.find(value=>value.kind==='model').request.json(),toolCommand=await log.find(value=>value.kind==='tool').request.json();assert.deepEqual(modelEnvelope.identity,identity);assert.deepEqual(modelEnvelope.actor,actor);assert.equal(modelEnvelope.deadlineAt,now+PRODUCT_PI_REQUEST_TIMEOUT_MS);assert.deepEqual(toolCommand.scope,identity.scope);assert.equal(toolCommand.turnId,identity.turnId);assert.equal(toolCommand.dispatchId,identity.dispatchId);
});
test('candidate source contains no credential, capability key, M0 probe or project filesystem API',async()=>{
  const source=await readFile(new URL('../../services/trusted-pi/release-candidate.mjs',import.meta.url),'utf8'),imports=source.split('\n').filter(line=>line.startsWith('import ')).join('\n');assert.doesNotMatch(imports,/proxy-pi|go-pi-probe|node:fs|project-sandbox/i);assert.doesNotMatch(source,/process\.env|M2_MODEL_TURN_CAPABILITY_KEY|PROJECT_SANDBOX|['"]\/workspace['"]/);
});

test('trusted host execution deadline reaches both release transports',async()=>{
  const log=[],executionDeadlineAt=now+1000,options=await release(log).resolveOptions({identity,actor,executionDeadlineAt}),approved=options.onProviderPayload({payload:{model:PRODUCT_PI_MODEL,input:[],stream:true,store:false},model:{...options.selectedModel,api:'openai-responses',baseUrl:'https://model-proxy.riffology.internal/v1'}});
  await options.providerFetch('https://model-proxy.riffology.internal/v1/responses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(approved)});
  await options.bridge.execute({scope:{tenantId:'tenant-a',projectId:'project-a',sessionId:'session-a'},name:'project_list',toolCallId:'tool-call-a',args:{path:''}});
  assert.equal((await log.find(value=>value.kind==='model').request.json()).deadlineAt,executionDeadlineAt);const toolIntent=await log.find(value=>value.kind==='tool').request.json();assert.equal(toolIntent.executionDeadlineAt,executionDeadlineAt);assert.equal(toolIntent.deadlineAt,undefined);
  await assert.rejects(release([]).resolveOptions({identity,actor,executionDeadlineAt:0}),/invalid-product-model-transport/);
});
