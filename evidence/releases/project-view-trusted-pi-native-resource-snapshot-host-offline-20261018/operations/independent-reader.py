#!/usr/bin/env python3
"""Independent original-record validation and exactly two read-only Docker queries.
No build/create/start/rm/pull/push/export, provider, credential or network API.
"""
import argparse, importlib.util, json, os, stat, sys
from pathlib import Path
import repair_common as c
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('host_runner_readonly',HERE/'build-probe-repair.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
ORIGINAL=r.RECORDS
NAMES=('base-inspect','default-builder-inspect-plain','build-help','derived-tag-before','build-once',
       'derived-image-inspect','probe-label-before','create-once','created-original-inspect','start-original-once',
       'wait-original','completed-original-inspect','cleanup-label-before','cleanup-original-before',
       'cleanup-original-remove','cleanup-original-after','cleanup-label-after')
def document(name,limit=131072):
 p=ORIGINAL/name
 mode=stat.S_IMODE(p.stat().st_mode)
 allowed={0o600,0o644,0o664} if name in ('probe.cid','derived.iid','build-metadata.json') else {0o600}
 c.guard(ORIGINAL.resolve()==ORIGINAL and ORIGINAL.stat().st_uid==os.getuid() and stat.S_IMODE(ORIGINAL.stat().st_mode)==0o700
         and p.resolve()==p and p.stat().st_uid==os.getuid() and p.stat().st_nlink==1 and mode in allowed,'private-original-record')
 return c.read_regular(p,limit)
def validate_original(read=document,ticks=r.process_start_ticks):
 terminal=json.loads(read('result.json'))
 c.guard(terminal.get('requestId')==c.SCOPE['requestId'] and terminal.get('status')=='offline-image-compatibility-mock-passed','original-terminal-not-passed')
 image=terminal.get('imageId');c.guard(r.IMAGE.fullmatch(image or ''),'original-image-identity')
 cid=read('probe.cid',256).decode().strip();c.guard(r.CID.fullmatch(cid),'original-cid')
 cleanup=json.loads(read('original-container-cleanup.json'))
 c.guard(cleanup.get('originalContainerId')==cid and all(cleanup.get(k) is True for k in ['cleanupConfirmed','originalIdAbsent','labelListEmpty']),'original-cleanup-record')
 report=json.loads(read('probe-report.json'));manifest=json.loads(c.read_regular(Path(c.SCOPE['remoteDirectory'])/'input-manifest.json',131072))
 r.validate_probe(json.dumps(report).encode(),manifest)
 actual=read('start-original-once.stdout');c.guard(json.loads(actual)==report,'original-probe-report-stream-equal')
 lifecycles=[]
 for name in NAMES:
  intent=json.loads(read(name+'.intent.json'));result=json.loads(read(name+'.result.json'));identity=json.loads(read(name+'.original-cli.json'))
  pid,tick=identity.get('pid'),identity.get('linuxStartTicks')
  c.guard(type(pid) is int and pid>1 and isinstance(tick,str) and tick.isdecimal(),'original-cli-identity')
  c.guard(result.get('originalCliPid')==pid and result.get('originalCliLinuxStartTicks')==tick
          and result.get('originalCliReaped') is True and ticks(pid)!=tick and result.get('error') is None,'original-cli-terminal-absence')
  for channel in ['stdout','stderr']:
   raw=read(name+'.'+channel,2097152);s=result['streams'][channel]
   c.guard(s.get('bytesObserved')==s.get('bytesSaved')==len(raw) and s.get('discardedBytes')==0 and s.get('sha256')==c.sha(raw),'original-cli-stream-drift')
  c.guard(intent.get('argv',[])[:3]==r.DOCKER,'original-fixed-docker')
  expected = {1} if name in ('derived-tag-before','cleanup-original-after') else {0,1} if name=='cleanup-original-remove' else {0}
  c.guard(result.get('exitCode') in expected,'original-cli-exit-code')
  lifecycles.append({'name':name,'originalCliReaped':True,'currentOriginalProcessAbsent':True,'exitCode':result.get('exitCode')})
 state=json.loads(read('completed-original-inspect.stdout')).get('State',{})
 c.guard(state.get('ExitCode')==0 and state.get('Running') is False and state.get('Status')=='exited'
         and read('wait-original.stdout').decode().strip()=='0','original-probe-exit')
 return {'requestId':c.SCOPE['requestId'],'imageId':image,'originalContainerId':cid,'probePassed':True,'cliLifecycles':lifecycles}
def execute(request,grant_sha):
 c.guard(request==c.SCOPE['requestId'],'fixed-reader-request');c.verify_installed_authorization(grant_sha)
 result=validate_original()
 # A separate once directory holds only this independent reader's two GET records.
 r.RECORDS=Path(c.SCOPE['remoteDirectory'])/'independent-readback-once';r.RECORDS.mkdir(mode=0o700)
 (r.RECORDS/'empty-docker-config').mkdir(mode=0o700);(r.RECORDS/'empty-home').mkdir(mode=0o700)
 fd=os.open(r.RECORDS/'empty-docker-config/config.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b'{"auths":{}}\n')
 rc,data=r.command('independent-original-id',['container','inspect',result['originalContainerId'],'--format','{{json .}}'],15)
 c.guard(r.missing_container(rc,data,result['originalContainerId']),'independent-original-notfound-required')
 c.guard(r.labelled_ids('independent-original-label',request)==[],'independent-label-empty-required')
 result.update(schema='trusted-pi-native-resource-snapshot-host-independent-readback/v1',dockerGets=2,originalIdNotFound=True,labelListEmpty=True,cleanupConfirmed=True)
 r.write_new('result.json',result);return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--execute-readonly',action='store_true');p.add_argument('--request-id',required=True);p.add_argument('--grant-sha256',required=True);a=p.parse_args()
 try:
  c.guard(a.execute_readonly,'explicit-readonly-execute-required');print(json.dumps(execute(a.request_id,a.grant_sha256),sort_keys=True))
 except BaseException as e:
  print(json.dumps({'status':'unknown-stopped','errorCode':str(e) if isinstance(e,(c.Stop,r.Stop)) else 'reader-local-error'}));sys.exit(1)
