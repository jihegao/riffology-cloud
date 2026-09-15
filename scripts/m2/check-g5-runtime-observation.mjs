#!/usr/bin/env node
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {qualifyRuntimeObservation} from './g5-runtime-observation-contract.mjs';
// Explicit local input only. Never imports release runners or contacts cloud APIs.
try {
  const args=process.argv.slice(2);
  if(args.length!==1||!args[0].startsWith('--input=')||!args[0].slice(8))throw Error('one-input-required');
  const path=realpathSync(resolve(args[0].slice(8))),root=dirname(path),input=JSON.parse(readFileSync(path,'utf8'));
  const result=qualifyRuntimeObservation(input),errors=[...result.reasonCodes];
  const files=Array.isArray(input.evidenceFiles)?input.evidenceFiles:[];
  const observed=new Set();
  for(const file of files){
    if(typeof file.path!=='string'||isAbsolute(file.path))throw Error('evidence-path-invalid');
    const actual=realpathSync(resolve(root,file.path)),rel=relative(root,actual);
    if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw Error('evidence-path-outside-input-directory');
    const sha=createHash('sha256').update(readFileSync(actual)).digest('hex');
    if(sha!==file.sha256)throw Error('evidence-sha256-mismatch');
    observed.add(sha);
  }
  for(const sha of [...(input.turns??[]).map(t=>t.rawEvidenceSha256),input.release?.project?.rawEvidenceSha256,input.release?.pi?.rawEvidenceSha256])if(!observed.has(sha))errors.push('raw-evidence-file-not-verified');
  const output={...result,status:errors.length?'blocked':'qualified',reasonCodes:[...new Set(errors)],verifiedEvidenceFiles:observed.size};
  process.stdout.write(`${JSON.stringify(output,null,2)}\n`);if(errors.length)process.exitCode=1;
} catch(error){process.stdout.write(`${JSON.stringify({status:'blocked',qualificationOnly:true,cloudAcceptance:false,reasonCodes:[error.message]})}\n`);process.exitCode=1;}
