import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DurableTurnStore} from '../../services/turn/store.ts';
import {TurnJournal} from '../../services/turn/journal.ts';

test('frozen production v7 reader reads ordinary new writes; manual history requires the compatible reader',async t=>{
 const fixture=new URL('../fixtures/manual-save-v7-reader/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',fixture),'utf8'));
 const directory=await mkdtemp(join(tmpdir(),'manual-v7-reader-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 for(const name of ['store.ts','protocol.ts']){
  const raw=await readFile(new URL(name+'.txt',fixture));assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.files[name].sha256);
  const source=raw.toString().replace("'../browser-preview/discovery.ts'",JSON.stringify(new URL('../../services/browser-preview/discovery.ts',import.meta.url).href)).replace("'../turn-runtime/initial-workspace.ts'",JSON.stringify(new URL('../../services/turn-runtime/initial-workspace.ts',import.meta.url).href));
  await writeFile(join(directory,name),source);
 }
 const {DurableTurnStore:ProductionStore}=await import(pathToFileURL(join(directory,'store.ts')).href);
 const values=new Map(),tx={get:async k=>values.get(k),put:async(k,v)=>values.set(k,structuredClone(v)),list:async({prefix})=>new Map([...values].filter(([k])=>k.startsWith(prefix))),delete:async k=>values.delete(k),setAlarm:async()=>{},deleteAlarm:async()=>{}};
 const storage={kv:{get:k=>values.get(k)},transaction:async f=>f(tx),sync:async()=>{}};
 const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1};let now=1000;
 const journal=new TurnJournal(new DurableTurnStore(storage),()=>++now),old=new ProductionStore(storage);
 const session=(await journal.createSession(scope,actor,'session',{title:'Compatibility'})).session;
 const cancelled=(await journal.submit(scope,actor,session.id,'cancel',{message:'Cancel'})).turn;await journal.cancel(scope,actor,cancelled.id);assert.equal(old.read().turns[cancelled.id].status,'cancelled');
 const saved=(await journal.submit(scope,actor,session.id,'saved',{message:'Save'})).turn,claimed=(await journal.claim(scope,1)).turn;
 await journal.beginCheckpoint(scope,{turnId:saved.id,dispatchId:claimed.dispatchId,runtimeGeneration:1,outcome:'completed'});
 const checkpoint={revisionId:'old-readable',objectKey:'turns/saved.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:++now};
 await journal.commitCheckpoint(scope,{turnId:saved.id,dispatchId:claimed.dispatchId,runtimeGeneration:1,checkpoint});assert.deepEqual(old.read().workspaceHead,checkpoint);assert.equal(values.get('m2:turn-journal').schemaVersion,7);
 await journal.rejectManualSave(scope,actor,'manual-rejection','c'.repeat(64),'manual-save-base-conflict');assert.equal(values.get('m2:turn-journal').schemaVersion,9);assert.throws(()=>old.read(),/invalid-persisted/);
 const recovered=new DurableTurnStore(storage).read();assert.deepEqual(recovered.workspaceHead,checkpoint);assert.ok(recovered.manualRejections['user-a|manual-rejection']);
});
