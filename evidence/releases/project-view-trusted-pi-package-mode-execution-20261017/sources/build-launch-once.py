#!/usr/bin/env python3
"""Local record-only transport around the frozen, authorized remote argv; once only."""
import argparse,datetime as dt,hashlib,importlib.util,json,os,re,selectors,shlex,signal,subprocess,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
OPS=HERE.parent/'jhg46-native-user-acceptance-20261017/pi-package-mode-repair-v1/operations'
REQUEST='a21af2c8-44ff-4f67-a07f-c364bcd6d295'
GRANT='bea3e26bcd34380293afbf6c17df77385652e551d1d0ab1f838c557454fed3de'
MANIFEST='bc8e45a8783748be4db9fc8040745aa239a2a4473b89740dbc09f290add82383'
REMOTE=['/usr/bin/python3','/tmp/riffoid-jhg46-image-20261017.AU613w/pi-package-mode-repair-v1/operations/build-probe-repair.py','--execute','--request-id',REQUEST,'--grant-sha256',GRANT]
STATE=HERE/'build-launch-once'
class Stop(Exception):pass
def guard(ok,c):
 if not ok:raise Stop(c)
def sha(b):return hashlib.sha256(b).hexdigest()
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def save(n,b):
 if not isinstance(b,bytes):b=(json.dumps(b,sort_keys=True,indent=2)+'\n').encode()
 fd=os.open(STATE/n,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
def preflight():
 m=(OPS/'operations-manifest.json').read_bytes();guard(sha(m)==MANIFEST,'manifest-drift')
 mm=json.loads(m)
 for n,x in mm['files'].items():
  p=OPS/n;b=p.read_bytes();guard(not p.is_symlink() and len(b)==x['bytes'] and sha(b)==x['sha256'],'operation-drift')
 g=(OPS/'human-grant.json').read_bytes();guard(sha(g)==GRANT,'grant-drift')
 spec=importlib.util.spec_from_file_location('fixed_common',OPS/'repair_common.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c);c.validate_grant(g,m)
 transfer=json.loads((OPS/'transfer-once/result.json').read_bytes())
 independent=json.loads((HERE/'transfer-installed-independent-readback.json').read_bytes())
 guard(transfer.get('requestId')==REQUEST and transfer.get('status')=='transferred-verified','transfer-not-established')
 # Exact independently reviewed receipt bytes, not an arbitrary readback object.
 guard(sha((HERE/'transfer-installed-independent-readback.json').read_bytes())=='fa3a261b4dfb51dfa604ad869f67ffec844186500dc30c2deb2552b91856d3d2','independent-installed-receipt-drift')
 return mm

def stop_owned_ssh(p):
 errors=[];rc=None
 if p is None:return None,False,errors
 for sig in (signal.SIGTERM,signal.SIGKILL):
  try:rc=p.poll()
  except BaseException:errors.append('poll-unconfirmed')
  if rc is not None:return rc,True,errors
  try:os.killpg(p.pid,sig)
  except ProcessLookupError:pass
  except BaseException:errors.append('signal-unconfirmed')
  try:rc=p.wait(timeout=5)
  except subprocess.TimeoutExpired:pass
  except BaseException:errors.append('wait-unconfirmed')
  if rc is not None:return rc,True,errors
 try:rc=p.poll()
 except BaseException:errors.append('final-poll-unconfirmed')
 return rc,rc is not None,errors

def execute():
 preflight();STATE.mkdir(mode=0o700)
 argv=['/usr/bin/ssh','-T','-oBatchMode=yes','-oConnectTimeout=10','-oClearAllForwardings=yes','-oForwardAgent=no','-oControlMaster=no','-oControlPath=none','-oPermitLocalCommand=no','AMD128',shlex.join(REMOTE)]
 save('intent.json',{'requestId':REQUEST,'startedAt':utc(),'remoteArgv':REMOTE,'grantSha256':GRANT,'operationsManifestSha256':MANIFEST,'launcherSha256':sha(Path(__file__).read_bytes()),'once':True})
 p=None;streams={'stdout':bytearray(),'stderr':bytearray()};began=time.monotonic();error=None;identity={};rc=None
 try:
  p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin'},start_new_session=True)
  identity={'pid':p.pid,'startedAt':utc(),'linuxStartTicks':None,'platform':'macOS-local-ssh'};save('original-ssh.json',identity)
  with selectors.DefaultSelector() as sel:
   for f,k in ((p.stdout,'stdout'),(p.stderr,'stderr')):os.set_blocking(f.fileno(),False);sel.register(f,selectors.EVENT_READ,k)
   while sel.get_map():
    guard(time.monotonic()-began<900,'original-ssh-observation-timeout')
    for key,_ in sel.select(0.5):
     b=os.read(key.fileobj.fileno(),16384)
     if not b:sel.unregister(key.fileobj);continue
     guard(len(streams[key.data])+len(b)<=131072,'original-ssh-output-bound')
     streams[key.data].extend(b)
  rc=p.wait(timeout=5)
 except BaseException as e:error=str(e) if isinstance(e,Stop) else 'local-transport-error'
 finally:
  rc,reaped,stop_errors=stop_owned_ssh(p)
  if p is not None and not reaped:error='original-ssh-stop-unconfirmed'
  if p:
   for f in (p.stdout,p.stderr):
    try:f.close()
    except BaseException:pass
  for k,b in streams.items():save(k+'.private',bytes(b))
  result={'schema':'trusted-pi-package-permissions-build-transport/v1','requestId':REQUEST,'startedAt':identity.get('startedAt'),'endedAt':utc(),'sshExitCode':rc,'errorCode':error,'originalSsh':identity,'originalSshReaped':reaped,'localStopErrors':stop_errors,'remoteStoppedByLocalCleanupProved':False,'streams':{k:{'bytesRetained':len(b),'sha256':sha(b)} for k,b in streams.items()},'status':'unknown-stopped'}
  if error is None and rc is not None:
   try:
    r=json.loads(streams['stdout']);allowed=['schema','requestId','parentRequestId','status','imageId','actualImageConfigUser','baseDerivedLaunchConfigPreserved','endedAt','repairArchiveSha256','canonicalImplementationCommit','noCloudOrProviderAcceptanceClaim']
    safe={k:r[k] for k in allowed if k in r}
    if 'errorCode' in r and isinstance(r['errorCode'],str) and re.fullmatch(r'[a-z0-9_.:-]{1,160}',r['errorCode']):safe['errorCode']=r['errorCode']
    if isinstance(r.get('cleanup'),dict):safe['cleanup']={k:r['cleanup'][k] for k in ['originalContainerId','cleanupConfirmed','originalIdAbsent','labelListEmpty','removeAckUnknown','containerCreateNeverAttempted','errorCode'] if k in r['cleanup']}
    result['safeRemoteResult']=safe
    if r.get('requestId')==REQUEST and r.get('status')=='offline-image-compatibility-mock-passed' and rc==0:result['status']='original-runner-returned-pass-independent-cleanup-pending'
    else:result['status']='original-runner-returned-failed-or-stopped'
   except (ValueError,TypeError,KeyError):result['errorCode']='remote-terminal-not-parseable'
  save('safe-receipt.json',result)
 print(json.dumps(result,sort_keys=True));return 0 if result['status']=='original-runner-returned-pass-independent-cleanup-pending' else 1

def main():
 a=argparse.ArgumentParser();a.add_argument('--execute',action='store_true');v=a.parse_args();guard(v.execute,'explicit-execute-required')
 def interrupted(*_):raise Stop('original-ssh-interrupted')
 for s in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(s,interrupted)
 return execute()
if __name__=='__main__':raise SystemExit(main())
