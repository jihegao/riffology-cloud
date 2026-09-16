import {createHash} from 'node:crypto';

const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const gates=['G5_ADMISSION_ENABLED','M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED','PRODUCTION_MODEL_ENABLED','M4_SIMULATION_ENABLED'];
const caps={tasks:66,dispatches:147,simulationRuns:39,serviceRuns:0,totalNanodollars:20_000_000_000,maxTurnNanodollars:5_000_000_000};
const fail=m=>{throw Error(m);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const integer=(v,name)=>{if(!Number.isSafeInteger(v)||v<0)fail(`operator-${name}-invalid`);return v;};
const hash=(v,name)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail(`operator-${name}-invalid`);return v;};
const origin=v=>{let u;try{u=new URL(v);}catch{fail('operator-ordinary-origin-invalid');}if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)fail('operator-ordinary-origin-invalid');return u.origin;};

function validateBundle(bundle){
 const {sanitizedManifest:m,privatePolicies:p}=bundle??{};
 if(!m||!p||m.kind!=='closed-frozen-window-not-admission'||m.phaseOrder?.[0]!=='A'||m.firstAdmissionStarted!==false||m.gatesClosed!==true)fail('operator-closed-freeze-required');
 const w=p.windows?.A,patch=p.patches?.A;
 if(!w||w.phase!=='A'||!patch)fail('operator-a-window-required');
 if(w.durationMs!==7_200_000||w.maxTasks!==caps.tasks||w.maxUpstreamDispatches!==caps.dispatches||w.maxSimulationRuns!==caps.simulationRuns||w.maxServiceRuns!==0||w.totalNanodollars!==caps.totalNanodollars||w.turnNanodollars!==caps.maxTurnNanodollars)fail('operator-a-caps-conflict');
 if(JSON.parse(patch.G5_CONTROLLED_WINDOW_JSON).windowId!==w.windowId||JSON.parse(patch.PRODUCTION_MONEY_POLICY_JSON).enabled!==false)fail('operator-frozen-policy-conflict');
 for(const gate of gates)if(patch[gate]!=='false')fail('operator-closed-gates-required');
 return {m,p,w,patch};
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
 const {m,p,w,patch}=validateBundle(bundle);
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
 return {schemaVersion:1,kind:'g5-a-existing-window-control',windowId:w.windowId,sourceSha256:m.sourceSha256,profileSha256:m.profileSha256,policyBundleSha256:m.policyBundleSha256,caps,changedPaths:expected,closedConfig:structuredClone(closedConfig),openConfig,closedSha256:sha(closedConfig),openSha256,driverHandoff:{schemaVersion:1,kind:'g5-a-cdp-same-origin-handoff',ordinaryOrigin:appOrigin,windowId:w.windowId,profileSha256:m.profileSha256,sourceSha256:m.sourceSha256,openConfigSha256:openSha256,allowedUserId:principal.userId,allowedTenantId:principal.tenantId,deniedUserId:denied.userId,deniedTenantId:denied.tenantId,requiresIdentityPreflight:true}};
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
 return {windowId,startedAt:window?.started_at??null,closed:window?.closed===1,tasks:tasks.length,dispatches:calls.filter(x=>x.dispatch_at!==null).length,simulationRuns:tasks.filter(x=>{try{return JSON.parse(x.document).kind==='simulation';}catch{return false;}}).length,serviceRuns:tasks.filter(x=>{try{return JSON.parse(x.document).kind==='service';}catch{return false;}}).length,guardUnknown:calls.filter(x=>x.state==='unknown').length,guardPending:calls.filter(x=>['reserved','dispatched','settling'].includes(x.state)).length+turns.filter(x=>x.state==='open').length};
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
 if(!['preflight','open','stop'].includes(action))fail('operator-action-invalid');
 if(!execute)return {status:'planned-not-executed',action,windowId:plan.windowId,changedPaths:plan.changedPaths};
 for(const name of action==='preflight'?['readState','readConfig']:action==='open'?['readState','readConfig','deployExact']:['readState','readConfig','deployExact','closeAdmission'])if(typeof ports?.[name]!=='function')fail(`operator-port-required:${name}`);
 const before=assessG5AState(plan,await ports.readState(),now);
 const configSha=sha(await ports.readConfig());
 if(action==='preflight'){
  if(configSha!==plan.closedSha256)fail('operator-closed-preflight-config-conflict');
  return {status:'verified-read-only',state:before};
 }
 if(action==='open'){
  identityChecked(plan,identityPreflight,now);
  if(configSha!==plan.closedSha256)fail('operator-open-source-config-conflict');
  if(before.startedAt!==null||before.closed||before.tasks!==0||before.dispatches!==0||before.unknown||before.pending)fail('operator-a-first-admission-precondition-failed');
  await exactDeploy(plan.openConfig,plan.openSha256,ports);
  const after=assessG5AState(plan,await ports.readState(),now);
  if(after.startedAt!==null||after.tasks!==0||after.dispatches!==0)fail('operator-open-started-window-unexpectedly');
  return {status:'opened-existing-window-gates',state:after};
 }
 if(configSha!==plan.openSha256&&configSha!==plan.closedSha256)fail('operator-stop-source-config-conflict');
 if(configSha!==plan.closedSha256)await exactDeploy(plan.closedConfig,plan.closedSha256,ports);
 if(before.startedAt===null)return {status:'new-admission-stopped-before-window-start',state:before,settlementRequired:false};
 const ack=await ports.closeAdmission(plan.windowId);
 if(ack?.closed!==true||ack.windowId!==plan.windowId)fail('operator-close-admission-ack-unknown');
 const after=assessG5AState(plan,await ports.readState(),now);
 if(!after.closed)fail('operator-close-admission-readback-conflict');
 return {status:'new-admission-stopped',state:after,settlementRequired:after.unknown>0||after.pending>0};
}

/** Wraps the private DO RPC without exposing it as HTTP. */
export function createG5GuardOperatorAdapter(stub,windowId){
 if(typeof stub?.snapshot!=='function'||typeof stub?.closeAdmission!=='function')fail('operator-guard-stub-required');
 return {snapshot:async()=>summarizeG5GuardSnapshot(await stub.snapshot(),windowId),closeAdmission:async()=>{const before=summarizeG5GuardSnapshot(await stub.snapshot(),windowId);if(before.windowId!==windowId)fail('operator-guard-window-conflict');const ack=await stub.closeAdmission();const after=summarizeG5GuardSnapshot(await stub.snapshot(),windowId);return {closed:ack?.closed===true&&after.closed,windowId};}};
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
 const call=async(action,payload,mutation=false)=>{let response;try{response=await fetcher(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{authorization:`Bearer ${capability}`,'content-type':'application/json',...(mutation?{'x-g5-mutation':'close-admission'}:{})},body:JSON.stringify({action,windowId,...payload})});}catch{fail('operator-http-unavailable');}const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>65536)fail('operator-http-response-too-large');let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('operator-http-response-invalid');}if(!response.ok||value?.ok!==true)fail('operator-http-rejected');return value;};
 const snapshot=async()=>{const value=await call('snapshot',{});if(value.summary?.windowId!==windowId||typeof value.snapshotSha256!=='string')fail('operator-http-snapshot-invalid');hash(value.snapshotSha256,'snapshot-sha256');return value;};
 const inspect=action=>async payload=>(await call(action,{payload})).value;
 return {readState:async()=>(await snapshot()).summary,inspectAdmissionContract:inspect('inspectAdmissionContract'),inspectProviderFailure:inspect('inspectProviderFailure'),inspectTask:inspect('inspectTask'),inspectFixtureTask:inspect('inspectFixtureTask'),inspectFixtureTerminal:inspect('inspectFixtureTerminal'),snapshotReadonlyCounters:inspect('snapshotReadonlyCounters'),beginReadonlyReadSession:inspect('beginReadonlyReadSession'),attestReadonlyInterval:inspect('attestReadonlyInterval'),consumeReadonlyReopenGrant:inspect('consumeReadonlyReopenGrant'),inspectRun:inspect('inspectRun'),inspectFinal:inspect('inspectFinal'),closeAdmission:async input=>{if(input?.windowId!==windowId)fail('operator-guard-window-conflict');const before=await snapshot(),closed=await call('close',{expectedSnapshotSha256:before.snapshotSha256,confirmation:'close-existing-window'},true);if(closed.closed!==true||closed.windowId!==windowId)fail('operator-close-admission-readback-conflict');hash(closed.afterSnapshotSha256,'close-receipt-sha256');return {schemaVersion:1,windowId,closed:true,receiptSha256:closed.afterSnapshotSha256};}};
}
function namedWindow(value){return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(value);}
