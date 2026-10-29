/** Nonsecret one-process startup fence only. Never executed in preparation. */
import {createReadStream,constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=dirname(fileURLToPath(import.meta.url)),REQUEST='560ada22-f507-48b9-b926-8df6d6b90ceb';
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(yes)=>{if(!yes)throw Error('original-node-startup-stopped');};
async function owned(path,max,privateFile=false){const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const a=await h.stat({bigint:true});need(a.isFile()&&a.uid===BigInt(process.getuid())&&a.nlink===1n&&a.size>0n&&a.size<=BigInt(max)&&(!privateFile||(a.mode&0o077n)===0n));const bytes=await h.readFile(),b=await h.stat({bigint:true});need(bytes.length===Number(a.size)&&['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]));return bytes;}finally{await h.close();}}
let timer,stream,stopped=false;const handlers=[];
try{
  need(process.argv.length===3&&['--inspect','--execute'].includes(process.argv[2]));
  const frame=await new Promise((resolve,reject)=>{const chunks=[];let size=0,done=false;const stop=()=>{stopped=true;finish(Error('original-node-startup-stopped'));};const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};for(const signal of ['SIGINT','SIGTERM','SIGHUP']){process.on(signal,stop);handlers.push([signal,stop]);}timer=setTimeout(stop,10000);stream=createReadStream('',{fd:0,autoClose:true});stream.on('data',chunk=>{size+=chunk.length;if(size>8192){stream.destroy();stop();}else chunks.push(chunk);});stream.once('error',()=>stop());stream.once('end',()=>finish(null,Buffer.concat(chunks)));});
  need(!stopped);const release=JSON.parse(frame.toString('ascii'));
  need(Object.keys(release).sort().join(',')==='launcherPid,mode,pgid,pid,record,requestId,schema'&&release.schema==='riffoid-ir.original-node-startup-release/v1'&&release.requestId===REQUEST&&release.mode===process.argv[2]&&release.pid===process.pid&&release.pgid===process.pid&&release.launcherPid===process.ppid);
  const path=join(ROOT,'.state','owner-original-node-'+release.mode.slice(2)+'-'+process.pid+'.safe.json');need(release.record?.file===path&&Number.isSafeInteger(release.record.bytes)&&/^[a-f0-9]{64}$/.test(release.record.sha256));
  const raw=await owned(path,8192,true);need(raw.length===release.record.bytes&&sha(raw)===release.record.sha256);const record=JSON.parse(raw.toString('ascii'));
  need(Object.keys(record).sort().join(',')==='createdAtUnixMs,credentialBodyLogged,entry,hardDeadlineUnixMs,launcherPid,manualFallbackScope,mode,node,pgid,pid,requestId,schema,startupGate,startupReleased,uid'&&record.schema==='riffoid-ir.original-node-pid/v1'&&record.requestId===REQUEST&&record.mode===release.mode&&record.pid===process.pid&&record.pgid===process.pid&&record.launcherPid===process.ppid&&record.uid===process.getuid()&&record.node==='/opt/homebrew/bin/node'&&record.startupReleased===false&&record.credentialBodyLogged===false&&record.manualFallbackScope==='only-this-original-node-process-group-no-replay');
  need(Number.isSafeInteger(record.createdAtUnixMs)&&Number.isSafeInteger(record.hardDeadlineUnixMs)&&Date.now()-record.createdAtUnixMs>=0&&Date.now()-record.createdAtUnixMs<10000&&Date.now()<record.hardDeadlineUnixMs&&record.hardDeadlineUnixMs-record.createdAtUnixMs<=900000);
  for(const [field,name]of [['startupGate','node-startup-gate.mjs'],['entry','owner-caller.mjs']]){need(record[field]?.file===join(ROOT,name));const bytes=await owned(record[field].file,65536);need(bytes.length===record[field].bytes&&sha(bytes)===record[field].sha256);}
  need(!stopped);clearTimeout(timer);for(const [signal,handler]of handlers)process.removeListener(signal,handler);
  // Same original Node PID; no second runner/process/daemon is created here.
  await import(pathToFileURL(join(ROOT,'owner-caller.mjs')).href);
}catch{
  clearTimeout(timer);stream?.destroy();for(const [signal,handler]of handlers)process.removeListener(signal,handler);
  console.error(JSON.stringify({schema:'riffoid-ir.owner-caller-stopped/v1',code:'original-node-startup-stopped',automaticRetry:false,credentialsOrRawBodyLogged:false}));process.exitCode=1;
}
