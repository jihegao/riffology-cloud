#!/usr/bin/env python3
"""New exact grant only: existing five-scope REST, one routed SSH export/push."""
import argparse,base64,datetime as dt,hashlib,json,os,re,selectors,shlex,signal,socket,subprocess,sys,time,urllib.request,urllib.error
from pathlib import Path
import pub_common as c
HERE=Path(__file__).resolve().parent;STATE=HERE/'publication-once'
OAUTH=Path('/Users/jihegao/.wrangler/config/default.toml')
EXPECTED_SCOPES={'user:read','offline_access','account:read','workers:write','workers_scripts:write'}
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def save(name,value):
 b=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode();fd=os.open(STATE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
def inputs(grant_path,grant_sha):
 c.guard(c.HEX.fullmatch(grant_sha or ''),'specific-grant-sha-required')
 g=c.read_private(grant_path,32768);c.guard(c.sha(g)==grant_sha,'specific-grant-file-sha')
 m=c.read_private(HERE/'operations-manifest.json',32768);files={n:c.read_private(HERE/n,131072) for n in c.FILES}
 c.manifest(m,files);c.grant(g,c.sha(m));return g,m,files
def oauth_after_new_grant():
 # Never called at import, preparation, or before the new exact grant validates.
 raw=c.read_private(OAUTH,1048576).decode('utf8')
 def quoted(key):
  values=re.findall(r'^'+re.escape(key)+r'\s*=\s*("[^"\n]*")\s*$',raw,re.M)
  c.guard(len(values)==1,'normal-login-config-key-shape');return json.loads(values[0])
 scope_match=re.findall(r'^scopes\s*=\s*(\[[\s\S]*?\])\s*$',raw,re.M)
 c.guard(len(scope_match)==1,'normal-login-scope-list-required');scopes=json.loads(scope_match[0])
 c.guard(isinstance(scopes,list) and len(scopes)==len(set(scopes)) and set(scopes)==EXPECTED_SCOPES,'existing-same-scope-oauth-not-confirmed-or-scope-drift')
 token=quoted('oauth_token');expiry=quoted('expiration_time');end=dt.datetime.fromisoformat(expiry.replace('Z','+00:00'))
 c.guard(isinstance(token,str) and 0<len(token)<32768 and end.tzinfo is not None
  and end>dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=120),'valid-existing-local-oauth-required')
 return token,expiry,scopes
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**k):return None
def api(token,path,method='GET',body=None):
 c.guard(path in ('/user','/accounts/'+c.SCOPE['accountId'],'/accounts/'+c.SCOPE['accountId']+'/containers/registries/registry.cloudflare.com/credentials'),'fixed-account-auth-endpoint')
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7892'}),NoRedirect())
 request=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,method=method,
  headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},data=None if body is None else json.dumps(body).encode())
 try:response=opener.open(request,timeout=30)
 except urllib.error.HTTPError as e:
  status=e.code;b=e.read(65537)
  save(('credential' if method=='POST' else 'identity')+'-http-stop.json',{'status':status,'responseBytes':len(b),'bodySha256':c.sha(b),'requestUnknownNotReplayed':True})
  raise c.Stop('auth-api-explicit-http-failure-no-retry') from None
 b=response.read(65537);c.guard(len(b)<=65536,'auth-api-body-unknown-bound');x=json.loads(b)
 c.guard(response.status==(201 if method=='POST' else 200) and x.get('success') is True,'auth-api-response-not-success')
 return x.get('result')
def ssh_config_no_inherited_forwards():
 # ClearAllForwardings=yes would also clear the explicitly requested -R.
 # Read-only evaluated configuration must therefore prove no inherited forwards.
 argv=['/usr/bin/ssh','-G','-oForwardAgent=no','-oClearAllForwardings=no','AMD128']
 p=subprocess.run(argv,stdin=subprocess.DEVNULL,capture_output=True,timeout=15,env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin'})
 c.guard(p.returncode==0 and len(p.stdout)<=131072 and len(p.stderr)<=32768,'ssh-effective-config-unavailable')
 lines=p.stdout.decode('utf8').splitlines()
 c.guard(not any(line.split(' ',1)[0] in ('localforward','remoteforward','dynamicforward') for line in lines),'inherited-ssh-forward-present')
 c.guard('forwardagent no' in lines,'ssh-agent-forwarding-not-disabled')
 return c.sha(p.stdout)
def bootstrap(files,operations_sha):
 selected={n:base64.b64encode(files[n]).decode() for n in ('scope.json','pub_common.py','oci_verify.py','remote-publication.py')}
 expected={n:c.sha(files[n]) for n in selected}
 return ("import base64,hashlib,json,sys,types\nraw="+repr(selected)+"\nexpected="+repr(expected)+"\nsource={n:base64.b64decode(b,validate=True) for n,b in raw.items()}\nassert all(hashlib.sha256(b).hexdigest()==expected[n] for n,b in source.items())\n"
  +"for name,file in [('pub_common','pub_common.py'),('oci_verify','oci_verify.py')]:\n m=types.ModuleType(name);m.__file__='/approved-memory/'+file\n if name=='pub_common':m.SCOPE_RAW=source['scope.json']\n sys.modules[name]=m;exec(compile(source[file],m.__file__,'exec'),m.__dict__)\n"
  +"sys.argv=['remote-publication.py','--execute',"+repr(operations_sha)+"]\nexec(compile(source['remote-publication.py'],'/approved-memory/remote-publication.py','exec'),{'__file__':'/approved-memory/remote-publication.py','__name__':'__main__'})\n").encode()
def stop_owned(p):
 errors=[];rc=None
 if p is None:return None,False,errors
 try:p.stdin.close()
 except BaseException:errors.append('stdin-close-unconfirmed')
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
def final_ack(events,pending):
 c.guard(not pending,'original-publication-trailing-stdout-fragment')
 ready=[x for x in events if x.get('phase')=='verified-original-awaiting-credential']
 final=[x for x in events if x.get('schema')=='trusted-pi-image-publication-result/v1']
 c.guard(len(events)==2 and len(ready)==1 and len(final)==1 and events==[ready[0],final[0]],'original-publication-final-ack-missing-duplicate-or-conflict')
 v=ready[0].get('verification',{});f=final[0]
 for key,media in (('linuxAmd64Manifest','application/vnd.oci.image.manifest.v1+json'),('config','application/vnd.oci.image.config.v1+json')):
  d=v.get(key,{});digest=d.get('digest','') if isinstance(d,dict) else ''
  c.guard(isinstance(d,dict) and d.get('mediaType')==media and isinstance(digest,str) and digest.startswith('sha256:')
   and c.HEX.fullmatch(digest[7:]) and type(d.get('size')) is int and 0<d['size']<=c.SCOPE['archiveMaximumBytes'],'original-publication-final-descriptor-fields')
 c.guard(v.get('schema')=='trusted-pi-original-oci-verification/v1' and v.get('sourceImageId')==c.SCOPE['sourceImageId']
  and v.get('originalIndex')==c.SCOPE['sourceDescriptor'] and v.get('allRawBlobHashesSizesReachable') is True
  and v.get('allRunnableDiffIdsMatched') is True and isinstance(v.get('linuxAmd64Manifest'),dict) and isinstance(v.get('config'),dict)
  and f.get('requestId')==c.SCOPE['requestId'] and f.get('sourceImageId')==c.SCOPE['sourceImageId']
  and f.get('destination')=='registry.cloudflare.com/'+c.SCOPE['repository']+':'+c.SCOPE['tag']
  and f.get('status')=='original-image-pushed-and-all-raw-registry-readback-verified'
  and f.get('actualExportAttempts')==1 and f.get('actualPushAttempts')==1
  and f.get('platformManifest')==v['linuxAmd64Manifest'] and f.get('config')==v['config']
  and f.get('credentialFilesAbsent') is True and f.get('cleanupErrors')==[] and f.get('errorCode') is None,'original-publication-final-ack-not-complete-original-success')
 return True
def execute(grant_path,grant_sha):
 g,m,files=inputs(grant_path,grant_sha);STATE.mkdir(mode=0o700) # Permanent new local attempt lock.
 save('intent.json',{'requestId':c.SCOPE['requestId'],'operationsManifestSha256':c.sha(m),'humanGrantSha256':grant_sha,'at':utc()})
 p=None;token=None;credentials=None;received=bytearray();stderr=bytearray();error=None;minted=False;sent=False;observations=[];ack=False
 try:
  token,expiry,scopes=oauth_after_new_grant()
  user=api(token,'/user');account=api(token,'/accounts/'+c.SCOPE['accountId'])
  c.guard(isinstance(user,dict) and isinstance(user.get('id'),str) and account.get('id')==c.SCOPE['accountId'],'new-login-user-account-not-confirmed')
  save('normal-login-identity-safe.json',{'requestId':c.SCOPE['requestId'],'accountId':account['id'],'userIdSha256':c.sha(user['id'].encode()),'scopes':scopes,'expiresAt':expiry,'oauthNotTransferred':True})
  config_sha=ssh_config_no_inherited_forwards();source=bootstrap(files,c.sha(m))
  argv=['/usr/bin/ssh','-T','-oBatchMode=yes','-oConnectTimeout=10','-oExitOnForwardFailure=yes','-oForwardAgent=no',
   '-oClearAllForwardings=no','-oControlMaster=no','-oControlPath=none','-oPermitLocalCommand=no',
   '-R','127.0.0.1:7897:127.0.0.1:7892','AMD128','/usr/bin/python3 -c '+shlex.quote(source.decode())]
  save('route-once-intent.json',{'requestId':c.SCOPE['requestId'],'effectiveSshConfigSha256':config_sha,'remoteBind':'127.0.0.1:7897','localProxy':'127.0.0.1:7892','forwardAgent':False,'deadlineSeconds':1500,'noInheritedForwards':True})
  p=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin'},start_new_session=True)
  save('original-ssh.json',{'pid':p.pid,'platform':'macOS','startedAt':utc(),'requestId':c.SCOPE['requestId']})
  p.stdin.write(g.rstrip(b'\n')+b'\n');p.stdin.flush();end=time.monotonic()+1500
  with selectors.DefaultSelector() as sel:
   sel.register(p.stdout,selectors.EVENT_READ,'stdout');sel.register(p.stderr,selectors.EVENT_READ,'stderr')
   pending=bytearray()
   while sel.get_map():
    c.guard(time.monotonic()<end,'original-publication-ssh-observation-timeout')
    for key,_ in sel.select(.25):
     b=os.read(key.fileobj.fileno(),16384)
     if not b:sel.unregister(key.fileobj);continue
     if key.data=='stderr':c.guard(len(stderr)+len(b)<=131072,'ssh-stderr-bound');stderr.extend(b);continue
     c.guard(len(received)+len(b)<=262144,'ssh-stdout-bound');received.extend(b);pending.extend(b)
     while b'\n' in pending:
      line,_,tail=pending.partition(b'\n');pending=bytearray(tail);event=json.loads(line)
      c.guard(event.get('requestId')==c.SCOPE['requestId'],'original-remote-event-identity')
      if event.get('phase')=='verified-original-awaiting-credential':
       c.guard(not minted and event.get('verification',{}).get('sourceImageId')==c.SCOPE['sourceImageId']
        and event.get('routeOnlyLoopbackVerified') is True and event['verification'].get('allRawBlobHashesSizesReachable') is True and event['verification'].get('allRunnableDiffIdsMatched') is True,'only-after-verified-original-mint')
       c.grant(g,c.sha(m));c.guard(dt.datetime.fromisoformat(expiry.replace('Z','+00:00'))>dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=120),'local-oauth-expired-before-one-post')
       save('credential-post-once-intent.json',{'requestId':c.SCOPE['requestId'],'at':utc(),'expirationMinutes':15,'permissions':['push','pull'],'accountScopeNotRepositoryScope':True})
       minted=True;credentials=api(token,'/accounts/'+c.SCOPE['accountId']+'/containers/registries/registry.cloudflare.com/credentials','POST',{'expiration_minutes':15,'permissions':['push','pull']})
       c.guard(isinstance(credentials,dict) and credentials.get('account_id')==c.SCOPE['accountId'] and credentials.get('registry_host')=='registry.cloudflare.com'
        and all(isinstance(credentials.get(k),str) and 0<len(credentials[k])<=32768 and '\n' not in credentials[k] and '\r' not in credentials[k] for k in ('username','password')),'new-registry-credential-shape-unknown')
       p.stdin.write((json.dumps({k:credentials[k] for k in ('username','password')})+'\n').encode());p.stdin.flush();p.stdin.close();sent=True;credentials=None;token=None
      observations.append(event)
  c.guard(p.wait(timeout=5)==0,'original-publication-ssh-nonzero')
  ack=final_ack(observations,pending)
 except BaseException as e:error=str(e) if isinstance(e,c.Stop) else 'local-publication-error'
 finally:
  credentials=None;token=None;rc,reaped,errors=stop_owned(p)
  if errors or p is not None and not reaped:error=error or 'original-ssh-stop-unconfirmed'
  if p is not None:
   for stream in (p.stdout,p.stderr):
    try:stream.close()
    except BaseException:error=error or 'original-ssh-close-unconfirmed'
  terminal={'schema':'trusted-pi-publication-local-terminal/v1','requestId':c.SCOPE['requestId'],'errorCode':error,'sshExitCode':rc,
   'originalSshReaped':reaped,'localStopErrors':errors,'remoteStoppedByLocalCleanupProved':False,'credentialPostAttempted':minted,'credentialStdinSent':sent,
   'streams':{'stdout':{'bytes':len(received),'sha256':c.sha(received)},'stderr':{'bytes':len(stderr),'sha256':c.sha(stderr)}},
   'safeRemoteEvents':observations,'finalPublicationAckVerified':ack,'independentOriginalCredentialAndRouteCleanupRequired':True,'mergeAllowed':False,'endedAt':utc()}
  save('terminal.json',terminal)
 return terminal
def main():
 p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');p.add_argument('--grant-file',required=True);p.add_argument('--grant-sha256',required=True);a=p.parse_args()
 try:
  c.guard(a.execute,'explicit-execution-required')
  def stop(*_):raise c.Stop('local-publication-interrupted')
  for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(sig,stop)
  r=execute(Path(a.grant_file).resolve(),a.grant_sha256);print(json.dumps(r,sort_keys=True));return 0 if r['errorCode'] is None and r['sshExitCode']==0 and r['finalPublicationAckVerified'] is True else 1
 except BaseException as e:print(json.dumps({'requestId':c.SCOPE['requestId'],'status':'unknown-stopped','errorCode':str(e) if isinstance(e,c.Stop) else 'local-preflight-error'}));return 1
if __name__=='__main__':sys.exit(main())
