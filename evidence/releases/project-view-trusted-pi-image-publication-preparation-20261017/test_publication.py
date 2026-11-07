"""Risk-matched local fake checks. No SSH, Docker, OAuth file or real API access."""
import copy,datetime as dt,gzip,hashlib,importlib.util,io,json,os,sys,tarfile,tempfile,unittest
from pathlib import Path
from unittest import mock
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import pub_common as c;import oci_verify as o
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
l=load('publication_local','local-publication.py');r=load('publication_remote','remote-publication.py')
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
   load('inert_local','local-publication.py');load('inert_remote','remote-publication.py')
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
  changed=dict(files);changed['remote-publication.py']+=b'# drift'
  with self.assertRaises(c.Stop):c.manifest(m,changed)
 def test_existing_five_scopes_accepted_and_scope_expansion_rejected(self):
  now=dt.datetime.now(dt.timezone.utc);expiry=(now+dt.timedelta(hours=1)).isoformat();scopes=list(l.EXPECTED_SCOPES)
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp).resolve()/'config.toml';p.write_text('oauth_token = "synthetic-local-token"\nexpiration_time = '+json.dumps(expiry)+'\nscopes = '+json.dumps(scopes)+'\n');p.chmod(0o600)
   with mock.patch.object(l,'OAUTH',p):self.assertEqual(set(l.oauth_after_new_grant()[2]),l.EXPECTED_SCOPES)
   p.write_text(p.read_text().replace(json.dumps(scopes),json.dumps(scopes+['containers:write'])))
   with mock.patch.object(l,'OAUTH',p),self.assertRaises(c.Stop):l.oauth_after_new_grant()
 def test_rest_credential_success_requires201_without_retry(self):
  for status in (200,201):
   response=mock.Mock(status=status);response.read.return_value=bjson({'success':True,'result':{'account_id':c.SCOPE['accountId'],'registry_host':'registry.cloudflare.com','username':'synthetic-user','password':'synthetic-pass'}})
   opener=mock.Mock();opener.open.return_value=response
   with self.subTest(status=status),mock.patch.object(l.urllib.request,'build_opener',return_value=opener):
    if status==201:self.assertEqual(l.api('fake','/accounts/'+c.SCOPE['accountId']+'/containers/registries/registry.cloudflare.com/credentials','POST',{'expiration_minutes':15,'permissions':['push','pull']})['registry_host'],'registry.cloudflare.com')
    else:
     with self.assertRaises(c.Stop):l.api('fake','/accounts/'+c.SCOPE['accountId']+'/containers/registries/registry.cloudflare.com/credentials','POST',{'expiration_minutes':15,'permissions':['push','pull']})
    self.assertEqual(opener.open.call_count,1)
 def test_inherited_forwards_stop_and_bootstrap_no_credential_in_source(self):
  for inherited in (False,True):
   completed=mock.Mock(returncode=0,stdout=b'forwardagent no\n'+(b'localforward 123 localhost:1\n' if inherited else b''),stderr=b'')
   with self.subTest(inherited=inherited),mock.patch.object(l.subprocess,'run',return_value=completed):
    if inherited:
     with self.assertRaises(c.Stop):l.ssh_config_no_inherited_forwards()
    else:self.assertEqual(len(l.ssh_config_no_inherited_forwards()),64)
  files={n:(HERE/n).read_bytes() for n in c.FILES};source=l.bootstrap(files,'a'*64);compile(source,'bootstrap','exec');self.assertNotIn(b'synthetic-local-token',source)
 def test_final_ack_required_even_after_ready_and_zero_ssh_exit(self):
  md={'digest':'sha256:'+'2'*64,'size':123,'mediaType':o.MANIFEST};cd={'digest':'sha256:'+'3'*64,'size':123,'mediaType':'application/vnd.oci.image.config.v1+json'}
  ready={'phase':'verified-original-awaiting-credential','requestId':c.SCOPE['requestId'],'verification':{'schema':'trusted-pi-original-oci-verification/v1','sourceImageId':c.SCOPE['sourceImageId'],'originalIndex':c.SCOPE['sourceDescriptor'],'allRawBlobHashesSizesReachable':True,'allRunnableDiffIdsMatched':True,'linuxAmd64Manifest':md,'config':cd}}
  final={'schema':'trusted-pi-image-publication-result/v1','requestId':c.SCOPE['requestId'],'sourceImageId':c.SCOPE['sourceImageId'],'destination':'registry.cloudflare.com/'+c.SCOPE['repository']+':'+c.SCOPE['tag'],'status':'original-image-pushed-and-all-raw-registry-readback-verified','actualExportAttempts':1,'actualPushAttempts':1,'platformManifest':md,'config':cd,'credentialFilesAbsent':True,'cleanupErrors':[]}
  self.assertTrue(l.final_ack([ready,final],b''))
  conflict=copy.deepcopy(final);conflict['config']['digest']='sha256:'+'4'*64
  for events,pending in [([ready],b''),([ready,final,final],b''),([ready,conflict],b''),([ready,final],b'{"schema":')]:
   with self.subTest(events=len(events),pending=bool(pending)),self.assertRaises(c.Stop):l.final_ack(events,pending)
if __name__=='__main__':unittest.main()
