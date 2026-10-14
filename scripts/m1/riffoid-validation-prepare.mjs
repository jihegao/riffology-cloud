// Prepare exact module/metadata multipart bytes. Never opens a network channel.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildPacket,verifyCodeReferences} from './riffoid-validation-coordinator.mjs';
import {buildWrite,publicationPhases} from './riffoid-validation-publisher.mjs';
import {hashBytes,hashJSON} from './riffoid-validation-evidence.mjs';
export async function preparePackage(inputPath,outputPath){
  const input=JSON.parse(await readFile(inputPath,'utf8'));const packet=buildPacket(input);await verifyCodeReferences(input,inputPath);
  assert.equal(input.productionAuthorized,false);assert.deepEqual(Object.keys(input.accounts).sort(),['entry','gateway']);
  const prepared=[];
  for(const phase of publicationPhases){
    const p=packet.phases[phase],bytes=await Promise.all(p.modules.map(m=>readFile(resolve(dirname(inputPath),m.path))));
    const requestId=packet.run+'_'+phase;const w=buildWrite(packet,phase,bytes,input.accounts[p.worker],requestId);
    prepared.push({phase,requestId,worker:p.worker,method:w.method,path:w.path,contentType:w.contentType,body:w.body,bodySHA256:hashBytes(w.body),metadataSHA256:p.preparedMetadataSHA256,modulesSHA256:p.modulesSHA256});
  }
  await mkdir(outputPath,{mode:0o700}); // fail if already exists; never overwrite a prior original request/package
  const files=[];
  for(const w of prepared){await writeFile(join(outputPath,w.phase+'.multipart'),w.body,{flag:'wx',mode:0o600});const {body,...record}=w;files.push({...record,bytes:body.length});}
  await writeFile(join(outputPath,'packet.PRIVATE.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx',mode:0o600});
  const manifest={schemaVersion:1,status:'OFFLINE_BYTES_PREPARED_LIVE_READBACK_REQUIRED',packetSHA256:hashJSON(packet),productionAuthorized:false,networkRequestsExecuted:0,files};
  await writeFile(join(outputPath,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{assert.equal(process.argv.length,4,'usage: prepare.mjs input.PRIVATE.json new-output-directory');const m=await preparePackage(resolve(process.argv[2]),resolve(process.argv[3]));process.stdout.write(JSON.stringify({status:m.status,phases:m.files.length,networkRequestsExecuted:0,productionAuthorized:false})+'\n');}
  catch{process.stderr.write('preparation rejected; no network or production action performed\n');process.exitCode=1;}
}
