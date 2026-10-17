/** This function is serialized into a fixed native Node program. Keep every
 * dependency inside it and use fixed local module names, so the Worker bundle
 * never resolves the native imports. No project input is accepted here. */
export async function projectViewPreflightMain(options={}){
 const fsModule='node:fs/promises',pathModule='node:path',cryptoModule='node:crypto',childModule='node:child_process';
 const fs=await import(fsModule),path=await import(pathModule),{createHash}=await import(cryptoModule);
 const deny=()=>{throw Error('project-view-runtime-preflight-denied');},sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const pin=options.expectedReceiptSha256??process.argv[1],root=options.root??'/opt/viewer';
 if(typeof pin!=='string'||! /^[a-f0-9]{64}$/.test(pin)||typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root)deny();
 const own=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
 const info=options.processInfo??{platform:process.platform,arch:process.arch,uid:process.getuid?.(),gid:process.getgid?.(),euid:process.geteuid?.(),egid:process.getegid?.(),status:null};
 if(info.platform!=='linux'||info.arch!=='x64'||[info.uid,info.gid,info.euid,info.egid].some(value=>value!==10001))deny();
 const environment=options.environment??process.env;
 if(!own(environment,['PATH'])||typeof environment.PATH!=='string'||environment.PATH.length>1024||environment.PATH.split(':').some(part=>! /^\/[A-Za-z0-9_./-]+$/.test(part)||part.split('/').some(segment=>segment==='.'||segment==='..')))deny();
 async function boundedFile(filename,limit,staticSize=true){
  // Reject links in every ancestor as well as the leaf. These root-owned image
  // inputs are read before any untrusted page starts; O_NOFOLLOW closes the
  // final-component replacement race and the open handle bounds the read.
  const pieces=filename.split('/').filter(Boolean);let current='/';
  for(let i=0;i<pieces.length;i++){
   current=path.join(current,pieces[i]);const stat=await fs.lstat(current);
   if(stat.isSymbolicLink()||(i===pieces.length-1?!stat.isFile():!stat.isDirectory()))deny();
  }
  const file=await fs.open(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
   const stat=await file.stat();if(!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<0||stat.size>limit)deny();
   // procfs reports size zero for live status data, so its one fixed path uses
   // the same byte cap but does not trust a metadata length as a content size.
   const bytes=Buffer.alloc((staticSize?stat.size:limit)+1);let size=0;
   while(size<bytes.length){const part=await file.read(bytes,size,bytes.length-size,null);if(!part.bytesRead)break;size+=part.bytesRead;}
   if(size>limit||staticSize&&size!==stat.size)deny();return bytes.subarray(0,size);
  }finally{await file.close();}
 }
 const status=info.status??(await boundedFile('/proc/'+process.pid+'/status',16*1024,false)).toString('utf8');
 if(typeof status!=='string'||status.length>16*1024)deny();
 for(const name of ['CapEff','CapPrm','CapAmb']){const values=[...status.matchAll(new RegExp('^'+name+':\\s*([a-fA-F0-9]+)\\s*$','gm'))];if(values.length!==1||!/^0{1,16}$/.test(values[0][1]))deny();}
 const receiptBytes=await boundedFile(path.join(root,'context-receipt.json'),128*1024);if(sha(receiptBytes)!==pin)deny();
 const receipt=JSON.parse(receiptBytes.toString('utf8'));
 if(!own(receipt,['schema','preparedAt','platform','baseImage','dockerfileSha256','lockSha256','packages','networkRequests','built','pushed','finalImage','productionEligible'])||receipt.schema!=='project-view-image-context/v1'||receipt.platform!=='linux/amd64'||receipt.baseImage!=='mcr.microsoft.com/playwright@sha256:957bb6b7cba151ced0b5bb841703e282c45df1d934af88933b1b655411ecba3a'||! /^[a-f0-9]{64}$/.test(receipt.dockerfileSha256)||! /^[a-f0-9]{64}$/.test(receipt.lockSha256)||typeof receipt.preparedAt!=='string'||receipt.preparedAt.length>40||!Number.isFinite(Date.parse(receipt.preparedAt))||receipt.networkRequests!==0||receipt.built!==false||receipt.pushed!==false||receipt.finalImage!==null||receipt.productionEligible!==false||!Array.isArray(receipt.packages)||receipt.packages.length!==2)deny();
 let files=0,total=0;const metadata={};
 for(let index=0;index<2;index++){
  const pkg=receipt.packages[index],name=['playwright','playwright-core'][index];
  if(!own(pkg,['name','version','integrity','files'])||pkg.name!==name||pkg.version!=='1.63.0'||typeof pkg.integrity!=='string'||! /^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity)||!Array.isArray(pkg.files)||!pkg.files.length||pkg.files.length>176)deny();
  let packageBytes=0;const seen=new Set();
  for(const file of pkg.files){
   if(!own(file,['path','sha256','bytes'])||typeof file.path!=='string'||file.path.length>240||! /^[A-Za-z0-9._/-]+$/.test(file.path)||file.path.split('/').some(part=>!part||part==='.'||part==='..')||seen.has(file.path)||! /^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>16*1024*1024||++files>176)deny();
   seen.add(file.path);packageBytes+=file.bytes;total+=file.bytes;if(packageBytes>64*1024*1024||total>128*1024*1024)deny();
   const bytes=await boundedFile(path.join(root,'node_modules',name,file.path),file.bytes);if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)deny();
   if(file.path==='package.json'||name==='playwright-core'&&file.path==='browsers.json')metadata[name+'/'+file.path]=JSON.parse(bytes.toString('utf8'));
  }
  const pkgInfo=metadata[name+'/package.json'];if(pkgInfo?.name!==name||pkgInfo.version!=='1.63.0'||name==='playwright'&&pkgInfo.dependencies?.['playwright-core']!=='1.63.0')deny();
 }
 const browsers=metadata['playwright-core/browsers.json']?.browsers;
 if(files!==176||!Array.isArray(browsers)||browsers.filter(browser=>browser.name==='chromium'&&browser.revision==='1243'&&browser.browserVersion==='153.0.8010.12').length!==1)deny();
 const version=options.chromeVersion?await options.chromeVersion():await new Promise((resolve,reject)=>{
  void import(childModule).then(({execFile})=>execFile('/opt/chrome/chrome',['--version'],{cwd:root,env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'},timeout:5000,maxBuffer:1024,killSignal:'SIGKILL'},(error,stdout)=>error?reject(error):resolve(stdout)),reject);
 });
 if(typeof version!=='string'||! /^(?:Chromium|Google Chrome for Testing) 153\.0\.8010\.12\s*$/.test(version))deny();
 const report={schema:'project-view-preflight/v1',contextReceiptSha256:pin,files,bytes:total,uid:10001,gid:10001,chromium:'153.0.8010.12'};
 if(options.emit)await options.emit(report);else await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(report)+'\n',error=>error?reject(error):resolve()));
 return report;
}
export const PROJECT_VIEW_PREFLIGHT_PROGRAM='try { await ('+projectViewPreflightMain.toString()+')(); } catch { process.exitCode=1; }';

/** Treat native stdout as untrusted. A bounded report plus exit zero authorizes
 * compatibility only; image identity is an independently pinned control-plane
 * deployment property. EOF and this report are never container cleanup proof. */
export async function readProjectViewPreflight(process,expectedReceiptSha256){
 if(!process?.stdout||typeof expectedReceiptSha256!=='string'||! /^[a-f0-9]{64}$/.test(expectedReceiptSha256))throw Error('project-view-runtime-preflight-invalid');
 const reader=process.stdout.getReader(),bytes=new Uint8Array(4096);let size=0;
 try{
  for(;;){const item=await reader.read();if(item.done)break;if(!(item.value instanceof Uint8Array)||size+item.value.byteLength>bytes.length)throw Error('project-view-runtime-preflight-invalid');bytes.set(item.value,size);size+=item.value.byteLength;}
  if(await process.exitCode!==0)throw Error('project-view-runtime-preflight-invalid');
  const report=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes.subarray(0,size)));
  if(report===null||typeof report!=='object'||Array.isArray(report)||Object.keys(report).sort().join(',')!==['schema','contextReceiptSha256','files','bytes','uid','gid','chromium'].sort().join(',')||report.schema!=='project-view-preflight/v1'||report.contextReceiptSha256!==expectedReceiptSha256||report.files!==176||!Number.isSafeInteger(report.bytes)||report.bytes<0||report.bytes>128*1024*1024||report.uid!==10001||report.gid!==10001||report.chromium!=='153.0.8010.12')throw Error('project-view-runtime-preflight-invalid');
  return report;
 }catch(error){void reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
}
