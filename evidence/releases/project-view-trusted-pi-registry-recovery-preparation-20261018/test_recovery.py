"""Risk-matched local fake checks. No SSH, Docker, OAuth file or real API access."""
import contextlib,copy,datetime as dt,gzip,hashlib,importlib.util,io,json,os,sys,tarfile,tempfile,unittest,urllib.error
from pathlib import Path
from unittest import mock
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import pub_common as c;import oci_verify as o
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
l=load('publication_local','local-recovery.py');r=load('publication_remote','remote-recovery.py')
def bjson(x):return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
def fixture(path,mutate=None):
 raw_layer=b'fixed-uncompressed-layer-bytes';layer=gzip.compress(raw_layer,mtime=0);diff='sha256:'+c.sha(raw_layer)
 config=bjson({'os':'linux','architecture':'amd64','rootfs':{'type':'layers','diff_ids':[diff]}})
 def desc(b,media):return {'digest':'sha256:'+c.sha(b),'size':len(b),'mediaType':media}
 config_d=desc(config,'application/vnd.oci.image.config.v1+json');layer_d=desc(layer,'application/vnd.oci.image.layer.v1.tar+gzip')
 manifest=bjson({'schemaVersion':2,'mediaType':o.MANIFEST,'config':config_d,'layers':[layer_d]});manifest_d=desc(manifest,o.MANIFEST)
 index=bjson({'schemaVersion':2,'mediaType':o.INDEX,'manifests':[{**manifest_d,'platform':{'os':'linux','architecture':'amd64'}}]});root=desc(index,o.INDEX)
 blobs={c.sha(b):b for b in (index,manifest,config,layer)}
 members={'oci-layout':bjson({'imageLayoutVersion':'1.0.0'}),'index.json':bjson({'schemaVersion':2,'manifests':[root]}),**{'blobs/sha256/'+k:v for k,v in blobs.items()}}
 if mutate:mutate(members)
 with tarfile.open(path,mode='w',format=tarfile.USTAR_FORMAT) as tar:
  for name,b in sorted(members.items()):
   m=tarfile.TarInfo(name);m.size=len(b);m.mode=0o600;tar.addfile(m,io.BytesIO(b))
 scope=copy.deepcopy(c.SCOPE);scope['sourceImageId']=root['digest'];scope['sourceDescriptor']=root
 return scope,[diff]
class Tests(unittest.TestCase):
 def test_imports_inert_and_current_scope_fixed(self):
  with mock.patch.object(l.subprocess,'Popen',side_effect=AssertionError('forbidden')),mock.patch.object(l,'oauth_after_new_grant',side_effect=AssertionError('forbidden')):
   load('inert_local','local-recovery.py');load('inert_remote','remote-recovery.py')
  self.assertEqual(c.SCOPE['sourceImageId'],'sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593');self.assertIn('application-rollout',c.SCOPE['excluded'])
 def test_complete_raw_oci_graph_all_hashes_diffids_and_roles(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp).resolve()/'x.tar';scope,diff=fixture(p);proof,raw=o.verify(p,scope,diff)
   self.assertTrue(proof['allRawBlobHashesSizesReachable']);self.assertTrue(proof['allRunnableDiffIdsMatched']);self.assertEqual(proof['blobCount'],4)
   self.assertEqual(o.digest(raw['index']),scope['sourceImageId']);self.assertNotEqual(proof['config']['digest'],scope['sourceImageId']);self.assertFalse(proof['publisherSignatureVerified'])
 def test_corrupted_or_unreachable_blob_and_bad_diffid_fail_closed(self):
  def corrupt(m):
   name=next(n for n in m if n.startswith('blobs/'));m[name]+=b'x'
  def extra(m):m['blobs/sha256/'+c.sha(b'extra')]=b'extra'
  for mutation in (corrupt,extra):
   with self.subTest(mutation=mutation.__name__),tempfile.TemporaryDirectory() as tmp:
    p=Path(tmp).resolve()/'x.tar';scope,diff=fixture(p,mutation)
    with self.assertRaises(o.Stop):o.verify(p,scope,diff)
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp).resolve()/'x.tar';scope,diff=fixture(p)
   with self.assertRaises(o.Stop):o.verify(p,scope,['sha256:'+'0'*64])
 def test_archive_traversal_or_source_parent_drift_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp).resolve()/'x.tar';scope,diff=fixture(p,lambda m:m.update({'../escape':b'x'}))
   with self.assertRaises(o.Stop):o.verify(p,scope,diff)
   scope,diff=fixture(p);scope['sourceDescriptor']['digest']='sha256:'+'0'*64
   with self.assertRaises(o.Stop):o.verify(p,scope,diff)
 def test_specific_new_grant_before_auth_ssh_or_api(self):
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(l,'oauth_after_new_grant') as oauth,mock.patch.object(l.subprocess,'Popen') as ssh,mock.patch.object(l,'api') as api:
   with self.assertRaises(OSError):l.execute(Path(tmp).resolve()/'missing','a'*64)
   oauth.assert_not_called();ssh.assert_not_called();api.assert_not_called()
  m=(HERE/'operations-manifest.json').read_bytes();files={n:(HERE/n).read_bytes() for n in c.FILES};c.manifest(m,files)
  changed=dict(files);changed['remote-recovery.py']+=b'# drift'
  with self.assertRaises(c.Stop):c.manifest(m,changed)
 def test_exact_six_scopes_accepted_and_unapproved_scope_rejected(self):
  now=dt.datetime.now(dt.timezone.utc);expiry=(now+dt.timedelta(hours=1)).isoformat();scopes=list(l.EXPECTED_SCOPES)
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp).resolve()/'config.toml';p.write_text('oauth_token = "synthetic-local-token"\nexpiration_time = '+json.dumps(expiry)+'\nscopes = '+json.dumps(scopes)+'\n');p.chmod(0o600)
   with mock.patch.object(l,'OAUTH',p):self.assertEqual(set(l.oauth_metadata_after_new_grant()[1]),l.EXPECTED_SCOPES)
   p.write_text(p.read_text().replace(json.dumps(scopes),json.dumps(scopes+['workers_kv:write'])))
   with mock.patch.object(l,'OAUTH',p),self.assertRaises(c.Stop):l.oauth_metadata_after_new_grant()
 def test_rest_credential_success_accepts_only200or201_without_retry(self):
  for status in (200,201,202):
   response=mock.Mock(status=status);response.read.return_value=bjson({'success':True,'result':{'account_id':c.SCOPE['accountId'],'registry_host':'registry.cloudflare.com','username':'synthetic-user','password':'synthetic-pass'}})
   opener=mock.Mock();opener.open.return_value=response
   with self.subTest(status=status),mock.patch.object(l.urllib.request,'build_opener',return_value=opener),mock.patch.object(l,'save') as saved:
    if status in (200,201):self.assertEqual(l.api('fake','/accounts/'+c.SCOPE['accountId']+'/containers/registries/registry.cloudflare.com/credentials','POST',{'expiration_minutes':15,'permissions':['push','pull']})['registry_host'],'registry.cloudflare.com')
    else:
     with self.assertRaises(c.Stop):l.api('fake','/accounts/'+c.SCOPE['accountId']+'/containers/registries/registry.cloudflare.com/credentials','POST',{'expiration_minutes':15,'permissions':['push','pull']})
    self.assertEqual(opener.open.call_count,1);self.assertEqual(saved.call_args.args[1]['status'],status)
 def test_inherited_forwards_stop_and_bootstrap_no_credential_in_source(self):
  for inherited in (False,True):
   completed=mock.Mock(returncode=0,stdout=b'forwardagent no\n'+(b'localforward 123 localhost:1\n' if inherited else b''),stderr=b'')
   with self.subTest(inherited=inherited),mock.patch.object(l.subprocess,'run',return_value=completed):
    if inherited:
     with self.assertRaises(c.Stop):l.ssh_config_no_inherited_forwards()
    else:self.assertEqual(len(l.ssh_config_no_inherited_forwards()),64)
  files={n:(HERE/n).read_bytes() for n in c.FILES};source=l.bootstrap(files,'a'*64);compile(source,'bootstrap','exec');self.assertNotIn(b'synthetic-local-token',source)
 def test_final_ack_required_even_after_ready_and_zero_ssh_exit(self):
  md=c.SCOPE['expectedPlatformManifest'];cd=c.SCOPE['expectedConfig']
  ready={'phase':'verified-original-awaiting-credential','requestId':c.SCOPE['requestId'],'verification':{'schema':'trusted-pi-original-oci-verification/v1','sourceImageId':c.SCOPE['sourceImageId'],'originalIndex':c.SCOPE['sourceDescriptor'],'allRawBlobHashesSizesReachable':True,'allRunnableDiffIdsMatched':True,'linuxAmd64Manifest':md,'config':cd,'archiveBytes':c.SCOPE['sourceArchive']['bytes'],'archiveSha256':c.SCOPE['sourceArchive']['sha256']}}
  final={'schema':'trusted-pi-image-publication-result/v1','requestId':c.SCOPE['requestId'],'sourceImageId':c.SCOPE['sourceImageId'],'destination':'registry.cloudflare.com/'+c.SCOPE['repository']+':'+c.SCOPE['tag'],'status':'original-image-pushed-and-all-raw-registry-readback-verified','actualExportAttempts':0,'actualArchiveReadVerifications':1,'actualPushAttempts':1,'platformManifest':md,'config':cd,'credentialFilesAbsent':True,'cleanupErrors':[]}
  self.assertTrue(l.final_ack([ready,final],b''))
  conflict=copy.deepcopy(final);conflict['config']['digest']='sha256:'+'4'*64
  for events,pending in [([ready],b''),([ready,final,final],b''),([ready,conflict],b''),([ready,final],b'{"schema":')]:
   with self.subTest(events=len(events),pending=bool(pending)),self.assertRaises(c.Stop):l.final_ack(events,pending)
 def test_explicit_login_exact_function_scopes_and_default_token_memory(self):
  expiry=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)).isoformat()
  with mock.patch.object(l,'normal_wrangler_memory',side_effect=[b'Successfully logged in.',b'{"type":"oauth","token":"synthetic-only"}']) as cli,mock.patch.object(l,'oauth_metadata_after_new_grant',return_value=(expiry,list(l.EXPECTED_SCOPES))),mock.patch.object(l,'save'):
   self.assertEqual(l.oauth_after_new_grant()[0],'synthetic-only')
   self.assertEqual(cli.call_args_list[0].args[0],['login','--scopes','user:read','account:read','workers:write','workers_scripts:write','containers:write','--browser','--callback-host','localhost','--callback-port','8976'])
   self.assertNotIn('offline_access',cli.call_args_list[0].args[0]);self.assertEqual(cli.call_args_list[1].args[0],['auth','token','--json','--profile','default'])
 def test_wrangler_disklog_disabled_and_inherited_auth_excluded_before_spawn(self):
  with mock.patch.dict(l.os.environ,{'CLOUDFLARE_API_TOKEN':'synthetic-forbidden'}),mock.patch.object(l.subprocess,'Popen',side_effect=RuntimeError('fake-no-exec')) as cli,mock.patch.object(l,'save'):
   with self.assertRaises(c.Stop):l.normal_wrangler_memory(['login'],'fake',1)
   env=cli.call_args.kwargs['env'];self.assertEqual(env['WRANGLER_WRITE_LOGS'],'false');self.assertNotIn('CLOUDFLARE_API_TOKEN',env)
   self.assertEqual(cli.call_args.args[0],['/opt/homebrew/bin/node','--no-warnings',c.SCOPE['oauthPolicy']['wranglerCliPath'],'--env-file','/dev/null','login'])
 def test_http403_preserves_only_numeric_codes_and_safe_metadata(self):
  body=b'{"errors":[{"code":10000,"message":"SYNTHETIC_SECRET"},{"code":"9999"}],"token":"SYNTHETIC_SECRET"}'
  error=urllib.error.HTTPError('https://api.cloudflare.com/fixed',403,'Forbidden',{},io.BytesIO(body));opener=mock.Mock();opener.open.side_effect=error
  with mock.patch.object(l.urllib.request,'build_opener',return_value=opener),mock.patch.object(l,'save') as saved:
   with self.assertRaises(c.Stop):l.api('synthetic', '/accounts/'+c.SCOPE['accountId']+'/containers/registries/registry.cloudflare.com/credentials','POST',{})
   safe=saved.call_args.args[1];self.assertEqual(safe['serviceErrorCodes'],[10000]);self.assertEqual(safe['status'],403);self.assertNotIn('SYNTHETIC_SECRET',json.dumps(safe));self.assertEqual(opener.open.call_count,1)
 def test_bad_json_and_successfalse_still_preserve_only_safe_http_metadata(self):
  for body in (b'not-json-SYNTHETIC_SECRET',b'{"success":false,"errors":[{"code":10000,"message":"SYNTHETIC_SECRET"}]}'):
   response=mock.Mock(status=200);response.read.return_value=body;opener=mock.Mock();opener.open.return_value=response
   with self.subTest(bodyBytes=len(body)),mock.patch.object(l.urllib.request,'build_opener',return_value=opener),mock.patch.object(l,'save') as saved:
    with self.assertRaises(c.Stop):l.api('synthetic','/accounts/'+c.SCOPE['accountId']+'/containers/registries/registry.cloudflare.com/credentials','POST',{})
    safe=saved.call_args.args[1];self.assertEqual(safe['status'],200);self.assertFalse(safe['acceptedStatusAndSuccess']);self.assertTrue(safe['responseCaptureComplete']);self.assertNotIn('SYNTHETIC_SECRET',json.dumps(safe));self.assertEqual(opener.open.call_count,1)
 def test_original_archive_readonly_binding_and_digest_drift_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp).resolve()/'original.tar';scope,diff=fixture(p);p.chmod(0o600);before=p.read_bytes();proof,raw=o.verify(p,scope,diff)
   scope.update(sourceArchive={'path':str(p),'bytes':len(before),'sha256':c.sha(before)},expectedPlatformManifest=proof['linuxAmd64Manifest'],expectedConfig=proof['config'],expectedBlobCount=4,expectedRootfsLayerCount=1)
   with mock.patch.object(r,'S',scope):self.assertEqual(r.verify_reused_archive({'RootFS':{'Layers':diff}})[0],proof)
   self.assertEqual(p.read_bytes(),before);scope['sourceArchive']['sha256']='0'*64
   with mock.patch.object(r,'S',scope),self.assertRaises(c.Stop):r.verify_reused_archive({'RootFS':{'Layers':diff}})
 def test_remote_eof_after_ready_never_exports_or_pushes(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp).resolve()/'new-recovery';before={'RootFS':{'Layers':[]},'Config':{}}
   stdin=mock.Mock();stdin.buffer.readline.return_value=b'';output=io.StringIO()
   with mock.patch.object(c,'grant'),mock.patch.object(r,'ROOT',root),mock.patch.object(r,'RECORDS',root/'records'),mock.patch.object(r.sys,'platform','linux'),mock.patch.object(r.sys,'stdin',stdin),mock.patch.object(r,'inspect',return_value=before),mock.patch.object(r,'verify_reused_archive',return_value=({'sourceImageId':c.SCOPE['sourceImageId']},{'index':b'{}','manifest':b'{}','config':b'{}'})),mock.patch.object(r,'route_addresses',return_value=['127.0.0.1']),mock.patch.object(r.signal,'alarm'),mock.patch.object(r.subprocess,'Popen',side_effect=AssertionError('forbidden')),contextlib.redirect_stdout(output):result=r.execute(b'{}','a'*64)
   self.assertEqual(result['actualExportAttempts'],0);self.assertEqual(result['actualPushAttempts'],0);self.assertEqual(result['actualArchiveReadVerifications'],1);self.assertEqual(result['errorCode'],'credential-stdin-bound');self.assertFalse((root/'original.oci.tar').exists());self.assertFalse((root/'temporary-auth').exists())
 def test_ready_is_saved_before_one403_post_and_retained_in_local_terminal(self):
  v={'sourceImageId':c.SCOPE['sourceImageId'],'allRawBlobHashesSizesReachable':True,'allRunnableDiffIdsMatched':True,'archiveBytes':c.SCOPE['sourceArchive']['bytes'],'archiveSha256':c.SCOPE['sourceArchive']['sha256'],'linuxAmd64Manifest':c.SCOPE['expectedPlatformManifest'],'config':c.SCOPE['expectedConfig'],'blobCount':52,'rootfsLayerCount':48}
  event={'requestId':c.SCOPE['requestId'],'phase':'verified-original-awaiting-credential','routeOnlyLoopbackVerified':True,'verification':v}
  class Input(io.BytesIO):
   def close(self):pass
  with tempfile.TemporaryDirectory() as tmp:
   state=Path(tmp).resolve()/'attempt';rd,wr=os.pipe();os.write(wr,bjson(event)+b'\n');os.close(wr);er,ew=os.pipe();os.close(ew)
   child=mock.Mock(pid=987654,stdin=Input(),stdout=os.fdopen(rd,'rb'),stderr=os.fdopen(er,'rb'));child.poll.return_value=0;child.wait.return_value=0
   original_sha=c.sha
   def fake_sha(b):return c.SCOPE['expectedUserIdSha256'] if b==b'synthetic-user' else original_sha(b)
   count=[]
   def api(token,path,method='GET',body=None):
    if path=='/user':return {'id':'synthetic-user'}
    if method=='GET':return {'id':c.SCOPE['accountId']}
    self.assertTrue((state/'verified-ready-before-credential.json').exists());count.append(1);raise c.Stop('auth-api-explicit-http-failure-no-retry')
   expiry=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)).isoformat()
   with mock.patch.object(l,'STATE',state),mock.patch.object(l,'inputs',return_value=(b'{}',b'{}',{n:b'' for n in c.FILES})),mock.patch.object(l,'oauth_after_new_grant',return_value=('synthetic',expiry,list(l.EXPECTED_SCOPES))),mock.patch.object(l,'api',side_effect=api),mock.patch.object(l,'ssh_config_no_inherited_forwards',return_value='a'*64),mock.patch.object(l.subprocess,'Popen',return_value=child),mock.patch.object(c,'grant'),mock.patch.object(c,'sha',side_effect=fake_sha):result=l.execute(Path(tmp)/'unused','b'*64)
   self.assertEqual(count,[1]);self.assertEqual(result['safeRemoteEvents'],[event]);self.assertFalse(result['credentialStdinSent']);self.assertFalse(result['finalPublicationAckVerified']);self.assertEqual(child.stdin.getvalue(),b'{}\n')
if __name__=='__main__':unittest.main()
