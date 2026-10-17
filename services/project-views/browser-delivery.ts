import {PROJECT_VIEW_FRAME_HTML,PROJECT_VIEW_FRAME_PATH,projectViewFrameHeaders} from './frame.mjs';
import {projectViewBrowserWindow,type ProjectViewBrowserPolicyEnv} from './browser-policy.ts';

/** Fixed public bootstrap only: no package, identity or credential enters HTML. */
export function serveProjectViewBrowserFrame(request:Request,env:ProjectViewBrowserPolicyEnv,transportOrigin=env.APP_ORIGIN):Response|null{
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/project-views/'))return null;
 const unavailable=(status:number)=>new Response(null,{status,headers:{'cache-control':'no-store'}});
 if(url.origin!==transportOrigin||url.pathname!==PROJECT_VIEW_FRAME_PATH||url.search||!['GET','HEAD'].includes(request.method))return unavailable(404);
 try{
  const {appOrigin}=projectViewBrowserWindow(env);
  return new Response(request.method==='HEAD'?null:PROJECT_VIEW_FRAME_HTML,{headers:{...projectViewFrameHeaders(appOrigin),'cache-control':'no-store'}});
 }catch{return unavailable(503);}
}
