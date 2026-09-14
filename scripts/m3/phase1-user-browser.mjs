#!/usr/bin/env node
// Explicit ordinary-user acceptance commands. Never automatically retry a mutation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const [command,label='observation',argument]=process.argv.slice(2);
const dir=process.env.PHASE1_EVIDENCE_DIR;
if(!dir||!['inspect','create','turn','run','service','preview','stop','snapshot','reopen'].includes(command)||!/^[a-zA-Z0-9_-]+$/.test(label))throw Error('Set PHASE1_EVIDENCE_DIR; command: inspect/create/turn/run/service/preview/stop/snapshot/reopen, label, argument');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const file=n=>path.join(dir,n+'.json'),read=n=>JSON.parse(fs.readFileSync(file(n),'utf8'));
const save=(n,v)=>fs.writeFileSync(file(n),JSON.stringify(v,null,2)+'\n',{mode:0o600});
for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete process.env[key];
const origin='https://m1.riff-demo.gaojihe.cn';
const browser=await chromium.connectOverCDP(process.env.PHASE1_CDP_URL||'http://127.0.0.1:9237');
const context=browser.contexts()[0];let page=context.pages().find(p=>p.url().startsWith(origin));
if(!page)throw Error('Open the ordinary-user site and log in first');
async function api(url){const r=await page.evaluate(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(25000)});return {status:r.status,body:await r.json()};},url);assert.equal(r.status,200,`read ${url}: ${r.status}`);return r.body;}
async function mutation(url,action){
 if(fs.existsSync(file(label+'-intent')))throw Error('Existing intent: inspect receipt and durable state; do not submit again');
 const record=req=>{if(req.method()==='POST'&&new URL(req.url()).pathname===url)save(label+'-intent',{at:Date.now(),path:url,key:req.headers()['idempotency-key']??null,body:req.postData()});};
 page.on('request',record);
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===url,{timeout:60000});
 try{await action();const r=await response;const body=await r.json();save(label+'-receipt',{at:Date.now(),status:r.status(),body});assert(r.ok(),`mutation rejected: ${r.status()}`);return body;}finally{page.off('request',record);}
}
try{
 const me=await api('/api/me');
 if(command==='inspect'){console.log({authenticated:true,tenants:me.tenants.length,url:page.url(),text:(await page.locator('body').innerText()).slice(0,1600)});}
 else if(command==='create'){
  assert(!fs.existsSync(file('project')),'Project already recorded');await page.goto(origin+'/');await page.locator('#new-project').click();await page.locator('#project-title').fill(argument||'Phase1 user-preview queue');await page.locator('#project-model').selectOption('');
  const result=await mutation(`/api/tenants/${me.tenants[0].id}/projects`,()=>page.locator('#project-submit').click());save('project',result.project);console.log(result.project);
 }else{
  const project=read('project'),base=`/api/workspaces/${project.workspace_id}`;
  if(command==='reopen'){
   const url=origin+'/#/workspace/'+project.id;await page.close();page=await context.newPage();let posts=0;page.on('request',r=>{if(r.method()==='POST'&&/\/(turns|experiments|services)$/.test(new URL(r.url()).pathname))posts++;});await page.goto(url);await page.locator('#session-select option[value="'+read('session').id+'"]').waitFor({state:'attached',timeout:60000});save(label,{at:Date.now(),workspace:await api(base),automaticExecutionPosts:posts,sessionId:await page.locator('#session-select').inputValue()});assert.equal(posts,0);console.log('Reopened without execution POST');
  }else{
   if(!page.url().endsWith('/'+project.id))await page.goto(origin+'/#/workspace/'+project.id);
   await page.locator('#session-select').waitFor({timeout:60000});
   if(command==='snapshot'){
    const workspace=await api(base);save(label,{at:Date.now(),workspace,model:await api(base+'/model'),experiments:await api(base+'/experiments'),services:await api(base+'/services'),files:await api(base+'/files')});await page.screenshot({path:path.join(dir,label+'.png'),fullPage:true});console.log({turns:Object.values(workspace.turns).map(t=>({id:t.id,status:t.status})),admission:workspace.admission,releaseHold:workspace.releaseHold});
   }else if(command==='turn'){
    await page.locator('#message-submit:not([disabled])').waitFor({timeout:60000});const id=await page.locator('#session-select').inputValue();assert(id);if(fs.existsSync(file('session')))assert.equal(id,read('session').id);else save('session',{id});
    save(label+'-before',await api(base));const prompt=fs.readFileSync(argument,'utf8');await page.locator('#message-input').fill(prompt);const r=await mutation(base+`/sessions/${id}/turns`,()=>page.locator('#message-submit').click());console.log({turnId:r.turn.id,status:r.turn.status});
   }else if(command==='run'){
    await page.getByText('刷新模型与实验',{exact:true}).click();await page.locator('.simulation-form [name=servers]').waitFor({timeout:60000});await page.locator('.simulation-form [name=servers]').fill(argument||'1');await page.locator('.simulation-form [name=seed]').fill('99');save(label+'-before',await api(base));console.log(await mutation(base+'/experiments',()=>page.getByText('运行实验',{exact:true}).click()));
   }else if(command==='service'){
    await page.locator('[data-service-duration]').selectOption('900000');console.log(await mutation(base+'/services',()=>page.getByText('启动服务',{exact:true}).click()));
   }else if(command==='stop'){
    const runId=read(argument+'-receipt').body.runId;await page.locator(`[data-service-action=select][data-run-id="${runId}"]`).click();console.log(await mutation(base+`/services/${runId}/stop`,()=>page.locator('[data-service-action=stop]').click()));
   }else if(command==='preview'){
    const runId=read(argument+'-receipt').body.runId;const events=[];page.on('response',r=>{const u=new URL(r.url());if(u.hostname.endsWith('.preview.m1.riff-demo.gaojihe.cn')||u.pathname.includes('/tickets')){events.push({at:Date.now(),host:u.hostname,path:u.pathname,status:r.status()});save(label+'-network',events);}});
    await page.locator(`[data-service-action=select][data-run-id="${runId}"]`).click();await page.locator('[data-service-action=preview]:not([disabled])').waitFor({timeout:60000});await page.locator('[data-service-action=preview]').click();await page.frameLocator('iframe[title="项目预览"]').locator('h1').waitFor({timeout:60000});
    const frame=page.frames().find(f=>f.url().includes('.preview.m1.'));const view=await frame.evaluate(async()=>({url:location.href,title:document.title,heading:document.querySelector('h1')?.textContent,body:document.body.innerText,health:await fetch('/health').then(async r=>({status:r.status,body:await r.text()}))}));save(label,{at:Date.now(),runId,view,services:await api(base+'/services')});assert.equal(view.health.status,200);await page.screenshot({path:path.join(dir,label+'.png'),fullPage:true});console.log(view);
   }
  }
 }
}finally{await browser.close();}
