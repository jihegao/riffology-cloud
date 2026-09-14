// Current host module and cached SDK imports; fake session, no model/tool calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root='/var/lib/riffology/turns';
if(process.argv[2]==='child'){
  const {runTrustedPiTurnHost}=await import('/opt/riffology/trusted-pi/trusted-pi-turn-host.mjs');
  const identity=JSON.parse(process.argv[3]);
  const token=process.argv[4];
  const result=await runTrustedPiTurnHost(token,{resolveOptions:async()=>({})},{createSession:async()=>({
    subscribe:()=>()=>{},prompt:async()=>({outcome:'completed'}),dispose:async()=>{},
    snapshot:()=>({format:'riffology-pi-session-v1',scope:{tenantId:identity.scope.tenantId,projectId:identity.scope.projectId,sessionId:identity.sessionId},createdAt:new Date().toISOString(),entries:[],leafId:null}),
  })});
  assert.equal(result.outcome,'completed');
}else{
  for(const [command,args] of [['groupadd',['-g','10002','trustedpi']],['useradd',['-u','10002','-g','10002','-M','-s','/usr/sbin/nologin','trustedpi']]])assert.equal(spawnSync(command,args).status,0);
  for(const dir of [root,'/var/lib/riffology/pi']){fs.mkdirSync(dir,{recursive:true});fs.chownSync(dir,10002,10002);fs.chmodSync(dir,0o700)}
  for(const uid of [0,10002]){
    const identity={scope:{tenantId:'tenant-files',projectId:'project-files',workspaceId:'workspace-files',workspaceGeneration:1},sessionId:'session-'+uid,turnId:'turn-files',dispatchId:'dispatch-files',generation:1};
    const token=createHash('sha256').update(JSON.stringify({schemaVersion:1,purpose:'trusted-pi-native',identity})).digest('hex').slice(0,52);
    fs.writeFileSync(`${root}/${token}.control.json`,JSON.stringify({schemaVersion:1,identity,actor:{userId:'user-files',authVersion:1},message:'fixture',inputSessionSha256:null}),{mode:0o644});
    const run=spawnSync(process.execPath,[process.argv[1],'child',JSON.stringify(identity),token],{uid,gid:uid,stdio:'inherit'});
    assert.equal(run.status,0);
    assert.equal(JSON.parse(fs.readFileSync(`${root}/${token}.result.json`)).outcome,'completed');
    for(const suffix of ['result.json','output-session.json']){const stat=fs.statSync(`${root}/${token}.${suffix}`);assert.equal(stat.uid,uid);assert.equal(stat.mode&0o777,0o600)}
  }
  console.log('Actual host imports and checkpoint/result permissions pass for legacy root and UID10002; fake session only.');
}
