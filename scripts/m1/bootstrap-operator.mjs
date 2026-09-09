import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { safePath } from '../m0/source-inventory.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const TOKEN_ENV='RIFFOLOGY_INITIAL_OPERATOR_TOKEN';
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
function safePersistenceDirectory(input){
  if(typeof input!=='string'||input.includes('\0'))throw Error('bootstrap persistence path is invalid');
  const result=resolve(root,input),rel=relative(root,result);
  if(!rel||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw Error('bootstrap persistence path must be inside repository');
  let current=root;for(const part of rel.split(sep)){current=resolve(current,part);const stat=lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('bootstrap persistence path must be a real directory');}
  return result;
}
export function normalizeBootstrapEmail(value){
  const email=String(value??'').trim().toLowerCase();
  if(email.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('invalid_bootstrap_email');
  return email;
}
export function parseBootstrapArgs(argv){
  if(argv[0]!=='invite')throw Error('usage: invite --email EMAIL --database NAME --config PATH (--local|--remote)');
  const result={mode:'invite'};let location=null;
  for(let index=1;index<argv.length;index++){
    const key=argv[index];
    if(key==='--local'||key==='--remote'){if(location)throw Error('one_database_location_required');location=key.slice(2);continue;}
    if(!['--email','--database','--config','--persist-to'].includes(key)||index+1>=argv.length)throw Error('invalid_bootstrap_argument');
    const property=key==='--persist-to'?'persistTo':key.slice(2);if(Object.hasOwn(result,property))throw Error('duplicate_bootstrap_argument');
    result[property]=argv[++index];
  }
  if(!result.email||!result.database||!result.config||!location)throw Error('missing_bootstrap_argument');
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(result.database))throw Error('invalid_database_name');
  if(location==='remote'&&result.persistTo)throw Error('persist_to_requires_local_database');
  return {...result,location,email:normalizeBootstrapEmail(result.email)};
}
export async function bootstrapInitialOperator(options,{token,runSql,now=Date.now(),invitationId=`bootstrap-${randomUUID()}`}={}){
  if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))throw Error('invalid_bootstrap_token');
  if(typeof runSql!=='function')throw Error('missing_sql_runner');
  if(!Number.isSafeInteger(now)||now<0)throw Error('invalid_bootstrap_time');
  if(typeof invitationId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(invitationId))throw Error('invalid_bootstrap_invitation_id');
  const email=normalizeBootstrapEmail(options.email),tokenHash=createHash('sha256').update(token).digest('hex');
  const expiresAt=now+7*86_400_000;
  const insert=`INSERT INTO catalog_invitations(id,token_hash,normalized_email,state,issued_by,created_at,expires_at,purpose) SELECT ${quote(invitationId)},${quote(tokenHash)},${quote(email)},'pending',NULL,${now},${expiresAt},'initial_operator' WHERE NOT EXISTS (SELECT 1 FROM catalog_operator_bootstrap)`;
  let mutationError=false;
  try{await runSql(insert);}catch{mutationError=true;}
  let rows;
  try{rows=await runSql(`SELECT b.invitation_id,b.normalized_email,i.token_hash,i.state,CASE WHEN r.status='active' THEN 1 ELSE 0 END AS operator_ready FROM catalog_operator_bootstrap b JOIN catalog_invitations i ON i.id=b.invitation_id LEFT JOIN catalog_platform_roles r ON r.user_id=i.accepted_by AND r.role='operator' WHERE b.id='initial-operator'`);}
  catch{throw Error('bootstrap_readback_failed');}
  const row=rows?.[0];
  if(!row)throw Error(mutationError?'bootstrap_write_unconfirmed':'bootstrap_not_created');
  if(row.normalized_email!==email||row.token_hash!==tokenHash)throw Error('bootstrap_conflict');
  if(!['pending','accepted'].includes(row.state))throw Error('bootstrap_invitation_unusable');
  if(row.state==='accepted'&&Number(row.operator_ready)!==1)throw Error('bootstrap_invariant_failed');
  return {status:row.state==='accepted'?'operator-ready':'invitation-ready',invitationId:row.invitation_id,replayed:row.invitation_id!==invitationId,recoveredAfterWriteError:mutationError};
}
function wranglerRunner(options){
  const binary=resolve(root,'node_modules/.bin/wrangler');
  const config=safePath(root,resolve(root,options.config),'bootstrap config');
  const persistence=options.persistTo?safePersistenceDirectory(options.persistTo):null;
  const childEnv={...process.env};delete childEnv[TOKEN_ENV];
  return async command=>{
    const args=['d1','execute',options.database,`--${options.location}`,'--config',config,...(persistence?['--persist-to',persistence]:[]),'--command',command,'--json','-y'];
    const child=spawnSync(binary,args,{cwd:root,env:childEnv,encoding:'utf8',timeout:30_000,maxBuffer:1024*1024});
    if(child.status!==0)throw Error('wrangler_d1_execute_failed');
    let parsed;try{parsed=JSON.parse(child.stdout);}catch{throw Error('wrangler_json_invalid');}
    if(!Array.isArray(parsed)||parsed.some(item=>item?.success!==true))throw Error('wrangler_d1_execute_failed');
    return parsed.flatMap(item=>Array.isArray(item.results)?item.results:[]);
  };
}
export async function main(argv=process.argv.slice(2),environment=process.env){
  const options=parseBootstrapArgs(argv),token=environment[TOKEN_ENV];
  const result=await bootstrapInitialOperator(options,{token,runSql:wranglerRunner(options)});
  process.stdout.write(JSON.stringify({...result,tokenPrinted:false,tokenStoredInD1:false})+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(JSON.stringify({error:error.message})+'\n');process.exitCode=1;});
