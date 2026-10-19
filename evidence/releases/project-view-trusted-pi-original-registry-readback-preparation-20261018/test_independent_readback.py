"""Synthetic original readback records only; all process/socket state mocked."""
import hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest import mock
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('independent_readback',HERE/'independent-readback-readonly.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
def raw(x):return (json.dumps(x,sort_keys=True,indent=2)+'\n').encode()
def fixture(root,count=52,failed=False):
 old=root/'original';old.mkdir(mode=0o700);phase=old/'registry-readback-recovery-v1';phase.mkdir(mode=0o700);records=phase/'records';records.mkdir(mode=0o700)
 def put(n,x):p=records/n;p.write_bytes(raw(x));p.chmod(0o600)
 dest='registry.cloudflare.com/'+r.S['repository']+':'+r.S['tag']
 put('intent.json',{'schema':'trusted-pi-registry-readback-recovery-intent/v1',**{k:r.S[k] for k in ['requestId','parentRequestId','operationId','sourceImageId','originalOperationsManifestSha256','originalHumanGrantSha256']},'destination':dest,'humanGrantSha256':'a'*64,'operationsManifestSha256':'b'*64,'supervisorPid':20001,'supervisorLinuxStartTicks':'100'})
 put('archive-revalidation.json',{'schema':'trusted-pi-original-readback-archive-revalidation/v1','requestId':r.S['requestId'],'operationId':r.S['operationId'],'originalVerificationSha256':r.S['verificationSourceSha256'],'archiveBytes':r.S['originalArchive']['bytes'],'archiveSha256':r.S['originalArchive']['sha256'],'originalIndex':{'digest':r.S['sourceImageId'],'size':856,'mediaType':'application/vnd.oci.image.index.v1+json'},'platformManifest':r.S['expectedPlatformManifest'],'config':r.S['expectedConfig'],'blobCount':53,'rootfsLayerCount':49,'archiveReadVerifications':1,'exportsAttempted':0,'allRawBlobHashesSizesReachable':True,'allRunnableDiffIdsMatched':True,'originalRecordsUnmodified':True})
 proofs=[]
 for slot in r.SLOTS[:count+(1 if failed else 0)]:
  n=slot['slot'];prefix='get-%02d'%n;d=slot['descriptor'];isfail=failed and n==count
  put(prefix+'.intent.json',{'schema':'trusted-pi-registry-get-intent/v1','requestId':r.S['requestId'],'operationId':r.S['operationId'],'slot':n,'path':slot['path'],'expectedDescriptor':d,'retryAllowed':False})
  terminal={'schema':'trusted-pi-registry-get-terminal/v1','requestId':r.S['requestId'],'operationId':r.S['operationId'],'slot':n,'path':slot['path'],'expectedDescriptor':d,'rawBodyHeadersErrorTextOrAuthPersisted':False,'httpStatus':403 if isfail else 200,'capturedBytes':0 if isfail else d['size'],'capturedSha256':hashlib.sha256(b'').hexdigest() if isfail else d['digest'][7:],'responseCaptureComplete':True,'responseClosed':True,'phase':'http-error-body' if isfail else 'complete','exceptionClass':'HTTPError' if isfail else None,'errorCode':'registry-read-failed' if isfail else None,'manifestOrBlobHeaderMatches':None if isfail else True,'smallRawEqualityPassed':None if isfail or n>=3 else True,'proofAccepted':not isfail};put(prefix+'.terminal.json',terminal)
  if not isfail:
   proof={'schema':'trusted-pi-registry-get-proof/v1','requestId':r.S['requestId'],'operationId':r.S['operationId'],'slot':n,'path':slot['path'],'status':200,'bytes':d['size'],'digest':d['digest'],'headerMatches':True,'smallRawEqualityPassed':True if n<3 else None,'terminalSha256':r.sha(raw(terminal))};put(prefix+'.proof.json',proof);proofs.append(proof)
 terminal={'schema':'trusted-pi-registry-readback-recovery-result/v1',**{k:r.S[k] for k in ['requestId','operationId','sourceImageId']},'destination':dest,'exportsAttempted':0,'pushesAttempted':0,'dockerCommands':0,'credentialFilesWritten':0,'registryGetAttempts':count+(1 if failed else 0),'registryGetProofCount':count,'status':'unknown-stopped' if failed or count<52 else 'all52-original-registry-readbacks-verified','errorCode':'original-registry-readback-slot-failed-no-retry' if failed else None,'cleanupErrors':[],'credentialMemoryCleared':True,'fullOriginalRegistryReadbackVerified':count==52 and not failed}
 if count==52 and not failed:
  allproof={'schema':'trusted-pi-original-registry-readback-complete/v1',**{k:r.S[k] for k in ['requestId','operationId','sourceImageId']},'platformManifest':r.S['expectedPlatformManifest'],'config':r.S['expectedConfig'],'originalVerificationSha256':r.S['verificationSourceSha256'],'proofs':proofs,'all52RawBodiesMatchOriginal':True,'indexOrAttestationUploadAttempted':False,'newPushAttempted':False};put('registry-readback.json',allproof);terminal['readbackProofSha256']=r.sha(raw(allproof))
 put('terminal.json',terminal);return old,phase,records
class ReadbackFixtures(unittest.TestCase):
 def setup_fixture(self,count=52,failed=False):
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);root=Path(tmp.name).resolve();root.chmod(0o700);old,phase,records=fixture(root,count,failed)
  patches=[mock.patch.object(r,'OLD',old),mock.patch.object(r,'ROOT',phase),mock.patch.object(r,'R',records),mock.patch.object(r.sys,'platform','linux'),mock.patch.object(r,'ticks',return_value=None),mock.patch.object(r,'route_absent',return_value=(True,111))]
  for p in patches:p.start();self.addCleanup(p.stop)
  return records
 def observe(self):return r.observe('a'*64,'b'*64)
 def test_complete52_and_cleanup_still_needs_local_ack(self):
  self.setup_fixture();d=self.observe();self.assertTrue(d['all52ProofsAndTerminalVerified']);self.assertTrue(d['registryReadbackRecordsAndCleanupVerified']);self.assertFalse(d['publicationVerified']);self.assertTrue(d['localOriginalAckStillRequired']);self.assertEqual(len(d['slotObservations']),52);self.assertNotIn('Authorization',json.dumps(d))
 def test_partial_failed_slot_is_diagnostic_not_success(self):
  self.setup_fixture(2,True);d=self.observe();self.assertFalse(d['all52ProofsAndTerminalVerified']);self.assertFalse(d['publicationVerified']);self.assertEqual(d['slotObservations'][-1]['httpStatus'],403)
 def test_missing_proof_rejected(self):
  p=self.setup_fixture();(p/'get-12.proof.json').unlink()
  with self.assertRaises(r.Stop):self.observe()
 def test_proof_terminal_hash_drift_rejected(self):
  p=self.setup_fixture();f=p/'get-00.proof.json';d=json.loads(f.read_text());d['terminalSha256']='0'*64;f.write_bytes(raw(d))
  with self.assertRaises(r.Stop):self.observe()
 def test_count_or_descriptor_drift_rejected(self):
  p=self.setup_fixture();f=p/'get-02.proof.json';d=json.loads(f.read_text());d['bytes']+=1;f.write_bytes(raw(d))
  with self.assertRaises(r.Stop):self.observe()
 def test_active_original_supervisor_keeps_cleanup_false(self):
  self.setup_fixture();r.ticks.return_value='100';d=self.observe();self.assertFalse(d['cleanupConfirmed']);self.assertFalse(d['registryReadbackRecordsAndCleanupVerified'])
 def test_route_present_keeps_cleanup_false(self):
  self.setup_fixture();r.route_absent.return_value=(False,0);self.assertFalse(self.observe()['cleanupConfirmed'])
 def test_authcopy_present_keeps_cleanup_false(self):
  p=self.setup_fixture();(p.parent/'temporary-auth').mkdir(mode=0o700);self.assertFalse(self.observe()['cleanupConfirmed'])
 def test_symlink_record_rejected(self):
  p=self.setup_fixture();f=p/'terminal.json';f.rename(p/'saved');f.symlink_to('saved')
  with self.assertRaises(r.Stop):self.observe()
 def test_private_mode_drift_rejected(self):
  p=self.setup_fixture();(p/'terminal.json').chmod(0o664)
  with self.assertRaises(r.Stop):self.observe()
 def test_partial_error_secret_text_rejected(self):
  p=self.setup_fixture(2,True);f=p/'get-02.terminal.json';d=json.loads(f.read_text());d['errorCode']='Bearer secret never return';f.write_bytes(raw(d))
  with self.assertRaises(r.Stop):self.observe()
if __name__=='__main__':unittest.main()
