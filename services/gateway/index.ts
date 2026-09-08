import {R2ModelContentUploadPort} from '../runtime/model-upload.ts';
// Optional until the model-content binding is configured for an environment.
type GatewayRuntimeEnv=GatewayEnv & {MODEL_CONTENT?:R2Bucket};
import {R2ModelContentPort} from '../runtime/content.ts';
import { createAuth } from './auth.ts';
import { catalogDatabase } from '../catalog/database.ts';
import { gateway } from './app.ts';
import { HttpError, json, readJson, requireOrigin } from './http.ts';
import { CatalogError } from '../catalog/contracts.ts';
import { ProvisioningCatalog } from '../catalog/provisioning.ts';
import { workspaceAgentName, type WorkspaceTask } from '../workspace/protocol.ts';
import { createGatewayTurnServices } from './turn-services.ts';
export { TenantQuota } from '../quota/durable.ts';
export { TenantModelBudget } from '../model-budget/durable.ts';
export { ProjectRuntime } from '../runtime/durable.ts';
export { WorkspaceAgent } from '../workspace/durable.ts';
export { ProductTurnRuntime } from '../turn-runtime/durable.ts';
export { RevisionStore } from '../turn-runtime/revision-store.ts';
export { ToolArtifactStore } from '../artifacts/durable.ts';
export { ModelProxyService } from '../model-proxy/service.ts';
export { ContainerProxy, ProjectToolSandbox, TrustedPiSandbox } from '../sandbox/classes.ts';
export { ToolBridgeAgent } from '../tools/durable.ts';
export { ToolBridgeService } from '../tools/service.ts';

async function dispatch(env:GatewayRuntimeEnv, item:{task:WorkspaceTask;mode:'accept'|'observe'}):Promise<void>{
  const actor=env.WORKSPACE_AGENT.getByName(workspaceAgentName(item.task.tenantId,item.task.workspaceId));
  if(item.mode==='accept')await actor.accept(item.task);
  else await actor.reconcile(item.task);
}
export default {
  async fetch(request:Request,env:GatewayRuntimeEnv):Promise<Response>{
    try {
    const url=new URL(request.url);
    if(url.origin!==env.APP_ORIGIN)return json({error:'origin_denied'},403);
    if(!url.pathname.startsWith('/api/')){
      if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'not_found'},404);
      if(!['/','/index.html','/app.js','/styles.css','/workspace.css','/admin','/admin.html','/admin.js','/admin.css'].includes(url.pathname))return json({error:'not_found'},404);
      if(!env.ASSETS)return json({error:'assets_not_configured'},503);
      const assetRequest=url.pathname==='/admin'
        ? new Request(new URL('/admin.html',url),{method:request.method,headers:request.headers})
        : request;
      const asset=await env.ASSETS.fetch(assetRequest),headers=new Headers(asset.headers);
      headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');
      headers.set('Cache-Control','no-store');return new Response(asset.body,{status:asset.status,headers});
    }
    if(!env.BETTER_AUTH_SECRET||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return json({error:'authentication_not_configured'},503);
    const database=catalogDatabase(env.CATALOG);
    const auth=createAuth({database:env.CATALOG,catalog:database,origin:env.APP_ORIGIN,secret:env.BETTER_AUTH_SECRET,googleClientId:env.GOOGLE_CLIENT_ID,googleClientSecret:env.GOOGLE_CLIENT_SECRET});
    if(new URL(request.url).origin!==env.APP_ORIGIN)return json({error:'origin_denied'},403);
    if(new URL(request.url).pathname.startsWith('/api/auth/')){
      const path=new URL(request.url).pathname;
      const allowed=request.method==='GET'?['/api/auth/get-session','/api/auth/callback/google','/api/auth/error']:request.method==='POST'?['/api/auth/sign-in/social','/api/auth/sign-out']:[];
      if(!allowed.includes(path))return json({error:'not_found'},404);
      if(request.method==='POST'){
        requireOrigin(request,env.APP_ORIGIN);
        const body=await readJson(request);
        const headers=new Headers(request.headers);headers.delete('content-length');
        return await auth.handler(new Request(request.url,{method:'POST',headers,body:JSON.stringify(body)}));
      }
      return await auth.handler(request);
    }
    return await gateway(request,{origin:env.APP_ORIGIN,database,modelContent:env.MODEL_CONTENT?new R2ModelContentPort(env.MODEL_CONTENT):undefined,modelUpload:env.MODEL_CONTENT?new R2ModelContentUploadPort(env.MODEL_CONTENT):undefined,
      provision:async(principal,tenantId,projectId)=>{
        const item=await new ProvisioningCatalog(database).kickProject(principal,tenantId,projectId);
        if(item)await dispatch(env,item);
      },turns:createGatewayTurnServices(env),identity:async req=>{
      const value=await auth.api.getSession({headers:req.headers,query:{disableCookieCache:true}});
      if(!value)return null;
      return {subject:value.user.id,email:value.user.email,emailVerified:value.user.emailVerified,platformVersion:value.session.platformVersion};
    }});
    }catch(error){
      if(error instanceof HttpError||error instanceof CatalogError)return json({error:error.message},error.status);
      return json({error:'temporarily_unavailable'},503);
    }
  },
  async scheduled(_event:ScheduledController,env:GatewayRuntimeEnv):Promise<void>{
    const work=await new ProvisioningCatalog(catalogDatabase(env.CATALOG)).sweep(10);
    const results=await Promise.allSettled(work.map(item=>dispatch(env,item)));
    if(results.some(result=>result.status==='rejected'))throw Error('workspace-dispatch-incomplete');
  },
} satisfies ExportedHandler<GatewayRuntimeEnv>;
