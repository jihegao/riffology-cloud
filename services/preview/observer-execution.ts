import {createObserverFetchSession} from './observer-fetch.ts';
import {observerHttpPolicy,type ObserverHttpPolicy} from './observer-http.ts';
import {OBSERVER_LIMITS,validateObserverCommand,parseObserverState,type ObserverCommand,type ObserverJson} from './observer-protocol.ts';
import {observerArtifactDescriptor,observerArtifactReceipt,type ObserverArtifactKind,type ObserverArtifactReceipt} from './observer-artifacts.ts';
import {previewSource,previewSourceFilesSha256} from './source.ts';
import {serviceRuntimeInput,type ServiceRuntimeInput} from '../run/runtime-protocol.ts';
import {serviceRuntimeReference} from '../run/service.ts';
import type {PreviewBinding} from './bindings.ts';
import {positive,sameScope,scope,sha,turnDigest,turnId} from '../turn/protocol.ts';

export type ObserverExecutionTarget={binding:PreviewBinding;runtime:ServiceRuntimeInput;policy:ObserverHttpPolicy;targetDigest:string;expiresAt:number};
export type ObserverBrowserPayload=
 |{type:'snapshot';text:string;truncated:boolean}
 |{type:'screenshot';mimeType:'image/png';bytes:Uint8Array;width:1280;height:720}
 |{type:'console';entries:{type:string;text:string}[];truncated:boolean;dropped:number}
 |{type:'reload';reloaded:true};
export interface ObserverBrowserPort{
 /** A trusted browser host must supply network isolation separately. Routing
  * interception alone is not an egress boundary. Resolves after context exit. */
 run(input:{operation:ObserverCommand['operation'];pageUrl:string;signal:AbortSignal;timeoutMs:number;fetchResource(request:Request):Promise<Response>}):Promise<{stopped:true;payload:ObserverBrowserPayload}>;
}
export interface ObserverExecutionServices{
 authorize(command:ObserverCommand):Promise<ObserverExecutionTarget>;
 forward(command:ObserverCommand,targetDigest:string,request:Request,signal:AbortSignal):Promise<Response>;
 browser:ObserverBrowserPort;
 artifacts:{save(command:ObserverCommand,kind:ObserverArtifactKind,content:Uint8Array):Promise<ObserverArtifactReceipt>};
}
const encoder=new TextEncoder();
function deny():never{throw Error('observer-result-invalid');}
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)deny();const d=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k]!,'value')))deny();
}
function payload(raw:ObserverBrowserPayload,operation:ObserverCommand['operation']):ObserverBrowserPayload{
 const typeDescriptor=raw&&Object.getOwnPropertyDescriptor(raw,'type');
 if(!typeDescriptor||!Object.hasOwn(typeDescriptor,'value')||typeDescriptor.value!==operation)deny();
 if(raw.type==='snapshot'){
  exact(raw,['type','text','truncated']);if(typeof raw.text!=='string'||encoder.encode(raw.text).byteLength>OBSERVER_LIMITS.snapshotBytes||typeof raw.truncated!=='boolean')deny();
  return {type:'snapshot',text:raw.text,truncated:raw.truncated};
 }
 if(raw.type==='screenshot'){
  exact(raw,['type','mimeType','bytes','width','height']);if(raw.mimeType!=='image/png'||!(raw.bytes instanceof Uint8Array)||raw.bytes.byteLength>OBSERVER_LIMITS.screenshotBytes||raw.width!==1280||raw.height!==720)deny();
  return {type:'screenshot',mimeType:'image/png',bytes:raw.bytes.slice(),width:1280,height:720};
 }
 if(raw.type==='console'){
  exact(raw,['type','entries','truncated','dropped']);if(!Array.isArray(raw.entries)||raw.entries.length>OBSERVER_LIMITS.consoleEntries||typeof raw.truncated!=='boolean'||!Number.isSafeInteger(raw.dropped)||raw.dropped<0)deny();
  if(Object.keys(raw.entries).length!==raw.entries.length)deny();
  for(let i=0;i<raw.entries.length;i++){const d=Object.getOwnPropertyDescriptor(raw.entries,String(i));if(!d||!Object.hasOwn(d,'value'))deny();}
  let bytes=0;const entries=raw.entries.map(entry=>{exact(entry,['type','text']);if(typeof entry.type!=='string'||! /^[a-zA-Z]{1,32}$/.test(entry.type)||typeof entry.text!=='string')deny();const size=encoder.encode(entry.text).byteLength;bytes+=size;if(size>OBSERVER_LIMITS.consoleEntryBytes||bytes>OBSERVER_LIMITS.consoleBytes)deny();return {type:entry.type,text:entry.text};});
  return {type:'console',entries,truncated:raw.truncated,dropped:raw.dropped};
 }
 exact(raw,['type','reloaded']);if(raw.reloaded!==true)deny();return {type:'reload',reloaded:true};
}
export async function observerExecutionTarget(raw:ObserverExecutionTarget,command:ObserverCommand,now:number):Promise<ObserverExecutionTarget>{
 exact(raw,['binding','runtime','policy','targetDigest','expiresAt']);
 exact(raw.binding,['previewId','scope','runId','source','runtime','createdAt','expiresAt','revokedAt','reason']);
 const b=raw.binding,runtime=serviceRuntimeInput(raw.runtime),policy=observerHttpPolicy(raw.policy),paths=runtime.spec.plan.declaration.observation;
 const binding:PreviewBinding={previewId:turnId(b.previewId),scope:scope(b.scope),runId:turnId(b.runId),source:previewSource(b.source),runtime:serviceRuntimeReference(b.runtime),createdAt:positive(b.createdAt),expiresAt:positive(b.expiresAt),revokedAt:null,reason:null};
 if(b.revokedAt!==null||b.reason!==null||binding.previewId!==command.previewId||binding.runId!==runtime.reference.runId||!sameScope(binding.scope,command.scope)||!sameScope(runtime.scope,command.scope)||JSON.stringify(binding.runtime)!==JSON.stringify(runtime.reference)||JSON.stringify(binding.source)!==JSON.stringify(runtime.spec.plan.source)||binding.createdAt>=binding.expiresAt||binding.expiresAt!==runtime.reference.deadlineAt||binding.expiresAt<=now||!paths||paths.pagePath!==policy.pagePath||paths.statePath!==policy.statePath)deny();
 const expiresAt=positive(raw.expiresAt),targetDigest=sha(raw.targetDigest);
 if(expiresAt<=now||expiresAt>command.deadlineAt||expiresAt>binding.expiresAt||await turnDigest({binding,plan:runtime.spec.plan})!==targetDigest)deny();
 return {binding,runtime,policy,targetDigest,expiresAt};
}
/** One execution owns exactly one resource budget, including navigation, reload,
 * redirects, page subresources and the separate state sample. Workspace still
 * owns durable admission and must supply real authority/transport/browser ports. */
export async function executeObserver(raw:ObserverCommand,ports:ObserverExecutionServices,parent?:AbortSignal,clock=Date.now):Promise<{stopped:true;result:{[key:string]:ObserverJson}}>{
 const command=validateObserverCommand(raw,clock()),startedAt=positive(clock()),controller=new AbortController();
 const expired=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('observer-execution-cancelled')),{once:true}));void expired.catch(()=>{});
 let deadlineAt=command.deadlineAt;
 const abort=()=>controller.abort();let timer=setTimeout(abort,Math.max(1,deadlineAt-clock()));parent?.addEventListener('abort',abort,{once:true});if(parent?.aborted)abort();
 let session:ReturnType<typeof createObserverFetchSession>|undefined,initial:ObserverExecutionTarget|undefined;
 const live=()=>{if(controller.signal.aborted||clock()>=deadlineAt)throw Error('observer-execution-cancelled');};
 const wait=async<T,>(promise:Promise<T>)=>{const value=await Promise.race([promise,expired]);live();return value;};
 const authorize=async()=>{
  live();const value=await wait(ports.authorize(command)),checked=await wait(observerExecutionTarget(value,command,clock()));
  if(initial&&(checked.targetDigest!==initial.targetDigest||JSON.stringify(checked.policy)!==JSON.stringify(initial.policy)))throw Error('observer-target-stale');
  if(checked.expiresAt<deadlineAt){deadlineAt=checked.expiresAt;clearTimeout(timer);timer=setTimeout(abort,Math.max(1,deadlineAt-clock()));}
  live();return checked;
 };
 const save=async(kind:ObserverArtifactKind,content:Uint8Array)=>{
  await authorize();const bytes=content.slice(),expected=await wait(observerArtifactDescriptor(command,kind,bytes));
  const saved=observerArtifactReceipt(await wait(ports.artifacts.save(command,kind,bytes)));
  if(JSON.stringify(saved)!==JSON.stringify(expected.receipt))throw Error('observer-artifact-mismatch');await authorize();return saved;
 };
 try{
  initial=await authorize();
  session=createObserverFetchSession(initial.policy,{
   authorize:async()=>({expiresAt:(await authorize()).expiresAt}),
   forward:(request,signal)=>ports.forward(command,initial!.targetDigest,request,signal),
  },{deadlineAt:initial.expiresAt,signal:controller.signal},clock);
  const network=session;
  const viewStartedAt=positive(clock());
  const browser=await wait(ports.browser.run({operation:command.operation,pageUrl:initial.policy.origin+initial.policy.pagePath,signal:controller.signal,timeoutMs:Math.max(1,initial.expiresAt-clock()),fetchResource:request=>network.fetch(request)}));
  if(browser?.stopped!==true)throw Error('observer-exit-unconfirmed');
  const view=payload(browser.payload,command.operation),viewCompletedAt=positive(clock());await authorize();
  const stateStartedAt=positive(clock());
  const response=await wait(network.fetch(new Request(initial.policy.origin+initial.policy.statePath)));
  if(response.status!==200||response.headers.get('content-type')?.split(';',1)[0]?.trim().toLowerCase()!=='application/json')throw Error('observer-state-invalid');
  const stateBytes=new Uint8Array(await wait(response.arrayBuffer())),state=parseObserverState(stateBytes),stateCompletedAt=positive(clock());
  const stateArtifact=await save('state',stateBytes);
  const viewBytes=view.type==='screenshot'?view.bytes:encoder.encode(JSON.stringify(view));
  const viewArtifact=await save(view.type==='screenshot'?'screenshot':'view',viewBytes);
  await authorize();
  const finishedAt=positive(clock()),observationId='observation-'+(await wait(turnDigest({purpose:'observer-receipt',command}))).slice(0,48);
  const result={schemaVersion:1,observationId,operation:command.operation,previewId:command.previewId,runId:initial.binding.runId,sourceKind:initial.binding.source.kind,filesSha256:previewSourceFilesSha256(initial.binding.source),runtimeGeneration:initial.runtime.reference.generation,startedAt,finishedAt,pagePath:initial.policy.pagePath,statePath:initial.policy.statePath,
   domainSideEffects:'unverified',atomicSample:false,
   view:{startedAt:viewStartedAt,completedAt:viewCompletedAt,artifact:viewArtifact,inline:view.type!=='screenshot'&&viewBytes.byteLength<=16384?view:null},
   state:{startedAt:stateStartedAt,completedAt:stateCompletedAt,simulationStateId:state.simulation_state_id,sequence:state.sequence,artifact:stateArtifact},
  };
  await authorize();if(encoder.encode(JSON.stringify(result)).byteLength>65536)deny();
  return {stopped:true,result:JSON.parse(JSON.stringify(result))};
 }catch(error){throw Error(error instanceof Error&&/^observer-[a-z-]+$/.test(error.message)?error.message:'observer-execution-failed');}
 finally{session?.close();clearTimeout(timer);controller.abort();parent?.removeEventListener('abort',abort);}
}
