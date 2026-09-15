import {mkdirSync,openSync,closeSync,writeSync,fsyncSync,readFileSync,readdirSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
function identity(record){
  if(!record||!id(record.intentKey)||!id(record.workspaceId)||!id(record.sessionId)||!hash(record.messageSha256))throw Error('journal-identity-invalid');
  return {intentKey:record.intentKey,workspaceId:record.workspaceId,sessionId:record.sessionId,messageSha256:record.messageSha256};
}
const fingerprint=value=>sha(JSON.stringify(identity(value)));
const syncDirectory=path=>{const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
function durableCreate(path,value){const fd=openSync(path,'wx',0o600);try{const bytes=Buffer.from(JSON.stringify(value)+'\n');let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd);}finally{closeSync(fd);}syncDirectory(resolve(path,'..'));}
/** Local durable fences, not cloud authority. A stale lock is blocked, never auto-deleted. */
export function createRuntimeIntentJournal({directory,windowId}={}){
  if(!id(windowId)||typeof directory!=='string')throw Error('journal-config-invalid');
  const root=resolve(directory);try{mkdirSync(root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}syncDirectory(root);syncDirectory(resolve(root,'..'));
  const metadata=join(root,'window.json');
  try{durableCreate(metadata,{windowId});}catch(error){if(error.code!=='EEXIST')throw error;if(JSON.parse(readFileSync(metadata,'utf8')).windowId!==windowId)throw Error('journal-window-conflict');}
  const lock=join(root,'window.lock');
  const locked=operation=>{let fd;try{fd=openSync(lock,'wx',0o600);writeSync(fd,JSON.stringify({windowId,pid:process.pid}));fsyncSync(fd);syncDirectory(root);}catch(error){if(fd!==undefined)closeSync(fd);throw Error('journal-window-locked-or-uncertain');}try{return operation();}finally{closeSync(fd);unlinkSync(lock);syncDirectory(root);}};
  const files=()=>readdirSync(root).filter(name=>name.endsWith('.intent.json'));
  const path=key=>join(root,`${sha(key)}.intent.json`);
  const read=key=>{try{return JSON.parse(readFileSync(path(key),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
  const settled=record=>{try{const receipt=JSON.parse(readFileSync(join(root,`${sha(record.intentKey)}.reconciliation.json`),'utf8')),ack=JSON.parse(readFileSync(join(root,`${sha(record.intentKey)}.ack.json`),'utf8'));return receipt.fingerprint===record.fingerprint&&ack.fingerprint===record.fingerprint&&receipt.turnId===ack.turnId&&id(ack.turnId)&&['completed','failed','cancelled','interrupted'].includes(receipt.terminalStatus)&&hash(receipt.rawEvidenceSha256);}catch(error){if(error.code==='ENOENT')return false;throw error;}};
  return {
    async createOnce(record){const normalized=identity(record);if(record.state!=='delivery-unknown'||record.turnId!==null)throw Error('journal-create-state-invalid');return locked(()=>{const existing=read(record.intentKey);if(existing){if(existing.fingerprint!==fingerprint(record))throw Error('journal-intent-conflict');return 'reconcile';}for(const name of files()){const other=JSON.parse(readFileSync(join(root,name),'utf8'));if(!settled(other))throw Error('journal-window-has-unresolved-intent');}durableCreate(path(record.intentKey),{...normalized,state:'delivery-unknown',turnId:null,fingerprint:fingerprint(record)});return 'created';});},
    async update(record){const normalized=identity(record);if(record.state!=='submitted'||!id(record.turnId))throw Error('journal-update-state-invalid');return locked(()=>{const existing=read(record.intentKey);if(!existing||existing.fingerprint!==fingerprint(record))throw Error('journal-update-identity-conflict');if(existing.turnId&&existing.turnId!==record.turnId)throw Error('journal-update-turn-conflict');const ackPath=join(root,`${sha(record.intentKey)}.ack.json`);try{durableCreate(ackPath,{...normalized,state:'submitted',turnId:record.turnId,fingerprint:existing.fingerprint});}catch(error){if(error.code!=='EEXIST')throw error;const ack=JSON.parse(readFileSync(ackPath,'utf8'));if(ack.turnId!==record.turnId||ack.fingerprint!==existing.fingerprint)throw Error('journal-ack-conflict');}return 'recorded';});},
    async read(key){const record=read(key);if(!record)return null;try{const ack=JSON.parse(readFileSync(join(root,`${sha(key)}.ack.json`),'utf8'));if(ack.fingerprint!==record.fingerprint)throw Error('journal-ack-conflict');return {...record,state:'submitted',turnId:ack.turnId};}catch(error){if(error.code==='ENOENT')return record;throw error;}},
    async recordReconciliation(receipt){identity(receipt);if(!id(receipt.turnId)||!hash(receipt.rawEvidenceSha256)||!['completed','failed','cancelled','interrupted'].includes(receipt.terminalStatus))throw Error('journal-reconciliation-invalid');return locked(()=>{const record=read(receipt.intentKey);if(!record||record.fingerprint!==fingerprint(receipt))throw Error('journal-reconciliation-conflict');const ack=JSON.parse(readFileSync(join(root,`${sha(receipt.intentKey)}.ack.json`),'utf8'));if(ack.turnId!==receipt.turnId||ack.fingerprint!==record.fingerprint)throw Error('journal-reconciliation-turn-conflict');durableCreate(join(root,`${sha(receipt.intentKey)}.reconciliation.json`),{...identity(receipt),turnId:receipt.turnId,terminalStatus:receipt.terminalStatus,rawEvidenceSha256:receipt.rawEvidenceSha256,fingerprint:record.fingerprint});return 'recorded';});},
  };
}
