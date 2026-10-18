import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildProjectViews,readProjectViewsArchive,VIEW_LIMITS} from '../../services/project-views/package.ts';
import {verifyProjectViewPackage} from '../../services/web/project-views.js';
import {resolveManagedCandidate} from '../../services/turn-runtime/managed-candidate-v3.ts';
import {managedCandidateRecoveryFiles,ManagedCandidateError} from '../../services/turn-runtime/managed-candidate.ts';
import {assertManualSaveBody} from '../../services/workspace/manual-save-policy.ts';
import {scope} from './project-views-fixture.mjs';
import {budgetFiles,budgetArchive} from './project-view-package-budget-fixture.mjs';
import {manualPageFixture,scopes} from './manual-page-broker-fixture.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const pages=f=>({schemaVersion:3,operation:'pages',manifest:f.manifest,files:Object.fromEntries(Object.entries(f.files).filter(([path])=>path!=='app/views.json'))});
test('rewritten aggregate is rejected by the shared archive parser and builder before delivery',async()=>{
 const f=budgetFiles(),{bytes,source}=budgetArchive(f.files);
 assert.equal(Buffer.byteLength(f.statement)*400,7200);assert.equal(Buffer.byteLength(f.rewritten)*400,70000);
 assert.equal(f.modulePaths.reduce((sum,path)=>sum+Buffer.byteLength(f.files[path]),0),230400);
 assert.ok(Object.values(f.files).every(text=>Buffer.byteLength(text)<8192));
 assert.ok(f.deliveredBytes>VIEW_LIMITS.totalBytes);
 assert.throws(()=>readProjectViewsArchive(bytes),/project-view-size-limit/);
 await assert.rejects(buildProjectViews(source,bytes),/project-view-size-limit/);
});
test('Managed pages rejects a rewrite-inflated candidate within its candidate and cold-source envelopes',()=>{
 const f=budgetFiles(),candidate=pages(f);
 assert.ok(Buffer.byteLength(JSON.stringify(candidate))<512*1024);
 assert.ok(Buffer.byteLength(JSON.stringify(f.files))<1024*1024);
 assert.throws(()=>resolveManagedCandidate(candidate,undefined),error=>error instanceof ManagedCandidateError&&error.diagnostic.reason==='project-view-size-limit');
});
test('exact delivered 2 MiB remains inclusive and preserves bytes, body hash and client verification',async()=>{
 const f=budgetFiles(29,{exactTotal:true}),{bytes,source}=budgetArchive(f.files),pkg=await buildProjectViews(source,bytes);
 assert.equal(f.deliveredBytes,VIEW_LIMITS.totalBytes);
 assert.equal(pkg.assets.reduce((sum,a)=>sum+Buffer.from(a.base64,'base64').length,0),VIEW_LIMITS.totalBytes);
 const {packageIdentity,...body}=pkg,encoded=Buffer.from(JSON.stringify(body));assert.ok(encoded.length<=3*1024*1024);assert.equal(packageIdentity,sha(encoded));
 assert.equal(packageIdentity,'9665b73e0bf80e0246c94b75f3f1cfd841d568d5057061c146d856e94d204a0a','accepted package bytes/hash are unchanged from the pre-fix builder');
 assert.equal(Buffer.from(pkg.assets.find(a=>a.path===f.modulePaths[0]).base64,'base64').toString(),f.rewritten.repeat(400));
 await verifyProjectViewPackage(pkg,scope);
 const candidate=resolveManagedCandidate(pages(f),undefined);assert.equal(candidate.operation,'save');assert.deepEqual(managedCandidateRecoveryFiles(candidate.filesArchive),f.files);
 const overflow=budgetArchive({...f.files,'docs/padding.txt':f.files['docs/padding.txt']+'x'});
 assert.throws(()=>readProjectViewsArchive(overflow.bytes),/project-view-size-limit/);
 await assert.rejects(buildProjectViews(overflow.source,overflow.bytes),/project-view-size-limit/);
});
test('small text manual patch that crosses rewritten budget leaves canonical Revision and immutable objects unchanged',{timeout:60000},async t=>{
 const f=await manualPageFixture(t),initial=budgetFiles(32,{activeModules:29}),first=await f.save('alpha','budget-baseline',initial.files);
 assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.body.status,'committed');
 const current=(await f.read(f.base('alpha')+'/project-views')).package;await verifyProjectViewPackage(current,scopes.alpha);
 const base=(await f.read(f.base('alpha')+'/manual-saves')).base,path=initial.modulePaths[29],body={schema:'project.manual-save/v1',base,changes:[{path,encoding:'utf8',content:initial.statement.repeat(400)}],deletes:[],artifacts:[]};
 const actor={userId:'alpha',authVersion:1},now=Date.now(),policy={schema:'manual-save-policy/v1',enabled:true,startsAt:now-1000,endsAt:now+600000,scope:scopes.alpha,actor};
 assert.equal(assertManualSaveBody({MANUAL_SAVE_POLICY_JSON:JSON.stringify(policy)},scopes.alpha,actor,body).maxFileBytes,8192);
 const objects=async()=>(await f.bucket.list()).objects.map(({key,size,etag})=>({key,size,etag})).sort((a,b)=>a.key.localeCompare(b.key));
 const beforeObjects=await objects(),rejected=await f.request(f.base('alpha')+'/manual-saves',{method:'POST',key:'budget-overflow',body});
 assert.equal(rejected.status,200,JSON.stringify(rejected));assert.equal(rejected.body.status,'rejected');
 const afterObjects=await objects(),journal=await f.read('/__fixture/diagnostics?user=alpha'),unchanged=(await f.read(f.base('alpha')+'/project-views')).package;
 const fences=(await f.db.prepare('SELECT state FROM catalog_manual_save_fences').all()).results;
 assert.equal(unchanged.revisionId,current.revisionId);assert.equal(unchanged.packageIdentity,current.packageIdentity);assert.deepEqual(afterObjects,beforeObjects);assert.equal(f.outbound,0);
 assert.equal(journal.turns,0);assert.equal(journal.sessions,0);assert.equal(journal.active,null);
 assert.ok(fences.every(fence=>fence.state==='released'));
});
