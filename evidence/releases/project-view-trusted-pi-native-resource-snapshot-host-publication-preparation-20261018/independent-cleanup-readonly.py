#!/usr/bin/env python3
"""Fixed new publication records/process/route cleanup only; no Docker or writes."""
import argparse,datetime as dt,hashlib,json,os,re,socket,stat,sys
from pathlib import Path
ROOT=Path('/tmp/riffoid-jhg46-image-20261017.AU613w/pi-native-resource-snapshot-host-publication-v1');R=ROOT/'records'
REQUEST='c263a2f3-f445-430e-b562-2e48f1eeb637';SOURCE='sha256:0bb9af7a5909c41187cf56402a21420100c72a8de0025b0a7152f8804e85d191'
DEST='registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi:jhg46-native-resource-host-20261018-0bb9af7a'
NAMES=('source-before','export-once','source-after','new-local-tag-before','tag-original-once','push-once')
HEX=re.compile(r'^[a-f0-9]{64}$')
class Stop(Exception):pass
def guard(ok,code):
 if not ok:raise Stop(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def ticks(pid):
 try:return Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]
 except FileNotFoundError:return None
def read(name,refs):
 p=R/name;guard(p.resolve()==p and not p.is_symlink(),'fixed-record-no-link');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());guard(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=2097152,'fixed-private-bounded-record');b=f.read(2097153)
 guard(len(b)<=2097152,'record-byte-bound');refs.append({'path':name,'bytes':len(b),'sha256':sha(b)});return b
def obj(name,refs):
 x=json.loads(read(name,refs));guard(isinstance(x,dict),'record-object');return x
def absent_original(pid,original):
 guard(type(pid) is int and pid>1 and isinstance(original,str) and original.isdecimal(),'pid-ticks-fields')
 current=ticks(pid);return current is None or current!=original
def route_absent():
 rows=[]
 for file in ('/proc/net/tcp','/proc/net/tcp6'):
  for line in Path(file).read_text().splitlines()[1:]:
   parts=line.split()
   if int(parts[1].split(':')[1],16)==7897 and parts[3]=='0A':rows.append('present')
 with socket.socket() as s:s.settimeout(2);code=s.connect_ex(('127.0.0.1',7897))
 return not rows and code==111,code
def observe(grant_sha,operations_sha):
 guard(sys.platform=='linux' and HEX.fullmatch(grant_sha or '') and HEX.fullmatch(operations_sha or ''),'explicit-fixed-readback-identities')
 for p in (ROOT,R):guard(p.resolve()==p and p.is_dir() and p.stat().st_uid==os.getuid() and stat.S_IMODE(p.stat().st_mode)==0o700,'owned-private-publication-directory')
 refs=[];intent=obj('intent.json',refs);terminal=obj('terminal.json',refs)
 guard(intent.get('requestId')==REQUEST and intent.get('sourceImageId')==SOURCE and intent.get('destination')==DEST
  and intent.get('humanGrantSha256')==grant_sha and intent.get('operationsManifestSha256')==operations_sha,'original-publication-intent')
 guard(absent_original(intent.get('supervisorPid'),intent.get('supervisorLinuxStartTicks')),'original-publication-supervisor-active-or-unknown')
 guard(terminal.get('schema')=='trusted-pi-image-publication-result/v1' and terminal.get('requestId')==REQUEST
  and terminal.get('sourceImageId')==SOURCE and terminal.get('destination')==DEST
  and terminal.get('actualExportAttempts')==1 and terminal.get('actualArchiveReadVerifications')==1
    and terminal.get('credentialFilesAbsent') is True and terminal.get('cleanupErrors')==[],'original-success-terminal-required')
 success=terminal.get('status')=='original-image-pushed-and-all-raw-registry-readback-verified' and terminal.get('actualPushAttempts')==1 and terminal.get('errorCode') is None
 stopped=terminal.get('status')=='unknown-stopped' and terminal.get('errorCode')=='credential-stdin-bound' and terminal.get('actualPushAttempts')==0
 guard(success or stopped,'original-terminal-publication-or-known-precredential-stop-required')
 verification=obj('raw-verification.json',refs)
 guard(verification.get('schema')=='trusted-pi-original-oci-verification/v1' and verification.get('sourceImageId')==SOURCE
  and verification.get('allRawBlobHashesSizesReachable') is True and verification.get('allRunnableDiffIdsMatched') is True
  and type(verification.get('archiveBytes')) is int and 0<verification['archiveBytes']<=4294967296
  and HEX.fullmatch(verification.get('archiveSha256',''))
  and type(verification.get('blobCount')) is int and 3<=verification['blobCount']<=256 and verification.get('rootfsLayerCount')==49
  and verification.get('originalIndex')=={'digest':SOURCE,'mediaType':'application/vnd.oci.image.index.v1+json','size':856}
  and len(verification.get('layers',[]))==49
  and (not success or verification.get('linuxAmd64Manifest')==terminal.get('platformManifest') and verification.get('config')==terminal.get('config')),'original-export-raw-binding')
 if success:
  registry=obj('registry-readback.json',refs)
  guard(registry.get('requestId')==REQUEST and registry.get('allRawBodiesMatchOriginal') is True
   and registry.get('indexOrAttestationUploaded') is False and len(registry.get('readbacks',[]))==len(verification.get('layers',[]))+3,'original-raw-registry-binding')
  expected=[verification['linuxAmd64Manifest'],verification['linuxAmd64Manifest'],verification['config']]+verification['layers']
  for proof,desc in zip(registry['readbacks'],expected):
   guard(proof.get('status')==200 and proof.get('bytes')==desc['size'] and proof.get('digest')==desc['digest'],'every-original-registry-readback-descriptor')
 else:
  names=['remote-tag-absence.json','push-once-intent.json','registry-readback.json']
  names += [name+'.'+suffix for name in NAMES[3:] for suffix in ('intent.json','original-cli.json','terminal.json','stdout','stderr')]
  guard(all(not os.path.lexists(R/name) for name in names),'unexpected-later-operation-record-after-precredential-stop')
 documents={}
 for n,desc in (('raw-index.json',verification['originalIndex']),('raw-manifest.json',verification['linuxAmd64Manifest']),('raw-config.json',verification['config'])):
  b=read(n,refs);guard(len(b)==desc['size'] and 'sha256:'+sha(b)==desc['digest'],'original-raw-metadata-bytes');documents[n]=json.loads(b)
 selected=[x for x in documents['raw-index.json'].get('manifests',[]) if x.get('platform',{}).get('os')=='linux' and x.get('platform',{}).get('architecture')=='amd64']
 core=lambda x:{k:x.get(k) for k in ('digest','size','mediaType')}
 guard(len(selected)==1 and core(selected[0])==verification['linuxAmd64Manifest']
  and core(documents['raw-manifest.json'].get('config',{}))==verification['config']
  and [core(x) for x in documents['raw-manifest.json'].get('layers',[])]==verification['layers'],'original-index-to-runnable-config-layer-chain')
 # Original archive is stat-bound only here; full bytes/diffIDs were read once by the publisher verifier.
 archive=ROOT/'original.oci.tar';guard(archive.resolve()==archive and not archive.is_symlink(),'original-export-path')
 st=archive.stat();guard(stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_nlink==1
   and stat.S_IMODE(st.st_mode)==0o600 and st.st_size==verification['archiveBytes'],'original-export-stat')
 export=obj('export-once.terminal.json',refs)
 guard(export.get('archiveBytesWritten')==verification['archiveBytes'],'original-single-export-bytes')
 config_doc=documents['raw-config.json'];diffids=config_doc.get('rootfs',{}).get('diff_ids')
 guard(config_doc.get('os')=='linux' and config_doc.get('architecture')=='amd64'
   and isinstance(diffids,list) and len(diffids)==49
   and all(isinstance(x,str) and x.startswith('sha256:') and HEX.fullmatch(x[7:]) for x in diffids),'original-config49-diffids')
 images=[]
 for name in ('source-before','source-after'):
  image=json.loads(read(name+'.stdout',refs));guard(isinstance(image,dict),'source-inspect-object')
  guard(image.get('Id')==SOURCE and image.get('Descriptor',{}).get('digest')==SOURCE
   and image.get('Descriptor',{}).get('size')==856 and image.get('Os')=='linux' and image.get('Architecture')=='amd64'
   and image.get('RootFS',{}).get('Layers')==diffids,'source-original-index-platform49-rootfs')
  images.append(image)
 guard(images[0].get('Config')==images[1].get('Config'),'source-before-after-config-drift')
 lifecycles=[]
 for n in (NAMES if success else NAMES[:3]):
  cli=obj(n+'.original-cli.json',refs);end=obj(n+'.terminal.json',refs)
  guard(cli.get('pid')==end.get('pid') and cli.get('linuxStartTicks')==end.get('linuxStartTicks')
   and absent_original(cli.get('pid'),cli.get('linuxStartTicks')) and end.get('reaped') is True
   and end.get('errorCode') is None and end.get('stopErrors')==[] and end.get('exitCode')==(1 if n=='new-local-tag-before' else 0),'original-cli-terminal-and-absence')
  for stream in ('stdout','stderr'):
   b=read(n+'.'+stream,refs);meta=end.get('streams',{}).get(stream,{})
   guard(meta.get('bytes')==len(b) and meta.get('sha256')==sha(b),'original-cli-log-bytehash')
  lifecycles.append({'name':n,'pid':cli['pid'],'linuxStartTicks':cli['linuxStartTicks'],'exitCode':end['exitCode'],'recordedReaped':True,'originalProcessAbsent':True})
 auth=ROOT/'temporary-auth';guard(not os.path.lexists(auth) and not os.path.lexists(auth/'config.json'),'original-local-credential-copy-not-cleaned')
 absent,errno=route_absent();guard(absent,'original-loopback-route-not-released')
 return {'schema':'trusted-pi-image-publication-independent-cleanup/v1','requestId':REQUEST,'sourceImageId':SOURCE,
  'platformManifest':verification['linuxAmd64Manifest'],'config':verification['config'],'originalSupervisorAbsent':True,
  'commandLifecycles':lifecycles,'localCredentialCopiesAbsent':True,'route7897Absent':True,'routeConnectErrno':errno,
  'credentialRevocationOrExpiryProved':False,'requestedCredentialTtlMinutes':15,'fileRecords':refs,'rawSecretsEnvConfigOrLogsReturned':False,
  'remoteWrites':0,'dockerOrProviderCommands':0,'status':'original-publication-and-local-cleanup-confirmed' if success else 'original-recovery-stopped-without-publication-and-local-cleanup-confirmed','publicationVerified':success,'originalArchiveIndependentlyRehashed':False,'originalArchiveStatMatched':True,'mergeAllowed':False,'oauthContainersWriteGrantIsPersistent':True}
def main():
 p=argparse.ArgumentParser();p.add_argument('--execute-readonly',action='store_true');p.add_argument('--grant-sha256',required=True);p.add_argument('--operations-sha256',required=True);a=p.parse_args()
 try:guard(a.execute_readonly,'explicit-readonly-required');r=observe(a.grant_sha256,a.operations_sha256);print(json.dumps(r,sort_keys=True));return 0
 except BaseException as e:print(json.dumps({'requestId':REQUEST,'status':'cleanup-pending','errorCode':str(e) if isinstance(e,Stop) else 'readonly-record-error','remoteWrites':0,'dockerOrProviderCommands':0}));return 1
if __name__=='__main__':sys.exit(main())
