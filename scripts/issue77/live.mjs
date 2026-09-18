import {mkdirSync,writeFileSync,readFileSync,openSync,closeSync,unlinkSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EnvHttpProxyAgent,fetch as undiciFetch} from 'undici';
import {Issue77Ledger,POLICY} from './ledger.mjs';
import {SqlExecutionBindingStore} from '../../services/turn-runtime/backend-contract.ts';
import {ManagedExecutionAdapter} from '../../services/turn-runtime/managed-adapter.ts';
import {ManagedSdkTransport} from '../../services/turn-runtime/managed-sdk-transport.ts';
import {packageCandidateModel,managedCandidateSnapshot} from '../../services/turn-runtime/candidate-artifact.ts';
import {workspaceFileIndex,workspaceArchiveReader} from '../../services/turn-runtime/workspace-file-index.ts';
import {simulationPlan} from '../../services/simulation/source.ts';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),directory=resolve(root,'.local/issue77-internal-v1');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const prompts=[
`Build a small deterministic FCFS queue simulation using only Python's standard library. Implement model/model.py with run(config), where config has seed (uint32), steps, and parameters. Customers default 5 (integer 1..20), service_time default 3 (integer 1..5). Arrival of customer i (zero-based) is seed % 3 + 2*i. There is one server. Calculate start=max(arrival,previous_finish), finish=start+service_time, wait=start-arrival. Return a dict with model name and snapshots: frame 0 at time 0 with zero completed and mean_wait 0; then one snapshot per customer completion in time order. Each snapshot has schemaVersion 'riffology.visual/v0.1', frame, time, space {type:'lane',lanes:['queue','server-1']}, agents [], metrics {completed,mean_wait}, using cumulative completed mean wait. Do not fabricate results: run the Python function for seeds 1,2,3 and both service_time 2 and 3, record actual JSON output in results.json. Write /workspace/outputs/candidate.json with exactly {schemaVersion:1,spec,files}. spec is a Riffology model spec: schemaVersion 1, researchQuestion,scope strings, entities/mechanisms/assumptions/limitations string arrays, parameters as above with type/default/minimum/maximum, metrics {completed:{},mean_wait:{}}, execution {entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}. files is an object mapping exactly model/model.py to its complete source, app/requirements.lock to JSON string {schemaVersion:1,packages:{}}, and model/results.json to actual results JSON string. A trusted platform adapter will supply model/run.py; do not add it. Keep every output small. No internet, packages, subagents, secrets, or changes outside /workspace.`,
`Continue the same model. Change only the default service_time from 3 to 2 in the model code and model spec. Preserve the earlier model/results.json bytes and include them unchanged. Run the changed default once with seed 1 and truthfully report it. Write the updated complete candidate.json to /workspace/outputs/candidate.json using the identical three-file schema. Do not claim platform evidence.`,
`Cancellation acceptance probe: in the sandbox run Python time.sleep(45) once, then print 'probe finished'. Do not modify or delete earlier files, make network calls, or spawn agents. The client may cancel this Turn.`,
];
// A literal validated contract removes ambiguity about optional schema fields.
const requestedSpec={schemaVersion:1,researchQuestion:'How does service time affect FCFS waiting?',scope:'Synthetic deterministic single-server queue',entities:['customers','server'],mechanisms:['FCFS service'],assumptions:['Arrival i is seed % 3 + 2*i','One server'],parameters:{customers:{type:'integer',default:5,minimum:1,maximum:20},service_time:{type:'integer',default:3,minimum:1,maximum:5}},metrics:{completed:{},mean_wait:{}},limitations:['Synthetic deterministic arrivals'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
prompts[0]+=' Copy this exact spec JSON, with no extra keys or reformatting of its string values: '+JSON.stringify(requestedSpec);
function save(name,value){writeFileSync(resolve(directory,name),typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});}

export async function checkCandidate(bytes,binding,n){
  if(bytes.length>512*1024)throw Error('candidate-json-too-large');
  const raw=JSON.parse(new TextDecoder().decode(bytes));
  if(raw.schemaVersion!==1||Object.keys(raw).sort().join()!=='files,schemaVersion,spec'||!raw.files||typeof raw.files!=='object'||Object.keys(raw.files).sort().join()!=='app/requirements.lock,model/model.py,model/results.json'||Object.values(raw.files).some(v=>typeof v!=='string'||Buffer.byteLength(v)>128*1024))throw Error('candidate-json-schema');
  const files=Object.fromEntries(Object.entries(raw.files).map(([path,text])=>[path,new TextEncoder().encode(text)]));
  files['model/run.py']=new Uint8Array(readFileSync(resolve(root,'services/browser-preview/runtime/fixtures/run.py')));
  const archive=packageCandidateModel(files,raw.spec),reader=workspaceArchiveReader(archive),index=workspaceFileIndex(archive);
  const manifest={schemaVersion:1,format:'riffology-workspace-ustar',size:archive.length,sha256:hash(archive),files:index.files.filter(e=>e.type==='file').map(e=>({path:e.path,size:e.size,sha256:hash(reader.read([{path:e.path,maxBytes:Math.max(1,e.size)}]).get(e.path))}))};
  const snapshot=await managedCandidateSnapshot(binding,manifest,archive);
  const candidateSource={kind:'saved-turn',identity:binding.identity,revision:{revisionId:`candidate-${n}`,objectKey:`turns/candidate-${n}`,filesSha256:manifest.sha256,sessionSha256:'0'.repeat(64),committedAt:Date.now()}};
  // A resolver check only: this descriptor is not saved as a Revision or
  // represented as an authoritative Run/Evidence receipt.
  const plan=await simulationPlan(candidateSource,archive);
  return {archive,manifest,snapshot,raw,report:{sourceArtifactSha256:hash(bytes),filesSha256:manifest.sha256,modelSpecAccepted:true,executionProfile:plan.executionProfile??null,formalRevisionSaved:false,formalExperimentExecuted:false}};
}

async function main(){
  const recovery=process.argv.includes('--recover');
  const resume=process.argv.includes('--resume-known-candidate-failure');
  if(!process.argv.includes('--execute')&&!recovery){console.log(JSON.stringify({policy:POLICY,paidRequests:0,mode:'preflight-only'}));return;}
  mkdirSync(directory,{recursive:true,mode:0o700});
  const lockPath=resolve(directory,'operator.lock'),lock=openSync(lockPath,'wx',0o600);
  const ledger=new Issue77Ledger(resolve(directory,'ledger.sqlite'));
  if(ledger.summary().attempts!==0&&!recovery&&!resume){ledger.close();closeSync(lock);unlinkSync(lockPath);throw Error('trial-already-started-use-original-recovery');}
  let dispatcher,adapter,transport,store,currentIdentity=null;
  const report=(recovery||resume)&&existsSync(resolve(directory,'report.json'))?JSON.parse(readFileSync(resolve(directory,'report.json'),'utf8')):{schemaVersion:1,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),policy:POLICY,credential:'reused-existing-local-configuration',turns:[],cleanup:{status:'not-created'},productionRouting:false,endToEndAcceptance:false};
  try{
    if(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw Error('live-source-must-be-committed');
    const apiKey=parseEnv(readFileSync('/Users/gaojihe/apps/riffology-cloud-issue73-luna-agents/.env.local','utf8')).OPENAI_API_KEY;
    if(!apiKey)throw Error('configured-key-absent');
    dispatcher=new EnvHttpProxyAgent();
    store=new SqlExecutionBindingStore(ledger.storage);
    transport=new ManagedSdkTransport({apiKey,store,admission:ledger,fetch:(url,init)=>undiciFetch(url,{...init,dispatcher})});
    adapter=new ManagedExecutionAdapter({store,transport});
    if(recovery){
      const last=ledger.db.prepare('SELECT input FROM inputs ORDER BY rowid DESC LIMIT 1').get();
      if(!last)throw Error('no-original-execution');currentIdentity=JSON.parse(last.input).identity;
      const observation=await adapter.observe(currentIdentity),binding=await store.read(currentIdentity);
      report.recovery={at:Date.now(),execution:observation.execution,paidInputs:0};
      if(['completed','failed','cancelled'].includes(observation.execution)){const receipt=await transport.retrieve(binding);await ledger.record(binding,receipt);save('recovered-original-receipt.json',receipt);}
      return;
    }
    if(resume){save('first-attempt-report.json',report);ledger.resumeKnownCandidateFailure(report);report.priorFailure=report.failure;delete report.failure;report.repairSourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}
    else save('freeze.json',{schemaVersion:1,policy:POLICY,sourceCommit:report.sourceCommit,approved:true,authorization:'User confirmed key reuse, delegated independent limits, and accepted the bounded trial with actual-cost uncertainty.',createdAt:new Date().toISOString(),data:'synthetic FCFS only',retention:'download then delete remote Session; private local evidence retained for review; no credentials in artifacts',stops:['delivery-unknown','usage-unknown','cleanup-unconfirmed','deadline','observed-cost-over-hold'],priceSource:'https://developers.openai.com/api/docs/pricing',tokenUpperEstimateRates:{inputUsdPerMillion:0.5,outputUsdPerMillion:1.8},noProductionGateChange:true});
    const ordinalOffset=ledger.summary().attempts,localSession=`issue77-local-session-${ledger.summary().sessions+1}`;
    let previous=null;
    for(let n=1;n<=prompts.length;n++){
      if(ledger.summary().stopped)break;
      const ordinal=ordinalOffset+n;
      const identity={scope:{tenantId:'issue77-synthetic',projectId:'fcfs-capability',workspaceId:'internal-only',workspaceGeneration:1},sessionId:localSession,turnId:`issue77-turn-${ordinal}`,dispatchId:`issue77-dispatch-${ordinal}`,generation:1};
      currentIdentity=identity;
      const started=Date.now(),input={identity,actor:{userId:'issue77-operator',authVersion:1},message:prompts[n-1],base:{workspace:null,session:null}};
      let observation=await adapter.accept(input,previous);
      // Every poll reconstructs the adapter over SQLite, intentionally exercising
      // observer loss without replaying input or relying on in-memory binding.
      let cancelRequested=false;
      while(['running','unknown'].includes(observation.execution)&&Date.now()-started<POLICY.perTurnMs){
        if(n===3&&!cancelRequested&&observation.execution==='running'){observation=await adapter.cancel(identity);cancelRequested=true;}
        else {await pause(2000);observation=await new ManagedExecutionAdapter({store:new SqlExecutionBindingStore(ledger.storage),transport}).observe(identity);}
        if(observation.execution==='unknown'&&Date.now()-started>45_000)break;
      }
      if(['running','unknown'].includes(observation.execution)){
        ledger.stop('execution-outcome-unresolved');
        await adapter.cancel(identity);
        report.turns.push({ordinal,execution:observation.execution,cancelRequested:true});break;
      }
      const binding=await store.read(identity);
      let receipt=await transport.retrieve(binding);
      const usageDeadline=Date.now()+45_000;
      while(receipt.usage===null&&Date.now()<usageDeadline){await pause(3000);receipt=await transport.retrieve(binding);}
      await ledger.record(binding,receipt);
      const result={ordinal,execution:receipt.phase,usage:receipt.usage,sessionHash:hash(binding.remoteSessionId),turnHash:hash(binding.remoteTurnId),cancelRequested};
      save(`turn-${ordinal}-receipt.json`,receipt);
      report.turns.push(result);
      if(n<=2&&receipt.phase==='completed'){
        const artifacts=[];
        for await(const item of transport.client.beta.agents.sessions.artifacts.list(binding.remoteSessionId,{limit:100})){if(artifacts.length>=128)throw Error('artifact-list-limit');artifacts.push(item);}
        const matches=artifacts.filter(a=>a.turn_id===binding.remoteTurnId&&a.path==='/workspace/outputs/candidate.json');
        if(matches.length!==1)throw Error('candidate-artifact-missing-or-ambiguous');
        const bytes=await transport.download(binding,matches[0].id);
        // Preserve even rejected source before validation and remote deletion.
        save(`turn-${ordinal}-artifact.json`,matches[0]);save(`turn-${ordinal}-candidate.json`,bytes);
        const candidate=await checkCandidate(bytes,binding,ordinal);
        save(`turn-${ordinal}-workspace.tar`,candidate.archive);save(`turn-${ordinal}-manifest.json`,candidate.manifest);
        result.candidate=candidate.report;
        if(n===2){const before=JSON.parse(readFileSync(resolve(directory,`turn-${ordinalOffset+1}-candidate.json`),'utf8'));if(before.files['model/results.json']!==candidate.raw.files['model/results.json']||candidate.raw.spec.parameters.service_time.default!==2)throw Error('continuation-contract-mismatch');result.historyPreserved=true;}
      }else if(n<=2){ledger.stop('provider-terminal-failure');break;}
      previous=binding;save('report.json',{...report,budget:ledger.summary()});
    }
  }catch(error){ledger.stop('trial-stopped');report.failure={name:error?.name??'Error',status:Number.isInteger(error?.status)?error.status:null,code:/^[a-z0-9-]+$/.test(error?.message??'')?error.message:'detail-withheld'};}
  finally{
    try{
    if(adapter&&currentIdentity){
      let binding=await store.read(currentIdentity);
      if(binding&&!binding.remoteSessionId){await adapter.observe(currentIdentity);binding=await store.read(currentIdentity);}
      if(binding?.remoteSessionId){
        for(let attempt=0;attempt<3;attempt++){
          report.cleanup=await adapter.deleteSession(currentIdentity);
          if(report.cleanup.status==='remote-deleted'){
            let absent=false;try{await transport.client.beta.agents.sessions.retrieve(binding.remoteSessionId);}catch(error){absent=error?.status===404;}
            report.cleanup.readbackAbsent=absent;if(absent)await ledger.cleaned(binding);else ledger.stop('cleanup-unconfirmed');break;
          }
          await adapter.cancel(currentIdentity);await pause(2000);
        }
        if(report.cleanup.status!=='remote-deleted')ledger.stop('cleanup-unconfirmed');
      }
    }
    }catch{ledger.stop('cleanup-unconfirmed');report.cleanup={status:'pending',nativeFence:null};}
    report.budget=ledger.summary();save('report.json',report);ledger.close();if(dispatcher)await dispatcher.close();closeSync(lock);unlinkSync(lockPath);
    console.log(JSON.stringify({turns:report.turns.map(t=>({ordinal:t.ordinal,execution:t.execution,usageAvailable:t.usage!=null,candidateAccepted:t.candidate?.modelSpecAccepted??false})),cleanup:report.cleanup,budget:report.budget,failure:report.failure??null,productionRouting:false,endToEndAcceptance:false}));
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
