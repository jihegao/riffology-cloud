import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqlServiceRunJournal,type ServiceRunStorage,type ServiceRunSpec,type ServiceRuntimeReference} from '../../services/run/service.ts';
export const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
export const actor={userId:'user-a',authVersion:1};
export function spec():ServiceRunSpec{return {plan:{schemaVersion:1,kind:'service',identity:{scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'turn-dispatch',generation:1},revision:{revisionId:'revision-a',objectKey:'saved/revision',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1},declaration:{schemaVersion:1,runtime:'python',entrypoint:'app/main.py',dependencyLock:'app/requirements.lock',port:8080,healthPath:'/health'},declarationSha256:'c'.repeat(64),entrypointSha256:'d'.repeat(64),dependencyLockSha256:'e'.repeat(64)},runtimeImage:'registry.example/runtime@sha256:'+'f'.repeat(64),maxDurationMs:5000};}
export function reference(runId:string):ServiceRuntimeReference{return {runId,runtimeId:'runtime-a',dispatchId:'dispatch-a',leaseId:'lease-a',generation:1,deadlineAt:5000};}
export function fixture(t:{after(fn:()=>void):void}){
 const dir=mkdtempSync(join(tmpdir(),'m3-service-')),path=join(dir,'state.sqlite');let db=new DatabaseSync(path),now=1000,fail=false,seq=0;
 const storage={sql:{exec(query:string,...args:(string|number|null)[]){if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}const statement=db.prepare(query);const rows=statement.columns().length?statement.all(...args):(statement.run(...args),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},async sync(){if(fail){fail=false;throw Error('injected-ack-loss');}}} as unknown as ServiceRunStorage;
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 return {host:()=>new SqlServiceRunJournal(storage,scope,()=>now,()=>`run-${++seq}`),storage,get db(){return db;},get now(){return now;},set now(n:number){now=n;},failNextSync(){fail=true;},reopen(){db.close();db=new DatabaseSync(path);}};
}
