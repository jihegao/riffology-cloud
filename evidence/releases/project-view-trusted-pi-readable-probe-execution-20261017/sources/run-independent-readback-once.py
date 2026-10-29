#!/usr/bin/env python3
"""Local transport only for the frozen b093 readonly reader; one SSH, no replay."""
import hashlib,importlib.util,json,os,sys
from pathlib import Path
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
OPS=ROOT/'operations'
GRANT='78c8c59e91a9313e0760ecb71466868fae28c44d2568703d6f8acc26850f947a'
READER='bf86993670c344e264e2b3dff915051fee2ef2f0db5a54404aafcff8bc482a91'
assert hashlib.sha256((OPS/'operations-manifest.json').read_bytes()).hexdigest()=='ae0614dafe7067367703ad41a9e0ff19f25de3ab7c788b85f01c1ff5c6b4fffd'
manifest=json.loads((OPS/'operations-manifest.json').read_bytes())
for name,x in manifest['files'].items():
 b=(OPS/name).read_bytes();assert len(b)==x['bytes'] and hashlib.sha256(b).hexdigest()==x['sha256']
sys.path.insert(0,str(OPS))
spec=importlib.util.spec_from_file_location('fixed_readonly_transport',OPS/'transfer-local.py')
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
t.load_inputs(OPS/'human-grant.json',GRANT,ROOT/'jhg46-pi-probe-readable-v1-20261017.tar.gz')
reader=t.c.read_regular(ROOT/'read-original-once.py',17364)
assert len(reader)==17363 and hashlib.sha256(reader).hexdigest()==READER
STATE=ROOT/'independent-readback-once';STATE.mkdir(mode=0o700)
t.STATE=STATE
t.save(STATE/'intent.json',{'requestId':t.c.SCOPE['requestId'],'humanGrantSha256':GRANT,'readerSha256':READER,'mode':'fixed-readonly-original-cid-and-label-at-most-two-gets'})
result={'requestId':t.c.SCOPE['requestId'],'status':'unknown-stopped','readerSha256':READER}
try:
 argv=['/usr/bin/ssh','-T','-oBatchMode=yes','-oConnectTimeout=10','-oClearAllForwardings=yes','-oForwardAgent=no','-oControlMaster=no','-oControlPath=none','-oPermitLocalCommand=no','AMD128','/usr/bin/python3 - --execute-readonly --grant-sha256 '+GRANT]
 raw=t.run_ssh(argv,reader);r=json.loads(raw)
 assert r.get('schema')=='trusted-pi-probe-readable-independent-readback/v1' and r.get('requestId')==t.c.SCOPE['requestId'] and r.get('imageId')==t.c.SCOPE['imageId']
 assert r.get('remoteWrites')==0 and r.get('newBuildCreateStartPullPushExportAuthOrCloudWrite') is False and r.get('independentOriginalCleanupConfirmed') is True
 result.update(status='independent-original-cleanup-confirmed',remoteReceipt=r)
except BaseException as e:result['errorCode']=str(e) if isinstance(e,t.c.Stop) else 'readonly-local-error'
finally:t.save(STATE/'result.json',result)
print(json.dumps(result,sort_keys=True))
sys.exit(0 if result['status']=='independent-original-cleanup-confirmed' else 1)
