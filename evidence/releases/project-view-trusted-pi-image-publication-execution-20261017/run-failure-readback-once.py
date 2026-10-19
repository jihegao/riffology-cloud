from pathlib import Path
import base64,datetime as dt,hashlib,importlib.util,json,os,selectors,shlex,subprocess,sys,time
os.umask(0o077)
E=Path(__file__).resolve().parent;D=E/'failure-independent-readback-once'
reader=(E/'ops/independent-cleanup-readonly.py').read_bytes();assert hashlib.sha256(reader).hexdigest()=='2cf04125f41a89804ab284fe378990529b5eb9ad11b76888202b481a45a93ab9'
failure=(E/'failure-readonly.py').read_bytes()
assert hashlib.sha256(failure).hexdigest()=='fe4acbcdace1167d0815d23b8b0642567f3b3b01abc9fca29ef30dc12e380949'
for name,digest in {'local-publication.py':'207c9f81044f084f0968451a666a09543395da34de28059aced00850b6045370','pub_common.py':'352c0a919f524be8e1dcc1acc78e905d164212b22bbde6ed5f98efae47673d82','scope.json':'65a524a1e8028f4dd9af64386f86fc69cebaaf4df5acc62ac039884076d2f96a'}.items():
 assert hashlib.sha256((E/'ops'/name).read_bytes()).hexdigest()==digest
sys.path.insert(0,str(E/'ops'))
spec=importlib.util.spec_from_file_location('fixed_publication_local',E/'ops/local-publication.py');fixed=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixed)
source=("import base64,hashlib,sys,types\nreader=base64.b64decode("+repr(base64.b64encode(reader).decode())+")\nfailure=base64.b64decode("+repr(base64.b64encode(failure).decode())+")\nassert hashlib.sha256(reader).hexdigest()=='2cf04125f41a89804ab284fe378990529b5eb9ad11b76888202b481a45a93ab9'\nassert hashlib.sha256(failure).hexdigest()=="+repr(hashlib.sha256(failure).hexdigest())+"\nm=types.ModuleType('cleanup_reader');m.__file__='/approved-memory/cleanup-reader.py';sys.modules['cleanup_reader']=m;exec(compile(reader,m.__file__,'exec'),m.__dict__)\nsys.argv=['failure-readonly.py','--execute-readonly']\nexec(compile(failure,'/approved-memory/failure-readonly.py','exec'),{'__name__':'__main__','__file__':'/approved-memory/failure-readonly.py'})\n").encode()
D.mkdir(mode=0o700)
intent={'schema':'trusted-pi-failure-readonly-transport/v1','requestId':'c3e04c41-72da-409b-a2b1-f924e6cc67fa','readerSha256':hashlib.sha256(reader).hexdigest(),'failureReaderSha256':hashlib.sha256(failure).hexdigest(),'memoryBootstrapSha256':hashlib.sha256(source).hexdigest(),'noForwardingOrAgent':True,'remoteWrites':False,'dockerCommands':False,'at':dt.datetime.now(dt.timezone.utc).isoformat()}
with open(D/'intent.json','x') as f:json.dump(intent,f,sort_keys=True,indent=2);f.write('\n')
argv=['/usr/bin/ssh','-T','-oBatchMode=yes','-oConnectTimeout=10','-oForwardAgent=no','-oClearAllForwardings=yes','-oControlMaster=no','-oControlPath=none','-oPermitLocalCommand=no','AMD128','/usr/bin/python3 -c '+shlex.quote(source.decode())]
p=None;data={'stdout':bytearray(),'stderr':bytearray()};error=None
try:
 p=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin'},start_new_session=True)
 with open(D/'original-process.json','x') as f:json.dump({'pid':p.pid,'startedAt':dt.datetime.now(dt.timezone.utc).isoformat()},f,sort_keys=True,indent=2);f.write('\n')
 p.stdin.close();end=time.monotonic()+180
 with selectors.DefaultSelector() as sel:
  for pipe,n in [(p.stdout,'stdout'),(p.stderr,'stderr')]:sel.register(pipe,selectors.EVENT_READ,n)
  while sel.get_map():
   if time.monotonic()>=end:raise RuntimeError('readonly-observation-timeout')
   for key,_ in sel.select(.25):
    b=os.read(key.fileobj.fileno(),16384)
    if not b:sel.unregister(key.fileobj);continue
    if len(data[key.data])+len(b)>(131072 if key.data=='stdout' else 32768):raise RuntimeError('readonly-stream-bound')
    data[key.data].extend(b)
 p.wait(timeout=5)
except BaseException as ex:error=str(ex) if type(ex) is RuntimeError else 'readonly-transport-local-error'
finally:
 rc,reaped,stop_errors=fixed.stop_owned(p)
 if stop_errors or p is not None and not reaped:error=error or 'readonly-original-ssh-stop-unconfirmed'
 if p is not None:
  for pipe in (p.stdout,p.stderr):
   try:pipe.close()
   except BaseException:error=error or 'readonly-pipe-close-unconfirmed'
for n,b in data.items():
 with open(D/n,'xb') as f:f.write(b)
terminal={'exitCode':rc,'reaped':reaped,'errorCode':error,'stopErrors':stop_errors,'streamsMayBeIncomplete':error is not None,'streams':{n:{'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in data.items()},'endedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
with open(D/'terminal.json','x') as f:json.dump(terminal,f,sort_keys=True,indent=2);f.write('\n')
if error is not None or rc!=0:
 print(json.dumps({'transport':terminal,'status':'readonly-cleanup-pending','publicationSucceeded':False,'mergeAllowed':False}));sys.exit(1)
x=json.loads(data['stdout'])
with open(D/'result.json','x') as f:json.dump(x,f,sort_keys=True,indent=2);f.write('\n')
print(json.dumps({'transport':terminal,'result':{k:x.get(k) for k in ['status','errorCode','publicationSucceeded','originalSupervisorAbsent','archiveCurrentSizeShaMatched','localCredentialCopiesAbsent','route7897Absent','mergeAllowed']},'remoteTerminal':x.get('remoteTerminal'),'commandLifecycles':x.get('commandLifecycles'),'export':{k:x.get('verifiedOriginalExport',{}).get(k) for k in ['archiveBytes','archiveSha256','linuxAmd64Manifest','config','blobCount','rootfsLayerCount','allRawBlobHashesSizesReachable','allRunnableDiffIdsMatched']}}))
sys.exit(rc)
