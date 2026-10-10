import {readFileSync} from 'node:fs';
import {buildPacket} from '../../../scripts/m1/riffoid-validation-coordinator.mjs';
import {hashBytes,stateMetadata,expectedBody} from '../../../scripts/m1/riffoid-validation-evidence.mjs';
export const shapes=JSON.parse(readFileSync(new URL('./riffoid-public-api-shapes.json',import.meta.url),'utf8'));
export const start=2_000_000_000_000;
export function inputFixture(){
  const module=name=>({name,path:name,bytes:Buffer.byteLength(shapes.sourceBytes[name]),sha256:hashBytes(shapes.sourceBytes[name])});
  const baselines={};
  for(const w of ['entry','gateway']){
    const metadata=structuredClone(shapes.settings.result);
    Object.assign(metadata,{main_module:w+'.mjs',containers:[{name:'fixture-existing-container'}],keep_assets:true});
    metadata.bindings=[{name:'APP_ORIGIN',type:'plain_text',text:'https://old.example.test'},
      {name:'TWO_ACCOUNT_AUTH_MODE',type:'plain_text',text:'disabled'},
      {name:'ENTRY_SIGNING_PRIVATE_JWK',type:'secret_key',algorithm:{name:'Ed25519'},format:'jwk',usages:['sign']},
      {name:'ENTRY_REPLAY',type:'durable_object_namespace',namespace_id:'fixture-existing-replay'}];
    metadata.exports=w==='gateway'?{EntryReplayGuard:{type:'durable-object',storage:'sqlite'},Existing:{type:'durable-object',storage:'sqlite'}}:{};
    baselines[w]={worker:'fixture-'+w,version:w+'-v0',deployment:w+'-d0',snapshotSHA256:'b'.repeat(64),metadata,modules:[module(w+'.mjs')]};
  }
  return {config:{version:1,run:'offline_fixture_fixed_run_20261009',notBefore:start,expires:start+300000,ips:{A:'198.51.100.23',B:'198.51.100.24'}},baselines,
    validation:{entry:{main_module:'entry-validation.mjs',modules:[module('entry-validation.mjs')]},gateway:{main_module:'gateway-validation.mjs',exports:baselines.gateway.metadata.exports,modules:[module('gateway-validation.mjs')]}}};
}
export const packetFixture=()=>buildPacket(inputFixture());
export const moduleBytes=phase=>phase.modules.map(m=>Buffer.from(shapes.sourceBytes[m.name]));
export function deploymentFixture(identity){const r=structuredClone(shapes.deploymentList);r.result.deployments[0].id=identity.deployment;r.result.deployments[0].versions[0].version_id=identity.version;return r;}
export function contentFixture(phase){return {status:200,bodyEncoding:'base64',contentType:'application/javascript+module',body:moduleBytes(phase)[0].toString('base64')};}
export function readbackFixture(packet,phaseId,prior){
  const phase=packet.phases[phaseId],identity={version:phaseId+'-version',deployment:phaseId+'-deployment'},settings={success:true,result:stateMetadata(phase.metadata)};
  const version=structuredClone(shapes.version);version.result.id=identity.version;version.result.resources.bindings=structuredClone(settings.result.bindings);
  for(const field of ['compatibility_date','compatibility_flags','exports'])version.result.resources.script_runtime[field]=structuredClone(settings.result[field]);
  const latestVersions=structuredClone(shapes.versionList);latestVersions.result.items[0].id=identity.version;
  const globals={success:true,result:Object.fromEntries(['observability','logpush','tail_consumers'].map(k=>[k,structuredClone(settings.result[k])]))};
  return {beforeDeployment:deploymentFixture(prior),afterDeployment:deploymentFixture(identity),afterDeploymentAgain:deploymentFixture(identity),version,latestVersions,
    scriptAndVersionSettings:settings,scriptAndVersionSettingsAgain:structuredClone(settings),scriptSettings:globals,scriptSettingsAgain:structuredClone(globals),content:contentFixture(phase)};
}
export function stepFixture(p,publisher,phase,index=publisher.cursor){
  const worker=p.phases[phase].worker,prior=publisher.current[worker],artifact=publisher.artifacts[worker];
  return {phase,requestId:phase+'-request',startedAt:start-1000+index*100,readbackAt:start-950+index*100,outcome:'acknowledged',moduleBytes:moduleBytes(p.phases[phase]),
    preflight:{deployment:deploymentFixture(prior),latestVersions:{success:true,result:{items:[{id:prior.version}]}},settings:{success:true,result:stateMetadata(artifact.metadata)},content:contentFixture(artifact)},readback:readbackFixture(p,phase,prior)};
}
export function protocolRows(p){
  return [['A','observe',1000,2000],['B','observe',2000,3000],['B','run',10000,12000],['A','run',10000,45000],['A','cleanup',300001,301000]].map(([slot,operation,a,b])=>({
    requestId:slot+'-'+operation,run:p.run,slot,operation,startedAt:start+a,receivedAt:start+b,outcome:'response',response:{status:200,body:JSON.stringify(expectedBody(slot,operation))}}));
}
export const terminalContext={markerAt:start+5000,cueAt:start+9000,stopAt:start+300000,versions:{entry:{version:'entryReady-version',deployment:'entryReady-deployment'},gateway:{version:'gatewayObserve-version',deployment:'gatewayObserve-deployment'}}};
