/** Closed synthetic API data only. Never loads auth or performs fetch. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ACCOUNT,ACCOUNT_BASE,BASE,APP_IDS,WORKER,ZONE} from '../../scripts/ir-publication/core/fixed-target.mjs';
import {hashJSON} from '../../scripts/ir-publication/core/a2/ir-publication-candidate.mjs';
import {sha} from '../../scripts/ir-publication/core/io-boundary.mjs';
export const OLD='11111111-1111-4111-8111-111111111111',OLDER='11111111-1111-4111-8111-111111111110',NEW='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333';
const clone=structuredClone;
export function registryFor(target){const receipt={schema:'riffoid-ir.registry-full-get-readback/v1',syntheticFixture:true,role:target.kind==='ProjectTools'?'project-tools':'trusted-pi',accountId:ACCOUNT,appId:target.appId,repository:target.knownHistoricalRepository,imageReference:target.desiredImageReference,rootDescriptor:{mediaType:'application/vnd.oci.image.manifest.v1+json',digest:target.manifest,size:target.kind==='ProjectTools'?7131:12864},onlyGet:true,fullReadback:true,rootManifestAndAllReachableBlobsReadBack:true,allDigestsAndSizesVerified:true};return {receipt,ownerSeal:{schema:'riffoid-ir.registry-owner-seal/v1',role:'ir-publication-owner',receiptCanonicalSha256:hashJSON(receipt)}};}
export async function fixture({a2,mutate,stopWrite,historyLength=2,multiModule=false}={}){
  const settings={bindings:[{name:'APP_ORIGIN',type:'plain_text',text:'https://offline-fixture.invalid'},{name:'SECRET_NAME_ONLY',type:'secret_text'},{name:'FUTURE_BINDING',type:'future',data:{preserve:true}}],annotations:{custom:'unchanged'},compatibility_date:'2026-09-30',limits:{cpu_ms:30000},future:{keep:true}};
  const resources={script:{etag:sha(Buffer.from('synthetic old module')),last_deployed_from:'api',future_identity:{preserve:true}},bindings:clone(settings.bindings),script_runtime:{exports:{WorkspaceAgent:{class_name:'WorkspaceAgent'}},containers:[{class_name:'ProjectToolSandbox',application_id:APP_IDS[0]},{class_name:'TrustedPiSandbox',application_id:APP_IDS[1]}],assets:{html_handling:'none',not_found_handling:'none',serve_directly:false,base_path:'/',raw_run_worker_first:true}}};
  const apps=a2.target.apps.map((a,i)=>({id:a.appId,name:'offline-original-'+i,version:1,max_instances:1,scheduling_policy:'default',constraints:{regions:['WEUR']},configuration:{image:a.knownHistoricalRepository+'@sha256:'+'1'.repeat(64),environment_variables:[{name:'SYNTHETIC_PUBLIC',value:'fixture'}],future:{nested:['keep',i]}}}));apps.push({id:OTHER,name:'offline-untargeted',version:1,max_instances:1,scheduling_policy:'default',configuration:{image:'synthetic-unrelated',future:{keep:true}}});
  const workerVersions=Array.from({length:historyLength},(_,i)=>({id:i===0?OLD:i===1?OLDER:'66666666-6666-4666-8666-'+i.toString(16).padStart(12,'0'),number:historyLength-i,metadata:{syntheticFixture:true,immutable:true}}));
  const deployment=id=>({id:id.replace(/^./,'7'),source:'api',strategy:'percentage',versions:[{version_id:id,percentage:100}],created_on:'2026-10-01T00:00:00.000Z',annotations:{syntheticFixture:true}});
  const state={settings,resources,active:OLD,module:Buffer.from('synthetic old module'),workerVersions,deployments:workerVersions.map(x=>deployment(x.id)),details:Object.fromEntries(workerVersions.map(x=>[x.id,{id:x.id,resources:clone(resources),annotations:clone(settings.annotations)}])),apps,appVersions:Object.fromEntries(apps.map(a=>[a.id,[{configuration:clone(a.configuration),percentage:100,version:1}]])),rollouts:{}};
  const calls=[],publicCalls=[],sessionJwt='offline.'+Buffer.from(JSON.stringify({syntheticFixture:true})).toString('base64url')+'.offline';
  const envelope=(result,info)=>new Response(JSON.stringify({success:true,result,...(info===undefined?{}:{result_info:info})}),{headers:{'content-type':'application/json'}});
  const pageToken=(rows,url,size=2)=>{const token=url.searchParams.get('page_token'),page=token==='opaque-synthetic-token'?1:0;return {result:rows.slice(page*size,page*size+size),info:{per_page:100,page_token:token,next_page_token:rows.length>(page+1)*size?'opaque-synthetic-token':null}};};
  const connection={fullWireResponses:true,async request(o){
    calls.push({method:o.method,path:o.path,aborted:o.signal?.aborted??false});if(stopWrite&&o.method!=='GET')return stopWrite(o,state);
    const url=new URL('https://api.cloudflare.com/client/v4'+o.path),p=url.pathname.slice('/client/v4'.length);let result,info;
    if(o.method==='POST'&&p===BASE+'/assets-upload-session')return envelope({jwt:sessionJwt,buckets:[]});
    if(o.method==='PUT'&&o.path===BASE+'?bindings_inherit=strict'){
      const form=await new Response(o.body,{headers:{'content-type':o.contentType}}).formData(),m=JSON.parse(form.get('metadata'));if(Object.hasOwn(m.assets.config,'serve_directly')&&Object.hasOwn(m.assets.config,'run_worker_first'))return new Response(JSON.stringify({success:false,errors:[{code:10021,message:'serve_directly and run_worker_first must not be simultaneously specified'}]}),{status:400,headers:{'content-type':'application/json'}});state.module=Buffer.from(await form.get('index.js').arrayBuffer());state.settings.annotations=m.annotations;state.active=NEW;state.workerVersions.unshift({id:NEW,number:historyLength+1,metadata:{syntheticFixture:true,immutable:true}});const nextResources=clone(resources);nextResources.script.etag=sha(state.module);state.details[NEW]={id:NEW,resources:nextResources,annotations:clone(m.annotations)};state.deployments.unshift(deployment(NEW));return envelope({id:WORKER,etag:nextResources.script.etag,deployment_id:NEW.replaceAll('-','')});
    }
    const rolloutWrite=APP_IDS.find(id=>p===ACCOUNT_BASE+'/containers/applications/'+id+'/rollouts');
    if(o.method==='POST'&&rolloutWrite){const body=JSON.parse(o.body),a=state.apps.find(x=>x.id===rolloutWrite);a.version++;a.configuration.image=body.target_configuration.image;for(const row of state.appVersions[a.id])row.percentage=0;state.appVersions[a.id].unshift({configuration:clone(a.configuration),percentage:100,version:a.version});const id=rolloutWrite===APP_IDS[0]?'44444444-4444-4444-8444-444444444444':'55555555-5555-4555-8555-555555555555';state.rollouts[id]={id,target_configuration:clone(body.target_configuration),status:'completed'};return envelope({id});}
    if(o.method!=='GET')throw Error('synthetic-unscripted-write');
    if(p===BASE+'/content/v2'){const f=new FormData();if(multiModule&&state.active===OLD)f.set('gaoagent-model.mjs',new Blob(['// synthetic preserved entrypoint'],{type:'application/javascript+module'}),'gaoagent-model.mjs');f.set('index.js',new Blob([state.module],{type:'application/javascript+module'}),'index.js');const r=new Request('https://offline.invalid/',{method:'POST',body:f});return new Response(await r.arrayBuffer(),{headers:{'content-type':r.headers.get('content-type')}});}
    if(p===BASE+'/settings')result=state.settings;
    else if(p===BASE+'/deployments'){const page=Number(url.searchParams.get('page')),per_page=Number(url.searchParams.get('per_page'));result={deployments:state.deployments.slice((page-1)*per_page,page*per_page)};info={page,per_page,count:result.deployments.length,total_count:state.deployments.length,total_pages:Math.ceil(state.deployments.length/per_page)};}
    else if(p===BASE+'/versions'){const page=Number(url.searchParams.get('page'));result={items:state.workerVersions.slice((page-1)*100,page*100)};info={page,per_page:100};}
    else if(p.startsWith(BASE+'/versions/'))result=state.details[p.slice((BASE+'/versions/').length)];
    else if(p===ACCOUNT_BASE+'/workers/durable_objects/namespaces'){const all=Array.from({length:104},(_,i)=>({id:'namespace-'+i,name:'unchanged-'+i})),page=Number(url.searchParams.get('page'));result=all.slice((page-1)*100,page*100);info={page,per_page:100,total_count:104,count:result.length};}
    else if(p==='/zones/'+ZONE+'/workers/routes')result=[{id:'offline-route',pattern:'offline.invalid/*',script:WORKER,future:{keep:true}}];
    else if(p===ACCOUNT_BASE+'/workers/domains')result=[];
    else if(p===BASE+'/schedules')result={schedules:[{cron:'0 * * * *'}]};
    else if(p===BASE+'/subdomain')result={enabled:true};
    else if(p===ACCOUNT_BASE+'/containers/registries')result=[{name:'offline-existing-registry'}];
    else if(p===ACCOUNT_BASE+'/containers/applications'){({result,info}=pageToken(state.apps,url));}
    else{const app=state.apps.find(x=>p===ACCOUNT_BASE+'/containers/applications/'+x.id);if(app)result=app;
      else{const id=state.apps.find(x=>p===ACCOUNT_BASE+'/containers/applications/'+x.id+'/versions')?.id;if(id)result=state.appVersions[id];
        else{const original=APP_IDS.find(id=>p.startsWith(ACCOUNT_BASE+'/containers/applications/'+id+'/instances'));if(original){const legacy=p.endsWith('/instances'),rows=original===APP_IDS[0]?[{id:'offline-vm',vm_state:'running',container_state:'stopped',process_activity:'not-inferred',lease_activity:'not-inferred'},{id:'offline-retained-idle',vm_state:'running',container_state:'stopped'}]:[],page=pageToken(rows,url,1);result=legacy?{instances:page.result}:page.result;info=page.info;}
          else{const rollout=Object.values(state.rollouts).find(x=>p.endsWith('/rollouts/'+x.id));if(rollout)result=rollout;else throw Error('synthetic-unscripted-get');}
        }
      }
    }
    const value={result:clone(result),info:clone(info)};await mutate?.({o,p,value,state});return envelope(value.result,value.info);
  },async publicGet({origin,path,credentials}){publicCalls.push({origin,path,credentials});const b=path===a2.frozenSource.frame.path?await readFile(join(a2.frozenSource.pins.buildRoot,'output/project-view-frame.html')):await readFile(join(a2.frozenSource.pins.buildRoot,'output/candidate-assets',path.slice(1)));return new Response(b);}};
  return {connection,state,calls,publicCalls,a2,sessionJwt};
}
