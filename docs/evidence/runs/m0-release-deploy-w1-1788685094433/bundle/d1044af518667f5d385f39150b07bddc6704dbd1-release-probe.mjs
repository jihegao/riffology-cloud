import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE_DIRECTORY = '/workspace/m0-release';
const MAX_BYTES = 65536, MAX_REQUESTS = 64, MAX_HOLD_MS = 120000;
const encoder = new TextEncoder();
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const validId = value => typeof value === 'string' && /^[a-z0-9-]{8,64}$/.test(value);
const counterAllowed = value => Number.isSafeInteger(value) && value >= 0;
class Rejected extends Error {}
const reject = code => { throw new Rejected(code); };

function inputValue(input) {
 if (!exact(input, ['command','directory','requestId','restore','holdMs','fault']) || !['initialize','increment','read','hold'].includes(input.command)
  || input.directory !== RELEASE_DIRECTORY || !validId(input.requestId)) reject('invalid-input');
 if (Object.hasOwn(input,'restore') && (input.command !== 'initialize' || !exact(input.restore,['schema','counter'])
  || Object.keys(input.restore).length !== 2 || input.restore.schema !== 1 || !counterAllowed(input.restore.counter))) reject('invalid-restore');
 if (Object.hasOwn(input,'holdMs') && (input.command !== 'hold' || !Number.isSafeInteger(input.holdMs) || input.holdMs < 1 || input.holdMs > MAX_HOLD_MS)) reject('invalid-hold');
 if (Object.hasOwn(input,'fault') && (input.command !== 'read' || !['protocol','format'].includes(input.fault))) reject('invalid-fault');
 return {command:input.command,requestId:input.requestId,restore:input.restore??null,holdMs:input.command==='hold'?(input.holdMs??1000):null,fault:input.fault??null};
}
function validState(state) {
 if (!exact(state,['schema','initialized','counter','requests']) || state.schema !== 1 || typeof state.initialized !== 'boolean'
  || !counterAllowed(state.counter) || !object(state.requests) || Object.keys(state.requests).length > MAX_REQUESTS) reject('invalid-state');
 let running = 0;
 for (const [id,row] of Object.entries(state.requests)) {
  if (!validId(id) || !exact(row,['command','digest','status','pid','counter']) || !['initialize','increment','hold'].includes(row.command)
   || !/^[a-f0-9]{64}$/.test(row.digest??'') || !['running','completed'].includes(row.status)
   || !Number.isSafeInteger(row.pid) || row.pid < 1 || (row.status==='completed' ? !counterAllowed(row.counter) : row.counter!==null)) reject('invalid-state');
  if (row.status==='running') running++;
 }
 if (running>1) reject('invalid-state');
 return state;
}
async function readState(directory) {
 let file;
 try {
  file=await open(join(directory,'state.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_BYTES)reject('invalid-state');
  const bytes=await file.readFile();if(bytes.length>MAX_BYTES)reject('invalid-state');
  return validState(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
 } catch(error) { if(error.code==='ENOENT')return null;if(error instanceof Rejected)throw error;reject('invalid-state'); }
 finally {await file?.close();}
}
async function atomicState(directory,state) {
 validState(state);const bytes=encoder.encode(JSON.stringify(state));if(bytes.length>MAX_BYTES)reject('state-limit');
 const temporary=join(directory,`.state-${randomUUID()}.tmp`);let file,dir;
 try {
  file=await open(temporary,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=null;
  await rename(temporary,join(directory,'state.json'));
  dir=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY);await dir.sync();
 } finally {await file?.close();await dir?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function canonicalDirectory(directory,create) {
 if(typeof directory!=='string'||!isAbsolute(directory)||resolve(directory)!==directory||directory==='/')reject('invalid-storage-directory');
 const parent=dirname(directory);if(await realpath(parent)!==parent)reject('noncanonical-directory');
 if(create)await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 const info=await lstat(directory);
 if(!info.isDirectory()||info.isSymbolicLink()||await realpath(directory)!==directory)reject('noncanonical-directory');
}
async function withLock(directory,fn) {
 const lock=join(directory,'.mutation-lock');
 try {await mkdir(lock,{mode:0o700});}catch(error){if(error.code==='EEXIST')reject('mutation-locked');throw error;}
 // A process killed inside this short section may leave the lock. We do not
 // infer the owner's liveness or steal its lock: recovery uses a fresh VM.
 try{return await fn();}finally{await rmdir(lock);}
}
function view(state) {
 const current=Object.entries(state.requests).find(([,row])=>row.status==='running');
 return {counter:state.counter,currentCounter:state.counter,initialized:state.initialized,checkpoint:{schema:1,counter:state.counter},
  active:current?{requestId:current[0],command:current[1].command,pid:current[1].pid,outcome:'unconfirmed'}:null,
  completedRequests:Object.values(state.requests).filter(row=>row.status==='completed').length,
  stateSha256:hash(JSON.stringify(state))};
}

/** Fixed cloud release diagnostic; no Shell, network, provider or caller code.
 * CLI always uses RELEASE_DIRECTORY. The import-only storageDirectory mapping
 * supports real-process local tests without modifying the host's /workspace.
 * An unfinished persisted intent is unknown and is never replayed. A running
 * record is not proof its recorded PID remains alive. The supervisor owns VM
 * destruction and restores only its previously confirmed R2 checkpoint. */
export async function runReleaseProbe(input,options={}) {
 let parsed;
 const base={protocol:'m0-v1',format:1,command:null,requestId:null,pid:process.pid};
 try {
  parsed=inputValue(input);base.command=parsed.command;base.requestId=parsed.requestId;
  if(!exact(options,['storageDirectory']))reject('invalid-options');
  const directory=options.storageDirectory??RELEASE_DIRECTORY;
  await canonicalDirectory(directory,parsed.command==='initialize');
  if(parsed.command==='read'){
   const state=await readState(directory);if(!state)reject('not-initialized');
   return {...base,protocol:parsed.fault==='protocol'?'m0-unknown':'m0-v1',format:parsed.fault==='format'?999:1,status:'observed',replayed:false,...view(state)};
  }
  const digest=hash(JSON.stringify(parsed));
  const start=await withLock(directory,async()=>{
   const state=await readState(directory)??{schema:1,initialized:false,counter:0,requests:{}};
   const prior=Object.hasOwn(state.requests,parsed.requestId)?state.requests[parsed.requestId]:undefined;
   if(prior){
    if(prior.digest!==digest)reject('request-conflict');
    if(prior.status!=='completed')reject('request-outcome-unknown');
    return {replayed:true,state,receipt:prior};
   }
   if(Object.values(state.requests).some(row=>row.status==='running'))reject('active-outcome-unconfirmed');
   if(parsed.command==='initialize'?state.initialized:!state.initialized)reject(parsed.command==='initialize'?'already-initialized':'not-initialized');
   if(Object.keys(state.requests).length>=MAX_REQUESTS)reject('request-limit');
   if(parsed.command==='increment'&&state.counter===Number.MAX_SAFE_INTEGER)reject('counter-limit');
   state.requests[parsed.requestId]={command:parsed.command,digest,status:'running',pid:process.pid,counter:null};
   await atomicState(directory,state);return {replayed:false};
  });
  if(start.replayed)return {...base,status:'completed',...view(start.state),counter:start.receipt.counter,
   checkpoint:{schema:1,counter:start.receipt.counter},replayed:true,originalPid:start.receipt.pid};
  if(parsed.command==='hold')await new Promise(resolve=>setTimeout(resolve,parsed.holdMs));
  const state=await withLock(directory,async()=>{
   const latest=await readState(directory),receipt=latest?.requests[parsed.requestId];
   if(!receipt||receipt.status!=='running'||receipt.digest!==digest||receipt.pid!==process.pid)reject('intent-changed');
   if(parsed.command==='initialize'){latest.counter=parsed.restore?.counter??0;latest.initialized=true;}
   else if(parsed.command==='increment')latest.counter++;
   latest.requests[parsed.requestId]={...receipt,status:'completed',counter:latest.counter};
   await atomicState(directory,latest);return latest;
  });
  return {...base,status:'completed',replayed:false,...view(state)};
 }catch(error){return {...base,status:'rejected',counter:null,replayed:false,error:error instanceof Rejected?error.message:'storage-or-operation-unconfirmed'};}
}

async function stdinInput() {
 const chunks=[];let bytes=0;
 const timer=setTimeout(()=>process.stdin.destroy(new Error('input-timeout')),1000);
 try {for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>4096)reject('input-limit');chunks.push(chunk);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 finally{clearTimeout(timer);}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let result;
 try{if(process.argv.length!==2)reject('invalid-cli');result=await runReleaseProbe(await stdinInput());}
 catch{result={protocol:'m0-v1',format:1,command:null,requestId:null,counter:null,pid:process.pid,status:'rejected',replayed:false,error:'invalid-cli-input'};}
 process.stdout.write(JSON.stringify(result)+'\n');if(result.status==='rejected')process.exitCode=1;
}
