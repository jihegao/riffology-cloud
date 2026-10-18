"""New focused readback fixtures only; fake opener/stdin, no actual auth/SSH/network."""
import copy,datetime as dt,hashlib,http.client,importlib.util,io,json,os,pathlib,tempfile,time,unittest,urllib.error
from unittest import mock
HERE=pathlib.Path(__file__).resolve().parent
import pub_common as c

def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
local=load('readback_local','local-recovery.py');remote=load('readback_remote','remote-recovery.py')
def grant():
 g={'schema':'trusted-pi-original-registry-readback-grant/v1','approved':True,'requestId':c.SCOPE['requestId'],'parentRequestId':c.SCOPE['parentRequestId'],'operationId':c.SCOPE['operationId'],'scopeSha256':c.SCOPE_SHA,'operationsManifestSha256':'a'*64,'humanReplySha256':'b'*64}
 for k in ('recipient','accountId','originalDirectory','remoteDirectory','sourceImageId','repository','tag','canonicalPr','canonicalPrHead','newCredential','route','operations','excluded','oauthPolicy','expectedUserIdSha256','originalArchive','expectedPlatformManifest','expectedConfig','originalOperationsManifestSha256','originalHumanGrantSha256','verificationSourceSha256'):g[k]=c.SCOPE[k]
 now=dt.datetime.now(dt.timezone.utc);g['approvedAt']=(now-dt.timedelta(seconds=10)).isoformat();g['expiresAt']=(now+dt.timedelta(minutes=30)).isoformat();return g
class Response:
 def __init__(self,b,header=None):self.body=io.BytesIO(b);self.status=200;self.headers={} if header is None else {'Docker-Content-Digest':header};self.closed=False
 def read(self,n):return self.body.read(n)
 def close(self):self.closed=True
class Opener:
 def __init__(self,response=None,error=None):self.response=response;self.error=error;self.calls=0
 def open(self,request,timeout):
  self.calls+=1
  if self.error:raise self.error
  return self.response
class ReadbackTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name).resolve();self.patch=mock.patch.object(remote,'R',self.root);self.patch.start()
 def tearDown(self):self.patch.stop();self.tmp.cleanup()
 def slot(self,body=b'abc',kind=None):
  return {'slot':3 if kind is None else 0,'path':'blobs/sha256:'+hashlib.sha256(body).hexdigest() if kind is None else 'manifests/'+c.SCOPE['tag'],'descriptor':{'digest':'sha256:'+hashlib.sha256(body).hexdigest(),'size':len(body),'mediaType':'application/vnd.oci.image.layer.v1.tar+gzip' if kind is None else 'application/vnd.oci.image.manifest.v1+json'},'smallRawKind':kind}
 def terminal(self,index=3):return json.loads((self.root/('get-%02d.terminal.json'%index)).read_bytes())
 def test_fixed_original52_slots_and_complete_archive_source(self):
  slots=c.slots();self.assertEqual(len(slots),52);self.assertEqual([x['slot'] for x in slots],list(range(52)));self.assertEqual(slots[0]['path'],'manifests/'+c.SCOPE['tag']);self.assertEqual(slots[1]['descriptor'],c.VERIFICATION['linuxAmd64Manifest']);self.assertEqual([x['descriptor'] for x in slots[2:]],[c.VERIFICATION['config']]+c.VERIFICATION['layers']);self.assertEqual(c.sha(c.VERIFICATION_RAW),c.VERIFICATION_SHA)
  bad=copy.deepcopy(c.VERIFICATION);bad['layers'][0]['size']+=1
  with self.assertRaises(c.Stop):c.validate_verification(bad)
 def test_success_raw_body_header_and_small_raw_equality(self):
  b=b'{"schemaVersion":2}';slot=self.slot(b,'manifest');op=Opener(Response(b,slot['descriptor']['digest']));proof=remote.read_slot(slot,'fake-memory-only',{'manifest':b},time.monotonic()+30,op)
  self.assertEqual(op.calls,1);self.assertEqual(proof['digest'],slot['descriptor']['digest']);self.assertTrue(self.terminal(0)['smallRawEqualityPassed']);self.assertTrue(self.terminal(0)['responseClosed']);self.assertTrue((self.root/'get-00.intent.json').exists());self.assertTrue((self.root/'get-00.proof.json').exists())
 def test_timeout_intent_and_safe_terminal_no_retry_or_error_text(self):
  op=Opener(error=TimeoutError('synthetic-private-message'))
  with self.assertRaises(c.Stop):remote.read_slot(self.slot(),'fake',{},time.monotonic()+30,op)
  t=self.terminal();self.assertEqual(op.calls,1);self.assertEqual(t['exceptionClass'],'TimeoutError');self.assertFalse(t['proofAccepted']);self.assertNotIn('synthetic-private-message',json.dumps(t));self.assertFalse((self.root/'get-03.proof.json').exists())
 def test_403_error_body_hash_only_and_closed(self):
  body=b'synthetic-error-private-message';error=urllib.error.HTTPError('https://registry.cloudflare.com',403,'synthetic-private-message',{},io.BytesIO(body));op=Opener(error=error)
  with self.assertRaises(c.Stop):remote.read_slot(self.slot(),'fake',{},time.monotonic()+30,op)
  t=self.terminal();self.assertEqual(op.calls,1);self.assertEqual(t['httpStatus'],403);self.assertEqual(t['capturedSha256'],hashlib.sha256(body).hexdigest());self.assertTrue(t['responseCaptureComplete']);self.assertTrue(t['responseClosed']);self.assertEqual(t['exceptionClass'],'HTTPError');self.assertNotIn('private-message',json.dumps(t))
 def test_truncated_body_size_rejected_and_partial_record_retained(self):
  slot=self.slot(b'abcd')
  with self.assertRaises(c.Stop):remote.read_slot(slot,'fake',{},time.monotonic()+30,Opener(Response(b'abc')))
  t=self.terminal();self.assertEqual(t['capturedBytes'],3);self.assertTrue(t['responseCaptureComplete']);self.assertFalse(t['proofAccepted']);self.assertTrue((self.root/'get-03.intent.json').exists());self.assertFalse((self.root/'get-03.proof.json').exists())
 def test_bad_body_hash_and_redirect_rejected_without_fallback(self):
  with self.assertRaises(c.Stop):remote.read_slot(self.slot(),'fake',{},time.monotonic()+30,Opener(Response(b'xyz')))
  self.assertEqual(self.terminal()['errorCode'],'registry-body-size-or-sha');self.assertIsNone(remote.NoRedirect().redirect_request(None,None,None,None,None,None))
 def test_exact_wire_roundtrip_and_bad_input_before_auth_or_state(self):
  good=(json.dumps(grant(),separators=(',',':'))+'\n').encode();self.assertEqual(c.grant_wire(good),good);self.assertEqual(c.grant(io.BytesIO(good).readline(32769),'a'*64)['requestId'],c.SCOPE['requestId'])
  bad=[json.dumps(grant(),indent=2).encode()+b'\n',good[:-1],good+b'\n',good.replace(b'\n',b'\r\n')]
  state=self.root/'never-state'
  with mock.patch.object(local,'STATE',state),mock.patch.object(local,'oauth_after_new_grant',side_effect=AssertionError('Auth forbidden')),mock.patch.object(local.subprocess,'Popen',side_effect=AssertionError('process forbidden')):
   for n,b in enumerate(bad):
    p=self.root/('grant-%d.json'%n);p.write_bytes(b);p.chmod(0o600)
    with self.assertRaises(c.Stop):local.execute(p,c.sha(b))
    self.assertFalse(state.exists())
 def events(self):
  a={'archiveBytes':c.SCOPE['originalArchive']['bytes'],'archiveSha256':c.SCOPE['originalArchive']['sha256'],'originalVerificationSha256':c.SCOPE['verificationSourceSha256'],'allRawBlobHashesSizesReachable':True,'allRunnableDiffIdsMatched':True,'archiveReadVerifications':1,'exportsAttempted':0}
  ready={'requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'phase':'verified-original-readback-awaiting-pull-credential','routeOnlyLoopbackVerified':True,'archiveRevalidation':a}
  final={'schema':'trusted-pi-registry-readback-recovery-result/v1','requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'sourceImageId':c.SCOPE['sourceImageId'],'destination':'registry.cloudflare.com/'+c.SCOPE['repository']+':'+c.SCOPE['tag'],'originalRecordsLocksArchiveAndTagUnmodified':True,'status':'all52-original-registry-readbacks-verified','registryGetAttempts':52,'registryGetProofCount':52,'exportsAttempted':0,'pushesAttempted':0,'dockerCommands':0,'credentialFilesWritten':0,'credentialMemoryCleared':True,'cleanupErrors':[],'errorCode':None,'platformManifest':c.SCOPE['expectedPlatformManifest'],'config':c.SCOPE['expectedConfig'],'fullOriginalRegistryReadbackVerified':True,'readbackProofSha256':'c'*64};return [ready,final]
 def test_missing_duplicate_or_partial_ack_never_confirms(self):
  good=self.events();self.assertTrue(local.final_ack(good,b''))
  for events,pending in [(good[:1],b''),(good+good[1:],b''),(good,b'partial')]:
   with self.assertRaises(c.Stop):local.final_ack(events,pending)
  bad=copy.deepcopy(good);bad[1]['registryGetProofCount']=51
  with self.assertRaises(c.Stop):local.final_ack(bad,b'')
 def test_uncleared_memory_or_cleanup_error_rejects_ack(self):
  for field,value in [('credentialMemoryCleared',False),('cleanupErrors',['synthetic-cleanup-unknown']),('credentialFilesWritten',1)]:
   events=self.events();events[1][field]=value
   with self.assertRaises(c.Stop):local.final_ack(events,b'')
 def test_new_remote_once_does_not_replay_original_directory(self):
  old=self.root/'old';old.mkdir(mode=0o700);(old/'records').mkdir(mode=0o700);phase=old/'registry-readback-recovery-v1';phase.mkdir(mode=0o700)
  wire=(json.dumps(grant(),separators=(',',':'))+'\n').encode()
  with mock.patch.object(remote,'OLD',old),mock.patch.object(remote,'ROOT',phase),mock.patch.object(remote,'R',phase/'records'),mock.patch.object(remote.sys,'platform','linux'),mock.patch.object(remote,'verify_original',side_effect=AssertionError('must not revalidate after once exists')):
   with self.assertRaises(FileExistsError):remote.execute(wire,'a'*64)
  self.assertFalse((phase/'records').exists())
 def test_all52_execute_fixture_uses_no_docker_and_clears_memory(self):
  old=self.root/'old';old.mkdir(mode=0o700);(old/'records').mkdir(mode=0o700);phase=old/'registry-readback-recovery-v1';recorddir=phase/'records';wire=(json.dumps(grant(),separators=(',',':'))+'\n').encode();a=self.events()[0]['archiveRevalidation'];a.update(originalIndex=c.SCOPE['sourceDescriptor'],platformManifest=c.SCOPE['expectedPlatformManifest'],config=c.SCOPE['expectedConfig'],rootfsLayerCount=49,blobCount=53)
  seen=[]
  def fake_slot(slot,*args):
   seen.append(slot['slot']);return {'slot':slot['slot'],'path':slot['path'],'status':200,'bytes':slot['descriptor']['size'],'digest':slot['descriptor']['digest']}
  fake_stdin=type('In',(),{'buffer':io.BytesIO(b'{"username":"synthetic","password":"fixture-only"}\n')})()
  with mock.patch.object(remote,'OLD',old),mock.patch.object(remote,'ROOT',phase),mock.patch.object(remote,'R',recorddir),mock.patch.object(remote.sys,'platform','linux'),mock.patch.object(remote.sys,'stdin',fake_stdin),mock.patch.object(remote,'verify_original',return_value=(a,{})),mock.patch.object(remote,'route_addresses',return_value=['127.0.0.1']),mock.patch.object(remote.signal,'alarm'),mock.patch.object(remote,'read_slot',side_effect=fake_slot),mock.patch('builtins.print'):
   result=remote.execute(wire,'a'*64)
  self.assertEqual(seen,list(range(52)));self.assertEqual(result['status'],'all52-original-registry-readbacks-verified');self.assertEqual(result['registryGetAttempts'],52);self.assertTrue(result['credentialMemoryCleared']);self.assertEqual(result['exportsAttempted'],0);self.assertEqual(result['pushesAttempted'],0);self.assertNotIn('fixture-only',(recorddir/'terminal.json').read_text());self.assertFalse((phase/'temporary-auth').exists())
if __name__=='__main__':unittest.main()
