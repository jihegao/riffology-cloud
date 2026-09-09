import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('real Workerd persists three logical deadlines without clearing another domain',{timeout:20000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'m3-service-alarm-'));
 const entry=`import {DurableObject} from 'cloudflare:workers';
 import {DurableTurnAlarmPort,DurableServiceAlarmPort} from './services/workspace/turn-alarm.ts';
 import {WORKSPACE_STATE_KEY} from './services/workspace/shared-alarm.ts';
 export class Alarm extends DurableObject{
  async alarm(){throw Error("unexpected-test-alarm");}
  async act(body){
   const turn=new DurableTurnAlarmPort(this.ctx.storage),service=new DurableServiceAlarmPort(this.ctx.storage);
   if(body.action==='provision'){await this.ctx.storage.put(WORKSPACE_STATE_KEY,{wakeAt:body.at});await turn.reconcile();}
   else if(body.action==='turn')await turn.schedule(body.at);
   else if(body.action==='service')await service.schedule(body.at);
   else if(body.action==='clear-turn')await turn.clear();
   else if(body.action==='clear-service')await service.clear();
   else if(body.action==='reconcile')await turn.reconcile();
   else if(body.action!=='read')throw Error('unknown-action');
   return {turn:turn.read(),service:service.read(),physical:await this.ctx.storage.getAlarm()};
  }
 }
 export default {async fetch(req,env){return Response.json(await env.ALARM.getByName('test').act(await req.json()));}};`;
 const bundle=await build({stdin:{contents:entry,sourcefile:'service-alarm-test.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const worker='service-alarm-test',options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{ALARM:{type:'durable-object',worker,exportName:'Alarm'}},exports:{Alarm:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false}}]};
 let mf;
 const act=async(action,at)=>{const r=await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({action,at})});const text=await r.text();assert.equal(r.status,200,text);return JSON.parse(text);};
 try{
  mf=new Miniflare(options);const base=Date.now()+600000;
  await act('provision',base);await act('turn',base+2000);await act('service',base+1000);
  assert.deepEqual(await act('provision',null),{turn:base+2000,service:base+1000,physical:base+1000});
  await mf.dispose();mf=new Miniflare(options);
  assert.deepEqual(await act('clear-turn'),{turn:null,service:base+1000,physical:base+1000});
  assert.deepEqual(await act('reconcile'),{turn:null,service:base+1000,physical:base+1000});
  await act('turn',base+500);assert.deepEqual(await act('clear-service'),{turn:base+500,service:null,physical:base+500});
  assert.deepEqual(await act('clear-turn'),{turn:null,service:null,physical:null});
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
