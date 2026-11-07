"""Necessary offline harness guards; every external command is mocked."""
import ast,copy,datetime as dt,gzip,importlib.util,io,json,os,stat,sys,tarfile,tempfile,unittest
from pathlib import Path
from unittest import mock
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import probe_common as c
def load(name,file):
 s=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
r=load('probe_runner','mock-probe-once.py');l=load('probe_sender','transfer-local.py');v=load('probe_receiver','transfer-receiver.py');z=load('probe_launcher','run-local.py')
ARCHIVE=HERE.parent/c.SCOPE['archive']['path'];REQ=c.SCOPE['requestId'];CID='a'*64
def ops():return (HERE/'operations-manifest.json').read_bytes(),{n:(HERE/n).read_bytes() for n in c.OPS_FILES}
def grant(manifest):
 now=dt.datetime.now(dt.timezone.utc)
 return {'schema':'trusted-pi-probe-readable-grant/v1','approved':True,'requestId':REQ,'parentRequestId':c.SCOPE['parentRequestId'],
  'recipient':c.SCOPE['recipient'],'remoteDirectory':c.SCOPE['remoteDirectory'],'canonicalImplementationCommit':c.SCOPE['canonicalImplementationCommit'],
  'archiveSha256':c.SCOPE['archive']['sha256'],'archiveBytes':c.SCOPE['archive']['bytes'],'operationsManifestSha256':c.sha(manifest),
  'imageId':c.SCOPE['imageId'],'operations':list(c.SCOPE['operations']),'excluded':list(c.SCOPE['excluded']),
  'humanReplySha256':'e'*64,'approvedAt':(now-dt.timedelta(seconds=10)).isoformat(),'expiresAt':(now+dt.timedelta(minutes=30)).isoformat()}
def image():
 return {'Id':r.IMAGE_ID,'Os':'linux','Architecture':'amd64','Descriptor':{'digest':r.IMAGE_ID,'mediaType':'application/vnd.oci.image.index.v1+json','size':856},
  'Config':{'User':'root','Entrypoint':['/container-server/sandbox'],'Cmd':None,'WorkingDir':'/container-server','Env':['PATH=/usr/bin']},'RootFS':{'Type':'layers','Layers':['sha256:'+'b'*64]}}
def sandbox(status='created'):
 return {'Image':r.IMAGE_ID,'Config':{'User':'10002:10002','WorkingDir':'/tmp','Entrypoint':['/usr/bin/env']},
  'HostConfig':{'NetworkMode':'none','ReadonlyRootfs':True,'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges'],'PidsLimit':128,'Memory':768*1024*1024,'NanoCpus':1000000000,'Privileged':False,'Tmpfs':{'/tmp':'rw,nosuid,nodev,size=64m,mode=1777'}},
  'Mounts':[{'Type':'bind','Destination':dest,'Source':str(r.ROOT/src),'RW':False} for src,dest in [('probe/compatibility-probe.mjs','/compat-input/probe/compatibility-probe.mjs'),('input-manifest.json','/compat-input/input-manifest.json')]],
  'State':{'Status':status,'Running':False,'ExitCode':0}}
def report():
 manifest=json.loads((HERE.parent/'payload/input-manifest.json').read_bytes())
 return {'schema':'trusted-pi-offline-compatibility-probe/v1','mode':'image','result':'passed','manifestSha256':r.MANIFEST,'uid':10002,'gid':10002,'activeAliasActuallyInspected':True,
  'sourceEquivalentActiveRelease':False,'sourceMacEncodingNormalized':False,'checkedTargets':12,'overlayTargets':6,'checks':{k:True for k in r.CHECKS},
  'imageTargets':[{'imagePath':x['imagePath'],'bytes':x['bytes'],'sha256':x['sha256']} for x in manifest['fileTargets']],
  'syntheticRequests':{'model':3,'research':1,'projectToolExecutions':0,'ambientFetchCalls':0},'realProviderRequests':0,'credentialsReadByProbe':False}
class Tests(unittest.TestCase):
 def test_imports_inert_and_archive_exact_original_two(self):
  with mock.patch.object(l.subprocess,'Popen',side_effect=AssertionError('forbidden')):
   load('inert_runner','mock-probe-once.py');load('inert_sender','transfer-local.py');load('inert_receiver','transfer-receiver.py');load('inert_launcher','run-local.py')
  members=v.unpack_members(ARCHIVE.read_bytes(),json.loads(c.SCOPE_RAW));self.assertEqual(set(members),{'input-manifest.json','probe/compatibility-probe.mjs'})
  self.assertEqual(c.sha(members['input-manifest.json']),r.MANIFEST);self.assertEqual(c.sha(members['probe/compatibility-probe.mjs']),'bded581766c4656b05b72c6fce39fcb43461a44cbe407c0d1e9ab4a23edf2097')
 def test_only_public_inputs_fchmod0444_private_inputs0600(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);a=p/'public';b=p/'private';v.save(a,b'public-bytes',public_input=True);v.save(b,b'private')
   self.assertEqual(a.stat().st_mode&0o777,0o444);self.assertEqual(b.stat().st_mode&0o777,0o600)
   self.assertEqual(a.read_bytes(),b'public-bytes');self.assertEqual(b.read_bytes(),b'private')
   with self.assertRaises(FileExistsError):v.save(a,b'changed',public_input=True)
 def test_archive_drift_traversal_link_and_mode_rejected(self):
  with self.assertRaises(v.Stop):v.unpack_members(ARCHIVE.read_bytes()+b'x',json.loads(c.SCOPE_RAW))
  for change in [('name','../escape'),('mode',0o600),('type',tarfile.SYMTYPE)]:
   out=io.BytesIO()
   with tarfile.open(fileobj=io.BytesIO(gzip.decompress(ARCHIVE.read_bytes())),mode='r:') as src,tarfile.open(fileobj=out,mode='w',format=tarfile.USTAR_FORMAT) as dst:
    for i,m in enumerate(src):
     b=src.extractfile(m).read()
     if i==0:setattr(m,*change)
     dst.addfile(m,io.BytesIO(b))
   raw=out.getvalue();compressed=gzip.compress(raw,mtime=0);scope=json.loads(c.SCOPE_RAW);scope['archive'].update(bytes=len(compressed),sha256=c.sha(compressed),uncompressedBytes=len(raw),uncompressedSha256=c.sha(raw))
   with self.assertRaises(v.Stop):v.unpack_members(compressed,scope)
 def test_specific_grant_and_manifest_before_any_ssh(self):
  m,files=ops();c.verify_manifest(m,files);g=grant(m);c.validate_grant(json.dumps(g).encode(),m)
  for k,bad in [('approved',False),('imageId','sha256:'+'0'*64),('requestId',c.SCOPE['parentRequestId']),('operations',[]),('operationsManifestSha256','0'*64),('expiresAt','2020-01-01T00:00:00Z')]:
   with self.subTest(k=k),self.assertRaises(c.Stop):c.validate_grant(json.dumps(dict(g,**{k:bad})).encode(),m)
  changed=dict(files);changed['mock-probe-once.py']+=b'#drift'
  with self.assertRaises(c.Stop):c.verify_manifest(m,changed)
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(l.subprocess,'Popen') as client:
   with self.assertRaises(c.Stop):l.execute(Path(tmp)/'absent','a'*64,ARCHIVE)
   with self.assertRaises(c.Stop):z.execute(Path(tmp)/'absent','a'*64,ARCHIVE)
   client.assert_not_called()
 def test_ssh_disables_forwarding_and_source_bootstrap_is_pinned(self):
  m,files=ops();argv=l.ssh_argv(files['transfer-receiver.py']);self.assertIn('-oForwardAgent=no',argv);self.assertIn('-oClearAllForwardings=yes',argv);self.assertIn('-oControlPath=none',argv)
  source=z.launcher(files,m,'e'*64).decode();self.assertIn(c.sha(files['mock-probe-once.py']),source);self.assertIn(c.sha(files['probe_common.py']),source);compile(source,'remote-bootstrap','exec')
 def test_lost_transfer_or_launcher_ack_blocks_second_attempt(self):
  m,files=ops();g=json.dumps(grant(m)).encode();inputs=(g,m,files,ARCHIVE.read_bytes(),{'humanGrantSha256':c.sha(g)})
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(l,'STATE',Path(tmp)/'once'),mock.patch.object(l,'load_inputs',return_value=inputs),mock.patch.object(l,'run_ssh',side_effect=c.Stop('lost-ack')) as sender:
   self.assertEqual(l.execute(Path('/unused'),'a'*64,ARCHIVE)['status'],'unknown-stopped')
   with self.assertRaises(FileExistsError):l.execute(Path('/unused'),'a'*64,ARCHIVE)
   self.assertEqual(sender.call_count,1)
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(z,'STATE',Path(tmp)/'once'),mock.patch.object(z.t,'load_inputs',return_value=inputs),mock.patch.object(z,'verified_transfer',return_value={'transferredVerified':True}),mock.patch.object(z.t,'run_ssh',side_effect=c.Stop('lost-ack')) as launch:
   self.assertEqual(z.execute(Path('/unused'),'a'*64,ARCHIVE)['status'],'unknown-stopped')
   with self.assertRaises(FileExistsError):z.execute(Path('/unused'),'a'*64,ARCHIVE)
   self.assertEqual(launch.call_count,1)
 def test_unknown_or_mismatched_transfer_ack_stops_before_launch(self):
  m,files=ops();g=json.dumps(grant(m)).encode();inputs=(g,m,files,ARCHIVE.read_bytes(),{'humanGrantSha256':c.sha(g)})
  good={'requestId':REQ,'status':'transferred-verified','remoteReceipt':{'schema':'trusted-pi-probe-readable-transfer-result/v1','requestId':REQ,'status':'transferred-verified',
   'archiveSha256':c.SCOPE['archive']['sha256'],'archiveBytes':c.SCOPE['archive']['bytes'],'fileCount':2,'operationsManifestSha256':c.sha(m),'humanGrantSha256':c.sha(g),
   'unprefixedTarNames':True,'publicInputModes0444':True,'privateOperationsModes0600':True,'credentialReadOrTransferred':False,'dockerOrContainerCommandExecuted':False,'cloudWrite':False}}
  for key,bad in [('status','unknown-stopped'),('requestId',c.SCOPE['parentRequestId']),('archiveSha256','0'*64),('archiveBytes',0),('operationsManifestSha256','0'*64),('humanGrantSha256','0'*64)]:
   with self.subTest(key=key),tempfile.TemporaryDirectory() as tmp,mock.patch.object(z,'HERE',Path(tmp).resolve()),mock.patch.object(z,'STATE',Path(tmp).resolve()/'launch'),mock.patch.object(z.t,'load_inputs',return_value=inputs),mock.patch.object(z.t,'run_ssh') as ssh:
    parent=Path(tmp).resolve()/'transfer-once';parent.mkdir(mode=0o700);receipt=copy.deepcopy(good)
    if key=='status':receipt['status']=bad
    else:receipt['remoteReceipt'][key]=bad
    z.t.save(parent/'result.json',receipt)
    with self.assertRaises(c.Stop):z.execute(Path('/unused'),c.sha(g),ARCHIVE)
    ssh.assert_not_called();self.assertFalse(z.STATE.exists())
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(z,'HERE',Path(tmp).resolve()):
   parent=Path(tmp).resolve()/'transfer-once';parent.mkdir(mode=0o700);z.t.save(parent/'result.json',good)
   self.assertTrue(z.verified_transfer(m,c.sha(g))['transferredVerified'])
 def test_ssh_poll_wait_stop_faults_still_save_private_logs_and_terminal(self):
  for wait_succeeds in (False,True):
   with self.subTest(wait_succeeds=wait_succeeds),tempfile.TemporaryDirectory() as tmp,mock.patch.object(l,'STATE',Path(tmp).resolve()),mock.patch.object(l.subprocess,'Popen') as popen,mock.patch.object(l.os,'killpg') as killpg,mock.patch.object(l.os,'set_blocking'),mock.patch.object(l,'ticks',return_value=None),mock.patch.object(l.selectors,'DefaultSelector') as select:
    proc=mock.Mock(pid=99999999,stdin=io.BytesIO(),stdout=io.BytesIO(),stderr=io.BytesIO());popen.return_value=proc
    proc.poll.side_effect=OSError('synthetic poll fault');proc.wait.side_effect=[OSError('synthetic wait fault'),0] if wait_succeeds else OSError('synthetic wait fault')
    select.return_value.__enter__.return_value.get_map.return_value={}
    with self.assertRaises(c.Stop):l.run_ssh(['unused'],b'')
    terminal=json.loads((l.STATE/'ssh-terminal.json').read_bytes());self.assertTrue(terminal['localStopErrors']);self.assertEqual(terminal['originalSshReaped'],wait_succeeds)
    self.assertFalse(terminal['remoteStoppedByLocalCleanupProved']);self.assertIsNotNone(terminal['errorCode'])
    for name in ('stdout.private','stderr.private','ssh-terminal.json'):self.assertEqual((l.STATE/name).stat().st_mode&0o777,0o600)
 def test_bootstrap_private_manifest_grant_symlinks_never_read(self):
  m,files=ops();tree=ast.parse(z.launcher(files,m,'e'*64).decode());function=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='private_bytes')
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp).resolve()/'ops';p.mkdir(mode=0o700);space={'p':p,'os':os,'stat':stat,'hashlib':__import__('hashlib')};exec(compile(ast.Module(body=[function],type_ignores=[]),'private-helper','exec'),space)
   outside=Path(tmp).resolve()/'outside';outside.write_bytes(b'not-a-grant');outside.chmod(0o600)
   for name in ('operations-manifest.json','human-grant.json'):
    q=p/name;q.symlink_to(outside)
    with mock.patch.object(os,'open',wraps=os.open) as reader:
     with self.assertRaises(AssertionError):space['private_bytes'](name,32768,c.sha(outside.read_bytes()))
     reader.assert_not_called()
    q.unlink();q.write_bytes(b'valid-public-fixture');q.chmod(0o600)
    self.assertEqual(space['private_bytes'](name,32768,c.sha(q.read_bytes())),b'valid-public-fixture')
 def test_cached_image_rootfs_launch_and_index_roles_must_match(self):
  good=image();self.assertTrue(r.validate_cached_image(good,copy.deepcopy(good))['rootfsMatched'])
  for change in [('Architecture','arm64'),('Id','sha256:'+'c'*64),('RootFS',{'Layers':[]}),('Config',{'User':'10002:10002'})]:
   bad=copy.deepcopy(good);bad[change[0]]=change[1]
   with self.subTest(change=change),self.assertRaises(r.Stop):r.validate_cached_image(bad,good)
 def test_docker0664_cid_safe_inside0700_and_symlink_rejected(self):
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(r,'RECORDS',Path(tmp).resolve()):
   p=Path(tmp).resolve()/'probe.cid';p.write_text(CID);p.chmod(0o664);self.assertEqual(r.read_cid(p),CID)
   p.unlink();p.symlink_to(Path(tmp)/'other')
   with self.assertRaises(OSError):r.read_cid(p)
 def test_original_strict_checks_and_sandbox_not_relaxed(self):
  manifest=json.loads((HERE.parent/'payload/input-manifest.json').read_bytes());p=report();self.assertEqual(len(p['checks']),15);r.validate_probe(json.dumps(p).encode(),manifest)
  for key,value in [('uid',0),('activeAliasActuallyInspected',False),('checkedTargets',11),('realProviderRequests',1),('credentialsReadByProbe',True)]:
   with self.subTest(key=key),self.assertRaises(r.Stop):r.validate_probe(json.dumps(dict(p,**{key:value})).encode(),manifest)
  r.validate_sandbox(sandbox(),r.IMAGE_ID);bad=sandbox();bad['HostConfig']['NetworkMode']='bridge'
  with self.assertRaises(r.Stop):r.validate_sandbox(bad,r.IMAGE_ID)
 def test_cleanup_needs_original_notfound_and_label_empty(self):
  self.assertTrue(r.missing_container(1,{'stdout':b'[]','stderr':('Error: No such object: '+CID).encode()},CID));self.assertFalse(r.missing_container(1,{'stdout':b'[]','stderr':b'permission denied'},CID))
  with mock.patch.object(r,'labelled_ids',return_value=[]),mock.patch.object(r,'inspect_original',return_value=None) as ins,mock.patch.object(r,'write_new'):
   self.assertTrue(r.cleanup(REQ,r.IMAGE_ID,CID)['cleanupConfirmed']);self.assertEqual(ins.call_count,2)
  with mock.patch.object(r,'labelled_ids',return_value=[]),mock.patch.object(r,'inspect_original',side_effect=r.Stop('unknown')),mock.patch.object(r,'write_new'):
   self.assertFalse(r.cleanup(REQ,r.IMAGE_ID,CID)['cleanupConfirmed'])
 def exercise_runner(self,lost_create=False):
  commands=[]
  def checked(name,args,seconds,limit=131072):
   commands.append((name,args))
   if name=='previous-a21-label':return {'stdout':b''}
   if name=='create-once':
    (r.RECORDS/'probe.cid').write_text(CID);(r.RECORDS/'probe.cid').chmod(0o664)
    if lost_create:raise r.Stop('lost-create-ack')
    return {'stdout':(CID+'\n').encode()}
   if name=='start-original-once':return {'stdout':json.dumps(report()).encode()}
   if name=='wait-original':return {'stdout':b'0\n'}
   raise AssertionError(name)
  notfound=(1,{'stdout':b'[]','stderr':('Error: No such object: '+r.ORIGINAL_CID).encode()})
  with tempfile.TemporaryDirectory() as tmp,mock.patch.object(r,'ROOT',HERE.parent/'payload'),mock.patch.object(r,'RECORDS',Path(tmp).resolve()/'once'),mock.patch.object(r.common,'verify_installed_authorization',return_value={}),mock.patch.object(r,'verify_inputs',return_value={'derived-image-inspect.stdout':image()}),mock.patch.object(r,'docker_json',return_value=image()),mock.patch.object(r,'checked',side_effect=checked),mock.patch.object(r,'command',return_value=notfound),mock.patch.object(r,'labelled_ids',return_value=[]),mock.patch.object(r,'inspect_original',side_effect=[sandbox(),sandbox('exited')]),mock.patch.object(r,'cleanup',return_value={'cleanupConfirmed':True}) as cleanup:
   result=r.execute(REQ,'a'*64);self.assertEqual(cleanup.call_args.args,(REQ,r.IMAGE_ID,CID))
   with self.assertRaises(FileExistsError):r.execute(REQ,'a'*64)
  names=[x[0] for x in commands];self.assertEqual(names.count('create-once'),1);self.assertEqual(names.count('start-original-once'),0 if lost_create else 1)
  self.assertFalse(any(args and args[0] in ('build','pull','push','save') for _,args in commands))
  return result
 def test_successful_mock_fake_one_create_start_and_no_build(self):self.assertEqual(self.exercise_runner()['status'],'offline-image-compatibility-mock-passed')
 def test_lost_create_ack_keeps_original_cid_cleanup_never_starts(self):self.assertEqual(self.exercise_runner(True)['status'],'unknown-stopped')
if __name__=='__main__':unittest.main()
