import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelCatalog } from '../../services/catalog/models.ts';
import { digest } from '../../services/catalog/contracts.ts';
import { verifyModelContent, type ModelContentPort, type ModelContentReceipt } from '../../services/runtime/content.ts';
import type { ModelContentUploadPort } from '../../services/runtime/model-upload.ts';
import { SqliteCatalog } from './sqlite-database.ts';

const operator = {userId:'operator',authVersion:1};
const text = 'print(1)\n';
const packageText = JSON.stringify({schemaVersion:1,files:[{path:'model/main.py',bytes:text.length,sha256:await digest(text),contentBase64:btoa(text)}]});
const bytes = new TextEncoder().encode(packageText);
const draft = {modelId:'queue',version:'1',title:'Queue',description:'Queue',starterVersion:'blank-v1',contentRef:'queue/1',contentSha256:await digest(packageText)};
function fixture() {
  const db = new SqliteCatalog(); db.seed('operator'); db.seed('owner');
  db.sqlite.exec("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES ('operator','operator','active',1,1)");
  const state = {reads:0,uploads:0,writes:0,stored:false,beforeWrite:null as (()=>void)|null,afterWrite:null as (()=>void)|null,loseResponse:false,receipt:null as ((r:ModelContentReceipt)=>ModelContentReceipt)|null};
  const content: ModelContentPort = {async resolve(ref) {return verifyModelContent(ref,{size:bytes.length,async arrayBuffer(){return bytes.slice().buffer;}});}};
  const uploader: ModelContentUploadPort = {async upload(ref, input, beforeWrite) {
    state.uploads++;
    const verified = await verifyModelContent(ref,{size:input.length,async arrayBuffer(){return input.slice().buffer;}});
    state.beforeWrite?.(); await beforeWrite();
    if (!state.stored) {state.stored=true;state.writes++;}
    state.afterWrite?.();
    if (state.loseResponse) throw new Error('storage response lost');
    return state.receipt ? state.receipt(verified.receipt) : verified.receipt;
  }};
  const models = new ModelCatalog(db,()=>1_800_000_000_000,content,uploader);
  return {db,state,models,read:async()=>{state.reads++;return bytes;}};
}
function uploadCount(f:ReturnType<typeof fixture>) {
  return Number(f.db.sqlite.prepare("SELECT count(*) AS n FROM catalog_model_operator_intents WHERE operation='model.uploaded'").get()!.n);
}

test('upload is authenticated, draft-only, fixed-reference, and does not validate the model', async()=>{
  const f=fixture();try {
    const row=await f.models.createDraft(operator,'create',draft);
    await assert.rejects(f.models.upload({userId:'owner',authVersion:1},row.id,'upload',f.read),/not_found/);
    assert.equal(f.state.reads,0);
    const result=await f.models.upload(operator,row.id,'upload',f.read);
    assert.equal(result.status,'draft');assert.equal(result.replayed,false);
    assert.equal(f.state.writes,1);assert.equal(uploadCount(f),1);assert.equal(f.db.count('catalog_model_content_checks'),0);
    assert.equal(f.db.count('catalog_model_audit_log'),2);
    await f.models.transition(operator,row.id,'validated','validate');
    await f.models.transition(operator,row.id,'published','publish');
    const calls=f.state.uploads,reads=f.state.reads;
    assert.equal((await f.models.upload(operator,row.id,'upload',f.read)).replayed,true);
    await assert.rejects(f.models.upload(operator,row.id,'new-upload',f.read),/not_found/);
    assert.equal(f.state.uploads,calls);assert.equal(f.state.reads,reads);
  }finally{f.db.sqlite.close();}
});

test('missing uploader rejects before body and bounded body errors remain unchanged',async()=>{
  const f=fixture();try {
    const row=await f.models.createDraft(operator,'create',draft);
    await assert.rejects(new ModelCatalog(f.db).upload(operator,row.id,'upload',f.read),/not_ready/);
    assert.equal(f.state.reads,0);
    const error=Object.assign(new Error('payload-too-large'),{status:413});
    await assert.rejects(f.models.upload(operator,row.id,'upload',async()=>{throw error;}),actual=>actual===error);
    assert.equal(f.state.uploads,0);assert.equal(uploadCount(f),0);
  }finally{f.db.sqlite.close();}
});

test('content verification failure or mismatched storage receipt leaves metadata untouched',async()=>{
  const f=fixture();try {
    const row=await f.models.createDraft(operator,'create',draft);
    await assert.rejects(f.models.upload(operator,row.id,'upload',async()=>new TextEncoder().encode('{}')),/not_ready/);
    assert.equal(f.state.writes,0);
    f.state.receipt=r=>({...r,contentRef:'another/key'});
    await assert.rejects(f.models.upload(operator,row.id,'upload',f.read),/not_ready/);
    assert.equal(uploadCount(f),0);assert.equal(f.db.count('catalog_model_audit_log'),1);
    assert.equal((await f.models.get(row.id)).status,'draft');
  }finally{f.db.sqlite.close();}
});

test('upload reconciliation handles object response loss and atomic database response loss',async()=>{
  const f=fixture();try {
    const row=await f.models.createDraft(operator,'create',draft);
    f.state.loseResponse=true;
    await assert.rejects(f.models.upload(operator,row.id,'upload',f.read),/not_ready/);
    assert.equal(uploadCount(f),0);assert.equal(f.state.writes,1);
    f.state.loseResponse=false;f.db.loseCommitResponse=true;
    await assert.rejects(f.models.upload(operator,row.id,'upload',f.read),/lost committed response/);
    f.db.loseCommitResponse=false;
    const calls=f.state.uploads,reads=f.state.reads;
    assert.equal((await f.models.upload(operator,row.id,'upload',f.read)).replayed,true);
    assert.equal(f.state.uploads,calls);assert.equal(f.state.reads,reads);
    assert.equal(uploadCount(f),1);assert.equal(f.state.writes,1);assert.equal(f.db.count('catalog_model_audit_log'),2);
  }finally{f.db.sqlite.close();}
});

test('revocation before write blocks storage and revocation during write blocks acceptance',async()=>{
  for(const phase of ['beforeWrite','afterWrite'] as const){
    const f=fixture();try {
      const row=await f.models.createDraft(operator,'create',draft);
      f.state[phase]=()=>f.db.sqlite.exec("UPDATE catalog_platform_roles SET status='revoked' WHERE user_id='operator'");
      await assert.rejects(f.models.upload(operator,row.id,'upload',f.read),/not_found/);
      assert.equal(f.state.writes,phase==='beforeWrite'?0:1);assert.equal(uploadCount(f),0);
      assert.equal(f.db.count('catalog_model_audit_log'),1);assert.equal((await f.models.get(row.id)).status,'draft');
      f.state[phase]=null;
      f.db.sqlite.exec("UPDATE catalog_platform_roles SET status='active' WHERE user_id='operator'");
      await f.models.upload(operator,row.id,'upload',f.read);
      assert.equal(uploadCount(f),1);assert.equal(f.state.writes,1);
    }finally{f.db.sqlite.close();}
  }
});

test('frozen reference changes and conflicting idempotency payloads are rejected',async()=>{
  for(const phase of ['beforeWrite','afterWrite'] as const){
    const f=fixture();try {
      const row=await f.models.createDraft(operator,'create',draft);
      f.state[phase]=()=>f.db.sqlite.exec("UPDATE catalog_model_versions SET content_ref='changed/key' WHERE status='draft'");
      await assert.rejects(f.models.upload(operator,row.id,'upload',f.read),/not_found/);
      assert.equal(f.state.writes,phase==='beforeWrite'?0:1);assert.equal(uploadCount(f),0);
    }finally{f.db.sqlite.close();}
  }
  const f=fixture();try {
    const a=await f.models.createDraft(operator,'create',draft);
    const b=await f.models.createDraft(operator,'create-b',{...draft,version:'2'});
    await f.models.upload(operator,a.id,'same-key',f.read);
    const reads=f.state.reads;
    await assert.rejects(f.models.upload(operator,b.id,'same-key',f.read),/idempotency_conflict/);
    assert.equal(f.state.reads,reads);
  }finally{f.db.sqlite.close();}
});

test('concurrent same-key uploads record one intent and rollback leaves no acceptance',async()=>{
  const f=fixture();try {
    const row=await f.models.createDraft(operator,'create',draft);
    f.db.failAt=1;
    await assert.rejects(f.models.upload(operator,row.id,'upload',f.read),/injected SQL failure/);
    assert.equal(uploadCount(f),0);assert.equal(f.db.count('catalog_model_audit_log'),1);
    assert.equal(f.state.writes,1);
    f.db.failAt=-1;
    const results=await Promise.all([f.models.upload(operator,row.id,'upload',f.read),f.models.upload(operator,row.id,'upload',f.read)]);
    assert.equal(results.filter(r=>r.replayed).length,1);
    assert.equal(uploadCount(f),1);assert.equal(f.db.count('catalog_model_audit_log'),2);assert.equal(f.state.writes,1);
    assert.equal(f.db.count('catalog_model_content_checks'),0);
  }finally{f.db.sqlite.close();}
});
