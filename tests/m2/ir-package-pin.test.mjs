import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,cp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {verifyIrPackage,IR_PACKAGE_PIN,IR_PACKAGE_ROOT} from '../../services/trusted-pi/ir-package.mjs';
const lockUrl=new URL('riffoid-ir-plugin.lock.json',new URL('../',IR_PACKAGE_ROOT));
async function fixture(t){const base=await mkdtemp(join(tmpdir(),'riffoid-package-pin-'));t.after(()=>rm(base,{recursive:true,force:true}));const root=join(base,'package'),lock=join(base,'lock.json');await cp(fileURLToPath(IR_PACKAGE_ROOT),root,{recursive:true});await cp(fileURLToPath(lockUrl),lock);return {root,lock,rootUrl:pathToFileURL(root+'/'),lockUrl:pathToFileURL(lock)};}
function pythonVerify(root,lock){const service=fileURLToPath(new URL('../../services/project-tools/file_service.py',import.meta.url));const program=`import importlib.util,json\nspec=importlib.util.spec_from_file_location('svc',${JSON.stringify(service)})\nsvc=importlib.util.module_from_spec(spec);spec.loader.exec_module(svc)\npin=svc.verify_ir_package(${JSON.stringify(root)},${JSON.stringify(lock)})\nprint(json.dumps({'version':pin['version'],'packageSha256':pin['packageSha256']}))`;return spawnSync('python3',['-c',program],{encoding:'utf8'});}
test('Trusted Pi and Project Tools verify the exact same package identity and bytes',async()=>{
 const pin=await verifyIrPackage(),toolsRoot=fileURLToPath(new URL('../../services/project-tools/vendor/riffoid-ir-plugin/',import.meta.url)),toolsLock=fileURLToPath(new URL('../../services/project-tools/vendor/riffoid-ir-plugin.lock.json',import.meta.url));
 assert.equal(pin.version,'0.3.1');assert.equal(pin.files,IR_PACKAGE_PIN.files);assert.ok(pin.files>20);
 const native=pythonVerify(toolsRoot,toolsLock);assert.equal(native.status,0,native.stderr);assert.deepEqual(JSON.parse(native.stdout),{version:pin.version,packageSha256:pin.packageSha256});
});
test('changed file bytes, undeclared code and a missing file are rejected by both loaders',async t=>{
 const f=await fixture(t),target=join(f.root,'browser/worker.js'),original=await readFile(target);
 await writeFile(target,Buffer.concat([original,Buffer.from('\n// changed')]));await assert.rejects(verifyIrPackage(f.rootUrl,f.lockUrl));assert.notEqual(pythonVerify(f.root,f.lock).status,0);
 await writeFile(target,original);await writeFile(join(f.root,'poison.mjs'),'throw Error("must never run")');await assert.rejects(verifyIrPackage(f.rootUrl,f.lockUrl));assert.notEqual(pythonVerify(f.root,f.lock).status,0);
 await rm(join(f.root,'poison.mjs'));await rm(target);await assert.rejects(verifyIrPackage(f.rootUrl,f.lockUrl));assert.notEqual(pythonVerify(f.root,f.lock).status,0);
});
test('escaping lock paths and symbolic package roots fail before any package import',async t=>{
 const f=await fixture(t),raw=JSON.parse(await readFile(f.lock,'utf8'));raw.files[0].path='../outside.mjs';await writeFile(f.lock,JSON.stringify(raw));await assert.rejects(verifyIrPackage(f.rootUrl,f.lockUrl));assert.notEqual(pythonVerify(f.root,f.lock).status,0);
 await cp(fileURLToPath(lockUrl),f.lock);const linked=f.root+'-link';await symlink(f.root,linked);await assert.rejects(verifyIrPackage(pathToFileURL(linked+'/'),f.lockUrl));assert.notEqual(pythonVerify(linked,f.lock).status,0);
});
