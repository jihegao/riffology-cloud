#!/usr/bin/env python3
"""One fixed failed c3e request; readonly original records, archive and release."""
from pathlib import Path
import argparse,hashlib,json,os,stat,sys
import cleanup_reader as r
GRANT='e0f980ad3905beab671ee333542806964d0d976d58361f50494bbaf888110e84'
OPS='986c2d6e12e72785978e0bdfcf6e6357ba82e59cb16c40dc5c1cf8c7530ac4d1'
NAMES=('source-before','export-once','source-after')
def run():
 r.guard(sys.platform=='linux','linux-original-readback')
 for p in (r.ROOT,r.R):r.guard(p.resolve()==p and p.is_dir() and p.stat().st_uid==os.getuid() and stat.S_IMODE(p.stat().st_mode)==0o700,'private-original-directory')
 refs=[];intent=r.obj('intent.json',refs);terminal=r.obj('terminal.json',refs)
 r.guard(intent.get('requestId')==r.REQUEST and intent.get('sourceImageId')==r.SOURCE and intent.get('destination')==r.DEST
  and intent.get('humanGrantSha256')==GRANT and intent.get('operationsManifestSha256')==OPS,'fixed-original-intent')
 r.guard(r.absent_original(intent.get('supervisorPid'),intent.get('supervisorLinuxStartTicks')),'original-supervisor-present-or-unknown')
 r.guard(terminal.get('schema')=='trusted-pi-image-publication-result/v1' and terminal.get('requestId')==r.REQUEST
  and terminal.get('sourceImageId')==r.SOURCE and terminal.get('destination')==r.DEST
  and terminal.get('status')=='unknown-stopped' and terminal.get('actualExportAttempts')==1 and terminal.get('actualPushAttempts')==0
  and terminal.get('errorCode') in ('credential-stdin-bound','publication-interrupted-original-identity-only')
  and terminal.get('credentialFilesAbsent') is True and terminal.get('cleanupErrors')==[],'original-failed-terminal-not-published')
 verification=r.obj('raw-verification.json',refs)
 r.guard(verification.get('schema')=='trusted-pi-original-oci-verification/v1' and verification.get('sourceImageId')==r.SOURCE
  and verification.get('originalIndex')=={'digest':r.SOURCE,'mediaType':'application/vnd.oci.image.index.v1+json','size':856}
  and verification.get('allRawBlobHashesSizesReachable') is True and verification.get('allRunnableDiffIdsMatched') is True
  and verification.get('rootfsLayerCount')==48 and verification.get('registryPublicationClaim') is False,'original-export-verification')
 docs={}
 for n,d in [('raw-index.json',verification['originalIndex']),('raw-manifest.json',verification['linuxAmd64Manifest']),('raw-config.json',verification['config'])]:
  b=r.read(n,refs);r.guard(len(b)==d['size'] and 'sha256:'+r.sha(b)==d['digest'],'original-raw-metadata-hash');docs[n]=json.loads(b)
 core=lambda x:{k:x.get(k) for k in ('digest','size','mediaType')}
 selected=[x for x in docs['raw-index.json'].get('manifests',[]) if x.get('platform',{}).get('os')=='linux' and x.get('platform',{}).get('architecture')=='amd64']
 r.guard(len(selected)==1 and core(selected[0])==verification['linuxAmd64Manifest'] and core(docs['raw-manifest.json']['config'])==verification['config']
  and [core(x) for x in docs['raw-manifest.json']['layers']]==verification['layers'],'original-index-platform-config-layer-chain')
 lifecycles=[];outputs={}
 for n in NAMES:
  cli=r.obj(n+'.original-cli.json',refs);end=r.obj(n+'.terminal.json',refs)
  r.guard(cli.get('pid')==end.get('pid') and cli.get('linuxStartTicks')==end.get('linuxStartTicks') and r.absent_original(cli.get('pid'),cli.get('linuxStartTicks'))
   and end.get('reaped') is True and end.get('errorCode') is None and end.get('stopErrors')==[] and end.get('exitCode')==0,'original-three-cli-success-reaped-absent')
  for stream in ('stdout','stderr'):
   b=r.read(n+'.'+stream,refs);d=end['streams'][stream];r.guard(len(b)==d['bytes'] and r.sha(b)==d['sha256'],'original-cli-stream-hash')
   if n in ('source-before','source-after') and stream=='stdout':outputs[n]=json.loads(b)
  lifecycles.append({'name':n,'pid':cli['pid'],'linuxStartTicks':cli['linuxStartTicks'],'exitCode':0,'recordedReaped':True,'originalProcessAbsent':True})
 before=outputs['source-before'];after=outputs['source-after']
 r.guard(before.get('Id')==r.SOURCE and before.get('Os')=='linux' and before.get('Architecture')=='amd64'
  and before.get('RootFS')==after.get('RootFS') and before.get('Config')==after.get('Config')
  and before['Config']['User']=='root' and before['Config']['Entrypoint']==['/container-server/sandbox']
  and len(before['RootFS']['Layers'])==48 and docs['raw-config.json']['rootfs']['diff_ids']==before['RootFS']['Layers'],'original-image-inspects-and-raw-config-binding')
 archive=r.ROOT/'original.oci.tar';r.guard(archive.resolve()==archive and not archive.is_symlink(),'fixed-original-archive-no-link')
 fd=os.open(archive,os.O_RDONLY|os.O_NOFOLLOW);h=hashlib.sha256();count=0
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());r.guard(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and 0<s.st_size<=4294967296,'fixed-private-bounded-archive')
  while True:
   b=f.read(1048576)
   if not b:break
   count+=len(b);r.guard(count<=4294967296,'archive-read-bound');h.update(b)
 r.guard(count==verification['archiveBytes'] and h.hexdigest()==verification['archiveSha256'],'original-archive-size-sha-current')
 refs.append({'path':'../original.oci.tar','bytes':count,'sha256':h.hexdigest()})
 absent=[]
 for n in ('new-local-tag-before','tag-original-once','push-once'):
  for suffix in ('.intent.json','.original-cli.json','.terminal.json','.stdout','.stderr'):
   p=r.R/(n+suffix);r.guard(not os.path.lexists(p),'unexpected-later-operation-record');absent.append(p.name)
 for n in ('push-once-intent.json','remote-tag-absence.json','registry-readback.json'):
  r.guard(not os.path.lexists(r.R/n),'unexpected-later-publication-record');absent.append(n)
 auth=r.ROOT/'temporary-auth';r.guard(not os.path.lexists(auth) and not os.path.lexists(auth/'config.json'),'temporary-auth-residue')
 absent_route,errno=r.route_absent();r.guard(absent_route,'original-route-present-or-unknown')
 return {'schema':'trusted-pi-failed-publication-independent-readback/v1','requestId':r.REQUEST,'sourceImageId':r.SOURCE,'destination':r.DEST,
  'status':'failed-publication-original-export-and-cleanup-confirmed','publicationSucceeded':False,'remoteTerminal':terminal,
  'originalSupervisorAbsent':True,'commandLifecycles':lifecycles,'verifiedOriginalExport':verification,'archiveCurrentSizeShaMatched':True,
  'laterOperationRecordsAbsent':absent,'localCredentialCopiesAbsent':True,'route7897Absent':True,'routeConnectErrno':errno,
  'credentialIssuedRevokedOrExpiredProved':False,'mergeAllowed':False,'fileRecords':refs,'rawSecretsEnvConfigOrLogsReturned':False,
  'remoteWrites':0,'dockerCommands':0,'providerCalls':0,'automaticRetry':False}
def main():
 p=argparse.ArgumentParser();p.add_argument('--execute-readonly',action='store_true');a=p.parse_args()
 try:r.guard(a.execute_readonly,'explicit-readonly');print(json.dumps(run(),sort_keys=True));return 0
 except BaseException as e:print(json.dumps({'schema':'trusted-pi-failed-publication-independent-readback/v1','requestId':r.REQUEST,'status':'cleanup-pending','publicationSucceeded':False,'mergeAllowed':False,'errorCode':str(e) if isinstance(e,r.Stop) else 'readonly-record-error','remoteWrites':0,'dockerCommands':0}));return 1
if __name__=='__main__':sys.exit(main())
