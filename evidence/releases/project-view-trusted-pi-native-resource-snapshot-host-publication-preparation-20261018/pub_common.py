"""Fixed publication scope and grant validation; import performs no auth/network."""
import datetime as dt,hashlib,json,os,re,stat
from pathlib import Path
SCOPE_SHA='5706179ecc40a18e52f726c712ed7d480fecb7b7741eb6debd14f87531649577'
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
ADDITIONAL_FILES=('independent-cleanup-readonly.py','test_independent_reader.py','renewal-source-contract.json')
def manifest(raw,files,additional):
 m=json.loads(raw);guard(len(raw)<=32768 and m.get('schema')=='trusted-pi-native-host-publication-operations/v1'
  and m.get('requestId')==SCOPE['requestId'] and m.get('sourceImageId')==SCOPE['sourceImageId']
  and set(m.get('files',{}))==set(files)==set(FILES),'complete-fixed-publication-manifest')
 for n,b in files.items():guard(len(b)==m['files'][n]['bytes'] and sha(b)==m['files'][n]['sha256'],'publication-source-drift')
 guard(files['scope.json']==SCOPE_RAW,'publication-scope-byte-drift')
 guard(set(m.get('additionalFiles',{}))==set(additional)==set(ADDITIONAL_FILES),'complete-fixed-additional-source-set')
 for n,b in additional.items():
  e=m['additionalFiles'][n];guard(isinstance(b,bytes) and len(b)<=131072 and len(b)==e.get('bytes') and sha(b)==e.get('sha256'),'additional-publication-source-drift')
 return m
def grant(raw,operations_sha,now=None):
 g=json.loads(raw);guard(len(raw)<=32768 and HEX.fullmatch(operations_sha or ''),'grant-bound')
 expected={'schema':'trusted-pi-native-host-publication-grant/v1','approved':True,'requestId':SCOPE['requestId'],
  'parentRequestId':SCOPE['parentRequestId'],'recipient':SCOPE['recipient'],'accountId':SCOPE['accountId'],
  'remoteDirectory':SCOPE['remoteDirectory'],'sourceImageId':SCOPE['sourceImageId'],'repository':SCOPE['repository'],
  'tag':SCOPE['tag'],'operationsManifestSha256':operations_sha,'canonicalPr':SCOPE['canonicalPr'],'canonicalPrHead':SCOPE['canonicalPrHead'],
  'newCredential':SCOPE['newCredential'],'route':SCOPE['route'],'operations':SCOPE['operations'],'excluded':SCOPE['excluded'],
  'oauthPolicy':SCOPE['oauthPolicy'],'sourceArchive':SCOPE['sourceArchive'],'expectedUserIdSha256':SCOPE['expectedUserIdSha256'],'expectedPlatformManifest':SCOPE['expectedPlatformManifest'],'expectedConfig':SCOPE['expectedConfig'],'sourceDescriptor':SCOPE['sourceDescriptor'],'expectedRootfsLayerCount':SCOPE['expectedRootfsLayerCount'],'discoveryPolicy':SCOPE['discoveryPolicy']}
 guard(all(g.get(k)==v for k,v in expected.items()),'new-specific-publication-human-grant-required')
 guard(HEX.fullmatch(g.get('humanReplySha256','')),'actual-new-human-reply-sha-required')
 try:
  start=dt.datetime.fromisoformat(g['approvedAt'].replace('Z','+00:00'));end=dt.datetime.fromisoformat(g['expiresAt'].replace('Z','+00:00'))
  now=now or dt.datetime.now(dt.timezone.utc)
  guard(start.tzinfo is not None and end.tzinfo is not None and start<=now<=end
   and 0<(end-start).total_seconds()<=3600,'publication-grant-window-invalid')
 except (KeyError,ValueError,TypeError):raise Stop('publication-grant-window-invalid') from None
 return g

def validate_verification(v):
 # Child descriptors may be discovered only by the fixed trusted exporter after the approved immutable index is verified.
 guard(isinstance(v,dict) and v.get('schema')=='trusted-pi-original-oci-verification/v1'
  and v.get('sourceImageId')==SCOPE['sourceImageId'] and v.get('originalIndex')==SCOPE['sourceDescriptor']
  and v.get('allRawBlobHashesSizesReachable') is True and v.get('allRunnableDiffIdsMatched') is True
  and type(v.get('archiveBytes')) is int and 0<v['archiveBytes']<=SCOPE['archiveMaximumBytes']
  and isinstance(v.get('archiveSha256'),str) and HEX.fullmatch(v['archiveSha256'])
  and v.get('rootfsLayerCount')==SCOPE['expectedRootfsLayerCount'] and type(v.get('blobCount')) is int
  and 0<v['blobCount']<=SCOPE['maximumBlobCount'] and isinstance(v.get('layers'),list)
  and len(v['layers'])==SCOPE['expectedRootfsLayerCount']
  and v.get('publisherSignatureVerified') is False and v.get('registryPublicationClaim') is False,
  'fixed-index-complete-export-proof-required')
 for key,media in [('linuxAmd64Manifest','application/vnd.oci.image.manifest.v1+json'),('config','application/vnd.oci.image.config.v1+json')]:
  d=v.get(key);guard(isinstance(d,dict) and set(d)=={'digest','size','mediaType'} and d.get('mediaType')==media
   and isinstance(d.get('digest'),str) and d['digest'].startswith('sha256:') and HEX.fullmatch(d['digest'][7:])
   and type(d.get('size')) is int and 0<d['size']<=1048576,'derived-descriptor-shape')
 for d in v['layers']:
  guard(isinstance(d,dict) and set(d)=={'digest','size','mediaType'} and d.get('mediaType') in ('application/vnd.oci.image.layer.v1.tar','application/vnd.oci.image.layer.v1.tar+gzip')
   and isinstance(d.get('digest'),str) and d['digest'].startswith('sha256:') and HEX.fullmatch(d['digest'][7:])
   and type(d.get('size')) is int and 0<d['size']<=SCOPE['archiveMaximumBytes'],'derived-layer-descriptor-shape')
 return v
