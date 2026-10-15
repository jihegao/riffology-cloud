import test from 'node:test';
import assert from 'node:assert/strict';
import {localOrigins,checkPackage} from '../../services/project-views/local-host.mjs';
import {packaged} from './project-views-fixture.mjs';
test('local host refuses production, mixed, credentials, paths and same origins',()=>{
 for(const [a,e] of [['https://app.example','http://127.0.0.1:9002'],['http://127.0.0.1:9001','https://exec.example'],['http://user@localhost:9001','http://localhost:9002'],['http://localhost:9001/x','http://localhost:9002'],['http://localhost:9001','http://localhost:9001'],['http://localhost.evil:9001','http://localhost:9002']])assert.throws(()=>localOrigins(a,e));
 assert.equal(localOrigins('http://127.0.0.1:9001','http://127.0.0.1:9002').execution.port,'9002');
});
test('host consumes canonical package bytes and rejects tampered assets or foreign selected views',async()=>{
 const {pkg}=await packaged();assert.equal(checkPackage(pkg,pkg.manifest.views[0]),pkg);
 assert.throws(()=>checkPackage({...pkg,revisionId:'changed'},pkg.manifest.views[0]),/digest/);
 assert.throws(()=>checkPackage(pkg,{id:'other',entrypoint:'app/home.html'}),/view/);
 const bad=structuredClone(pkg);bad.assets[0].base64=btoa('changed');assert.throws(()=>checkPackage(bad,pkg.manifest.views[0]),/digest/);
});

test('original cleanup can reconcile a lost removal ACK without replay or releasing a foreign container',async()=>{
 const {reconcileLocalContainer}=await import('../../services/project-views/local-host.mjs');
 const id='a'.repeat(64),image='sha256:'+'b'.repeat(64),operation='11111111-1111-4111-8111-111111111111',s={id:operation,name:'riffoid-view-'+operation,containerId:id,evidence:{}};let exists=true,removes=0;
 const invoke=async args=>{if(args[1]==='ls')return exists?id:'';if(args[1]==='inspect')return JSON.stringify({Id:id,Name:'/'+s.name,Image:image,Config:{Labels:{'io.riffoid.offline-view.operation':operation}}});if(args[1]==='rm'){assert.equal(args.at(-1),id);exists=false;removes++;throw Error('lost-ACK');}throw Error('unexpected');};
 await assert.rejects(reconcileLocalContainer(s,image,invoke,async()=>{}),/lost-ACK/);
 assert.equal(await reconcileLocalContainer(s,image,invoke,async()=>{}),'original-id-absent');assert.equal(removes,1);
 await assert.rejects(reconcileLocalContainer({...s,containerId:undefined},image,invoke,async()=>{}),/original-create-unresolved/);
 exists=true;await assert.rejects(reconcileLocalContainer({...s,containerId:'c'.repeat(64)},image,invoke,async()=>{}),/identity-mismatch/);assert.equal(removes,1);
});
