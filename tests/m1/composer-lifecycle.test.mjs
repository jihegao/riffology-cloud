import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const web = new URL('../../services/web/', import.meta.url);
const files = Object.fromEntries(await Promise.all((await readdir(web)).filter(name => /\.(js|css|html)$/.test(name)).map(async name => [name, await readFile(new URL(name, web), 'utf8')])));
let browser;
before(async () => { browser = await chromium.launch({headless:true, channel:process.env.M1_BROWSER_CHANNEL || 'chrome'}); });
after(async () => { await browser?.close(); });
const deferred = () => { let resolve; return {promise:new Promise(done => { resolve = done; }), resolve}; };
const json = (route, value, status = 200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(value)});
async function fixture(t, handle, intent) {
  const context = await browser.newContext({locale:'zh-CN'}); t.after(() => context.close());
  if (intent) await context.addInitScript(value => sessionStorage.setItem('riffology:conversation:tenant:a', JSON.stringify({schemaVersion:1, selectedSessionId:'s', draft:value.message, messageIntent:value})), intent);
  const page = await context.newPage(); page.setDefaultTimeout(6000);
  const errors = [], calls = []; page.on('pageerror', error => errors.push(error.message)); t.after(() => assert.deepEqual(errors, []));
  await page.route('**/*', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) { const name = path === '/' ? 'index.html' : path.slice(1); return route.fulfill({status:files[name] ? 200 : 404, contentType:name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body:files[name] || ''}); }
    calls.push({path, method:request.method(), body:request.postData(), key:request.headers()['idempotency-key']});
    if (await handle(route, path)) return;
    if (path === '/api/me') return json(route, {userId:'user', tenants:[{id:'tenant'}], execution:{service:false, preview:false, simulation:false}});
    if (path === '/api/models') return json(route, {models:[]});
    if (path === '/api/tenants/tenant/projects') return json(route, {projects:['a','b'].map(id => ({id, workspace_id:id, title:id, status:'ready'}))});
    if (/^\/api\/workspaces\/[ab]$/.test(path)) return json(route, {schemaVersion:3, activeTurnId:null, sessions:{s:{id:'s', title:'Session', createdAt:1}}, turns:{}});
    if (path.endsWith('/events')) return json(route, {events:[], nextSequence:0, hasMore:false, snapshotRequired:false});
    if (path.endsWith('/model')) return json(route, {version:null, spec:null, canRun:false, reasonCode:'model_not_saved'});
    if (path.endsWith('/browser-preview')) return json(route, {currentRevisionId:null, revisionId:null, build:null, stale:false, modelSpec:null, reasonCode:'preview-no-saved-revision', delivery:null});
    if (path.endsWith('/private-beta-capacity')) return json(route,{state:'available'});
    if (path.endsWith('/files')) return json(route, {revision:null, files:[]});
    if (path.endsWith('/diff')) return json(route, {revision:null, summary:{added:0,modified:0,deleted:0},changes:[]});
    if (path.endsWith('/previews')) return json(route, {current:null, available:null});
    if (/\/(evidence|services|experiments|experiment-groups)$/.test(path)) return json(route, {items:[],nextCursor:null});
    throw Error('Unexpected fixture request: '+request.method()+' '+path);
  });
  await page.goto('https://composer.test/#/workspace/a');
  return {page,calls};
}

test('a late submission ACK from another Workspace cannot unlock the current pending submission', async t => {
  const gates={a:deferred(),b:deferred()}, accepted={};
  const f=await fixture(t, async (route,path) => {
    const post=/^\/api\/workspaces\/([ab])\/sessions\/s\/turns$/.exec(path);
    if(post){const id=post[1],message=JSON.parse(route.request().postData()).message;await gates[id].promise;accepted[id]={id:'turn-'+id,sessionId:'s',message,status:'completed',createdAt:2};await json(route,{turn:accepted[id]},202);return true;}
    const snapshot=/^\/api\/workspaces\/([ab])$/.exec(path);
    if(snapshot&&accepted[snapshot[1]]){const turn=accepted[snapshot[1]];await json(route,{schemaVersion:3,activeTurnId:null,sessions:{s:{id:'s',title:'Session',createdAt:1}},turns:{[turn.id]:turn}});return true;}
  });
  const p=f.page;
  await p.locator('#message-input:not([disabled])').waitFor();await p.locator('#message-input').fill('workspace A');await p.locator('#message-submit').click();
  await p.waitForFunction(()=>document.querySelector('#message-submit').disabled);
  await p.evaluate(()=>location.hash='/workspace/b');await p.waitForFunction(()=>document.querySelector('#workspace-title').textContent==='b'&&!document.querySelector('#message-submit').disabled);
  await p.locator('#message-input').fill('workspace B');await p.locator('#message-submit').click();
  gates.a.resolve();await p.waitForTimeout(100);
  assert.equal(await p.locator('#message-submit').isDisabled(),true);assert.equal(await p.locator('#message-input').inputValue(),'workspace B');
  await p.locator('#message-form').evaluate(form=>form.requestSubmit());
  gates.b.resolve();await p.locator('[data-turn-id="turn-b"]').waitFor();await p.locator('#message-submit:not([disabled])').waitFor();
  assert.equal(f.calls.filter(c=>c.path.endsWith('/turns')&&c.method==='POST').length,2);
  assert.equal(await p.locator('[data-turn-id="turn-a"]').count(),0);assert.equal(await p.locator('[data-turn-id="turn-b"]').count(),1);
});

for(const denyStorage of [false,true])test(`receipt confirmation blocks duplicate submits and preserves accepted content (storage denied: ${denyStorage})`, async t => {
  const gate=deferred(),intent={key:'pending-key',sessionId:'s',message:'Accepted original request'};
  const f=await fixture(t,async(route,path)=>{if(path.endsWith('/turns/receipt')){await gate.promise;await json(route,{accepted:true,turn:{id:'accepted-turn',sessionId:'s',message:intent.message,status:'completed',createdAt:2}});return true;}},intent);
  const p=f.page;await p.getByRole('button',{name:'正在确认上次请求…',exact:true}).waitFor();
  assert.equal(await p.locator('#message-submit').isDisabled(),true);await p.locator('#message-form').evaluate(form=>form.requestSubmit());
  if(denyStorage)await p.evaluate(()=>{Storage.prototype.getItem=function(){throw new DOMException('denied','SecurityError');};Storage.prototype.setItem=function(){throw new DOMException('denied','SecurityError');};});
  gate.resolve();await p.locator('[data-turn-id="accepted-turn"]').waitFor();
  assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
  assert.equal(await p.locator('[data-turn-id="accepted-turn"]').count(),1);
  await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForTimeout(100);
  assert.equal(await p.locator('[data-turn-id="accepted-turn"]').count(),1);
  assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});

test('a pending Beta draft can be fenced and edited without submitting another Turn', async t => {
  const intent={key:'old-key',sessionId:'s',message:'Explain the preview error'};
  const f=await fixture(t,async(route,path)=>{
    if(path==='/api/workspaces/a'){await json(route,{schemaVersion:3,activeTurnId:null,sessions:{s:{id:'s',title:'Session',createdAt:1}},turns:{},piDeveloperState:{privateBeta:true,blocked:null}});return true;}
    if(path.endsWith('/turns/receipt')){await json(route,{error:'not_found'},404);return true;}
    if(path.endsWith('/turns/withdraw')){assert.equal(route.request().headers()['idempotency-key'],intent.key);assert.deepEqual(JSON.parse(route.request().postData()),{message:intent.message});await json(route,{withdrawn:true,accepted:false});return true;}
  },intent);
  const p=f.page;await p.locator('#message-edit:visible:not([disabled])').waitFor();
  assert.equal(await p.locator('#message-input').isEditable(),false);
  await p.locator('#message-edit').click();await p.locator('#message-input:not([readonly])').waitFor();
  assert.equal(await p.locator('#message-input').inputValue(),intent.message);
  assert.equal((await p.evaluate(()=>JSON.parse(sessionStorage.getItem('riffology:conversation:tenant:a')))).messageIntent,null);
  assert.equal(f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/turns')).length,0);
  assert.equal(f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/turns/withdraw')).length,1);
});

test('an accepted or unavailable withdrawal keeps the original request locked', async t => {
  const intent={key:'old-key',sessionId:'s',message:'Original request'};
  const f=await fixture(t,async(route,path)=>{
    if(path==='/api/workspaces/a'){await json(route,{schemaVersion:3,activeTurnId:null,sessions:{s:{id:'s',title:'Session',createdAt:1}},turns:{},piDeveloperState:{privateBeta:true,blocked:null}});return true;}
    if(path.endsWith('/turns/receipt')){await json(route,{error:'not_found'},404);return true;}
    if(path.endsWith('/turns/withdraw')){await json(route,{error:'turn-intent-accepted'},409);return true;}
  },intent);
  const p=f.page;await p.locator('#message-edit:visible:not([disabled])').waitFor();await p.locator('#message-edit').click();
  await p.waitForFunction(()=>document.querySelector('#message-error').textContent.length>0);
  assert.equal(await p.locator('#message-input').isEditable(),false);
  assert.equal((await p.evaluate(()=>JSON.parse(sessionStorage.getItem('riffology:conversation:tenant:a')))).messageIntent.key,intent.key);
  assert.equal(f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/turns')).length,0);
});
