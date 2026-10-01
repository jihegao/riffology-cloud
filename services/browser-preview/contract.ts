/** Immutable package metadata. This schema is not a Python security validator. */
export const BROWSER_PREVIEW_SCHEMA = 'riffology.browser-preview/v1' as const;
export const BROWSER_PREVIEW_JAVASCRIPT_SCHEMA = 'riffology.browser-preview/v2' as const;
export const BROWSER_JS_SCHEMA = 'riffology.browser-js/v1' as const;
export const BROWSER_JS_HOST_API = 'riffology.browser-host/v1' as const;
/** Reviewed platform wrappers only. Both invoke the same saved model.run(config).
 * The newer wrapper additionally emits server trace-audit evidence; accepting
 * the legacy wrapper for local playback does not manufacture that evidence. */
export const PREVIEW_COMPATIBLE_ADAPTER_SHA256 = Object.freeze([
 'b0c785d8c08838d9e416eb87aba1c6b5ce9d8b1d6d233cf2fec32de99a0ec7f5',
 'fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898',
]);
export const BROWSER_PREVIEW_SOURCE_PATHS = ['model/model.py','model/run.py','model/model-spec.json','model/visualization.json','app/requirements.lock'] as const;
export const BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS = [...BROWSER_PREVIEW_SOURCE_PATHS,'frontend/manifest.json','frontend/main.mjs'] as const;
export const BROWSER_JS_ENTRY_MAX_BYTES=128*1024;
export const BROWSER_PREVIEW_SEED_MAX = 4294967295;
export type PreviewSourcePath = typeof BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS[number];
export type PreviewFile = {path:PreviewSourcePath;sha256:string;byteLength:number};
export type PreviewDependency = {name:string;version:string;sha256:string};
export type PreviewRuntime = {profileId:'python-stdlib/v1'|'mesa-3.5.1/v1';runtimeVersion:string;adapterVersion:string;pythonVersion:string;assetSha256:string;visualProtocol:'riffology.visual/v0.1';limitsSha256:string;dependencies:PreviewDependency[]};
export type PreviewPackageSchema=typeof BROWSER_PREVIEW_SCHEMA|typeof BROWSER_PREVIEW_JAVASCRIPT_SCHEMA;
export type PreviewPackageIdentityInput = {schema:PreviewPackageSchema;projectId:string;revisionId:string;filesSha256:string;sources:PreviewFile[];runtime:PreviewRuntime};
export type BrowserPreviewManifest = PreviewPackageIdentityInput & {packageIdentity:string};
export type BrowserJsManifest={schema:typeof BROWSER_JS_SCHEMA;hostApi:typeof BROWSER_JS_HOST_API;entry:'frontend/main.mjs';width:600;height:420};
export type PreviewParameters = Record<string,string|number|boolean>;
export type PreviewRunInput = {parameters:PreviewParameters;seed:number};
export type PreviewVerifyRequest = PreviewRunInput & {revisionId:string;packageIdentity:string;intent:'experiment';idempotencyKey:string};
export type PreviewBuildReason = 'source-missing'|'source-unavailable'|'model-spec-invalid'|'visualization-invalid'|'frontend-invalid'|'javascript-unsupported'|'dependency-unsupported'|'python-unsupported'|'profile-unavailable'|'source-too-large'|'storage-unavailable'|'object-conflict'|'build-internal';
export type PreviewBuildState =
 | {status:'not_requested';revisionId:string;profileId:PreviewRuntime['profileId']}
 | {status:'building';revisionId:string;profileId:PreviewRuntime['profileId'];buildIdentity:string;attempt:number}
 | {status:'ready';revisionId:string;profileId:PreviewRuntime['profileId'];buildIdentity:string;packageIdentity:string;byteLength:number;sha256:string}
 | {status:'unsupported'|'failed';revisionId:string;profileId:PreviewRuntime['profileId'];buildIdentity:string;reasonCode:PreviewBuildReason};
export type PreviewBuildView = {build:PreviewBuildState;stale:boolean};
const hashPattern=/^[a-f0-9]{64}$/;
const idPattern=/^[A-Za-z0-9_-]{1,128}$/;
function fail():never{throw Error('browser-preview-contract-invalid');}
function object(raw:unknown,keys:string[]):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))fail();
 const descriptors=Object.getOwnPropertyDescriptors(raw);
 if(Reflect.ownKeys(raw).length!==keys.length||keys.some(k=>!descriptors[k]||!Object.hasOwn(descriptors[k],'value')))fail();
 return Object.fromEntries(keys.map(k=>[k,descriptors[k]!.value]));
}
function text(raw:unknown,pattern:RegExp):string{if(typeof raw!=='string'||!pattern.test(raw))fail();return raw;}
function integer(raw:unknown,max:number,min=0):number{if(typeof raw!=='number'||!Number.isSafeInteger(raw)||raw<min||raw>max)fail();return raw;}
export function parsePreviewRuntime(raw:unknown):PreviewRuntime{
 const r=object(raw,['profileId','runtimeVersion','adapterVersion','pythonVersion','assetSha256','visualProtocol','limitsSha256','dependencies']);
 if(r.visualProtocol!=='riffology.visual/v0.1'||r.profileId!=='python-stdlib/v1'&&r.profileId!=='mesa-3.5.1/v1'||!Array.isArray(r.dependencies)||r.dependencies.length>32)fail();
 const dependencies=r.dependencies.map(d=>{const p=object(d,['name','version','sha256']);return {name:text(p.name,/^[a-z][a-z0-9_-]{0,63}$/),version:text(p.version,/^[A-Za-z0-9.+_-]{1,64}$/),sha256:text(p.sha256,hashPattern)};}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 if(new Set(dependencies.map(d=>d.name)).size!==dependencies.length)fail();
 return {profileId:r.profileId,runtimeVersion:text(r.runtimeVersion,/^[A-Za-z0-9./+_-]{1,128}$/),adapterVersion:text(r.adapterVersion,/^[A-Za-z0-9./+_-]{1,128}$/),pythonVersion:text(r.pythonVersion,/^3\.[0-9]+\.[0-9]+$/),assetSha256:text(r.assetSha256,hashPattern),visualProtocol:'riffology.visual/v0.1',limitsSha256:text(r.limitsSha256,hashPattern),dependencies};
}
export function parsePreviewIdentityInput(raw:unknown):PreviewPackageIdentityInput{
 const r=object(raw,['schema','projectId','revisionId','filesSha256','sources','runtime']);
 const paths=r.schema===BROWSER_PREVIEW_SCHEMA?BROWSER_PREVIEW_SOURCE_PATHS:r.schema===BROWSER_PREVIEW_JAVASCRIPT_SCHEMA?BROWSER_PREVIEW_JAVASCRIPT_SOURCE_PATHS:null;
 if(!paths||!Array.isArray(r.sources)||r.sources.length!==paths.length)fail();
 const sources=r.sources.map(f=>{const p=object(f,['path','sha256','byteLength']);if(!paths.includes(p.path as never))fail();const maximum=p.path==='frontend/main.mjs'?BROWSER_JS_ENTRY_MAX_BYTES:1024*1024;return {path:p.path as PreviewSourcePath,sha256:text(p.sha256,hashPattern),byteLength:integer(p.byteLength,maximum)};});
 if(new Set(sources.map(f=>f.path)).size!==sources.length)fail();
 sources.sort((a,b)=>paths.indexOf(a.path as never)-paths.indexOf(b.path as never));
 return {schema:r.schema as PreviewPackageSchema,projectId:text(r.projectId,idPattern),revisionId:text(r.revisionId,idPattern),filesSha256:text(r.filesSha256,hashPattern),sources,runtime:parsePreviewRuntime(r.runtime)};
}
export function parseBrowserJsManifest(raw:unknown):BrowserJsManifest{
 const r=object(raw,['schema','hostApi','entry','width','height']);
 if(r.schema!==BROWSER_JS_SCHEMA||r.hostApi!==BROWSER_JS_HOST_API||r.entry!=='frontend/main.mjs'||r.width!==600||r.height!==420)fail();
 return {schema:BROWSER_JS_SCHEMA,hostApi:BROWSER_JS_HOST_API,entry:'frontend/main.mjs',width:600,height:420};
}
/** Sorted JSON keys; arrays have schema-defined ordering, never locale ordering. */
export function canonicalPreviewJson(raw:unknown):string{
 if(raw===null||typeof raw==='string'||typeof raw==='boolean')return JSON.stringify(raw);
 if(typeof raw==='number'){if(!Number.isFinite(raw))fail();return JSON.stringify(raw);}
 if(Array.isArray(raw))return '['+raw.map(canonicalPreviewJson).join(',')+']';
 if(raw&&typeof raw==='object'){
  const descriptors=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).some(k=>typeof k!=='string'||!Object.hasOwn(descriptors[k]!,'value')))fail();
  return '{'+Object.keys(descriptors).sort().map(k=>JSON.stringify(k)+':'+canonicalPreviewJson(descriptors[k]!.value)).join(',')+'}';
 }
 return fail();
}
export async function previewSha256(bytes:Uint8Array|string):Promise<string>{const b=typeof bytes==='string'?new TextEncoder().encode(bytes):Uint8Array.from(bytes);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');}
type PreviewDigest=(bytes:Uint8Array|string)=>string|Promise<string>;
export async function previewPackageIdentity(raw:unknown,digest:PreviewDigest=previewSha256):Promise<string>{return digest(canonicalPreviewJson(parsePreviewIdentityInput(raw)));}
export async function createPreviewManifest(raw:unknown,digest:PreviewDigest=previewSha256):Promise<BrowserPreviewManifest>{const input=parsePreviewIdentityInput(raw);return {...input,packageIdentity:await previewPackageIdentity(input,digest)};}
export async function parsePreviewManifest(raw:unknown,digest:PreviewDigest=previewSha256):Promise<BrowserPreviewManifest>{const r=object(raw,['schema','projectId','revisionId','filesSha256','sources','runtime','packageIdentity']);const {packageIdentity,...input}=r;const manifest=await createPreviewManifest(input,digest);if(text(packageIdentity,hashPattern)!==manifest.packageIdentity)fail();return manifest;}
export function parsePreviewRunInput(raw:unknown):PreviewRunInput{
 const r=object(raw,['parameters','seed']);const p=r.parameters;if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length>64)fail();
 const parameters=object(p,Object.keys(p));
 for(const [k,v] of Object.entries(parameters))if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(k)||!(typeof v==='boolean'||typeof v==='string'&&v.length<=1024||typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER))fail();
 const result={parameters:parameters as PreviewParameters,seed:integer(r.seed,BROWSER_PREVIEW_SEED_MAX)};if(new TextEncoder().encode(canonicalPreviewJson(result)).length>8192)fail();return result;
}
export function parsePreviewVerifyRequest(raw:unknown):PreviewVerifyRequest{const r=object(raw,['revisionId','packageIdentity','parameters','seed','intent','idempotencyKey']);if(r.intent!=='experiment')fail();return {...parsePreviewRunInput({parameters:r.parameters,seed:r.seed}),revisionId:text(r.revisionId,idPattern),packageIdentity:text(r.packageIdentity,hashPattern),intent:'experiment',idempotencyKey:text(r.idempotencyKey,idPattern)};}
export function previewBuildView(build:PreviewBuildState,currentRevisionId:string|null):PreviewBuildView{return {build:structuredClone(build),stale:currentRevisionId!==null&&build.revisionId!==currentRevisionId};}
