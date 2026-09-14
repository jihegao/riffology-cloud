import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
// Uses an already-built local Project image; never pulls, deploys, or calls a model.
const image=process.env.RIFFOLOGY_PROJECT_TEST_IMAGE ?? 'riffology-project-bash-local:current';
const program=String.raw`
import json, os, subprocess, sys, time
sys.path.insert(0,'/opt/riffology')
import process_quiescence as q
# Initialize the same Turn base before any user file writes.
token='a'*52
os.makedirs('/var/lib/riffology/archives',exist_ok=True)
with open('/var/lib/riffology/archives/'+token+'.input.tar','wb') as source: source.write(bytes(10240))
restored=subprocess.run(['python3','/opt/riffology/platform_workspace_archive.py','restore',token],capture_output=True,text=True,timeout=5)
assert restored.returncode==0,(restored.stdout,restored.stderr)
os.makedirs('/workspace/model',exist_ok=True)
os.chown('/workspace/model',10001,10001)
def launch(key,script):
    request=json.dumps({'deadlineAt':int(time.time()*1000)+60000,'operation':'bash','arguments':{'script':script,'timeoutMs':30000}})
    with open('/var/lib/riffology/effects/'+key+'.json','w') as f: json.dump({'schemaVersion':1,'effectId':key,'request':request},f)
    return subprocess.Popen(['python3','/opt/riffology/effect_wrapper.py',key],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
# An already exited wrapper can leave a detached descendant alive.
orphan=launch('orphan',"setsid python3 -c 'import time,pathlib; pathlib.Path(\"/workspace/model/orphan_ready\").write_text(\"yes\"); time.sleep(2); pathlib.Path(\"/workspace/model/orphan_late\").write_text(\"bad\")' >/dev/null 2>&1 & while [ ! -f model/orphan_ready ]; do sleep 0.01; done")
out,err=orphan.communicate(timeout=3)
assert orphan.returncode==0,(out,err)
assert q.live_project_pids()
# A detached session ignores TERM and would write after stop if UID sweep missed it.
script="setsid python3 -c 'import signal,time,pathlib; signal.signal(signal.SIGTERM,signal.SIG_IGN); pathlib.Path(\"/workspace/model/ready\").write_text(\"yes\"); time.sleep(2); pathlib.Path(\"/workspace/model/late\").write_text(\"bad\")' >/dev/null 2>&1 & sleep 30"
p=launch('running',script)
for _ in range(200):
    if os.path.exists('/workspace/model/ready'): break
    time.sleep(.01)
assert os.path.exists('/workspace/model/ready')
stop=subprocess.run(['python3','/opt/riffology/process_quiescence.py','seal'],capture_output=True,text=True,timeout=12)
assert stop.returncode==0,(stop.stdout,stop.stderr)
assert stop.stderr==''
proof=json.loads(stop.stdout)
assert proof=={'schemaVersion':1,'sealed':True,'quiescent':True,'projectUid':10001}
p.communicate(timeout=3)
assert q.live_project_pids()==[]
# Repeat runs and a fresh wrapper cannot reopen the persisted fence.
assert q.seal()==proof
p=launch('after','printf forbidden > model/after')
p.communicate(timeout=3)
assert p.returncode!=0
assert not os.path.exists('/workspace/model/after')
time.sleep(2.1)
assert not os.path.exists('/workspace/model/late')
assert not os.path.exists('/workspace/model/orphan_late')
# Platform archive freezes only after seal and refuses any late restore.
archive=['python3','/opt/riffology/platform_workspace_archive.py']
frozen=subprocess.run(archive+['freeze','a'*52],capture_output=True,text=True,timeout=5)
assert frozen.returncode==0,(frozen.stdout,frozen.stderr)
late=subprocess.run(archive+['restore','a'*52],capture_output=True,text=True,timeout=5)
assert late.returncode!=0 and 'project-archive-fence-denied' in late.stderr
# A recreated VM would lack this Turn marker; never save its empty workspace.
missing=subprocess.run(archive+['freeze','c'*52],capture_output=True,text=True,timeout=5)
assert missing.returncode!=0 and 'project-archive-fence-denied' in missing.stderr
# Ordinary root processes were not targeted.
assert os.geteuid()==0
print(json.dumps({'passed':True,'checks':['exited-wrapper-descendant','detached-session','TERM-ignore','live-effect-stop','persistent-seal','late-write-denied','root-survives','sealed-freeze','late-restore-denied','missing-restore-marker-denied']}))
`;
const raceProgram=String.raw`
import json, os, subprocess, sys, time
sys.path.insert(0,'/opt/riffology')
import process_quiescence as q
# Initialize the same Turn base before any user file writes.
token='b'*52
os.makedirs('/var/lib/riffology/archives',exist_ok=True)
with open('/var/lib/riffology/archives/'+token+'.input.tar','wb') as source: source.write(bytes(10240))
restored=subprocess.run(['python3','/opt/riffology/platform_workspace_archive.py','restore',token],capture_output=True,text=True,timeout=5)
assert restored.returncode==0,(restored.stdout,restored.stderr)
os.makedirs('/workspace/model',exist_ok=True)
os.chown('/workspace/model',10001,10001)
archive=['python3','/opt/riffology/platform_workspace_archive.py']
early=subprocess.run(archive+['freeze','b'*52],capture_output=True,text=True,timeout=5)
assert early.returncode!=0 and 'project-archive-fence-denied' in early.stderr
children=[]
# Reserve and consume native commands before releasing the common spawn lock.
# Either ordering of lock acquisition is valid; none may write after proof.
with q.spawn_lock():
    for index in range(6):
        key='race-'+str(index)
        request=json.dumps({'deadlineAt':int(time.time()*1000)+60000,'operation':'bash','arguments':{'script':'sleep 1; printf forbidden > model/'+key,'timeoutMs':30000}})
        with open('/var/lib/riffology/effects/'+key+'.json','w') as f: json.dump({'schemaVersion':1,'effectId':key,'request':request},f)
        children.append(subprocess.Popen(['python3','/opt/riffology/effect_wrapper.py',key],stdout=subprocess.PIPE,stderr=subprocess.PIPE))
    # Controls now remain unconsumed until the admission lock is acquired.
    time.sleep(.1)
    stop=subprocess.Popen(['python3','/opt/riffology/process_quiescence.py','seal'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
stdout,stderr=stop.communicate(timeout=12)
assert stop.returncode==0 and stderr==b''
assert json.loads(stdout)=={'schemaVersion':1,'sealed':True,'quiescent':True,'projectUid':10001}
for child in children: child.communicate(timeout=3)
assert q.live_project_pids()==[]
# Freeze now, and compare its canonical digest after every delayed write deadline.
first=subprocess.run(archive+['freeze','b'*52],capture_output=True,text=True,timeout=5)
assert first.returncode==0,(first.stdout,first.stderr)
time.sleep(1.2)
second=subprocess.run(archive+['freeze','b'*52],capture_output=True,text=True,timeout=5)
assert second.returncode==0 and json.loads(first.stdout)==json.loads(second.stdout)
assert not any(name.startswith('race-') for name in os.listdir('/workspace/model'))
print(json.dumps({'passed':True,'checks':['unsealed-freeze-denied','six-reserved-starts-race-seal','no-delayed-writes-after-proof','stable-frozen-digest']}))
`;
const replacementProgram=String.raw`
import json,subprocess,sys
sys.path.insert(0,'/opt/riffology')
import process_quiescence as q
# Same archive token as the prior fixture, but this is a distinct fresh VM.
q.seal()
result=subprocess.run(['python3','/opt/riffology/platform_workspace_archive.py','freeze','b'*52],capture_output=True,text=True,timeout=5)
assert result.returncode!=0 and 'project-archive-fence-denied' in result.stderr
print(json.dumps({'passed':True,'checks':['fresh-vm-without-restore-denied']}))
`;
const checks=[];
for(const input of [program,raceProgram,replacementProgram]){
  const result=spawnSync('docker',['run','--rm','--pull=never','--network=none','--entrypoint','python3','-i','--mount',`type=bind,source=${resolve('services/project-tools')},target=/opt/riffology,readonly`,image,'-'],{input,encoding:'utf8',timeout:30000});
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);assert.equal(report.passed,true);checks.push(...report.checks);
}
console.log(JSON.stringify({passed:true,checks}));
