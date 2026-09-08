const encoder=new TextEncoder();
const MAC=/^[a-f0-9]{64}$/;
const CONTAINER=/^[A-Za-z0-9-]{1,128}$/;
function reject(code:string):never{throw Error(code);}
function keyBytes(value:unknown):ArrayBuffer{if(typeof value!=='string')reject('invalid-tool-bridge-key');const bytes=encoder.encode(value);if(bytes.byteLength<32||bytes.byteLength>256)reject('invalid-tool-bridge-key');return bytes.buffer as ArrayBuffer;}
function containerId(value:unknown):string{if(typeof value!=='string'||!CONTAINER.test(value))reject('invalid-tool-bridge-container');return value;}
function at(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)reject('invalid-tool-bridge-time');return value;}
async function key(value:string):Promise<CryptoKey>{return crypto.subtle.importKey('raw',keyBytes(value),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function digest(body:ArrayBuffer):Promise<string>{const bytes=await crypto.subtle.digest('SHA-256',body);return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function message(rawContainerId:string,requestAt:number,body:ArrayBuffer):Promise<ArrayBuffer>{return encoder.encode(JSON.stringify({schemaVersion:1,purpose:'trusted-pi-tool-request',containerId:containerId(rawContainerId),requestAt:at(requestAt),bodySha256:await digest(body)})).buffer as ArrayBuffer;}
export async function signTrustedToolRequest(secret:string,rawContainerId:string,requestAt:number,body:ArrayBuffer):Promise<string>{const signed=await crypto.subtle.sign('HMAC',await key(secret),await message(rawContainerId,requestAt,body));return [...new Uint8Array(signed)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function verifyTrustedToolRequest(secret:string,rawContainerId:string,requestAt:number,body:ArrayBuffer,rawMac:string):Promise<void>{
  if(typeof rawMac!=='string'||!MAC.test(rawMac))reject('invalid-tool-bridge-mac');
  const signature=Uint8Array.from(rawMac.match(/../g)!.map(pair=>Number.parseInt(pair,16))).buffer as ArrayBuffer;
  if(!await crypto.subtle.verify('HMAC',await key(secret),signature,await message(rawContainerId,requestAt,body)))reject('invalid-tool-bridge-signature');
}
