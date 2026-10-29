import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
export class Stop extends Error{constructor(code){super(code);this.code=code;}}
export const need=(ok,code)=>{if(!ok)throw new Stop(code);};
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const hashJSON=x=>sha(Buffer.from(JSON.stringify(canonical(x))??'undefined'));
export const safeCode=e=>e instanceof Stop&&/^[a-z0-9-]+$/.test(e.code)?e.code:'owner-wiring-stopped';
export const HEX=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/;
export const REQUEST='560ada22-f507-48b9-b926-8df6d6b90ceb';
export const ACCOUNT='8b0d70250211aa10d89e20605a1c7e5e',WORKER='riffology-m1-gateway-staging';
export const USER_SHA='c8d5e2a134d99693a4585510f761b811d67b3e36c413eb3c9d34d060cccc986d';
export const SCOPES=Object.freeze(['account:read','containers:write','offline_access','user:read','workers:write','workers_scripts:write']);
export function current(signal,deadline){need(!signal?.aborted&&Date.now()<deadline,'owner-deadline-or-abort');}
export async function ownedBytes(path,max=4*1024*1024){
  need(typeof path==='string'&&path.startsWith('/')&&!path.includes('\0'),'absolute-owned-input');
  const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const a=await h.stat({bigint:true});need(a.isFile()&&a.uid===BigInt(process.getuid())&&a.nlink===1n&&a.size>0n&&a.size<=BigInt(max),'owned-bounded-regular-input');const raw=await h.readFile(),b=await h.stat({bigint:true});need(raw.length===Number(a.size)&&['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]),'owned-input-changed');return raw;}finally{await h.close();}
}
export async function pinned(ref,max){need(typeof ref?.file==='string'&&Number.isSafeInteger(ref.bytes)&&HEX.test(ref.sha256??''),'pinned-evidence-reference');const raw=await ownedBytes(ref.file,max);need(raw.length===ref.bytes&&sha(raw)===ref.sha256,'pinned-evidence-drift');return raw;}
export function deepFreeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))deepFreeze(v);Object.freeze(value);}return value;}
export function fresh(at,max=30000){const value=typeof at==='number'?at:Date.parse(at);need(Number.isFinite(value)&&value<=Date.now()+2000&&Date.now()-value<=max,'fresh-receipt-required');return value;}
