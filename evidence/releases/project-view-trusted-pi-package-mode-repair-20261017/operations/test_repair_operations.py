"""Offline synthetic/dummy guards; no real SSH/Docker/auth/API subprocess."""
import base64,datetime as dt,gzip,hashlib,importlib.util,io,json,os,struct,sys,tarfile,tempfile,unittest
from pathlib import Path
from unittest import mock
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import repair_common as c

def load(name,file):
 s=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
r=load('repair_runner','build-probe-repair.py');l=load('repair_local','transfer-local.py');v=load('repair_receiver','transfer-receiver.py')
ARCHIVE=Path('/Users/jihegao/.codex/worktrees/jhg46-production/riffology-cloud/.local/jhg46-native-user-acceptance-20261017/pi-package-mode-repair-v1/jhg46-pi-package-mode-repair-v1-20261017.tar.gz')
REQ=c.SCOPE['requestId'];CID='a'*64;IMG='sha256:'+'b'*64

def ops():return (HERE/'operations-manifest.json').read_bytes(),{n:(HERE/n).read_bytes() for n in c.OPS_FILES}
def grant(manifest):
 now=dt.datetime.now(dt.timezone.utc)
 return {'schema':'trusted-pi-package-permissions-grant/v1','approved':True,'requestId':REQ,'parentRequestId':c.SCOPE['parentRequestId'],
  'recipient':c.SCOPE['recipient'],'remoteDirectory':c.SCOPE['remoteDirectory'],'canonicalImplementationCommit':c.SCOPE['canonicalImplementationCommit'],
  'archiveSha256':c.SCOPE['archive']['sha256'],'archiveBytes':c.SCOPE['archive']['bytes'],'operationsManifestSha256':c.sha(manifest),
  'baseImage':c.SCOPE['baseImage'],'operations':list(c.SCOPE['operations']),'excluded':list(c.SCOPE['excluded']),
  'humanReplySha256':'e'*64,'approvedAt':(now-dt.timedelta(seconds=10)).isoformat(),'expiresAt':(now+dt.timedelta(minutes=30)).isoformat()}

def altered_archive(change):
 original=gzip.decompress(ARCHIVE.read_bytes());out=io.BytesIO()
 with tarfile.open(fileobj=io.BytesIO(original),mode='r:') as src,tarfile.open(fileobj=out,mode='w',format=tarfile.USTAR_FORMAT) as dst:
  for i,m in enumerate(src):
   b=src.extractfile(m).read();change(i,m);dst.addfile(m,io.BytesIO(b))
 raw=out.getvalue();compressed=gzip.compress(raw,mtime=0)
 scope=json.loads(c.SCOPE_RAW);scope['archive'].update(bytes=len(compressed),sha256=c.sha(compressed),uncompressedBytes=len(raw),uncompressedSha256=c.sha(raw));return compressed,scope

class Tests(unittest.TestCase):
 def test_imports_never_start_transport(self):
  with mock.patch.object(l.subprocess,'Popen',side_effect=AssertionError('forbidden')):
   load('inert_runner','build-probe-repair.py');load('inert_local','transfer-local.py');load('inert_receiver','transfer-receiver.py')
 def test_actual_repair_archive_unprefixed_12_and_original_probe(self):
  members=v.unpack_members(ARCHIVE.read_bytes(),json.loads(c.SCOPE_RAW));self.assertEqual(len(members),12)
  self.assertTrue(all(not n.startswith('payload/') for n in members));self.assertEqual(c.sha(members['input-manifest.json']),r.MANIFEST)
  self.assertEqual(c.sha(members['probe/compatibility-probe.mjs']),'bded581766c4656b05b72c6fce39fcb43461a44cbe407c0d1e9ab4a23edf2097')
  repair=json.loads(members['repair-manifest.json']);self.assertEqual((repair['runtimeOverlayDestinations'],repair['permissionRepairDestinations'],repair['totalCopyDestinations']),(6,2,8))
 def test_bad_archive_hash_and_unrecognized_paths_links_or_modes_reject(self):
  with self.assertRaises(v.Stop):v.unpack_members(ARCHIVE.read_bytes()+b'x',json.loads(c.SCOPE_RAW))
  for change in [lambda i,m:setattr(m,'name','payload/'+m.name) if i==0 else None,
   lambda i,m:setattr(m,'name','../escape') if i==0 else None,
   lambda i,m:setattr(m,'mode',0o666) if i==0 else None,
   lambda i,m:(setattr(m,'type',tarfile.SYMTYPE),setattr(m,'linkname','/etc/passwd')) if i==0 else None]:
   b,s=altered_archive(change)
   with self.assertRaises(v.Stop):v.unpack_members(b,s)
 def test_complete_manifest_and_grant_bind_every_specific_scope(self):
  m,files=ops();c.verify_manifest(m,files);g=grant(m);c.validate_grant(json.dumps(g).encode(),m)
  for k,bad in [('approved',False),('recipient','other'),('remoteDirectory','/tmp/other'),('operations',[]),('canonicalImplementationCommit','0'*40),('operationsManifestSha256','0'*64),('expiresAt','2020-01-01T00:00:00Z')]:
   with self.subTest(k=k),self.assertRaises(c.Stop):c.validate_grant(json.dumps(dict(g,**{k:bad})).encode(),m)
  changed=dict(files);changed['build-probe-repair.py']+=b'#drift'
  with self.assertRaises(c.Stop):c.verify_manifest(m,changed)
 def test_missing_grant_hard_stops_before_ssh_or_auth(self):
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(l.subprocess,'Popen') as client:
   with self.assertRaises(c.Stop):l.execute(Path(tmp)/'absent.json','a'*64,ARCHIVE)
   client.assert_not_called()
 def test_wire_is_stdin_only_and_ssh_disables_forwarding(self):
  m,files=ops();g=json.dumps(grant(m)).encode();wire=l.envelope(g,m,files,ARCHIVE.read_bytes());n=struct.unpack('>I',wire[:4])[0]
  self.assertEqual(wire[4+n:],ARCHIVE.read_bytes());h=json.loads(wire[4:4+n]);self.assertEqual(base64.b64decode(h['grantBase64']),g)
  a=l.ssh_argv(files['transfer-receiver.py']);self.assertIn('-oClearAllForwardings=yes',a);self.assertIn('-oControlPath=none',a);self.assertIn('-oForwardAgent=no',a);self.assertEqual(a[-2],'AMD128');self.assertNotIn(g.decode(),str(a))
 def test_lost_ack_preserves_new_identity_and_blocks_second_transfer(self):
  m,files=ops();g=json.dumps(grant(m)).encode();inputs=(g,m,files,ARCHIVE.read_bytes(),{'humanGrantSha256':c.sha(g)})
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(l,'STATE',Path(tmp)/'once'),mock.patch.object(l,'load_inputs',return_value=inputs),mock.patch.object(l,'run_ssh',side_effect=c.Stop('lost-ack')) as sender:
   result=l.execute(Path('/unused'),'a'*64,ARCHIVE);self.assertEqual(result['status'],'unknown-stopped');self.assertEqual(sender.call_count,1)
   with self.assertRaises(FileExistsError):l.execute(Path('/unused'),'a'*64,ARCHIVE)
   self.assertEqual(sender.call_count,1);self.assertTrue((Path(tmp)/'once/result.json').exists())
 def test_partial_receiver_eof_keeps_permanent_directory_lock(self):
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(v,'ROOT',Path(tmp).resolve()/'repair'),mock.patch.object(v.sys,'platform','linux'):
   r1=v.receive(io.BytesIO(b''));self.assertEqual(r1['status'],'unknown-stopped')
   with self.assertRaises(v.Stop):v.receive(io.BytesIO(b''))
 def test_plain_default_builder_and_build_identity_bindings(self):
  self.assertEqual(r.parse_default_builder(b'Name: default\nDriver: docker\nNodes:\nName: node\n')['Name'],'default')
  with self.assertRaises(r.Stop):r.parse_default_builder(b'Name: default\nDriver: docker-container\nNodes:\n')
  d={'digest':'sha256:'+'d'*64,'mediaType':'application/vnd.oci.image.index.v1+json','size':856};meta={'containerimage.digest':d['digest'],'containerimage.descriptor':d}
  self.assertEqual(r.bind_build_identity(d['digest'],meta,{'Id':d['digest'],'Descriptor':d})['engineIdRole'],'descriptor')
  with self.assertRaises(r.Stop):r.bind_build_identity(IMG,meta,{'Id':d['digest'],'Descriptor':d})
 def test_same_build_lock_and_other_uuid_stop_before_docker(self):
  with mock.patch.object(r.common,'verify_installed_authorization',return_value={}),mock.patch.object(r,'verify_inputs',return_value={}),tempfile.TemporaryDirectory() as tmp,mock.patch.object(r,'RECORDS',Path(tmp)),mock.patch.object(r,'command') as client:
   with self.assertRaises(FileExistsError):r.execute(REQ,'a'*64)
   with self.assertRaises(r.Stop):r.execute(c.SCOPE['parentRequestId'],'a'*64)
   client.assert_not_called()
 def test_original_id_cleanup_requires_notfound_even_when_label_empty(self):
  with mock.patch.object(r,'labelled_ids',return_value=[]),mock.patch.object(r,'inspect_original',return_value=None) as ins,mock.patch.object(r,'write_new'):
   self.assertTrue(r.cleanup(REQ,IMG,CID)['cleanupConfirmed']);self.assertEqual(ins.call_count,2)
  with mock.patch.object(r,'labelled_ids',return_value=[]),mock.patch.object(r,'inspect_original',side_effect=r.Stop('unknown')),mock.patch.object(r,'write_new'):
   self.assertFalse(r.cleanup(REQ,IMG,CID)['cleanupConfirmed'])
 def test_strict_notfound_does_not_accept_other_errors(self):
  self.assertTrue(r.missing_container(1,{'stdout':b'[]','stderr':('Error: No such object: '+CID).encode()},CID))
  self.assertFalse(r.missing_container(1,{'stdout':b'[]','stderr':b'permission denied'},CID))
 def test_runner_never_restarts_after_lost_create_ack(self):
  base={'RepoDigests':[r.BASE],'Os':'linux','Architecture':'amd64','Id':r.BASE.split('@')[1],'Descriptor':{'digest':r.BASE.split('@')[1]},'Config':{'User':'root','Entrypoint':['/container-server/sandbox']},'RootFS':{'Layers':[IMG]}}
  desc={'digest':IMG,'mediaType':'application/vnd.oci.image.index.v1+json','size':856};image={'Id':IMG,'Os':'linux','Architecture':'amd64','Descriptor':desc,'Config':dict(base['Config']),'RootFS':{'Layers':[IMG]}}
  commands=[]
  def checked(name,args,seconds,limit=131072):
   commands.append(name)
   if name=='default-builder-inspect-plain':return {'stdout':b'Name: default\nDriver: docker\nNodes:\n'}
   if name=='build-help':return {'stdout':b'--metadata-file'}
   if name=='build-once':
    (r.RECORDS/'derived.iid').write_text(IMG);(r.RECORDS/'build-metadata.json').write_text(json.dumps({'containerimage.digest':IMG,'containerimage.descriptor':desc}));return {'stdout':b''}
   if name=='create-once':raise r.Stop('lost-create-ack')
   raise AssertionError(name)
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(r,'RECORDS',Path(tmp)/'lock'),mock.patch.object(r.common,'verify_installed_authorization',return_value={}),mock.patch.object(r,'verify_inputs',return_value={}),mock.patch.object(r,'docker_json',side_effect=[base,image]),mock.patch.object(r,'checked',side_effect=checked),mock.patch.object(r,'command',return_value=(1,{'stdout':b'[]','stderr':('Error: No such image: riffology-jhg46-pi-package-permissions:'+REQ).encode()})),mock.patch.object(r,'labelled_ids',return_value=[]),mock.patch.object(r,'cleanup',return_value={'cleanupConfirmed':False}) as cleanup:
   result=r.execute(REQ,'a'*64);self.assertEqual(result['status'],'unknown-stopped');self.assertEqual(commands.count('build-once'),1);self.assertEqual(commands.count('create-once'),1);self.assertNotIn('start-original-once',commands);self.assertEqual(cleanup.call_count,1)
if __name__=='__main__':unittest.main()
