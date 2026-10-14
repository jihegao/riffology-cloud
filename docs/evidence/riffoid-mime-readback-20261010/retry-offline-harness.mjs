// Pure offline checks of two immutable public helper snapshots. No real fetch.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const dir=new URL('./',import.meta.url),index=JSON.parse(fs.readFileSync(new URL('public-source-index.json',dir),'utf8'));
const commits=['37cc36c01e19e674519442d0fee03ebc8827e9ae',index.mainResolvedCommit],results=[];
async function check(commit,name,{status=200,headers={},throws=false,method='GET',body,expectedCalls,expectedSleep}){
  const file=index.records.find(r=>r.commit===commit&&r.file==='src/utils/fetch-retry.ts');
  const src=fs.readFileSync(new URL(file.artifact,dir),'utf8').replace("import { USER_AGENT } from '../constants'","const USER_AGENT='offline-mock'");
  const js=stripTypeScriptTypes(src).replaceAll('export ','')+'\nglobalThis.api={fetchWithRetry};';
  let calls=0;const sleeps=[],bodies=[];
  const context={Request,Response,Headers,Date,Math:Object.assign(Object.create(Math),{random:()=>0}),console:{warn(){},error(){}},fetch:async input=>{calls++;if(body!==undefined)bodies.push(await input.text());if(throws)throw Error('offline fetch failure');return new Response(null,{status,headers});},setTimeout:(cb,ms)=>{sleeps.push(ms);cb();}};
  vm.runInNewContext(js,context);let result,error;
  try{result=await context.api.fetchWithRetry(new Request('https://example.invalid/mock',{method,body}));}catch(e){error=e.message;}
  assert.equal(calls,expectedCalls,name+commit);const sleepMS=sleeps.reduce((a,b)=>a+b,0);if(expectedSleep!==undefined)assert.equal(sleepMS,expectedSleep,name+commit);
  results.push({commit,name,method,fetchCalls:calls,bodiesRead:bodies.length,sleepMS,resultStatus:result?.status??null,error:error??null});
}
for(const commit of commits){const old=commit===commits[0];
  await check(commit,'200-single',{expectedCalls:1,expectedSleep:0});
  for(const status of [500,503])await check(commit,'status-'+status,{status,expectedCalls:1,expectedSleep:0});
  await check(commit,'429-no-hints',{status:429,expectedCalls:4,expectedSleep:3500});
  await check(commit,'network-errors',{throws:true,expectedCalls:4,expectedSleep:3500});
  await check(commit,'429-retryafter6',{status:429,headers:{'retry-after':'6'},expectedCalls:old?4:1,expectedSleep:old?18000:0});
  await check(commit,'429-retryafter90',{status:429,headers:{'retry-after':'90'},expectedCalls:old?4:1,expectedSleep:old?90000:0});
  await check(commit,'429-ratelimit6',{status:429,headers:{ratelimit:'"default";r=0;t=6'},expectedCalls:old?4:1,expectedSleep:old?3500:0});
  await check(commit,'429-retryafter5',{status:429,headers:{'retry-after':'5'},expectedCalls:4,expectedSleep:15000});
  await check(commit,'PUT-body-retry',{method:'PUT',body:'synthetic-fixture-only',status:429,expectedCalls:4});
}
console.log(JSON.stringify({tests:results.length,pass:results.length,productionRequests:0,results},null,2));
