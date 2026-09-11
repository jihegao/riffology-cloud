import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PRODUCT_TOOL_BRIDGE_URL, createProductToolBridge, productToolDefinitions } from '../../services/trusted-pi/product-tool-bridge.mjs';

const now=1_800_000_000_000,identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2},scope={tenantId:'tenant-a',projectId:'project-a',sessionId:'session-a'};
const providerToolCallId=`fc_${'a'.repeat(26)}|call_${'b'.repeat(48)}`;
function record(command,overrides={}){return {schemaVersion:1,scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,digest:'a'.repeat(64),deadlineAt:Math.min(now+115000,command.executionDeadlineAt),operation:command.operation,status:'completed',effectId:'effect-a',acceptedAt:now,updatedAt:now,dispatchedAt:now,unknownAt:null,finishedAt:now,lastObservedAt:now,outcome:'completed',errorCode:null,result:{text:'ok'},command:null,...overrides};}
function fixture(transform=(value)=>value,boundIdentity=identity){const sent=[];return {sent,bridge:createProductToolBridge(boundIdentity,{clock:()=>now,executionDeadlineAt:now+600000,fetchImpl:async(url,init)=>{const command=JSON.parse(init.body);sent.push({url:String(url),init,command});return Response.json(transform(record(command)));}})};}

test('release exposes exactly seven remote project tools with closed argument schemas',()=>{
  assert.deepEqual(productToolDefinitions.map(value=>value.name),['project_read','project_read_page','project_write','project_edit','project_list','project_search','project_bash']);for(const definition of productToolDefinitions){assert.equal(definition.parameters.type,'object');assert.equal(definition.parameters.additionalProperties,false);assert.deepEqual(definition.parameters.required,Object.keys(definition.parameters.properties));}
});
test('paged read preserves exact paging and version arguments',async()=>{const f=fixture();await f.bridge.execute({scope,name:'project_read_page',toolCallId:'provider-page-a',args:{path:'model/large.txt',offset:8192,maxBytes:8192,expectedSha256:'a'.repeat(64)}});assert.equal(f.sent[0].command.operation,'read_page');assert.deepEqual(f.sent[0].command.arguments,{path:'model/large.txt',offset:8192,maxBytes:8192,expectedSha256:'a'.repeat(64)});});
test('one Pi tool call becomes one identity-bound Tool Bridge command and a bounded model result',async()=>{
  const f=fixture(),result=await f.bridge.execute({scope,name:'project_write',toolCallId:providerToolCallId,args:{path:'model/main.py',content:'print(1)'}});assert.deepEqual(result,{content:[{type:'text',text:'{"text":"ok"}'}],details:{operation:'write',status:'completed'}});assert.equal(f.sent.length,1);const sent=f.sent[0];assert.equal(sent.url,PRODUCT_TOOL_BRIDGE_URL);assert.deepEqual(Object.fromEntries(new Headers(sent.init.headers).entries()),{accept:'application/json','content-type':'application/json'});assert.deepEqual(sent.command.scope,identity.scope);assert.equal(sent.command.schemaVersion,2);assert.equal(sent.command.turnId,identity.turnId);assert.equal(sent.command.dispatchId,identity.dispatchId);assert.match(sent.command.commandId,/^cmd-[a-f0-9]{60}$/);assert.equal(sent.command.executionDeadlineAt,now+600000);assert.equal(sent.command.deadlineAt,undefined);assert.equal(sent.command.operation,'write');assert.deepEqual(sent.command.arguments,{path:'model/main.py',content:'print(1)'});
});
test('same provider call is stable while another provider call or Turn gets a distinct command',async()=>{
  const f=fixture(),call={scope,name:'project_list',toolCallId:'provider-call-a',args:{path:''}};await f.bridge.execute(call);await f.bridge.execute(call);await f.bridge.execute({...call,toolCallId:'provider-call-b'});assert.equal(f.sent[0].command.commandId,f.sent[1].command.commandId);assert.notEqual(f.sent[1].command.commandId,f.sent[2].command.commandId);
  const other=fixture(value=>value,{...identity,dispatchId:'dispatch-b'});await other.bridge.execute(call);assert.notEqual(other.sent[0].command.commandId,f.sent[0].command.commandId);
});
test('same provider call keeps one intent across clock drift and bridge reconstruction',async()=>{
 let clock=now,saved=null;const sent=[],fetchImpl=async(_,init)=>{const intent=JSON.parse(init.body);sent.push(intent);saved??=record(intent);return Response.json(saved);},call={scope,name:'project_list',toolCallId:'provider-call-a',args:{path:''}};
 await createProductToolBridge(identity,{clock:()=>clock,executionDeadlineAt:now+600000,fetchImpl}).execute(call);clock+=1000;await createProductToolBridge(identity,{clock:()=>clock,executionDeadlineAt:now+600000,fetchImpl}).execute(call);
 assert.deepEqual(sent[1],sent[0]);assert.equal(saved.deadlineAt,now+115000);
});
test('cross-session scope, abort and non-200 responses fail without returning project data',async()=>{
  const f=fixture();await assert.rejects(f.bridge.execute({scope:{...scope,sessionId:'session-b'},name:'project_read',toolCallId:'call-a',args:{path:'x'}}),/scope-denied/);assert.equal(f.sent.length,0);const controller=new AbortController();controller.abort();await assert.rejects(f.bridge.execute({scope,name:'project_read',toolCallId:'call-a',args:{path:'x'},signal:controller.signal}),/abort/i);assert.equal(f.sent.length,0);
  const denied=createProductToolBridge(identity,{clock:()=>now,executionDeadlineAt:now+600000,fetchImpl:async()=>new Response('private detail',{status:500})});await assert.rejects(denied.execute({scope,name:'project_read',toolCallId:'call-a',args:{path:'x'}}),/request-failed/);
});
test('provider tool IDs accept one bounded Responses composite and reject path-like variants',async()=>{
  const f=fixture();await f.bridge.execute({scope,name:'project_list',toolCallId:providerToolCallId,args:{path:''}});assert.equal(f.sent.length,1);
  for(const toolCallId of ['fc_a|call_b|extra','../call','fc_a|'])await assert.rejects(f.bridge.execute({scope,name:'project_list',toolCallId,args:{path:''}}),/tool-call-id/);
});
test('cross-Turn, nonterminal, failed and malformed service records fail closed',async()=>{
  for(const transform of [(value)=>({...value,dispatchId:'other'}),(value)=>({...value,status:'dispatched',outcome:null,command:{}}),(value)=>({...value,status:'failed',outcome:'failed',errorCode:'effect-failed'}),(value)=>({...value,digest:'bad'}),(value)=>({...value,deadlineAt:now+600001}),(value)=>({...value,dispatchedAt:now+1})]){const f=fixture(transform);await assert.rejects(f.bridge.execute({scope,name:'project_read',toolCallId:'call-a',args:{path:'x'}}),/tool-response|effect-failed/);}
});
test('bridge source has no filesystem API, Project Sandbox binding or ambient credential lookup',async()=>{
  const source=await readFile(new URL('../../services/trusted-pi/product-tool-bridge.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/node:fs|PROJECT_SANDBOX|process\.env|credential|\/workspace/);
});

test('absolute execution cutoff clips tool deadlines without extending the relative bound',async()=>{
  const call={scope,name:'project_list',toolCallId:'call-a',args:{path:''}};
  for(const [absolute,expected] of [[now+1000,now+1000],[now+200000,now+115000]]){
    const sent=[],bridge=createProductToolBridge(identity,{clock:()=>now,executionDeadlineAt:absolute,fetchImpl:async(_,init)=>{const command=JSON.parse(init.body),response=record(command);sent.push({command,response});return Response.json(response);}});
    await bridge.execute(call);assert.equal(sent[0].command.executionDeadlineAt,absolute);assert.equal(sent[0].response.deadlineAt,expected);
  }
  for(const executionDeadlineAt of [null,0,-1,1.1,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>createProductToolBridge(identity,{executionDeadlineAt}),/invalid-product-tool-bridge/);
});
test('tool cutoff rejects at and after expiry and rechecks immediately before dispatch',async()=>{
  let calls=0;const call={scope,name:'project_list',toolCallId:'call-a',args:{path:''}};
  for(const time of [now,now+1]){const bridge=createProductToolBridge(identity,{clock:()=>time,executionDeadlineAt:now,fetchImpl:async()=>{calls++;}});await assert.rejects(bridge.execute(call),/execution-expired/);}
  let ticks=0;const bridge=createProductToolBridge(identity,{clock:()=>++ticks===1?now:now+1,executionDeadlineAt:now+1,fetchImpl:async()=>{calls++;}});await assert.rejects(bridge.execute(call),/execution-expired/);assert.equal(calls,0);
});
