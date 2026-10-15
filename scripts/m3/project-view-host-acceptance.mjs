// Explicit local integration acceptance. Requires a prepared AMD128 image.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createLocalViewHost} from '../../services/project-views/local-host.mjs';
import {createGatewayProjectViewServices} from '../../services/gateway/project-view-services.ts';
import {packaged,projectFiles,scope} from '../../tests/m3/project-views-fixture.mjs';
const [image,outputArg]=process.argv.slice(2);if(!image||!outputArg)throw Error('image and new evidence directory required');
const output=resolve(outputArg);await mkdir(output,{recursive:true});
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
let pkg=(await packaged()).pkg,artifactReads=0,artifactLists=0,revoked=false,appOrigin,executionOrigin,host,browser;
const received=[],web=resolve('services/web');
const service=()=>createGatewayProjectViewServices({APP_ORIGIN:appOrigin,BROWSER_PREVIEW_EXECUTION_ORIGIN:executionOrigin,WORKSPACE_AGENT:{getByName(){return {async projectViews(){return pkg;}};}}});
const app=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://local.invalid');
 if(url.pathname==='/canary'){received.push({path:url.pathname,query:url.search});res.end('synthetic received');return;}
 if(url.pathname.endsWith('/project-views')){if(revoked){res.writeHead(403);res.end('{}');return;}const result=url.searchParams.has('identity')?{current:url.searchParams.get('identity')===pkg.packageIdentity}:await service().read(scope,{userId:'local-fixture',authVersion:1});res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return;}
 if(url.pathname.includes('/project-view-artifacts')){if(revoked){res.writeHead(403);res.end('{}');return;}let result;if(url.pathname.includes('/project-view-artifacts/')){artifactReads++;result={text:'SYNTHETIC artifact bytes',offset:0,nextOffset:null};}else{artifactLists++;result={items:[{artifactId:'artifact-'+'a'.repeat(60)}],nextCursor:null,version:'a'.repeat(64)};}res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return;}
 if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><div id="root"></div>');return;}
 if(!/^\/[a-z0-9-]+\.js$/.test(url.pathname)){res.writeHead(404);res.end();return;}
 res.setHeader('content-type','application/javascript');res.end(await readFile(resolve(web,url.pathname.slice(1))));
 }catch{res.writeHead(500);res.end('{}');}});
const evidence={schema:'riffology.local-isolated-view-acceptance/v1',startedAt:new Date().toISOString(),productionEligible:false,cloudCalls:0,cases:[],uncovered:['production deployment','real authenticated invited users','cloud lifecycle and cost','accessibility and full multimedia input compatibility']};
async function until(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('acceptance-timeout');}
try{
 appOrigin='http://127.0.0.1:'+await listen(app);const reserve=createServer();const port=await listen(reserve);await new Promise(r=>reserve.close(r));executionOrigin='http://127.0.0.1:'+port;
 host=await createLocalViewHost({appOrigin,executionOrigin,image,evidenceRoot:resolve(output,'sessions')});await host.listen();
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1000,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const enter=async()=>page.evaluate(async scope=>{if(!window.panel){const {createProjectViewsPanel}=await import('/project-views.js');const api=async(path,options)=>{const r=await fetch(path,options);if(!r.ok)throw Error('denied');return r.json();};window.panel=createProjectViewsPanel({root:document.querySelector('#root'),api,pollMs:500});}await panel.enter(scope);},scope);
 const leave=async()=>{await page.evaluate(()=>panel.leave());await until(()=>[...host.sessions.values()].every(s=>s.closed&&s.evidence.cleanupConfirmed));};
 const files=projectFiles();files['app/style.css']='body{color:rgb(0,0,255);background:white}';files['app/main.mjs']+='\nconst file=await riffoid.readFile(\"docs/data.json\");if(!file.text.includes(\"saved project data\"))throw Error(\"file broker mismatch\");const a=await riffoid.listArtifacts();const b=await riffoid.readArtifact(a.items[0].artifactId);document.querySelector("#value").textContent=b.text;';
 files['app/home.html']+='<button style="position:absolute;left:20px;top:250px;width:160px;height:50px" onclick="riffoid.readArtifact(\'artifact-'+ 'a'.repeat(60)+'\',0)">Read artifact</button><input style="position:absolute;left:20px;top:330px;width:300px;height:50px" oninput="riffoid.readArtifact(\'artifact-'+'a'.repeat(60)+'\',0)">';
 pkg=(await packaged(files)).pkg;await page.goto(appOrigin);await enter();
 await until(()=>artifactReads>0);await until(async()=>page.locator('canvas').count());await new Promise(r=>setTimeout(r,1000));
 assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('#value').count(),0,'project DOM is absent from app');
 const pixels=await page.locator('canvas').evaluate(c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data.some(n=>n!==0));assert(pixels);
 await page.screenshot({path:resolve(output,'package-broker-canvas.png')});
 const box=await page.locator('canvas').boundingBox(),beforeClick=artifactReads;await page.locator('canvas').click({position:{x:box.width*50/800,y:box.height*270/600}});await until(()=>artifactReads>beforeClick);
 const beforeText=artifactReads;await page.locator('canvas').click({position:{x:box.width*60/800,y:box.height*350/600}});await page.keyboard.type('local input');await until(()=>artifactReads>beforeText);
 await page.locator('canvas').dispatchEvent('wheel',{deltaY:0.5});await new Promise(r=>setTimeout(r,600));assert([...host.sessions.values()].some(s=>!s.closed));
 await page.screenshot({path:resolve(output,'package-broker-input.png')});
 evidence.input={clickArtifactRead:true,keyboardArtifactRead:true,fractionalWheelSessionSurvives:true};
 evidence.package={identity:pkg.packageIdentity,artifactReads,artifactLists,canvasPixels:true,appIframes:0,appProjectDom:0};
 await page.getByRole('tab',{name:'Report',exact:true}).click();await until(()=>[...host.sessions.values()].some(s=>!s.closed&&s.evidence.viewId==='report'));await new Promise(r=>setTimeout(r,700));await page.screenshot({path:resolve(output,'report-route.png')});
 evidence.routeSwitched=true;revoked=true;await page.evaluate(()=>panel.reload());await until(()=>[...host.sessions.values()].every(s=>s.closed&&s.evidence.cleanupConfirmed));evidence.revocationClosed=true;revoked=false;await leave();
 // Real package JavaScript executes each API in the isolated host, not in a test iframe.
 const target=appOrigin+'/canary?case=';
 const operations={href:t=>`location.href=${t}`,assign:t=>`location.assign(${t})`,replace:t=>`location.replace(${t})`,fetch:t=>`fetch(${t}).catch(()=>{})`,beacon:t=>`navigator.sendBeacon(${t},'SYNTHETIC')`,image:t=>`const i=new Image();i.src=${t};document.body.append(i)`,form:t=>`const f=document.createElement('form');f.action=${t};f.method='POST';document.body.append(f);f.submit()`,'window-open':t=>`window.open(${t},'_blank')`,websocket:t=>`const s=new WebSocket(${t}.replace('http:','ws:'));s.onerror=()=>{}`};
 await fetch(appOrigin+'/canary?positive=before');
 for(const [kind,code] of Object.entries(operations)){
  const files=projectFiles();files['app/home.html']='<h1>Isolated '+kind+'</h1><script>setTimeout(()=>{'+code(JSON.stringify(target+kind))+'},800)</script>';
  pkg=(await packaged(files)).pkg;
  await page.evaluate(()=>sessionStorage.clear());await enter();
  const s=await until(()=>[...host.sessions.values()].find(s=>!s.closed));
  await until(()=>s.evidence.networkFailures?.length>0,12000);
  evidence.cases.push({kind,packageIdentity:pkg.packageIdentity,networkFailures:s.evidence.networkFailures,containerId:s.containerId});
  await leave();assert(s.evidence.cleanupConfirmed);
 }
 await fetch(appOrigin+'/canary?positive=after');assert.equal(received.length,2);assert(received.every(r=>r.query.startsWith('?positive=')));
 evidence.collector=received;evidence.errors=errors;assert.equal(errors.length,0);
 evidence.status='passed';
}catch(error){evidence.status='failed';evidence.error=error.stack;process.exitCode=1;}
finally{await browser?.close();await host?.close();app.closeAllConnections();await new Promise(r=>app.close(r));evidence.finishedAt=new Date().toISOString();evidence.cleanupConfirmed=host?[...host.sessions.values()].every(s=>s.evidence.cleanupConfirmed):false;await writeFile(resolve(output,'acceptance.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:evidence.status,error:evidence.error,output}));}
