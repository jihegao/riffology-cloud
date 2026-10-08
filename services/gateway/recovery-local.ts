/** Standalone browser-data viewer. No imports, network, runtime, replay or
 * storage writes; exports retain the exact original storage snapshot. */
export const localRecoveryScript=String.raw`(()=>{
const list=document.querySelector('#histories'),out=document.querySelector('#raw'),notice=document.querySelector('#notice'),download=document.querySelector('#download');
const pattern=/^riffology:local-runs:v1:([A-Za-z0-9_-]{1,128}):([A-Za-z0-9_-]{1,128}):([A-Za-z0-9_-]{1,128})$/;
let selected=null;
const reset=()=>{selected=null;download.disabled=true;out.value='';};
function read(key,scope){
 reset();try{const raw=localStorage.getItem(key);if(raw===null){notice.textContent='This saved history is no longer present. Refresh the list.';return;}
 let json=false,value;try{value=raw.length<=1048576?JSON.parse(raw):null;json=value!==null;}catch{}
 selected={raw,scope,json};download.disabled=false;out.value=raw.length<=1048576?raw:raw.slice(0,1048576);
 const expected=value&&value.schemaVersion===1&&value.scope?.tenantId===scope[0]&&value.scope?.projectId===scope[1]&&value.scope?.workspaceId===scope[2]&&Array.isArray(value.records)&&value.records.length<=20;
 notice.textContent=expected?'Saved browser-local / unverified history: '+value.records.length+' records. Original states are shown unchanged; this page cannot resume work.':raw.length>1048576?'The preview is limited to 1 MiB of text. Export retains the complete original snapshot.':'Unrecognized or damaged history. Raw viewing/export preserves the original snapshot; no repair is attempted.';
 }catch{notice.textContent='Browser storage is unavailable. No data was changed.';}
}
document.querySelector('#list').addEventListener('click',()=>{
 reset();list.replaceChildren();try{const keys=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key&&pattern.test(key))keys.push(key);}
 for(const key of keys.sort()){const scope=pattern.exec(key).slice(1),button=document.createElement('button');button.type='button';button.textContent=scope.join(' / ');button.addEventListener('click',()=>read(key,scope));const item=document.createElement('li');item.append(button);list.append(item);}
 notice.textContent=keys.length?'Choose a saved tenant / project / workspace. Reading is local to this browser.':'No browser-local Runs history is stored in this browser on this origin.';
 }catch{notice.textContent='Browser storage is unavailable. No data was changed.';}
});
download.addEventListener('click',()=>{if(!selected)return;const snapshot=selected,url=URL.createObjectURL(new Blob([snapshot.raw],{type:snapshot.json?'application/json':'text/plain'})),link=document.createElement('a');link.href=url;link.download='riffology-local-runs-'+snapshot.scope[2].slice(0,64)+(snapshot.json?'.json':'.txt');document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
})();`;
export const localRecoveryStyle='body{font-family:system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;line-height:1.5}button{margin:.3rem 0;max-width:100%;overflow-wrap:anywhere}textarea{box-sizing:border-box;width:100%;min-height:20rem;white-space:pre-wrap;overflow-wrap:anywhere}li{overflow-wrap:anywhere}';
export function localRecoveryPage(canonical:string):string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Saved browser Runs</title><link rel="stylesheet" href="/legacy-local-runs.css"><h1>Saved browser Runs — read only</h1><p>Use the original browser profile on this old origin. These records are browser-local / unverified, separate from server records and identity. They are not uploaded, imported into the new origin, rerun or promoted to Evidence.</p><p>The server recovery deadline does not delete these local records. Previously running states may no longer be active. This page never changes saved states or pending drafts.</p><p><a href="/">Server recovery and migration guide</a> · <a href="${canonical}/" rel="noreferrer">Open application</a></p><button id="list" type="button">Find saved local histories</button><ul id="histories"></ul><p id="notice" role="status" aria-live="polite">Nothing has been read yet.</p><button id="download" type="button" disabled>Export original snapshot</button><p>The export contains the original stored text and scope. Keep it private. Refresh the list to read a newer snapshot.</p><label for="raw">Original local history</label><textarea id="raw" readonly spellcheck="false"></textarea><script src="/legacy-local-runs.js" defer></script></html>`;
}
