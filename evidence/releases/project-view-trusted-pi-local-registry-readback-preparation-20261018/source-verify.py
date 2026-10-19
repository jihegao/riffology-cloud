#!/usr/bin/env python3
"""AMD source proof only: no remote writes, Docker, network API or credential input."""
import datetime as dt,json,os,signal,stat,sys
from pathlib import Path
import pub_common as c
import oci_verify
S=c.SCOPE;OLD=Path(S['originalDirectory']);DEST='registry.cloudflare.com/'+S['repository']+':'+S['tag']
def ticks(pid):
 try:return Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]
 except FileNotFoundError:return None

def original_absent(pid,start):
 c.guard(type(pid) is int and pid>1 and isinstance(start,str) and start.isdecimal(),'original-process-identity');return ticks(pid)!=start

def owned_dir(p):
 st=p.lstat();c.guard(p.resolve()==p and stat.S_ISDIR(st.st_mode) and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o700,'owned-original-directory')

def original_bytes(name,limit=65536):
 p=OLD/'records'/name;return c.read_private(p,limit)

def verify_original():
 owned_dir(OLD);owned_dir(OLD/'records');objects={}
 for name,entry in S['originalRecordBindings'].items():
  b=original_bytes(name);c.guard(len(b)==entry['bytes'] and c.sha(b)==entry['sha256'],'original-record-exact-byte-binding');objects[name]=json.loads(b)
 i=objects['intent.json'];t=objects['terminal.json'];v=c.validate_verification(objects['raw-verification.json'])
 c.guard(i.get('requestId')==S['requestId'] and i.get('sourceImageId')==S['sourceImageId'] and i.get('destination')==DEST and i.get('operationsManifestSha256')==S['originalOperationsManifestSha256'] and i.get('humanGrantSha256')==S['originalHumanGrantSha256'] and original_absent(i.get('supervisorPid'),i.get('supervisorLinuxStartTicks')),'original-stopped-supervisor-binding')
 c.guard(t.get('status')=='unknown-stopped' and t.get('errorCode')=='publication-local-error' and t.get('actualExportAttempts')==t.get('actualArchiveReadVerifications')==t.get('actualPushAttempts')==1 and t.get('credentialFilesAbsent') is True and t.get('cleanupErrors')==[],'original-unknown-not-overwritten')
 push=objects['push-once.terminal.json'];c.guard(push.get('exitCode')==0 and push.get('reaped') is True and push.get('errorCode') is None and push.get('stopErrors')==[] and original_absent(push.get('pid'),push.get('linuxStartTicks')),'original-push-terminal-and-process-binding')
 oldauth=OLD/'temporary-auth';c.guard(not os.path.lexists(oldauth) and not os.path.lexists(oldauth/'config.json'),'original-credential-copy-absent')
 images=[]
 for name in ('source-before','source-after'):
  raw=original_bytes(name+'.stdout',2097152);end=objects[name+'.terminal.json'];c.guard(end.get('exitCode')==0 and end.get('reaped') is True and end.get('errorCode') is None and end.get('stopErrors')==[] and end.get('streams',{}).get('stdout')=={'bytes':len(raw),'sha256':c.sha(raw)} and original_absent(end.get('pid'),end.get('linuxStartTicks')),'original-inspect-stream-hash-and-terminal')
  image=json.loads(raw);c.guard(isinstance(image,dict) and image.get('Id')==S['sourceImageId'] and image.get('Os')=='linux' and image.get('Architecture')=='amd64' and all(image.get('Descriptor',{}).get(k)==value for k,value in S['sourceDescriptor'].items()) and len(image.get('RootFS',{}).get('Layers',[]))==49 and image.get('Config',{}).get('User')=='root' and image.get('Config',{}).get('Entrypoint')==['/container-server/sandbox'],'original-source-image-chain');images.append(image)
 c.guard(images[0].get('RootFS')==images[1].get('RootFS') and images[0].get('Config')==images[1].get('Config'),'original-inspect-pair-equality')
 archive=OLD/'original.oci.tar';c.guard(archive.resolve()==archive and not archive.is_symlink(),'original-archive-no-link');st=archive.stat();c.guard(stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600 and st.st_size==S['originalArchive']['bytes'],'original-archive-stat')
 before=(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)
 signal.alarm(S['archiveRevalidationDeadlineSeconds'])
 try:reverified,raw=oci_verify.verify(archive,S,images[0]['RootFS']['Layers'])
 finally:signal.alarm(0)
 c.validate_verification(reverified);after=archive.stat();c.guard(before==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'original-archive-stable-during-revalidation')
 config=json.loads(raw['config']);c.guard(config.get('rootfs',{}).get('diff_ids')==images[0]['RootFS']['Layers'],'reverified49-diffids-to-original-inspects')
 return {'schema':'trusted-pi-original-readback-archive-revalidation/v1','requestId':S['requestId'],'operationId':S['operationId'],'originalVerificationSha256':S['verificationSourceSha256'],'archiveBytes':v['archiveBytes'],'archiveSha256':v['archiveSha256'],'originalIndex':v['originalIndex'],'platformManifest':v['linuxAmd64Manifest'],'config':v['config'],'blobCount':53,'rootfsLayerCount':49,'allRawBlobHashesSizesReachable':True,'allRunnableDiffIdsMatched':True,'archiveReadVerifications':1,'exportsAttempted':0,'originalRecordsUnmodified':True},raw

def verify_stopped_readback():
 stopped=S['stoppedReadbackSource'];directory=Path(stopped['directory']);owned_dir(directory);owned_dir(directory/'records');objects={}
 for name,entry in stopped['records'].items():
  raw=c.read_private(directory/'records'/name,131072);c.guard(len(raw)==entry['bytes'] and c.sha(raw)==entry['sha256'],'stopped-readback-original-record-byte-drift')
  if name in ('intent.json','terminal.json'):objects[name]=json.loads(raw)
 i=objects['intent.json'];t=objects['terminal.json']
 c.guard(i.get('requestId')==S['requestId'] and i.get('operationId')=='registry-readback-recovery-v1' and i.get('sourceImageId')==S['sourceImageId'] and i.get('operationsManifestSha256')==stopped['operationsManifestSha256'] and i.get('humanGrantSha256')==stopped['humanGrantSha256'] and original_absent(i.get('supervisorPid'),i.get('supervisorLinuxStartTicks')),'stopped-readback-supervisor-active-or-drifted')
 c.guard(t.get('schema')=='trusted-pi-registry-readback-recovery-result/v1' and t.get('requestId')==S['requestId'] and t.get('operationId')=='registry-readback-recovery-v1' and t.get('sourceImageId')==S['sourceImageId'] and t.get('status')=='unknown-stopped' and t.get('registryGetAttempts')==4 and t.get('registryGetProofCount')==3 and t.get('fullOriginalRegistryReadbackVerified') is False and t.get('credentialMemoryCleared') is True and t.get('cleanupErrors')==[],'stopped-readback-terminal-binding')
 return {'intentSha256':stopped['records']['intent.json']['sha256'],'terminalSha256':stopped['records']['terminal.json']['sha256'],'originalSupervisorAbsent':True,'status':'unknown-stopped','registryGetAttempts':4,'registryGetProofCount':3,'recordCount':14,'all14OriginalRecordBytehashMatched':True}

def source_signal(signum,*_):
 label='source-archive-deadline-sigalrm' if signum==signal.SIGALRM else {signal.SIGTERM:'source-external-interrupt-sigterm',signal.SIGHUP:'source-external-interrupt-sighup',signal.SIGINT:'source-external-interrupt-sigint'}.get(signum,'source-external-interrupt-other')
 raise c.Stop(label)
def main():
 try:
  c.guard(len(sys.argv)==3 and sys.argv[1]=='--verify-source-readonly' and c.HEX.fullmatch(sys.argv[2]),'fixed-source-readonly-entry')
  for sig in (signal.SIGALRM,signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(sig,source_signal)
  stopped=verify_stopped_readback();archive,raw=verify_original();raw.clear()
  result={'schema':'trusted-pi-local-registry-source-proof/v1','requestId':S['requestId'],'operationId':S['operationId'],'sourceImageId':S['sourceImageId'],'scopeSha256':c.SCOPE_SHA,'operationsManifestSha256':sys.argv[2],'originalVerificationSha256':S['verificationSourceSha256'],'archiveRevalidation':archive,'verification':c.VERIFICATION,'priorReadbackStop':stopped,'remoteWrites':0,'dockerOrRegistryCalls':0,'oauthOrRegistryCredentialReadOrReceived':False,'rawConfigEnvOrArchiveBodyReturned':False,'directSmallRawByteObjectComparisonPerformed':False,'observedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
  print(json.dumps(result,sort_keys=True));return 0
 except BaseException as e:
  print(json.dumps({'schema':'trusted-pi-local-registry-source-error/v1','requestId':S['requestId'],'operationId':S['operationId'],'errorCode':str(e) if isinstance(e,(c.Stop,oci_verify.Stop)) else 'source-readonly-error','remoteWrites':0,'dockerOrRegistryCalls':0}));return 1
if __name__=='__main__':sys.exit(main())
