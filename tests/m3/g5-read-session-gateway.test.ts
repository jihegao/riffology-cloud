import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGatewayG5ReadonlyReads} from '../../services/gateway/g5-read-services.ts';

const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1};
test('Gateway records the exact authenticated response body and path only for an explicit read session',async()=>{
 const calls:any[]=[];const service=createGatewayG5ReadonlyReads({WORKSPACE_AGENT:{getByName:name=>({recordG5ReadonlyRead:async input=>{calls.push({name,input});}})}}),body=JSON.stringify({revision:'r1'}),plain=new Request('https://app.example.test/api/workspaces/workspace-a/model'),response=Response.json({revision:'r1'});
 assert.equal(await service.record(plain,scope,actor,response),response);assert.equal(calls.length,0);
 const request=new Request(plain,{headers:{'x-riffology-g5-read-session':'g5-read-session-a','x-riffology-g5-read-capability':'a'.repeat(64)}});assert.equal(await service.record(request,scope,actor,response),response);assert.equal(calls.length,1);assert.equal(calls[0].name,'workspace:tenant-a:workspace-a');assert.deepEqual(calls[0].input,{scope,actor,sessionId:'g5-read-session-a',capability:'a'.repeat(64),path:'/api/workspaces/workspace-a/model',status:200,bodySha256:createHash('sha256').update(body).digest('hex')});
 await assert.rejects(service.record(new Request(plain,{headers:{'x-riffology-g5-read-session':'g5-read-session-a'}}),scope,actor,response),/header-invalid/);
});
