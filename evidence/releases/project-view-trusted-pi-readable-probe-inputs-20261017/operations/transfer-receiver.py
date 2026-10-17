#!/usr/bin/env python3
"""One fixed stdin transfer/unpack, no Docker/SSH/auth/API calls."""
import base64,datetime as dt,gzip,hashlib,io,json,os,signal,struct,sys,tarfile
from pathlib import Path
# Bootstrap validation is self-contained because the reviewed code runs via python -c.
ROOT=Path('/tmp/riffoid-jhg46-image-20261017.AU613w/pi-probe-readable-v1')
REQUEST='b0933502-20df-480a-9a91-d833f5c4358c'
COMMON_SHA='1e1a7422a50955e730d181553e15bbd1751ba07128e7187fc84ad51846baf4ba'
SCOPE_SHA='30a2f55749c79e9cecad29e8c45c3bc443a6da4865b60300ca36f37aa4644dc6'
NAMES=('EXECUTION.md','mock-probe-once.py','probe_common.py','run-local.py','scope.json','test_probe_operations.py','transfer-local.py','transfer-receiver.py')
class Stop(Exception):pass
def guard(ok,code):
 if not ok:raise Stop(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def save(p,b,public_input=False):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:
  f.write(b);f.flush();os.fsync(f.fileno())
  if public_input:os.fchmod(f.fileno(),0o444)
  info=os.fstat(f.fileno())
  guard(info.st_uid==os.getuid() and (info.st_mode & 0o777)==(0o444 if public_input else 0o600),'installed-input-or-private-mode')
 guard(p.read_bytes()==b,'installed-bytes-after-mode')
def exact(stream,n):
 out=bytearray()
 while len(out)<n:
  b=stream.read(n-len(out));guard(b,'transfer-stdin-eof');out.extend(b)
 return bytes(out)
def unpack_members(compressed,scope):
 guard(len(compressed)==scope['archive']['bytes'] and sha(compressed)==scope['archive']['sha256'],'repair-archive-sha-size')
 with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as z:raw=z.read(scope['archive']['uncompressedBytes']+1)
 guard(len(raw)==scope['archive']['uncompressedBytes'] and sha(raw)==scope['archive']['uncompressedSha256'],'repair-tar-sha-size')
 expected=scope['payload'];out={}
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as tf:
  ms=tf.getmembers();guard(len(ms)==2 and [m.name for m in ms]==sorted(expected),'exact-unprefixed-tar-member-set')
  for m in ms:
   guard(m.name in expected and not m.name.startswith('/') and all(x not in ('','.', '..') for x in m.name.split('/'))
    and m.isreg() and not m.linkname and not m.pax_headers and m.uid==m.gid==m.mtime==0 and m.mode==0o444
    and not m.uname and not m.gname,'regular-canonical-tar-member-required')
   e=expected[m.name];guard(0<=m.size<=262144 and m.size==e['bytes'],'tar-member-size')
   b=tf.extractfile(m).read(m.size+1);guard(len(b)==m.size and sha(b)==e['sha256'],'tar-member-sha');out[m.name]=b
 return out
def receive(stream):
 guard(sys.platform=='linux' and ROOT.parent.resolve()==ROOT.parent and ROOT.parent.is_dir()
  and ROOT.parent.stat().st_uid==os.getuid() and not ROOT.parent.stat().st_mode&0o022,'fixed-owned-parent')
 guard(not os.path.lexists(ROOT),'repair-directory-already-exists')
 # The new directory itself is a permanent once lock. Unknown transfer cannot replay.
 ROOT.mkdir(mode=0o700)
 save(ROOT/'transfer-intent.json',(json.dumps({'requestId':REQUEST,'startedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'once':True})+'\n').encode())
 result={'schema':'trusted-pi-probe-readable-transfer-result/v1','requestId':REQUEST,'status':'unknown-stopped'}
 try:
  n=struct.unpack('>I',exact(stream,4))[0];guard(0<n<=524288,'transfer-envelope-limit');h=json.loads(exact(stream,n))
  guard(h.get('schema')=='trusted-pi-probe-readable-transfer-envelope/v1','transfer-envelope-schema')
  grant=base64.b64decode(h['grantBase64'],validate=True);manifest=base64.b64decode(h['manifestBase64'],validate=True)
  files={k:base64.b64decode(v,validate=True) for k,v in h['filesBase64'].items()};guard(set(files)==set(NAMES),'operations-file-set')
  guard(sha(files['scope.json'])==SCOPE_SHA,'scope-sha');scope=json.loads(files['scope.json'])
  guard(scope['requestId']==REQUEST and scope['remoteDirectory']==str(ROOT),'fixed-transfer-identity')
  # Import only the exact reviewed common source after all its wire bytes are manifest-bound.
  m=json.loads(manifest);guard(set(m.get('files',{}))==set(NAMES),'operations-manifest-file-set')
  for name,b in files.items():
   e=m['files'][name];guard(len(b)<=131072 and len(b)==e['bytes'] and sha(b)==e['sha256'],'operations-byte-drift')
  guard(sha(files['probe_common.py'])==COMMON_SHA,'fixed-common-source-sha')
  guard(json.loads(grant).get('operationsManifestSha256')==sha(manifest),'specific-grant-manifest-sha')
  space={'__file__':str(ROOT/'operations/probe_common.py'),'__name__':'probe_common_bootstrap'}
  # Common's import reads scope; persist exact operations privately before validating human grant.
  ops=ROOT/'operations';ops.mkdir(mode=0o700)
  for name,b in files.items():save(ops/name,b)
  save(ops/'operations-manifest.json',manifest);save(ops/'human-grant.json',grant)
  exec(compile(files['probe_common.py'],str(ops/'probe_common.py'),'exec'),space)
  space['verify_manifest'](manifest,files);authorization=space['validate_grant'](grant,manifest)
  archive=exact(stream,scope['archive']['bytes']);guard(stream.read(1)==b'','extra-stdin-bytes')
  members=unpack_members(archive,scope)
  save(ROOT/'input.tar.gz',archive)
  for name,b in members.items():
   p=ROOT/name;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
   guard(p.parent.resolve().is_relative_to(ROOT) and p.resolve()==p,'unpack-path-link')
   save(p,b,public_input=True)
  result.update(status='transferred-verified',archiveSha256=sha(archive),archiveBytes=len(archive),fileCount=len(members),
   operationsManifestSha256=sha(manifest),humanGrantSha256=sha(grant),unprefixedTarNames=True,publicInputModes0444=True,privateOperationsModes0600=True,
   credentialReadOrTransferred=False,dockerOrContainerCommandExecuted=False,cloudWrite=False)
 except BaseException as e:result['errorCode']=str(e) if isinstance(e,Stop) else 'transfer-local-error'
 finally:save(ROOT/'transfer-result.json',(json.dumps(result,sort_keys=True,indent=2)+'\n').encode())
 return result
def main():
 def stop(*_):raise Stop('transfer-timeout-or-interrupted')
 for s in (signal.SIGALRM,signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(s,stop)
 signal.alarm(90)
 try:r=receive(sys.stdin.buffer);print(json.dumps(r,sort_keys=True));return 0 if r['status']=='transferred-verified' else 1
 except BaseException as e:print(json.dumps({'requestId':REQUEST,'status':'unknown-stopped','errorCode':str(e) if isinstance(e,Stop) else 'transfer-local-error'}));return 1
if __name__=='__main__':sys.exit(main())
