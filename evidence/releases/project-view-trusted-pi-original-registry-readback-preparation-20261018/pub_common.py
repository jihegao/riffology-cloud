"""Fixed original Registry readback scope. Import reads only bound preparation files."""
import datetime as dt,hashlib,io,json,os,re,stat
from pathlib import Path
SCOPE_SHA='3afa843b35aca80bf6866518ec2b55fd77cd5a40533b0a9fe421031b2ccfb178'
VERIFICATION_SHA='76a53be45c5cd33a5b322bd5dd3dabc6b49f64aa53b739b38a6331cbe998beca'
SCOPE_RAW=globals().get('SCOPE_RAW') or (Path(__file__).resolve().parent/'scope.json').read_bytes()
VERIFICATION_RAW=globals().get('VERIFICATION_RAW') or (Path(__file__).resolve().parent/'verification-source.json').read_bytes()
HEX=re.compile(r'^[a-f0-9]{64}$')
class Stop(Exception):pass
def guard(ok,code):
 if not ok:raise Stop(code)
def sha(b):return hashlib.sha256(b).hexdigest()
guard(sha(SCOPE_RAW)==SCOPE_SHA and sha(VERIFICATION_RAW)==VERIFICATION_SHA,'fixed-readback-scope-and-original-verification')
SCOPE=json.loads(SCOPE_RAW);VERIFICATION=json.loads(VERIFICATION_RAW)
FILES=('EXECUTION.md','local-recovery.py','AUTHORIZATION.md','oci_verify.py','pub_common.py','remote-recovery.py','scope.json','test_recovery.py')
ADDITIONAL_FILES=('independent-readback-readonly.py','test_independent_readback.py','renewal-source-contract.json','verification-source.json')
def read_private(p,limit):
 guard(p.resolve()==p and not p.is_symlink(),'private-file-no-link');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());guard(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=limit,'owned-private-bounded-file');b=f.read(limit+1);e=os.fstat(f.fileno())
 guard(len(b)==s.st_size and (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(e.st_dev,e.st_ino,e.st_size,e.st_mtime_ns,e.st_ctime_ns),'private-file-stable-read');return b
def grant_wire(raw):
 wire=raw.rstrip(b'\n')+b'\n'
 guard(len(raw)<=32768 and raw.endswith(b'\n') and raw.count(b'\n')==1 and b'\r' not in raw and wire==raw and io.BytesIO(wire).readline(32769)==raw,'grant-single-json-line-and-exact-terminal-lf-required');return wire
def manifest(raw,files,additional):
 m=json.loads(raw);guard(len(raw)<=32768 and m.get('schema')=='trusted-pi-original-registry-readback-operations/v1' and m.get('requestId')==SCOPE['requestId'] and m.get('operationId')==SCOPE['operationId'] and set(m.get('files',{}))==set(files)==set(FILES) and set(m.get('additionalFiles',{}))==set(additional)==set(ADDITIONAL_FILES),'complete-readback-source-binding')
 for n,b in {**files,**additional}.items():
  entry=m['files'].get(n,m['additionalFiles'].get(n,{}));guard(len(b)==entry.get('bytes') and sha(b)==entry.get('sha256'),'readback-source-drift')
 guard(files['scope.json']==SCOPE_RAW and additional['verification-source.json']==VERIFICATION_RAW,'fixed-readback-input-bytes');return m
def grant(raw,operations_sha,now=None):
 wire=grant_wire(raw);g=json.loads(wire);guard(HEX.fullmatch(operations_sha or ''),'specific-operations-hash')
 expected={'schema':'trusted-pi-original-registry-readback-grant/v1','approved':True,'requestId':SCOPE['requestId'],'parentRequestId':SCOPE['parentRequestId'],'operationId':SCOPE['operationId'],'scopeSha256':SCOPE_SHA,'operationsManifestSha256':operations_sha}
 for k in ('recipient','accountId','originalDirectory','remoteDirectory','sourceImageId','repository','tag','canonicalPr','canonicalPrHead','newCredential','route','operations','excluded','oauthPolicy','expectedUserIdSha256','originalArchive','expectedPlatformManifest','expectedConfig','originalOperationsManifestSha256','originalHumanGrantSha256','verificationSourceSha256'):
  expected[k]=SCOPE[k]
 guard(all(g.get(k)==v for k,v in expected.items()) and HEX.fullmatch(g.get('humanReplySha256','')),'new-specific-readback-human-grant-required')
 try:
  start=dt.datetime.fromisoformat(g['approvedAt'].replace('Z','+00:00'));end=dt.datetime.fromisoformat(g['expiresAt'].replace('Z','+00:00'));now=now or dt.datetime.now(dt.timezone.utc)
  guard(start.tzinfo is not None and end.tzinfo is not None and start<=now<=end and 0<(end-start).total_seconds()<=3600,'readback-grant-window-invalid')
 except (KeyError,ValueError,TypeError):raise Stop('readback-grant-window-invalid') from None
 return g
def validate_verification(v):
 guard(v==VERIFICATION and v['sourceImageId']==SCOPE['sourceImageId'] and v['originalIndex']==SCOPE['sourceDescriptor'] and v['archiveBytes']==SCOPE['originalArchive']['bytes'] and v['archiveSha256']==SCOPE['originalArchive']['sha256'] and v['linuxAmd64Manifest']==SCOPE['expectedPlatformManifest'] and v['config']==SCOPE['expectedConfig'] and v['rootfsLayerCount']==49 and len(v['layers'])==49 and v['blobCount']==53 and v['allRawBlobHashesSizesReachable'] is True and v['allRunnableDiffIdsMatched'] is True,'original-verification-exact-semantic-binding');return v
def slots():
 v=validate_verification(VERIFICATION);descriptors=[v['linuxAmd64Manifest'],v['linuxAmd64Manifest'],v['config']]+v['layers'];paths=['manifests/'+SCOPE['tag'],'manifests/'+v['linuxAmd64Manifest']['digest']]+['blobs/'+d['digest'] for d in [v['config']]+v['layers']]
 result=[{'slot':i,'path':p,'descriptor':d,'smallRawKind':'manifest' if i<2 else 'config' if i==2 else None} for i,(p,d) in enumerate(zip(paths,descriptors))];guard(len(result)==52,'fixed52-slot-count');return result
