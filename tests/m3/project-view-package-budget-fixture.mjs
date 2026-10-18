import {createHash} from 'node:crypto';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {scope} from './project-views-fixture.mjs';

// Long, valid relative asset paths make rewrite inflation observable without
// oversized source files or an oversized Managed candidate/cold text context.
export function budgetFiles(moduleCount=32,{activeModules=moduleCount,exactTotal=false}={}){
 const directory='app/'+'a'.repeat(130),dependency=directory+'/d.mjs',modulePaths=Array.from({length:moduleCount},(_,i)=>directory+'/m'+i+'.mjs');
 const statement="import './d.mjs';\n",rewritten='import '+JSON.stringify('https://project.invalid/'+dependency)+';\n';
 const files={'app/home.html':'<!doctype html><h1>Budget</h1><script type="module" src="./'+directory.slice(4)+'/m0.mjs"></script>',[dependency]:'export {};\n','docs/data.json':'{}'};
 for(const [i,path]of modulePaths.entries())files[path]=i<activeModules?statement.repeat(400):'export {};\n';
 let deliveredBytes=Object.entries(files).reduce((sum,[path,text])=>sum+(modulePaths.indexOf(path)>=0&&modulePaths.indexOf(path)<activeModules?Buffer.byteLength(rewritten)*400:Buffer.byteLength(text)),0);
 if(exactTotal){const remaining=2*1024*1024-deliveredBytes;if(remaining<0||remaining>256*1024)throw Error('invalid budget fixture');files['docs/padding.txt']='x'.repeat(remaining);deliveredBytes+=remaining;}
 const manifest={schema:'project.views/v1',files:Object.keys(files),views:[{id:'home',title:'Budget',entrypoint:'app/home.html'}]};
 files['app/views.json']=JSON.stringify(manifest);
 return {files,manifest,modulePaths,statement,rewritten,deliveredBytes};
}
export function budgetArchive(files){
 const bytes=initialWorkspaceArchive(Object.fromEntries(Object.entries(files).map(([path,text])=>[path,Buffer.from(text)])));
 const source={kind:'saved-turn',identity:{scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1},revision:{revisionId:'revision-a',objectKey:'revisions/a.json',filesSha256:createHash('sha256').update(bytes).digest('hex'),sessionSha256:'b'.repeat(64),committedAt:1000}};
 return {bytes,source};
}
