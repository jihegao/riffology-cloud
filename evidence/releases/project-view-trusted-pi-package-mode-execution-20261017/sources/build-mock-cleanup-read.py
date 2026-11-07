#!/usr/bin/env python3
"""Fixed repair records and original-CID readback. Inert without explicit flag."""
import argparse,datetime as dt,hashlib,json,os,re,selectors,signal,subprocess,sys,time
from pathlib import Path
ROOT=Path('/tmp/riffoid-jhg46-image-20261017.AU613w/pi-package-mode-repair-v1')
RECORDS=ROOT/'build-probe-once'
REQUEST='a21af2c8-44ff-4f67-a07f-c364bcd6d295'
PARENT='57a70587-2b21-4a56-aed1-09c8a32d868a'
GRANT='bea3e26bcd34380293afbf6c17df77385652e551d1d0ab1f838c557454fed3de'
OPS='bc8e45a8783748be4db9fc8040745aa239a2a4473b89740dbc09f290add82383'
CODE='0d23a12d869abccb9515a8e7f8196b0266258226'
ARCHIVE='4ae32cf711d7500d4b0cd893757ee5a625d9b275518b86e3680146c0b7f7dcd2'
F27='f27b35dcbe84b58e3442018332374dbf20fa0d315528a322e56ea2a2bcfea5d4'
LABEL='riffology.jhg46.pi-package-permissions-operation'
BASE='registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi@sha256:9b76ab9ee7a4f31d250957fbbeefc62d71056e6bd1eb24686ebbeaff3d65873c'
DOCKER=['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config',str(RECORDS/'empty-docker-config')]
HEX=re.compile(r'^[a-f0-9]{64}$');IMAGE=re.compile(r'^sha256:[a-f0-9]{64}$')
CHECKS=['allTargetBytes', 'activeReleaseAlias', 'actualControlledPiAndProductRelease', 'explicitSkillRevisionPathAndSha', 'unselectedBodyAbsent', 'noModelSpecFixedSimulationPrompt', 'coldRestoreNoReplay', 'sameSourceHistoricalProvenance', 'newSourceDoesNotInheritLoadedMarker', 'crossProjectRejected', 'synthetic503NoRetry', 'sdkCancelAbortedAndSettled', 'allSessionsDisposed', 'temporaryDirectoryRemoved', 'environmentOnlyPath']
TARGETS=[{'imagePath': 'browser-preview/runtime/sha256.mjs', 'bytes': 2241, 'sha256': '85da435e9edaf4dca3411cf5f86fa45a95fe15c78060849d11f7eb0344b5bd24'}, {'imagePath': 'project-resources/text.mjs', 'bytes': 6700, 'sha256': '9f7f3266549f04a0a8214e6e725ea9d85030532364f136487833e9cc45af303e'}, {'imagePath': 'runtime/controlled-pi.mjs', 'bytes': 23072, 'sha256': 'cf4143bff6cf049d2ab8247ef86ceb5f5391da67a86acb56ea901a119b2d6871'}, {'imagePath': 'trusted-pi/release-candidate.mjs', 'bytes': 27185, 'sha256': '034cdc9df6c09e9cd7a32320e6bbfc2f9bbf5761151fe1d585d7fd64cdcd8d07'}, {'imagePath': 'trusted-pi/research-context.mjs', 'bytes': 1557, 'sha256': '938e89155a5d5e0c405f51db5d973a4db264e63d96e308aff8da93caaaa05076'}, {'imagePath': 'trusted-pi/trusted-pi-release.mjs', 'bytes': 27185, 'sha256': '034cdc9df6c09e9cd7a32320e6bbfc2f9bbf5761151fe1d585d7fd64cdcd8d07'}, {'imagePath': 'trusted-pi/trusted-pi-turn-host.mjs', 'bytes': 15937, 'sha256': '9964e7ab863207ce9b9a911e03bfcb4f99afc61fb6508d2d6611b66931be516b'}, {'imagePath': 'trusted-pi/product-model-transport.mjs', 'bytes': 7703, 'sha256': 'c2bece021f34f0b929e796238d132a819281d172b5d8fd3a6f431ed9d46801c6'}, {'imagePath': 'trusted-pi/product-tool-bridge.mjs', 'bytes': 11657, 'sha256': 'e536e9231a7fa41be956e3066535a62b7de460b37a4e5a40937c67d9f5981e74'}, {'imagePath': 'runtime_supervisor.py', 'bytes': 16912, 'sha256': '79e2bdedaedba063364513d853eb8325f229ba55b1e51df46cbcee359807e29c'}, {'imagePath': 'package.json', 'bytes': 244, 'sha256': '0dde532fe23b810bd09b978f990d48342f7378429f2b2c48f30e055993fa6ebe'}, {'imagePath': 'package-lock.json', 'bytes': 150262, 'sha256': 'ad20b5c766c411c5ba42a4fc997890fe3494ab8adb96cf5d75031366b3d144fc'}]
COMMANDS=('base-inspect','default-builder-inspect-plain','build-help','derived-tag-before','build-once','derived-image-inspect','probe-label-before','create-once','created-original-inspect','start-original-once','wait-original','completed-original-inspect','cleanup-label-before','cleanup-original-before','cleanup-original-remove','cleanup-original-after','cleanup-label-after')
STATUSES=('unknown-stopped','mock-image-probe-passed-cleanup-pending','offline-image-compatibility-mock-passed')
class Stop(Exception):pass
def guard(ok,code):
 if not ok:raise Stop(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def read(name,limit=262144,optional=False):
 p=RECORDS/name
 if optional and not os.path.lexists(p):return None,{'path':name,'present':False}
 guard(p.resolve()==p and p.is_file() and not p.is_symlink(),'fixed-regular-record-required')
 s=p.stat();guard(s.st_uid==os.getuid() and not s.st_mode&0o077 and s.st_size<=limit,'private-bounded-record-required')
 b=p.read_bytes();guard(len(b)<=limit,'record-grew-beyond-bound')
 return b,{'path':name,'present':True,'bytes':len(b),'sha256':sha(b)}
def obj(name,optional=False):
 b,ref=read(name,optional=optional)
 if b is None:return None,ref
 v=json.loads(b);guard(isinstance(v,dict),'record-json-object-required');return v,ref
def error_class(value):
 if value is None:return None
 if isinstance(value,str) and value.startswith(('command-nonzero-','command-unknown-or-output-discarded-')):
  prefix='command-nonzero-' if value.startswith('command-nonzero-') else 'command-unknown-or-output-discarded-'
  suffix=value[len(prefix):]
  return prefix+suffix if suffix in COMMANDS else 'unrecognized-code-withheld'
 allowed=('runner-local-error','runner-interrupted-original-identity-only','probe-mode-result','probe-all-checks','probe-all12-frozen-targets','probe-fake-only','original-exit-zero-required','original-create-ack-cid','base-derived-launch-config-must-match','derived-image-identity','derived-base-rootfs-prefix-required','immutable-cached-base-inspect','original-inspect-unknown','original-container-identity-mismatch','cleanup-local-error','original-label-conflict','original-id-not-established')
 return value if value in allowed else 'unrecognized-code-withheld'
def desc(v):
 guard(isinstance(v,dict) and isinstance(v.get('digest'),str) and IMAGE.fullmatch(v['digest']) and type(v.get('size')) is int and 0<v['size']<1048576 and v.get('mediaType') in ('application/vnd.oci.image.index.v1+json','application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.list.v2+json','application/vnd.docker.distribution.manifest.v2+json'),'descriptor-shape')
 return {k:v[k] for k in ('digest','size','mediaType')}
def ticks(pid):
 try:return Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]
 except FileNotFoundError:return None
def stream_meta(v):
 guard(isinstance(v,dict) and set(v)=={'stdout','stderr'},'two-command-streams-required');out={}
 for name,x in v.items():
  guard(isinstance(x,dict) and all(type(x.get(k)) is int and x[k]>=0 for k in ('bytesObserved','bytesSaved','discardedBytes')) and isinstance(x.get('sha256'),str) and HEX.fullmatch(x['sha256']),'command-stream-metadata')
  out[name]={k:x[k] for k in ('bytesObserved','bytesSaved','discardedBytes','sha256')}
 return out

def docker_read(name,args):
 p=None;buffers={'stdout':bytearray(),'stderr':bytearray()};identity={};failure=None;began=time.monotonic()
 try:
  p=subprocess.Popen(DOCKER+args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/local/bin:/usr/bin:/bin'},start_new_session=True)
  identity={'pid':p.pid,'linuxStartTicks':ticks(p.pid)}
  with selectors.DefaultSelector() as sel:
   for stream,label in ((p.stdout,'stdout'),(p.stderr,'stderr')):sel.register(stream,selectors.EVENT_READ,label)
   while sel.get_map():
    guard(time.monotonic()-began<15,'read-cli-timeout')
    for key,_ in sel.select(.25):
     block=os.read(key.fileobj.fileno(),16384)
     if not block:sel.unregister(key.fileobj);continue
     guard(len(buffers[key.data])+len(block)<=131072,'read-cli-output-limit');buffers[key.data].extend(block)
  p.wait(timeout=max(.1,15-(time.monotonic()-began)))
 except BaseException as e:failure=str(e) if isinstance(e,Stop) else 'read-cli-local-error'
 finally:
  if p is not None:
   for sig in (signal.SIGTERM,signal.SIGKILL):
    if p.poll() is not None:break
    try:os.killpg(p.pid,sig)
    except ProcessLookupError:pass
    except BaseException:failure='read-cli-cleanup-unconfirmed'
    try:p.wait(timeout=5)
    except BaseException:pass
   for s in (p.stdout,p.stderr):
    try:s.close()
    except BaseException:pass
  record={'name':name,**identity,'exitCode':None if p is None else p.poll(),'reaped':p is not None and p.poll() is not None,'errorCode':failure,'elapsedSeconds':round(time.monotonic()-began,3),'streams':{k:{'bytesRetained':len(v),'sha256':sha(v)} for k,v in buffers.items()}}
 return record,{k:bytes(v) for k,v in buffers.items()}

def observe(image,cid):
 guard(sys.platform=='linux' and isinstance(image,str) and IMAGE.fullmatch(image) and isinstance(cid,str) and HEX.fullmatch(cid),'fixed-linux-image-cid-required')
 guard(ROOT.resolve()==ROOT and RECORDS.resolve()==RECORDS and RECORDS.is_dir() and RECORDS.stat().st_uid==os.getuid() and not RECORDS.stat().st_mode&0o077,'private-fixed-records-required')
 result={'schema':'trusted-pi-package-permissions-build-mock-independent-readback/v1','requestId':REQUEST,'parentRequestId':PARENT,'imageId':image,'originalContainerId':cid,'startedAt':utc(),'rawLogsConfigEnvOrBodiesReturned':False,'remoteWrites':0,'newBuildCreateStartPullOrSave':False,'fileRecords':[]}
 intent,iref=obj('intent.json');result['fileRecords'].append(iref)
 guard(intent.get('requestId')==REQUEST and intent.get('parentRequestId')==PARENT and intent.get('baseImage')==BASE and intent.get('oneBuild') is True and intent.get('oneCreate') is True and intent.get('humanGrantSha256')==GRANT and intent.get('operationsManifestSha256')==OPS,'original-repair-intent-identity')
 terminal,tref=obj('result.json');result['fileRecords'].append(tref)
 guard(terminal.get('requestId')==REQUEST and terminal.get('parentRequestId')==PARENT and terminal.get('repairArchiveSha256')==ARCHIVE and terminal.get('canonicalImplementationCommit')==CODE and terminal.get('status') in STATUSES and terminal.get('imageId')==image,'original-repair-result-identity')
 result['runnerResult']={'status':terminal['status'],'errorCode':error_class(terminal.get('errorCode')),'actualImageConfigUserIsRoot':terminal.get('actualImageConfigUser')=='root','baseDerivedLaunchConfigPreserved':terminal.get('baseDerivedLaunchConfigPreserved')==['User','Entrypoint','Cmd','WorkingDir','Env']}
 cleanup,cref=obj('original-container-cleanup.json');result['fileRecords'].append(cref)
 guard(cleanup.get('originalContainerId')==cid,'cleanup-original-cid-identity')
 guard(all(cleanup.get(k) is None or type(cleanup.get(k)) is bool for k in ('cleanupConfirmed','originalIdAbsent','labelListEmpty','removeAckUnknown')),'cleanup-boolean-fields');result['runnerCleanup']={k:cleanup.get(k) for k in ('cleanupConfirmed','originalIdAbsent','labelListEmpty','removeAckUnknown')};result['runnerCleanup']['errorCode']=error_class(cleanup.get('errorCode'))
 raw,cidref=read('probe.cid',256);result['fileRecords'].append(cidref);guard(raw.decode('ascii').strip()==cid,'original-cidfile-identity')
 identity,dref=obj('derived-image-identity.json');result['fileRecords'].append(dref)
 guard(identity.get('imageId')==image,'derived-image-identity-record')
 metadata,mref=obj('build-metadata.json');result['fileRecords'].append(mref);guard(identity.get('metadata')==metadata,'recorded-build-metadata-match')
 declared=desc(metadata.get('containerimage.descriptor'));actual=desc(identity.get('descriptor'));guard(actual==declared and metadata.get('containerimage.digest')==declared['digest'],'recorded-descriptor-three-way-binding')
 config=metadata.get('containerimage.config.digest');guard(config is None or isinstance(config,str) and IMAGE.fullmatch(config),'optional-config-digest')
 iid,iidref=read('derived.iid',256);result['fileRecords'].append(iidref);iid=iid.decode('ascii').strip();guard(iid==identity.get('iidFile') and iid in ((declared['digest'],) if config is None else (declared['digest'],config)) and image in ((declared['digest'],) if config is None else (declared['digest'],config)),'recorded-iid-engine-role-binding')
 binding=identity.get('buildIdentityBinding',{});guard(isinstance(binding,dict) and binding.get('descriptorCoreMatched') is True and binding.get('baseRootfsDiffIdPrefixMatched') is True,'recorded-build-and-rootfs-binding')
 result['buildIdentity']={'iid':iid,'engineId':image,'descriptor':declared,'configDigest':config,'iidRole':'config' if config is not None and iid==config else 'descriptor','engineIdRole':'config' if config is not None and image==config else 'descriptor','descriptorCoreMatched':True,'baseRootfsDiffIdPrefixMatched':True,'baseConfigUserIsRoot':identity.get('baseConfigUser')=='root','derivedConfigUserIsRoot':identity.get('configUser')=='root','authority':'Original build and identity records; not a new image inspect or OCI export.'}
 report,pref=obj('probe-report.json',optional=True);result['fileRecords'].append(pref)
 if report is not None:
  guard(report.get('schema')=='trusted-pi-offline-compatibility-probe/v1' and report.get('mode')=='image' and report.get('result')=='passed' and report.get('manifestSha256')==F27 and report.get('imageTargets')==TARGETS,'frozen-probe-report-identity')
  guard(report.get('uid')==10002 and report.get('gid')==10002 and report.get('checkedTargets')==12 and report.get('overlayTargets')==6 and report.get('activeAliasActuallyInspected') is True and report.get('sourceEquivalentActiveRelease') is False and report.get('sourceMacEncodingNormalized') is False and isinstance(report.get('checks'),dict) and set(report['checks'])==set(CHECKS) and all(report['checks'][k] is True for k in CHECKS),'strict-image-probe-report-checks')
  guard(report.get('syntheticRequests')=={'model':3,'research':1,'projectToolExecutions':0,'ambientFetchCalls':0} and report.get('realProviderRequests')==0 and report.get('credentialsReadByProbe') is False,'fake-only-probe-report')
  result['probeReport']={'present':True,'result':'passed','mode':'image','uid':10002,'gid':10002,'checkedTargets':12,'functionalOverlayTargets':6,'permissionRepairTargets':2,'totalCopyTargets':8,'activeAliasActuallyInspected':True,'all15FrozenChecksTrue':True,'syntheticRequests':{'model':3,'research':1,'projectToolExecutions':0,'ambientFetchCalls':0},'realProviderRequests':0,'credentialsReadByProbe':False,'targetHashesAndSizesMatchFrozenManifest':True}
 else:result['probeReport']={'present':False,'sdkPassProved':False}
 result['commandLifecycles']=[]
 for name in COMMANDS:
  lifecycle,lref=obj(name+'.result.json',optional=True);result['fileRecords'].append(lref)
  if lifecycle is None:continue
  pid=lifecycle.get('originalCliPid');original_ticks=lifecycle.get('originalCliLinuxStartTicks')
  guard(type(pid) is int and pid>1 and (original_ticks is None or isinstance(original_ticks,str) and original_ticks.isdecimal()) and (lifecycle.get('exitCode') is None or type(lifecycle['exitCode']) is int) and type(lifecycle.get('originalCliReaped')) is bool,'command-lifecycle-fields')
  cli,cli_ref=obj(name+'.original-cli.json');result['fileRecords'].append(cli_ref);guard(cli.get('pid')==pid and cli.get('linuxStartTicks')==original_ticks,'original-command-pid-ticks-match')
  current=ticks(pid)
  result['commandLifecycles'].append({'name':name,'pid':pid,'linuxStartTicks':original_ticks,'exitCode':lifecycle.get('exitCode'),'recordedReaped':lifecycle['originalCliReaped'],'currentOriginalProcessAbsent':current is None or original_ticks is not None and current!=original_ticks,'errorCode':error_class(lifecycle.get('error')),'streams':stream_meta(lifecycle.get('streams'))})
  for ext in ('stdout','stderr'):
   b,record=read(name+'.'+ext,2097152 if name=='build-once' else 131072);result['fileRecords'].append(record)
   stream=lifecycle['streams'][ext];guard(record['bytes']==stream['bytesSaved'] and record['sha256']==stream['sha256'],'command-raw-bytehash-mismatch')
  _,record=read(name+'.intent.json',32768);result['fileRecords'].append(record)
 empty,_=read('empty-docker-config/config.json',256);guard(empty==b'{"auths":{}}\n','existing-empty-no-auth-docker-config')
 first,data=docker_read('independent-original-cid-inspect',['container','inspect',cid,'--format','{{json .}}'])
 notfound=first['exitCode']==1 and first['reaped'] and first['errorCode'] is None and data['stdout'].strip() in (b'',b'[]') and data['stderr'].decode('utf8','replace').strip() in ('Error: No such object: '+cid,'Error response from daemon: No such container: '+cid)
 first['exactOriginalNotFound']=notfound
 second,data=docker_read('independent-same-operation-label-list',['ps','--all','--quiet','--no-trunc','--filter','label='+LABEL+'='+REQUEST])
 label_empty=second['exitCode']==0 and second['reaped'] and second['errorCode'] is None and data['stdout'].strip()==b''
 second['sameOperationAllListEmpty']=label_empty
 result['independentDockerReads']=[first,second];result['dockerCommands']=2;result['independentOriginalCleanupConfirmed']=notfound and label_empty;result['status']='original-records-and-cleanup-readback-completed';result['endedAt']=utc()
 return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--execute-readonly',action='store_true');p.add_argument('--image-id',required=True);p.add_argument('--original-cid',required=True);a=p.parse_args()
 try:
  guard(a.execute_readonly,'explicit-readonly-required');r=observe(a.image_id,a.original_cid);print(json.dumps(r,sort_keys=True));return 0 if r['independentOriginalCleanupConfirmed'] else 1
 except BaseException as e:print(json.dumps({'requestId':REQUEST,'status':'readback-unknown','errorCode':str(e) if isinstance(e,Stop) else 'readback-local-error','remoteWrites':0,'newBuildCreateStartPullOrSave':False}));return 1
if __name__=='__main__':sys.exit(main())
