import {unzipSync} from 'fflate';

const SHA=/^[a-f0-9]{64}$/;
const MEMBERS=['manifest.json','business.json','core.json','plan.json','lineage.json'] as const;
const MAX_BUNDLE_BYTES=2*1024*1024;
const MAX_MEMBER_BYTES=1024*1024;
const decoder=new TextDecoder('utf-8',{fatal:true});

export type CompilerIdentity={
  bundleSha256:string;bundleId:string;businessFingerprint:string;planFingerprint:string;
  compilerVersion:'0.1.0';runtimeVersion:'0.1.0';
  domainPack:{name:'aircraft-support';version:'aircraft-support-pack/v0.1'};
  irVersions:{business:'aircraft-business-ir/v1';core:'simulation-core-ir/v2';plan:'aircraft-support-plan/v1alpha2';lineage:'compiler-lineage/v2'};
  executionProfile:{semantic:'legacy-minute-v1'|'event-time-v2';rng:'legacy-sequential-v1';work:'stable-topological-serial';resource_dispatch_index:'absent'};
};

function fail():never{throw Error('compiler-bundle-invalid');}
function object(raw:unknown):Record<string,unknown>{if(!raw||typeof raw!=='object'||Array.isArray(raw))fail();return raw as Record<string,unknown>;}
function parse(bytes:Uint8Array):Record<string,unknown>{try{return object(JSON.parse(decoder.decode(bytes)));}catch{return fail();}}
function canonical(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  return fail();
}
async function sha(bytes:Uint8Array|string){const raw=typeof bytes==='string'?new TextEncoder().encode(bytes):bytes;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(raw)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function hex(raw:unknown):string{if(typeof raw!=='string'||!SHA.test(raw))fail();return raw;}

/** A bounded preflight over the saved source. The installed SDK revalidates the
 * full bundle and Business→Core→Plan association inside the native sandbox. */
export async function inspectCompilerBundle(bundle:Uint8Array,business:Uint8Array):Promise<CompilerIdentity>{
  if(bundle.byteLength<1||bundle.byteLength>MAX_BUNDLE_BYTES||business.byteLength<1||business.byteLength>MAX_MEMBER_BYTES)fail();
  const seen:string[]=[],names=new Set<string>(MEMBERS);let size=0,tooLarge=false;
  let files:Record<string,Uint8Array>;
  try{files=unzipSync(bundle,{filter:entry=>{
    seen.push(entry.name);size+=entry.originalSize;
    if(!names.has(entry.name)||entry.originalSize<1||entry.originalSize>MAX_MEMBER_BYTES||size>MAX_BUNDLE_BYTES){tooLarge=true;return false;}
    return true;
  }});}catch{return fail();}
  if(tooLarge||seen.length!==MEMBERS.length||new Set(seen).size!==MEMBERS.length||seen.some(name=>!names.has(name))||Object.keys(files).length!==MEMBERS.length)fail();
  const manifest=parse(files['manifest.json']!),savedBusiness=parse(files['business.json']!),sourceBusiness=parse(business);
  if(canonical(savedBusiness)!==canonical(sourceBusiness))fail();
  const expectedFiles=object(manifest.files);
  if(Object.keys(expectedFiles).sort().join(',')!=='business.json,core.json,lineage.json,plan.json')fail();
  for(const name of MEMBERS.slice(1))if(hex(expectedFiles[name])!==await sha(files[name]!))fail();
  const {bundle_id:bundleId,...unsigned}=manifest;
  if(hex(bundleId)!==await sha(canonical(unsigned))||manifest.schema_version!=='sim-engine-model-bundle/v1'||manifest.compiler_version!=='0.1.0'||manifest.runtime_version!=='0.1.0')fail();
  const domain=object(manifest.domain_pack),ir=object(manifest.ir_versions),profile=object(manifest.execution_profile),identity=object(manifest.identity);
  if(domain.name!=='aircraft-support'||domain.version!=='aircraft-support-pack/v0.1'||ir.business!=='aircraft-business-ir/v1'||ir.core!=='simulation-core-ir/v2'||ir.plan!=='aircraft-support-plan/v1alpha2'||ir.lineage!=='compiler-lineage/v2'||!['legacy-minute-v1','event-time-v2'].includes(String(profile.semantic))||profile.rng!=='legacy-sequential-v1'||profile.work!=='stable-topological-serial'||profile.resource_dispatch_index!=='absent')fail();
  if(hex(identity.business_fingerprint)!==hex(sourceBusiness.fingerprint)||hex(identity.plan_fingerprint)!==hex(expectedFiles['plan.json']))fail();
  return {bundleSha256:await sha(bundle),bundleId:hex(bundleId),businessFingerprint:hex(identity.business_fingerprint),planFingerprint:hex(identity.plan_fingerprint),compilerVersion:'0.1.0',runtimeVersion:'0.1.0',domainPack:{name:'aircraft-support',version:'aircraft-support-pack/v0.1'},irVersions:{business:'aircraft-business-ir/v1',core:'simulation-core-ir/v2',plan:'aircraft-support-plan/v1alpha2',lineage:'compiler-lineage/v2'},executionProfile:{semantic:profile.semantic as CompilerIdentity['executionProfile']['semantic'],rng:'legacy-sequential-v1',work:'stable-topological-serial',resource_dispatch_index:'absent'}};
}
