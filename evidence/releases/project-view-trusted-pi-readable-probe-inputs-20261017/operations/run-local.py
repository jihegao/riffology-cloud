#!/usr/bin/env python3
"""One SSH launch of the frozen installed mock; inert without exact new grant."""
import argparse,hashlib,importlib.util,json,os,shlex,signal,stat,sys
from pathlib import Path
import probe_common as c
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('probe_transfer_local',HERE/'transfer-local.py')
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
STATE=HERE/'mock-launch-once'
def verified_transfer(manifest,grant_sha):
 parent=HERE/'transfer-once';path=parent/'result.json'
 c.guard(parent.resolve()==parent and parent.is_dir() and parent.stat().st_uid==os.getuid()
  and stat.S_IMODE(parent.stat().st_mode)==0o700,'private-transfer-result-parent')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());c.guard(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1
   and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=131072,'private-transfer-result-required')
  raw=f.read(131073)
 c.guard(len(raw)<=131072,'transfer-result-byte-limit');local=json.loads(raw);remote=local.get('remoteReceipt',{})
 c.guard(local.get('requestId')==c.SCOPE['requestId'] and local.get('status')=='transferred-verified'
  and isinstance(remote,dict),'local-transfer-ack-not-established')
 expected={'schema':'trusted-pi-probe-readable-transfer-result/v1','requestId':c.SCOPE['requestId'],'status':'transferred-verified',
  'archiveSha256':c.SCOPE['archive']['sha256'],'archiveBytes':c.SCOPE['archive']['bytes'],'fileCount':2,
  'operationsManifestSha256':c.sha(manifest),'humanGrantSha256':grant_sha,'unprefixedTarNames':True,
  'publicInputModes0444':True,'privateOperationsModes0600':True,'credentialReadOrTransferred':False,
  'dockerOrContainerCommandExecuted':False,'cloudWrite':False}
 c.guard(all(remote.get(k)==v for k,v in expected.items()),'full-fixed-transfer-ack-required')
 return {'transferResultSha256':c.sha(raw),'transferredVerified':True}
def launcher(files,manifest,grant_sha):
 expected={n:{'bytes':len(b),'sha256':c.sha(b)} for n,b in files.items()}
 return ("import hashlib,json,os,stat,sys\nfrom pathlib import Path\n"
  +"p=Path("+repr(c.SCOPE['remoteDirectory']+'/operations')+")\n"
  +"assert p.resolve()==p and p.is_dir() and p.stat().st_uid==os.getuid() and stat.S_IMODE(p.stat().st_mode)==0o700\n"
  +"expected="+repr(expected)+"\nsource={}\n"
  +"for name,item in expected.items():\n q=p/name\n assert q.resolve()==q and not q.is_symlink()\n fd=os.open(q,os.O_RDONLY|os.O_NOFOLLOW)\n with os.fdopen(fd,'rb') as f:\n  s=os.fstat(f.fileno());assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size==item['bytes']\n  b=f.read(item['bytes']+1)\n assert len(b)==item['bytes'] and hashlib.sha256(b).hexdigest()==item['sha256']\n source[name]=b\n"
  +"def private_bytes(name,limit,expected_sha):\n q=p/name\n assert q.resolve()==q and not q.is_symlink()\n fd=os.open(q,os.O_RDONLY|os.O_NOFOLLOW)\n with os.fdopen(fd,'rb') as f:\n  s=os.fstat(f.fileno());assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=limit\n  b=f.read(limit+1)\n assert len(b)<=limit and hashlib.sha256(b).hexdigest()==expected_sha\n return b\n"
  +"private_bytes('operations-manifest.json',32768,"+repr(c.sha(manifest))+")\n"
  +"private_bytes('human-grant.json',32768,"+repr(grant_sha)+")\n"
  +"sys.path.insert(0,str(p));sys.argv=[str(p/'mock-probe-once.py'),'--execute','--request-id',"+repr(c.SCOPE['requestId'])+",'--grant-sha256',"+repr(grant_sha)+"]\n"
  +"exec(compile(source['mock-probe-once.py'],str(p/'mock-probe-once.py'),'exec'),{'__file__':str(p/'mock-probe-once.py'),'__name__':'__main__'})\n").encode()
def execute(grant_path,grant_sha,archive_path):
 g,m,files,a,auth=t.load_inputs(grant_path,grant_sha,archive_path)
 transfer=verified_transfer(m,grant_sha) # Unknown/lost transfer ACK never permits launch.
 STATE.mkdir(mode=0o700) # Permanent launch attempt lock; no retry after unknown.
 t.save(STATE/'intent.json',{'schema':'trusted-pi-probe-readable-launch-intent/v1','requestId':c.SCOPE['requestId'],
  'remoteDirectory':c.SCOPE['remoteDirectory'],'imageId':c.SCOPE['imageId'],**auth,**transfer})
 result={'requestId':c.SCOPE['requestId'],'status':'unknown-stopped'}
 try:
  t.STATE=STATE
  raw=t.run_ssh(t.ssh_argv(launcher(files,m,grant_sha)),b'')
  r=json.loads(raw)
  c.guard(r.get('schema')=='trusted-pi-probe-readable-result/v1' and r.get('requestId')==c.SCOPE['requestId']
   and r.get('imageId')==c.SCOPE['imageId'] and r.get('buildPullPushExportPerformed') is False,'fixed-mock-receipt')
  result.update(status=r.get('status'),remoteReceipt=r)
 except BaseException as e:result['errorCode']=str(e) if isinstance(e,c.Stop) else 'launch-local-error'
 finally:t.save(STATE/'result.json',result)
 return result
def main():
 p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');p.add_argument('--grant-file',required=True);p.add_argument('--grant-sha256',required=True);p.add_argument('--archive',required=True);a=p.parse_args()
 try:
  c.guard(a.execute,'explicit-execute-required')
  def stop(*_):raise c.Stop('launch-interrupted-original-request-only')
  for s in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(s,stop)
  r=execute(Path(a.grant_file).resolve(),a.grant_sha256,Path(a.archive).resolve());print(json.dumps(r,sort_keys=True));return 0 if r['status']=='offline-image-compatibility-mock-passed' else 1
 except BaseException as e:print(json.dumps({'requestId':c.SCOPE['requestId'],'status':'unknown-stopped','errorCode':str(e) if isinstance(e,c.Stop) else 'launch-local-error'}));return 1
if __name__=='__main__':sys.exit(main())
