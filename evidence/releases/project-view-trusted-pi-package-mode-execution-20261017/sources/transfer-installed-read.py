#!/usr/bin/env python3
"""Fixed installed-transfer readback. No SSH, Docker, network or writes."""
import argparse,datetime as dt,hashlib,json,os,re,sys
from pathlib import Path
ROOT=Path('/tmp/riffoid-jhg46-image-20261017.AU613w/pi-package-mode-repair-v1')
REQUEST='a21af2c8-44ff-4f67-a07f-c364bcd6d295'
SCOPE_SHA='3ae7c17eb9a25876294d3ee3e94f634e218fc431238b8181ae48f2d35915d8aa'
MANIFEST_SHA='bc8e45a8783748be4db9fc8040745aa239a2a4473b89740dbc09f290add82383'
SCOPE={'archive': {'bytes': 61519, 'path': 'jhg46-pi-package-mode-repair-v1-20261017.tar.gz', 'sha256': '4ae32cf711d7500d4b0cd893757ee5a625d9b275518b86e3680146c0b7f7dcd2', 'uncompressedBytes': 256000, 'uncompressedSha256': '4e3d89ab85b86d3554d71356e096061d43d645514b633f0aa8af802ff9ba32c3'}, 'baseImage': 'registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi@sha256:9b76ab9ee7a4f31d250957fbbeefc62d71056e6bd1eb24686ebbeaff3d65873c', 'canonicalImplementationCommit': '0d23a12d869abccb9515a8e7f8196b0266258226', 'canonicalPullRequest': 'https://github.com/jihegao/riffology-cloud/pull/239', 'excluded': ['pull', 'OAuth-Registry-provider-credential-read-or-mint', 'ssh-forward', 'registry-push', 'Cloudflare-write', 'provider', 'project', 'Turn', 'Run'], 'operations': ['ssh-fixed-repair-input-and-operations-transfer-once', 'cached-base-offline-build-once', 'sdk-mock-original-cid-once-and-cleanup'], 'originalDirectory': '/tmp/riffoid-jhg46-image-20261017.AU613w/pi-resource-compat-v1', 'parentRequestId': '57a70587-2b21-4a56-aed1-09c8a32d868a', 'payload': {'EXECUTION-CONTRACT.md': {'bytes': 4031, 'sha256': '96404a60a74eb0d5e1377b7513b046517bd8ade99bfed29c6ff514dfb76e6627'}, 'context/Dockerfile': {'bytes': 1468, 'sha256': '3ef0b46a9388b9d78a1b82ceeb5c7c2ed821925982975d2a1e2f5a68411a9bb9'}, 'context/services/browser-preview/runtime/sha256.mjs': {'bytes': 2241, 'sha256': '85da435e9edaf4dca3411cf5f86fa45a95fe15c78060849d11f7eb0344b5bd24'}, 'context/services/project-resources/text.mjs': {'bytes': 6700, 'sha256': '9f7f3266549f04a0a8214e6e725ea9d85030532364f136487833e9cc45af303e'}, 'context/services/runtime/controlled-pi.mjs': {'bytes': 23072, 'sha256': 'cf4143bff6cf049d2ab8247ef86ceb5f5391da67a86acb56ea901a119b2d6871'}, 'context/services/trusted-pi/package-lock.json': {'bytes': 150262, 'sha256': 'ad20b5c766c411c5ba42a4fc997890fe3494ab8adb96cf5d75031366b3d144fc'}, 'context/services/trusted-pi/package.json': {'bytes': 244, 'sha256': '0dde532fe23b810bd09b978f990d48342f7378429f2b2c48f30e055993fa6ebe'}, 'context/services/trusted-pi/release-candidate.mjs': {'bytes': 27185, 'sha256': '034cdc9df6c09e9cd7a32320e6bbfc2f9bbf5761151fe1d585d7fd64cdcd8d07'}, 'context/services/trusted-pi/research-context.mjs': {'bytes': 1557, 'sha256': '938e89155a5d5e0c405f51db5d973a4db264e63d96e308aff8da93caaaa05076'}, 'input-manifest.json': {'bytes': 6884, 'sha256': 'f27b35dcbe84b58e3442018332374dbf20fa0d315528a322e56ea2a2bcfea5d4'}, 'probe/compatibility-probe.mjs': {'bytes': 12020, 'sha256': 'bded581766c4656b05b72c6fce39fcb43461a44cbe407c0d1e9ab4a23edf2097'}, 'repair-manifest.json': {'bytes': 3325, 'sha256': 'e668f9080b5a906c1d74b84246aa865cb458c9c1257086b21e920b32d805a84e'}}, 'permissionDestinations': 2, 'recipient': 'AMD128', 'remoteDirectory': '/tmp/riffoid-jhg46-image-20261017.AU613w/pi-package-mode-repair-v1', 'requestId': 'a21af2c8-44ff-4f67-a07f-c364bcd6d295', 'reviewOnly': True, 'runtimeDestinations': 6, 'schema': 'trusted-pi-package-permissions-operations-scope/v1', 'totalCopyDestinations': 8}
MANIFEST={'archiveSha256': '4ae32cf711d7500d4b0cd893757ee5a625d9b275518b86e3680146c0b7f7dcd2', 'canonicalImplementationCommit': '0d23a12d869abccb9515a8e7f8196b0266258226', 'files': {'EXECUTION.md': {'bytes': 6585, 'sha256': '4f2ce134078fb80e8f87a5c5e5bbf2b94fb3f0c905cfa25e9bbeb268dd4992ef'}, 'build-probe-repair.py': {'bytes': 28136, 'sha256': 'c0afbbba0277c82b27fd145c3db830c2faa9375222d77b5044b12d22116d8a81'}, 'repair_common.py': {'bytes': 3987, 'sha256': 'a1ac0f85ef63d33b434736d81473fe1db056661344a24273493ed5a825f5a6ef'}, 'scope.json': {'bytes': 3419, 'sha256': '3ae7c17eb9a25876294d3ee3e94f634e218fc431238b8181ae48f2d35915d8aa'}, 'test_repair_operations.py': {'bytes': 10388, 'sha256': 'ca30445f5161aeb5dab0a1ffce5b81288b3b6f89899c1ea66df4eba62d567401'}, 'transfer-local.py': {'bytes': 6552, 'sha256': '3acb500a50542bde15e4ee2a5bfd8445df200231a4a319e8cdfa117b3a155140'}, 'transfer-receiver.py': {'bytes': 6244, 'sha256': 'b41f428a527f93aa3e4645270e65b5b6f812f0bd1bc216975ec8183dbc4043d9'}}, 'requestId': 'a21af2c8-44ff-4f67-a07f-c364bcd6d295', 'schema': 'trusted-pi-package-permissions-operations-manifest/v1', 'sourceKernelSha256': '12a22b87f8dbab84d144dbcac0b141d050703f620a5417c0607bb5ab7a38fcd8'}
HEX=re.compile(r'^[a-f0-9]{64}$')
class Stop(Exception):pass
def guard(ok,code):
 if not ok:raise Stop(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def read(name,limit):
 p=ROOT/name
 guard(p.resolve()==p and p.is_file() and not p.is_symlink(),'fixed-regular-path-required')
 st=p.stat();guard(st.st_uid==os.getuid() and st.st_size<=limit and not st.st_mode&0o077,'private-bounded-input-required')
 b=p.read_bytes();guard(len(b)<=limit,'input-grew-beyond-bound')
 return b,{'path':name,'bytes':len(b),'sha256':sha(b),'uid':st.st_uid,'gid':st.st_gid,'modeOctal':format(st.st_mode&0o7777,'04o')}
def iso(value):
 guard(isinstance(value,str) and len(value)<=40,'bounded-time-field')
 try:v=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
 except (ValueError,TypeError):raise Stop('invalid-time-field') from None
 guard(v.tzinfo is not None,'timezone-required');return v

def observe(grant_sha):
 guard(sys.platform=='linux' and HEX.fullmatch(grant_sha or ''),'fixed-linux-and-grant-sha-required')
 guard(ROOT.is_dir() and ROOT.resolve()==ROOT and ROOT.stat().st_uid==os.getuid() and not ROOT.stat().st_mode&0o077,'private-fixed-task-directory')
 result={'schema':'trusted-pi-package-permissions-installed-readback/v1','requestId':REQUEST,'parentRequestId':SCOPE['parentRequestId'],'startedAt':utc(),'onlyRead':True,'dockerCommands':0,'networkCallsByHelper':0,'remoteFileWrites':0,'arbitraryRawJsonOrEnvReturned':False,'files':[]}
 for name,item in SCOPE['payload'].items():
  b,record=read(name,262144);guard(len(b)==item['bytes'] and sha(b)==item['sha256'],'installed-payload-drift');result['files'].append(record)
 for name,item in MANIFEST['files'].items():
  b,record=read('operations/'+name,131072);guard(len(b)==item['bytes'] and sha(b)==item['sha256'],'installed-operation-drift');result['files'].append(record)
 for name,expected,limit in [('operations/scope.json',SCOPE_SHA,32768),('operations/operations-manifest.json',MANIFEST_SHA,32768),('input.tar.gz',SCOPE['archive']['sha256'],SCOPE['archive']['bytes'])]:
  b,record=read(name,limit);guard(sha(b)==expected,'fixed-installed-identity-drift')
  if name=='input.tar.gz':guard(len(b)==SCOPE['archive']['bytes'],'installed-archive-size')
  if name!='operations/scope.json':result['files'].append(record)
 raw,gref=read('operations/human-grant.json',32768);guard(sha(raw)==grant_sha,'installed-human-grant-sha')
 g=json.loads(raw);guard(isinstance(g,dict),'human-grant-object')
 expected={'schema':'trusted-pi-package-permissions-grant/v1','approved':True,'requestId':REQUEST,'parentRequestId':SCOPE['parentRequestId'],'recipient':SCOPE['recipient'],'remoteDirectory':str(ROOT),'canonicalImplementationCommit':SCOPE['canonicalImplementationCommit'],'archiveSha256':SCOPE['archive']['sha256'],'archiveBytes':SCOPE['archive']['bytes'],'operationsManifestSha256':MANIFEST_SHA,'baseImage':SCOPE['baseImage'],'operations':SCOPE['operations'],'excluded':SCOPE['excluded']}
 guard(all(g.get(k)==v for k,v in expected.items()),'installed-specific-grant-fields-drift')
 guard(isinstance(g.get('humanReplySha256'),str) and HEX.fullmatch(g['humanReplySha256']),'human-reply-sha-required')
 start,end=iso(g.get('approvedAt')),iso(g.get('expiresAt'));guard(0<(end-start).total_seconds()<=3600,'grant-window-width')
 result['grant']={**gref,'requestId':REQUEST,'humanReplySha256':g['humanReplySha256'],'grantWindowBoundValidated':True,'currentlyInGrantWindow':start<=dt.datetime.now(dt.timezone.utc)<=end,'scopeFieldsMatch':True,'rawGrantOrHumanReplyReturned':False}
 intent,iref=read('transfer-intent.json',32768);i=json.loads(intent);guard(isinstance(i,dict) and i.get('requestId')==REQUEST and i.get('once') is True,'original-transfer-intent-identity')
 begun=iso(i.get('startedAt'));result['transferIntent']={**iref,'requestId':REQUEST,'once':True,'startedAt':begun.isoformat()}
 terminal,tref=read('transfer-result.json',32768);t=json.loads(terminal)
 guard(isinstance(t,dict) and t.get('schema')=='trusted-pi-package-permissions-transfer-result/v1' and t.get('requestId')==REQUEST and t.get('status')=='transferred-verified' and t.get('archiveSha256')==SCOPE['archive']['sha256'] and t.get('archiveBytes')==SCOPE['archive']['bytes'] and t.get('fileCount')==12 and t.get('operationsManifestSha256')==MANIFEST_SHA and t.get('humanGrantSha256')==grant_sha and t.get('unprefixedTarNames') is True and t.get('credentialReadOrTransferred') is False and t.get('dockerOrContainerCommandExecuted') is False and t.get('cloudWrite') is False,'exact-transfer-terminal-required')
 result['transferResult']={**tref,'requestId':REQUEST,'status':'transferred-verified','fileCount':12,'unprefixedTarNames':True,'credentialReadOrTransferred':False,'dockerOrContainerCommandExecuted':False,'cloudWrite':False}
 result['payloadFilesVerified']=12;result['operationFilesVerified']=7;result['fixedArchiveAndGrantVerified']=True;result['buildProbeDirectoryExists']=(ROOT/'build-probe-once').exists();result['status']='installed-transfer-identity-verified';result['endedAt']=utc()
 return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--execute-readonly',action='store_true');p.add_argument('--grant-sha256',required=True);a=p.parse_args()
 try:
  guard(a.execute_readonly,'explicit-readonly-required');v=observe(a.grant_sha256);print(json.dumps(v,sort_keys=True));return 0
 except BaseException as e:
  print(json.dumps({'requestId':REQUEST,'status':'readback-unknown','errorCode':str(e) if isinstance(e,Stop) else 'readback-local-error','dockerCommands':0,'remoteFileWrites':0}));return 1
if __name__=='__main__':sys.exit(main())
