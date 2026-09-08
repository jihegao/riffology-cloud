import assert from 'node:assert/strict';
import test from 'node:test';
import { sandboxActorIds } from '../../services/sandbox/policy.ts';
import { handleToolBridgeRequest, type ToolBridgeHttpEnv } from '../../services/tools/http.ts';
import { signTrustedToolRequest } from '../../services/tools/internal-auth.ts';
import type { ToolCommandRecord } from '../../services/tools/ledger.ts';
import type { ToolCommand } from '../../services/tools/protocol.ts';

const key='test-only-tool-bridge-request-key-32-bytes',now=1_800_000_000_000;
const command:ToolCommand={schemaVersion:1,scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',deadlineAt:now+60_000,operation:'write',arguments:{path:'model/main.py',content:'print(1)'}};
const record={status:'completed',effectId:'effect-a'} as ToolCommandRecord;
const idFor=(name:string)=>`id-${name}`;
function env(calls:ToolCommand[]):ToolBridgeHttpEnv{return {
  M2_TOOL_BRIDGE_REQUEST_KEY:key,
  TRUSTED_PI_SANDBOX:{idFromName:name=>({toString:()=>idFor(name)})},
  TOOL_BRIDGE_AGENT:{getByName:()=>({run:async input=>{calls.push(input);return record;}})},
};}
async function request(input:ToolCommand=command,overrides:{containerId?:string;at?:number;mac?:string;role?:string}={}):Promise<Request>{
  const body=new TextEncoder().encode(JSON.stringify(input)).buffer as ArrayBuffer,actor=(await sandboxActorIds(input.scope,input.turnId,input.dispatchId)).trustedPi,containerId=overrides.containerId??idFor(actor),at=overrides.at??now;
  const mac=overrides.mac??await signTrustedToolRequest(key,containerId,at,body);
  return new Request('https://tool-bridge.riffology.internal/v1/tool',{method:'POST',headers:{'content-type':'application/json','x-riffology-sandbox-role':overrides.role??'trusted-pi','x-riffology-sandbox-id':containerId,'x-riffology-request-at':String(at),'x-riffology-request-mac':mac},body});
}

test('internal tool endpoint binds signed container identity to derived Trusted Pi actor',async()=>{
  const calls:ToolCommand[]=[],response=await handleToolBridgeRequest(await request(),env(calls),()=>now);
  assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(calls[0]!.commandId,'command-a');assert.equal(response.headers.get('cache-control'),'no-store');
});

test('tool endpoint rejects forged, stale and cross-actor requests before the ledger',async()=>{
  for(const candidate of [
    await request(command,{mac:'0'.repeat(64)}),
    await request(command,{at:now-30_001}),
    await request(command,{containerId:'id-wrong-trusted-actor'}),
    await request(command,{role:'project'}),
  ]){
    const calls:ToolCommand[]=[],response=await handleToolBridgeRequest(candidate,env(calls),()=>now);assert.equal(response.status,403);assert.equal(calls.length,0);
  }
});

test('tool endpoint rejects public route variants and maps ledger conflicts without retry',async()=>{
  const calls:ToolCommand[]=[],bad=new Request('https://tool-bridge.riffology.internal/v1/tool?x=1',{method:'POST'});assert.equal((await handleToolBridgeRequest(bad,env(calls),()=>now)).status,404);
  const conflictEnv=env(calls);conflictEnv.TOOL_BRIDGE_AGENT={getByName:()=>({run:async()=>{throw Error('tool-idempotency-conflict');}})};
  assert.equal((await handleToolBridgeRequest(await request(),conflictEnv,()=>now)).status,409);assert.equal(calls.length,0);
});
