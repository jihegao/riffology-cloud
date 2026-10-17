import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {PROJECT_VIEW_FRAME_HTML,PROJECT_VIEW_FRAME_PATH,PROJECT_VIEW_FRAME_SHA256,projectViewFrameHeaders} from '../../services/project-views/frame.mjs';

/** Real local opaque frame; no remote transport, production identity or model. */
export async function launchProjectViewBrowser(){
 const engine=process.env.M1_PROJECT_VIEW_BROWSER??'chromium';
 if(engine!=='chromium'&&engine!=='webkit')throw Error('unknown local project-view test browser');
 return (engine==='webkit'?webkit:chromium).launch({headless:true,...(engine==='chromium'&&process.env.M1_BROWSER_CHANNEL?{channel:process.env.M1_BROWSER_CHANNEL}:{})});
}
export async function localBrowserFixture(t,{handler,frameDocument=PROJECT_VIEW_FRAME_HTML,html='<section id="root"></section>'}={}){
 let origin,browser;const requests=[],errors=[];
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,origin??'http://127.0.0.1');requests.push({path:url.pathname,query:url.search,method:req.method,cookiePresent:Boolean(req.headers.cookie),authorizationPresent:Boolean(req.headers.authorization)});
   if(handler&&await handler(req,res,url))return;
   if(url.pathname===PROJECT_VIEW_FRAME_PATH){res.writeHead(200,projectViewFrameHeaders(origin));res.end(frameDocument);return;}
   if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8">'+html);return;}
   if(!/^\/[a-z0-9-]+\.(?:js|css)$/.test(url.pathname)){res.writeHead(404);res.end();return;}
   res.setHeader('content-type',url.pathname.endsWith('.js')?'application/javascript':'text/css');res.end(await readFile(new URL('../../services/web/'+url.pathname.slice(1),import.meta.url)));
  }catch{res.writeHead(404);res.end();}
 });
 const port=await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});origin='http://127.0.0.1:'+port;
 t.after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 browser=await launchProjectViewBrowser();
 const page=await browser.newPage({viewport:{width:1000,height:800}});page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
 return {page,origin,requests,errors,frameUrl:origin+PROJECT_VIEW_FRAME_PATH,delivery:{execution:'browser-local',transport:'native-dom/v1',executionOrigin:origin,frameUrl:origin+PROJECT_VIEW_FRAME_PATH,frameSha256:PROJECT_VIEW_FRAME_SHA256}};
}
export const projectFrame=f=>f.page.frames().find(frame=>frame.url()===f.frameUrl);
