#!/usr/bin/env python3
"""Fixed b093 records + at most two Docker GETs; no writes or execution replay."""
import argparse,datetime as dt,hashlib,json,os,re,selectors,signal,stat,subprocess,sys,time
from pathlib import Path
ROOT=Path('/tmp/riffoid-jhg46-image-20261017.AU613w/pi-probe-readable-v1')
RECORDS=ROOT/'mock-probe-once'
REQUEST='b0933502-20df-480a-9a91-d833f5c4358c'
PARENT='a21af2c8-44ff-4f67-a07f-c364bcd6d295'
OPS='ae0614dafe7067367703ad41a9e0ff19f25de3ab7c788b85f01c1ff5c6b4fffd'
ARCHIVE='5817ecf49cf2e3128a9695c9fb6d75182d8cd6958b815e553f571a13167e89dc'
IMAGE='sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593'
F27='f27b35dcbe84b58e3442018332374dbf20fa0d315528a322e56ea2a2bcfea5d4'
LABEL='riffology.jhg46.pi-probe-readable-operation'
HEX=re.compile(r'^[a-f0-9]{64}$');READ_COUNT=0
COMMANDS=('previous-a21-cid-inspect','previous-a21-label','cached-image-inspect','probe-label-before','create-once','created-original-inspect','start-original-once','wait-original','completed-original-inspect','cleanup-label-before','cleanup-original-before','cleanup-original-remove','cleanup-original-after','cleanup-label-after')
CHECKS=('allTargetBytes','activeReleaseAlias','actualControlledPiAndProductRelease','explicitSkillRevisionPathAndSha','unselectedBodyAbsent','noModelSpecFixedSimulationPrompt','coldRestoreNoReplay','sameSourceHistoricalProvenance','newSourceDoesNotInheritLoadedMarker','crossProjectRejected','synthetic503NoRetry','sdkCancelAbortedAndSettled','allSessionsDisposed','temporaryDirectoryRemoved','environmentOnlyPath')
TARGETS=[{'imagePath': 'browser-preview/runtime/sha256.mjs', 'bytes': 2241, 'sha256': '85da435e9edaf4dca3411cf5f86fa45a95fe15c78060849d11f7eb0344b5bd24'}, {'imagePath': 'project-resources/text.mjs', 'bytes': 6700, 'sha256': '9f7f3266549f04a0a8214e6e725ea9d85030532364f136487833e9cc45af303e'}, {'imagePath': 'runtime/controlled-pi.mjs', 'bytes': 23072, 'sha256': 'cf4143bff6cf049d2ab8247ef86ceb5f5391da67a86acb56ea901a119b2d6871'}, {'imagePath': 'trusted-pi/release-candidate.mjs', 'bytes': 27185, 'sha256': '034cdc9df6c09e9cd7a32320e6bbfc2f9bbf5761151fe1d585d7fd64cdcd8d07'}, {'imagePath': 'trusted-pi/research-context.mjs', 'bytes': 1557, 'sha256': '938e89155a5d5e0c405f51db5d973a4db264e63d96e308aff8da93caaaa05076'}, {'imagePath': 'trusted-pi/trusted-pi-release.mjs', 'bytes': 27185, 'sha256': '034cdc9df6c09e9cd7a32320e6bbfc2f9bbf5761151fe1d585d7fd64cdcd8d07'}, {'imagePath': 'trusted-pi/trusted-pi-turn-host.mjs', 'bytes': 15937, 'sha256': '9964e7ab863207ce9b9a911e03bfcb4f99afc61fb6508d2d6611b66931be516b'}, {'imagePath': 'trusted-pi/product-model-transport.mjs', 'bytes': 7703, 'sha256': 'c2bece021f34f0b929e796238d132a819281d172b5d8fd3a6f431ed9d46801c6'}, {'imagePath': 'trusted-pi/product-tool-bridge.mjs', 'bytes': 11657, 'sha256': 'e536e9231a7fa41be956e3066535a62b7de460b37a4e5a40937c67d9f5981e74'}, {'imagePath': 'runtime_supervisor.py', 'bytes': 16912, 'sha256': '79e2bdedaedba063364513d853eb8325f229ba55b1e51df46cbcee359807e29c'}, {'imagePath': 'package.json', 'bytes': 244, 'sha256': '0dde532fe23b810bd09b978f990d48342f7378429f2b2c48f30e055993fa6ebe'}, {'imagePath': 'package-lock.json', 'bytes': 150262, 'sha256': 'ad20b5c766c411c5ba42a4fc997890fe3494ab8adb96cf5d75031366b3d144fc'}]
class Stop(Exception):pass
def guard(ok,code):
 if not ok:raise Stop(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def ticks(pid):
 try:return Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]
 except FileNotFoundError:return None
def private_dir(p):
 guard(p.resolve()==p and p.is_dir() and not p.is_symlink() and p.stat().st_uid==os.getuid()
  and stat.S_IMODE(p.stat().st_mode)==0o700,'fixed-private-directory-required')
def read(name,limit=131072,optional=False):
 p=RECORDS/name
 if optional and not os.path.lexists(p):return None,{'path':name,'present':False}
 guard(p.resolve()==p and not p.is_symlink(),'fixed-record-link-rejected')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());mode=stat.S_IMODE(s.st_mode)
  guard(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and s.st_size<=limit
   and mode in ((0o600,0o644,0o664) if name=='probe.cid' else (0o600,)),'owned-bounded-record-mode-required')
  b=f.read(limit+1)
 guard(len(b)<=limit,'record-byte-limit')
 return b,{'path':name,'present':True,'bytes':len(b),'sha256':sha(b),'modeOctal':format(mode,'04o')}
def obj(name,optional=False):
 raw,ref=read(name,optional=optional)
 if raw is None:return None,ref
 v=json.loads(raw);guard(isinstance(v,dict),'fixed-record-object-required');return v,ref
def safe_error(v):
 if v is None:return None
 for prefix in ('command-nonzero-','command-unknown-or-output-discarded-'):
  if isinstance(v,str) and v.startswith(prefix):return v if v[len(prefix):] in COMMANDS else 'unrecognized-code-withheld'
 return v if v in ('runner-local-error','runner-interrupted-original-identity-only','cleanup-local-error','original-id-not-established','original-label-conflict','original-inspect-unknown','original-container-identity-mismatch','probe-mode-result','probe-all-checks','probe-all12-frozen-targets','probe-fake-only','original-exit-zero-required','original-create-ack-cid') else 'unrecognized-code-withheld'
def report_projection(p):
 guard(p.get('schema')=='trusted-pi-offline-compatibility-probe/v1' and p.get('mode')=='image'
  and p.get('result')=='passed' and p.get('manifestSha256')==F27 and p.get('imageTargets')==TARGETS,'frozen-report-identity')
 guard(p.get('uid')==10002 and p.get('gid')==10002 and p.get('checkedTargets')==12 and p.get('overlayTargets')==6
  and p.get('activeAliasActuallyInspected') is True and p.get('sourceEquivalentActiveRelease') is False
  and p.get('sourceMacEncodingNormalized') is False and isinstance(p.get('checks'),dict)
  and set(p['checks'])==set(CHECKS) and all(p['checks'][k] is True for k in CHECKS),'strict-report-checks')
 guard(p.get('syntheticRequests')=={'model':3,'research':1,'projectToolExecutions':0,'ambientFetchCalls':0}
  and p.get('realProviderRequests')==0 and p.get('credentialsReadByProbe') is False,'fake-only-report')
 return {'present':True,'schema':'trusted-pi-offline-compatibility-probe/v1','mode':'image','result':'passed',
  'manifestSha256':F27,'uid':10002,'gid':10002,'checkedTargets':12,'overlayTargets':6,'activeAliasActuallyInspected':True,
  'sourceEquivalentActiveRelease':False,'sourceMacEncodingNormalized':False,'all15FrozenChecksTrue':True,
  'imageTargets':TARGETS,'syntheticRequests':{'model':3,'research':1,'projectToolExecutions':0,'ambientFetchCalls':0},
  'realProviderRequests':0,'credentialsReadByProbe':False}
def lifecycle(name,refs):
 intent,ref=obj(name+'.intent.json',optional=True);refs.append(ref)
 suffixes=('result.json','original-cli.json','stdout','stderr')
 if intent is None:
  guard(all(not os.path.lexists(RECORDS/(name+'.'+ext)) for ext in suffixes),'orphan-command-records')
  return None
 guard(isinstance(intent.get('argv'),list) and intent['argv'][:5]==['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config',str(RECORDS/'empty-docker-config')],'original-cli-fixed-daemon-config')
 terminal,ref=obj(name+'.result.json');refs.append(ref);cli,ref=obj(name+'.original-cli.json');refs.append(ref)
 pid=terminal.get('originalCliPid');original=terminal.get('originalCliLinuxStartTicks')
 guard(type(pid) is int and pid>1 and (original is None or isinstance(original,str) and original.isdecimal())
  and cli.get('pid')==pid and cli.get('linuxStartTicks')==original,'original-cli-pid-ticks-binding')
 current=ticks(pid);absent=current is None or original is not None and current!=original
 guard(terminal.get('originalCliReaped') is True and type(terminal.get('exitCode')) is int
  and terminal.get('error') is None and absent,'original-cli-terminal-unknown-or-active')
 streams=terminal.get('streams');guard(isinstance(streams,dict) and set(streams)=={'stdout','stderr'},'original-cli-stream-set')
 projected={}
 for stream in ('stdout','stderr'):
  b,ref=read(name+'.'+stream);refs.append(ref);s=streams[stream]
  guard(isinstance(s,dict) and type(s.get('bytesObserved')) is int and type(s.get('bytesSaved')) is int
   and s.get('bytesObserved')==s.get('bytesSaved')==len(b) and s.get('discardedBytes')==0
   and s.get('sha256')==sha(b),'original-cli-stream-bytehash-or-unknown')
  projected[stream]={'bytes':len(b),'sha256':sha(b)}
 return {'name':name,'pid':pid,'linuxStartTicks':original,'exitCode':terminal['exitCode'],
  'recordedReaped':True,'currentOriginalProcessAbsent':True,'streams':projected}
def stop_owned(p):
 errors=[];rc=None
 if p is None:return None,False,errors
 for sig in (signal.SIGTERM,signal.SIGKILL):
  try:rc=p.poll()
  except BaseException:errors.append('poll-unconfirmed')
  if rc is not None:return rc,True,errors
  try:os.killpg(p.pid,sig)
  except ProcessLookupError:pass
  except BaseException:errors.append('signal-unconfirmed')
  try:rc=p.wait(timeout=5)
  except subprocess.TimeoutExpired:pass
  except BaseException:errors.append('wait-unconfirmed')
  if rc is not None:return rc,True,errors
 try:rc=p.poll()
 except BaseException:errors.append('final-poll-unconfirmed')
 return rc,rc is not None,errors
def docker_read(kind,cid):
 global READ_COUNT
 guard(HEX.fullmatch(cid or '') and kind in ('original-id','original-label') and READ_COUNT<2,'only-fixed-two-docker-gets')
 args=['container','inspect',cid,'--format','{{json .}}'] if kind=='original-id' else ['ps','--all','--quiet','--no-trunc','--filter','label='+LABEL+'='+REQUEST]
 READ_COUNT+=1;p=None;buffers={'stdout':bytearray(),'stderr':bytearray()};identity={};error=None;began=time.monotonic()
 try:
  argv=['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config',str(RECORDS/'empty-docker-config')]+args
  p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/local/bin:/usr/bin:/bin'},start_new_session=True)
  identity={'pid':p.pid,'linuxStartTicks':ticks(p.pid)}
  with selectors.DefaultSelector() as sel:
   for stream,label in ((p.stdout,'stdout'),(p.stderr,'stderr')):sel.register(stream,selectors.EVENT_READ,label)
   while sel.get_map():
    guard(time.monotonic()-began<15,'readonly-cli-timeout')
    for key,_ in sel.select(.25):
     block=os.read(key.fileobj.fileno(),16384)
     if not block:sel.unregister(key.fileobj);continue
     guard(len(buffers[key.data])+len(block)<=131072,'readonly-cli-output-limit');buffers[key.data].extend(block)
  p.wait(timeout=max(.1,15-(time.monotonic()-began)))
 except BaseException as e:error=str(e) if isinstance(e,Stop) else 'readonly-cli-local-error'
 finally:
  rc,reaped,stop_errors=stop_owned(p)
  if p is not None:
   for stream in (p.stdout,p.stderr):
    try:stream.close()
    except BaseException:stop_errors.append('pipe-close-unconfirmed')
  if stop_errors or p is not None and not reaped:error=error or 'readonly-cli-stop-unconfirmed'
 result={'kind':kind,**identity,'exitCode':rc,'reaped':reaped,'errorCode':error,'localStopErrors':stop_errors,
  'remoteContainerStoppedByCliCleanupProved':False,'streams':{k:{'bytes':len(v),'sha256':sha(v)} for k,v in buffers.items()}}
 return result,{k:bytes(v) for k,v in buffers.items()}
def observe(grant_sha):
 global READ_COUNT
 READ_COUNT=0
 guard(sys.platform=='linux' and HEX.fullmatch(grant_sha or ''),'fixed-linux-specific-grant-required')
 private_dir(ROOT);private_dir(RECORDS);private_dir(RECORDS/'empty-docker-config')
 refs=[]
 intent,ref=obj('intent.json');refs.append(ref)
 guard(intent.get('requestId')==REQUEST and intent.get('parentRequestId')==PARENT and intent.get('imageId')==IMAGE
  and intent.get('oneBuild') is False and intent.get('oneCreate') is True
  and intent.get('humanGrantSha256')==grant_sha and intent.get('operationsManifestSha256')==OPS,'fixed-b093-intent')
 terminal,ref=obj('result.json');refs.append(ref)
 guard(terminal.get('schema')=='trusted-pi-probe-readable-result/v1' and terminal.get('requestId')==REQUEST
  and terminal.get('parentRequestId')==PARENT and terminal.get('imageId')==IMAGE and terminal.get('archiveSha256')==ARCHIVE
  and terminal.get('buildPullPushExportPerformed') is False and terminal.get('noCloudOrProviderAcceptanceClaim') is True
  and terminal.get('status') in ('unknown-stopped','mock-image-probe-passed-cleanup-pending','offline-image-compatibility-mock-passed'),'fixed-b093-terminal')
 raw,ref=read('probe.cid',256);refs.append(ref);cid=raw.decode('ascii').strip();guard(HEX.fullmatch(cid),'exact-original-cid')
 cleanup,ref=obj('original-container-cleanup.json');refs.append(ref)
 guard(cleanup.get('originalContainerId')==cid and isinstance(terminal.get('cleanup'),dict)
  and terminal['cleanup']==cleanup and all(cleanup.get(k) is None or type(cleanup[k]) is bool for k in ('cleanupConfirmed','originalIdAbsent','labelListEmpty','removeAckUnknown')),'original-cleanup-cid-binding')
 identity,ref=obj('cached-image-identity.json');refs.append(ref)
 guard(identity==terminal.get('cachedImageIdentity') and identity.get('engineId')==IMAGE and identity.get('engineIdRole')=='descriptor'
  and identity.get('descriptor')=={'digest':IMAGE,'mediaType':'application/vnd.oci.image.index.v1+json','size':856}
  and identity.get('launchConfigMatched') is True and identity.get('rootfsMatched') is True
  and type(identity.get('rootfsLayerCount')) is int and 0<identity['rootfsLayerCount']<128
  and identity.get('registryReadbackOrPublicationClaim') is False,'fixed-cached-image-identity')
 report,ref=obj('probe-report.json',optional=True);refs.append(ref)
 projected_report=report_projection(report) if report is not None else {'present':False,'sdkPassProved':False}
 guard(terminal['status']!='offline-image-compatibility-mock-passed' or report is not None
  and cleanup.get('cleanupConfirmed') is True,'passed-terminal-needs-report-and-cleanup')
 lifecycles=[]
 for name in COMMANDS:
  x=lifecycle(name,refs)
  if x is not None:lifecycles.append(x)
 guard(any(x['name']=='create-once' for x in lifecycles),'original-create-lifecycle-required')
 empty,ref=read('empty-docker-config/config.json',256);refs.append(ref);guard(empty==b'{"auths":{}}\n','only-existing-empty-no-auth-docker-config')
 result={'schema':'trusted-pi-probe-readable-independent-readback/v1','requestId':REQUEST,'parentRequestId':PARENT,
  'imageId':IMAGE,'localEngineIdRole':'descriptor','registryReadbackOrPublicationClaim':False,'originalContainerId':cid,
  'startedAt':utc(),'runnerStatus':terminal['status'],'runnerErrorCode':safe_error(terminal.get('errorCode')),
  'runnerCleanup':{k:cleanup.get(k) for k in ('cleanupConfirmed','originalIdAbsent','labelListEmpty','removeAckUnknown')},
  'probeReport':projected_report,'commandLifecycles':lifecycles,'fileRecords':refs,'rawEnvInspectStderrGrantOrBodyReturned':False,
  'remoteWrites':0,'newBuildCreateStartPullPushExportAuthOrCloudWrite':False}
 first,data=docker_read('original-id',cid)
 guard(first.get('reaped') is True and first.get('errorCode') is None,'independent-id-read-unknown')
 notfound=first.get('exitCode')==1 and data['stdout'].strip() in (b'',b'[]') and data['stderr'].decode('utf8','replace').strip() in ('Error: No such object: '+cid,'Error response from daemon: No such container: '+cid)
 if not notfound:
  guard(first.get('exitCode')==0,'independent-id-read-unrecognized')
  actual=json.loads(data['stdout']);guard(isinstance(actual,dict) and actual.get('Id')==cid and actual.get('Image')==IMAGE
   and actual.get('Config',{}).get('Labels',{}).get(LABEL)==REQUEST,'independent-id-identity-unknown')
  state=actual.get('State',{});guard(type(state.get('Running')) is bool and state.get('Status') in ('created','running','paused','restarting','removing','exited','dead'),'independent-id-state-unknown')
  first['originalState']={'running':state['Running'],'status':state['Status']}
 first['exactOriginalNotFound']=notfound
 second,data=docker_read('original-label',cid)
 guard(second.get('exitCode')==0 and second.get('reaped') is True and second.get('errorCode') is None,'independent-label-read-unknown')
 ids=data['stdout'].decode('ascii').splitlines();guard(len(ids)<=1 and all(HEX.fullmatch(x) for x in ids)
  and ids in ([],[cid]),'independent-label-conflict')
 second['sameOperationAllListEmpty']=not ids
 result.update(independentDockerReads=[first,second],dockerCommands=READ_COUNT,independentOriginalCleanupConfirmed=notfound and not ids,
  status='original-records-and-cleanup-readback-completed',endedAt=utc())
 return result
def main():
 p=argparse.ArgumentParser();p.add_argument('--execute-readonly',action='store_true');p.add_argument('--grant-sha256',required=True);a=p.parse_args()
 try:
  guard(a.execute_readonly,'explicit-readonly-required');r=observe(a.grant_sha256);print(json.dumps(r,sort_keys=True));return 0 if r['independentOriginalCleanupConfirmed'] else 1
 except BaseException as e:
  print(json.dumps({'schema':'trusted-pi-probe-readable-independent-readback/v1','requestId':REQUEST,'status':'readback-unknown',
   'errorCode':str(e) if isinstance(e,Stop) else 'readback-local-error','dockerCommands':READ_COUNT,'remoteWrites':0,
   'newBuildCreateStartPullPushExportAuthOrCloudWrite':False,'rawEnvInspectStderrGrantOrBodyReturned':False},sort_keys=True));return 1
if __name__=='__main__':sys.exit(main())
