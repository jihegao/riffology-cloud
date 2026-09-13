import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const pinned=value=>typeof value==='string'&&/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(value);
/** Produce a reviewable candidate; never deploy or silently open admission. */
export function phase1Config(base,{simulationImage,trustedPiImage}){
 if(!pinned(simulationImage)||!pinned(trustedPiImage))throw Error('phase1-images-must-be-pinned');
 const config=structuredClone(base);
 if(!config.durable_objects?.bindings||!config.containers||!config.exports||!config.vars)throw Error('phase1-base-config-invalid');
 const trusted=config.containers.find(c=>c.class_name==='TrustedPiSandbox');if(!trusted)throw Error('phase1-trusted-pi-missing');trusted.image=trustedPiImage;
 const name='riffology-phase1-simulation';
 config.durable_objects.bindings=config.durable_objects.bindings.filter(b=>b.name!=='SIMULATION_SANDBOX');config.durable_objects.bindings.push({name:'SIMULATION_SANDBOX',class_name:'SimulationSandbox'});
 config.containers=config.containers.filter(c=>c.class_name!=='SimulationSandbox');config.containers.push({name,class_name:'SimulationSandbox',image:simulationImage,instance_type:'basic',max_instances:1});
 config.exports.SimulationSandbox={type:'durable-object',storage:'sqlite',container:name};
 Object.assign(config.vars,{M4_SIMULATION_ENABLED:'false',M4_SIMULATION_IMAGE:simulationImage,M2_TURNS_ENABLED:'false',M3_SERVICE_ENABLED:'false',M3_PREVIEW_ENABLED:'false',PHASE1_RELEASE_PROFILE:'isolated-acceptance'});
 // A live Preview and a finite simulation require distinct quota slots. Never
 // rewrite an existing ledger implicitly; explicit migration is a release step.
 config.vars.TENANT_QUOTA_CAPACITY='2';
 config.vars.TENANT_QUOTA_POLICY_VERSION='phase1-preview-simulation-v1';
 config.vars.TENANT_QUOTA_UPGRADE_FROM=base.vars.TENANT_QUOTA_POLICY_VERSION;
 return config;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [basePath,simulationImage,trustedPiImage,output]=process.argv.slice(2);if(!basePath||!output)throw Error('usage: phase1-config.mjs BASE_JSON SIMULATION_IMAGE TRUSTED_PI_IMAGE OUTPUT_JSON');
 writeFileSync(output,JSON.stringify(phase1Config(JSON.parse(readFileSync(basePath,'utf8')),{simulationImage,trustedPiImage}),null,2)+'\n');
}
