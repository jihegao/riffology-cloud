import { createHash } from 'node:crypto';

export const PRODUCT_TOOL_BRIDGE_URL='https://tool-bridge.riffology.internal/v1/tool';
const ID=/^[A-Za-z0-9_-]{1,128}$/,TOOL_CALL_ID=/^[A-Za-z0-9_-]{1,128}(?:\|[A-Za-z0-9_-]{1,128})?$/,OPERATIONS=new Map([['project_read','read'],['project_read_page','read_page'],['project_write','write'],['project_edit','edit'],['project_list','list'],['project_search','search'],['project_bash','bash']]),MAX_RESPONSE_BYTES=256*1024,encoder=new TextEncoder();
function fail(code){throw Error(code);}
function exact(value,keys,code){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail(code);}
function id(value){if(typeof value!=='string'||!ID.test(value))fail('invalid-product-tool-bridge');return value;}
function toolCallId(value){if(typeof value!=='string'||!TOOL_CALL_ID.test(value))fail('invalid-product-tool-call-id');return value;}
function positive(value){if(!Number.isSafeInteger(value)||value<1)fail('invalid-product-tool-bridge');return value;}
function identity(value){exact(value,['scope','sessionId','turnId','dispatchId','generation'],'invalid-product-tool-bridge');exact(value.scope,['tenantId','projectId','workspaceId','workspaceGeneration'],'invalid-product-tool-bridge');const scope={tenantId:id(value.scope.tenantId),projectId:id(value.scope.projectId),workspaceId:id(value.scope.workspaceId),workspaceGeneration:positive(value.scope.workspaceGeneration)},generation=positive(value.generation);if(generation!==scope.workspaceGeneration)fail('invalid-product-tool-bridge');return {scope,sessionId:id(value.sessionId),turnId:id(value.turnId),dispatchId:id(value.dispatchId),generation};}
function args(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('invalid-product-tool-arguments');let encoded;try{encoded=JSON.stringify(value);}catch{fail('invalid-product-tool-arguments');}if(encoded===undefined||encoded.includes('"__proto__"')||encoder.encode(encoded).byteLength>1024*1024)fail('invalid-product-tool-arguments');return JSON.parse(encoded);}
function commandId(identityValue,rawToolCallId,name){return `cmd-${createHash('sha256').update(JSON.stringify({schemaVersion:1,purpose:'product-tool-command',identity:identityValue,toolCallId:toolCallId(rawToolCallId),name})).digest('hex').slice(0,60)}`;}
async function boundedJson(response){if(response.headers.get('content-type')?.split(';')[0].trim()!=='application/json')fail('invalid-product-tool-response');const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_RESPONSE_BYTES))fail('product-tool-response-too-large');const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength<1||bytes.byteLength>MAX_RESPONSE_BYTES)fail('product-tool-response-too-large');let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('invalid-product-tool-response');}return value;}
function terminal(value,expected,operation,expectedCommandId,executionDeadlineAt){
  const keys=['schemaVersion','scope','turnId','dispatchId','commandId','digest','deadlineAt','operation','status','effectId','acceptedAt','updatedAt','dispatchedAt','unknownAt','finishedAt','lastObservedAt','outcome','errorCode','result','command'];exact(value,keys,'invalid-product-tool-response');
  if(value.schemaVersion!==1||JSON.stringify(value.scope)!==JSON.stringify(expected.scope)||value.turnId!==expected.turnId||value.dispatchId!==expected.dispatchId||value.commandId!==expectedCommandId||!Number.isSafeInteger(value.deadlineAt)||value.deadlineAt>executionDeadlineAt||value.operation!==operation||value.command!==null||typeof value.digest!=='string'||!/^[a-f0-9]{64}$/.test(value.digest)||!['completed','failed','cancelled'].includes(value.status)||value.outcome!==value.status||!value.result||typeof value.result!=='object'||Array.isArray(value.result)||typeof value.effectId!=='string'||!ID.test(value.effectId)||(value.status==='completed')!==(value.errorCode===null))fail('invalid-product-tool-response');
  const accepted=positive(value.acceptedAt),dispatched=positive(value.dispatchedAt),observed=positive(value.lastObservedAt),finished=positive(value.finishedAt),updated=positive(value.updatedAt),unknown=value.unknownAt===null?null:positive(value.unknownAt);if(value.deadlineAt<=accepted||value.deadlineAt-accepted>120_000||accepted>dispatched||dispatched>observed||observed>finished||finished>updated||(unknown!==null&&(unknown<dispatched||unknown>observed)))fail('invalid-product-tool-response');return value;
}
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const string={type:'string'},integer={type:'integer'},nullableSha={anyOf:[{type:'string',pattern:'^[a-f0-9]{64}$'},{type:'null'}]};
export const productToolDefinitions=Object.freeze([
  {name:'project_read',label:'Read project file',description:'Read one UTF-8 file from the isolated project workspace.',parameters:object({path:string})},
  {name:'project_read_page',label:'Read project file page',description:'Read one bounded UTF-8 byte page. Start with offset 0 and expectedSha256 null; pass the returned sha256 on every later page.',parameters:object({path:string,offset:{type:'integer',minimum:0,maximum:1048576},maxBytes:{type:'integer',minimum:4,maximum:8192},expectedSha256:nullableSha})},
  {name:'project_write',label:'Write project file',description:'Create or replace one UTF-8 file in the isolated project workspace.',parameters:object({path:string,content:string})},
  {name:'project_edit',label:'Edit project file',description:'Replace exact text in one UTF-8 project file.',parameters:object({path:string,oldText:string,newText:string,replaceAll:{type:'boolean'}})},
  {name:'project_list',label:'List project files',description:'List entries below a project workspace path. Use an empty path for the root.',parameters:object({path:string})},
  {name:'project_search',label:'Search project files',description:'Search UTF-8 project files below a path.',parameters:object({path:string,query:string,maxResults:integer})},
  {name:'project_bash',label:'Run project command',description:'Run a bounded shell script inside the isolated project workspace.',parameters:object({script:string,timeoutMs:integer})},
].map(value=>Object.freeze(value)));

/** The default deadline leaves 5 seconds below the server admission ceiling
 * for container/Worker clock skew; the server still enforces its 120s bound.
 * Release-controlled remote tools. Project filesystem effects occur only
 * after Tool Bridge durable admission; the Trusted Pi container receives a
 * bounded terminal result and never a Project Sandbox binding. */
export function createProductToolBridge(rawIdentity,options={}){
  const expected=identity(rawIdentity),fetchImpl=options.fetchImpl??globalThis.fetch,clock=options.clock??Date.now;if(typeof fetchImpl!=='function'||typeof clock!=='function')fail('invalid-product-tool-bridge');
  const executionDeadlineAt=positive(options.executionDeadlineAt);
  const checkDeadline=()=>{const observed=positive(clock());if(observed>=executionDeadlineAt)fail('product-tool-execution-expired');return observed;};
  return Object.freeze({definitions:productToolDefinitions,async execute(call){
    if(!call||typeof call!=='object'||!OPERATIONS.has(call.name)||JSON.stringify(call.scope)!==JSON.stringify({tenantId:expected.scope.tenantId,projectId:expected.scope.projectId,sessionId:expected.sessionId}))fail('product-tool-scope-denied');call.signal?.throwIfAborted();
    const operation=OPERATIONS.get(call.name),savedCommandId=commandId(expected,call.toolCallId,call.name);checkDeadline();const command={schemaVersion:2,scope:expected.scope,turnId:expected.turnId,dispatchId:expected.dispatchId,commandId:savedCommandId,executionDeadlineAt,operation,arguments:args(call.args)};
    const body=JSON.stringify(command);call.signal?.throwIfAborted();checkDeadline();
    const response=await fetchImpl(PRODUCT_TOOL_BRIDGE_URL,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body,signal:call.signal});if(response.status!==200){if(response.status===409){const error=await boundedJson(response);if(error?.error==='tool-idempotency-conflict'||error?.error==='tool-turn-active-command')fail(error.error);}await response.body?.cancel().catch(()=>{});fail('product-tool-request-failed');}
    const record=terminal(await boundedJson(response),expected,operation,savedCommandId,executionDeadlineAt);if(record.status!=='completed')fail('product-tool-effect-failed');const text=JSON.stringify(record.result);if(encoder.encode(text).byteLength>64*1024)fail('product-tool-response-too-large');return {content:[{type:'text',text}],details:{operation,status:'completed'}};
  }});
}
