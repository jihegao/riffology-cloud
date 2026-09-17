import {createHash} from 'node:crypto';
import {turnDigest} from '../../services/turn/protocol.ts';

const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const gates=['G5_ADMISSION_ENABLED','M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED','PRODUCTION_MODEL_ENABLED','M4_SIMULATION_ENABLED'];
const fail=m=>{throw Error(m);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const integer=(v,name)=>{if(!Number.isSafeInteger(v)||v<0)fail(`operator-${name}-invalid`);return v;};
const hash=(v,name)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail(`operator-${name}-invalid`);return v;};
const origin=v=>{let u;try{u=new URL(v);}catch{fail('operator-ordinary-origin-invalid');}if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)fail('operator-ordinary-origin-invalid');return u.origin;};
const exactObject=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
const nullableTime=value=>value===null||Number.isSafeInteger(value)&&value>0;
async function checkedProviderFailure(value,expected){
 const top=['schemaVersion','windowId','turnId','guard','calls','tool','receiptSha256'];if(!exactObject(value,top)||value.schemaVersion!==1||value.windowId!==expected.windowId||value.turnId!==expected.turnId||!hash(value.receiptSha256,'provider-failure-receipt'))fail('operator-provider-failure-invalid');
 const guardKeys=['windowStartedAt','taskState','taskAcceptedAt','taskStartedAt','startConfirmed','turnState'];if(!exactObject(value.guard,guardKeys)||![value.guard.windowStartedAt,value.guard.taskAcceptedAt].every(v=>Number.isSafeInteger(v)&&v>0)||!nullableTime(value.guard.taskStartedAt)||typeof value.guard.startConfirmed!=='boolean'||!['queued-permit','create-claimed','bound','started','cancelled'].includes(value.guard.taskState)||!['open','closed'].includes(value.guard.turnState)||!Array.isArray(value.calls)||value.calls.length<1||value.calls.length>8||!exactObject(value.tool,['active','pending','unknown']))fail('operator-provider-failure-invalid');for(const key of ['active','pending','unknown'])integer(value.tool[key],`provider-failure-tool-${key}`);
 for(let index=0;index<value.calls.length;index++){const call=value.calls[index],callKeys=['ordinal','guard','token','money',...(call?.failure===undefined?[]:['failure'])];if(!exactObject(call,callKeys)||call.ordinal!==index+1||!exactObject(call.guard,['state','dispatchAt'])||!['reserved','dispatched','unknown','settling','call-settled','recorded'].includes(call.guard.state)||!nullableTime(call.guard.dispatchAt)||!exactObject(call.token,['status','reconciliation','acceptedAt','updatedAt','dispatchedAt','unknownAt','finishedAt','terminal'])||!['reserved','dispatched','unknown','completed','failed','cancelled','not-dispatched'].includes(call.token.status)||!['held','recorded','pending','released'].includes(call.token.reconciliation)||!Number.isSafeInteger(call.token.acceptedAt)||call.token.acceptedAt<1||!Number.isSafeInteger(call.token.updatedAt)||call.token.updatedAt<call.token.acceptedAt||![call.token.dispatchedAt,call.token.unknownAt,call.token.finishedAt].every(nullableTime)||!exactObject(call.money,['state','reserved','accounted','errorCategory','terminalPresent'])||!['reserved','dispatched','unknown','recorded','released'].includes(call.money.state)||!Number.isSafeInteger(call.money.reserved)||call.money.reserved<0||!Number.isSafeInteger(call.money.accounted)||call.money.accounted<0||call.money.errorCategory!==null&&(typeof call.money.errorCategory!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(call.money.errorCategory))||typeof call.money.terminalPresent!=='boolean'||call.failure!==undefined&&(!exactObject(call.failure,['schemaVersion','stage','errorCode','observedAt'])||call.failure.schemaVersion!==1||!['admission','provider-dispatch','budget-finish'].includes(call.failure.stage)||typeof call.failure.errorCode!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(call.failure.errorCode)||!Number.isSafeInteger(call.failure.observedAt)||call.failure.observedAt<1))fail('operator-provider-failure-invalid');if(['completed','failed','cancelled'].includes(call.token.status)!==(call.token.terminal!==null)||call.token.terminal!==null&&(!exactObject(call.token.terminal,['errorCode','usage','providerRequestIdPresent'])||call.token.terminal.errorCode!==null&&(typeof call.token.terminal.errorCode!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(call.token.terminal.errorCode))||!exactObject(call.token.terminal.usage,['kind'])||!['verified','unknown'].includes(call.token.terminal.usage.kind)||typeof call.token.terminal.providerRequestIdPresent!=='boolean'))fail('operator-provider-failure-invalid');}
 const {receiptSha256,...body}=value;if(await turnDigest(body)!==receiptSha256)fail('operator-provider-failure-invalid');return structuredClone(value);
}

function validateBundle(bundle){
 const {sanitizedManifest:m,privatePolicies:p}=bundle??{};
 if(!m||!p||m.kind!=='closed-frozen-window-not-admission'||m.phaseOrder?.[0]!=='A'||m.firstAdmissionStarted!==false||m.gatesClosed!==true)fail('operator-closed-freeze-required');
 const w=p.windows?.A,patch=p.patches?.A;
 if(!w||w.phase!=='A'||!patch)fail('operator-a-window-required');
 const caps={tasks:w.maxTasks,dispatches:w.maxUpstreamDispatches,simulationRuns:w.maxSimulationRuns,serviceRuns:w.maxServiceRuns,totalNanodollars:w.totalNanodollars,maxTurnNanodollars:w.turnNanodollars};if(w.durationMs!==7_200_000||!equal(m.limits?.A,{upstream:caps.dispatches,simulationRuns:caps.simulationRuns,serviceRuns:caps.serviceRuns,tasks:caps.tasks,totalNanodollars:caps.totalNanodollars})||caps.maxTurnNanodollars!==5_000_000_000)fail('operator-a-caps-conflict');
 if(JSON.parse(patch.G5_CONTROLLED_WINDOW_JSON).windowId!==w.windowId||JSON.parse(patch.PRODUCTION_MONEY_POLICY_JSON).enabled!==false)fail('operator-frozen-policy-conflict');
 const rollover=w.rollover,quarantines=rollover?.schemaVersion===1?[rollover]:rollover?.quarantines,immediate=quarantines?.at(-1);if(!rollover||![1,2].includes(rollover.schemaVersion)||!Array.isArray(quarantines)||quarantines.length<1||rollover.targetWindowId!==w.windowId||rollover.sourceWindowId!==immediate?.sourceWindowId||rollover.newIntentNamespace!==`${w.windowId}-`||p.money?.period!==immediate?.sourceMoneyPeriod)fail('operator-rollover-binding-conflict');
 const {receiptSha256,...rolloverBinding}=rollover;if(receiptSha256!==sha({purpose:rollover.schemaVersion===1?'g5-a-one-time-rollover-v1':'g5-a-chained-rollover-v2',...rolloverBinding}))fail('operator-rollover-receipt-conflict');
 for(const gate of gates)if(patch[gate]!=='false')fail('operator-closed-gates-required');
 return {m,p,w,patch,caps,rollover,rolloverBinding,quarantines,immediate};
}

function changed(a,b,path='',out=[]){
 if(equal(a,b))return out;
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
  for(const key of new Set([...Object.keys(a),...Object.keys(b)]))changed(a[key],b[key],path?`${path}.${key}`:key,out);
 }else out.push(path);
 return out;
}

/** Compile a reviewable gate-only transition for the already-frozen A window. */
export function compileG5AControl(closedConfig,bundle,{ordinaryOrigin}={}){
 const {m,p,w,patch,caps,rollover,rolloverBinding,quarantines,immediate}=validateBundle(bundle);
 if(!closedConfig?.vars)fail('operator-closed-config-required');
 for(const [key,value] of Object.entries(patch))if(closedConfig.vars[key]!==value)fail(`operator-live-pin-conflict:${key}`);
 if(closedConfig.vars.M3_SERVICE_ENABLED!=='false')fail('operator-service-must-remain-closed');
 const openConfig=structuredClone(closedConfig);
 for(const gate of gates)openConfig.vars[gate]='true';
 const paths=changed(closedConfig,openConfig);
 const expected=gates.map(g=>`vars.${g}`).sort();
 if(!equal([...paths].sort(),expected))fail('operator-non-gate-diff');
 const appOrigin=origin(ordinaryOrigin);
 const openSha256=sha(openConfig);
 const principal=w.principals?.[0],denied=p.windows?.B?.principals?.find(value=>value.userId!==principal?.userId&&value.tenantId!==principal?.tenantId);
 if(!principal||!denied)fail('operator-principal-boundary-required');
 return {schemaVersion:1,kind:rollover.schemaVersion===1?'g5-a-one-time-rollover-control':'g5-a-chained-rollover-control',windowId:w.windowId,sourceSha256:m.sourceSha256,profileSha256:m.profileSha256,policyBundleSha256:m.policyBundleSha256,caps,rollover:structuredClone(rollover),rolloverBinding:structuredClone(rolloverBinding),changedPaths:expected,closedConfig:structuredClone(closedConfig),openConfig,closedSha256:sha(closedConfig),openSha256,driverHandoff:{schemaVersion:1,kind:'g5-a-cdp-same-origin-handoff',ordinaryOrigin:appOrigin,windowId:w.windowId,profileSha256:m.profileSha256,sourceSha256:m.sourceSha256,openConfigSha256:openSha256,rolloverReceiptSha256:rollover.receiptSha256,maximumTasks:caps.tasks,allowedUserId:principal.userId,allowedTenantId:principal.tenantId,deniedUserId:denied.userId,deniedTenantId:denied.tenantId,requiresIdentityPreflight:true,newIntentNamespace:rollover.newIntentNamespace,forbiddenIntentNamespace:`${immediate.sourceWindowId}-`,sourceIntentKeySha256:immediate.sourceIntentKeySha256,sourceProjectId:immediate.sourceProjectId,sourceSessionId:immediate.sourceSessionId,sourceTurnId:immediate.sourceTurnId,forbiddenIntentNamespaces:quarantines.map(value=>`${value.sourceWindowId}-`),sourceIntentKeySha256s:quarantines.map(value=>value.sourceIntentKeySha256),sourceProjectIds:quarantines.map(value=>value.sourceProjectId),sourceSessionIds:quarantines.map(value=>value.sourceSessionId),sourceTurnIds:quarantines.map(value=>value.sourceTurnId)}};
}

function identityChecked(plan,value,now){
 const keys=['schemaVersion','completed','origin','windowId','openConfigSha256','checkedAt','principalSha256','deniedPrincipalSha256','boundarySha256','evidenceSha256'];
 const handoff=plan.driverHandoff;
 if(!value||Object.keys(value).sort().join()!==keys.sort().join()||value.schemaVersion!==1||value.completed!==true||origin(value.origin)!==handoff.ordinaryOrigin||value.windowId!==plan.windowId||value.openConfigSha256!==plan.openSha256)fail('operator-identity-preflight-required');
 const checkedAt=integer(value.checkedAt,'identity-checkedAt');
 if(checkedAt>now||now-checkedAt>600_000)fail('operator-identity-preflight-stale');
 const expectedPrincipal=sha({userId:handoff.allowedUserId,tenantId:handoff.allowedTenantId}),expectedDenied=sha({userId:handoff.deniedUserId,tenantId:handoff.deniedTenantId});
 if(value.principalSha256!==expectedPrincipal||value.deniedPrincipalSha256!==expectedDenied||value.boundarySha256!==sha({origin:handoff.ordinaryOrigin,windowId:plan.windowId,openConfigSha256:plan.openSha256,principalSha256:expectedPrincipal,deniedPrincipalSha256:expectedDenied,allowedTenantStatus:200,deniedTenantStatus:404}))fail('operator-identity-preflight-binding-conflict');
 hash(value.evidenceSha256,'identity-evidence-sha256');
}

/** Normalizes only the existing G5 guard window. No schema creation or mutation. */
export function summarizeG5GuardSnapshot(raw,windowId){
 if(raw?.schemaVersion!==1||raw.activePolicy?.windowId!==windowId)fail('operator-guard-window-conflict');
 const windows=(raw.windows??[]).filter(x=>x.window_id===windowId);
 if(windows.length>1)fail('operator-guard-window-duplicate');
 const window=windows[0];
 const calls=(raw.calls??[]).filter(x=>x.window_id===windowId);
 const turns=(raw.turns??[]).filter(x=>x.window_id===windowId);
 const tasks=(raw.tasks??[]).filter(x=>x.window_id===windowId);
 const rollovers=(raw.rollovers??[]).filter(x=>x.target_window_id===windowId),rolloverReceiptSha256=rollovers.length===1?rollovers[0].receipt_sha256:null;if(rollovers.length>1)fail('operator-rollover-duplicate');
 return {windowId,startedAt:window?.started_at??null,closed:window?.closed===1,tasks:tasks.length,dispatches:calls.filter(x=>x.dispatch_at!==null).length,simulationRuns:tasks.filter(x=>{try{return JSON.parse(x.document).kind==='simulation';}catch{return false;}}).length,serviceRuns:tasks.filter(x=>{try{return JSON.parse(x.document).kind==='service';}catch{return false;}}).length,guardUnknown:calls.filter(x=>x.state==='unknown').length,guardPending:calls.filter(x=>['reserved','dispatched','settling'].includes(x.state)).length+turns.filter(x=>x.state==='open').length,rolloverReceiptSha256};
}

export function assessG5AState(plan,state,now=Date.now()){
 if(state?.windowId!==plan.windowId)fail('operator-state-window-conflict');
 const names=['tasks','dispatches','simulationRuns','serviceRuns','guardUnknown','guardPending','tokenUnknown','tokenPending','moneyUnknown','moneyPending','toolUnknown','toolPending','totalNanodollars','maxTurnNanodollars'];
 if(typeof state.closed!=='boolean'||!Object.hasOwn(state,'startedAt'))fail('operator-state-incomplete');
 for(const name of names){if(!Object.hasOwn(state,name))fail(`operator-${name}-missing`);integer(state[name],name);}
 for(const name of ['tasks','dispatches','simulationRuns','serviceRuns','totalNanodollars','maxTurnNanodollars'])if(state[name]>plan.caps[name])fail(`operator-${name}-cap-exceeded`);
 const unknown=state.guardUnknown+state.tokenUnknown+state.moneyUnknown+state.toolUnknown;
 const pending=state.guardPending+state.tokenPending+state.moneyPending+state.toolPending;
 const deadlineAt=state.startedAt===null?null:integer(state.startedAt,'startedAt')+7_200_000;
 return {...state,unknown,pending,deadlineAt,expired:deadlineAt!==null&&now>=deadlineAt,safeForNewAdmission:state.closed!==true&&unknown===0&&pending===0&&deadlineAt!==null&&now<deadlineAt,remaining:{tasks:plan.caps.tasks-state.tasks,dispatches:plan.caps.dispatches-state.dispatches,simulationRuns:plan.caps.simulationRuns-state.simulationRuns,totalNanodollars:plan.caps.totalNanodollars-state.totalNanodollars}};
}

async function exactDeploy(config,expectedSha,ports){
 const ack=await ports.deployExact(config);
 if(ack?.status!=='confirmed'||ack.sha256!==expectedSha)fail('operator-deploy-ack-unknown');
 const readback=await ports.readConfig();
 if(sha(readback)!==expectedSha)fail('operator-config-readback-conflict');
}

/** Default is plan-only. Mutation requires execute:true and explicit trusted ports. */
export async function runG5AControl(plan,{action='preflight',execute=false,ports,identityPreflight,now=Date.now()}={}){
 if(!['preflight','rollover','open','stop'].includes(action))fail('operator-action-invalid');
 if(!execute)return {status:'planned-not-executed',action,windowId:plan.windowId,changedPaths:plan.changedPaths};
 for(const name of action==='preflight'?['readState','readConfig']:action==='rollover'?['readState','readConfig','registerRollover']:action==='open'?['readState','readConfig','deployExact']:['readState','readConfig','deployExact','closeAdmission'])if(typeof ports?.[name]!=='function')fail(`operator-port-required:${name}`);
 if(action==='stop'){
  let deployError=null;try{await exactDeploy(plan.closedConfig,plan.closedSha256,ports);}catch(error){deployError=error;}
  let closedConfig=false;try{closedConfig=sha(await ports.readConfig())===plan.closedSha256;}catch{}if(!closedConfig)throw deployError??Error('operator-stop-closed-config-unconfirmed');
  const before=assessG5AState(plan,await ports.readState(),now);if(before.startedAt===null)return {status:'new-admission-stopped-before-window-start',state:before,settlementRequired:false};
  const ack=await ports.closeAdmission(plan.windowId);if(ack?.closed!==true||ack.windowId!==plan.windowId)fail('operator-close-admission-ack-unknown');const after=assessG5AState(plan,await ports.readState(),now);if(!after.closed)fail('operator-close-admission-readback-conflict');return {status:'new-admission-stopped',state:after,settlementRequired:after.unknown>0||after.pending>0};
 }
 const before=assessG5AState(plan,await ports.readState(),now);
 const configSha=sha(await ports.readConfig());
 if(action==='preflight'){
  if(configSha!==plan.closedSha256)fail('operator-closed-preflight-config-conflict');
  return {status:'verified-read-only',state:before};
 }
 if(action==='rollover'){
  if(configSha!==plan.closedSha256||before.startedAt!==null||before.closed||before.tasks!==0||before.dispatches!==0||before.rolloverReceiptSha256!==null&&before.rolloverReceiptSha256!==plan.rollover.receiptSha256)fail('operator-rollover-precondition-failed');
  const ack=await ports.registerRollover(plan.rolloverBinding);if(ack?.targetWindowId!==plan.windowId||ack?.sourceWindowId!==plan.rollover.sourceWindowId||ack?.receiptSha256!==plan.rollover.receiptSha256)fail('operator-rollover-ack-conflict');
  const after=assessG5AState(plan,await ports.readState(),now);if(after.rolloverReceiptSha256!==plan.rollover.receiptSha256||after.startedAt!==null||after.tasks!==0||after.dispatches!==0)fail('operator-rollover-readback-conflict');
  return {status:'rollover-registered-gates-closed',windowId:plan.windowId,receiptSha256:plan.rollover.receiptSha256,state:after};
 }
 if(action==='open'){
  identityChecked(plan,identityPreflight,now);
  if(configSha!==plan.closedSha256)fail('operator-open-source-config-conflict');
  if(before.rolloverReceiptSha256!==plan.rollover.receiptSha256||before.startedAt!==null||before.closed||before.tasks!==0||before.dispatches!==0||before.unknown||before.pending)fail('operator-a-first-admission-precondition-failed');
  await exactDeploy(plan.openConfig,plan.openSha256,ports);
  const after=assessG5AState(plan,await ports.readState(),now);
  if(after.startedAt!==null||after.tasks!==0||after.dispatches!==0)fail('operator-open-started-window-unexpectedly');
  return {status:'opened-existing-window-gates',state:after};
 }
 fail('operator-action-invalid');
}

/** Wraps the private DO RPC without exposing it as HTTP. */
export function createG5GuardOperatorAdapter(stub,windowId){
 if(typeof stub?.snapshot!=='function'||typeof stub?.registerRollover!=='function'||typeof stub?.closeAdmission!=='function')fail('operator-guard-stub-required');
 return {snapshot:async()=>summarizeG5GuardSnapshot(await stub.snapshot(),windowId),registerRollover:input=>stub.registerRollover(input),closeAdmission:async()=>{const before=summarizeG5GuardSnapshot(await stub.snapshot(),windowId);if(before.windowId!==windowId)fail('operator-guard-window-conflict');const ack=await stub.closeAdmission();const after=summarizeG5GuardSnapshot(await stub.snapshot(),windowId);return {closed:ack?.closed===true&&after.closed,windowId};}};
}

/** Complete private authority adapter. It accepts no caller-supplied ledger
 * receipts; every inspector executes inside the fixed global Guard actor. */
export function createG5AuthorityAdapter(stub,windowId){
 if(!stub||['operatorSnapshot','inspectAdmissionContract','inspectTask','inspectFixtureTask','inspectFixtureTerminal','inspectRun','inspectFinal','closeAdmission'].some(name=>typeof stub[name]!=='function'))fail('operator-authority-stub-required');
 const checked=async()=>{const value=await stub.operatorSnapshot();if(value?.schemaVersion!==1||value.windowId!==windowId)fail('operator-authority-snapshot-invalid');hash(value.receiptSha256,'authority-receipt');return value;};
 return {
  readState:checked,
  inspectAdmissionContract:()=>stub.inspectAdmissionContract(),inspectTask:input=>stub.inspectTask(input),inspectFixtureTask:input=>stub.inspectFixtureTask(input),inspectFixtureTerminal:input=>stub.inspectFixtureTerminal(input),
  inspectProviderFailure:input=>typeof stub.inspectProviderFailure==='function'?stub.inspectProviderFailure(input):fail('operator-provider-failure-authority-unavailable'),
  snapshotReadonlyCounters:input=>typeof stub.snapshotReadonlyCounters==='function'?stub.snapshotReadonlyCounters(input):fail('operator-b2-authority-unavailable'),
  beginReadonlyReadSession:input=>typeof stub.beginReadonlyReadSession==='function'?stub.beginReadonlyReadSession(input):fail('operator-b2-authority-unavailable'),
  attestReadonlyInterval:input=>typeof stub.attestReadonlyInterval==='function'?stub.attestReadonlyInterval(input):fail('operator-b2-authority-unavailable'),
  consumeReadonlyReopenGrant:input=>typeof stub.consumeReadonlyReopenGrant==='function'?stub.consumeReadonlyReopenGrant(input):fail('operator-b2-authority-unavailable'),
  registerRollover:input=>typeof stub.registerRollover==='function'?stub.registerRollover(input):fail('operator-rollover-authority-unavailable'),
  inspectRun:input=>stub.inspectRun(input),
  inspectFinal:input=>stub.inspectFinal(input),
  closeAdmission:async input=>{if(input?.windowId!==windowId)fail('operator-guard-window-conflict');await checked();const ack=await stub.closeAdmission(),after=await checked();if(ack?.closed!==true||after.closed!==true)fail('operator-close-admission-readback-conflict');return {schemaVersion:1,windowId,closed:true,receiptSha256:after.receiptSha256};},
 };
}

/** Node-side client for the temporary capability Worker. The capability is
 * request-only and is never included in returned evidence or thrown errors. */
export function createG5OperatorHttpAuthority({operatorOrigin,capability,windowId,fetcher=fetch,timeoutMs=15000}={}){
 let endpoint;try{endpoint=new URL('/operate',operatorOrigin);}catch{fail('operator-http-origin-invalid');}
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||typeof capability!=='string'||capability.length<32||/[\r\n]/.test(capability)||!namedWindow(windowId)||typeof fetcher!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)fail('operator-http-config-invalid');
 const call=async(action,payload,mutation=null)=>{let response;try{response=await fetcher(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{authorization:`Bearer ${capability}`,'content-type':'application/json',...(mutation?{'x-g5-mutation':mutation}:{})},body:JSON.stringify({action,windowId,...payload})});}catch{fail('operator-http-unavailable');}const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>65536)fail('operator-http-response-too-large');let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('operator-http-response-invalid');}if(!response.ok||value?.ok!==true)fail('operator-http-rejected');return value;};
 const snapshot=async()=>{const value=await call('snapshot',{});if(value.summary?.windowId!==windowId||typeof value.snapshotSha256!=='string')fail('operator-http-snapshot-invalid');hash(value.snapshotSha256,'snapshot-sha256');return value;};
 const inspect=action=>async payload=>(await call(action,{payload})).value;
 return {readState:async()=>(await snapshot()).summary,inspectAdmissionContract:inspect('inspectAdmissionContract'),inspectProviderFailure:async input=>{if(!exactObject(input,['windowId','turnId'])||input.windowId!==windowId||!namedWindow(input.turnId))fail('operator-provider-failure-input-invalid');return checkedProviderFailure(await inspect('inspectProviderFailure')(input),input);},inspectTask:inspect('inspectTask'),inspectFixtureTask:inspect('inspectFixtureTask'),inspectFixtureTerminal:inspect('inspectFixtureTerminal'),snapshotReadonlyCounters:inspect('snapshotReadonlyCounters'),beginReadonlyReadSession:inspect('beginReadonlyReadSession'),attestReadonlyInterval:inspect('attestReadonlyInterval'),consumeReadonlyReopenGrant:inspect('consumeReadonlyReopenGrant'),inspectRun:inspect('inspectRun'),inspectFinal:inspect('inspectFinal'),registerRollover:async binding=>{const before=await snapshot(),value=await call('rollover',{binding,expectedSnapshotSha256:before.snapshotSha256,confirmation:'register-one-time-rollover'},'register-rollover');if(value?.targetWindowId!==windowId||value?.sourceWindowId!==binding?.sourceWindowId)fail('operator-rollover-ack-conflict');hash(value.receiptSha256,'rollover-receipt-sha256');hash(value.afterSnapshotSha256,'rollover-after-snapshot-sha256');const after=await snapshot();if(after.snapshotSha256!==value.afterSnapshotSha256||after.summary?.rolloverReceiptSha256!==value.receiptSha256)fail('operator-rollover-readback-conflict');return value;},closeAdmission:async input=>{if(input?.windowId!==windowId)fail('operator-guard-window-conflict');const before=await snapshot(),closed=await call('close',{expectedSnapshotSha256:before.snapshotSha256,confirmation:'close-existing-window'},'close-admission');if(closed.closed!==true||closed.windowId!==windowId)fail('operator-close-admission-readback-conflict');hash(closed.afterSnapshotSha256,'close-receipt-sha256');return {schemaVersion:1,windowId,closed:true,receiptSha256:closed.afterSnapshotSha256};}};
}
function namedWindow(value){return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(value);}
