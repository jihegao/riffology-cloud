// Local synthetic acceptance only. No production route or credentials.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {runPrototype,dockerRunner} from './project-view-offline-prototype.mjs';
import {projectViewBrowserProbe} from './project-view-browser-probe.mjs';

const [image,outputArg]=process.argv.slice(2);
if(!image||!outputArg||process.argv.length!==4)throw Error('usage: node project-view-browser-chain.mjs sha256:IMAGE new-output-directory');
const output=resolve(outputArg),policy=resolve('scripts/m3/offline-view/chromium-userns-seccomp.json');
const policyBytes=await readFile(policy),policySha256=createHash('sha256').update(policyBytes).digest('hex');
if(policySha256!=='4cdcdc07d9676737fa78222a8fffeda5cd0ebd2b209c82fafd2077d051d30ae2')throw Error('unreviewed-seccomp-profile');
await mkdir(output,{recursive:true});
const requests=[],nonce=randomUUID();
const server=createServer((req,res)=>{requests.push({url:req.url,method:req.method});req.resume();res.writeHead(200,{'Access-Control-Allow-Origin':'*'});res.end('synthetic collector');});
await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
const collectorUrl=`http://127.0.0.1:${server.address().port}`;
let probe,inspection,prototype;
let actualInputSha256,actualProgramSha256;
try{
 await fetch(collectorUrl+'/positive-before-'+nonce,{signal:AbortSignal.timeout(3000)}).then(r=>r.text());
 const runner=async(args,options)=>{
  if(args[2]==='run'){
   args=[...args];args.splice(args.indexOf('--network=none'),0,'--cpuset-cpus=0,1','--security-opt','seccomp='+policy);
   args[args.length-1]='await ('+projectViewBrowserProbe.toString()+')();';
   const actualInput=JSON.stringify({schema:'riffology.offline-browser-probe-input/v1',collectorUrl,operationId:nonce});
   actualInputSha256=createHash('sha256').update(actualInput).digest('hex');actualProgramSha256=createHash('sha256').update(args.at(-1)).digest('hex');
   await writeFile(resolve(output,'actual-input-identity.json'),JSON.stringify({actualInputSha256,actualProgramSha256,policySha256})+'\n',{flag:'wx'});
   const result=await dockerRunner(args,{...options,timeout:55000,input:actualInput});
   await writeFile(resolve(output,'browser-stderr.log'),result.stderr??'',{flag:'wx'});
   if(result.stdout?.trim()){probe=JSON.parse(result.stdout);await writeFile(resolve(output,'browser-result.json'),JSON.stringify(probe,null,2)+'\n',{flag:'wx'});}
   return result;
  }
  const result=await dockerRunner(args,options);
  if(args[2]==='container'&&args[3]==='inspect'&&result.status===0){const raw=JSON.parse(result.stdout);inspection={User:raw.Config.User,Id:raw.Id,Image:raw.Image,State:raw.State,HostConfig:raw.HostConfig,Mounts:raw.Mounts,NetworkSettings:raw.NetworkSettings};}
  return result;
 };
 prototype=await runPrototype({image,output,runner});
 await fetch(collectorUrl+'/positive-after-'+nonce,{signal:AbortSignal.timeout(3000)}).then(r=>r.text());
 const controls=requests.filter(r=>r.url==='/positive-before-'+nonce||r.url==='/positive-after-'+nonce);
 const leaks=requests.filter(r=>!controls.includes(r));
 const hc=inspection?.HostConfig;
 const policyObserved=inspection?.User==='10001:10001'&&!(hc?.CapAdd?.length)&&hc?.IpcMode!=='host'&&hc?.PidMode!=='host'&&!Object.keys(hc?.PortBindings??{}).length&&hc?.SecurityOpt?.some(x=>x.startsWith('seccomp=')&&JSON.stringify(JSON.parse(x.slice(8)))===JSON.stringify(JSON.parse(policyBytes)))&&hc?.CpusetCpus==='0,1'&&hc.NanoCpus===1000000000&&hc.NetworkMode==='none'&&hc.ReadonlyRootfs===true&&hc.Privileged===false&&hc.CapDrop?.includes('ALL')&&hc.Memory===805306368&&hc.PidsLimit===128&&hc.SecurityOpt?.some(x=>x.startsWith('no-new-privileges'))&&(inspection?.Mounts?.length??-1)===0;
 const evidence={actualInputSha256,actualProgramSha256,prototypeFixtureNote:'prototype.fixtureSha256 identifies the original injected-runner harness fixture, replaced here; actual-input-identity.json is the durable identity of the executed input/program.',policyObserved,schema:'riffology.offline-browser-chain/v1',date:new Date().toISOString(),image,policySha256,productionEligible:false,userUiEligible:false,prototype,inspection,requests,positiveControls:controls.length,receivedPageRequests:leaks.length,browserProbe:probe?{...probe,frames:undefined}:null,status:'pending'};
 evidence.status=policyObserved&&prototype.status==='local-experiment-passed'&&controls.length===2&&leaks.length===0&&probe?.browserProbe?.status==='synthetic-network-attempts-blocked'&&['PID namespaces\tYes','Network namespaces\tYes','Seccomp-BPF sandbox\tYes'].every(text=>probe.browserProbe.sandboxText?.includes(text))?'local-chain-passed':'blocked';
 await writeFile(resolve(output,'chain-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:evidence.status,output,cleanupConfirmed:prototype.cleanupConfirmed}));
 if(evidence.status!=='local-chain-passed')process.exitCode=1;
}finally{await new Promise(r=>server.close(r));}
