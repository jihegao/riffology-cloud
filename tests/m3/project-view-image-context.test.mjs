import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareProjectViewImage} from '../../scripts/m3/prepare-project-view-image.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'view-image-context-'));t.after(()=>rm(root,{recursive:true,force:true}));const dependencies=join(root,'dependencies'),lock={packages:{}};
 for(const name of ['playwright','playwright-core']){
  await mkdir(join(dependencies,name),{recursive:true});
  await writeFile(join(dependencies,name,'package.json'),JSON.stringify({name,version:'1.63.0',...(name==='playwright'?{dependencies:{'playwright-core':'1.63.0'}}:{})}));
  lock.packages['node_modules/'+name]={version:'1.63.0',integrity:'sha512-'+Buffer.alloc(64).toString('base64')};
 }
 await writeFile(join(dependencies,'playwright-core','browsers.json'),JSON.stringify({browsers:[{name:'chromium',revision:'1243',browserVersion:'153.0.8010.12'}]}));
 const lockPath=join(root,'lock.json');await writeFile(lockPath,JSON.stringify(lock));
 return {root,dependencies,options:{dependencyRoot:dependencies,lockPath}};
}
test('offline image context freezes only two pinned packages and an exact receipt; never overwrites output',async t=>{
 const f=await fixture(t),output=join(f.root,'context'),result=await prepareProjectViewImage(output,f.options),bytes=await readFile(join(output,'context-receipt.json')),receipt=JSON.parse(bytes);
 assert.equal(result.receiptSha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.fileCount,3);
 assert.equal(receipt.networkRequests,0);assert.equal(receipt.built,false);assert.equal(receipt.pushed,false);assert.equal(receipt.productionEligible,false);
 assert.deepEqual(receipt.packages.map(p=>p.name),['playwright','playwright-core']);
 for(const pkg of receipt.packages)for(const file of pkg.files){const content=await readFile(join(output,'vendor',pkg.name,file.path));assert.equal(createHash('sha256').update(content).digest('hex'),file.sha256);}
 await assert.rejects(prepareProjectViewImage(output,f.options),{code:'EEXIST'});
});
test('an unexpected cached package version or symlink is rejected before copying any file',async t=>{
 const f=await fixture(t),output=join(f.root,'context');
 await writeFile(join(f.dependencies,'playwright','package.json'),JSON.stringify({name:'playwright',version:'latest'}));
 await assert.rejects(prepareProjectViewImage(output,f.options),/package-pin/);await assert.rejects(stat(output),{code:'ENOENT'});
 await writeFile(join(f.dependencies,'playwright','package.json'),JSON.stringify({name:'playwright',version:'1.63.0',dependencies:{'playwright-core':'1.63.0'}}));
 const privateFile=join(f.root,'must-not-copy');await writeFile(privateFile,'synthetic secret');await symlink(privateFile,join(f.dependencies,'playwright','leak'));
 await assert.rejects(prepareProjectViewImage(output,f.options),/special-file/);await assert.rejects(stat(output),{code:'ENOENT'});
});
