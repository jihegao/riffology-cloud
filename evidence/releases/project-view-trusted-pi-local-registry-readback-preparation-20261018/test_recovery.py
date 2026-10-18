"""New local-only fixture coverage. No actual auth, SSH, HTTP, Docker or signals."""
import copy,datetime as dt,hashlib,importlib.util,io,json,os,pathlib,signal,tempfile,time,unittest
from unittest import mock
HERE=pathlib.Path(__file__).resolve().parent
import pub_common as c
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
local=load('local_only_driver','local-recovery.py');source=load('local_only_source','source-verify.py')
def fixture_grant():
 x={'schema':'trusted-pi-local-registry-readback-grant/v1','approved':True,'requestId':c.SCOPE['requestId'],'parentRequestId':c.SCOPE['parentRequestId'],'operationId':c.SCOPE['operationId'],'scopeSha256':c.SCOPE_SHA,'operationsManifestSha256':'a'*64,'humanReplySha256':'b'*64}
 for key in ('recipient','accountId','originalDirectory','remoteDirectory','sourceImageId','repository','tag','canonicalPr','canonicalPrHead','newCredential','route','operations','excluded','oauthPolicy','expectedUserIdSha256','originalArchive','expectedPlatformManifest','expectedConfig','originalOperationsManifestSha256','originalHumanGrantSha256','verificationSourceSha256','localExecutionDirectory','sourceSsh','contentIdentityContract'):x[key]=c.SCOPE[key]
 now=dt.datetime.now(dt.timezone.utc);x.update(approvedAt=(now-dt.timedelta(seconds=5)).isoformat(),expiresAt=(now+dt.timedelta(minutes=30)).isoformat());return x

def proof():
 a={'archiveBytes':c.SCOPE['originalArchive']['bytes'],'archiveSha256':c.SCOPE['originalArchive']['sha256'],'originalVerificationSha256':c.SCOPE['verificationSourceSha256'],'originalIndex':c.SCOPE['sourceDescriptor'],'platformManifest':c.SCOPE['expectedPlatformManifest'],'config':c.SCOPE['expectedConfig'],'blobCount':53,'rootfsLayerCount':49,'archiveReadVerifications':1,'exportsAttempted':0,'allRawBlobHashesSizesReachable':True,'allRunnableDiffIdsMatched':True,'originalRecordsUnmodified':True}
 r=c.SCOPE['stoppedReadbackSource']['records'];stopped={'intentSha256':r['intent.json']['sha256'],'terminalSha256':r['terminal.json']['sha256'],'originalSupervisorAbsent':True,'status':'unknown-stopped','registryGetAttempts':4,'registryGetProofCount':3,'recordCount':14,'all14OriginalRecordBytehashMatched':True}
 return {'schema':'trusted-pi-local-registry-source-proof/v1','requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'sourceImageId':c.SCOPE['sourceImageId'],'scopeSha256':c.SCOPE_SHA,'operationsManifestSha256':'a'*64,'originalVerificationSha256':c.SCOPE['verificationSourceSha256'],'archiveRevalidation':a,'verification':copy.deepcopy(c.VERIFICATION),'priorReadbackStop':stopped,'remoteWrites':0,'dockerOrRegistryCalls':0,'oauthOrRegistryCredentialReadOrReceived':False,'rawConfigEnvOrArchiveBodyReturned':False,'directSmallRawByteObjectComparisonPerformed':False}
class Response:
 def __init__(self,body,header):self.body=io.BytesIO(body);self.status=200;self.headers={'Docker-Content-Digest':header}
 def read(self,n):return self.body.read(n)
 def close(self):pass
class Opener:
 def __init__(self,response):self.response=response;self.calls=0
 def open(self,request,timeout):self.calls+=1;return self.response
class LocalOnlyTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name).resolve();self.state=self.root/'state';self.state.mkdir(mode=0o700);self.records=self.state/'records';self.records.mkdir(mode=0o700);self.patches=[mock.patch.object(local,'STATE',self.state),mock.patch.object(local,'R',self.records)];[p.start() for p in self.patches]
 def tearDown(self):[p.stop() for p in reversed(self.patches)];self.tmp.cleanup()
 def test_original52_descriptors_and_no_scope_ttl_or_forwarding_expansion(self):
  self.assertEqual(len(c.slots()),52);self.assertEqual(sum(x['descriptor']['size'] for x in c.slots()),407919377);self.assertEqual(c.SCOPE['registryGetDeadlineSeconds'],720);self.assertEqual(c.SCOPE['newCredential']['permissions'],['pull']);self.assertEqual(c.SCOPE['newCredential']['expirationMinutes'],15);self.assertEqual(c.SCOPE['route']['newRouteCount'],0);self.assertFalse(c.SCOPE['route']['credentialTransferredToAmd']);self.assertEqual(len(c.SCOPE['stoppedReadbackSource']['records']),14)
 def test_local_get_proves_fixed_sha_identity_without_claiming_byte_object_compare(self):
  body=b'{"synthetic":true}';digest='sha256:'+hashlib.sha256(body).hexdigest();slot={'slot':0,'path':'manifests/'+c.SCOPE['tag'],'descriptor':{'digest':digest,'size':len(body),'mediaType':'application/vnd.oci.image.manifest.v1+json'},'smallRawKind':'manifest'};op=Opener(Response(body,digest))
  with mock.patch.object(local.urllib.request,'build_opener',return_value=op) as build:
   actual=local.read_slot(slot,'fixture-only',None,time.monotonic()+30)
  self.assertEqual(build.call_args.args[0].proxies,{'https':'http://127.0.0.1:7892'});self.assertEqual(op.calls,1);self.assertTrue(actual['originalRawSha256Matched']);self.assertTrue(actual['smallRawSha256EqualityPassed']);t=json.loads((self.records/'get-00.terminal.json').read_bytes());self.assertFalse(t['directSmallRawByteObjectComparisonPerformed']);self.assertNotIn('smallRawEqualityPassed',t)
 def test_real_get_first_layer_stream_and_descriptor_header(self):
  body=b'synthetic-layer'*6000;digest='sha256:'+hashlib.sha256(body).hexdigest();slot={'slot':3,'path':'blobs/'+digest,'descriptor':{'digest':digest,'size':len(body),'mediaType':'application/vnd.oci.image.layer.v1.tar+gzip'},'smallRawKind':None};op=Opener(Response(body,digest))
  actual=local.read_slot(slot,'fixture-only',None,time.monotonic()+30,op)
  self.assertEqual(op.calls,1);self.assertEqual(actual['bytes'],len(body));self.assertIsNone(actual['smallRawSha256EqualityPassed']);self.assertTrue(actual['originalRawSha256Matched']);terminal=json.loads((self.records/'get-03.terminal.json').read_bytes());self.assertEqual(terminal['capturedSha256'],digest[7:]);self.assertTrue(terminal['responseCaptureComplete']);self.assertTrue(terminal['responseClosed']);self.assertTrue(terminal['proofAccepted'])
 def test_real_get_http403_and_timeout_record_safe_failure_once(self):
  import urllib.error
  for number,error in [(4,urllib.error.HTTPError('https://fixture.invalid',403,'fixture secret not recorded',{},io.BytesIO(b'synthetic denied body'))),(5,TimeoutError('synthetic secret not recorded'))]:
   class Failed:
    calls=0
    def open(self,*args,**kwargs):self.calls+=1;raise error
   op=Failed();slot={'slot':number,'path':'blobs/'+'sha256:'+'a'*64,'descriptor':{'digest':'sha256:'+'a'*64,'size':3,'mediaType':'application/vnd.oci.image.layer.v1.tar+gzip'},'smallRawKind':None}
   with self.assertRaises(c.Stop):local.read_slot(slot,'fixture-only',None,time.monotonic()+30,op)
   self.assertEqual(op.calls,1);terminal=json.loads((self.records/('get-%02d.terminal.json'%number)).read_bytes());self.assertFalse(terminal['proofAccepted']);self.assertEqual(terminal['exceptionClass'],'HTTPError' if number==4 else 'TimeoutError');self.assertNotIn('secret',json.dumps(terminal));self.assertFalse((self.records/('get-%02d.proof.json'%number)).exists())
 def test_deadline_during_error_body_preserves_exact_signal_code(self):
  import urllib.error
  class InterruptedBody:
   def read(self,n):raise c.Stop('registry-total-deadline-sigalrm')
   def close(self):pass
  error=urllib.error.HTTPError('https://fixture.invalid',403,'not recorded',{},InterruptedBody())
  class Failed:
   calls=0
   def open(self,*args,**kwargs):self.calls+=1;raise error
  slot={'slot':6,'path':'blobs/'+'sha256:'+'a'*64,'descriptor':{'digest':'sha256:'+'a'*64,'size':3,'mediaType':'application/vnd.oci.image.layer.v1.tar+gzip'},'smallRawKind':None};op=Failed()
  with self.assertRaises(c.Stop):local.read_slot(slot,'fixture-only',None,time.monotonic()+30,op)
  terminal=json.loads((self.records/'get-06.terminal.json').read_bytes());self.assertEqual(terminal['errorCode'],'registry-total-deadline-sigalrm');self.assertEqual(terminal['exceptionClass'],'ScopeGuard');self.assertEqual(op.calls,1);self.assertFalse(terminal['proofAccepted']);self.assertTrue(terminal['responseClosed'])
 def test_signal_codes_distinguish_deadline_and_external_interruption(self):
  for fn,alarm,term in [(local.local_signal,'registry-total-deadline-sigalrm','local-external-interrupt-sigterm'),(source.source_signal,'source-archive-deadline-sigalrm','source-external-interrupt-sigterm')]:
   for signum,code in [(signal.SIGALRM,alarm),(signal.SIGTERM,term)]:
    with self.assertRaisesRegex(c.Stop,'^'+code+'$'):fn(signum)
 def test_bad_body_and_truncation_have_no_proof_or_retry(self):
  for number,body in [(0,b'bad'),(1,b'ab')]:
   expected=b'abc';digest='sha256:'+hashlib.sha256(expected).hexdigest();slot={'slot':number,'path':'manifests/'+c.SCOPE['tag'],'descriptor':{'digest':digest,'size':len(expected),'mediaType':'application/vnd.oci.image.manifest.v1+json'},'smallRawKind':'manifest'};op=Opener(Response(body,digest))
   with self.assertRaises(c.Stop):local.read_slot(slot,'fixture',None,time.monotonic()+30,op)
   self.assertEqual(op.calls,1);self.assertFalse((self.records/('get-%02d.proof.json'%number)).exists());self.assertFalse(json.loads((self.records/('get-%02d.terminal.json'%number)).read_bytes())['proofAccepted'])
 def test_source_proof_requires_exact_archive_and_stopped_supervisor14records(self):
  self.assertEqual(local.validate_source_proof(proof(),'a'*64)['sourceImageId'],c.SCOPE['sourceImageId'])
  for field,value in [('originalSupervisorAbsent',False),('recordCount',13),('registryGetAttempts',5)]:
   p=proof();p['priorReadbackStop'][field]=value
   with self.assertRaises(c.Stop):local.validate_source_proof(p,'a'*64)
  p=proof();p['verification']['layers'][0]['size']+=1
  with self.assertRaises(c.Stop):local.validate_source_proof(p,'a'*64)
 def test_new_single_line_grant_identity_and_bad_wire_before_auth(self):
  wire=(json.dumps(fixture_grant(),separators=(',',':'))+'\n').encode();self.assertEqual(c.grant(wire,'a'*64)['operationId'],'registry-local-readback-v1');self.assertEqual(c.grant_wire(wire),wire)
  bad=[json.dumps(fixture_grant(),indent=2).encode()+b'\n',wire[:-1],wire+b'\n',wire.replace(b'\n',b'\r\n')]
  with mock.patch.object(local,'oauth_after_new_grant',side_effect=AssertionError('no auth')),mock.patch.object(local,'source_proof_once',side_effect=AssertionError('no SSH')):
   for i,raw in enumerate(bad):
    p=self.root/('bad-%d.json'%i);p.write_bytes(raw);p.chmod(0o600)
    with self.assertRaises(c.Stop):local.inputs(p,c.sha(raw))
 def fixture_execute(self,fail_at=None,source_error=None,expire_at_last=False):
  # Protocol fixture dispatches exact original52 descriptors; no body is downloaded here.
  execution=self.root/'execute';records=execution/'records';events=[];expired=[False];wire=(json.dumps(fixture_grant(),separators=(',',':'))+'\n').encode()
  def get_source(*args):
   events.append('source')
   if source_error:raise c.Stop(source_error)
   p=proof();local.save('source-proof.json',p);return p
  def oauth():events.append('oauth');return 'synthetic-memory-token',(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)).isoformat(),list(local.EXPECTED_SCOPES)
  def api(token,path,method='GET',body=None):
   if path=='/user':events.append('user');return {'id':'fixture-user'}
   if method=='POST':events.append('mint');self.assertEqual(body,{'expiration_minutes':15,'permissions':['pull']});return {'account_id':c.SCOPE['accountId'],'registry_host':'registry.cloudflare.com','username':'fixture','password':'fixture-secret-only'}
   events.append('account');return {'id':c.SCOPE['accountId']}
  def get(slot,*args):
   if slot['slot']==51 and expire_at_last:expired[0]=True
   if slot['slot']==fail_at:raise c.Stop('registry-total-deadline-sigalrm')
   return {'schema':'trusted-pi-local-registry-get-proof/v1','requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'slot':slot['slot'],'path':slot['path'],'status':200,'bytes':slot['descriptor']['size'],'digest':slot['descriptor']['digest'],'headerMatches':True,'smallRawSha256EqualityPassed':True if slot['slot']<3 else None,'originalRawSha256Matched':True,'terminalSha256':'c'*64}
  def checked_grant(*args):
   if expired[0]:raise c.Stop('readback-grant-window-invalid')
   return fixture_grant()
  old_sha=c.sha
  def fixture_sha(raw):return c.SCOPE['expectedUserIdSha256'] if raw==b'fixture-user' else old_sha(raw)
  with mock.patch.object(local,'STATE',execution),mock.patch.object(local,'R',records),mock.patch.object(local,'inputs',return_value=(wire,b'fixture-manifest',{})),mock.patch.object(c,'grant',side_effect=checked_grant),mock.patch.object(c,'sha',side_effect=fixture_sha),mock.patch.object(local,'source_proof_once',side_effect=get_source),mock.patch.object(local,'oauth_after_new_grant',side_effect=oauth),mock.patch.object(local,'api',side_effect=api),mock.patch.object(local,'read_slot',side_effect=get),mock.patch.object(local.signal,'setitimer'):
   result=local.execute(self.root/'unused','a'*64)
  return execution,result,events
 def test_get_budget_is_fractional_grant_remainder_capped_at720(self):
  now=dt.datetime.now(dt.timezone.utc)
  for seconds,expected in [(0.25,0.25),(12,12),(900,720)]:
   grant={'expiresAt':(now+dt.timedelta(seconds=seconds)).isoformat()};self.assertEqual(local.get_budget_seconds(grant,now),expected)
  with self.assertRaises(c.Stop):local.get_budget_seconds({'expiresAt':now.isoformat()},now)
 def test_expiry_after_last_proof_prevents_complete_and_ack(self):
  directory,result,events=self.fixture_execute(expire_at_last=True);self.assertEqual(result['registryGetAttempts'],52);self.assertEqual(result['registryGetProofCount'],52);self.assertEqual(result['status'],'unknown-stopped');self.assertEqual(result['errorCode'],'readback-grant-window-invalid');self.assertFalse(result['fullOriginalRegistryReadbackVerified']);self.assertFalse((directory/'final-ack.json').exists());self.assertFalse((directory/'records/registry-readback.json').exists())
 def test_source_failure_stops_before_auth_or_registry(self):
  directory,result,events=self.fixture_execute(source_error='stopped-readback-supervisor-active-or-drifted');self.assertEqual(events,['source']);self.assertFalse(result['credentialPostAttempted']);self.assertEqual(result['registryGetAttempts'],0);self.assertFalse((directory/'final-ack.json').exists())
 def test_complete52_dispatch_and_ack_link_three_actual_records(self):
  directory,result,events=self.fixture_execute();self.assertEqual(events,['source','oauth','user','account','mint']);self.assertEqual(result['registryGetProofCount'],52);ack=json.loads((directory/'final-ack.json').read_bytes());self.assertEqual(ack['terminalSha256'],hashlib.sha256((directory/'terminal.json').read_bytes()).hexdigest());self.assertEqual(ack['sourceProofSha256'],hashlib.sha256((directory/'source-proof.json').read_bytes()).hexdigest());self.assertEqual(ack['readbackProofSha256'],hashlib.sha256((directory/'records/registry-readback.json').read_bytes()).hexdigest());self.assertNotIn('fixture-secret-only',(directory/'terminal.json').read_text());self.assertEqual(result['registryCredentialsTransferredToAmd'],0)
 def test_partial4attempt3proof_and_missing_ack_stay_pending(self):
  directory,result,events=self.fixture_execute(fail_at=3);self.assertEqual(result['registryGetAttempts'],4);self.assertEqual(result['registryGetProofCount'],3);self.assertEqual(result['status'],'unknown-stopped');self.assertFalse((directory/'final-ack.json').exists());self.assertFalse((directory/'records/registry-readback.json').exists());self.assertTrue(result['credentialMemoryCleared'])
 def test_source_stdin_selection_excludes_auth_code_and_no_remote_write_program(self):
  files={n:(HERE/n).read_bytes() for n in ('scope.json','pub_common.py','oci_verify.py','source-verify.py','verification-source.json')};payload=local.source_bootstrap(files,'a'*64);self.assertNotIn(b'local-recovery.py',payload);source_code=(HERE/'source-verify.py').read_text();self.assertNotIn('subprocess',source_code);self.assertNotIn('urllib',source_code);self.assertNotIn('.mkdir(',source_code);self.assertNotIn('.write',source_code);self.assertNotIn('password',source_code)
if __name__=='__main__':unittest.main()
