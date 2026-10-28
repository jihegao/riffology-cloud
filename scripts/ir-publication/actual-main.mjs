/** Local Git reads only; no fetch, shell, authentication, checkout or mutation. */
import {execFile} from 'node:child_process';
import {need,sha,hashJSON,current,COMMIT,Stop} from './local-guards.mjs';
const REPOSITORY='/Users/jihegao/apps/riffology-cloud';
const env={PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1'};
function git(args,{signal,deadline,input}={}){current(signal,deadline);return new Promise((resolve,reject)=>{const child=execFile('/usr/bin/git',['--no-pager','-c','core.hooksPath=/dev/null','-C',REPOSITORY,...args],{env,encoding:'buffer',timeout:Math.min(20000,deadline-Date.now()),maxBuffer:96*1024*1024,signal},(error,stdout)=>error?reject(new Stop('actual-main-local-git-stopped')):resolve(stdout));child.stdin.on('error',()=>{});child.stdin.end(input);});}
export async function assertActualLocalMain(facts,source,{signal,deadline}={}){
  need(COMMIT.test(facts.finalMain.sha)&&COMMIT.test(facts.finalMain.tree),'fixed-final-main-identity');
  const ref=()=>git(['rev-parse','--verify','refs/remotes/origin/main'],{signal,deadline});
  need((await ref()).toString('ascii').trim()===facts.finalMain.sha,'actual-local-origin-main-mismatch');
  need((await git(['rev-parse','--verify',facts.finalMain.sha+'^{tree}'],{signal,deadline})).toString('ascii').trim()===facts.finalMain.tree,'actual-main-tree-mismatch');
  const rows=source.files;need(Array.isArray(rows)&&rows.length>0&&rows.every(x=>typeof x.path==='string'&&!/[\r\n\0]/.test(x.path)&&COMMIT.test(x.gitBlob??'')),'actual-main-source-inventory');
  const tree=(await git(['ls-tree','-r','-z','--full-tree',facts.finalMain.sha,'--',...rows.map(x=>x.path)],{signal,deadline})).toString('utf8'),map=new Map();
  for(const entry of tree.split('\0').filter(Boolean)){const tab=entry.indexOf('\t'),head=entry.slice(0,tab).split(' ');need(tab>0&&head.length===3&&head[1]==='blob'&&COMMIT.test(head[2]),'actual-main-tree-blob-shape');map.set(entry.slice(tab+1),head[2]);}
  need(map.size===rows.length&&rows.every(x=>map.get(x.path)===x.gitBlob),'actual-main-all-source-blob-link');
  const data=await git(['cat-file','--batch'],{signal,deadline,input:Buffer.from(rows.map(x=>x.gitBlob+'\n').join(''),'ascii')});let at=0;
  for(const row of rows){current(signal,deadline);const end=data.indexOf(10,at);need(end>at&&end-at<128,'actual-main-blob-header');const header=data.subarray(at,end).toString('ascii').split(' ');need(header.length===3&&header[0]===row.gitBlob&&header[1]==='blob'&&String(row.bytes)===header[2],'actual-main-blob-size');at=end+1;const bytes=data.subarray(at,at+row.bytes);need(bytes.length===row.bytes&&sha(bytes)===row.sha256&&data[at+row.bytes]===10,'actual-main-all-source-bytes');at+=row.bytes+1;}
  need(at===data.length&&(await ref()).toString('ascii').trim()===facts.finalMain.sha,'actual-main-tail-or-ref-drift');
  return {schema:'riffoid-ir.actual-local-main-source-readback/v1',repository:REPOSITORY,actualMainSha:facts.finalMain.sha,actualMainTree:facts.finalMain.tree,sourceCount:rows.length,sourceRowsCanonicalSha256:hashJSON(rows),observedAt:new Date().toISOString(),onlyLocalGitReads:true,remoteFetchPerformed:false};
}
export async function recheckActualMainRef(facts,{signal,deadline}={}){need((await git(['rev-parse','--verify','refs/remotes/origin/main'],{signal,deadline})).toString('ascii').trim()===facts.finalMain.sha,'actual-local-origin-main-mismatch');}
