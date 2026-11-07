"""Independent reader fixtures use only synthetic in-memory original records."""
import importlib.util,json,unittest
from pathlib import Path
import repair_common as c
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('reader',HERE/'independent-reader.py');reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
def fixture():
 image='sha256:'+'b'*64;cid='c'*64;records={};put=lambda n,v:records.__setitem__(n,json.dumps(v).encode())
 put('result.json',{'requestId':c.SCOPE['requestId'],'status':'offline-image-compatibility-mock-passed','imageId':image});records['probe.cid']=cid.encode();put('original-container-cleanup.json',{'originalContainerId':cid,'cleanupConfirmed':True,'originalIdAbsent':True,'labelListEmpty':True})
 m=json.loads((HERE.parent/'input-manifest.json').read_text());p={'schema':'trusted-pi-native-resource-snapshot-host-probe/v1','requestId':c.SCOPE['requestId'],'mode':'image','result':'passed','manifestSha256':reader.r.MANIFEST,'uid':10002,'gid':10002,'checkedTargets':12,'overlayTargets':1,'checks':dict.fromkeys(reader.r.CHECKS,True),'imageTargets':[{k:x[k] for k in ('imagePath','bytes','sha256')} for x in m['fileTargets']],'realProviderRequests':0,'credentialsReadByProbe':False,'sourceMacEncodingNormalized':False,'syntheticRequests':{'model':3,'research':3,'projectToolExecutions':0,'ambientFetch':0,'sessionCreations':3,'sessionDisposals':3}};put('probe-report.json',p)
 for i,name in enumerate(reader.NAMES):
  pid=200+i;put(name+'.intent.json',{'argv':reader.r.DOCKER+['--config','synthetic']});put(name+'.original-cli.json',{'pid':pid,'linuxStartTicks':str(pid)})
  out=json.dumps(p).encode() if name=='start-original-once' else b'0' if name=='wait-original' else json.dumps({'State':{'ExitCode':0,'Running':False,'Status':'exited'}}).encode() if name=='completed-original-inspect' else b''
  records[name+'.stdout']=out;records[name+'.stderr']=b''
  put(name+'.result.json',{'originalCliPid':pid,'originalCliLinuxStartTicks':str(pid),'originalCliReaped':True,'error':None,'exitCode':1 if name in ('derived-tag-before','cleanup-original-after') else 0,'streams':{k:{'bytesObserved':len(v),'bytesSaved':len(v),'discardedBytes':0,'sha256':c.sha(v)} for k,v in [('stdout',out),('stderr',b'')]}})
 return records
class ReaderFixtures(unittest.TestCase):
 def setUp(self):
  self.old=c.read_regular;c.read_regular=lambda p,n:(HERE.parent/'input-manifest.json').read_bytes() if str(p).endswith('/input-manifest.json') else self.old(p,n)
 def tearDown(self):c.read_regular=self.old
 def run_fixture(self,data,ticks=lambda p:None):return reader.validate_original(lambda n,limit=131072:data[n],ticks)
 def test_valid_original_complete(self):self.assertTrue(self.run_fixture(fixture())['probePassed'])
 def test_original_process_still_alive(self):
  with self.assertRaises(c.Stop):self.run_fixture(fixture(),lambda p:str(p))
 def test_stream_drift(self):
  d=fixture();d['build-once.stdout']=b'changed'
  with self.assertRaises(c.Stop):self.run_fixture(d)
 def test_cleanup_unconfirmed(self):
  d=fixture();d['original-container-cleanup.json']=b'{}'
  with self.assertRaises(c.Stop):self.run_fixture(d)
 def test_original_terminal_unknown(self):
  d=fixture();d['result.json']=b'{}'
  with self.assertRaises(c.Stop):self.run_fixture(d)
 def test_probe_report_drift(self):
  d=fixture();d['start-original-once.stdout']=b'{}'
  with self.assertRaises(c.Stop):self.run_fixture(d)
if __name__=='__main__':unittest.main()
