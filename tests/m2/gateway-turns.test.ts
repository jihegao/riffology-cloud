import test from 'node:test';
import assert from 'node:assert/strict';
import { gateway } from '../../services/gateway/app.ts';
import { ProjectCatalog } from '../../services/catalog/projects.ts';
import { TurnJournal } from '../../services/turn/journal.ts';
import { MemoryTurnStore } from '../../services/turn/store.ts';
import { SqliteCatalog } from '../m1/sqlite-database.ts';
const origin='https://m1.example.test';
async function fixture(){
 const db=new SqliteCatalog(),now=Date.now();
 db.sqlite.prepare(`INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES ('user-a','better-auth','subject-a','alice@example.test',?,?)`).run(now,now);
 db.sqlite.prepare(`INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES ('tenant-a','user-a',?,?)`).run(now,now);
 db.sqlite.prepare(`INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES ('tenant-a','user-a',?,?)`).run(now,now);
 const principal={userId:'user-a',authVersion:1},created=await new ProjectCatalog(db,new Set(['blank-v1'])).create(principal,'tenant-a','project-key',{title:'Project',starterVersion:'blank-v1'}),workspaceId=created.project.workspace_id;
 const journal=new TurnJournal(new MemoryTurnStore(),()=>Date.now());
 const artifactId=`artifact-${'a'.repeat(60)}`,artifactContent=new TextEncoder().encode(JSON.stringify({kind:'read',content:'x'.repeat(20_000)})),artifactSha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',artifactContent))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 const services={origin,database:db,identity:async()=>({subject:'subject-a',email:'alice@example.test',emailVerified:true,platformVersion:1}),turns:{
  createSession:(scope:any,actor:any,key:string,body:any)=>journal.createSession(scope,actor,key,body),
  submit:(scope:any,actor:any,sessionId:string,key:string,body:any)=>journal.submit(scope,actor,sessionId,key,body),
  cancel:(scope:any,actor:any,turnId:string)=>journal.cancel(scope,actor,turnId),
  replay:(scope:any,afterSequence:number,limit:number)=>journal.replay(scope,afterSequence,limit),
  snapshot:(scope:any)=>journal.view(scope),
  files:async()=>({schemaVersion:1,revision:null,files:[]}),
  diff:async()=>({schemaVersion:1,revision:null,summary:{added:0,modified:0,deleted:0},changes:[]}),
  artifact:async(_scope:any,id:string)=>{if(id!==artifactId)throw Error('tool-artifact-not-found');return {receipt:{schemaVersion:1,artifactId,operation:'read',mediaType:'application/json',bytes:artifactContent.byteLength,sha256:artifactSha,createdAt:1500},content:artifactContent};},
 }};
 const get=(path:string,headers?:HeadersInit)=>gateway(new Request(origin+path,{headers}),services),post=(path:string,key:string,body:unknown,requestOrigin=origin)=>gateway(new Request(origin+path,{method:'POST',headers:{origin:requestOrigin,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)}),services);
 return {db,journal,services,workspaceId,artifactId,artifactContent,artifactSha,get,post,ready(){db.sqlite.prepare("UPDATE catalog_projects SET status='ready' WHERE workspace_id=?").run(workspaceId);db.sqlite.prepare("UPDATE catalog_workspaces SET status='ready' WHERE id=?").run(workspaceId);}};
}
test('authenticated ready workspace exposes durable session, turn, cancel, snapshot and event cursor APIs',async()=>{
 const f=await fixture();try{
  assert.equal((await f.post(`/api/workspaces/${f.workspaceId}/sessions`,'session-one',{title:'Session'})).status,409);f.ready();
  const created=await f.post(`/api/workspaces/${f.workspaceId}/sessions`,'session-one',{title:'Session'});assert.equal(created.status,201);const s=await created.json() as any;
  const replay=await f.post(`/api/workspaces/${f.workspaceId}/sessions`,'session-one',{title:'Session'});assert.equal(replay.status,200);assert.equal((await replay.json() as any).session.id,s.session.id);
  assert.equal((await f.post(`/api/workspaces/${f.workspaceId}/sessions`,'session-one',{title:'Changed'})).status,409);
  const submitted=await f.post(`/api/workspaces/${f.workspaceId}/sessions/${s.session.id}/turns`,'turn-one',{message:'Build a model'});assert.equal(submitted.status,202);const t=await submitted.json() as any;assert.equal(t.turn.payloadSha256,undefined);assert.equal(t.turn.requestKey,undefined);assert.equal(t.turn.dispatchId,undefined);assert.equal(t.turn.resourceLease,undefined);assert.deepEqual(t.turn.actor,{userId:'user-a'});
  const turnReplay=await f.post(`/api/workspaces/${f.workspaceId}/sessions/${s.session.id}/turns`,'turn-one',{message:'Build a model'});assert.equal(turnReplay.status,200);assert.equal((await turnReplay.json() as any).turn.id,t.turn.id);
  const events=await (await f.get(`/api/workspaces/${f.workspaceId}/events?after_sequence=0&limit=10`)).json() as any;assert.equal(events.events.length,1);assert.equal(events.events[0].type,'turn.queued');
  const cancelled=await f.post(`/api/workspaces/${f.workspaceId}/turns/${t.turn.id}/cancel`,'unused',{});assert.equal(cancelled.status,200);assert.equal((await cancelled.json() as any).status,'cancelled');
  const snapshot=await (await f.get(`/api/workspaces/${f.workspaceId}`)).json() as any;assert.equal(snapshot.turns[t.turn.id].status,'cancelled');assert.equal(snapshot.activeTurnId,null);assert.equal(snapshot.sessions[s.session.id].actorAuthVersion,undefined);
  assert.deepEqual(await (await f.get(`/api/workspaces/${f.workspaceId}/files`)).json(),{schemaVersion:1,revision:null,files:[]});
  assert.deepEqual(await (await f.get(`/api/workspaces/${f.workspaceId}/diff`)).json(),{schemaVersion:1,revision:null,summary:{added:0,modified:0,deleted:0},changes:[]});
  const artifact=await f.get(`/api/workspaces/${f.workspaceId}/artifacts/${f.artifactId}`);assert.equal(artifact.status,200);assert.equal(artifact.headers.get('content-type'),'application/json; charset=utf-8');assert.equal(artifact.headers.get('content-length'),String(f.artifactContent.byteLength));assert.equal(artifact.headers.get('x-riffology-artifact-id'),f.artifactId);assert.equal(artifact.headers.get('x-riffology-artifact-sha256'),f.artifactSha);assert.equal(artifact.headers.get('cache-control'),'no-store');assert.deepEqual(new Uint8Array(await artifact.arrayBuffer()),f.artifactContent);
 }finally{f.db.sqlite.close();}
});
test('gateway SSE resumes from Last-Event-ID and rechecks current catalog authority',async()=>{
 const f=await fixture();try{f.ready();
  const session=await (await f.post(`/api/workspaces/${f.workspaceId}/sessions`,'sse-session',{title:'Session'})).json() as any;
  await f.post(`/api/workspaces/${f.workspaceId}/sessions/${session.session.id}/turns`,'sse-turn',{message:'Build'});
  const response=await f.get(`/api/workspaces/${f.workspaceId}/events?after_sequence=0`,{accept:'text/event-stream','last-event-id':'0',origin});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/^text\/event-stream/);
  const reader=response.body!.getReader(),first=await reader.read(),decoder=new TextDecoder();
  assert.match(decoder.decode(first.value),/id: 1\nevent: turn\.queued/);
  assert.equal((await f.get(`/api/workspaces/${f.workspaceId}/events`,{accept:'text/event-stream','last-event-id':'invalid',origin})).status,400);
  f.db.sqlite.prepare("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id='tenant-a' AND user_id='user-a'").run();
  let closed='';for(let i=0;i<3&&!closed.includes('authorization_changed');i++){const next=await reader.read();if(next.done)break;closed+=decoder.decode(next.value);}
  assert.match(closed,/event: stream\.closed\ndata: {"reason":"authorization_changed"}/);await reader.cancel();
 }finally{f.db.sqlite.close();}
});
test('workspace turn routes fail closed on ownership, revocation, CSRF, shape and cursor errors',async()=>{
 const f=await fixture();try{f.ready();
  assert.equal((await f.post(`/api/workspaces/${f.workspaceId}/sessions`,'one',{title:'Session'},'https://attacker.test')).status,403);
  assert.equal((await f.post(`/api/workspaces/${f.workspaceId}/sessions`,'',{title:'Session'})).status,400);
  assert.equal((await f.post(`/api/workspaces/${f.workspaceId}/sessions`,'one',{title:'Session',extra:true})).status,400);
  assert.equal((await f.get(`/api/workspaces/${f.workspaceId}/events?after_sequence=-1`)).status,400);
  assert.equal((await f.get('/api/workspaces/unknown')).status,404);
  assert.equal((await f.get('/api/workspaces/unknown/files')).status,404);
  assert.equal((await f.get('/api/workspaces/unknown/diff')).status,404);
  assert.equal((await f.get(`/api/workspaces/${f.workspaceId}/artifacts/artifact-${'c'.repeat(60)}`)).status,404);
  f.db.sqlite.prepare('UPDATE catalog_users SET auth_version=2 WHERE id=?').run('user-a');assert.equal((await f.get(`/api/workspaces/${f.workspaceId}`)).status,404);
  assert.equal((await f.get(`/api/workspaces/${f.workspaceId}/files`)).status,404);
  assert.equal((await f.get(`/api/workspaces/${f.workspaceId}/diff`)).status,404);
  assert.equal((await f.get(`/api/workspaces/${f.workspaceId}/artifacts/${f.artifactId}`)).status,404);
 }finally{f.db.sqlite.close();}
});

test('workspace recovery hold accepts new queued work while read APIs remain available',async()=>{
 const f=await fixture();try{f.ready();
  const session=await (await f.post(`/api/workspaces/${f.workspaceId}/sessions`,'hold-session',{title:'Hold'})).json() as any;
  const submitted=await (await f.post(`/api/workspaces/${f.workspaceId}/sessions/${session.session.id}/turns`,'hold-turn',{message:'Build'})).json() as any;
  const claim=await f.journal.claim(session.session.scope,1),dispatchId=claim!.turn.dispatchId!;
  await f.journal.beginCheckpoint(session.session.scope,{turnId:submitted.turn.id,dispatchId,runtimeGeneration:1,outcome:'completed'});
  await f.journal.failCheckpoint(session.session.scope,{turnId:submitted.turn.id,dispatchId,runtimeGeneration:1,errorCode:'turn-checkpoint-recovery-hold'});
  const queued=await f.post(`/api/workspaces/${f.workspaceId}/sessions/${session.session.id}/turns`,'blocked-turn',{message:'Queued behind recovery'});assert.equal(queued.status,202);assert.equal((await queued.json() as any).turn.status,'queued');
  assert.equal((await f.get(`/api/workspaces/${f.workspaceId}`)).status,200);assert.equal((await f.get(`/api/workspaces/${f.workspaceId}/files`)).status,200);
 }finally{f.db.sqlite.close();}
});


test('turn mutation replay and cancel never publish private base or journal sequence fields',async()=>{
 const f=await fixture();try{
  f.ready();
  const session=await (await f.post(`/api/workspaces/${f.workspaceId}/sessions`,'private-session',{title:'Private base'})).json() as any;
  await f.post(`/api/workspaces/${f.workspaceId}/sessions/${session.session.id}/turns`,'private-turn',{message:'Build'});
  const claimed=await f.journal.claim(session.session.scope,1);assert.ok(claimed?.turn.base);
  const replay=await (await f.post(`/api/workspaces/${f.workspaceId}/sessions/${session.session.id}/turns`,'private-turn',{message:'Build'})).json() as any;
  const cancelled=await (await f.post(`/api/workspaces/${f.workspaceId}/turns/${claimed!.turn.id}/cancel`,'unused',{})).json() as any;
  await f.journal.beginCheckpoint(session.session.scope,{turnId:claimed!.turn.id,dispatchId:claimed!.turn.dispatchId!,runtimeGeneration:1,outcome:'completed'});await f.journal.commitCheckpoint(session.session.scope,{turnId:claimed!.turn.id,dispatchId:claimed!.turn.dispatchId!,runtimeGeneration:1,checkpoint:{revisionId:'revision-private',objectKey:'turns/private.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:claimed!.turn.startedAt!}});const terminal=await (await f.post(`/api/workspaces/${f.workspaceId}/turns/${claimed!.turn.id}/cancel`,'unused',{})).json() as any;
  for(const turn of [replay.turn,cancelled,terminal]){for(const key of ['requestKey','payloadSha256','dispatchId','base','resourceLease','startedSequence','terminalSequence'])assert.equal(Object.hasOwn(turn,key),false,key);assert.deepEqual(turn.actor,{userId:'user-a'});}
 }finally{f.db.sqlite.close();}
});

test('Managed admission blocks retain safe reason codes instead of becoming generic 503s',async()=>{
 const f=await fixture();try{f.ready();
  const codes=['managed-execution-unknown','managed-usage-unknown','managed-original-unresolved','managed-input-in-flight','managed-session-base-unavailable','managed-admission-denied'];
  for(const code of codes){f.services.turns.submit=async()=>{throw Error(code);};const response=await f.post(`/api/workspaces/${f.workspaceId}/sessions/session-a/turns`,'retry',{message:'Retry'});assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:code});}
  f.services.turns.submit=async()=>{throw Error('opaque private provider detail');};const response=await f.post(`/api/workspaces/${f.workspaceId}/sessions/session-a/turns`,'retry',{message:'Retry'});assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'temporarily_unavailable'});
 }finally{f.db.sqlite.close();}
});
