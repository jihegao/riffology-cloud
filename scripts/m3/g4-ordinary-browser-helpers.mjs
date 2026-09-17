import {resolveParameters} from '../../services/simulation/model-spec.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export const COUNTERS=['modelUpstreamDispatches','simulationStarts','projectRuntimeStarts','projectToolDispatches','trustedPiStarts','trustedPiTaskDispatches'];
export function privateJson(file){const s=fs.lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o077)===0,'private input must be regular mode0600');return JSON.parse(fs.readFileSync(file,'utf8'));}
export function saveOnce(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
export function validScope(v){for(const k of ['userId','tenantId'])assert(typeof v[k]==='string'&&v[k]);assert(/^https:\/\//.test(v.origin));return v;}
export function localDelta(before,after,scope){for(const v of [before,after]){for(const k of ['userId','tenantId'])assert.equal(v[k],scope[k]);assert(v.releaseIdentity&&v.observedAt);for(const k of COUNTERS)assert(Number.isSafeInteger(v.counts?.[k])&&v.counts[k]>=0,`missing actual count ${k}`);}assert.equal(before.releaseIdentity,after.releaseIdentity);for(const k of COUNTERS)assert.equal(after.counts[k],before.counts[k],`local execution delta ${k}`);return Object.fromEntries(COUNTERS.map(k=>[k,after.counts[k]-before.counts[k]]));}
// Operator-owned executable; argv JSON avoids shell interpolation. No generic RPC forwarding.
export async function hook(envName,input){
 const raw=process.env[envName];assert(raw,`${envName} required`);const argv=JSON.parse(raw);assert(Array.isArray(argv)&&argv.length&&argv.every(v=>typeof v==='string'));
 return new Promise((resolve,reject)=>{
  const p=spawn(argv[0],argv.slice(1),{stdio:['pipe','pipe','pipe']});let out='',err='',timedOut=false,limitExceeded=null,spawnError=null;
  const t=setTimeout(()=>{timedOut=true;p.kill('SIGKILL');},30000);
  const persist=(code,signal,reason)=>{assert(process.env.G4_EVIDENCE_DIR,'private hook evidence directory required');fs.mkdirSync(process.env.G4_EVIDENCE_DIR,{recursive:true,mode:0o700});const base=path.join(process.env.G4_EVIDENCE_DIR,'hook-failure-'+randomUUID());fs.writeFileSync(base+'.stderr',err,{flag:'wx',mode:0o600});saveOnce(base+'.json',{at:Date.now(),hook:envName,stage:input.hookPhase??input.phase??'operator-hook',intentId:input.intentId??null,exitCode:code,signal:signal??null,timedOut,limitExceeded,reason,stderrFile:base+'.stderr',readOnlyHook:true});};
  p.stdout.on('data',b=>{out+=b;if(out.length>1048576){limitExceeded='stdout';p.kill('SIGKILL');}});
  p.stderr.on('data',b=>{if(err.length<65536)err+=b.toString().slice(0,65536-err.length);if(err.length>=65536){limitExceeded='stderr';p.kill('SIGKILL');}});
  p.on('error',e=>{spawnError=e.message;});
  p.on('close',(code,signal)=>{clearTimeout(t);let value;try{if(code!==0||spawnError)throw Error(spawnError??`${envName} rejected (exit ${code}, signal ${signal??'none'})`);value=JSON.parse(out);}catch(e){try{persist(code,signal,e.message);}catch(proof){return reject(Error(`${envName} rejected; private failure evidence unavailable: ${proof.message}`));}return reject(Error(`${envName} rejected; inspect private hook failure evidence`));}resolve(value);});
  p.stdin.on('error',()=>{});p.stdin.end(JSON.stringify(input));
 });
}
export function checkGuard(g,intent){assert.equal(g.approved,true);assert.equal(g.ready,true);assert.equal(g.tenantId,intent.tenantId);assert.equal(g.userId,intent.userId);assert.equal(g.intentId,intent.intentId);assert(g.releaseIdentity);assert(Number.isFinite(g.dueAt)&&g.dueAt>Date.now());assert(Number.isFinite(g.observedAt)&&Date.now()-g.observedAt<15000);assert(g.remaining&&Number.isFinite(g.remaining.usd)&&g.remaining.usd>0);assert(Number.isInteger(g.remaining.upstreamCalls)&&Number.isInteger(g.remaining.serverRuns));if(intent.kind==='turn')assert(g.remaining.upstreamCalls>0&&g.remaining.turnUsd>0&&g.remaining.turnUsd<=5);if(['verify','group','run'].includes(intent.kind))assert(g.remaining.serverRuns>=intent.runCount);assert(g.totalUsd<=20);}

export function checkedInput(spec,input){assert(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).sort().join(',')==='parameters,seed');assert(Number.isInteger(input.seed)&&input.seed>=0&&input.seed<=4294967295,'invalid seed');return {parameters:resolveParameters(spec,input.parameters),seed:input.seed};}
