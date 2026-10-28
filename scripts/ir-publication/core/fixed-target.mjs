export const ACCOUNT='8b0d70250211aa10d89e20605a1c7e5e';
export const WORKER='riffology-m1-gateway-staging';
export const ZONE='c97b548800561fada1a912c234696db1';
export const ACCOUNT_BASE='/accounts/'+ACCOUNT;
export const BASE=ACCOUNT_BASE+'/workers/scripts/'+WORKER;
export const PUT=BASE+'?bindings_inherit=strict';
export const APP_IDS=Object.freeze(['a03156a6-9bf5-43fb-8b7f-a1f5b8d1a650','a03628c4-f032-461f-a65b-612ccac11a06']);
export const LIMITS=Object.freeze({requestMs:20000,writeMs:90000,snapshotMs:180000,phaseWitnessMs:20000,publicationMs:900000,maxJsonBytes:16*1024*1024,maxModuleBytes:8*1024*1024,maxAssetBytes:64*1024*1024,maxSnapshotBytes:128*1024*1024,maxPages:1000,maxItems:100000});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const isId=id=>typeof id==='string'&&UUID.test(id);
/** Fixed paths only. Opaque pagination values are encoded by URLSearchParams. */
export function allowedGet(path,{appIds=[],versionIds=[]}={}){
  const url=new URL('https://api.cloudflare.com/client/v4'+path),p=url.pathname.slice('/client/v4'.length);
  if(url.hash||path.includes('\\')||path.includes('..')||path.split('?')[0].includes('%'))return false;
  const permit=(keys)=>[...url.searchParams.keys()].every(k=>keys.includes(k));
  if([BASE+'/settings',BASE+'/content/v2',BASE+'/schedules',BASE+'/subdomain',ACCOUNT_BASE+'/containers/registries'].includes(p))return url.search==='';
  if(p===BASE+'/deployments')return permit(['page','per_page']);
  if(p===BASE+'/versions')return permit(['page','per_page','deployable']);
  if(versionIds.some(id=>p===BASE+'/versions/'+id))return url.search==='';
  if(p===ACCOUNT_BASE+'/workers/durable_objects/namespaces')return permit(['page','per_page']);
  if(p===ACCOUNT_BASE+'/workers/domains')return permit(['service'])&&url.searchParams.get('service')===WORKER;
  if(p==='/zones/'+ZONE+'/workers/routes')return url.search==='';
  if(p===ACCOUNT_BASE+'/containers/applications')return permit(['per_page','page_token']);
  return appIds.some(id=>isId(id)&&(
    p===ACCOUNT_BASE+'/containers/applications/'+id&&url.search===''||
    p===ACCOUNT_BASE+'/containers/applications/'+id+'/versions'&&url.search===''||
    APP_IDS.includes(id)&&['instances','instances-v2'].some(kind=>p===ACCOUNT_BASE+'/containers/applications/'+id+'/'+kind&&permit(['per_page','page_token']))
  ));
}
export function allowedWrite(method,path,kind='oauth'){
  if(method==='PUT')return kind==='oauth'&&path===PUT;
  if(method!=='POST')return false;
  if(kind==='asset')return path===ACCOUNT_BASE+'/workers/assets/upload?base64=true';
  if(kind!=='oauth')return false;
  return path===BASE+'/assets-upload-session'||APP_IDS.some(id=>path===ACCOUNT_BASE+'/containers/applications/'+id+'/rollouts');
}
