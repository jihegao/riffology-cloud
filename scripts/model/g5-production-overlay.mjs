import {compileG5Freeze} from './g5-window-freeze.mjs';
import {createHash} from 'node:crypto';
import {productionProfile,profileDigest} from '../../services/model-proxy/production-profile.ts';
import {g5WindowPolicy} from '../../services/model-budget/g5-window.ts';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const classes={G5_WINDOW_GUARD:'G5ControlledWindow',G5_TOKEN_BUDGET:'G5TenantModelBudget',PRODUCTION_MODEL_BUDGET:'ProductionModelBudget'};
const gates=['M2_TURNS_ENABLED','M2_MODEL_PROVIDER_ENABLED','M4_SIMULATION_ENABLED','PRODUCTION_MODEL_ENABLED','G5_ADMISSION_ENABLED'];
/** Offline additive configuration compiler. Returned configuration contains private IDs. Never print it. */
export async function compileG5ProductionOverlay(base,bundle,phase,{sourceSha256}={}){
 if(!base||typeof base!=='object'||Array.isArray(base)||!['A','B'].includes(phase))throw Error('overlay-input-invalid');
 const {sanitizedManifest:manifest,privatePolicies:policies}=bundle??{};
 if(!manifest||!policies||manifest.kind!=='closed-frozen-window-not-admission'||manifest.firstAdmissionStarted!==false||manifest.gatesClosed!==true||manifest.sourceSha256!==sourceSha256||manifest.policyBundleSha256!==digest(policies))throw Error('overlay-freeze-source-or-bundle-conflict');
 const canonical=await compileG5Freeze({profile:JSON.parse(policies.patches?.A?.PRODUCTION_MODEL_PROFILE_JSON??'null'),principals:policies.windows?.B?.principals,windowIds:{A:policies.windows?.A?.windowId,B:policies.windows?.B?.windowId},authorizationReference:policies.authorizationReference,rateCardSha256:manifest.rateCardSha256,sourceSha256:manifest.sourceSha256,targets:manifest.targets,rollover:policies.windows?.A?.rollover});
 if(!equal(canonical.privatePolicies,policies)||!equal(canonical.sanitizedManifest,manifest))throw Error('overlay-noncanonical-freeze');
 const patch=policies.patches?.[phase];if(!patch||gates.some(k=>patch[k]!=='false'))throw Error('overlay-open-admission-denied');
 const profile=productionProfile(JSON.parse(patch.PRODUCTION_MODEL_PROFILE_JSON));
 if(await profileDigest(profile)!==manifest.profileSha256)throw Error('overlay-profile-conflict');
 const window=g5WindowPolicy(JSON.parse(patch.G5_CONTROLLED_WINDOW_JSON)),money=JSON.parse(patch.PRODUCTION_MONEY_POLICY_JSON),token=JSON.parse(patch.G5_TOKEN_BUDGET_POLICY_JSON);
 if(!window||window.phase!==phase||window.profilePin.profileSha256!==manifest.profileSha256||window.profilePin.rateCardSha256!==manifest.rateCardSha256||!equal(window,policies.windows[phase])||money.enabled!==false||!equal(money,policies.money)||money.profileSha256!==manifest.profileSha256||!equal(money.caps,{turn:5000000000,user:40000000000,tenant:40000000000,global:40000000000})||money.period!==policies.windows.A.rollover.sourceMoneyPeriod||!equal(token,policies.token)||token.version!=='g5-openai-luna-20260916-v1'||phase==='A'&&(window.maxTasks!==64||window.maxUpstreamDispatches!==146||window.totalNanodollars!==19990089550||window.rollover?.newIntentNamespace!==`${window.windowId}-`))throw Error('overlay-frozen-policy-conflict');
 for(const other of ['A','B']){
  const p=policies.patches[other];if(!equal(JSON.parse(p.PRODUCTION_MONEY_POLICY_JSON),money)||gates.some(k=>p[k]!=='false'))throw Error('overlay-cross-phase-or-gate-conflict');
 }
 const out=structuredClone(base);
 out.vars={...(out.vars??{}),...patch,M2_MODEL_PROVIDER:'openai',M2_MODEL_ID:'gpt-5.6-luna',M2_MODEL_BUDGET_POLICY_VERSION:token.version,M3_SERVICE_ENABLED:'false',M3_PREVIEW_ENABLED:'false',M3_PREVIEW_WS_ENABLED:'false'};
 out.durable_objects??={bindings:[]};out.durable_objects.bindings??=[];
 for(const [name,class_name] of Object.entries(classes)){
  const prior=out.durable_objects.bindings.filter(b=>b.name===name);
  if(prior.length>1||prior.length===1&&prior[0].class_name!==class_name)throw Error('overlay-binding-conflict');
  if(!prior.length)out.durable_objects.bindings.push({name,class_name});
  out.exports??={};const desired={type:'durable-object',storage:'sqlite'};
  if(out.exports[class_name]&&!equal(out.exports[class_name],desired))throw Error('overlay-export-conflict');
  out.exports[class_name]??=desired;
 }
 out.secrets??={required:[]};out.secrets.required??=[];
 for(const name of ['PRODUCTION_OPENAI_API_KEY','PRODUCTION_AI_GATEWAY_TOKEN'])if(!out.secrets.required.includes(name))out.secrets.required.push(name);
 for(const [key,value] of Object.entries(base.vars??{}))if((key.startsWith('MODEL_BUDGET_')||key.startsWith('G4_'))&&!equal(out.vars[key],value))throw Error('overlay-legacy-policy-mutation');
 for(const key of ['containers','routes','services','migrations','d1_databases','r2_buckets'])if(!equal(out[key],base[key]))throw Error('overlay-existing-runtime-mutation');
 return out;
}
