import type {ServiceRunStorage} from '../run/service.ts';
import {normalizeObserverCommand,type ObserverCommand} from './observer-protocol.ts';
import {observerArtifactReceipt,type ObserverArtifactReceipt,type ObserverArtifactInventoryPort} from './observer-artifacts.ts';

export type ObserverArtifactInventoryEntry={receipt:ObserverArtifactReceipt;writeState:'pending'|'acknowledged'|'uncertain';contentVerified:boolean};
type Row={kind:string;receipt_json:string;write_state:string;content_verified:number};
/** Private per-execution write inventory. A completed receipt is not evidence
 * that an uncertain R2 write can no longer arrive. No deletion authority here. */
export class SqlObserverArtifactInventory implements ObserverArtifactInventoryPort{
 readonly #storage:ServiceRunStorage;readonly #command:ObserverCommand;readonly #encoded:string;readonly #ready:Promise<void>;readonly #writable:()=>void;
 constructor(storage:ServiceRunStorage,raw:ObserverCommand,writable:()=>void=()=>{}){
  this.#writable=writable;
  this.#storage=storage;this.#command=normalizeObserverCommand(raw);this.#encoded=JSON.stringify(this.#command);
  storage.transactionSync(()=>{
   storage.sql.exec("CREATE TABLE IF NOT EXISTS observer_artifact_inventory_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),command_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS observer_artifact_inventory(kind TEXT PRIMARY KEY,receipt_json TEXT NOT NULL,write_state TEXT NOT NULL,content_verified INTEGER NOT NULL);");
   storage.sql.exec('CREATE TABLE IF NOT EXISTS observer_artifact_roots(kind TEXT PRIMARY KEY,receipt_json TEXT NOT NULL)');
   const rows=storage.sql.exec<{command_json:string}>('SELECT command_json FROM observer_artifact_inventory_meta').toArray();
   if(rows.length>1||(rows[0]&&rows[0].command_json!==this.#encoded))throw Error('observer-artifact-inventory-command-conflict');
   if(!rows.length)storage.sql.exec('INSERT INTO observer_artifact_inventory_meta VALUES(1,?)',this.#encoded);
   this.#entries();
  });this.#ready=storage.sync();void this.#ready.catch(()=>{});
 }
 #receipt(raw:ObserverArtifactReceipt){
  const receipt=observerArtifactReceipt(raw);
  if(receipt.kind!=='state'&&receipt.kind!==(this.#command.operation==='screenshot'?'screenshot':'view'))throw Error('observer-artifact-inventory-kind-denied');
  return receipt;
 }
 #entries():ObserverArtifactInventoryEntry[]{
  const rows=this.#storage.sql.exec<Row>('SELECT kind,receipt_json,write_state,content_verified FROM observer_artifact_inventory ORDER BY kind').toArray();
  if(rows.length>2)throw Error('observer-artifact-inventory-invalid');
  return rows.map(row=>{
   const receipt=this.#receipt(JSON.parse(row.receipt_json));
   if(receipt.kind!==row.kind||JSON.stringify(receipt)!==row.receipt_json||!['pending','acknowledged','uncertain'].includes(row.write_state)||![0,1].includes(row.content_verified))throw Error('observer-artifact-inventory-invalid');
   return {receipt,writeState:row.write_state as ObserverArtifactInventoryEntry['writeState'],contentVerified:row.content_verified===1};
  });
 }
 #input(command:ObserverCommand,receipt:ObserverArtifactReceipt){
  if(JSON.stringify(normalizeObserverCommand(command))!==this.#encoded)throw Error('observer-artifact-inventory-command-conflict');
  return this.#receipt(receipt);
 }
 #find(receipt:ObserverArtifactReceipt){
  const entry=this.#entries().find(row=>row.receipt.kind===receipt.kind);
  if(entry&&JSON.stringify(entry.receipt)!==JSON.stringify(receipt))throw Error('observer-artifact-inventory-receipt-conflict');
  return entry;
 }
 async #change<T>(operation:()=>T):Promise<T>{await this.#ready;const result=this.#storage.transactionSync(operation);await this.#storage.sync();return structuredClone(result);}
 async claim(command:ObserverCommand,raw:ObserverArtifactReceipt):Promise<{shouldPut:boolean}>{
  const receipt=this.#input(command,raw);return this.#change(()=>{
   if(this.#find(receipt))return {shouldPut:false};
   this.#writable();
   this.#storage.sql.exec('INSERT INTO observer_artifact_inventory VALUES(?,?,?,0)',receipt.kind,JSON.stringify(receipt),'pending');return {shouldPut:true};
  });
 }
 beforePut(command:ObserverCommand,raw:ObserverArtifactReceipt):void{
  const receipt=this.#input(command,raw),entry=this.#find(receipt);
  if(!entry||entry.writeState!=='pending')throw Error('observer-artifact-inventory-dispatch-denied');
  this.#writable();
 }
 /** Called only inside the same transaction which commits executor result.
  * Roots cannot be released merely because a browser or a Turn stopped. */
 static retainResult(storage:ServiceRunStorage,command:ObserverCommand,result:Record<string,unknown>):void{
  const receipts:ObserverArtifactReceipt[]=[];
  for(const part of ['state','view']){
   const sample=result[part];if(!sample||typeof sample!=='object'||Array.isArray(sample)||!Object.hasOwn(sample,'artifact'))continue;
   receipts.push(observerArtifactReceipt((sample as Record<string,unknown>).artifact));
  }
  if(!receipts.length)return;
  const meta=storage.sql.exec<{command_json:string}>('SELECT command_json FROM observer_artifact_inventory_meta').toArray();
  if(meta.length!==1||meta[0]!.command_json!==JSON.stringify(normalizeObserverCommand(command)))throw Error('observer-artifact-inventory-command-conflict');
  for(const receipt of receipts){
   const rows=storage.sql.exec<Row>('SELECT kind,receipt_json,write_state,content_verified FROM observer_artifact_inventory WHERE kind=?',receipt.kind).toArray();
   if(rows.length!==1||rows[0]!.receipt_json!==JSON.stringify(receipt)||rows[0]!.content_verified!==1)throw Error('observer-artifact-inventory-unverified');
   const existing=storage.sql.exec<{receipt_json:string}>('SELECT receipt_json FROM observer_artifact_roots WHERE kind=?',receipt.kind).toArray();
   if(existing.length&&existing[0]!.receipt_json!==JSON.stringify(receipt))throw Error('observer-artifact-inventory-receipt-conflict');
   storage.sql.exec('INSERT OR IGNORE INTO observer_artifact_roots VALUES(?,?)',receipt.kind,JSON.stringify(receipt));
  }
 }
 async putSettled(command:ObserverCommand,raw:ObserverArtifactReceipt,acknowledged:boolean):Promise<void>{
  const receipt=this.#input(command,raw);if(typeof acknowledged!=='boolean')throw Error('observer-artifact-inventory-invalid');
  await this.#change(()=>{const entry=this.#find(receipt);if(!entry)throw Error('observer-artifact-inventory-not-found');
   if(entry.writeState==='acknowledged')return;
   this.#storage.sql.exec('UPDATE observer_artifact_inventory SET write_state=? WHERE kind=?',acknowledged?'acknowledged':'uncertain',receipt.kind);
  });
 }
 async verified(command:ObserverCommand,raw:ObserverArtifactReceipt):Promise<void>{
  const receipt=this.#input(command,raw);await this.#change(()=>{if(!this.#find(receipt))throw Error('observer-artifact-inventory-not-found');this.#storage.sql.exec('UPDATE observer_artifact_inventory SET content_verified=1 WHERE kind=?',receipt.kind);});
 }
 async snapshot():Promise<ObserverArtifactInventoryEntry[]>{await this.#ready;return structuredClone(this.#entries());}
}
