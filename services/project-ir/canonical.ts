import {workspaceArchiveReader} from '../turn-runtime/workspace-file-index.ts';
import {summarize} from '../../vendor/riffoid-ir-plugin/src/model-summary.mjs';

const DRAFT='model/business-ir.draft.json',SETTINGS='.riffoid-ir/settings.json';
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
export type CanonicalIrDisplay={draft:string;currentModel:Record<string,unknown>|null;defaultMode:'code'|'ir'};
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}

/** Reads display facts from the saved canonical files without compiling or
 * advancing a Revision. A present but unreadable file fails explicitly. */
export async function readCanonicalIrDisplay(filesArchive:Uint8Array):Promise<CanonicalIrDisplay>{
 const reader=workspaceArchiveReader(filesArchive);
 function optional(path:string,maxBytes:number):Uint8Array|null{
  try{return reader.read([{path,maxBytes}]).get(path)!;}
  catch(error){if(error instanceof Error&&error.message==='workspace-content-missing')return null;throw error;}
 }
 const draftBytes=optional(DRAFT,1024*1024),settingsBytes=optional(SETTINGS,4*1024);
 const draft=draftBytes===null?'':decoder.decode(draftBytes);
 let defaultMode:'code'|'ir'='code';
 if(settingsBytes!==null){
  const settingsText=decoder.decode(settingsBytes);
  try{const settings:unknown=JSON.parse(settingsText);if(record(settings)&&settings.mode==='ir')defaultMode='ir';}catch{}
 }
 if(draftBytes===null)return {draft,currentModel:null,defaultMode};
 let currentModel:Record<string,unknown>={type:'unknown',ref:DRAFT};
 try{
  const business:unknown=JSON.parse(draft);
  if(record(business)&&business.version==='aircraft-business-ir/v1'&&record(business.payload)&&record(business.payload.sections)){
   const summary=summarize(business);
   currentModel={type:'ir',ref:DRAFT,...typeof business.fingerprint==='string'?{fingerprint:business.fingerprint}:{},summary};
  }
 }catch{}
 return {draft,currentModel,defaultMode};
}
