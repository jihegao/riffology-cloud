import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {ExportFiles} from '../../services/research/zip.ts';
import {digest} from '../../services/simulation/source.ts';
const source=await readFile(new URL('../../services/web/export.js',import.meta.url),'utf8');
const i18nSource=await readFile(new URL('../../services/web/i18n.js',import.meta.url),'utf8');
const bindingsSource=await readFile(new URL('../../services/web/i18n-bindings.js',import.meta.url),'utf8');
const css=await readFile(new URL('../../services/web/workspace.css',import.meta.url),'utf8');
const files=new ExportFiles();files.add('README.md',new TextEncoder().encode('Read and replay this research package.'));const bytes=files.finish(),hash=await digest(bytes);
async function fixture(t){const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(8000);const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));let gets=0,mode='success';
 await page.route('https://export.test/**',route=>{const path=new URL(route.request().url()).pathname;if(path.startsWith('/api/')){gets++;if(mode==='missing')return route.fulfill({status:409,contentType:'application/json',body:'{"error":"export-result-missing"}'});return route.fulfill({status:200,contentType:'application/zip',headers:{'x-riffology-export-sha256':mode==='corrupt'?'0'.repeat(64):hash,'content-disposition':'attachment; filename="riffology-test.zip"'},body:Buffer.from(bytes)});}const module=path==='/i18n.js'?i18nSource:path==='/i18n-bindings.js'?bindingsSource:source;return route.fulfill({contentType:path.endsWith('.js')?'application/javascript':'text/html',body:path.endsWith('.js')?module:`<style>body{font-family:system-ui;margin:16px;--line:#d8e8de;--muted:#52655b}${css}</style><section id="root" class="service-panel"></section>`});});
 await page.goto('https://export.test/');await page.evaluate(async()=>{const {setLocale}=await import('/i18n.js');setLocale('zh-CN');const {createExportPanel}=await import('/export.js');window.panel=createExportPanel({root:document.querySelector('#root')});window.panel.enter({workspaceId:'w'});});return {page,pageErrors,get gets(){return gets;},mode(value){mode=value;}};
}
test('explicit download verifies real ZIP digest; entering and reopening never requests export or runs',async t=>{
 const f=await fixture(t),dir=await mkdtemp(join(tmpdir(),'export-ui-'));t.after(()=>rm(dir,{recursive:true,force:true}));assert.equal(f.gets,0);const waiting=f.page.waitForEvent('download',{timeout:8000});await f.page.getByRole('button',{name:'下载项目研究包 (.zip)'}).click();const download=await waiting;assert.equal(download.suggestedFilename(),'riffology-test.zip');const path=join(dir,download.suggestedFilename());await download.saveAs(path);assert.equal(await digest(await readFile(path)),hash);assert.equal(f.gets,1);await f.page.getByText(/研究包已下载并通过完整性校验/).waitFor();await f.page.screenshot({path:'/tmp/riffology-issue32-export-desktop.png',fullPage:true});await f.page.setViewportSize({width:390,height:844});await f.page.screenshot({path:'/tmp/riffology-issue32-export-mobile.png',fullPage:true});assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await f.page.evaluate(()=>{window.panel.leave();window.panel.enter({workspaceId:'another'});});assert.equal(f.gets,1);
});
test('missing/corrupt package reports an explicit failure without producing a partial download',async t=>{
 const f=await fixture(t);let downloads=0;f.page.on('download',()=>downloads++);f.mode('missing');await f.page.getByRole('button').click();await f.page.getByText(/结果文件缺失/).waitFor();assert.equal(downloads,0);f.mode('corrupt');await f.page.getByRole('button').click();await f.page.getByText(/完整性校验失败/).waitFor();assert.equal(downloads,0);
});
test('late completion after workspace leave cannot trigger a download in the new workspace',async t=>{
 const f=await fixture(t);let downloads=0;f.page.on('download',()=>downloads++);await f.page.evaluate(async({bytes,hash})=>{window.panel.leave();const {createExportPanel}=await import('/export.js');window.panel=createExportPanel({root:document.querySelector('#root'),fetcher:()=>new Promise(resolve=>{window.finish=()=>resolve(new Response(Uint8Array.from(bytes),{headers:{'content-type':'application/zip','x-riffology-export-sha256':hash}}));})});window.panel.enter({workspaceId:'old'});},{bytes:[...bytes],hash});await f.page.getByRole('button').click();await f.page.evaluate(()=>{window.panel.leave();window.panel.enter({workspaceId:'new'});window.finish();});await f.page.getByRole('button',{name:'下载项目研究包 (.zip)'}).waitFor();await f.page.waitForTimeout(100);assert.equal(downloads,0);
});
