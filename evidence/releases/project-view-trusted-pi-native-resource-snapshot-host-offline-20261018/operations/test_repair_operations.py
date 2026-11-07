"""Pure fake fixtures only. No subprocess, SSH, Docker or credentials."""
import copy,importlib.util,json,unittest
from pathlib import Path
import repair_common as c
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('runner',HERE/'build-probe-repair.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class Guards(unittest.TestCase):
 def test_manifest_complete(self):c.verify_manifest((HERE/'operations-manifest.json').read_bytes(),{n:(HERE/n).read_bytes() for n in c.OPS_FILES})
 def test_manifest_drift_rejected(self):
  files={n:(HERE/n).read_bytes() for n in c.OPS_FILES};files['EXECUTION.md']+=b'x'
  with self.assertRaises(c.Stop):c.verify_manifest((HERE/'operations-manifest.json').read_bytes(),files)
 def test_transfer_canonical_archive(self):
  spec=importlib.util.spec_from_file_location('receiver',HERE/'transfer-receiver.py');v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
  archive=(HERE.parent.parent/c.SCOPE['archive']['path']).read_bytes();scope=json.loads(c.SCOPE_RAW)
  self.assertEqual(set(v.unpack_members(archive,scope)),set(scope['payload']))
  with self.assertRaises(v.Stop):v.unpack_members(archive+b'x',scope)
 def test_transfer_manifest_private_inputs_are_only_two_public0444(self):
  source=(HERE/'transfer-receiver.py').read_text()
  self.assertIn("if name in ('input-manifest.json','probe/host-resource-snapshot-probe.mjs'):os.chmod(p,0o444)",source)
 def test_closed_config_omission_and_nonempty_values(self):
  raw={'User':'root','Env':['PUBLIC=synthetic'],'Entrypoint':['/container-server/sandbox'],'Cmd':None,'Labels':{},'ArgsEscaped':False}
  engine={'User':'root','Env':['PUBLIC=synthetic'],'Entrypoint':['/container-server/sandbox']}
  self.assertTrue(r.verify_config_representation(engine,raw))
  with self.assertRaises(r.Stop):r.verify_config_representation({**engine,'Env':['PUBLIC=changed']},raw)
 def test_legacy_defaults_are_explicit_and_api_bound(self):
  self.assertTrue(r.verify_config_representation({'User':'root','AttachStdin':False},{'User':'root'},'1.49'))
  with self.assertRaises(r.Stop):r.verify_config_representation({'User':'root','AttachStdin':False},{'User':'root'},'1.56')
  with self.assertRaises(r.Stop):r.verify_config_representation({'User':'root','AttachStdin':True},{'User':'root'},'1.49')
 def test_config_unknown_null_and_wrong_types_rejected(self):
  for raw in [{'Surprise':None},{'User':None},{'ArgsEscaped':0},{'Healthcheck':{'Surprise':0}},{'Labels':{'x':None}}]:
   with self.assertRaises(r.Stop):r.verify_config_representation({},raw)
 def test_wrong_request_probe_is_rejected(self):
  source=(HERE/'build-probe-repair.py').read_text();self.assertIn("p.get('requestId') == REQUEST",source);self.assertNotIn("'ambientFetchCalls':0",source)
 def test_healthcheck_nonnull_empty_pointer_is_not_absence(self):
  self.assertTrue(r.verify_config_representation({'Healthcheck':{}},{'Healthcheck':{'Test':[],'Interval':0}}))
  self.assertTrue(r.verify_config_representation({}, {'Healthcheck':None}))
  with self.assertRaises(r.Stop):r.verify_config_representation({}, {'Healthcheck':{}})
  with self.assertRaises(r.Stop):r.verify_config_representation({'Healthcheck':{}}, {})
 def test_wrong_grant_rejected_before_transport(self):
  with self.assertRaises(c.Stop):c.validate_grant(b'{}',(HERE/'operations-manifest.json').read_bytes())
 def test_archive_drift_rejected(self):
  with self.assertRaises(c.Stop):c.validate_archive(b'not-approved-archive')
 def test_default_builder_required(self):
  self.assertEqual(r.parse_default_builder(b'Name: default\nDriver: docker\nNodes:\n')['Driver'],'docker')
  with self.assertRaises(r.Stop):r.parse_default_builder(b'Name: remote\nDriver: docker-container\nNodes:\n')
 def test_only_exact_notfound(self):
  cid='a'*64;self.assertTrue(r.missing_container(1,{'stdout':b'[]\n','stderr':('Error: No such object: '+cid).encode()},cid))
  self.assertFalse(r.missing_container(1,{'stdout':b'','stderr':b'permission denied'},cid))
 def test_original_raw_chain_and_cache(self):
  config={'rootfs':{'diff_ids':['sha256:'+'a'*64]*48},'config':{'User':'root','Entrypoint':['/container-server/sandbox'],'Env':['PUBLIC=synthetic']}}
  raws={};raws['config']=json.dumps(config).encode();raws['manifest']=json.dumps({'config':{'digest':'sha256:'+c.sha(raws['config']),'size':len(raws['config'])},'layers':[{}]*48}).encode();raws['index']=json.dumps({'manifests':[{'digest':'sha256:'+c.sha(raws['manifest']),'size':len(raws['manifest'])}]}).encode()
  original=c.SCOPE;c.SCOPE={**original,'baseRawRecords':{k:{'bytes':len(v),'sha256':c.sha(v)} for k,v in raws.items()}}
  base={'Id':original['baseEngineId'],'Descriptor':{'digest':original['baseEngineId'],'size':856},'Os':'linux','Architecture':'amd64','RootFS':{'Layers':config['rootfs']['diff_ids']},'Config':config['config']}
  try:
   self.assertTrue(r.verify_cached_base(base,*[raws[k] for k in ('index','manifest','config')])['launchConfigMatched'])
   base['Id']='sha256:'+'b'*64
   with self.assertRaises(r.Stop):r.verify_cached_base(base,*[raws[k] for k in ('index','manifest','config')])
  finally:c.SCOPE=original
 def test_probe_all_flags_and_targets(self):
  m=json.loads((HERE.parent/'input-manifest.json').read_text());p={'schema':'trusted-pi-native-resource-snapshot-host-probe/v1','requestId':c.SCOPE['requestId'],'mode':'image','result':'passed','manifestSha256':r.MANIFEST,'uid':10002,'gid':10002,'checkedTargets':12,'overlayTargets':1,'checks':dict.fromkeys(r.CHECKS,True),'imageTargets':[{k:x[k] for k in ('imagePath','bytes','sha256')} for x in m['fileTargets']],'realProviderRequests':0,'credentialsReadByProbe':False,'sourceMacEncodingNormalized':False,'syntheticRequests':{'model':3,'research':3,'projectToolExecutions':0,'ambientFetch':0,'sessionCreations':3,'sessionDisposals':3}}
  self.assertEqual(r.validate_probe(json.dumps(p).encode(),m)['result'],'passed')
  for key,value in [('uid',0),('realProviderRequests',1),('credentialsReadByProbe',True),('manifestSha256','0'*64),('requestId','wrong-request')]:
   q={**p,key:value}
   with self.assertRaises(r.Stop):r.validate_probe(json.dumps(q).encode(),m)
  q=copy.deepcopy(p);q['checks'][r.CHECKS[0]]=False
  with self.assertRaises(r.Stop):r.validate_probe(json.dumps(q).encode(),m)
 def test_missing_or_extra_probe_checks(self):
  with self.assertRaises(r.Stop):r.validate_probe(b'{}',{})
 def test_no_old_retry_or_credential_code(self):
  s=(HERE/'build-probe-repair.py').read_text();self.assertNotIn('verify_original_cleanup',s);self.assertNotIn("BASE in base.get('RepoDigests'",s);self.assertNotIn("['pull'",s);self.assertNotIn("['push'",s)
if __name__=='__main__':unittest.main()
