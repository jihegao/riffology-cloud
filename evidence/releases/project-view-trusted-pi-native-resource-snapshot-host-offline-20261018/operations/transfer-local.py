#!/usr/bin/env python3
"""One fixed SSH transfer. No OAuth, credentials, forwarding, Docker or cloud API."""
import argparse,base64,datetime as dt,json,os,selectors,shlex,signal,struct,subprocess,sys,time
from pathlib import Path
import repair_common as c
HERE=Path(__file__).resolve().parent
STATE=HERE/'transfer-once'
SAFE_ENV={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin'}
def ticks(pid):
 try:return Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]
 except FileNotFoundError:return None
def save(path,value):
 b=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode();fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
def load_inputs(grant_path,grant_sha,archive_path):
 # These guards finish before any SSH client, authentication or transport.
 c.guard(c.HEX.fullmatch(grant_sha or ''),'explicit-grant-sha-required')
 g=c.read_regular(grant_path,32768);c.guard(c.sha(g)==grant_sha,'human-grant-sha')
 m=c.read_regular(HERE/'operations-manifest.json',32768)
 files={n:c.read_regular(HERE/n,131072) for n in c.OPS_FILES};c.verify_manifest(m,files);auth=c.validate_grant(g,m)
 a=c.read_regular(archive_path,c.SCOPE['archive']['bytes']+1);c.validate_archive(a)
 return g,m,files,a,auth
def ssh_argv(receiver):
 remote='/usr/bin/python3 -c '+shlex.quote(receiver.decode('utf8'))
 return ['/usr/bin/ssh','-T','-oBatchMode=yes','-oConnectTimeout=10','-oClearAllForwardings=yes',
  '-oForwardAgent=no','-oControlMaster=no','-oControlPath=none','-oPermitLocalCommand=no','AMD128',remote]
def envelope(g,m,files,archive):
 head=json.dumps({'schema':'trusted-pi-native-resource-snapshot-host-transfer-envelope/v1','grantBase64':base64.b64encode(g).decode(),
  'manifestBase64':base64.b64encode(m).decode(),'filesBase64':{k:base64.b64encode(v).decode() for k,v in files.items()}},sort_keys=True).encode()
 c.guard(len(head)<=524288,'wire-envelope-bound');return struct.pack('>I',len(head))+head+archive
def stop_child(p):
 try:
  if p.stdin:p.stdin.close()
 except BaseException:pass
 for sig in (signal.SIGTERM,signal.SIGKILL):
  if p.poll() is not None:break
  try:os.killpg(p.pid,sig)
  except ProcessLookupError:pass
  except BaseException:pass
  try:p.wait(timeout=5)
  except BaseException:pass
 return p.poll() is not None
def run_ssh(argv,wire):
 p=None;data={'stdout':bytearray(),'stderr':bytearray()};began=time.monotonic();failure=None;rc=None;identity={}
 try:
  p=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=SAFE_ENV,start_new_session=True)
  identity={'pid':p.pid,'linuxStartTicks':ticks(p.pid),'startedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
  save(STATE/'original-ssh.json',identity)
  with selectors.DefaultSelector() as sel:
   for stream,label,event in [(p.stdout,'stdout',selectors.EVENT_READ),(p.stderr,'stderr',selectors.EVENT_READ),(p.stdin,'stdin',selectors.EVENT_WRITE)]:
    os.set_blocking(stream.fileno(),False);sel.register(stream,event,label)
   sent=0
   while sel.get_map():
    c.guard(time.monotonic()-began<120,'ssh-transfer-timeout')
    for key,_ in sel.select(0.5):
     label=key.data
     if label=='stdin':
      n=os.write(key.fileobj.fileno(),wire[sent:sent+16384]);sent+=n
      if sent==len(wire):sel.unregister(key.fileobj);key.fileobj.close()
     else:
      block=os.read(key.fileobj.fileno(),16384)
      if not block:sel.unregister(key.fileobj);continue
      c.guard(len(data[label])+len(block)<=131072,'ssh-output-bound-unknown');data[label].extend(block)
   rc=p.wait(timeout=5)
 except BaseException as e:failure=str(e) if isinstance(e,c.Stop) else 'ssh-transfer-local-error'
 finally:
  stopped=stop_child(p) if p else False
  if p:
   rc=p.poll()
   for stream in (p.stdin,p.stdout,p.stderr):
    try:stream.close()
    except BaseException:pass
  result={'requestId':c.SCOPE['requestId'],'exitCode':rc,'errorCode':failure,'originalSsh':identity,
   'originalSshReaped':stopped,'elapsedSeconds':round(time.monotonic()-began,3),
   'streams':{k:{'bytesRetained':len(v),'sha256':c.sha(v)} for k,v in data.items()}}
  save(STATE/'ssh-terminal.json',result)
 c.guard(failure is None and stopped and rc==0,'ssh-transfer-unknown-or-failed')
 return bytes(data['stdout'])
def execute(grant_path,grant_sha,archive_path):
 g,m,files,a,auth=load_inputs(grant_path,grant_sha,archive_path)
 STATE.mkdir(mode=0o700) # One permanent transfer attempt lock, never deleted/replayed.
 save(STATE/'intent.json',{'requestId':c.SCOPE['requestId'],'remoteDirectory':c.SCOPE['remoteDirectory'],**auth,
  'archiveSha256':c.sha(a),'archiveBytes':len(a),'receiverSha256':c.sha(files['transfer-receiver.py'])})
 result={'requestId':c.SCOPE['requestId'],'status':'unknown-stopped'}
 try:
  raw=run_ssh(ssh_argv(files['transfer-receiver.py']),envelope(g,m,files,a));r=json.loads(raw)
  c.guard(r.get('schema')=='trusted-pi-native-resource-snapshot-host-transfer-result/v1' and r.get('requestId')==c.SCOPE['requestId']
   and r.get('status')=='transferred-verified' and r.get('archiveSha256')==c.SCOPE['archive']['sha256']
   and r.get('archiveBytes')==c.SCOPE['archive']['bytes'] and r.get('fileCount')==len(c.SCOPE['payload']) and r.get('unprefixedTarNames') is True
   and r.get('operationsManifestSha256')==c.sha(m) and r.get('humanGrantSha256')==c.sha(g)
   and r.get('credentialReadOrTransferred') is False and r.get('dockerOrContainerCommandExecuted') is False
   and r.get('cloudWrite') is False,'exact-transfer-receipt-required')
  result.update(status='transferred-verified',remoteReceipt=r)
 except BaseException as e:result['errorCode']=str(e) if isinstance(e,c.Stop) else 'transfer-local-error'
 finally:save(STATE/'result.json',result)
 return result
def main():
 p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');p.add_argument('--grant-file',required=True);p.add_argument('--grant-sha256',required=True);p.add_argument('--archive',required=True);a=p.parse_args()
 try:
  c.guard(a.execute,'explicit-execute-required')
  def stop(*_):raise c.Stop('transfer-interrupted-original-request-only')
  for s in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(s,stop)
  r=execute(Path(a.grant_file).resolve(),a.grant_sha256,Path(a.archive).resolve());print(json.dumps(r,sort_keys=True));return 0 if r['status']=='transferred-verified' else 1
 except BaseException as e:print(json.dumps({'requestId':c.SCOPE['requestId'],'status':'unknown-stopped','errorCode':str(e) if isinstance(e,c.Stop) else 'transfer-local-error'}));return 1
if __name__=='__main__':sys.exit(main())
