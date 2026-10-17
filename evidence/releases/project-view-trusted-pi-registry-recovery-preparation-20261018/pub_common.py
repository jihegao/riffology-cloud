"""Fixed publication scope and grant validation; import performs no auth/network."""
import datetime as dt,hashlib,json,os,re,stat
from pathlib import Path
SCOPE_SHA='550c3ccae4e342e5684066c38f33bb0a68f64917c5f68a48151a94efd195eac8'
SCOPE_RAW=globals().get('SCOPE_RAW') or (Path(__file__).resolve().parent/'scope.json').read_bytes()
HEX=re.compile(r'^[a-f0-9]{64}$')
class Stop(Exception):pass
def guard(ok,code):
 if not ok:raise Stop(code)
def sha(b):return hashlib.sha256(b).hexdigest()
guard(sha(SCOPE_RAW)==SCOPE_SHA,'fixed-publication-scope-sha')
SCOPE=json.loads(SCOPE_RAW)
FILES=('EXECUTION.md','local-recovery.py','AUTHORIZATION.md','oci_verify.py','pub_common.py','remote-recovery.py','scope.json','test_recovery.py')
def read_private(p,limit):
 guard(p.resolve()==p and not p.is_symlink(),'private-file-no-link')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());guard(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1
   and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=limit,'owned-private-bounded-file')
  b=f.read(limit+1)
 guard(len(b)<=limit,'private-file-byte-limit');return b
def manifest(raw,files):
 m=json.loads(raw);guard(len(raw)<=32768 and m.get('schema')=='trusted-pi-registry-recovery-operations/v1'
  and m.get('requestId')==SCOPE['requestId'] and m.get('sourceImageId')==SCOPE['sourceImageId']
  and set(m.get('files',{}))==set(files)==set(FILES),'complete-fixed-publication-manifest')
 for n,b in files.items():guard(len(b)==m['files'][n]['bytes'] and sha(b)==m['files'][n]['sha256'],'publication-source-drift')
 guard(files['scope.json']==SCOPE_RAW,'publication-scope-byte-drift');return m
def grant(raw,operations_sha,now=None):
 g=json.loads(raw);guard(len(raw)<=32768 and HEX.fullmatch(operations_sha or ''),'grant-bound')
 expected={'schema':'trusted-pi-registry-recovery-grant/v1','approved':True,'requestId':SCOPE['requestId'],
  'parentRequestId':SCOPE['parentRequestId'],'recipient':SCOPE['recipient'],'accountId':SCOPE['accountId'],
  'remoteDirectory':SCOPE['remoteDirectory'],'sourceImageId':SCOPE['sourceImageId'],'repository':SCOPE['repository'],
  'tag':SCOPE['tag'],'operationsManifestSha256':operations_sha,'canonicalPr':239,'canonicalPrHead':SCOPE['canonicalPrHead'],
  'newCredential':SCOPE['newCredential'],'route':SCOPE['route'],'operations':SCOPE['operations'],'excluded':SCOPE['excluded'],
  'oauthPolicy':SCOPE['oauthPolicy'],'sourceArchive':SCOPE['sourceArchive'],'expectedUserIdSha256':SCOPE['expectedUserIdSha256'],'expectedPlatformManifest':SCOPE['expectedPlatformManifest'],'expectedConfig':SCOPE['expectedConfig']}
 guard(all(g.get(k)==v for k,v in expected.items()),'new-specific-publication-human-grant-required')
 guard(HEX.fullmatch(g.get('humanReplySha256','')),'actual-new-human-reply-sha-required')
 try:
  start=dt.datetime.fromisoformat(g['approvedAt'].replace('Z','+00:00'));end=dt.datetime.fromisoformat(g['expiresAt'].replace('Z','+00:00'))
  now=now or dt.datetime.now(dt.timezone.utc)
  guard(start.tzinfo is not None and end.tzinfo is not None and start<=now<=end
   and 0<(end-start).total_seconds()<=3600,'publication-grant-window-invalid')
 except (KeyError,ValueError,TypeError):raise Stop('publication-grant-window-invalid') from None
 return g
