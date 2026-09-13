import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {SqlTenantQuota,type QuotaStorage,type LeaseRequest} from '../../services/quota/core.ts';

function fixture(){
 const db=new DatabaseSync(':memory:');
 const storage={sql:{exec(q:string,...a:(string|number|null)[]){if(q.includes('CREATE TABLE')){db.exec(q);return {toArray:()=>[]};}const s=db.prepare(q);const rows=s.columns().length?s.all(...a):(s.run(...a),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}},async sync(){}} as unknown as QuotaStorage;
 const request:LeaseRequest={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',generation:1,operation:'simulation-run',operationId:'sim-op',runId:'run-a',deadlineAt:10000};
 return {storage,request};
}

test('policy increase preserves an active lease and exposes new capacity',async()=>{
 const f=fixture(),old=new SqlTenantQuota(f.storage,{tenantId:'tenant-a',capacity:1,version:'v1'},()=>1000,()=> 'lease-a');
 assert.equal((await old.acquire(f.request)).outcome,'acquired');
 const upgraded=new SqlTenantQuota(f.storage,{tenantId:'tenant-a',capacity:2,version:'v2'},()=>1000);
 await upgraded.upgradePolicyFrom('v1');
 const snap=await upgraded.snapshot();assert.equal(snap.capacity,2);assert.equal(snap.occupied,1);assert.equal(snap.available,1);assert.equal(snap.leases[0]?.leaseId,'lease-a');
});

test('upgrade rejects wrong expected version and capacity decrease',async()=>{
 const f=fixture(),base=new SqlTenantQuota(f.storage,{tenantId:'tenant-a',capacity:2,version:'v2'},()=>1000);
 const wrong=new SqlTenantQuota(f.storage,{tenantId:'tenant-a',capacity:3,version:'v3'},()=>1000);await assert.rejects(wrong.upgradePolicyFrom('old'),/quota-policy-upgrade-denied/);
 const lower=new SqlTenantQuota(f.storage,{tenantId:'tenant-a',capacity:1,version:'v1'},()=>1000);await assert.rejects(lower.upgradePolicyFrom('v2'),/quota-policy-upgrade-denied/);
 assert.equal((await base.snapshot()).capacity,2);assert.equal((await base.snapshot()).policyVersion,'v2');
});
