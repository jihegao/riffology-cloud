"""Only local fixed-record fixtures; no real Docker/SSH/auth/network."""
import importlib.util,json,os,sys,tempfile,unittest
from pathlib import Path
from unittest import mock
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('independent_b093',HERE/'read-original-once.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
CID='a'*64;GRANT='e'*64;SECRET='WITHHELD_ORIGINAL_STDERR_BODY'
def save(path,value,mode=0o600):
 if not isinstance(value,bytes):value=(json.dumps(value,sort_keys=True)+'\n').encode()
 path.write_bytes(value);path.chmod(mode)
def fixture(root):
 records=root/'mock-probe-once';records.mkdir(mode=0o700);(records/'empty-docker-config').mkdir(mode=0o700)
 save(records/'empty-docker-config/config.json',b'{"auths":{}}\n')
 intent={'requestId':r.REQUEST,'parentRequestId':r.PARENT,'imageId':r.IMAGE,'oneBuild':False,'oneCreate':True,'humanGrantSha256':GRANT,'operationsManifestSha256':r.OPS};save(records/'intent.json',intent)
 cleanup={'originalContainerId':CID,'cleanupConfirmed':True,'originalIdAbsent':True,'labelListEmpty':True};save(records/'original-container-cleanup.json',cleanup);save(records/'probe.cid',CID.encode(),0o664)
 identity={'engineId':r.IMAGE,'engineIdRole':'descriptor','descriptor':{'digest':r.IMAGE,'mediaType':'application/vnd.oci.image.index.v1+json','size':856},'launchConfigMatched':True,'rootfsMatched':True,'rootfsLayerCount':48,'registryReadbackOrPublicationClaim':False};save(records/'cached-image-identity.json',identity)
 terminal={'schema':'trusted-pi-probe-readable-result/v1','requestId':r.REQUEST,'parentRequestId':r.PARENT,'imageId':r.IMAGE,'archiveSha256':r.ARCHIVE,'buildPullPushExportPerformed':False,'noCloudOrProviderAcceptanceClaim':True,'status':'offline-image-compatibility-mock-passed','cleanup':cleanup,'cachedImageIdentity':identity};save(records/'result.json',terminal)
 report={'schema':'trusted-pi-offline-compatibility-probe/v1','mode':'image','result':'passed','manifestSha256':r.F27,'imageTargets':r.TARGETS,'uid':10002,'gid':10002,'checkedTargets':12,'overlayTargets':6,'activeAliasActuallyInspected':True,'sourceEquivalentActiveRelease':False,'sourceMacEncodingNormalized':False,'checks':{k:True for k in r.CHECKS},'syntheticRequests':{'model':3,'research':1,'projectToolExecutions':0,'ambientFetchCalls':0},'realProviderRequests':0,'credentialsReadByProbe':False};save(records/'probe-report.json',report)
 for i,name in enumerate(r.COMMANDS):
  argv=['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config',str(records/'empty-docker-config')]
  save(records/(name+'.intent.json'),{'argv':argv})
  save(records/(name+'.original-cli.json'),{'pid':1000+i,'linuxStartTicks':str(5000+i)})
  streams={}
  for stream,data in [('stdout',b'fixture-output'),('stderr',SECRET.encode())]:
   save(records/(name+'.'+stream),data);streams[stream]={'bytesObserved':len(data),'bytesSaved':len(data),'discardedBytes':0,'sha256':r.sha(data)}
  save(records/(name+'.result.json'),{'originalCliPid':1000+i,'originalCliLinuxStartTicks':str(5000+i),'originalCliReaped':True,'exitCode':0,'error':None,'streams':streams})
 return records
def fake_get(kind,cid):
 r.READ_COUNT+=1
 return {'kind':kind,'exitCode':1 if kind=='original-id' else 0,'reaped':True,'errorCode':None}, {'stdout':b'[]' if kind=='original-id' else b'','stderr':('Error: No such object: '+CID).encode() if kind=='original-id' else b''}
class Tests(unittest.TestCase):
 def test_normal0664_metadata_strict_report_and_two_reads_only(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp).resolve();records=fixture(root)
   with mock.patch.object(r,'ROOT',root),mock.patch.object(r,'RECORDS',records),mock.patch.object(r.sys,'platform','linux'),mock.patch.object(r,'ticks',return_value=None),mock.patch.object(r,'docker_read',side_effect=fake_get) as docker:
    result=r.observe(GRANT);self.assertTrue(result['independentOriginalCleanupConfirmed']);self.assertEqual(result['dockerCommands'],2);self.assertEqual(docker.call_args_list,[mock.call('original-id',CID),mock.call('original-label',CID)])
    self.assertEqual(len(result['commandLifecycles']),14);self.assertTrue(result['probeReport']['all15FrozenChecksTrue']);self.assertNotIn(SECRET,json.dumps(result));self.assertFalse(result['rawEnvInspectStderrGrantOrBodyReturned'])
 def test_missing_record_stops_before_any_docker_get(self):
  for name in ('result.json','create-once.result.json','cleanup-original-after.original-cli.json','probe.cid'):
   with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp).resolve();records=fixture(root);(records/name).unlink()
    with mock.patch.object(r,'ROOT',root),mock.patch.object(r,'RECORDS',records),mock.patch.object(r.sys,'platform','linux'),mock.patch.object(r,'ticks',return_value=None),mock.patch.object(r,'docker_read') as docker:
     with self.assertRaises((r.Stop,OSError)):r.observe(GRANT)
     docker.assert_not_called();self.assertEqual(r.READ_COUNT,0)
 def test_link_rejected_before_any_docker_get(self):
  for name in ('probe.cid','result.json','start-original-once.stderr'):
   with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp).resolve();records=fixture(root);outside=root/'outside';save(outside,(records/name).read_bytes());(records/name).unlink();(records/name).symlink_to(outside)
    with mock.patch.object(r,'ROOT',root),mock.patch.object(r,'RECORDS',records),mock.patch.object(r.sys,'platform','linux'),mock.patch.object(r,'ticks',return_value=None),mock.patch.object(r,'docker_read') as docker:
     with self.assertRaises(r.Stop):r.observe(GRANT)
     docker.assert_not_called();self.assertEqual(r.READ_COUNT,0)
 def test_unknown_or_active_original_cli_stops_before_any_docker_get(self):
  for unknown in ('not-reaped','missing-terminal-ticks-binding','active-original','discarded-output'):
   with self.subTest(unknown=unknown),tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp).resolve();records=fixture(root);p=records/'start-original-once.result.json';terminal=json.loads(p.read_bytes())
    if unknown=='not-reaped':terminal['originalCliReaped']=False
    if unknown=='missing-terminal-ticks-binding':terminal['originalCliLinuxStartTicks']='9999'
    if unknown=='discarded-output':terminal['streams']['stderr']['discardedBytes']=1
    save(p,terminal);current=(lambda pid:str(5000+(pid-1000))) if unknown=='active-original' else (lambda _:None)
    with mock.patch.object(r,'ROOT',root),mock.patch.object(r,'RECORDS',records),mock.patch.object(r.sys,'platform','linux'),mock.patch.object(r,'ticks',side_effect=current),mock.patch.object(r,'docker_read') as docker:
     with self.assertRaises(r.Stop):r.observe(GRANT)
     docker.assert_not_called();self.assertEqual(r.READ_COUNT,0)
if __name__=='__main__':unittest.main()
