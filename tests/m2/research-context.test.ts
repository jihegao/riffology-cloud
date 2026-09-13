import assert from 'node:assert/strict';
import test from 'node:test';
import { handleResearchContextRequest, type ToolBridgeHttpEnv } from '../../services/tools/http.ts';
import { signTrustedToolRequest } from '../../services/tools/internal-auth.ts';
import { sandboxActorIds } from '../../services/sandbox/policy.ts';

const now=1_800_000_000_000, identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
const key='k'.repeat(32);
async function request(body:unknown,containerId:string,at=now){const bytes=new TextEncoder().encode(JSON.stringify(body));return new Request('https://tool-bridge.riffology.internal/v1/research',{method:'POST',headers:{'content-type':'application/json','x-riffology-sandbox-role':'trusted-pi','x-riffology-sandbox-id':containerId,'x-riffology-request-at':String(at),'x-riffology-request-mac':await signTrustedToolRequest(key,containerId,at,bytes.buffer)},body:bytes});}
function env(){return {M2_TOOL_BRIDGE_REQUEST_KEY:key,TRUSTED_PI_SANDBOX:{idFromName(name:string){return {toString:()=>name};}},WORKSPACE_AGENT:{getByName(){return {async researchContext(){return {model:{specSha256:'s'},experiments:[]};}};}}} as unknown as ToolBridgeHttpEnv;}
test('research endpoint verifies signed identity and returns persisted context',async()=>{const ids=await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId);const response=await handleResearchContextRequest(await request({identity,executionDeadlineAt:now+1000},ids.trustedPi),env(),()=>now);assert.equal(response.status,200);assert.deepEqual(await response.json(),{model:{specSha256:'s'},experiments:[]});});
test('research endpoint rejects stale, cross actor and excessive deadline requests',async()=>{const ids=await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId);for(const candidate of [await request({identity,executionDeadlineAt:now+16*60_000},ids.trustedPi),await request({identity:{...identity,turnId:'turn-b'},executionDeadlineAt:now+1000},ids.trustedPi),await request({identity,executionDeadlineAt:now+1000},'wrong-actor')])assert.equal((await handleResearchContextRequest(candidate,env(),()=>now)).status,403);});
