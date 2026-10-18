"""Synthetic original readback records only; all process/socket state mocked."""
import hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest import mock
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('independent_readback',HERE/'independent-local-readback-readonly.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
def raw(x):return (json.dumps(x,sort_keys=True,indent=2)+'\n').encode()
def fixture(root,count=52,failed=False):
 old=root/'original';old.mkdir(mode=0o700);phase=root/'local-readback-once';phase.mkdir(mode=0o700);records=phase/'records';records.mkdir(mode=0o700)
 def put(n,x):p=(records if n.startswith('get-') or n=='registry-readback.json' else phase)/n;p.write_bytes(raw(x));p.chmod(0o600)
 dest='registry.cloudflare.com/'+r.S['repository']+':'+r.S['tag']
 put('intent.json',{'schema':'trusted-pi-local-registry-readback-intent/v1',**{k:r.S[k] for k in ['requestId','parentRequestId','operationId','sourceImageId']},'destination':dest,'humanGrantSha256':'a'*64,'operationsManifestSha256':'b'*64,'supervisorPid':20001,'supervisorLinuxStartTicks':'100'})
 archive={'schema':'trusted-pi-original-readback-archive-revalidation/v1','requestId':r.S['requestId'],'operationId':r.S['operationId'],'originalVerificationSha256':r.S['verificationSourceSha256'],'archiveBytes':r.S['originalArchive']['bytes'],'archiveSha256':r.S['originalArchive']['sha256'],'originalIndex':{'digest':r.S['sourceImageId'],'size':856,'mediaType':'application/vnd.oci.image.index.v1+json'},'platformManifest':r.S['expectedPlatformManifest'],'config':r.S['expectedConfig'],'blobCount':53,'rootfsLayerCount':49,'archiveReadVerifications':1,'exportsAttempted':0,'allRawBlobHashesSizesReachable':True,'allRunnableDiffIdsMatched':True,'originalRecordsUnmodified':True}
 bindings=r.S['stoppedReadbackSource']['records'];proof={'schema':'trusted-pi-local-registry-source-proof/v1','requestId':r.S['requestId'],'operationId':r.S['operationId'],'sourceImageId':r.S['sourceImageId'],'scopeSha256':r.SCOPE_SHA,'operationsManifestSha256':'b'*64,'originalVerificationSha256':r.S['verificationSourceSha256'],'verification':r.VERIFICATION,'archiveRevalidation':archive,'priorReadbackStop':{'intentSha256':bindings['intent.json']['sha256'],'terminalSha256':bindings['terminal.json']['sha256'],'originalSupervisorAbsent':True,'status':'unknown-stopped','registryGetAttempts':4,'registryGetProofCount':3,'recordCount':14,'all14OriginalRecordBytehashMatched':True},'remoteWrites':0,'dockerOrRegistryCalls':0,'oauthOrRegistryCredentialReadOrReceived':False,'rawConfigEnvOrArchiveBodyReturned':False,'directSmallRawByteObjectComparisonPerformed':False}
 put('source-proof.json',proof);stdout=(json.dumps(proof,separators=(',',':'))+'\n').encode();f=phase/'source-proof.stdout';f.write_bytes(stdout);f.chmod(0o600)
 put('source-ssh-intent.json',{'requestId':r.S['requestId'],'operationId':r.S['operationId'],'stdinSourceOnlyNoGrantOrCredential':True,'forwardings':0,'forwardAgent':False,'remoteWrites':0});put('source-ssh-original.json',{'pid':20003});put('source-ssh-terminal.json',{'requestId':r.S['requestId'],'operationId':r.S['operationId'],'pid':20003,'exitCode':0,'originalReaped':True,'errorCode':None,'stopErrors':[],'streams':{'stdout':{'bytes':len(stdout),'sha256':r.sha(stdout)}},'stderrPersisted':False})
 put('oauth-token-once-original-cli.json',{'pid':20002});put('oauth-token-once-terminal.json',{'exitCode':0,'originalReaped':True,'stopErrors':[],'errorCode':None,'outputPersisted':False})
 proofs=[]
 for slot in r.SLOTS[:count+(1 if failed else 0)]:
  n=slot['slot'];prefix='get-%02d'%n;d=slot['descriptor'];isfail=failed and n==count
  put(prefix+'.intent.json',{'schema':'trusted-pi-local-registry-get-intent/v1','requestId':r.S['requestId'],'operationId':r.S['operationId'],'slot':n,'path':slot['path'],'expectedDescriptor':d,'retryAllowed':False})
  terminal={'schema':'trusted-pi-local-registry-get-terminal/v1','requestId':r.S['requestId'],'operationId':r.S['operationId'],'slot':n,'path':slot['path'],'expectedDescriptor':d,'rawBodyHeadersErrorTextOrAuthPersisted':False,'directSmallRawByteObjectComparisonPerformed':False,'httpStatus':403 if isfail else 200,'capturedBytes':0 if isfail else d['size'],'capturedSha256':hashlib.sha256(b'').hexdigest() if isfail else d['digest'][7:],'responseCaptureComplete':True,'responseClosed':True,'phase':'http-error-body' if isfail else 'complete','exceptionClass':'HTTPError' if isfail else None,'errorCode':'registry-read-failed' if isfail else None,'manifestOrBlobHeaderMatches':None if isfail else True,'smallRawSha256EqualityPassed':None if isfail or n>=3 else True,'proofAccepted':not isfail};put(prefix+'.terminal.json',terminal)
  if not isfail:
   proof={'schema':'trusted-pi-local-registry-get-proof/v1','requestId':r.S['requestId'],'operationId':r.S['operationId'],'slot':n,'path':slot['path'],'status':200,'bytes':d['size'],'digest':d['digest'],'headerMatches':True,'originalRawSha256Matched':True,'smallRawSha256EqualityPassed':True if n<3 else None,'terminalSha256':r.sha(raw(terminal))};put(prefix+'.proof.json',proof);proofs.append(proof)
 terminal={'schema':'trusted-pi-local-registry-readback-result/v1',**{k:r.S[k] for k in ['requestId','operationId','sourceImageId']},'destination':dest,'exportsAttempted':0,'pushesAttempted':0,'dockerCommands':0,'credentialFilesWritten':0,'newSshRoutes':0,'registryCredentialsTransferredToAmd':0,'registryGetAttempts':count+(1 if failed else 0),'registryGetProofCount':count,'status':'unknown-stopped' if failed or count<52 else 'all52-original-registry-readbacks-verified','errorCode':'original-registry-readback-slot-failed-no-retry' if failed else None,'cleanupErrors':[],'credentialMemoryCleared':True,'fullOriginalRegistryReadbackVerified':count==52 and not failed,'originalRawSha256IdentityVerified':count==52 and not failed,'directSmallRawByteObjectComparisonPerformed':False,'platformManifest':r.S['expectedPlatformManifest'],'config':r.S['expectedConfig']}
 if count==52 and not failed:
  allproof={'schema':'trusted-pi-local-registry-readback-complete/v1',**{k:r.S[k] for k in ['requestId','operationId','sourceImageId']},'platformManifest':r.S['expectedPlatformManifest'],'config':r.S['expectedConfig'],'verificationSourceSha256':r.S['verificationSourceSha256'],'sourceProofSha256':r.sha((phase/'source-proof.json').read_bytes()),'proofs':proofs,'all52RawBodiesMatchFixedOriginalBlobSha256':True,'directSmallRawByteObjectComparisonPerformed':False,'newPushAttempted':False};put('registry-readback.json',allproof);terminal['readbackProofSha256']=r.sha(raw(allproof))
 put('terminal.json',terminal)
 if count==52 and not failed:put('final-ack.json',{'schema':'trusted-pi-local-registry-final-ack/v1','requestId':r.S['requestId'],'operationId':r.S['operationId'],'terminalSha256':r.sha(raw(terminal)),'readbackProofSha256':terminal['readbackProofSha256'],'sourceProofSha256':r.sha((phase/'source-proof.json').read_bytes()),'all52Verified':True,'mergeAllowed':False})
 return old,phase,records
class LocalReadbackFixtures(unittest.TestCase):
 def setup_fixture(self,count=52,failed=False):
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);root=Path(tmp.name).resolve();root.chmod(0o700);old,phase,records=fixture(root,count,failed)
  patches=[mock.patch.object(r,'STATE',phase),mock.patch.object(r,'R',records),mock.patch.object(r.sys,'platform','darwin'),mock.patch.object(r,'process_absent',return_value=True)]
  for p in patches:p.start();self.addCleanup(p.stop)
  return records
 def observe(self):return r.observe('a'*64,'b'*64)
 def test_complete52_and_cleanup_still_needs_local_ack(self):
  self.setup_fixture();d=self.observe();self.assertTrue(d['all52ProofsAndTerminalVerified']);self.assertTrue(d['registryReadbackRecordsAckAndCleanupVerified']);self.assertFalse(d['publicationVerified']);self.assertTrue(d['executionTransportOriginalAckStillRequired']);self.assertEqual(len(d['slotObservations']),52);self.assertNotIn('Authorization',json.dumps(d))
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
  self.setup_fixture();r.process_absent.return_value=False;d=self.observe();self.assertFalse(d['cleanupConfirmed']);self.assertFalse(d['registryReadbackRecordsAckAndCleanupVerified'])
 def test_authcopy_present_keeps_cleanup_false(self):
  p=self.setup_fixture();(p.parent/'temporary-auth').mkdir(mode=0o700);self.assertFalse(self.observe()['cleanupConfirmed'])
 def test_symlink_record_rejected(self):
  p=self.setup_fixture();f=p.parent/'terminal.json';f.rename(p/'saved');f.symlink_to('saved')
  with self.assertRaises(r.Stop):self.observe()
 def test_private_mode_drift_rejected(self):
  p=self.setup_fixture();(p.parent/'terminal.json').chmod(0o664)
  with self.assertRaises(r.Stop):self.observe()
 def test_partial_error_secret_text_rejected(self):
  p=self.setup_fixture(2,True);f=p/'get-02.terminal.json';d=json.loads(f.read_text());d['errorCode']='Bearer secret never return';f.write_bytes(raw(d))
  with self.assertRaises(r.Stop):self.observe()
 def alter(self,path,**changes):
  d=json.loads(path.read_text());d.update(changes);path.write_bytes(raw(d))
 def test_source_nonzero_without_proof_still_checks_original_ssh_absence(self):
  p=self.setup_fixture(0,False);state=p.parent;(state/'source-proof.json').unlink();(state/'source-proof.stdout').write_bytes(b'')
  self.alter(state/'source-ssh-terminal.json',exitCode=255,errorCode='source-ssh-failed',streams={'stdout':{'bytes':0,'sha256':r.sha(b'')}})
  d=self.observe();self.assertFalse(d['sourceRawStreamAndProofObjectVerified']);self.assertTrue(d['originalSourceSshAbsent']);self.assertTrue(d['cleanupConfirmed']);self.assertFalse(d['publicationVerified'])
 def test_node_nonzero_still_has_cleanup_but_not_publication(self):
  p=self.setup_fixture(0,False);self.alter(p.parent/'oauth-token-once-terminal.json',exitCode=1,errorCode='normal-oauth-cli-failed-no-retry')
  d=self.observe();self.assertTrue(d['originalOauthNodeAbsent']);self.assertTrue(d['cleanupConfirmed']);self.assertFalse(d['publicationVerified'])
 def test_failure_before_source_missing_lifecycles_is_unknown_not_clean(self):
  p=self.setup_fixture(0,False)
  for n in ['source-proof.json','source-proof.stdout','source-ssh-intent.json','source-ssh-original.json','source-ssh-terminal.json','oauth-token-once-original-cli.json','oauth-token-once-terminal.json']:(p.parent/n).unlink()
  d=self.observe();self.assertFalse(d['sourceSshLifecycleKnown']);self.assertFalse(d['cleanupConfirmed']);self.assertFalse(d['publicationVerified'])
 def test_ack_hash_drift_is_rejected(self):
  p=self.setup_fixture();self.alter(p.parent/'final-ack.json',terminalSha256='0'*64)
  with self.assertRaises(r.Stop):self.observe()
 def test_source_raw_stream_hash_drift_is_rejected(self):
  p=self.setup_fixture();(p.parent/'source-proof.stdout').write_bytes(b'{}')
  with self.assertRaises(r.Stop):self.observe()
if __name__=='__main__':unittest.main()
