/** Fixed owner adapter, disabled by the literal owner-bindings module. */
import {mkdtemp} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as root from './owner-bindings.mjs';
import {need,Stop,ownedBytes,pinned,sha,hashJSON,deepFreeze,fresh,current,HEX,REQUEST,ACCOUNT,WORKER,safeCode} from './local-guards.mjs';
import {demandFreshQuiescence,recheckExactQuiescence} from './receipt-on-demand.mjs';
import {loadExistingCredentialVault} from './credential-channel.mjs';
import {getOnlyConnection,collectNativePhysical} from './native-physical.mjs';
import {assertActualLocalMain,recheckActualMainRef} from './actual-main.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url));
const data=async bytes=>JSON.parse(bytes.toString('utf8'));
async function verifiedApi(){
  need(root.sourceManifestReference?.file===join(ROOT,'source-manifest.json'),'fixed-source-manifest-path');
  const raw=await pinned(root.sourceManifestReference,256*1024),own=await data(raw);
  need(own.schema==='riffoid-ir.integrated-publication-sources/v1'&&own.bindingsFile==='owner-bindings.mjs'&&Array.isArray(own.files),'source-manifest-schema');
  // Bindings reference this manifest, so they are sealed separately to avoid
  // a circular hash. Their exact bytes and complete facts are in the intent.
  const bindingsSha256=sha(await ownedBytes(join(ROOT,own.bindingsFile)));
  for(const row of own.files){
    need(typeof row.file==='string'&&!row.file.startsWith('/')&&!row.file.split('/').some(x=>x==='..'||x==='.'),'source-manifest-relative-path');
    await pinned({file:join(ROOT,row.file),bytes:row.bytes,sha256:row.sha256},4*1024*1024);
  }
  const boundary=await import('./core/io-boundary.mjs'),fixed=await import('./core/fixed-target.mjs'),source=await import('./core/load-final-closure.mjs'),native=await import('./core/native-http-transport.mjs'),collector=await import('./core/collect-baseline.mjs'),publisher=await import('./core/publication.mjs'),physicalWire=await import('./native-physical-wire.mjs');
  const helper=own.files.find(x=>x.file==='cf_native_credential.py');need(helper&&HEX.test(helper.sha256),'verified-fixed-credential-helper');
  return {...boundary,...source,...native,...collector,...publisher,...fixed,...physicalWire,helperSha256:helper.sha256,manifestSha256:sha(raw),bindingsSha256};
}
function quiet(){need(!process.env.NODE_DEBUG&&!process.env.SSLKEYLOGFILE&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!process.execArgv.some(x=>/--(?:inspect|trace-tls|tls-keylog)/.test(x))&&!/--(?:inspect|trace-tls|tls-keylog)/.test(process.env.NODE_OPTIONS??''),'quiet-private-owner-runtime');}
async function knownRolloutForPhase(args,facts,store){
  if(!args.rolloutId)return null;need(['after-rollout-project-tools','after-rollout-trusted-pi'].includes(args.phase),'original-rollout-phase-scope');
  const short=args.phase.endsWith('project-tools')?'project-tools':'trusted-pi',appId=short==='project-tools'?'a03156a6-9bf5-43fb-8b7f-a1f5b8d1a650':'a03628c4-f032-461f-a65b-612ccac11a06',raw=await ownedBytes(join(store.directory,short+'-original-rollout.private.bin'),16*1024*1024),ackRaw=await ownedBytes(join(store.directory,'rollout-'+short+'-ack.safe.json'),256*1024),intentRaw=await ownedBytes(join(store.directory,'rollout-'+short+'-intent.safe.json'),256*1024);
  need(sha(raw)===args.rolloutBodySha256&&sha(ackRaw)===args.originalAckSha256,'known-original-rollout-body-and-ack-sha');const body=await data(raw),ack=await data(ackRaw),intent=await data(intentRaw),image=facts.registryByApp?.[appId]?.receipt?.imageReference;
  const expectedBody=Buffer.from(JSON.stringify({description:facts.releaseMessage,kind:'full_auto',strategy:'rolling',step_percentage:100,target_configuration:{image}}));
  need(ack.schema==='riffoid-ir-known-original-ack/v1'&&ack.requestId===REQUEST&&ack.resultId===args.rolloutId&&ack.intentSha256===sha(intentRaw)&&ack.status>=200&&ack.status<300,'known-original-rollout-safe-ack');
  need(intent.schema==='riffoid-ir-original-write-intent/v1'&&intent.requestId===REQUEST&&intent.method==='POST'&&intent.path==='/accounts/'+ACCOUNT+'/containers/applications/'+appId+'/rollouts'&&intent.bodySha256===sha(expectedBody)&&intent.bodyBytes===expectedBody.length,'known-original-rollout-frozen-request-intent');
  need(body.success===true&&body.result?.id===args.rolloutId&&typeof image==='string'&&body.result.target_configuration?.image===image,'known-initial-rollout-full-target-binding');
  return {body,sha256:sha(raw),rolloutId:args.rolloutId,capability:deepFreeze({appId,rolloutId:args.rolloutId,originalAckSha256:sha(ackRaw),originalIntentSha256:sha(intentRaw),initialBodySha256:sha(raw),targetConfiguration:body.result.target_configuration})};
}
function physicalAssessment(value,{facts,phase,native,logical,rolloutId}){
  need(value?.schema==='riffoid-ir.owner-native-release-assessment/v1'&&value.requestId===REQUEST&&value.phase===phase&&value.nativeCaptureSha256===native.reference.sha256&&value.maintenanceResponseSha256===logical.reference.sha256&&value.unknownRequests===false,'root-actual-native-assessment-binding');fresh(value.observedAt);
  for(const key of ['processes','leases'])need(value[key]?.verified===true&&value[key].activeCount===0&&HEX.test(value[key].evidenceSha256??''),'root-distinct-process-and-lease-evidence');
  need(value.physical?.verified===true&&value.physical.vmAndContainerStatesKeptSeparate===true&&HEX.test(value.physical.evidenceSha256??''),'root-distinct-native-physical-evidence');
  if(rolloutId)need(value.rolloutTerminalVerified===true&&value.rolloutId===rolloutId,'root-original-rollout-terminal-assessment');return value;
}
export function preparationStatus(){return {schema:'riffoid-ir.owner-wiring-status/v1',executionEnabled:root.executionEnabled,factsBound:root.facts!==null,receiptStreamBound:root.receiptStream!==null,credentialMode:root.credentialMode,physicalEvaluatorBound:root.evaluatePhysicalRelease!==null,credentialProviderInvoked:false,nativeConnectionConstructed:false,networkRequests:0,cloudWrites:0};}
export async function runBoundOwner(mode,{signal}={}){
  // First branch before source, files, callbacks, auth/provider or network.
  need(root.executionEnabled===true&&root.facts&&mode==='execute','owner-wiring-disabled-before-auth');quiet();
  const facts=deepFreeze(structuredClone(root.facts)),deadline=Math.min(Date.parse(facts.endsAt),Date.parse(root.windowEndsAt),Date.now()+900000);need(Number.isFinite(deadline)&&Date.parse(facts.endsAt)<=Date.parse(root.windowEndsAt),'approved-on-demand-window');current(signal,deadline);let api,vault,native,store,phase='source-preflight';
  try{
    api=await verifiedApi();api.assertExecutionFacts(facts);need(facts.requestId===REQUEST&&root.credentialMode==='existing-wrangler-private-fd','fixed-native-owner-inputs');
    need(typeof root.evaluatePhysicalRelease==='function'&&HEX.test(facts.baselineProjectionSha256??''),'execute-requires-physical-evaluator-and-preservation-baseline');
    const sourceAudit=await pinned(root.sourceAuditReference,4*1024*1024),authority=await pinned(root.authorityEvidenceReference,4*1024*1024);await pinned(root.handoffEvidenceReference,4*1024*1024);
    need(sha(sourceAudit)===facts.finalMain.sourceAuditSha256&&sha(authority)===facts.authority.evidenceSha256,'actual-existing-source-authority-evidence');
    const run=async childSignal=>{
      const options={signal:childSignal,deadline};
      const closure=await api.boundedTask(s=>api.loadFinalClosure(facts,{signal:s,deadline:Math.min(deadline,Date.now()+60000)}),{deadline,maxMs:60000,signal:childSignal});
      const main=await assertActualLocalMain(facts,closure.source,options);
      const logical=await api.boundedTask(s=>demandFreshQuiescence({stream:root.receiptStream,facts,phase:'precredential',signal:s,deadline:Math.min(deadline,Date.now()+90000)}),{deadline,maxMs:90000,signal:childSignal});
      let bootstrap=null;
      fresh(logical.receipt.body.checkedAt);await recheckActualMainRef(facts,options);
      const preflight={schema:'riffoid-ir.native-owner-precredential-preflight/v1',requestId:REQUEST,factsCanonicalSha256:hashJSON(facts),actualMainSha:main.actualMainSha,actualMainTree:main.actualMainTree,sourceAuditSha256:root.sourceAuditReference.sha256,sourceClosureCanonicalSha256:hashJSON(facts.gatewayClosure),authorityEvidenceSha256:root.authorityEvidenceReference.sha256,maintenanceHoldCanonicalSha256:hashJSON(logical.receipt.body.hold),phaseWitnessCanonicalSha256:hashJSON(logical.receipt),logicalReleaseEvidenceSha256:logical.reference.sha256,physicalBoundaryEvidenceSha256:null,verifiedAtUnix:Date.now()/1000};
      need(typeof root.outputDirectory==='string'&&root.outputDirectory.startsWith('/'),'fixed-owner-output-directory');store=await api.privateStore(root.outputDirectory);
      await store.write('owner-wiring-original-intent.safe.json',{schema:'riffoid-ir.owner-wiring-intent/v1',mode,requestId:REQUEST,preparationManifestSha256:api.manifestSha256,bindingsSha256:api.bindingsSha256,factsCanonicalSha256:hashJSON(facts),preflight,preflightCanonicalSha256:hashJSON(preflight),credentialBodyLogged:false,automaticRetry:false});await store.write('actual-local-main.safe.json',main);
      await store.write('precredential-quiescence.private.json',logical.raw);
      await recheckExactQuiescence(logical,{stream:root.receiptStream,facts,signal:childSignal,deadline});
      phase='private-credential-helper';vault=await loadExistingCredentialVault({mode:'collect',facts,preflight,proxy:api.classifiedProxy(root.proxyUrl),helperSha256:api.helperSha256,manifestSha256:api.manifestSha256,signal:childSignal,deadline});await store.write('credential-identity.safe.json',vault.safeMetadata);
      // Auth may outlive the previous receipt. The next phase demands a fresh
      // receipt before any write; do not reject it based on a superseded one.
      await recheckActualMainRef(facts,options);
      native=api.createNativeOwnerConnection({facts,credentialProvider:vault.credentialProvider,proxyUrl:root.proxyUrl});
      // The old collector credential preflight remains read-only. There is no
      // second launcher/auth pass: core writes are fenced by fresh phase proofs.
      let sequence=0;
      const phaseWitness=async args=>{
        const phaseDeadline=Math.min(deadline,Date.now()+110000),scope='phase-'+String(++sequence).padStart(4,'0')+'-'+args.phase;need(/^[a-z][a-z0-9-]{0,65}$/.test(scope),'fixed-phase-artifact-scope');
        await store.write(scope+'-pending.safe.json',{schema:'riffoid-ir.owner-phase-pending/v1',requestId:REQUEST,phase:args.phase,createdAt:new Date().toISOString(),deadlineAt:new Date(phaseDeadline).toISOString(),stream:root.receiptStream,onDemandOperatorReadRequired:true,demandWaitMs:90000,nativeCaptureMs:20000,receiptFreshnessMs:30000,fenceMs:110000});
        await recheckActualMainRef(facts,{signal:args.signal,deadline:phaseDeadline});const q=await api.boundedTask(s=>demandFreshQuiescence({stream:root.receiptStream,facts,phase:args.phase,signal:s,deadline:Math.min(phaseDeadline,Date.now()+90000)}),{deadline:phaseDeadline,maxMs:90000,signal:args.signal});const rollout=await knownRolloutForPhase(args,facts,store),observer=api.createNativeOwnerConnection({facts,credentialProvider:vault.credentialProvider,proxyUrl:root.proxyUrl}),physicalObserver=api.createNativePhysicalConnection({facts,credentialProvider:vault.credentialProvider,proxyUrl:root.proxyUrl,knownOriginalRollout:rollout?.capability??null});
        try{
          const capture=await api.boundedTask(s=>collectNativePhysical({connection:getOnlyConnection(observer),physicalConnection:physicalObserver,originalRollout:rollout?.capability??null,api,store,scope,deadline:Math.min(phaseDeadline,Date.now()+20000),signal:s}),{deadline:phaseDeadline,maxMs:20000,signal:args.signal});
          await recheckExactQuiescence(q,{stream:root.receiptStream,facts,signal:args.signal,deadline:phaseDeadline});for(const item of capture.data.captures)fresh(item.observedAt);
          if(rollout)rollout.fresh=capture.data.byApp[rollout.capability.appId].physicalSupplement.freshOriginalRollout;
          const value=await root.evaluatePhysicalRelease({phase:args.phase,requestId:REQUEST,facts,maintenance:q.receipt,native:capture.data,nativeReference:capture.reference,maintenanceReference:q.reference,priorBootstrap:bootstrap?.data??null,knownOriginalRollout:rollout,signal:args.signal,deadline:phaseDeadline});const assessment=physicalAssessment(value,{facts,phase:args.phase,native:capture,logical:q,rolloutId:args.rolloutId});
          if(args.phase==='before-baseline'){need(bootstrap===null,'one-initial-physical-capture');bootstrap=capture;}
          current(args.signal,phaseDeadline);fresh(q.receipt.body.checkedAt);await store.write(scope+'-root-assessment.private.json',assessment);await store.write(scope+'-quiescence.private.json',q.raw);
          return {schema:'riffoid-ir.live-ir-phase-witness/v1',requestId:REQUEST,phase:args.phase,scope:'new-ir-publication-segment',accountId:ACCOUNT,observedAt:new Date(Math.min(q.receipt.body.checkedAt,Date.parse(capture.data.startedAt),Date.parse(assessment.observedAt))).toISOString(),actualMainSha:facts.finalMain.sha,closureCanonicalSha256:hashJSON(facts.gatewayClosure),authorityEvidenceSha256:facts.authority.evidenceSha256,maintenanceState:q.receipt.body,productLogicalReleaseVerified:true,processLeaseReleaseVerified:true,physicalBoundaryVerified:true,unknownRequests:false,logicalReleaseEvidenceSha256:q.reference.sha256,physicalBoundaryEvidenceSha256:hashJSON(assessment),...(args.rolloutId?{rolloutTerminalVerified:assessment.rolloutTerminalVerified,rolloutId:assessment.rolloutId,explainedLifecycleChanges:assessment.explainedLifecycleChanges??{}}:{})};
        }finally{physicalObserver.close();observer.close();}
      };
      const independentWitness=async args=>{
        // Re-read everything with a separate connection/store. The expected
        // projection argument is deliberately never used to construct a result.
        const observer=api.createNativeOwnerConnection({facts,credentialProvider:vault.credentialProvider,proxyUrl:root.proxyUrl}),directory=join(await mkdtemp(join(dirname(store.directory),'owner-independent-')),'private'),witnessStore=await api.privateStore(directory);
        try{const captured=await api.collectBaseline({connection:getOnlyConnection(observer),store:witnessStore,scope:'independent',deadline,signal:args.signal});need(Date.parse(captured.snapshot.startedAt)>=Date.parse(args.afterOriginalAck),'independent-get-starts-after-original-ack');return {schema:'riffoid-ir.independent-full-readback/v1',requestId:REQUEST,phase:args.phase,accountId:ACCOUNT,worker:WORKER,onlyGet:true,complete:true,projectionCanonicalSha256:hashJSON(api.preservationProjection(captured.snapshot)),captureSha256:captured.safe.privateArtifact.sha256,startedAt:captured.snapshot.startedAt,endedAt:captured.snapshot.endedAt};}finally{observer.close();}
      };
      phase='original-publication';return api.runPublication({facts,connection:native,phaseWitness,independentWitness,store,signal:childSignal});
    };
    return await api.boundedTask(run,{deadline,maxMs:900000,signal});
  }catch(error){const code=error instanceof Stop?error.code:api&&error instanceof api.GuardError&&/^[a-z0-9-]+$/.test(error.code)?error.code:'owner-wiring-stopped';if(store)await store.write('owner-wiring-stopped.safe.json',{schema:'riffoid-ir.owner-wiring-stopped/v1',requestId:REQUEST,mode,phase,code,automaticRetry:false,credentialBodyLogged:false,maintenanceEndPerformed:false});throw new Stop(code);}
  finally{native?.close();vault?.close();}
}
