import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const directory='.local/riffoid-approved-20261008';
await mkdir(directory,{recursive:true});
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const candidates=[
 {name:'entry',source:'services/entry/index.ts',date:'2026-09-06',flags:['global_fetch_strictly_public','enable_request_signal']},
 {name:'gateway',source:'services/gateway/index.ts',date:'2026-09-09',flags:['nodejs_compat','nodejs_compat_do_not_populate_process_env','enable_request_signal']},
 {name:'execution',source:'services/browser-preview/execution/index.ts',date:'2026-09-05',flags:['nodejs_compat','nodejs_compat_do_not_populate_process_env']},
 {name:'forward-rollback',source:'services/gateway/forward-rollback.ts',date:'2026-09-09',flags:['nodejs_compat','nodejs_compat_do_not_populate_process_env','enable_request_signal']}
];
const artifacts=[];
for(const candidate of candidates){
 const result=await build({entryPoints:[candidate.source],bundle:true,write:false,metafile:true,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const bytes=result.outputFiles[0].contents;
 const file=candidate.name+'.worker.mjs';
 await writeFile(directory+'/'+file,bytes);
 artifacts.push({...candidate,file,bytes:bytes.length,sha256:sha256(bytes),exports:Object.values(result.metafile.outputs)[0].exports.sort()});
}
const config={name:'riffoid-entry',account_id:'3232ebc7e9bb0199b92e3d70b07825af',main:'./entry.worker.mjs',no_bundle:true,compatibility_date:'2026-09-06',compatibility_flags:['global_fetch_strictly_public','enable_request_signal'],workers_dev:false,preview_urls:false,vars:{APP_ORIGIN:'https://app.riffoid.com',APP_TRANSPORT_ORIGIN:'https://riffoid-transport.gaojihe.cn',TWO_ACCOUNT_AUTH_MODE:'disabled',ENTRY_SIGNING_KEY_ID:'riffoid-entry-20261008-a'}};
// Deliberately no domain route, native-IP ACK, Secret or resources in the
// disabled bootstrap config. Approved later console steps add these exactly.
const configBytes=JSON.stringify(config,null,2)+'\n';
await writeFile(directory+'/entry.disabled.json',configBytes);
const manifest={status:'CODE_FROZEN_CONFIGURATION_PENDING_NOT_READY_TO_CUTOVER',authorization:'User 2026-10-08T12:33:01Z Sentinel_d74bc92248288191a1631d8044d57811; approval packet a0ab4881d585831d0b0d7e220d69632c681a8c46',sourceCommit,artifacts,entryBootstrap:{file:'entry.disabled.json',sha256:sha256(configBytes),mode:'disabled',privateKeyIncluded:false,domainBindingIncluded:false,nativeIpAckIncluded:false},gatewayAndRollbackExportsEqual:JSON.stringify(artifacts.find(x=>x.name==='gateway').exports)===JSON.stringify(artifacts.find(x=>x.name==='forward-rollback').exports),replayNamespaceId:null,migrationHistory:null,publicPin:null,productionConfigurationSnapshots:null,productionAssetsHashes:null,liveReadback:'Separate authenticated metadata step; never inferred from repository templates',platformAcceptance:'not run',productionChanges:false};
if(!manifest.gatewayAndRollbackExportsEqual)throw Error('Gateway/forward rollback exports differ');
await writeFile(directory+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({directory,...manifest}));
