#!/usr/bin/env python3
"""One local-only full Registry readback; source SSH has no route or credential."""
import argparse,ast,base64,datetime as dt,hashlib,http.client,io,json,os,re,selectors,signal,socket,ssl,subprocess,sys,time,urllib.request,urllib.error
from pathlib import Path
import pub_common as c
HERE=Path(__file__).resolve().parent;STATE=HERE/'local-readback-once';R=STATE/'records'
OAUTH=Path('/Users/jihegao/.wrangler/config/default.toml');EXPECTED_SCOPES=set(c.SCOPE['oauthPolicy']['expectedScopes'])
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def save(name,value):
 raw=value if isinstance(value,bytes) else (json.dumps(value,sort_keys=True,indent=2)+'\n').encode();fd=os.open(STATE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
def record(name,value):save('records/'+name,value)
def grant_wire(raw):return c.grant_wire(raw)
def inputs(grant_path,grant_sha):
 c.guard(c.HEX.fullmatch(grant_sha or ''),'specific-grant-sha-required');g=c.read_private(grant_path,32768);c.guard(c.sha(g)==grant_sha,'specific-grant-file-sha');wire=grant_wire(g)
 m=c.read_private(HERE/'operations-manifest.json',32768);files={n:c.read_private(HERE/n,131072) for n in c.FILES};additional={n:c.read_private(HERE/n,131072) for n in c.ADDITIONAL_FILES};c.manifest(m,files,additional);c.grant(wire,c.sha(m));c.guard(str(HERE)==c.SCOPE['localExecutionDirectory'],'fixed-new-local-phase');return wire,m,{**files,'verification-source.json':additional['verification-source.json']}
def oauth_metadata_after_new_grant(allow_expired=False):
 # Only after the new exact grant. No token/config content is persisted; expiry may precede the single normal refresh.
 raw=c.read_private(OAUTH,1048576).decode('utf8')
 def quoted(key):
  values=re.findall(r'^'+re.escape(key)+r'\s*=\s*("[^"\n]*")\s*$',raw,re.M)
  c.guard(len(values)==1,'normal-login-config-key-shape');return json.loads(values[0])
 scope_match=re.findall(r'^scopes\s*=\s*(\[[\s\S]*?\])\s*$',raw,re.M)
 c.guard(len(scope_match)==1,'normal-login-scope-list-required');scopes=json.loads(scope_match[0])
 c.guard(isinstance(scopes,list) and len(scopes)==len(set(scopes)) and set(scopes)==EXPECTED_SCOPES,'existing-same-scope-oauth-not-confirmed-or-scope-drift')
 expiry=quoted('expiration_time');end=dt.datetime.fromisoformat(expiry.replace('Z','+00:00'))
 c.guard(end.tzinfo is not None and (allow_expired or end>dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=120)),'fresh-six-scope-local-oauth-required')
 return expiry,scopes

def normal_wrangler_memory(args,name,timeout):
 c.guard(args==['auth','token','--json','--profile','default'],'only-fixed-normal-token-command-no-login')
 policy=c.SCOPE['oauthPolicy'];cli=Path(policy['wranglerCliPath'])
 c.guard(c.sha(cli.read_bytes())==policy['wranglerCliSha256'],'pinned-wrangler-cli-source-drift')
 env={k:os.environ[k] for k in ('PATH','HOME','TMPDIR') if k in os.environ}
 env.update(CI='true',WRANGLER_WRITE_LOGS='false',WRANGLER_SEND_METRICS='false',WRANGLER_NO_SKILLS_UPDATE_PROMPTS='true',HTTPS_PROXY='http://127.0.0.1:7892',HTTP_PROXY='http://127.0.0.1:7892')
 argv=[policy['nodeExecutable'],'--no-warnings',str(cli)]+args+['--env-file','/dev/null']
 save(name+'-intent.json',{'argv':argv,'at':utc(),'diskLogs':False,'stdoutAndStderr':'memory-only','timeoutSeconds':timeout})
 p=None;out=bytearray();err=bytearray();failure=None
 try:
  p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,start_new_session=True)
  save(name+'-original-cli.json',{'pid':p.pid,'startedAt':utc()});end=time.monotonic()+timeout
  with selectors.DefaultSelector() as sel:
   sel.register(p.stdout,selectors.EVENT_READ,'stdout');sel.register(p.stderr,selectors.EVENT_READ,'stderr')
   while sel.get_map():
    c.guard(time.monotonic()<end,'normal-oauth-cli-timeout-no-retry')
    for key,_ in sel.select(.25):
     b=os.read(key.fileobj.fileno(),16384)
     if not b:sel.unregister(key.fileobj);continue
     target=out if key.data=='stdout' else err;c.guard(len(target)+len(b)<=262144,'normal-oauth-cli-memory-bound');target.extend(b)
  c.guard(p.wait(timeout=5)==0,'normal-oauth-cli-failed-no-retry')
 except BaseException as e:failure=str(e) if isinstance(e,c.Stop) else 'normal-oauth-cli-error'
 finally:
  rc,reaped,errors=stop_owned(p)
  if p is not None:
   for pipe in (p.stdout,p.stderr):
    try:pipe.close()
    except BaseException:failure=failure or 'normal-oauth-cli-close-unconfirmed'
  save(name+'-terminal.json',{'exitCode':rc,'originalReaped':reaped,'stopErrors':errors,'errorCode':failure,'outputPersisted':False,'stdoutBytes':len(out),'stderrBytes':len(err)})
 c.guard(failure is None and rc==0 and reaped and not errors,'normal-oauth-cli-unconfirmed-no-fallback')
 return bytes(out)

def oauth_after_new_grant():
 # Fixed installed auth-token handler refreshes an expired token once; it has no login fallback.
 oauth_metadata_after_new_grant(allow_expired=True) # Exact existing six scopes before the CLI can refresh.
 b=normal_wrangler_memory(['auth','token','--json','--profile','default'],'oauth-token-once',30)
 x=json.loads(b);c.guard(isinstance(x,dict) and set(x)=={'type','token'} and x['type']=='oauth'
  and isinstance(x['token'],str) and 0<len(x['token'])<32768,'normal-oauth-token-shape')
 expiry,scopes=oauth_metadata_after_new_grant();return x['token'],expiry,scopes

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**k):return None

def http_metadata(status,b,complete,closed):
 codes=[];parsed=None
 if complete:
  try:parsed=json.loads(b)
  except (ValueError,TypeError):pass
 if isinstance(parsed,dict) and isinstance(parsed.get('errors'),list):
  codes=[v['code'] for v in parsed['errors'][:10] if isinstance(v,dict) and type(v.get('code')) is int and 1000<=v['code']<=2147483647]
 return {'status':status,'capturedResponseBytes':len(b),'capturedResponseSha256':c.sha(b),'responseCaptureComplete':complete,
  'responseClosed':closed,'serviceErrorCodes':codes,'responseBodyOrMessagePersisted':False},parsed

def api(token,path,method='GET',body=None):
 c.guard(path in ('/user','/accounts/'+c.SCOPE['accountId'],'/accounts/'+c.SCOPE['accountId']+'/containers/registries/registry.cloudflare.com/credentials'),'fixed-account-auth-endpoint')
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7892'}),NoRedirect())
 request=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,method=method,
  headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},data=None if body is None else json.dumps(body).encode())
 prefix='credential' if method=='POST' else 'identity'
 try:response=opener.open(request,timeout=30)
 except urllib.error.HTTPError as e:
  b=b'';complete=False;closed=False
  try:b=e.read(65537);complete=len(b)<=65536
  except BaseException:pass
  try:e.close();closed=True
  except BaseException:pass
  safe,_=http_metadata(e.code,b,complete,closed);safe['requestUnknownNotReplayed']=True
  save(prefix+'-http-response.json',safe);raise c.Stop('auth-api-explicit-http-failure-no-retry') from None
 b=b'';complete=False;closed=False
 try:b=response.read(65537);complete=len(b)<=65536
 except BaseException:pass
 try:response.close();closed=True
 except BaseException:pass
 safe,x=http_metadata(response.status,b,complete,closed)
 allowed=complete and closed and response.status in (c.SCOPE['newCredential']['successHttpStatuses'] if method=='POST' else [200]) and isinstance(x,dict) and x.get('success') is True
 safe['acceptedStatusAndSuccess']=allowed
 if method=='POST' or not allowed:save(prefix+'-http-response.json',safe)
 c.guard(allowed,'auth-api-response-not-success')
 return x.get('result')

def stop_owned(p):
 errors=[];rc=None
 if p is None:return None,False,errors
 if p.stdin is not None:
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

def error_class(e):
 for kind,label in ((urllib.error.HTTPError,'HTTPError'),(TimeoutError,'TimeoutError'),(urllib.error.URLError,'URLError'),(http.client.IncompleteRead,'IncompleteRead'),(ssl.SSLError,'SSLError'),(ConnectionError,'ConnectionError'),(OSError,'OSError'),(ValueError,'ValueError'),(c.Stop,'ScopeGuard')):
  if isinstance(e,kind):return label
 return 'OtherError'

def remaining(deadline):
 left=deadline-time.monotonic();c.guard(left>0,'registry-total-deadline-monotonic');return left

def read_slot(slot,auth,raw,deadline,opener=None):
 number=slot['slot'];d=slot['descriptor'];prefix='get-%02d'%number;started=utc();remaining(deadline)
 record(prefix+'.intent.json',{'schema':'trusted-pi-local-registry-get-intent/v1','requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'slot':number,'path':slot['path'],'expectedDescriptor':d,'at':started,'retryAllowed':False})
 h=hashlib.sha256();count=0;status=None;response=None;closed=False;complete=False;phase='open';failure=None;klass=None;headerMatches=None;smallEquals=None;parts=[];success=False
 try:
  request=urllib.request.Request('https://registry.cloudflare.com/v2/'+c.SCOPE['repository']+'/'+slot['path'],headers={'Authorization':'Basic '+auth,'Accept':'application/vnd.oci.image.manifest.v1+json','Accept-Encoding':'identity'},method='GET')
  opener=opener or urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7892'}),NoRedirect())
  try:response=opener.open(request,timeout=min(30,remaining(deadline)))
  except urllib.error.HTTPError as e:response=e;status=e.code;raise
  status=response.status;c.guard(status==200,'registry-http-status-not200');phase='read'
  while True:
   remaining(deadline);b=response.read(65536)
   if not b:complete=True;break
   count+=len(b);h.update(b);c.guard(count<=d['size'],'registry-body-oversize')

  phase='validate';c.guard(count==d['size'] and 'sha256:'+h.hexdigest()==d['digest'],'registry-body-size-or-sha')
  header=response.headers.get('Docker-Content-Digest');headerMatches=header==d['digest'] if number<2 else header is None or header==d['digest'];c.guard(headerMatches,'registry-content-digest-header')
  if slot['smallRawKind'] is not None:smallEquals=True # Complete body SHA+size already equals the fixed archive blob descriptor; no raw object comparison.
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
   except BaseException as interrupted:
    complete=False
    if isinstance(interrupted,c.Stop):failure=str(interrupted);klass=error_class(interrupted)
 finally:
  parts.clear()
  if response is not None:
   try:response.close();closed=True
   except BaseException as interrupted:
    failure=str(interrupted) if isinstance(interrupted,c.Stop) else failure or 'registry-response-close-unconfirmed';klass=error_class(interrupted) if isinstance(interrupted,c.Stop) else klass or 'OtherError';success=False
  terminal={'schema':'trusted-pi-local-registry-get-terminal/v1','requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'slot':number,'path':slot['path'],'expectedDescriptor':d,'httpStatus':status,'capturedBytes':count,'capturedSha256':h.hexdigest(),'responseCaptureComplete':complete,'responseClosed':closed,'phase':phase,'exceptionClass':klass,'errorCode':failure,'manifestOrBlobHeaderMatches':headerMatches,'smallRawSha256EqualityPassed':smallEquals,'proofAccepted':success,'startedAt':started,'endedAt':utc(),'rawBodyHeadersErrorTextOrAuthPersisted':False,'directSmallRawByteObjectComparisonPerformed':False}
  record(prefix+'.terminal.json',terminal)
 if not success:raise c.Stop('original-registry-readback-slot-failed-no-retry')
 proof={'schema':'trusted-pi-local-registry-get-proof/v1','requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'slot':number,'path':slot['path'],'status':200,'bytes':count,'digest':'sha256:'+h.hexdigest(),'headerMatches':True,'smallRawSha256EqualityPassed':smallEquals,'originalRawSha256Matched':True,'terminalSha256':c.sha((R/(prefix+'.terminal.json')).read_bytes())}
 record(prefix+'.proof.json',proof);return proof

def get_budget_seconds(grant,now=None):
 now=now or dt.datetime.now(dt.timezone.utc);expires=dt.datetime.fromisoformat(grant['expiresAt'].replace('Z','+00:00'));left=(expires-now).total_seconds();c.guard(left>0,'readback-grant-window-invalid');return min(720.0,left)

def local_signal(signum,*_):
 code='registry-total-deadline-sigalrm' if signum==signal.SIGALRM else {signal.SIGTERM:'local-external-interrupt-sigterm',signal.SIGHUP:'local-external-interrupt-sighup',signal.SIGINT:'local-external-interrupt-sigint'}.get(signum,'local-external-interrupt-other')
 raise c.Stop(code)
def source_bootstrap(files,ops_sha):
 selected={n:base64.b64encode(files[n]).decode() for n in ('scope.json','pub_common.py','oci_verify.py','source-verify.py','verification-source.json')};expected={n:c.sha(files[n]) for n in selected}
 return ("import base64,hashlib,sys,types\nraw="+repr(selected)+"\nexpected="+repr(expected)+"\nsource={n:base64.b64decode(b,validate=True) for n,b in raw.items()}\nassert all(hashlib.sha256(b).hexdigest()==expected[n] for n,b in source.items())\n"
  +"for name,file in [('pub_common','pub_common.py'),('oci_verify','oci_verify.py')]:\n m=types.ModuleType(name);m.__file__='/approved-memory/'+file\n if name=='pub_common':m.SCOPE_RAW=source['scope.json'];m.VERIFICATION_RAW=source['verification-source.json']\n sys.modules[name]=m;exec(compile(source[file],m.__file__,'exec'),m.__dict__)\n"
  +"sys.argv=['source-verify.py','--verify-source-readonly',"+repr(ops_sha)+"]\nexec(compile(source['source-verify.py'],'/approved-memory/source-verify.py','exec'),{'__file__':'/approved-memory/source-verify.py','__name__':'__main__'})\n").encode()
def validate_source_proof(proof,ops_sha):
 c.guard(isinstance(proof,dict) and proof.get('schema')=='trusted-pi-local-registry-source-proof/v1' and proof.get('requestId')==c.SCOPE['requestId'] and proof.get('operationId')==c.SCOPE['operationId'] and proof.get('sourceImageId')==c.SCOPE['sourceImageId'] and proof.get('scopeSha256')==c.SCOPE_SHA and proof.get('operationsManifestSha256')==ops_sha and proof.get('originalVerificationSha256')==c.SCOPE['verificationSourceSha256'] and proof.get('remoteWrites')==proof.get('dockerOrRegistryCalls')==0 and proof.get('oauthOrRegistryCredentialReadOrReceived') is False and proof.get('rawConfigEnvOrArchiveBodyReturned') is False and proof.get('directSmallRawByteObjectComparisonPerformed') is False,'fixed-readonly-source-proof')
 c.validate_verification(proof.get('verification'));stopped=proof.get('priorReadbackStop',{});bindings=c.SCOPE['stoppedReadbackSource']['records'];c.guard(stopped=={'intentSha256':bindings['intent.json']['sha256'],'terminalSha256':bindings['terminal.json']['sha256'],'originalSupervisorAbsent':True,'status':'unknown-stopped','registryGetAttempts':4,'registryGetProofCount':3,'recordCount':14,'all14OriginalRecordBytehashMatched':True},'prior-readback-stopped-and-byte-preserved');a=proof.get('archiveRevalidation',{})
 c.guard(a.get('archiveBytes')==c.SCOPE['originalArchive']['bytes'] and a.get('archiveSha256')==c.SCOPE['originalArchive']['sha256'] and a.get('originalVerificationSha256')==c.SCOPE['verificationSourceSha256'] and a.get('originalIndex')==c.SCOPE['sourceDescriptor'] and a.get('platformManifest')==c.SCOPE['expectedPlatformManifest'] and a.get('config')==c.SCOPE['expectedConfig'] and a.get('blobCount')==53 and a.get('rootfsLayerCount')==49 and a.get('archiveReadVerifications')==1 and a.get('exportsAttempted')==0 and a.get('allRawBlobHashesSizesReachable') is True and a.get('allRunnableDiffIdsMatched') is True and a.get('originalRecordsUnmodified') is True,'full-original-archive-revalidation-before-auth');return proof

def source_proof_once(files,ops_sha):
 payload=source_bootstrap(files,ops_sha);argv=['/usr/bin/ssh','-T','-oBatchMode=yes','-oConnectTimeout=10','-oForwardAgent=no','-oClearAllForwardings=yes','-oControlMaster=no','-oControlPath=none','-oPermitLocalCommand=no','AMD128','/usr/bin/python3 -'];save('source-ssh-intent.json',{'requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'sourceProgramSha256':c.sha(payload),'sourceInputFileHashes':{n:c.sha(files[n]) for n in ('scope.json','pub_common.py','oci_verify.py','source-verify.py','verification-source.json')},'stdinSourceOnlyNoGrantOrCredential':True,'forwardings':0,'forwardAgent':False,'remoteWrites':0,'deadlineSeconds':660,'at':utc()})
 p=None;data={'stdout':bytearray(),'stderr':bytearray()};error=None;began=time.monotonic()
 try:
  p=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin'},start_new_session=True);save('source-ssh-original.json',{'pid':p.pid,'startedAt':utc(),'requestId':c.SCOPE['requestId']})
  with selectors.DefaultSelector() as sel:
   for f,k,event in ((p.stdin,'stdin',selectors.EVENT_WRITE),(p.stdout,'stdout',selectors.EVENT_READ),(p.stderr,'stderr',selectors.EVENT_READ)):os.set_blocking(f.fileno(),False);sel.register(f,event,k)
   sent=0
   while sel.get_map():
    c.guard(time.monotonic()-began<650,'source-ssh-observation-deadline')
    for key,_ in sel.select(.25):
     k=key.data
     if k=='stdin':
      sent+=os.write(key.fileobj.fileno(),payload[sent:sent+16384])
      if sent==len(payload):sel.unregister(key.fileobj);key.fileobj.close()
     else:
      block=os.read(key.fileobj.fileno(),16384)
      if not block:sel.unregister(key.fileobj);continue
      c.guard(len(data[k])+len(block)<=(65536 if k=='stdout' else 32768),'source-proof-output-bound');data[k].extend(block)
   p.wait(timeout=3)
 except BaseException as e:error=str(e) if isinstance(e,c.Stop) else 'source-ssh-local-error'
 finally:
  rc,reaped,stopErrors=stop_owned(p)
  if p is not None:
   for f in (p.stdin,p.stdout,p.stderr):
    try:f.close()
    except BaseException:error=error or 'source-ssh-pipe-close-unconfirmed'
  save('source-proof.stdout',bytes(data['stdout']));save('source-ssh-terminal.json',{'requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'pid':None if p is None else p.pid,'exitCode':rc,'originalReaped':reaped,'errorCode':error,'stopErrors':stopErrors,'streams':{k:{'bytes':len(v),'sha256':c.sha(v)} for k,v in data.items()},'stderrPersisted':False,'endedAt':utc()})
 c.guard(error is None and rc==0 and reaped and not stopErrors,'source-ssh-failed-or-unconfirmed');proof=json.loads(data['stdout']);validate_source_proof(proof,ops_sha);save('source-proof.json',proof);return proof

def full_ack(result,proof):
 c.guard(result.get('schema')=='trusted-pi-local-registry-readback-result/v1' and result.get('requestId')==c.SCOPE['requestId'] and result.get('operationId')==c.SCOPE['operationId'] and result.get('sourceImageId')==c.SCOPE['sourceImageId'] and result.get('destination')=='registry.cloudflare.com/'+c.SCOPE['repository']+':'+c.SCOPE['tag'] and result.get('status')=='all52-original-registry-readbacks-verified' and result.get('registryGetAttempts')==result.get('registryGetProofCount')==52 and result.get('platformManifest')==c.SCOPE['expectedPlatformManifest'] and result.get('config')==c.SCOPE['expectedConfig'] and result.get('credentialMemoryCleared') is True and result.get('cleanupErrors')==[] and result.get('errorCode') is None and result.get('fullOriginalRegistryReadbackVerified') is True and result.get('directSmallRawByteObjectComparisonPerformed') is False and result.get('originalRawSha256IdentityVerified') is True and c.HEX.fullmatch(result.get('readbackProofSha256','')),'complete-local52-ack-required')
 c.guard(all(result.get(k)==0 for k in ('newSshRoutes','registryCredentialsTransferredToAmd','credentialFilesWritten','dockerCommands','exportsAttempted','pushesAttempted')),'local-readback-no-extra-actions');return True

def execute(grant_path,grant_sha):
 g,m,files=inputs(grant_path,grant_sha);STATE.mkdir(mode=0o700);R.mkdir(mode=0o700);ops_sha=c.sha(m);save('intent.json',{'schema':'trusted-pi-local-registry-readback-intent/v1','requestId':c.SCOPE['requestId'],'parentRequestId':c.SCOPE['parentRequestId'],'operationId':c.SCOPE['operationId'],'sourceImageId':c.SCOPE['sourceImageId'],'destination':'registry.cloudflare.com/'+c.SCOPE['repository']+':'+c.SCOPE['tag'],'operationsManifestSha256':ops_sha,'humanGrantSha256':grant_sha,'supervisorPid':os.getpid(),'at':utc()})
 result={'schema':'trusted-pi-local-registry-readback-result/v1','requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'sourceImageId':c.SCOPE['sourceImageId'],'destination':'registry.cloudflare.com/'+c.SCOPE['repository']+':'+c.SCOPE['tag'],'status':'unknown-stopped','registryGetAttempts':0,'registryGetProofCount':0,'credentialPostAttempted':False,'newSshRoutes':0,'registryCredentialsTransferredToAmd':0,'credentialFilesWritten':0,'dockerCommands':0,'exportsAttempted':0,'pushesAttempted':0,'errorCode':None,'cleanupErrors':[],'credentialMemoryCleared':False,'fullOriginalRegistryReadbackVerified':False,'directSmallRawByteObjectComparisonPerformed':False,'originalRawSha256IdentityVerified':False,'mergeAllowed':False}
 token=None;credentials=None;auth=None;proof=None;proofs=[]
 try:
  proof=source_proof_once(files,ops_sha) # No OAuth/JWT before original archive source proof.
  c.grant(g,ops_sha);token,expiry,scopes=oauth_after_new_grant();user=api(token,'/user');account=api(token,'/accounts/'+c.SCOPE['accountId']);c.guard(isinstance(user,dict) and isinstance(user.get('id'),str) and c.sha(user['id'].encode())==c.SCOPE['expectedUserIdSha256'] and account.get('id')==c.SCOPE['accountId'],'existing-user-account-not-confirmed')
  save('normal-login-identity-safe.json',{'requestId':c.SCOPE['requestId'],'accountId':account['id'],'userIdSha256':c.sha(user['id'].encode()),'scopes':scopes,'expiresAt':expiry,'oauthNotTransferred':True})
  c.grant(g,ops_sha);c.guard(dt.datetime.fromisoformat(expiry.replace('Z','+00:00'))>dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=120),'local-oauth-expired-before-one-post');save('credential-post-once-intent.json',{'requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'expirationMinutes':15,'permissions':['pull'],'at':utc(),'accountScopeNotRepositoryScope':True,'credentialSentToAmd':False});result['credentialPostAttempted']=True
  credentials=api(token,'/accounts/'+c.SCOPE['accountId']+'/containers/registries/registry.cloudflare.com/credentials','POST',{'expiration_minutes':15,'permissions':['pull']});c.guard(isinstance(credentials,dict) and set(credentials)=={'account_id','registry_host','username','password'} and credentials.get('account_id')==c.SCOPE['accountId'] and credentials.get('registry_host')=='registry.cloudflare.com' and all(isinstance(credentials.get(k),str) and 0<len(credentials[k])<=32768 and '\n' not in credentials[k] and '\r' not in credentials[k] for k in ('username','password')),'local-pull-credential-shape-unknown')
  auth=base64.b64encode((credentials['username']+':'+credentials['password']).encode()).decode();credentials=None;token=None;budget_start=time.monotonic();parsed_grant=c.grant(g,ops_sha);budget=get_budget_seconds(parsed_grant);deadline=budget_start+budget;signal.setitimer(signal.ITIMER_REAL,remaining(deadline))
  try:
   for slot in c.slots():c.grant(g,ops_sha);remaining(deadline);result['registryGetAttempts']+=1;proofs.append(read_slot(slot,auth,None,deadline));result['registryGetProofCount']=len(proofs)
  finally:signal.setitimer(signal.ITIMER_REAL,0)
  c.grant(g,ops_sha) # The final body cannot extend the human authorization window.
  complete={'schema':'trusted-pi-local-registry-readback-complete/v1','requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'sourceImageId':c.SCOPE['sourceImageId'],'platformManifest':c.SCOPE['expectedPlatformManifest'],'config':c.SCOPE['expectedConfig'],'sourceProofSha256':c.sha((STATE/'source-proof.json').read_bytes()),'verificationSourceSha256':c.SCOPE['verificationSourceSha256'],'proofs':proofs,'all52RawBodiesMatchFixedOriginalBlobSha256':True,'directSmallRawByteObjectComparisonPerformed':False,'newPushAttempted':False};record('registry-readback.json',complete);result.update(status='all52-original-registry-readbacks-verified',platformManifest=c.SCOPE['expectedPlatformManifest'],config=c.SCOPE['expectedConfig'],fullOriginalRegistryReadbackVerified=True,originalRawSha256IdentityVerified=True,readbackProofSha256=c.sha((R/'registry-readback.json').read_bytes()))
 except BaseException as e:result['errorCode']=str(e) if isinstance(e,c.Stop) else 'local-readback-error'
 finally:
  credentials=None;auth=None;token=None;result.update(credentialMemoryCleared=True,endedAt=utc());save('terminal.json',result)
 if result['status']=='all52-original-registry-readbacks-verified':c.grant(g,ops_sha);full_ack(result,proof);save('final-ack.json',{'schema':'trusted-pi-local-registry-final-ack/v1','requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'terminalSha256':c.sha((STATE/'terminal.json').read_bytes()),'readbackProofSha256':result['readbackProofSha256'],'sourceProofSha256':c.sha((STATE/'source-proof.json').read_bytes()),'all52Verified':True,'mergeAllowed':False})
 return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');p.add_argument('--grant-file',required=True);p.add_argument('--grant-sha256',required=True);a=p.parse_args()
 try:
  c.guard(a.execute,'explicit-local-readback-required')
  for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT,signal.SIGALRM):signal.signal(sig,local_signal)
  result=execute(Path(a.grant_file).resolve(),a.grant_sha256);terminal_raw=c.read_private(STATE/'terminal.json',131072);ack_raw=c.read_private(STATE/'final-ack.json',65536) if (STATE/'final-ack.json').exists() else None;ack=json.loads(ack_raw) if ack_raw is not None else None
  complete=ack is not None and ack.get('terminalSha256')==c.sha(terminal_raw) and ack.get('readbackProofSha256')==result.get('readbackProofSha256') and ack.get('sourceProofSha256')==c.sha(c.read_private(STATE/'source-proof.json',65536)) and ack.get('all52Verified') is True and result.get('status')=='all52-original-registry-readbacks-verified' and result.get('errorCode') is None
  print(json.dumps({'schema':'trusted-pi-local-registry-readback-execution-result/v1','requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'terminal':result,'terminalSha256':c.sha(terminal_raw),'finalAckSha256':None if ack_raw is None else c.sha(ack_raw),'uniqueFinalAckVerified':complete,'mergeAllowed':False},sort_keys=True));return 0 if complete else 1
 except BaseException as e:print(json.dumps({'requestId':c.SCOPE['requestId'],'operationId':c.SCOPE['operationId'],'status':'unknown-stopped','errorCode':str(e) if isinstance(e,c.Stop) else 'local-preflight-error','mergeAllowed':False}));return 1
if __name__=='__main__':sys.exit(main())
