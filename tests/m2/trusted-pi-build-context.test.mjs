import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const MAX_CONTEXT=8*1024*1024,MAX_LOG=64*1024;
const root=fileURLToPath(new URL('../..',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function tarFiles(raw){
 const bytes=raw[0]===31&&raw[1]===139?gunzipSync(raw,{maxOutputLength:MAX_CONTEXT}):raw;
 assert.ok(bytes.length<=MAX_CONTEXT);const files=new Map();let nextPath;
 const text=(offset,length)=>bytes.subarray(offset,offset+length).toString('utf8').split('\0')[0];
 for(let offset=0;offset+512<=bytes.length;){
  const header=bytes.subarray(offset,offset+512);if(header.every(value=>value===0))break;
  const octal=(start,length)=>Number.parseInt(text(offset+start,length).trim(),8)||0;
  assert.equal(header.reduce((sum,value,index)=>sum+(index>=148&&index<156?32:value),0),octal(148,8),'Docker CLI tar checksum');
  const size=octal(124,12),kind=String.fromCharCode(header[156]),name=text(offset+345,155)?text(offset+345,155)+'/'+text(offset,100):text(offset,100);
  offset+=512;assert.ok(size>=0&&offset+size<=bytes.length);const content=bytes.subarray(offset,offset+size);offset+=Math.ceil(size/512)*512;
  if(kind==='x'||kind==='g'){
   for(let position=0;position<content.length;){const space=content.indexOf(32,position),length=Number(content.subarray(position,space).toString());assert.ok(length>0&&position+length<=content.length);const line=content.subarray(space+1,position+length-1).toString();if(line.startsWith('path='))nextPath=line.slice(5);position+=length;}
   continue;
  }
  if(kind==='L'){nextPath=content.toString().replace(/\0+$/,'');continue;}
  const logical=(nextPath??name).replace(/^\.\//,'');nextPath=undefined;
  if(kind==='5')continue;
  assert.ok(kind==='0'||kind==='\0','Only regular fixture files may be sent');assert.ok(!files.has(logical),'No duplicate context entries');files.set(logical,content);
 }
 return files;
}

test('real Docker CLI context filtering includes the pinned IR package and excludes unrelated private roots', {timeout:30_000}, async t=>{
 const available=spawnSync('docker',['--version'],{encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH??''}});
 if(available.error?.code==='ENOENT'){t.skip('Docker CLI is not installed; this is a client context-filter test, with no daemon/image execution.');return;}
 assert.equal(available.status,0,available.stderr||available.error?.message);
 const temporary=await mkdtemp(join(tmpdir(),'riffology-docker-context-'));t.after(()=>rm(temporary,{recursive:true,force:true}));
 const context=join(temporary,'context'),config=join(temporary,'docker-config');await mkdir(context);await mkdir(config);
 // A fresh config plus one empty synthetic auth entry prevents automatic
 // discovery of a host credential store. No real Docker configuration is read.
 await writeFile(join(config,'config.json'),JSON.stringify({auths:{'context-capture.invalid':{}}}));
 const pinBytes=await readFile(join(root,'vendor/riffoid-ir-plugin.lock.json')),pin=JSON.parse(pinBytes);assert.equal(pin.files.length,45);
 const expected=new Map();
 for(const entry of pin.files){
  const relative='vendor/riffoid-ir-plugin/'+entry.path,destination=join(context,relative);await mkdir(dirname(destination),{recursive:true});await copyFile(join(root,relative),destination);expected.set(relative,{bytes:entry.bytes,sha256:entry.sha256});
 }
 const lock='vendor/riffoid-ir-plugin.lock.json';await writeFile(join(context,lock),pinBytes);expected.set(lock,{bytes:pinBytes.length,sha256:hash(pinBytes)});
 await copyFile(join(root,'.dockerignore'),join(context,'.dockerignore'));
 await writeFile(join(context,'Dockerfile'),'FROM scratch\nCOPY vendor/riffoid-ir-plugin/ /package/\nCOPY vendor/riffoid-ir-plugin.lock.json /package.lock.json\n');
 const decoys=['vendor/riffoid-ir-plugin/UNPINNED.txt','vendor/riffoid-ir-plugin/node_modules/private-package/package.json','vendor/riffoid-ir-plugin/.npmrc','vendor/riffoid-ir-plugin/.pi/sessions/session.jsonl','vendor/unrelated/private.txt','vendor/riffoid-ir-plugin-other/auth.json','vendor/riffoid-ir-plugin.lock.json.bak','node_modules/private-package/package.json','.docker/config.json','.npmrc','auth.json','.config/opencode/auth.json','.pi/sessions/session.jsonl','.local/turn.session','.git/config'];
 for(const relative of decoys){const destination=join(context,relative);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,'SYNTHETIC_CONTEXT_DECOY');}
 let captured,handlerError;const requests=[];
 const server=createServer(async(req,res)=>{try{
  assert.ok(requests.length<12);const pathname=new URL(req.url,'http://localhost').pathname.replace(/^\/v\d+\.\d+/,'');requests.push({method:req.method,path:pathname});
  assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['x-registry-auth'],undefined);
  if(pathname==='/_ping'){res.writeHead(200,{'API-Version':'1.40','OSType':'linux'});return res.end(req.method==='HEAD'?'':'OK');}
  if(pathname==='/info'||pathname==='/version'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ApiVersion:'1.40',MinAPIVersion:'1.24',Version:'context-capture-only',OSType:'linux',Os:'linux',Architecture:'x86_64',Arch:'amd64'}));}
  assert.equal(req.method,'POST');assert.equal(pathname,'/build');assert.equal(captured,undefined,'Exactly one context submission');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert.ok(size<=MAX_CONTEXT);chunks.push(chunk);}
  captured=tarFiles(Buffer.concat(chunks));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({stream:'Context captured by test API; no daemon build or image execution occurred.\n'})+'\n');
 }catch(error){handlerError=error;if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'context-capture-rejected'}));}});
 server.requestTimeout=15_000;server.headersTimeout=10_000;server.keepAliveTimeout=1;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const endpoint='tcp://127.0.0.1:'+server.address().port;
 const child=spawn('docker',['--config',config,'--host',endpoint,'build','--network=none','--pull=false','-f',join(context,'Dockerfile'),context],{env:{PATH:process.env.PATH??'',DOCKER_HOST:endpoint,DOCKER_BUILDKIT:'0'},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',overflow=false;const timer=setTimeout(()=>child.kill('SIGKILL'),20_000);t.after(()=>{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');});
 for(const [name,stream] of [['stdout',child.stdout],['stderr',child.stderr]])stream.on('data',chunk=>{if(name==='stdout')stdout+=chunk;else stderr+=chunk;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>MAX_LOG){overflow=true;child.kill('SIGKILL');}});
 const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});clearTimeout(timer);
 assert.equal(overflow,false);assert.equal(handlerError,undefined,handlerError?.message);assert.equal(exitCode,0,stderr+'\n'+stdout);assert.ok(captured,'The actual Docker client must submit a context tar');
 assert.equal(requests.filter(value=>value.path==='/build').length,1);
 for(const [path,entry] of expected){assert.ok(captured.has(path),'Required COPY input was filtered: '+path);const content=captured.get(path);assert.equal(content.length,entry.bytes,path);assert.equal(hash(content),entry.sha256,path);}
 for(const path of decoys)assert.equal(captured.has(path),false,'Private fixture path entered context: '+path);
 assert.deepEqual([...captured.keys()].filter(path=>!['Dockerfile','.dockerignore'].includes(path)).sort(),[...expected.keys()].sort());
 t.diagnostic('Docker CLI '+available.stdout.trim()+'; 45 package files plus lock hash-verified in actual client tar. Loopback capture API only; no daemon build/image execution.');
});
