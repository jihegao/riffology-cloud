#!/usr/bin/env python3
"""One fixed original-image export and platform push; secrets only second stdin line."""
import base64,datetime as dt,hashlib,json,os,selectors,signal,stat,subprocess,sys,time,urllib.error,urllib.request
from pathlib import Path
import pub_common as c
import oci_verify
S=c.SCOPE;ROOT=Path(S['remoteDirectory']);RECORDS=ROOT/'records'
DOCKER=['/usr/bin/docker','--host','unix:///var/run/docker.sock']
DEST='registry.cloudflare.com/'+S['repository']+':'+S['tag']
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def save(p,value):
 b=value if isinstance(value,bytes) else (json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
def ticks(pid):
 try:return Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]
 except FileNotFoundError:return None
def route_addresses():
 addresses=[]
 for file,v4 in (('/proc/net/tcp',True),('/proc/net/tcp6',False)):
  for line in Path(file).read_text().splitlines()[1:]:
   fields=line.split();address,port=fields[1].split(':')
   if int(port,16)==7897 and fields[3]=='0A':addresses.append('127.0.0.1' if v4 and address=='0100007F' else 'unexpected-address')
 return sorted(addresses)
def stop_cli(p):
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
def command(name,args,timeout,output=None,limit=131072,authenticated=False):
 config=ROOT/('temporary-auth' if authenticated else 'empty-config');argv=DOCKER+['--config',str(config)]+args
 save(RECORDS/(name+'.intent.json'),{'argv':argv,'at':utc(),'timeoutSeconds':timeout})
 p=None;data={'stdout':bytearray(),'stderr':bytearray()};error=None;identity={};out=None;written=0
 try:
  if output is not None:out=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
   env={'PATH':'/usr/local/bin:/usr/bin:/bin','DOCKER_CONFIG':str(config)},start_new_session=True)
  identity={'pid':p.pid,'linuxStartTicks':ticks(p.pid)};save(RECORDS/(name+'.original-cli.json'),identity)
  end=time.monotonic()+timeout
  with selectors.DefaultSelector() as sel:
   for f,k in ((p.stdout,'stdout'),(p.stderr,'stderr')):sel.register(f,selectors.EVENT_READ,k)
   while sel.get_map():
    c.guard(time.monotonic()<end,'cli-observation-timeout')
    for key,_ in sel.select(.25):
     b=os.read(key.fileobj.fileno(),65536)
     if not b:sel.unregister(key.fileobj);continue
     if key.data=='stdout' and out is not None:
      written+=len(b);c.guard(written<=S['archiveMaximumBytes'],'archive-output-limit')
      pending=memoryview(b)
      while pending:pending=pending[os.write(out,pending):]
     else:c.guard(len(data[key.data])+len(b)<=limit,'cli-output-limit');data[key.data].extend(b)
  p.wait(timeout=max(.1,end-time.monotonic()))
 except BaseException as e:error=str(e) if isinstance(e,c.Stop) else 'cli-local-error'
 finally:
  rc,reaped,errors=stop_cli(p)
  if errors or p is not None and not reaped:error=error or 'cli-stop-unconfirmed'
  if p is not None:
   for pipe in (p.stdout,p.stderr):
    try:pipe.close()
    except BaseException:error=error or 'cli-close-unconfirmed'
  if out is not None:
   try:os.fsync(out)
   except BaseException:error=error or 'archive-fsync-unconfirmed'
   try:os.close(out)
   except BaseException:error=error or 'archive-close-unconfirmed'
  for k,b in data.items():
   try:save(RECORDS/(name+'.'+k),bytes(b))
   except BaseException:error=error or 'cli-log-persist-unconfirmed'
  save(RECORDS/(name+'.terminal.json'),{**identity,'exitCode':rc,'reaped':reaped,'errorCode':error,'stopErrors':errors,
   'archiveBytesWritten':written,'streams':{k:{'bytes':len(b),'sha256':c.sha(b)} for k,b in data.items()},'endedAt':utc()})
 c.guard(error is None,'original-cli-unknown-'+name)
 return rc,{k:bytes(b) for k,b in data.items()}
def inspect(name):
 rc,d=command(name,['image','inspect',S['sourceImageId'],'--format','{{json .}}'],20)
 c.guard(rc==0,'source-image-inspect-failed');x=json.loads(d['stdout'])
 c.guard(x.get('Id')==S['sourceImageId'] and x.get('Os')=='linux' and x.get('Architecture')=='amd64'
  and all(x.get('Descriptor',{}).get(k)==v for k,v in S['sourceDescriptor'].items())
  and isinstance(x.get('RootFS',{}).get('Layers'),list) and len(x['RootFS']['Layers'])==S['expectedRootfsLayerCount']
  and x.get('Config',{}).get('User')=='root' and x.get('Config',{}).get('Entrypoint')==['/container-server/sandbox'],'original-0bb-source-identity')
 return x
def verify_exported_archive(before):
 p=ROOT/'original.oci.tar'
 c.guard(p.resolve()==p and not p.is_symlink(),'original-export-path-no-link')
 st=p.stat();c.guard(stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_nlink==1
  and stat.S_IMODE(st.st_mode)==0o600 and 0<st.st_size<=S['archiveMaximumBytes'],'original-export-file-identity')
 identity=(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)
 verification,raw=oci_verify.verify(p,S,before['RootFS']['Layers'])
 c.validate_verification(verification)
 after=p.stat();c.guard(identity==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'original-export-changed-during-verification')
 return verification,raw
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
def registry_get(auth,path,expected=None,size=None,allow_absent=False):
 c.guard(path.startswith(('manifests/','blobs/')) and '..' not in path,'fixed-registry-path')
 url='https://registry.cloudflare.com/v2/'+S['repository']+'/'+path
 req=urllib.request.Request(url,headers={'Authorization':'Basic '+auth,'Accept':'application/vnd.oci.image.manifest.v1+json','Accept-Encoding':'identity'},method='GET')
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7897'}),NoRedirect())
 try:response=opener.open(req,timeout=90)
 except urllib.error.HTTPError as e:
  b=e.read(8193)
  if allow_absent:
   c.guard(e.code==404 and len(b)<=8192,'tag-absence-http-unknown');x=json.loads(b);codes=[v.get('code') for v in x.get('errors',[])]
   c.guard(codes and all(v=='MANIFEST_UNKNOWN' for v in codes),'tag-absence-not-authoritative');return {'absent':True,'status':404},b''
  raise c.Stop('registry-get-http-failed') from None
 c.guard(response.status==200 and not allow_absent,'new-tag-must-be-absent-no-overwrite')
 h=hashlib.sha256();n=0;parts=[]
 while True:
  b=response.read(1048576)
  if not b:break
  n+=len(b);c.guard(size is not None and n<=size,'registry-body-oversize');h.update(b)
  if size<=1048576:parts.append(b)
 response.close();actual='sha256:'+h.hexdigest();header=response.headers.get('Docker-Content-Digest')
 c.guard(n==size and actual==expected and (header is None or header==actual),'registry-body-sha-size')
 return {'path':path,'status':200,'bytes':n,'digest':actual,'headerDigest':header},b''.join(parts)
def execute(grant_raw,operations_sha):
 c.grant(grant_raw,operations_sha);c.guard(sys.platform=='linux' and ROOT.parent.resolve()==ROOT.parent
  and ROOT.parent.is_dir() and ROOT.parent.stat().st_uid==os.getuid() and not ROOT.parent.stat().st_mode&0o022,'fixed-owned-amd-parent')
 ROOT.mkdir(mode=0o700) # Permanent task-wide attempt lock, never removed or replayed.
 RECORDS.mkdir(mode=0o700);(ROOT/'empty-config').mkdir(mode=0o700);save(ROOT/'empty-config/config.json',b'{"auths":{}}\n')
 save(ROOT/'human-grant.json',grant_raw);save(ROOT/'scope.json',c.SCOPE_RAW)
 save(RECORDS/'intent.json',{'requestId':S['requestId'],'sourceImageId':S['sourceImageId'],'destination':DEST,
  'operationsManifestSha256':operations_sha,'humanGrantSha256':c.sha(grant_raw),'supervisorPid':os.getpid(),
  'supervisorLinuxStartTicks':ticks(os.getpid()),'at':utc()})
 terminal={'schema':'trusted-pi-image-publication-result/v1','requestId':S['requestId'],'sourceImageId':S['sourceImageId'],
  'destination':DEST,'status':'unknown-stopped','actualExportAttempts':0,'actualPushAttempts':0,'noCloudApplicationGatewayPolicyOrProviderWrite':True}
 authdir=ROOT/'temporary-auth';credentials=None
 try:
  before=inspect('source-before');free=os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize
  c.guard(free>=S['archiveMaximumBytes']*2,'export-disk-headroom')
  save(RECORDS/'export-once-intent.json',{'sourceImageId':S['sourceImageId'],'output':'original.oci.tar','at':utc()})
  terminal['actualExportAttempts']=1;rc,_=command('export-once',['image','save',S['sourceImageId']],600,ROOT/'original.oci.tar')
  c.guard(rc==0,'original-export-failed');verification,raw=verify_exported_archive(before)
  terminal['actualArchiveReadVerifications']=1
  after=inspect('source-after');c.guard(after.get('RootFS')==before.get('RootFS') and all(after.get('Config',{}).get(k)==before.get('Config',{}).get(k) for k in ('User','Entrypoint','Cmd','WorkingDir','Env')),'source-changed-during-original-export')
  save(RECORDS/'raw-verification.json',verification)
  for name,b in raw.items():save(RECORDS/('raw-'+name+'.json'),b)
  c.guard(route_addresses()==['127.0.0.1'],'only-task-loopback-route-required')
  print(json.dumps({'phase':'verified-original-awaiting-credential','requestId':S['requestId'],'verification':verification,'routeOnlyLoopbackVerified':True}),flush=True)
  signal.alarm(120)
  try:line=sys.stdin.buffer.readline(65537)
  finally:signal.alarm(0)
  c.guard(line.endswith(b'\n') and len(line)<=65536,'credential-stdin-bound')
  credentials=json.loads(line);c.guard(set(credentials)=={'username','password'} and all(isinstance(v,str) and 0<len(v)<=32768 and '\n' not in v and '\r' not in v for v in credentials.values()),'credential-fields')
  auth=base64.b64encode((credentials['username']+':'+credentials['password']).encode()).decode()
  absent,_=registry_get(auth,'manifests/'+S['tag'],allow_absent=True);save(RECORDS/'remote-tag-absence.json',absent)
  authdir.mkdir(mode=0o700);save(authdir/'config.json',json.dumps({'auths':{'registry.cloudflare.com':{'auth':auth}}}).encode())
  local_rc,local_data=command('new-local-tag-before',['image','inspect',DEST],20)
  c.guard(local_rc==1 and local_data['stdout'].strip() in (b'',b'[]') and local_data['stderr'].decode('utf8','replace').strip() in ('Error: No such image: '+DEST,'Error response from daemon: No such image: '+DEST),'new-local-tag-must-be-absent')
  c.grant(grant_raw,operations_sha)
  rc,_=command('tag-original-once',['image','tag',S['sourceImageId'],DEST],30);c.guard(rc==0,'tag-original-failed')
  # Only the one push uses this temporary auth directory; no existing credential config.
  save(RECORDS/'push-once-intent.json',{'requestId':S['requestId'],'destination':DEST,'expectedManifest':verification['linuxAmd64Manifest']['digest'],'at':utc()})
  c.grant(grant_raw,operations_sha)
  terminal['actualPushAttempts']=1;rc,_=command('push-once',['image','push','--platform','linux/amd64',DEST],600,limit=2097152,authenticated=True);c.guard(rc==0,'push-terminal-nonzero')
  readbacks=[]
  for ref in (S['tag'],verification['linuxAmd64Manifest']['digest']):
   proof,b=registry_get(auth,'manifests/'+ref,verification['linuxAmd64Manifest']['digest'],len(raw['manifest']))
   c.guard(b==raw['manifest'] and proof['headerDigest']==verification['linuxAmd64Manifest']['digest'],'raw-manifest-and-header-match');readbacks.append(proof)
  for desc in [verification['config']]+verification['layers']:
   proof,b=registry_get(auth,'blobs/'+desc['digest'],desc['digest'],desc['size'])
   if desc==verification['config']:c.guard(b==raw['config'],'raw-config-equality')
   readbacks.append(proof)
  save(RECORDS/'registry-readback.json',{'requestId':S['requestId'],'readbacks':readbacks,'allRawBodiesMatchOriginal':True,'indexOrAttestationUploaded':False})
  terminal.update(status='original-image-pushed-and-all-raw-registry-readback-verified',platformManifest=verification['linuxAmd64Manifest'],config=verification['config'])
 except BaseException as e:terminal['errorCode']=str(e) if isinstance(e,(c.Stop,oci_verify.Stop)) else 'publication-local-error'
 finally:
  errors=[]
  for p in (authdir/'config.json',):
   try:p.unlink()
   except FileNotFoundError:pass
   except BaseException:errors.append('auth-file-unlink-unconfirmed')
  try:
   if authdir.exists():authdir.rmdir()
  except BaseException:errors.append('auth-directory-remove-unconfirmed')
  credentials=None
  terminal.update(credentialFilesAbsent=not os.path.lexists(authdir/'config.json'),cleanupErrors=errors,endedAt=utc())
  if errors or not terminal['credentialFilesAbsent']:terminal['status']='credential-cleanup-unknown'
  save(RECORDS/'terminal.json',terminal)
 return terminal
def main():
 c.guard(len(sys.argv)==3 and sys.argv[1]=='--execute' and c.HEX.fullmatch(sys.argv[2]),'explicit-reviewed-publication-execution-required')
 def stop(*_):raise c.Stop('publication-interrupted-original-identity-only')
 for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT,signal.SIGALRM):signal.signal(sig,stop)
 line=sys.stdin.buffer.readline(32769);c.guard(line.endswith(b'\n') and len(line)<=32768,'grant-stdin-bound')
 result=execute(line,sys.argv[2]);print(json.dumps(result,sort_keys=True));return 0 if result['status']=='original-image-pushed-and-all-raw-registry-readback-verified' else 1
if __name__=='__main__':sys.exit(main())
