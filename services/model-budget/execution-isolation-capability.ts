import {turnDigest} from '../turn/protocol.ts';

const encoder=new TextEncoder(),MAC=/^[a-f0-9]{64}$/;
function reject(code:string):never{throw Error(code);}
function keyBytes(value:unknown):ArrayBuffer{if(typeof value!=='string')reject('model-execution-isolation-authority-key-invalid');const bytes=encoder.encode(value);if(bytes.byteLength<32||bytes.byteLength>256)reject('model-execution-isolation-authority-key-invalid');return bytes.buffer as ArrayBuffer;}
async function key(value:string){return crypto.subtle.importKey('raw',keyBytes(value),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
function signature(value:string):ArrayBuffer{if(!MAC.test(value))reject('model-execution-isolation-authority-invalid');return Uint8Array.from(value.match(/../gu)!.map(pair=>Number.parseInt(pair,16))).buffer as ArrayBuffer;}
async function message(ledger:'legacy'|'g5',tenantId:string,proof:unknown){return encoder.encode(await turnDigest({schemaVersion:1,purpose:'model-execution-isolation-authority',ledger,tenantId,proof}));}
export async function issueExecutionIsolationAuthority(secret:string,ledger:'legacy'|'g5',tenantId:string,proof:unknown):Promise<string>{const mac=await crypto.subtle.sign('HMAC',await key(secret),await message(ledger,tenantId,proof));return [...new Uint8Array(mac)].map(value=>value.toString(16).padStart(2,'0')).join('');}
export async function verifyExecutionIsolationAuthority(secret:string,ledger:'legacy'|'g5',tenantId:string,proof:unknown,authority:unknown):Promise<void>{if(typeof authority!=='string'||!await crypto.subtle.verify('HMAC',await key(secret),signature(authority),await message(ledger,tenantId,proof)))reject('model-execution-isolation-authority-invalid');}
