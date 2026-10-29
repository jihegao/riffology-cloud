#!/usr/bin/env python3
"""Read original archive and 52 fixed Registry bodies; never run Docker or replay push."""
import base64,datetime as dt,hashlib,http.client,json,os,signal,socket,ssl,stat,sys,time,urllib.error,urllib.request
from pathlib import Path
import pub_common as c
import oci_verify
S=c.SCOPE;OLD=Path(S['originalDirectory']);ROOT=Path(S['remoteDirectory']);R=ROOT/'records'
DEST='registry.cloudflare.com/'+S['repository']+':'+S['tag']
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def save(name,value):
 b=value if isinstance(value,bytes) else (json.dumps(value,sort_keys=True,indent=2)+'\n').encode();fd=os.open(R/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
def ticks(pid):
 try:return Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]
 except FileNotFoundError:return None
def original_absent(pid,start):
 c.guard(type(pid) is int and pid>1 and isinstance(start,str) and start.isdecimal(),'original-process-identity');return ticks(pid)!=start
def owned_dir(p):
 st=p.lstat();c.guard(p.resolve()==p and stat.S_ISDIR(st.st_mode) and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o700,'owned-original-directory')
def original_bytes(name,limit=65536):
 p=OLD/'records'/name;return c.read_private(p,limit)
def route_addresses():
 result=[]
 for file,v4 in (('/proc/net/tcp',True),('/proc/net/tcp6',False)):
  for line in Path(file).read_text().splitlines()[1:]:
   parts=line.split();addr,port=parts[1].split(':')
   if int(port,16)==7897 and parts[3]=='0A':result.append('127.0.0.1' if v4 and addr=='0100007F' else 'unexpected-address')
 return sorted(result)
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
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
def error_class(e):
 for kind,label in ((urllib.error.HTTPError,'HTTPError'),(TimeoutError,'TimeoutError'),(urllib.error.URLError,'URLError'),(http.client.IncompleteRead,'IncompleteRead'),(ssl.SSLError,'SSLError'),(ConnectionError,'ConnectionError'),(OSError,'OSError'),(ValueError,'ValueError'),(c.Stop,'ScopeGuard')):
  if isinstance(e,kind):return label
 return 'OtherError'
def remaining(deadline):
 left=deadline-time.monotonic();c.guard(left>0,'registry-total-deadline');return left
def read_slot(slot,auth,raw,deadline,opener=None):
 number=slot['slot'];d=slot['descriptor'];prefix='get-%02d'%number;started=utc();remaining(deadline)
 save(prefix+'.intent.json',{'schema':'trusted-pi-registry-get-intent/v1','requestId':S['requestId'],'operationId':S['operationId'],'slot':number,'path':slot['path'],'expectedDescriptor':d,'at':started,'retryAllowed':False})
 h=hashlib.sha256();count=0;status=None;response=None;closed=False;complete=False;phase='open';failure=None;klass=None;headerMatches=None;smallEquals=None;parts=[];success=False
 try:
  request=urllib.request.Request('https://registry.cloudflare.com/v2/'+S['repository']+'/'+slot['path'],headers={'Authorization':'Basic '+auth,'Accept':'application/vnd.oci.image.manifest.v1+json','Accept-Encoding':'identity'},method='GET')
  opener=opener or urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7897'}),NoRedirect())
  try:response=opener.open(request,timeout=min(30,remaining(deadline)))
  except urllib.error.HTTPError as e:response=e;status=e.code;raise
  status=response.status;c.guard(status==200,'registry-http-status-not200');phase='read'
  while True:
   remaining(deadline);b=response.read(65536)
   if not b:complete=True;break
   count+=len(b);h.update(b);c.guard(count<=d['size'],'registry-body-oversize')
   if slot['smallRawKind'] is not None:parts.append(b)
  phase='validate';c.guard(count==d['size'] and 'sha256:'+h.hexdigest()==d['digest'],'registry-body-size-or-sha')
  header=response.headers.get('Docker-Content-Digest');headerMatches=header==d['digest'] if number<2 else header is None or header==d['digest'];c.guard(headerMatches,'registry-content-digest-header')
  if slot['smallRawKind'] is not None:smallEquals=b''.join(parts)==raw[slot['smallRawKind']];c.guard(smallEquals,'registry-small-raw-equality')
  remaining(deadline);phase='complete';success=True
 except BaseException as e:
  failure=str(e) if isinstance(e,c.Stop) else 'registry-read-failed';klass=error_class(e)
  if isinstance(e,urllib.error.HTTPError):
   # Error body stays memory-only. Only captured length/hash/completeness are persisted.
   phase='http-error-body'
   try:
    while True:
     remaining(deadline);b=e.read(min(65536,65537-count))
     if not b:complete=True;break
     count+=len(b);h.update(b)
     if count>65536:complete=False;break
   except BaseException:complete=False
 finally:
  parts.clear()
  if response is not None:
   try:response.close();closed=True
   except BaseException:failure=failure or 'registry-response-close-unconfirmed';klass=klass or 'OtherError';success=False
  terminal={'schema':'trusted-pi-registry-get-terminal/v1','requestId':S['requestId'],'operationId':S['operationId'],'slot':number,'path':slot['path'],'expectedDescriptor':d,'httpStatus':status,'capturedBytes':count,'capturedSha256':h.hexdigest(),'responseCaptureComplete':complete,'responseClosed':closed,'phase':phase,'exceptionClass':klass,'errorCode':failure,'manifestOrBlobHeaderMatches':headerMatches,'smallRawEqualityPassed':smallEquals,'proofAccepted':success,'startedAt':started,'endedAt':utc(),'rawBodyHeadersErrorTextOrAuthPersisted':False}
  save(prefix+'.terminal.json',terminal)
 if not success:raise c.Stop('original-registry-readback-slot-failed-no-retry')
 proof={'schema':'trusted-pi-registry-get-proof/v1','requestId':S['requestId'],'operationId':S['operationId'],'slot':number,'path':slot['path'],'status':200,'bytes':count,'digest':'sha256:'+h.hexdigest(),'headerMatches':True,'smallRawEqualityPassed':smallEquals,'terminalSha256':c.sha((R/(prefix+'.terminal.json')).read_bytes())}
 save(prefix+'.proof.json',proof);return proof

def execute(grant_raw,operations_sha):
 grant=c.grant(grant_raw,operations_sha);c.guard(sys.platform=='linux' and ROOT.parent==OLD,'fixed-original-root-child')
 owned_dir(OLD);owned_dir(OLD/'records');ROOT.mkdir(mode=0o700);R.mkdir(mode=0o700) # New audit phase only. Never remove or reuse.
 save('intent.json',{'schema':'trusted-pi-registry-readback-recovery-intent/v1','requestId':S['requestId'],'parentRequestId':S['parentRequestId'],'operationId':S['operationId'],'sourceImageId':S['sourceImageId'],'destination':DEST,'operationsManifestSha256':operations_sha,'humanGrantSha256':c.sha(grant_raw),'originalHumanGrantSha256':S['originalHumanGrantSha256'],'originalOperationsManifestSha256':S['originalOperationsManifestSha256'],'supervisorPid':os.getpid(),'supervisorLinuxStartTicks':ticks(os.getpid()),'at':utc()})
 terminal={'schema':'trusted-pi-registry-readback-recovery-result/v1','requestId':S['requestId'],'operationId':S['operationId'],'sourceImageId':S['sourceImageId'],'destination':DEST,'status':'unknown-stopped','registryGetAttempts':0,'registryGetProofCount':0,'exportsAttempted':0,'pushesAttempted':0,'dockerCommands':0,'credentialFilesWritten':0,'credentialMemoryCleared':False,'cleanupErrors':[],'errorCode':None}
 credentials=None;auth=None;proofs=[];raw={}
 try:
  archive_proof,raw=verify_original();save('archive-revalidation.json',archive_proof)
  c.guard(route_addresses()==['127.0.0.1'],'only-owned-loopback-route-required')
  print(json.dumps({'phase':'verified-original-readback-awaiting-pull-credential','requestId':S['requestId'],'operationId':S['operationId'],'archiveRevalidation':archive_proof,'routeOnlyLoopbackVerified':True}),flush=True)
  signal.alarm(120)
  try:line=sys.stdin.buffer.readline(65537)
  finally:signal.alarm(0)
  c.guard(line.endswith(b'\n') and len(line)<=65536,'credential-stdin-bound');credentials=json.loads(line);line=None
  c.guard(set(credentials)=={'username','password'} and all(isinstance(v,str) and 0<len(v)<=32768 and '\n' not in v and '\r' not in v for v in credentials.values()),'pull-credential-shape')
  auth=base64.b64encode((credentials['username']+':'+credentials['password']).encode()).decode();credentials=None
  deadline=time.monotonic()+S['registryGetDeadlineSeconds'];signal.alarm(S['registryGetDeadlineSeconds'])
  try:
   for slot in c.slots():
    c.grant(grant_raw,operations_sha);remaining(deadline);terminal['registryGetAttempts']+=1;proofs.append(read_slot(slot,auth,raw,deadline));terminal['registryGetProofCount']=len(proofs)
  finally:signal.alarm(0)
  readbacks={'schema':'trusted-pi-original-registry-readback-complete/v1','requestId':S['requestId'],'operationId':S['operationId'],'sourceImageId':S['sourceImageId'],'platformManifest':S['expectedPlatformManifest'],'config':S['expectedConfig'],'originalVerificationSha256':S['verificationSourceSha256'],'proofs':proofs,'all52RawBodiesMatchOriginal':True,'indexOrAttestationUploadAttempted':False,'newPushAttempted':False}
  save('registry-readback.json',readbacks);terminal.update(status='all52-original-registry-readbacks-verified',platformManifest=S['expectedPlatformManifest'],config=S['expectedConfig'],readbackProofSha256=c.sha((R/'registry-readback.json').read_bytes()))
 except BaseException as e:terminal['errorCode']=str(e) if isinstance(e,(c.Stop,oci_verify.Stop)) else 'registry-readback-local-error'
 finally:
  credentials=None;auth=None;raw.clear();terminal.update(credentialMemoryCleared=True,endedAt=utc(),originalRecordsLocksArchiveAndTagUnmodified=True,fullOriginalRegistryReadbackVerified=terminal['status']=='all52-original-registry-readbacks-verified');save('terminal.json',terminal)
 return terminal

def main():
 c.guard(len(sys.argv)==3 and sys.argv[1]=='--execute' and c.HEX.fullmatch(sys.argv[2]),'explicit-readback-execution-required')
 def interrupted(*_):raise c.Stop('readback-original-identity-interrupted')
 for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT,signal.SIGALRM):signal.signal(sig,interrupted)
 raw=sys.stdin.buffer.readline(32769);c.grant_wire(raw);result=execute(raw,sys.argv[2]);print(json.dumps(result,sort_keys=True));return 0 if result['status']=='all52-original-registry-readbacks-verified' and result['credentialMemoryCleared'] is True else 1
if __name__=='__main__':sys.exit(main())
