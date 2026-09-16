import {mkdir,open,readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {productionProfile,profileDigest,conservativeCost} from '../../services/model-proxy/production-profile.ts';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join()!==[...keys].sort().join())throw Error('freeze-shape-invalid');};
const hash=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)||/^([a-f0-9])\1{63}$/.test(v)||/^(0123456789abcdef){4}$/.test(v))throw Error('freeze-real-digest-required');return v;};
const uuid=v=>{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v))throw Error('freeze-principal-invalid');return v;};
const id=v=>{if(typeof v!=='string'||!/^g5-[A-Za-z0-9-]{8,80}$/.test(v)||/placeholder|example|pending|todo/i.test(v))throw Error('freeze-window-id-invalid');return v;};
export async function compileG5Freeze(input){
 exact(input,['profile','principals','windowIds','authorizationReference','rateCardSha256','sourceSha256','targets']);
 const profile=productionProfile(input.profile),profileSha256=await profileDigest(profile);
 hash(profile.acceptance.evidenceSha256);hash(profile.acceptance.privacyReviewSha256);
 const sourceSha256=hash(input.sourceSha256),rateCardSha256=hash(input.rateCardSha256);
 if(profile.model!=='gpt-5.6-luna'||profile.rates.inputNanodollarsPerToken!==250||profile.rates.outputNanodollarsPerToken!==1200||profile.limits.maxInputTokens!==262144||profile.limits.maxOutputTokens!==4096)throw Error('freeze-approved-profile-bounds-required');
 if(!Array.isArray(input.principals)||input.principals.length!==2)throw Error('freeze-two-principals-required');
 const principals=input.principals.map(p=>{exact(p,['tenantId','userId']);return {tenantId:uuid(p.tenantId),userId:uuid(p.userId)};});
 if(principals[0].tenantId===principals[1].tenantId||principals[0].userId===principals[1].userId)throw Error('freeze-distinct-tenant-user-required');
 exact(input.windowIds,['A','B']);const windowIds={A:id(input.windowIds.A),B:id(input.windowIds.B)};if(windowIds.A===windowIds.B)throw Error('freeze-distinct-windows-required');
 if(typeof input.authorizationReference!=='string'||!input.authorizationReference.trim()||/placeholder|example|pending|todo/i.test(input.authorizationReference)||input.authorizationReference.length>500)throw Error('freeze-authorization-reference-required');
 exact(input.targets,['p95TurnMs','maxCostPerAcceptedTaskNanodollars']);for(const value of Object.values(input.targets))if(!Number.isSafeInteger(value)||value<1)throw Error('freeze-target-required');
 const perCall=BigInt(conservativeCost(profile,262144,4096));
 if(147n*perCall>20000000000n||168n*perCall>20000000000n||8n*perCall>5000000000n||BigInt(input.targets.maxCostPerAcceptedTaskNanodollars)*16n<147n*perCall)throw Error('freeze-budget-or-accepted-cost-target-too-small');
 const policyPin={provider:'openai',model:profile.model,profileSha256,rateCardSha256,inputNanodollarsPerToken:250,outputNanodollarsPerToken:1200};
 const base={schemaVersion:1,profilePin:policyPin,totalNanodollars:20000000000,turnNanodollars:5000000000,maxServiceRuns:0,durationMs:7200000};
 const windows={A:{...base,windowId:windowIds.A,phase:'A',principals:[principals[0]],maxUpstreamDispatches:147,maxSimulationRuns:39,maxTasks:66},B:{...base,windowId:windowIds.B,phase:'B',principals,maxUpstreamDispatches:168,maxSimulationRuns:0,maxTasks:24}};
 const period='g5-'+digest({windowIds,profileSha256,sourceSha256}).slice(0,24);
 const money={version:period+'-v1',period,enabled:false,profileSha256,caps:{turn:5000000000,user:40000000000,tenant:40000000000,global:40000000000}};
 const token={version:'g5-openai-luna-20260916-v1',maxReservationAttemptsPerTurn:8,maxDispatchedCallsPerTurn:8,maxInputTokensPerCall:262144,maxOutputTokensPerCall:4096,maxReservedTokensPerTurn:2129920};
 const closed={M2_TURNS_ENABLED:'false',M2_MODEL_PROVIDER_ENABLED:'false',M4_SIMULATION_ENABLED:'false',PRODUCTION_MODEL_ENABLED:'false',G5_ADMISSION_ENABLED:'false'};
 const patches=Object.fromEntries(['A','B'].map(phase=>[phase,{...closed,G5_CONTROLLED_WINDOW_JSON:JSON.stringify(windows[phase]),G5_TOKEN_BUDGET_POLICY_JSON:JSON.stringify(token),PRODUCTION_MODEL_PROFILE_JSON:JSON.stringify(profile),PRODUCTION_MONEY_POLICY_JSON:JSON.stringify(money)}]));
 const privatePolicies={schemaVersion:1,authorizationReference:input.authorizationReference,windows,money,token,patches};
 // No principals, auth references, provider-account IDs or private config in public projection.
 const sanitizedManifest={schemaVersion:1,kind:'closed-frozen-window-not-admission',sourceSha256,profileSha256,rateCardSha256,policyBundleSha256:digest(privatePolicies),durationMs:7200000,phaseOrder:['A','B'],limits:{A:{upstream:147,simulationRuns:39,serviceRuns:0,tasks:66,totalUSD:20},B:{upstream:168,simulationRuns:0,serviceRuns:0,tasks:24,totalUSD:20},turnUSD:5,sharedMoneyUSD:40},maximumNanodollars:{perCall:Number(perCall),A:Number(perCall*147n),B:Number(perCall*168n)},targets:{...input.targets},gatesClosed:true,firstAdmissionStarted:false};
 return {sanitizedManifest,privatePolicies,closedFirstPatch:patches};
}
export async function persistG5Freeze(directory,bundle){
 try{await mkdir(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const directoryInfo=await lstat(directory);if(!directoryInfo.isDirectory()||directoryInfo.isSymbolicLink()||(directoryInfo.mode&0o777)!==0o700)throw Error('freeze-private-directory-required');
 for(const [name,value] of [['manifest.json',bundle.sanitizedManifest],['private-policies.json',bundle.privatePolicies]]){
  const path=directory+'/'+name,bytes=JSON.stringify(value,null,2)+'\n';let handle;
  try{handle=await open(path,'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o777)!==0o600||await readFile(path,'utf8')!==bytes)throw Error('freeze-existing-output-conflict');continue;}
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==4)throw Error('usage: node g5-window-freeze.mjs private-config.json new-private-output-directory');const inputInfo=await lstat(process.argv[2]);if(!inputInfo.isFile()||inputInfo.isSymbolicLink()||(inputInfo.mode&0o777)!==0o600)throw Error('freeze-private-input-0600-required');const bundle=await compileG5Freeze(JSON.parse(await readFile(process.argv[2],'utf8')));await persistG5Freeze(process.argv[3],bundle);process.stdout.write(JSON.stringify(bundle.sanitizedManifest)+'\n');}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}}
