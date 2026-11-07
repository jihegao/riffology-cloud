#!/usr/bin/env python3
"""One fixed stderr read. No raw error text, Docker, network or writes."""
import argparse,datetime as dt,hashlib,json,os,re,sys
from pathlib import Path
ROOT=Path('/tmp/riffoid-jhg46-image-20261017.AU613w/pi-package-mode-repair-v1/build-probe-once')
REQUEST='a21af2c8-44ff-4f67-a07f-c364bcd6d295'
EXPECTED_SHA='0b018b22134813869c9f00c8b051049b0e00082ab66a1773d1de00024b78351c'
KNOWN_PATHS=['/compat-input/probe/compatibility-probe.mjs', '/compat-input/input-manifest.json', '/opt/riffology/browser-preview/runtime/sha256.mjs', '/opt/riffology/project-resources/text.mjs', '/opt/riffology/runtime/controlled-pi.mjs', '/opt/riffology/trusted-pi/release-candidate.mjs', '/opt/riffology/trusted-pi/research-context.mjs', '/opt/riffology/trusted-pi/trusted-pi-release.mjs', '/opt/riffology/trusted-pi/trusted-pi-turn-host.mjs', '/opt/riffology/trusted-pi/product-model-transport.mjs', '/opt/riffology/trusted-pi/product-tool-bridge.mjs', '/opt/riffology/runtime_supervisor.py', '/opt/riffology/package.json', '/opt/riffology/package-lock.json']
class Stop(Exception):pass
def guard(ok,code):
 if not ok:raise Stop(code)
def observe():
 guard(sys.platform=='linux' and ROOT.resolve()==ROOT and ROOT.is_dir() and ROOT.stat().st_uid==os.getuid() and ROOT.stat().st_mode&0o7777==0o700,'fixed-owned-private-records')
 p=ROOT/'start-original-once.stderr';guard(p.resolve()==p and p.is_file() and not p.is_symlink(),'fixed-regular-stderr')
 s=p.stat();guard(s.st_uid==os.getuid() and not s.st_mode&0o077 and s.st_size==924,'fixed-stderr-metadata')
 b=p.read_bytes();h=hashlib.sha256(b).hexdigest();guard(len(b)==924 and h==EXPECTED_SHA,'fixed-stderr-sha-size')
 text=b.decode('utf8')
 result={'schema':'trusted-pi-package-permissions-fixed-stderr-path-classification/v1','requestId':REQUEST,'observedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'bytes':len(b),'sha256':h,'knownErrorEACCES':bool(re.search(r"(?:code:\s*['\"]EACCES['\"]|\bEACCES:)",text)),'knownSyscallFields':sorted(set(re.findall(r"\bsyscall:\s*['\"](open|read|access)['\"]",text))),'knownPathMatches':[],'nodeVersions':sorted(set(re.findall(r'(?m)^Node\.js v(\d{1,3}\.\d{1,3}\.\d{1,4})\s*$',text)))[:4],'rawMessageOrBodyReturned':False,'dockerCommands':0,'remoteWrites':0,'otherFileRead':False}
 for path in KNOWN_PATHS:
  field=bool(re.search(r"\bpath:\s*['\"]"+re.escape(path)+r"['\"]",text))
  actions=sorted(set(re.findall(r"\b(open|read|access)\s+['\"]"+re.escape(path)+r"['\"]",text)))
  result['knownPathMatches'].append({'path':path,'exactPathFieldMatched':field,'messageActions':actions})
 result['matchedKnownPaths']=[x['path'] for x in result['knownPathMatches'] if x['exactPathFieldMatched'] or x['messageActions']]
 result['status']='fixed-stderr-whitelist-classified'
 return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--execute-readonly',action='store_true');a=p.parse_args()
 try:
  guard(a.execute_readonly,'explicit-readonly-required');print(json.dumps(observe(),sort_keys=True));return 0
 except BaseException as e:
  print(json.dumps({'requestId':REQUEST,'status':'readback-unknown','errorCode':str(e) if isinstance(e,Stop) else 'readback-local-error','dockerCommands':0,'remoteWrites':0}));return 1
if __name__=='__main__':sys.exit(main())
