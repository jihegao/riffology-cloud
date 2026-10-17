import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProjectViewBrowserPolicy,projectViewBrowserAdmission,projectViewBrowserWindow} from '../../services/project-views/browser-policy.ts';
import {serveProjectViewBrowserFrame} from '../../services/project-views/browser-delivery.ts';
import {createGatewayProjectViewServices} from '../../services/gateway/project-view-services.ts';
import {PROJECT_VIEW_FRAME_HTML,PROJECT_VIEW_FRAME_PATH,PROJECT_VIEW_FRAME_SHA256} from '../../services/project-views/frame.mjs';
import type {ProjectViewPackage} from '../../services/project-views/package.ts';

const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'a',authVersion:1},origin='https://app.example.test',now=1792229000000;
const policy=(extra:Record<string,unknown>={})=>JSON.stringify({schema:'project-view-browser-policy/v1',enabled:true,startsAt:now-1000,endsAt:now+600000,dataEgress:'accepted',grants:[{scope,actor}],...extra});
test('native DOM admission is separate, default closed and binds the accepted boundary and exact owner generation',()=>{
 const env={APP_ORIGIN:origin,PROJECT_VIEW_BROWSER_POLICY_JSON:policy()};
 assert.equal(projectViewBrowserAdmission(env,scope,actor,now).appOrigin,origin);
 for(const [s,a]of [[{...scope,projectId:'other'},actor],[{...scope,workspaceGeneration:2},actor],[scope,{...actor,authVersion:2}],[scope,{...actor,userId:'other'}]] as const)assert.throws(()=>projectViewBrowserAdmission(env,s,a,now),/admission-closed/);
 for(const raw of [undefined,'{}',policy({enabled:false}),policy({dataEgress:'forbidden'}),policy({extra:true}),policy({endsAt:now+86400001}),policy({grants:[]}),policy({grants:[{scope,actor},{scope,actor}]}),policy({grants:[{scope:{...scope,workspaceGeneration:0},actor}]})])assert.throws(()=>projectViewBrowserWindow({...env,PROJECT_VIEW_BROWSER_POLICY_JSON:raw},now),/admission-closed/);
 for(const timestamp of [now-1001,now+600000,NaN])assert.throws(()=>projectViewBrowserWindow(env,timestamp),/admission-closed/);
 assert.equal(parseProjectViewBrowserPolicy(policy())?.dataEgress,'accepted');
 for(const app of ['http://app.example.test',origin+'/path',origin+'/?x=1','https://u@app.example.test','http://localhost.example.test'])assert.throws(()=>projectViewBrowserWindow({...env,APP_ORIGIN:app},now),/admission-closed/);
 assert.equal(projectViewBrowserWindow({...env,APP_ORIGIN:'http://127.0.0.1:8011'},now).appOrigin,'http://127.0.0.1:8011');
});
test('fixed native DOM bootstrap has exact routing, opaque CSP and no identity/package payload',async()=>{
 const realNow=Date.now(),env={APP_ORIGIN:origin,PROJECT_VIEW_BROWSER_POLICY_JSON:policy({startsAt:realNow-1000,endsAt:realNow+600000})};
 const get=(path=PROJECT_VIEW_FRAME_PATH,method='GET',headers:HeadersInit={})=>serveProjectViewBrowserFrame(new Request(origin+path,{method,headers}),env)!;
 const response=get();assert.equal(response.status,200);assert.equal(await response.text(),PROJECT_VIEW_FRAME_HTML);
 assert.match(response.headers.get('content-security-policy')!,/sandbox allow-scripts/);assert.doesNotMatch(response.headers.get('content-security-policy')!,/allow-same-origin/);assert.match(response.headers.get('content-security-policy')!,/connect-src 'none'/);assert.match(response.headers.get('content-security-policy')!,/frame-ancestors https:\/\/app.example.test/);
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.has('set-cookie'),false);
 assert.equal(await get(undefined,'HEAD').text(),'');
 assert.equal(await get(undefined,'GET',{Cookie:'synthetic-only',Authorization:'Bearer synthetic-only'}).text(),PROJECT_VIEW_FRAME_HTML,'fixed code never embeds incoming credentials');
 for(const path of [PROJECT_VIEW_FRAME_PATH+'?x=1',PROJECT_VIEW_FRAME_PATH.replace(PROJECT_VIEW_FRAME_SHA256,'a'.repeat(64)),'/project-views/anything'])assert.equal(get(path).status,404);
 assert.equal(get(undefined,'POST').status,404);
 assert.equal(serveProjectViewBrowserFrame(new Request('https://foreign.test'+PROJECT_VIEW_FRAME_PATH),env)?.status,404);
 assert.equal(serveProjectViewBrowserFrame(new Request(origin+'/unrelated'),env),null);
 assert.equal(serveProjectViewBrowserFrame(new Request(origin+PROJECT_VIEW_FRAME_PATH),{APP_ORIGIN:origin})?.status,503);
 assert.equal(serveProjectViewBrowserFrame(new Request('https://transport.example.test'+PROJECT_VIEW_FRAME_PATH),env,'https://transport.example.test')?.status,200);
});
test('browser-local package and artifact reads never need a cloud runtime and close after grant revocation',async()=>{
 const realNow=Date.now(),env={APP_ORIGIN:origin,PROJECT_VIEW_BROWSER_POLICY_JSON:policy({startsAt:realNow-1000,endsAt:realNow+600000}),PROJECT_VIEW_POLICY_JSON:'{"enabled":false}'};
 const pkg={packageIdentity:'a'.repeat(64)} as ProjectViewPackage;let packages=0,artifacts=0,disposed=0;
 const stub={async projectViews(){packages++;return {...pkg,[Symbol.dispose](){disposed++;}};},async projectViewArtifacts(){artifacts++;return {items:[],[Symbol.dispose](){disposed++;}};}};
 const service=createGatewayProjectViewServices({...env,WORKSPACE_AGENT:{getByName:()=>stub}});
 const result=await service.read(scope,actor);
 assert.deepEqual(result,{package:pkg,delivery:{execution:'browser-local',transport:'native-dom/v1',executionOrigin:origin,frameUrl:origin+PROJECT_VIEW_FRAME_PATH,frameSha256:PROJECT_VIEW_FRAME_SHA256}});
 assert.deepEqual(await service.artifacts(scope,actor,{identity:pkg.packageIdentity}),{items:[]});assert.equal(packages,1);assert.equal(artifacts,1);assert.equal(disposed,2);
 // Revoke the actual object held by this service while an awaited RPC returns.
 const bound={...env,WORKSPACE_AGENT:{getByName:()=>({async projectViews(){bound.PROJECT_VIEW_BROWSER_POLICY_JSON='{"enabled":false}';return pkg;},async projectViewArtifacts(){bound.PROJECT_VIEW_BROWSER_POLICY_JSON='{"enabled":false}';return {items:[]};}})}};
 await assert.rejects(createGatewayProjectViewServices(bound).read(scope,actor),/browser-admission-closed/);
 bound.PROJECT_VIEW_BROWSER_POLICY_JSON=policy({startsAt:realNow-1000,endsAt:realNow+600000});await assert.rejects(createGatewayProjectViewServices(bound).artifacts(scope,actor,{identity:pkg.packageIdentity}),/browser-admission-closed/);
 const removed:{APP_ORIGIN:string;BROWSER_PREVIEW_EXECUTION_ORIGIN:string;PROJECT_VIEW_BROWSER_POLICY_JSON?:string;WORKSPACE_AGENT:{getByName:()=>{projectViews:()=>Promise<ProjectViewPackage>}}}={APP_ORIGIN:'http://127.0.0.1:8011',BROWSER_PREVIEW_EXECUTION_ORIGIN:'http://127.0.0.1:8012',PROJECT_VIEW_BROWSER_POLICY_JSON:policy({startsAt:realNow-1000,endsAt:realNow+600000}),WORKSPACE_AGENT:{getByName:()=>({async projectViews(){delete removed.PROJECT_VIEW_BROWSER_POLICY_JSON;return pkg;}})}};
 await assert.rejects(createGatewayProjectViewServices(removed).read(scope,actor),/browser-admission-closed/,'removing the browser grant cannot fall back to the legacy local host');
 const closed=createGatewayProjectViewServices({...env,PROJECT_VIEW_BROWSER_POLICY_JSON:'{}',WORKSPACE_AGENT:{getByName(){throw Error('must not read Workspace');}}});
 await assert.rejects(closed.read(scope,actor),/browser-admission-closed/);
 await assert.rejects(closed.artifacts(scope,actor,{identity:pkg.packageIdentity}),/browser-admission-closed/);
});
