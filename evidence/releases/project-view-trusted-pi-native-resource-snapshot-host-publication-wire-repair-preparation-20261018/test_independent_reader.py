"""Local synthetic record checks only; no real process, socket, SSH or API read."""
import contextlib,hashlib,importlib.util,io,json,os,sys,tempfile,unittest
from pathlib import Path
from unittest import mock
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('publication_readonly',HERE/'independent-cleanup-readonly.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
def raw(x):return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
def desc(b,media):return {'digest':'sha256:'+hashlib.sha256(b).hexdigest(),'size':len(b),'mediaType':media}
def fixtures(root):
 records=root/'records';records.mkdir(mode=0o700);archive=root/'original.oci.tar';archive.write_bytes(b'0'*4096);archive.chmod(0o600)
 def put(n,x):
  p=records/n;p.write_bytes(x if isinstance(x,bytes) else raw(x));p.chmod(0o600)
 config=raw({'os':'linux','architecture':'amd64','config':{'Env':['SYNTHETIC_SECRET_DO_NOT_RETURN']},'rootfs':{'type':'layers','diff_ids':['sha256:'+'5'*64]*49}})
 cd=desc(config,'application/vnd.oci.image.config.v1+json');ld={'digest':'sha256:'+'6'*64,'size':123,'mediaType':'application/vnd.oci.image.layer.v1.tar+gzip'}
 manifest=raw({'schemaVersion':2,'config':cd,'layers':[ld]*49});md=desc(manifest,'application/vnd.oci.image.manifest.v1+json')
 index=raw({'schemaVersion':2,'manifests':[{**md,'platform':{'os':'linux','architecture':'amd64'},'annotations':{'test':'descriptor-annotations-preserved'}}]})
 assert len(index)<856;index+=b' '*(856-len(index));source='sha256:'+hashlib.sha256(index).hexdigest()
 grant='a'*64;operations='b'*64
 put('intent.json',{'requestId':r.REQUEST,'sourceImageId':source,'destination':r.DEST,'humanGrantSha256':grant,'operationsManifestSha256':operations,'supervisorPid':20001,'supervisorLinuxStartTicks':'100'})
 put('terminal.json',{'schema':'trusted-pi-image-publication-result/v1','requestId':r.REQUEST,'sourceImageId':source,'destination':r.DEST,'actualExportAttempts':1,'actualArchiveReadVerifications':1,'actualPushAttempts':1,'status':'original-image-pushed-and-all-raw-registry-readback-verified','credentialFilesAbsent':True,'cleanupErrors':[],'platformManifest':md,'config':cd})
 put('raw-verification.json',{'schema':'trusted-pi-original-oci-verification/v1','sourceImageId':source,'allRawBlobHashesSizesReachable':True,'allRunnableDiffIdsMatched':True,'originalIndex':{'digest':source,'mediaType':'application/vnd.oci.image.index.v1+json','size':856},'linuxAmd64Manifest':md,'config':cd,'layers':[ld]*49,'archiveBytes':4096,'archiveSha256':'83b81e553a9c4e885299650c31cd179e126168c4da50b2dfd3ed1d8ffe5e0b51','blobCount':53,'rootfsLayerCount':49})
 put('registry-readback.json',{'requestId':r.REQUEST,'allRawBodiesMatchOriginal':True,'indexOrAttestationUploaded':False,'readbacks':[{'status':200,'bytes':d['size'],'digest':d['digest']} for d in [md,md,cd]+[ld]*49]})
 for n,b in [('raw-index.json',index),('raw-manifest.json',manifest),('raw-config.json',config)]:put(n,b)
 for k,n in enumerate(r.NAMES):
  streams={}
  for s in ('stdout','stderr'):
   b=raw({'Id':source,'Descriptor':{'digest':source,'size':856},'Os':'linux','Architecture':'amd64','RootFS':{'Layers':['sha256:'+'5'*64]*49},'Config':{'User':'root','Env':['SYNTHETIC_SECRET_DO_NOT_RETURN']}}) if s=='stdout' and n in ('source-before','source-after') else b'private synthetic stream';put(n+'.'+s,b);streams[s]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
  put(n+'.original-cli.json',{'pid':20002+k,'linuxStartTicks':str(101+k)})
  put(n+'.terminal.json',{'pid':20002+k,'linuxStartTicks':str(101+k),'reaped':True,'errorCode':None,'stopErrors':[],'exitCode':1 if n=='new-local-tag-before' else 0,'streams':streams,**({'archiveBytesWritten':4096} if n=='export-once' else {})})
 return source,grant,operations
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name).resolve();self.root.chmod(0o700)
  self.source,self.grant,self.operations=fixtures(self.root)
  self.patches=[mock.patch.object(r,'ROOT',self.root),mock.patch.object(r,'R',self.root/'records'),mock.patch.object(r,'SOURCE',self.source),mock.patch.object(r.sys,'platform','linux'),mock.patch.object(r,'ticks',return_value=None),mock.patch.object(r,'route_absent',return_value=(True,111))]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.tmp.cleanup()
 def pending(self):
  stream=io.StringIO()
  with mock.patch.object(r.sys,'argv',['reader','--execute-readonly','--grant-sha256',self.grant,'--operations-sha256',self.operations]),contextlib.redirect_stdout(stream):rc=r.main()
  result=json.loads(stream.getvalue());self.assertEqual(rc,1);self.assertEqual(result['status'],'cleanup-pending');self.assertFalse('SYNTHETIC_SECRET' in stream.getvalue());return result
 def test_complete_records_safe_projection_and_no_expiry_claim(self):
  result=r.observe(self.grant,self.operations)
  self.assertEqual(result['status'],'original-publication-and-local-cleanup-confirmed');self.assertEqual(len(result['commandLifecycles']),6)
  self.assertFalse(result['credentialRevocationOrExpiryProved']);self.assertEqual(result['remoteWrites'],0);self.assertNotIn('SYNTHETIC_SECRET',json.dumps(result));self.assertNotIn('private synthetic stream',json.dumps(result))
 def test_missing_record_stops_before_route_read(self):
  (self.root/'records/terminal.json').unlink();self.pending();r.route_absent.assert_not_called()
 def test_linked_record_stops_before_route_read(self):
  p=self.root/'records/terminal.json';p.rename(self.root/'records/terminal.saved');p.symlink_to('terminal.saved');self.pending();r.route_absent.assert_not_called()
 def test_unknown_original_process_stops_before_route_read(self):
  r.ticks.return_value='100';self.pending();r.route_absent.assert_not_called()
 def test_private_record_mode_drift_stops_before_route_read(self):
  (self.root/'records/terminal.json').chmod(0o664);self.pending();r.route_absent.assert_not_called()
 def test_route_or_auth_copy_remaining_is_pending(self):
  r.route_absent.return_value=(False,0);self.pending()
  r.route_absent.reset_mock();(self.root/'temporary-auth').mkdir(mode=0o700);self.pending();r.route_absent.assert_not_called()
 def test_wrong_export_attempt_count_is_pending(self):
  p=self.root/'records/terminal.json';d=json.loads(p.read_bytes());d['actualExportAttempts']=0;p.write_bytes(raw(d));self.pending()
 def test_original_archive_stat_drift_is_pending(self):
  (self.root/'original.oci.tar').write_bytes(b'changed');self.pending()
 def test_wrong49_layer_count_is_pending(self):
  p=self.root/'records/raw-verification.json';d=json.loads(p.read_bytes());d['rootfsLayerCount']=48;p.write_bytes(raw(d));self.pending()
 def test_export_bytes_written_mismatch_is_pending(self):
  p=self.root/'records/export-once.terminal.json';d=json.loads(p.read_bytes());d['archiveBytesWritten']=1;p.write_bytes(raw(d));self.pending()
 def test_known_precredential_stop_has_no_publication_claim(self):
  path=self.root/'records/terminal.json';x=json.loads(path.read_bytes());x.update(status='unknown-stopped',errorCode='credential-stdin-bound',actualPushAttempts=0);path.write_bytes(raw(x))
  for n in ['registry-readback.json']+[name+'.'+suffix for name in r.NAMES[3:] for suffix in ('original-cli.json','terminal.json','stdout','stderr')]:
   (self.root/'records'/n).unlink()
  result=r.observe(self.grant,self.operations);self.assertFalse(result['publicationVerified']);self.assertFalse(result['mergeAllowed']);self.assertEqual(len(result['commandLifecycles']),3);self.assertIn('stopped-without-publication',result['status'])
if __name__=='__main__':unittest.main()
