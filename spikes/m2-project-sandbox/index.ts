import { getSandbox } from '@cloudflare/sandbox';
import { ContainerProxy, ProjectToolSandbox, TrustedPiSandbox } from '../../services/sandbox/classes.ts';
import { issueProjectEffectCapability } from '../../services/sandbox/capability.ts';
import { toolCommandDigest, type ToolCommand } from '../../services/tools/protocol.ts';
import { ToolBridgeAgent } from '../../services/tools/durable.ts';
import { ToolBridgeService } from '../../services/tools/service.ts';
import { toolBridgeActorName } from '../../services/tools/identity.ts';
import { sandboxActorIds } from '../../services/sandbox/policy.ts';
import type { ToolCommandRecord } from '../../services/tools/ledger.ts';
import { ToolArtifactStore } from '../../services/artifacts/durable.ts';
import { TOOL_ARTIFACT_STORE_ACTOR } from '../../services/artifacts/protocol.ts';

export { ContainerProxy, ProjectToolSandbox, TrustedPiSandbox, ToolBridgeAgent, ToolBridgeService, ToolArtifactStore };
interface Env { PROJECT_SANDBOX:DurableObjectNamespace<ProjectToolSandbox>;TRUSTED_PI_SANDBOX:DurableObjectNamespace<TrustedPiSandbox>;TOOL_BRIDGE_AGENT:DurableObjectNamespace<ToolBridgeAgent>;TOOL_ARTIFACT_STORE:DurableObjectNamespace<ToolArtifactStore>;WORKSPACE_CHECKPOINTS:R2Bucket;M2_PROJECT_EFFECT_CAPABILITY_KEY:string }

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method!=='POST'||url.search||!['/local-project-effect-probe','/local-tool-bridge-probe','/local-tool-artifact-probe','/local-tool-http-probe','/local-workspace-archive-probe'].includes(url.pathname))return new Response('not found',{status:404});
    const now=Date.now(),runId=crypto.randomUUID(),effectId=`effect-${runId}`,actorId='m2-project-local-probe';
    const command:ToolCommand={schemaVersion:1,scope:{tenantId:'tenant-local',projectId:'project-local',workspaceId:'workspace-local',workspaceGeneration:1},turnId:`turn-${runId}`,dispatchId:`dispatch-${runId}`,commandId:`command-${runId}`,deadlineAt:now+60_000,operation:'write',arguments:{path:'native-probe.txt',content:'sandbox-rpc-ok'}};
    if(url.pathname==='/local-workspace-archive-probe'){
      const sourceIdentity={scope:command.scope,sessionId:`session-${runId}`,turnId:command.turnId,dispatchId:command.dispatchId,generation:1},sourceActor=(await sandboxActorIds(command.scope,command.turnId,command.dispatchId)).project,source=getSandbox(env.PROJECT_SANDBOX,sourceActor,{sleepAfter:'2m'});
      await source.restoreWorkspace(sourceIdentity,{workspace:null,session:null},null);
      const marker=await source.writeFile('/workspace/archive-probe.txt','before-freeze',{encoding:'utf8'});if(!marker.success)return Response.json({error:'workspace-probe-write-failed'},{status:500});
      const archive=await source.freezeWorkspace(sourceIdentity,{workspace:null,session:null}),filesSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(archive)))].map(value=>value.toString(16).padStart(2,'0')).join(''),checkpoint={revisionId:`revision-${runId}`,objectKey:`turns/${runId}.json`,filesSha256,sessionSha256:'a'.repeat(64),committedAt:now};
      await source.writeFile('/workspace/archive-probe.txt','after-freeze',{encoding:'utf8'});await source.destroy();
      const restoredTurn=`turn-restored-${runId}`,restoredDispatch=`dispatch-restored-${runId}`,restoredIdentity={scope:command.scope,sessionId:sourceIdentity.sessionId,turnId:restoredTurn,dispatchId:restoredDispatch,generation:1},restoredActor=(await sandboxActorIds(command.scope,restoredTurn,restoredDispatch)).project,restoredSandbox=getSandbox(env.PROJECT_SANDBOX,restoredActor,{sleepAfter:'2m'});
      await restoredSandbox.restoreWorkspace(restoredIdentity,{workspace:checkpoint,session:null},archive);
      const restored=await restoredSandbox.readFile('/workspace/archive-probe.txt',{encoding:'utf8'});let wrongActorRejected=false;try{await restoredSandbox.freezeWorkspace(sourceIdentity,{workspace:checkpoint,session:null});}catch{wrongActorRejected=true;}await restoredSandbox.destroy();
      return Response.json({archive:{bytes:archive.byteLength,sha256:filesSha256},restored:{success:restored.success,content:restored.content},authorization:{actorsDerived:sourceActor!==restoredActor,wrongActorRejected}},{status:restored.success&&restored.content==='before-freeze'&&sourceActor!==restoredActor&&wrongActorRejected?200:500});
    }
    if(url.pathname==='/local-tool-http-probe'){
      const trustedActor=(await sandboxActorIds(command.scope,command.turnId,command.dispatchId)).trustedPi;
      const sandbox=getSandbox(env.TRUSTED_PI_SANDBOX,trustedActor,{sleepAfter:'2m'});
      const crossScope={...command,dispatchId:`dispatch-cross-${runId}`,commandId:`command-cross-${runId}`};
      const source=`const command=${JSON.stringify(command)},crossScope=${JSON.stringify(crossScope)};\nconst invoke=async body=>{const response=await fetch('https://tool-bridge.riffology.internal/v1/tool',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};\nlet accepted;for(let attempt=0;attempt<100;attempt++){accepted=await invoke(command);if(['completed','failed','cancelled'].includes(accepted.body.status))break;await new Promise(resolve=>setTimeout(resolve,50));}\nconst replay=await invoke(command),cross=await invoke(crossScope);process.stdout.write(JSON.stringify({accepted,replay,cross})+'\\n');`;
      const written=await sandbox.writeFile('/tmp/m2-tool-http-probe.mjs',source);
      if(!written.success)return Response.json({error:'trusted-probe-write-failed'},{status:500});
      const result=await sandbox.exec('node /tmp/m2-tool-http-probe.mjs',{timeout:30_000});
      if(!result.success||result.exitCode!==0||result.stdout.length>65_536)return Response.json({error:'trusted-probe-exec-failed',exitCode:result.exitCode},{status:500});
      const probe=JSON.parse(result.stdout) as {accepted:{status:number;body:ToolCommandRecord};replay:{status:number;body:ToolCommandRecord};cross:{status:number;body:unknown}};
      const projectActor=(await sandboxActorIds(command.scope,command.turnId,command.dispatchId)).project;
      const file=await getSandbox(env.PROJECT_SANDBOX,projectActor,{sleepAfter:'2m'}).readFile('/workspace/native-probe.txt',{encoding:'utf8'});
      const replayStable=probe.accepted.status===200&&probe.accepted.body.status==='completed'&&probe.replay.status===200&&probe.replay.body.status==='completed'&&probe.accepted.body.effectId===probe.replay.body.effectId;
      const passed=replayStable&&probe.cross.status===403&&file.success&&file.content==='sandbox-rpc-ok';
      return Response.json({authorization:{containerIdBoundToActor:true,crossActorRejected:probe.cross.status===403,requestMac:'hmac-sha256'},accepted:probe.accepted.body,replayStable,file:{success:file.success,path:file.path,content:file.content}},{status:passed?200:500});
    }
    if(url.pathname==='/local-tool-bridge-probe'){
      const bridgeName=await toolBridgeActorName(command.scope,command.turnId,command.dispatchId),bridge=env.TOOL_BRIDGE_AGENT.getByName(bridgeName) as unknown as {run(input:ToolCommand):Promise<ToolCommandRecord>};
      let wrongBridgeRejected=false;
      try{await (env.TOOL_BRIDGE_AGENT.getByName('m2-b-wrong-actor') as unknown as {run(input:ToolCommand):Promise<ToolCommandRecord>}).run(command);}catch{wrongBridgeRejected=true;}
      if(!wrongBridgeRejected)return Response.json({error:'tool-bridge-actor-scope-not-enforced'},{status:500});
      let record=await bridge.run(command);
      for(let attempt=0;attempt<100&&!['completed','failed','cancelled'].includes(record.status);attempt++){
        await new Promise(resolve=>setTimeout(resolve,50));record=await bridge.run(command);
      }
      const replay=await bridge.run(command),projectActor=(await sandboxActorIds(command.scope,command.turnId,command.dispatchId)).project;
      let changedPayloadRejected=false;
      try{await bridge.run({...command,arguments:{path:'native-probe.txt',content:'tampered'}});}catch{changedPayloadRejected=true;}
      const file=await getSandbox(env.PROJECT_SANDBOX,projectActor,{sleepAfter:'2m'}).readFile('/workspace/native-probe.txt',{encoding:'utf8'});
      const replayStable=record.status==='completed'&&replay.status==='completed'&&record.effectId===replay.effectId&&JSON.stringify(record.result)===JSON.stringify(replay.result),passed=replayStable&&changedPayloadRejected&&file.content==='sandbox-rpc-ok';
      return Response.json({authorization:{ledger:'sqlite',bridgeActorDerived:true,projectActorDerived:true,wrongBridgeRejected,changedPayloadRejected},record,replayStable,file:{success:file.success,path:file.path,content:file.content}},{status:passed?200:500});
    }
    if(url.pathname==='/local-tool-artifact-probe'){
      const bridgeName=await toolBridgeActorName(command.scope,command.turnId,command.dispatchId),bridge=env.TOOL_BRIDGE_AGENT.getByName(bridgeName) as unknown as {run(input:ToolCommand):Promise<ToolCommandRecord>};
      const run=async(input:ToolCommand)=>{let record=await bridge.run(input);for(let attempt=0;attempt<100&&!['completed','failed','cancelled'].includes(record.status);attempt++){await new Promise(resolve=>setTimeout(resolve,50));record=await bridge.run(input);}return record;};
      const large='x'.repeat(20_000),write={...command,arguments:{path:'large-artifact.txt',content:large}},read:ToolCommand={...command,commandId:`read-${runId}`,operation:'read',arguments:{path:'large-artifact.txt'}};
      const written=await run(write);if(written.status!=='completed')return Response.json({error:'artifact-probe-write-failed',status:written.status},{status:500});
      const record=await run(read),replay=await bridge.run(read),reference=record.result?.kind==='artifact'&&record.result.artifact&&typeof record.result.artifact==='object'?record.result.artifact as {artifactId?:unknown;bytes?:unknown;sha256?:unknown}:null;
      if(record.status!=='completed'||replay.status!=='completed'||!reference||typeof reference.artifactId!=='string')return Response.json({error:'artifact-probe-materialization-failed',status:record.status},{status:500});
      const artifact=await env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR).read(command.scope,reference.artifactId),decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(artifact.content)) as {kind?:unknown;path?:unknown;content?:unknown};
      const page=async(offset:number,expectedSha256:string|null,index:number)=>run({...command,commandId:`page-${index}-${runId}`,operation:'read_page',arguments:{path:'large-artifact.txt',offset,maxBytes:8192,expectedSha256}}),pageOne=await page(0,null,1),first=pageOne.result as {content?:unknown;nextOffset?:unknown;sha256?:unknown},pageTwo=await page(Number(first.nextOffset),String(first.sha256),2),second=pageTwo.result as {content?:unknown;nextOffset?:unknown;sha256?:unknown},pageThree=await page(Number(second.nextOffset),String(first.sha256),3),third=pageThree.result as {content?:unknown;nextOffset?:unknown;sha256?:unknown;eof?:unknown};
      const pagesComplete=[pageOne,pageTwo,pageThree].every(value=>value.status==='completed')&&`${String(first.content??'')}${String(second.content??'')}${String(third.content??'')}`===large&&third.eof===true&&third.nextOffset===20_000&&first.sha256===second.sha256&&second.sha256===third.sha256;
      const replayStable=record.effectId===replay.effectId&&JSON.stringify(record.result)===JSON.stringify(replay.result),prefix=`tool-artifacts/${command.scope.tenantId}/${command.scope.projectId}/${command.scope.workspaceId}/${command.scope.workspaceGeneration}/${command.turnId}/`,objects=await env.WORKSPACE_CHECKPOINTS.list({prefix}),passed=replayStable&&pagesComplete&&objects.objects.length===1&&decoded.kind==='read'&&decoded.path==='large-artifact.txt'&&decoded.content===large&&artifact.receipt.artifactId===reference.artifactId&&artifact.receipt.bytes===reference.bytes&&artifact.receipt.sha256===reference.sha256;
      return Response.json({record:{status:record.status,effectId:record.effectId,result:record.result},replayStable,r2ObjectCount:objects.objects.length,artifact:artifact.receipt,content:{kind:decoded.kind,path:decoded.path,bytes:new TextEncoder().encode(String(decoded.content??'')).byteLength},paging:{complete:pagesComplete,pages:3,nextOffset:third.nextOffset,sha256:first.sha256}},{status:passed?200:500});
    }
    const sandbox=getSandbox(env.PROJECT_SANDBOX,actorId,{sleepAfter:'2m'});
    const capability=await issueProjectEffectCapability(env.M2_PROJECT_EFFECT_CAPABILITY_KEY,{actorId,command,effectId,expiresAt:now+5*60_000});
    let tamperedRejected=false,wrongActorRejected=false;
    try{await sandbox.executeFileEffect({command,effectId,capability:{...capability,mac:`${capability.mac.slice(0,-1)}${capability.mac.endsWith('0')?'1':'0'}`}});}catch{tamperedRejected=true;}
    const wrongActorCapability=await issueProjectEffectCapability(env.M2_PROJECT_EFFECT_CAPABILITY_KEY,{actorId:'m2-project-wrong-actor',command,effectId,expiresAt:now+5*60_000});
    try{await sandbox.executeFileEffect({command,effectId,capability:wrongActorCapability});}catch{wrongActorRejected=true;}
    if(!tamperedRejected||!wrongActorRejected)return Response.json({error:'project-effect-capability-not-enforced'},{status:500});
    let receipt=await sandbox.executeFileEffect({command,effectId,capability});
    for(let attempt=0;attempt<100&&receipt.phase!=='terminal';attempt++){
      await new Promise(resolve=>setTimeout(resolve,50));
      receipt=await sandbox.observeFileEffect({reference:{scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,digest:await toolCommandDigest(command),effectId},command,capability});
    }
    const file=await sandbox.readFile('/workspace/native-probe.txt',{encoding:'utf8'});
    return Response.json({authorization:{tamperedRejected,wrongActorRejected,ledger:'synthetic-fixture'},receipt,file:{success:file.success,path:file.path,content:file.content}});
  },
} satisfies ExportedHandler<Env>;
