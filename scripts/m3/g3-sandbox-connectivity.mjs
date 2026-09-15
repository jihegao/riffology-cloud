// Diagnostic only: actual Sandbox SDK / local Workerd container connectivity.
// This does not save a model or establish research-loop acceptance.
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=process.cwd(),worker='g3-native-connectivity',out=resolve('.local/g3-connectivity');
await mkdir(out,{recursive:true});
const socketPath=process.env.RIFFOLOGY_DOCKER_SOCKET||execFileSync('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}'],{encoding:'utf8'}).trim();
if(!/^unix:\/\/\/[^\0]+\/docker\.sock$/.test(socketPath))throw Error('invalid-docker-socket');
const image=process.env.G3_SIMULATION_IMAGE||'riffology-g1-mesa:local';
const networkProbe=await readFile(resolve('scripts/m3/g3-network-boundary-probe.py'),'utf8');
const entry=`export {ContainerProxy} from './services/sandbox/classes.ts';export {SimulationSandbox} from './services/simulation/sandbox.ts';
export default {async fetch(req,env){const sandbox=env.SIMULATION_SANDBOX.getByName('g3-connectivity');try{const versions=await sandbox.exec('python3 --version && /opt/riffology/python-mesa/bin/python3 --version');await sandbox.writeFile('/tmp/g3-network-boundary-probe.py',${JSON.stringify(networkProbe)});const boundary=await sandbox.exec('python3 /tmp/g3-network-boundary-probe.py');return Response.json({versions,boundary});}finally{await sandbox.destroy();}}};`;
const bundle=await build({stdin:{contents:entry,resolveDir:root,sourcefile:'g3-connectivity.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},resourcePersistencePath:out,
 containerEngine:{localDocker:{socketPath,containerEgressInterceptorImage:'cloudflare/proxy-everything@sha256:0ef6716c52430096900b150d84a3302057d6cd2319dae7987128c85d0733e3c8'}},
 workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'gateway.mjs',modules:{'gateway.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{SIMULATION_SANDBOX:{type:'durable-object',worker,exportName:'SimulationSandbox'}},exports:{ContainerProxy:{type:'worker'},SimulationSandbox:{type:'durable-object',storage:'sqlite',container:{imageName:image}}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('external-disabled',{status:403})}}}]});
let result;try{await mf.ready;const response=await mf.dispatchFetch('http://g3-connectivity/');const body=await response.json();assert.equal(response.status,200);assert.equal(body.versions.success,true);assert.equal(body.versions.exitCode,0);assert.equal(body.boundary.success,true);assert.equal(body.boundary.exitCode,0);result={status:response.status,body,image,socketPath,imageIdentity:JSON.parse(execFileSync('docker',['image','inspect',image],{encoding:'utf8'}))[0].Id};await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(response.status!==200)process.exitCode=1;}finally{await mf.dispose();}
