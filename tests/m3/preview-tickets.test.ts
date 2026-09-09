import test from 'node:test';
import assert from 'node:assert/strict';
import {SqlPreviewTickets,type PreviewTicketPorts} from '../../services/preview/tickets.ts';
import type {PreviewBinding} from '../../services/preview/bindings.ts';
import {fixture,scope,spec,reference} from './run-fixture.ts';
const nonce='19'.repeat(32);
function setup(t:Parameters<typeof fixture>[0]){
 const f=fixture(t),principal={userId:'user-a',authVersion:1,subject:'auth-user-a',sessionId:'session-a',expiresAt:100000};
 let current:PreviewBinding={previewId:'preview-a',scope,runId:'run-a',source:spec().plan.source,runtime:{...reference('run-a'),deadlineAt:90000},createdAt:500,expiresAt:90000,revokedAt:null,reason:null},revoked=false;
 const calls:{session:number;target:number}={session:0,target:0};
 const ports:PreviewTicketPorts={async session(p,s){calls.session++;assert.deepEqual(p,principal);assert.deepEqual(s,scope);if(revoked)throw Error('fixture-session-revoked');},async target(id){calls.target++;if(id!==current.previewId)throw Error('fixture-target-replaced');return structuredClone(current);}};
 return {f,principal,ports,calls,get binding(){return current;},set binding(v:PreviewBinding){current=v;},revokeSession(){revoked=true;},host:()=>new SqlPreviewTickets(f.storage,scope,ports,()=>f.now)};
}
test('ticket is one-use across reopen; wrong nonce never consumes and persistence has only secret hashes',async t=>{
 const x=setup(t),h=x.host(),issued=await h.issue(x.principal,'preview-a',nonce);assert.match(issued.ticket,/^[a-f0-9]{64}$/);assert.equal(issued.expiresAt,31000);
 const rows=x.f.db.prepare('SELECT * FROM preview_tickets').all();assert.equal(rows.length,1);const persisted=JSON.stringify(rows);assert.equal(persisted.includes(issued.ticket),false);assert.equal(persisted.includes(nonce),false);assert.match(String(rows[0].ticket_hash),/^[a-f0-9]{64}$/);assert.match(String(rows[0].nonce_hash),/^[a-f0-9]{64}$/);
 await assert.rejects(h.redeem(issued.ticket,'b'.repeat(64)),/denied/);assert.equal(x.f.db.prepare('SELECT consumed_at FROM preview_tickets').get()!.consumed_at,null);
 const claims=await h.redeem(issued.ticket,nonce);assert.equal(claims.purpose,'browser');assert.deepEqual(claims.principal,x.principal);assert.deepEqual(claims.binding,x.binding);claims.binding.runtime.runtimeId='mutated';
 x.f.reopen();await assert.rejects(x.host().redeem(issued.ticket,nonce),/denied/);assert.equal(x.f.db.prepare('SELECT consumed_at FROM preview_tickets').get()!.consumed_at,1000);
});
test('concurrent redemption has exactly one success',async t=>{const x=setup(t),h=x.host(),issued=await h.issue(x.principal,'preview-a',nonce);const results=await Promise.allSettled([h.redeem(issued.ticket,nonce),h.redeem(issued.ticket,nonce),h.redeem(issued.ticket,nonce)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,2);});
test('expired ticket, replaced target and revoked session cannot redeem',async t=>{
 for(const mode of ['expired','target','session'] as const){const x=setup(t),h=x.host(),issued=await h.issue(x.principal,'preview-a',nonce);if(mode==='expired')x.f.now=issued.expiresAt;else if(mode==='target')x.binding={...x.binding,previewId:'replacement'};else x.revokeSession();await assert.rejects(h.redeem(issued.ticket,nonce));assert.equal(x.f.db.prepare('SELECT consumed_at FROM preview_tickets').get()!.consumed_at,null);}
});
test('lost sync acknowledgement after consumption never permits a second redemption',async t=>{const x=setup(t),h=x.host(),issued=await h.issue(x.principal,'preview-a',nonce);x.f.failNextSync();await assert.rejects(h.redeem(issued.ticket,nonce),/ack-loss/);x.f.reopen();await assert.rejects(x.host().redeem(issued.ticket,nonce),/denied/);assert.equal(x.f.db.prepare('SELECT consumed_at FROM preview_tickets').get()!.consumed_at,1000);});
test('ticket lifetime is capped by session and runtime, and scope is permanently pinned',async t=>{
 const x=setup(t),h=x.host();x.principal.expiresAt=9000;assert.equal((await h.issue(x.principal,'preview-a',nonce)).expiresAt,9000);x.binding={...x.binding,expiresAt:4000,runtime:{...x.binding.runtime,deadlineAt:4000}};assert.equal((await h.issue(x.principal,'preview-a',nonce)).expiresAt,4000);
 assert.throws(()=>new SqlPreviewTickets(x.f.storage,{...scope,tenantId:'other'},x.ports,()=>x.f.now),/scope-denied/);x.binding={...x.binding,scope:{...scope,workspaceId:'other'}};await assert.rejects(h.issue(x.principal,'preview-a',nonce),/denied/);
});
test('authorization rechecks session after target observation and rejects changed immutable binding',async t=>{
 const x=setup(t),h=x.host(),issued=await h.issue(x.principal,'preview-a',nonce);const target=x.ports.target;x.ports.target=async id=>{const value=await target(id);x.revokeSession();return value;};await assert.rejects(h.redeem(issued.ticket,nonce),/revoked/);
 const y=setup(t),other=y.host(),ticket=await other.issue(y.principal,'preview-a',nonce);y.binding={...y.binding,runtime:{...y.binding.runtime,runtimeId:'other-runtime'}};await assert.rejects(other.redeem(ticket.ticket,nonce),/denied/);
});
test('one workspace caps live tickets at 256 and expired rows are cleaned before a new issue',async t=>{
 const x=setup(t),h=x.host();
 for(let i=0;i<256;i++)await h.issue(x.principal,'preview-a',nonce);
 assert.equal(x.f.db.prepare('SELECT COUNT(*) AS n FROM preview_tickets').get()!.n,256);
 await assert.rejects(h.issue(x.principal,'preview-a',nonce),/capacity/);
 assert.equal(x.f.db.prepare('SELECT COUNT(*) AS n FROM preview_tickets').get()!.n,256);
 x.f.now=31001;
 const next=await h.issue(x.principal,'preview-a',nonce);
 assert.equal(next.expiresAt,61001);
 assert.equal(x.f.db.prepare('SELECT COUNT(*) AS n FROM preview_tickets').get()!.n,1);
});
test('expiry during post-consumption sync denies the response but keeps the ticket consumed',async t=>{
 const x=setup(t),h=x.host(),issued=await h.issue(x.principal,'preview-a',nonce),storage=x.f.storage as {sync:()=>Promise<void>};
 storage.sync=async()=>{x.f.now=issued.expiresAt;};
 await assert.rejects(h.redeem(issued.ticket,nonce),/denied/);
 assert.equal(x.f.db.prepare('SELECT consumed_at FROM preview_tickets').get()!.consumed_at,1000);
 await assert.rejects(h.redeem(issued.ticket,nonce),/denied/);
});
