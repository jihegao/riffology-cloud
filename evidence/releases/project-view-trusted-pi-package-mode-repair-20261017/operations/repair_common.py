"""Pure fixed-scope validation. Import reads public scope only; no transport/auth."""
import base64,datetime as dt,hashlib,json,os,re
from pathlib import Path
from types import MappingProxyType
HERE=Path(__file__).resolve().parent
SCOPE_SHA='3ae7c17eb9a25876294d3ee3e94f634e218fc431238b8181ae48f2d35915d8aa'
OPS_FILES=('EXECUTION.md','build-probe-repair.py','repair_common.py','scope.json','test_repair_operations.py','transfer-local.py','transfer-receiver.py')
HEX=re.compile(r'^[a-f0-9]{64}$')
class Stop(Exception):pass
def guard(ok,code):
 if not ok:raise Stop(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def freeze(v):
 if isinstance(v,dict):return MappingProxyType({k:freeze(x) for k,x in v.items()})
 if isinstance(v,list):return tuple(freeze(x) for x in v)
 return v
def read_regular(p,limit):
 guard(p.is_file() and not p.is_symlink() and p.resolve()==p and p.stat().st_size<=limit,'bounded-regular-input')
 return p.read_bytes()
SCOPE_RAW=read_regular(HERE/'scope.json',32768)
guard(sha(SCOPE_RAW)==SCOPE_SHA,'fixed-scope-sha')
SCOPE=freeze(json.loads(SCOPE_RAW))
def verify_manifest(raw,files):
 guard(len(raw)<=32768 and set(files)==set(OPS_FILES),'operations-complete-files-required')
 m=json.loads(raw)
 guard(m.get('schema')=='trusted-pi-package-permissions-operations-manifest/v1'
  and m.get('requestId')==SCOPE['requestId'] and m.get('canonicalImplementationCommit')==SCOPE['canonicalImplementationCommit']
  and m.get('archiveSha256')==SCOPE['archive']['sha256']
  and m.get('sourceKernelSha256')=='12a22b87f8dbab84d144dbcac0b141d050703f620a5417c0607bb5ab7a38fcd8','operations-manifest-scope')
 guard(set(m.get('files',{}))==set(OPS_FILES),'operations-manifest-file-set')
 for name in OPS_FILES:
  b=files[name];e=m['files'][name]
  guard(isinstance(b,bytes) and len(b)<=131072 and len(b)==e.get('bytes') and sha(b)==e.get('sha256'),'operations-file-drift')
 guard(files['scope.json']==SCOPE_RAW,'operations-scope-drift')
 return m
def validate_grant(raw,manifest_raw,now=None):
 guard(len(raw)<=32768,'grant-byte-limit');g=json.loads(raw)
 expected={'schema':'trusted-pi-package-permissions-grant/v1','approved':True,'requestId':SCOPE['requestId'],
  'parentRequestId':SCOPE['parentRequestId'],'recipient':SCOPE['recipient'],'remoteDirectory':SCOPE['remoteDirectory'],
  'canonicalImplementationCommit':SCOPE['canonicalImplementationCommit'],'archiveSha256':SCOPE['archive']['sha256'],
  'archiveBytes':SCOPE['archive']['bytes'],'operationsManifestSha256':sha(manifest_raw),'baseImage':SCOPE['baseImage'],
  'operations':list(SCOPE['operations']),'excluded':list(SCOPE['excluded'])}
 guard(all(g.get(k)==v for k,v in expected.items()),'missing-or-wrong-specific-human-grant')
 guard(isinstance(g.get('humanReplySha256'),str) and HEX.fullmatch(g['humanReplySha256']),'specific-human-reply-evidence-required')
 try:
  start=dt.datetime.fromisoformat(g['approvedAt'].replace('Z','+00:00'));end=dt.datetime.fromisoformat(g['expiresAt'].replace('Z','+00:00'))
  now=now or dt.datetime.now(dt.timezone.utc)
  guard(start.tzinfo is not None and end.tzinfo is not None and start<=now<=end
        and 0<(end-start).total_seconds()<=3600,'grant-window-expired-or-invalid')
 except (KeyError,ValueError,TypeError):raise Stop('grant-window-invalid') from None
 return {'humanGrantSha256':sha(raw),'operationsManifestSha256':sha(manifest_raw),'humanReplySha256':g['humanReplySha256']}
def verify_installed_authorization(grant_sha):
 guard(HERE==Path(SCOPE['remoteDirectory'])/'operations' and HEX.fullmatch(grant_sha or ''),'fixed-installed-operations-path')
 m=read_regular(HERE/'operations-manifest.json',32768)
 files={n:read_regular(HERE/n,131072) for n in OPS_FILES};verify_manifest(m,files)
 raw=read_regular(HERE/'human-grant.json',32768);guard(sha(raw)==grant_sha,'installed-grant-sha')
 return validate_grant(raw,m)
def validate_archive(raw):
 guard(len(raw)==SCOPE['archive']['bytes'] and sha(raw)==SCOPE['archive']['sha256'],'fixed-repair-archive-sha-size')
