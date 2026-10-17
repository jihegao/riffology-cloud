import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const web=new URL('../../services/web/',import.meta.url);
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});

/** A browser transport fixture, not an isolated browser renderer. All execution
 * requests go through an explicitly injected fetch. No container, provider or
 * remote page is started, and no project HTML is installed in the app DOM. */
export async function remoteBrowserFixture(t,{handler,html='<canvas id="remote" width="800" height="600" style="width:400px;height:300px;display:block" tabindex="0"></canvas>'}={}){
 let origin;const nativeRemoteRequests=[];
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,origin??'http://127.0.0.1');
   if(handler&&await handler(req,res,url))return;
   if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8">'+html);return;}
   if(!/^\/[a-z0-9-]+\.(?:js|css)$/.test(url.pathname)){res.writeHead(404);res.end();return;}
   res.setHeader('content-type',url.pathname.endsWith('.js')?'application/javascript':'text/css');res.end(await readFile(new URL(url.pathname.slice(1),web)));
  }catch{res.writeHead(404);res.end();}
 });
 const port=await listen(server);origin='http://127.0.0.1:'+port;
 let browser;
 t.after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 browser=await chromium.launch({headless:true,...(process.env.M1_BROWSER_CHANNEL?{channel:process.env.M1_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/project-views/v1/sessions**',async route=>{nativeRemoteRequests.push(route.request().url());await route.abort('blockedbyclient');});
 const executionOrigin='http://127.0.0.1:'+(port===65530?65529:65530);
 await page.addInitScript(({executionOrigin})=>{
  const fixture=window.remoteFixture={executionOrigin,requests:[],sessions:{},seeds:[],nextId:0,current:{},states:[],errors:[],draws:[],aborts:[],decodes:0,bitmapCloses:0,deferDecode:0,decodeWaiters:[],pollWaiters:[],createWaiters:[]};
  fixture.makePng=(width=800,height=600,color='rgb(3, 71, 207)')=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,width,height);return canvas.toDataURL('image/png').split(',')[1];};
  fixture.frame=(color='rgb(3, 71, 207)')=>({base64:fixture.makePng(800,600,color),width:800,height:600});
  const nativeBitmap=window.createImageBitmap.bind(window);
  window.createImageBitmap=async(...args)=>{
   const bitmap=await nativeBitmap(...args);fixture.decodes++;
   const nativeClose=bitmap.close.bind(bitmap);bitmap.close=()=>{fixture.bitmapCloses++;nativeClose();};
   if(fixture.deferDecode>0){fixture.deferDecode--;await new Promise(resolve=>fixture.decodeWaiters.push(resolve));}
   return bitmap;
  };
  fixture.watchCanvas=canvas=>{const context=canvas.getContext('2d');if(context.fixtureWatched)return;context.fixtureWatched=true;const draw=context.drawImage.bind(context);context.drawImage=(...args)=>{fixture.draws.push({width:args[0]?.width,height:args[0]?.height});return draw(...args);};};
  fixture.fetch=async(input,init={})=>{
   const url=new URL(input,location.href),body=JSON.parse(init.body),headers=new Headers(init.headers);
   const record={url:url.href,method:init.method,body,authorization:headers.get('authorization'),signal:Boolean(init.signal)};fixture.requests.push(record);
   init.signal?.addEventListener('abort',()=>fixture.aborts.push({url:url.href,type:body.type??'create'}),{once:true});
   const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
   if(url.origin!==executionOrigin||init.method!=='POST')throw Error('fixture transport origin/method denied');
   if(url.pathname==='/project-views/v1/sessions'){
    if(record.authorization!==null)throw Error('fixture create must not carry another session token');
    const id='session-'+(++fixture.nextId),token='fixture-session-secret-'+fixture.nextId,seed=fixture.seeds.shift()??{polls:[{messages:[{type:'installed'}],frame:fixture.frame()}]};
    fixture.sessions[id]={id,token,polls:[...(seed.polls??[])],broker:[],input:[],closed:false,deferPoll:Boolean(seed.deferPoll),closeConfirmed:seed.closeConfirmed??true};
    if(seed.deferCreate)return new Promise(resolve=>fixture.createWaiters.push({id,resolve:()=>resolve(json({id,token}))}));
    return json({id,token});
   }
   const id=url.pathname.split('/').at(-1),session=fixture.sessions[id];
   if(!session||record.authorization!=='Bearer '+session.token)return new Response('{}',{status:403});
   if(body.type==='poll'){
    if(session.deferPoll)return new Promise(resolve=>fixture.pollWaiters.push({id,resolve:value=>resolve(json(value))}));
    return json(session.polls.shift()??{messages:[]});
   }
   if(body.type==='broker'){session.broker.push(body.message);return json({ok:true});}
   if(body.type==='input'){session.input.push(body.event);return json({ok:true});}
   if(body.type==='close'){session.closed=session.closeConfirmed;return json({closed:true,cleanupConfirmed:session.closeConfirmed});}
   throw Error('fixture unknown remote operation');
  };
 },{executionOrigin});
 await page.goto(origin);
 return {page,origin,executionOrigin,errors,nativeRemoteRequests,async state(){return page.evaluate(()=>remoteFixture);}};
}

export async function installRemoteClient(page){
 await page.evaluate(async()=>{
  const {createProjectViewRemote}=await import('/project-view-remote.js');
  const {createProjectViewBroker}=await import('/project-views.js');
  const fixture=window.remoteFixture,sha=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const text='{"label":"saved project data"}',html='<script>window.PROJECT_HTML_MUST_NOT_EXECUTE=true</script><h1>private project page</h1>';
  const body={schema:'project.view-package/v1',scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},revisionId:'revision-a',filesSha256:'a'.repeat(64),manifest:{schema:'project.views/v1',files:['app/home.html','docs/data.json'],views:[{id:'home',title:'Dashboard',entrypoint:'app/home.html'}]},assets:[{path:'app/home.html',mediaType:'text/html',base64:btoa(html),sha256:await sha(html)},{path:'docs/data.json',mediaType:'application/json',base64:btoa(text),sha256:await sha(text)}]};
  fixture.pkg={packageIdentity:await sha(JSON.stringify(body)),...body};fixture.clients={};fixture.brokers={};
  fixture.start=async({key='one',delivery,seed,pkg=fixture.pkg,view=pkg.manifest.views[0],pollMs=25}={})=>{
   const channel=new MessageChannel(),canvas=document.querySelector('#remote');fixture.watchCanvas(canvas);fixture.current[key]=true;
   fixture.brokers[key]=createProjectViewBroker({port:channel.port1,pkg,isCurrent:()=>fixture.current[key]!==false,authorize:async()=>{fixture.authorizations=(fixture.authorizations??0)+1;},onState:state=>fixture.states.push({key,state})});
   fixture.seeds.push(seed??{polls:[{messages:[],frame:fixture.frame()}]});
   const remote=createProjectViewRemote({canvas,delivery:delivery??{executionOrigin:fixture.executionOrigin,transport:'isolated-browser/v1'},pkg,view,port:channel.port2,isCurrent:()=>fixture.current[key]!==false,onError:error=>fixture.errors.push({key,error:String(error)}),fetch:fixture.fetch,pollMs});
   fixture.clients[key]=remote;await remote.start();return true;
  };
 });
}
