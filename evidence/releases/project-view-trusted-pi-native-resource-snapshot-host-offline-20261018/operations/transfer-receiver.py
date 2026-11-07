#!/usr/bin/env python3
"""One fixed stdin transfer/unpack, no Docker/SSH/auth/API calls."""
import base64,datetime as dt,gzip,hashlib,io,json,os,signal,struct,sys,tarfile
from pathlib import Path
# Bootstrap validation is self-contained because the reviewed code runs via python -c.
ROOT=Path('/tmp/riffoid-jhg46-image-20261017.AU613w/pi-native-resource-snapshot-host-v1')
REQUEST='695e8875-459a-41b3-a148-2e228f2c3727'
COMMON_SHA='0393f27642588dff47bc8f1b0a50a6f9e4f9561bcae0afc8f29756ad009fd100'
SCOPE_SHA='9bce20fe905ec7ff7f00bab0b4ed6ef44501e217b8ce8b2477c0ed77642ca011'
NAMES=('official-config-contract.json', 'EXECUTION.md', 'build-probe-repair.py', 'repair_common.py', 'scope.json', 'test_repair_operations.py', 'test_independent_reader.py', 'independent-reader.py', 'transfer-local.py', 'transfer-receiver.py')
class Stop(Exception):pass
def guard(ok,code):
 if not ok:raise Stop(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def save(p,b):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
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
  ms=tf.getmembers();guard(len(ms)==len(expected) and [m.name for m in ms]==sorted(expected),'exact-unprefixed-tar-member-set')
  for m in ms:
   guard(m.name in expected and not m.name.startswith('/') and all(x not in ('','.', '..') for x in m.name.split('/'))
    and m.isreg() and not m.linkname and not m.pax_headers and m.uid==m.gid==m.mtime==0 and m.mode==0o644
    and not m.uname and not m.gname,'regular-canonical-tar-member-required')
   e=expected[m.name];guard(0<=m.size<=262144 and m.size==e['bytes'],'tar-member-size')
   b=tf.extractfile(m).read(m.size+1);guard(len(b)==m.size and sha(b)==e['sha256'],'tar-member-sha');out[m.name]=b
 guard(out['context/Dockerfile'].decode().splitlines()[0]=='FROM '+scope['baseImage'],'fixed-base')
 return out
def receive(stream):
 guard(sys.platform=='linux' and ROOT.parent.resolve()==ROOT.parent and ROOT.parent.is_dir()
  and ROOT.parent.stat().st_uid==os.getuid() and not ROOT.parent.stat().st_mode&0o022,'fixed-owned-parent')
 guard(not os.path.lexists(ROOT),'repair-directory-already-exists')
 # The new directory itself is a permanent once lock. Unknown transfer cannot replay.
 ROOT.mkdir(mode=0o700)
 save(ROOT/'transfer-intent.json',(json.dumps({'requestId':REQUEST,'startedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'once':True})+'\n').encode())
 result={'schema':'trusted-pi-native-resource-snapshot-host-transfer-result/v1','requestId':REQUEST,'status':'unknown-stopped'}
 try:
  n=struct.unpack('>I',exact(stream,4))[0];guard(0<n<=524288,'transfer-envelope-limit');h=json.loads(exact(stream,n))
  guard(h.get('schema')=='trusted-pi-native-resource-snapshot-host-transfer-envelope/v1','transfer-envelope-schema')
  grant=base64.b64decode(h['grantBase64'],validate=True);manifest=base64.b64decode(h['manifestBase64'],validate=True)
  files={k:base64.b64decode(v,validate=True) for k,v in h['filesBase64'].items()};guard(set(files)==set(NAMES),'operations-file-set')
  guard(sha(files['scope.json'])==SCOPE_SHA,'scope-sha');scope=json.loads(files['scope.json'])
  guard(scope['requestId']==REQUEST and scope['remoteDirectory']==str(ROOT),'fixed-transfer-identity')
  # Import only the exact reviewed common source after all its wire bytes are manifest-bound.
  m=json.loads(manifest);guard(set(m.get('files',{}))==set(NAMES),'operations-manifest-file-set')
  for name,b in files.items():
   e=m['files'][name];guard(len(b)<=131072 and len(b)==e['bytes'] and sha(b)==e['sha256'],'operations-byte-drift')
  guard(sha(files['repair_common.py'])==COMMON_SHA,'fixed-common-source-sha')
  guard(json.loads(grant).get('operationsManifestSha256')==sha(manifest),'specific-grant-manifest-sha')
  space={'__file__':str(ROOT/'operations/repair_common.py'),'__name__':'repair_common_bootstrap'}
  # Common's import reads scope; persist exact operations privately before validating human grant.
  ops=ROOT/'operations';ops.mkdir(mode=0o700)
  for name,b in files.items():save(ops/name,b)
  save(ops/'operations-manifest.json',manifest);save(ops/'human-grant.json',grant)
  exec(compile(files['repair_common.py'],str(ops/'repair_common.py'),'exec'),space)
  space['verify_manifest'](manifest,files);authorization=space['validate_grant'](grant,manifest)
  archive=exact(stream,scope['archive']['bytes']);guard(stream.read(1)==b'','extra-stdin-bytes')
  members=unpack_members(archive,scope)
  save(ROOT/'input.tar.gz',archive)
  for name,b in members.items():
   p=ROOT/name;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
   guard(p.parent.resolve().is_relative_to(ROOT) and p.resolve()==p,'unpack-path-link')
   save(p,b)
   if name in ('input-manifest.json','probe/host-resource-snapshot-probe.mjs'):os.chmod(p,0o444)
  result.update(status='transferred-verified',archiveSha256=sha(archive),archiveBytes=len(archive),fileCount=len(members),
   operationsManifestSha256=sha(manifest),humanGrantSha256=sha(grant),unprefixedTarNames=True,
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
