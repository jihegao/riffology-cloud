import { positive, scope as validateScope, turnId, type TurnScope } from '../turn/protocol.ts';
import { normalizeToolCommand, toolCommandDigest, type ToolCommand } from '../tools/protocol.ts';

export const PROJECT_EFFECT_CAPABILITY_MAX_TTL_MS=10*60_000;
const ACTOR=/^[a-z0-9-]{1,63}$/;
const MAC=/^[a-f0-9]{64}$/;
const encoder=new TextEncoder();

export type ProjectEffectCapabilityClaims={
  schemaVersion:1;
  purpose:'project-file-effect';
  actorId:string;
  scope:TurnScope;
  turnId:string;
  dispatchId:string;
  commandId:string;
  effectId:string;
  commandDigest:string;
  expiresAt:number;
};
export type ProjectEffectCapability={claims:ProjectEffectCapabilityClaims;mac:string};

function reject(code:string):never{throw Error(code);}
function exact(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject(code);
}
function actorId(value:unknown):string{if(typeof value!=='string'||!ACTOR.test(value))reject('invalid-project-effect-actor');return value;}
function hex(value:unknown):string{if(typeof value!=='string'||!MAC.test(value))reject('invalid-project-effect-capability');return value;}
function keyBytes(value:unknown):ArrayBuffer{
  if(typeof value!=='string')reject('invalid-project-effect-capability-key');
  const bytes=encoder.encode(value);if(bytes.byteLength<32||bytes.byteLength>256)reject('invalid-project-effect-capability-key');return bytes.buffer as ArrayBuffer;
}
function signatureBytes(value:string):ArrayBuffer{return Uint8Array.from(value.match(/../g)!.map(pair=>Number.parseInt(pair,16))).buffer as ArrayBuffer;}
function claimsText(value:ProjectEffectCapabilityClaims):string{return JSON.stringify(value);}
async function signingKey(value:string):Promise<CryptoKey>{return crypto.subtle.importKey('raw',keyBytes(value),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function sign(key:string,value:ProjectEffectCapabilityClaims):Promise<string>{
  const bytes=await crypto.subtle.sign('HMAC',await signingKey(key),encoder.encode(claimsText(value)));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function normalizedClaims(value:unknown):ProjectEffectCapabilityClaims{
  exact(value,['schemaVersion','purpose','actorId','scope','turnId','dispatchId','commandId','effectId','commandDigest','expiresAt'],'invalid-project-effect-capability');
  if(value.schemaVersion!==1||value.purpose!=='project-file-effect')reject('invalid-project-effect-capability');
  const commandDigest=hex(value.commandDigest);
  return {schemaVersion:1,purpose:'project-file-effect',actorId:actorId(value.actorId),scope:validateScope(value.scope),turnId:turnId(value.turnId),dispatchId:turnId(value.dispatchId),commandId:turnId(value.commandId),effectId:turnId(value.effectId),commandDigest,expiresAt:positive(value.expiresAt)};
}

/** Tool Bridge issues this only after its durable Tool Ledger returns the
 * one-shot dispatch authorization. The capability is bound to one named
 * Project Sandbox actor and one immutable command/effect identity. */
export async function issueProjectEffectCapability(key:string,input:{actorId:string;command:ToolCommand;effectId:string;expiresAt:number},now=Date.now):Promise<ProjectEffectCapability>{
  const command=normalizeToolCommand(input.command),observed=positive(now()),expiresAt=positive(input.expiresAt);
  if(expiresAt<=observed||expiresAt-observed>PROJECT_EFFECT_CAPABILITY_MAX_TTL_MS)reject('invalid-project-effect-capability-expiry');
  const claims:ProjectEffectCapabilityClaims={schemaVersion:1,purpose:'project-file-effect',actorId:actorId(input.actorId),scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,effectId:turnId(input.effectId),commandDigest:await toolCommandDigest(command),expiresAt};
  return {claims,mac:await sign(key,claims)};
}

/** The Project Sandbox revalidates the platform capability at its RPC edge.
 * Reissuing a capability after expiry requires the platform signing key and a
 * fresh durable-ledger authorization check; the key is never put in envVars. */
export async function verifyProjectEffectCapability(key:string,expectedActorId:string,commandInput:ToolCommand,effectIdInput:string,capabilityInput:unknown,now=Date.now):Promise<ProjectEffectCapabilityClaims>{
  exact(capabilityInput,['claims','mac'],'invalid-project-effect-capability');
  const claims=normalizedClaims(capabilityInput.claims),mac=hex(capabilityInput.mac),command=normalizeToolCommand(commandInput),effectId=turnId(effectIdInput),observed=positive(now());
  if(claims.expiresAt<=observed||claims.expiresAt-observed>PROJECT_EFFECT_CAPABILITY_MAX_TTL_MS)reject('project-effect-capability-expired');
  if(claims.actorId!==actorId(expectedActorId)||claims.effectId!==effectId||claims.turnId!==command.turnId||claims.dispatchId!==command.dispatchId||claims.commandId!==command.commandId)reject('project-effect-capability-mismatch');
  if(claims.scope.tenantId!==command.scope.tenantId||claims.scope.projectId!==command.scope.projectId||claims.scope.workspaceId!==command.scope.workspaceId||claims.scope.workspaceGeneration!==command.scope.workspaceGeneration)reject('project-effect-capability-mismatch');
  if(claims.commandDigest!==await toolCommandDigest(command))reject('project-effect-capability-mismatch');
  const valid=await crypto.subtle.verify('HMAC',await signingKey(key),signatureBytes(mac),encoder.encode(claimsText(claims)));
  if(!valid)reject('project-effect-capability-invalid-signature');
  return claims;
}
