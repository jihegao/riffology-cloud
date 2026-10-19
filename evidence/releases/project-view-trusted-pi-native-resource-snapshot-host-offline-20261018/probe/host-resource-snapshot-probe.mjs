import assert from 'node:assert/strict';
import {readFile,writeFile,lstat,realpath,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const SCHEMA='trusted-pi-native-resource-snapshot-host-probe/v1',REQUEST='695e8875-459a-41b3-a148-2e228f2c3727';
const hash=value=>createHash('sha256').update(value).digest('hex');
let stage='preflight',mode='unknown',directory=null,timer,originalFetch=globalThis.fetch,sourceMacEncodingNormalized=false;
let model=0,research=0,projectToolExecutions=0,ambientFetch=0,sessionCreations=0,sessionDisposals=0;
const live=new Set(),startedAt=new Date().toISOString();
try{
 const values={},args=process.argv.slice(2);
 assert.equal(args.length%2,0);
 for(let i=0;i<args.length;i+=2){assert(['--source-root','--manifest','--manifest-sha256'].includes(args[i])&&typeof args[i+1]==='string'&&!Object.hasOwn(values,args[i]));values[args[i]]=args[i+1];}
 assert(typeof values['--manifest']==='string'&&/^[a-f0-9]{64}$/.test(values['--manifest-sha256']??''));
 mode=values['--source-root']?'source-equivalence':'image';
 const version=process.versions.node.split('.').map(Number);assert(version[0]>22||version[0]===22&&version[1]>=19);
 const root=await realpath(values['--source-root']??'/opt/riffology'),manifestPath=resolve(values['--manifest']);
 const info=await lstat(manifestPath);assert(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=65536);
 const raw=await readFile(manifestPath);assert(hash(raw)===values['--manifest-sha256']);const manifest=JSON.parse(raw);
 assert(manifest.schema==='trusted-pi-native-resource-snapshot-host-input/v1'&&manifest.requestId===REQUEST&&manifest.overlayTargetCount===1&&manifest.fileTargets.length===12);
 assert.deepEqual(manifest.fileTargets.filter(x=>x.overlay===true).map(x=>x.imagePath),['trusted-pi/trusted-pi-turn-host.mjs']);
 for(const target of manifest.fileTargets)assert(target.overlay===(target.imagePath==='trusted-pi/trusted-pi-turn-host.mjs')&&target.role===(target.overlay?'overlay-native-host':'retained-image-input'));
 sourceMacEncodingNormalized=mode==='source-equivalence'&&process.platform==='darwin'&&Object.hasOwn(process.env,'__CF_USER_TEXT_ENCODING');
 if(sourceMacEncodingNormalized)delete process.env.__CF_USER_TEXT_ENCODING;
 assert.deepEqual(Object.keys(process.env),['PATH']);
 if(mode==='image'){
  assert.equal(root,'/opt/riffology');assert.equal(process.getuid(),10002);assert.equal(process.getgid(),10002);
  const status=await readFile('/proc/self/status','utf8');
  for(const cap of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])assert(new RegExp('^'+cap+':\\s+0+$','m').test(status));
 }
 const names=new Set(),imageTargets=[];
 for(const target of manifest.fileTargets){
  assert(typeof target.imagePath==='string'&&!names.has(target.imagePath));names.add(target.imagePath);
  const logical=mode==='image'?target.imagePath:target.sourcePath;assert(typeof logical==='string'&&!logical.startsWith('/')&&!logical.split('/').some(p=>!p||p==='.'||p==='..'));
  const path=resolve(root,logical),stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===target.bytes&&stat.size<=1048576);assert((await realpath(path)).startsWith(root+sep));
  if(mode==='image')assert(stat.uid===0&&stat.gid===0&&(stat.mode&0o777)===parseInt(target.modeOctal,8));
  const bytes=await readFile(path);assert.equal(hash(bytes),target.sha256);
  imageTargets.push({imagePath:target.imagePath,bytes:bytes.length,sha256:hash(bytes)});
 }
 const localPath=imagePath=>{const target=manifest.fileTargets.find(x=>x.imagePath===imagePath);assert(target);return resolve(root,mode==='image'?imagePath:target.sourcePath);};
 assert((await readFile(localPath('trusted-pi/trusted-pi-release.mjs'))).equals(await readFile(localPath('trusted-pi/release-candidate.mjs'))));
 for(const name of ['@earendil-works/pi-coding-agent','@earendil-works/pi-server'])assert.equal(JSON.parse(await readFile(resolve(root,'node_modules',name,'package.json'),'utf8')).version,'0.85.0');
 globalThis.fetch=async()=>{ambientFetch++;throw Error('ambient-network-denied');};
 timer=setTimeout(()=>{process.stderr.write(JSON.stringify({schema:SCHEMA,requestId:REQUEST,mode,result:'failed',code:'probe-wall-timeout',stage})+'\n');process.exit(1);},20000);
 stage='imports';
 const {runTrustedPiTurnHost}=await import(pathToFileURL(localPath('trusted-pi/trusted-pi-turn-host.mjs')).href);
 const {createControlledPiSession}=await import(pathToFileURL(localPath('runtime/controlled-pi.mjs')).href);
 const {freezeProjectResources}=await import(pathToFileURL(localPath('project-resources/text.mjs')).href);
 const {createProductTrustedPiRelease,PRODUCT_PI_MODEL,PRODUCT_PI_PROVIDER}=await import(pathToFileURL(localPath('trusted-pi/trusted-pi-release.mjs')).href);
 assert.equal(PRODUCT_PI_MODEL,'gpt-5.6-luna');assert.equal(PRODUCT_PI_PROVIDER,'riffology-product');
 directory=await mkdtemp(join(tmpdir(),'trusted-pi-host-snapshot-'));
 const scope={tenantId:'offline-tenant',projectId:'offline-project',workspaceId:'offline-workspace',workspaceGeneration:1},actor={userId:'offline-user',authVersion:1};
 const resourceScope={tenantId:scope.tenantId,projectId:scope.projectId},sessionId='offline-session';
 const selectedPath='.pi/skills/host-pages/SKILL.md',marker='OFFLINE_NATIVE_HOST_RESOURCE_BODY';
 const resources=freezeProjectResources({scope,revisionId:'offline-revision-v1',filesSha256:'a'.repeat(64),files:[{path:'AGENTS.md',content:'Synthetic offline project instructions.'},{path:selectedPath,content:'---\nname: host-pages\ndescription: Offline native host guidance\n---\n'+marker+': create local pages; $ARGUMENTS'}]});
 const plain={format:'riffology-pi-session-v1',scope:{...resourceScope,sessionId},createdAt:'2026-10-18T00:00:00.000Z',entries:[],leafId:null};
 let coldRestoreObserved=false;
 async function hostTurn(name,{input=null,withResources=true,message='Synthetic offline host fixture.',rejectCode=null,cold=false}={}){
  const identity={scope,sessionId,turnId:'offline-'+name,dispatchId:'dispatch-'+name,generation:1};
  const token=hash(JSON.stringify({schemaVersion:1,purpose:'trusted-pi-native',identity})).slice(0,52),prefix=join(directory,token);
  const inputBytes=input===null?null:Buffer.from(JSON.stringify(input));
  await writeFile(prefix+'.control.json',JSON.stringify({schemaVersion:2,identity,actor,message,inputSessionSha256:inputBytes===null?null:hash(inputBytes),executionDeadlineAt:Date.now()+15000}),{mode:0o600,flag:'wx'});
  if(inputBytes!==null)await writeFile(prefix+'.input-session.json',inputBytes,{mode:0o600,flag:'wx'});
  const modelFetch=async(url,init)=>{
   model++;assert.equal(String(url),'https://model-proxy.riffology.internal/v1/responses');assert.equal(init.method,'POST');assert.equal(new Headers(init.headers).has('authorization'),false);
   const envelope=JSON.parse(init.body);assert.deepEqual(envelope.identity,identity);assert.deepEqual(envelope.actor,actor);
   if(name==='resources')assert(JSON.stringify(envelope.payload).includes(marker));
   const item={type:'message',id:'msg-mock-'+model,role:'assistant',status:'completed',content:[{type:'output_text',text:'Synthetic offline completion.',annotations:[]}]};
   const rows=[{type:'response.created',response:{id:'resp-mock-'+model}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp-mock-'+model,status:'completed',output:[item],usage:{input_tokens:40,output_tokens:16,total_tokens:56,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}}];
   return new Response(rows.map(x=>'data: '+JSON.stringify(x)+'\n\n').join(''),{headers:{'content-type':'text/event-stream','x-request-id':'offline-fixture'}});
  };
  const toolFetch=async(url,init)=>{
   const req=new Request(url,init);if(req.url!=='https://tool-bridge.riffology.internal/v1/research'){projectToolExecutions++;throw Error('project-tools-forbidden-in-mock');}
   research++;assert.equal(req.method,'POST');assert.equal(req.headers.has('authorization'),false);assert.deepEqual((await req.json()).identity,identity);
   return Response.json({model:{spec:null},experiments:[],projectResources:resources});
  };
  const actualRelease=createProductTrustedPiRelease({modelFetch,toolFetch});
  const release={async resolveOptions(value){const fixed=await actualRelease.resolveOptions(value);assert.deepEqual(fixed.fixedSkills,[]);return withResources?fixed:{...fixed,projectResources:undefined};}};
  const counts={model,research,sessionCreations};
  const createSession=async options=>{
   const before=model,h=await createControlledPiSession(options);sessionCreations++;live.add(h);assert.equal(model,before);
   if(cold){const saved=h.snapshot().resources.resources.find(x=>x.path===selectedPath);assert(saved.loaded&&saved.loadedFromHistory);coldRestoreObserved=true;}
   return {...h,async dispose(){if(live.delete(h)){sessionDisposals++;await h.dispose();}}};
  };
  let result,error=null;try{result=await runTrustedPiTurnHost(token,release,{controlRoot:directory,trustedCwd:directory,createSession});}catch(e){error=e;}
  if(rejectCode){assert(error&&error.message===rejectCode);assert.deepEqual({model,research,sessionCreations},counts);await assert.rejects(readFile(prefix+'.output-session.json'),{code:'ENOENT'});return null;}
  assert.equal(error,null);assert.equal(result.outcome,'completed');
  const bytes=Buffer.from(await readFile(prefix+'.output-session.json','utf8'),'base64');assert.equal(hash(bytes),result.outputSessionSha256);
  const terminal=JSON.parse(await readFile(prefix+'.result.json','utf8'));assert.equal(terminal.phase,'terminal');assert.equal(terminal.outputSessionSha256,hash(bytes));
  return JSON.parse(bytes);
 }
 stage='fixture-legacy';const legacy=await hostTurn('legacy',{input:plain,withResources:false});assert.deepEqual(Object.keys(legacy).sort(),['createdAt','entries','format','leafId','scope']);
 stage='fixture-resources';const frozen=await hostTurn('resources',{message:'/skill:host-pages EXPLICIT_OFFLINE_ARGUMENT'});assert(frozen.resources.resources.find(x=>x.path===selectedPath).loaded);
 stage='fixture-restore';const restored=await hostTurn('restore',{input:frozen,cold:true});assert(restored.resources.resources.find(x=>x.path===selectedPath).loadedFromHistory);assert(coldRestoreObserved);
 stage='fixture-negative';
 await hostTurn('unknown-root',{input:{...frozen,unexpected:true},rejectCode:'invalid-trusted-pi-session-file'});
 await hostTurn('invalid-provenance',{input:{...frozen,resources:{...frozen.resources,resources:frozen.resources.resources.map(x=>({...x,loaded:'invalid'}))}},rejectCode:'project-resource-provenance-invalid'});
 await hostTurn('foreign-scope',{input:{...frozen,resources:{...frozen.resources,scope:{...frozen.resources.scope,projectId:'offline-other-project'}}},rejectCode:'project-resource-provenance-invalid'});
 assert.deepEqual({model,research,projectToolExecutions,ambientFetch,sessionCreations,sessionDisposals},{model:3,research:3,projectToolExecutions:0,ambientFetch:0,sessionCreations:3,sessionDisposals:3});assert.equal(live.size,0);
 stage='cleanup';await rm(directory,{recursive:true,force:true});directory=null;clearTimeout(timer);
 process.stdout.write(JSON.stringify({schema:SCHEMA,requestId:REQUEST,startedAt,endedAt:new Date().toISOString(),mode,result:'passed',manifestSha256:hash(raw),checkedTargets:12,overlayTargets:1,imageTargets,nodeVersion:process.versions.node,uid:process.getuid?.()??null,gid:process.getgid?.()??null,sourceMacEncodingNormalized,checks:{allTargetBytesAndPermissions:true,activeReleaseAlias:true,actualNativeHostAndControlledFacade:true,validResourceTerminalAndDigest:true,coldRestoreMetadataAndNoReplay:true,legacyFiveFieldInputAndOutput:true,unknownRootRejectedBeforeSession:true,invalidProvenanceRejectedBeforeSession:true,foreignScopeRejectedBeforeSession:true,allSessionsDisposed:true,temporaryDirectoriesRemoved:true,environmentOnlyPath:true,zeroAmbientFetch:true,zeroProjectToolExecutions:true},syntheticRequests:{model,research,projectToolExecutions,ambientFetch,sessionCreations,sessionDisposals},realProviderRequests:0,credentialsReadByProbe:false,limitations:['Source equivalence is not image or target acceptance.','Synthetic host/model transports do not prove native supervisor/capacity release or actual project_write behavior.','One future network-none container mock does not authorize Cloudflare rollout, a real Turn or reuse of original acceptance requests.']})+'\n');
}catch(error){process.stderr.write(JSON.stringify({schema:SCHEMA,requestId:REQUEST,mode,result:'failed',code:'probe-check-failed',stage,errorClass:['ERR_ASSERTION','ENOENT','EACCES'].includes(error?.code)?error.code:'fixed-probe-error'})+'\n');process.exitCode=1;}
finally{clearTimeout(timer);for(const h of live)await h.dispose().catch(()=>{});if(directory)await rm(directory,{recursive:true,force:true});globalThis.fetch=originalFetch;}
