import type {ServiceRunStorage} from '../run/service.ts';
import {positive,scope,sameScope,turnId,type TurnScope} from '../turn/protocol.ts';
import {previewBrowserPrincipal,type PreviewBrowserPrincipal} from './session.ts';
import type {PreviewBinding} from './bindings.ts';

export type PreviewTicketClaims={purpose:'browser';principal:PreviewBrowserPrincipal;binding:PreviewBinding;issuedAt:number;expiresAt:number};
export interface PreviewTicketPorts{
 session(principal:PreviewBrowserPrincipal,scope:TurnScope):Promise<void>;
 /** Must resolve the current binding AND its actual Run using previewTarget. */
 target(previewId:string):Promise<PreviewBinding>;
}
const ttl=30000,capacity=256;
function secret(value:string){if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))throw Error('preview-ticket-denied');return value;}
function random(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');}
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret(value)))),v=>v.toString(16).padStart(2,'0')).join('');}
function canonical(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';}
/** Private one-use handoff journal. Never a reusable cookie or a socket grant.
 * The nonce must come from the future Preview-origin bootstrap cookie, not a
 * shared URL. Only hashes of the bearer ticket and nonce are persisted. */
export class SqlPreviewTickets{
 readonly #storage:ServiceRunStorage;readonly #scope:TurnScope;readonly #ports:PreviewTicketPorts;readonly #clock:()=>number;readonly #ready:Promise<void>;
 constructor(storage:ServiceRunStorage,rawScope:TurnScope,ports:PreviewTicketPorts,clock=Date.now){
  this.#storage=storage;this.#scope=scope(rawScope);this.#ports=ports;this.#clock=clock;
  storage.transactionSync(()=>{
   storage.sql.exec(`CREATE TABLE IF NOT EXISTS preview_ticket_scope(singleton INTEGER PRIMARY KEY CHECK(singleton=1),scope_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preview_tickets(ticket_hash TEXT PRIMARY KEY,nonce_hash TEXT NOT NULL,claims_json TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER); CREATE INDEX IF NOT EXISTS preview_ticket_expiry ON preview_tickets(expires_at); CREATE TABLE IF NOT EXISTS preview_access(access_hash TEXT PRIMARY KEY,claims_json TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER); CREATE INDEX IF NOT EXISTS preview_access_expiry ON preview_access(expires_at);`);
   const old=this.#rows('SELECT scope_json FROM preview_ticket_scope WHERE singleton=1')[0];
   if(old&&old.scope_json!==canonical(this.#scope))throw Error('preview-ticket-scope-denied');
   if(!old)storage.sql.exec('INSERT INTO preview_ticket_scope VALUES(1,?)',canonical(this.#scope));
  });this.#ready=storage.sync();
 }
 #rows(sql:string,...args:(string|number|null)[]){return this.#storage.sql.exec<Record<string,SqlStorageValue>>(sql,...args).toArray();}
 #now(){return positive(this.#clock());}
 #binding(binding:PreviewBinding,previewId:string,now:number){
  if(binding.previewId!==previewId||!sameScope(scope(binding.scope),this.#scope)||binding.revokedAt!==null||binding.reason!==null||binding.expiresAt<=now||binding.runtime.deadlineAt!==binding.expiresAt)throw Error('preview-ticket-denied');
  return structuredClone(binding);
 }
 async #authorize(claims:PreviewTicketClaims){
  previewBrowserPrincipal(claims.principal,this.#now());
  await this.#ports.session(claims.principal,this.#scope);
  const current=this.#binding(await this.#ports.target(claims.binding.previewId),claims.binding.previewId,this.#now());
  if(canonical(current)!==canonical(claims.binding)||claims.expiresAt<=this.#now())throw Error('preview-ticket-denied');
  // Check the session again after the asynchronous Run/target observation.
  await this.#ports.session(claims.principal,this.#scope);
  if(claims.expiresAt<=this.#now())throw Error('preview-ticket-denied');
 }
 async issue(rawPrincipal:PreviewBrowserPrincipal,previewId:string,nonce:string):Promise<{ticket:string;expiresAt:number}>{
  const principal=previewBrowserPrincipal(rawPrincipal,this.#now()),id=turnId(previewId),nonceHash=await hash(nonce);await this.#ready;
  await this.#ports.session(principal,this.#scope);
  const binding=this.#binding(await this.#ports.target(id),id,this.#now()),issuedAt=this.#now();
  const claims:PreviewTicketClaims={purpose:'browser',principal,binding,issuedAt,expiresAt:Math.min(issuedAt+ttl,principal.expiresAt,binding.expiresAt)};
  const ticket=random(),ticketHash=await hash(ticket);await this.#authorize(claims);
  this.#storage.transactionSync(()=>{
   const now=this.#now();if(claims.expiresAt<=now)throw Error('preview-ticket-denied');
   this.#storage.sql.exec('DELETE FROM preview_tickets WHERE expires_at<=?',now);
   if(Number(this.#rows('SELECT COUNT(*) AS n FROM preview_tickets')[0]!.n)>=capacity)throw Error('preview-ticket-capacity');
   this.#storage.sql.exec('INSERT INTO preview_tickets VALUES(?,?,?,?,NULL)',ticketHash,nonceHash,JSON.stringify(claims),claims.expiresAt);
  });await this.#storage.sync();if(claims.expiresAt<=this.#now())throw Error('preview-ticket-denied');return {ticket,expiresAt:claims.expiresAt};
 }
 async redeem(ticket:string,nonce:string,expectedPreviewId?:string):Promise<PreviewTicketClaims>{
  if(expectedPreviewId!==undefined)turnId(expectedPreviewId);
  const [ticketHash,nonceHash]=await Promise.all([hash(ticket),hash(nonce)]);await this.#ready;
  const row=this.#rows('SELECT * FROM preview_tickets WHERE ticket_hash=?',ticketHash)[0];
  if(!row||row.nonce_hash!==nonceHash||row.consumed_at!==null||Number(row.expires_at)<=this.#now())throw Error('preview-ticket-denied');
  const claims=JSON.parse(row.claims_json as string) as PreviewTicketClaims;
  if(claims.purpose!=='browser'||claims.expiresAt!==row.expires_at||(expectedPreviewId!==undefined&&claims.binding.previewId!==expectedPreviewId))throw Error('preview-ticket-denied');
  await this.#authorize(claims);
  this.#storage.transactionSync(()=>{
   const now=this.#now();const changed=this.#rows('UPDATE preview_tickets SET consumed_at=? WHERE ticket_hash=? AND nonce_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING ticket_hash',now,ticketHash,nonceHash,now);
   if(changed.length!==1)throw Error('preview-ticket-denied');
  });await this.#storage.sync();if(claims.expiresAt<=this.#now())throw Error('preview-ticket-denied');
  return structuredClone(claims);
 }
 /** Consumes the handoff first. A crash before access persistence requires a
  * fresh authorized handoff, never a replay of the consumed ticket. */
 async exchange(ticket:string,nonce:string,expectedPreviewId?:string):Promise<{access:string;expiresAt:number}>{
  const claims=await this.redeem(ticket,nonce,expectedPreviewId),issuedAt=this.#now();
  const accessClaims:PreviewTicketClaims={...claims,issuedAt,expiresAt:Math.min(issuedAt+300000,claims.principal.expiresAt,claims.binding.expiresAt)};
  const access=random(),accessHash=await hash(access);await this.#authorize(accessClaims);
  this.#storage.transactionSync(()=>{
   const now=this.#now();if(accessClaims.expiresAt<=now)throw Error('preview-access-denied');
   this.#storage.sql.exec('DELETE FROM preview_access WHERE expires_at<=?',now);
   if(Number(this.#rows('SELECT COUNT(*) AS n FROM preview_access')[0]!.n)>=128)throw Error('preview-access-capacity');
   this.#storage.sql.exec('INSERT INTO preview_access VALUES(?,?,?,NULL)',accessHash,JSON.stringify(accessClaims),accessClaims.expiresAt);
  });await this.#storage.sync();if(accessClaims.expiresAt<=this.#now())throw Error('preview-access-denied');
  return {access,expiresAt:accessClaims.expiresAt};
 }
 async access(access:string,previewId:string):Promise<PreviewTicketClaims>{
  const accessHash=await hash(access),id=turnId(previewId);await this.#ready;
  const row=this.#rows('SELECT * FROM preview_access WHERE access_hash=?',accessHash)[0];
  if(!row||row.revoked_at!==null||Number(row.expires_at)<=this.#now())throw Error('preview-access-denied');
  const claims=JSON.parse(row.claims_json as string) as PreviewTicketClaims;
  if(claims.purpose!=='browser'||claims.binding.previewId!==id||claims.expiresAt!==row.expires_at)throw Error('preview-access-denied');
  await this.#authorize(claims);
  const latest=this.#rows('SELECT * FROM preview_access WHERE access_hash=?',accessHash)[0];
  if(!latest||latest.revoked_at!==null||latest.claims_json!==row.claims_json||claims.expiresAt<=this.#now())throw Error('preview-access-denied');
  return structuredClone(claims);
 }
 async revokeAccess(access:string):Promise<void>{
  const accessHash=await hash(access);await this.#ready;
  this.#storage.sql.exec('UPDATE preview_access SET revoked_at=? WHERE access_hash=? AND revoked_at IS NULL',this.#now(),accessHash);
  await this.#storage.sync();
 }

}
