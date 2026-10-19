#!/usr/bin/env python3
"""Two bounded public GETs; never access Registry or credentials."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

BASE = Path(__file__).resolve().parent
URL = 'https://speed.cloudflare.com/__down?bytes=1048576'
FORMAT = '%{http_code} %{size_download} %{time_total} %{speed_download} %{num_redirects}\n'
ENV = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin'}

def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def save(name, value):
    raw = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
    fd = os.open(BASE / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)

def metrics(raw):
    parts = raw.decode('ascii').strip().split()
    if len(parts) != 5:
        raise ValueError('public-metrics-shape')
    status, size, total, speed, redirects = parts
    result = {'httpStatus': int(status), 'capturedBytes': int(float(size)),
              'seconds': float(total), 'bytesPerSecond': float(speed),
              'redirectsFollowed': int(redirects)}
    if result['capturedBytes'] < 0 or result['capturedBytes'] > 1048576 or result['redirectsFollowed'] != 0:
        raise ValueError('public-metrics-bounds')
    return result

def curl_args(proxy):
    return ['/usr/bin/curl', '-q', '--silent', '--show-error', '--proto', '=https',
            '--connect-timeout', '10', '--max-time', '20', '--max-filesize', '1048576',
            '--output', '/dev/null', '--write-out', FORMAT, '--proxy', proxy,
            '--noproxy', '' if proxy else '*', URL]

def run_local():
    started = utc()
    p = subprocess.run(curl_args('http://127.0.0.1:7892'), env=ENV, capture_output=True, timeout=35)
    return {'name': 'mac-existing-loopback-proxy', 'startedAt': started, 'endedAt': utc(),
            'exitCode': p.returncode, **metrics(p.stdout),
            'stderr': {'bytes': len(p.stderr), 'sha256': sha(p.stderr)}}

REMOTE = r'''import datetime,hashlib,json,subprocess
url='https://speed.cloudflare.com/__down?bytes=1048576'
fmt='%{http_code} %{size_download} %{time_total} %{speed_download} %{num_redirects}\n'
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
argv=['/usr/bin/curl','-q','--silent','--show-error','--proto','=https','--connect-timeout','10','--max-time','20','--max-filesize','1048576','--output','/dev/null','--write-out',fmt,'--proxy','','--noproxy','*',url]
p=subprocess.run(argv,env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin'},capture_output=True,timeout=35)
parts=p.stdout.decode('ascii').strip().split()
assert len(parts)==5
status,size,total,speed,redirects=parts
r={'name':'amd-direct-no-proxy','startedAt':started,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':p.returncode,'httpStatus':int(status),'capturedBytes':int(float(size)),'seconds':float(total),'bytesPerSecond':float(speed),'redirectsFollowed':int(redirects),'stderr':{'bytes':len(p.stderr),'sha256':hashlib.sha256(p.stderr).hexdigest()}}
assert 0<=r['capturedBytes']<=1048576 and r['redirectsFollowed']==0
print(json.dumps(r,sort_keys=True))
'''

def run_remote():
    argv = ['/usr/bin/ssh', '-T', '-oBatchMode=yes', '-oConnectTimeout=10',
            '-oForwardAgent=no', '-oClearAllForwardings=yes', '-oControlMaster=no',
            '-oControlPath=none', '-oPermitLocalCommand=no', 'AMD128', '/usr/bin/python3 -']
    p = subprocess.run(argv, input=REMOTE.encode(), env=ENV, capture_output=True, timeout=45)
    result = {'transportExitCode': p.returncode, 'transportStderr': {'bytes': len(p.stderr), 'sha256': sha(p.stderr)}}
    if p.returncode == 0:
        r = json.loads(p.stdout)
        allowed = {'name','startedAt','endedAt','exitCode','httpStatus','capturedBytes','seconds','bytesPerSecond','redirectsFollowed','stderr'}
        assert set(r) == allowed and r['name'] == 'amd-direct-no-proxy'
        assert set(r['stderr']) == {'bytes','sha256'}
        assert 0 <= r['capturedBytes'] <= 1048576 and r['redirectsFollowed'] == 0
        result['observation'] = r
    else:
        result['stdout'] = {'bytes': len(p.stdout), 'sha256': sha(p.stdout)}
    return result

def main():
    os.mkdir(BASE / 'probe-once', 0o700)
    save('intent.json', {'schema':'jhg46-public-path-diagnosis/v1','at':utc(),
         'sourceSha256':sha(Path(__file__).read_bytes()),'publicUrl':URL,
         'plannedPublicGets':2,'perGetMaxSeconds':20,'perGetBodyLimitBytes':1048576,
         'bodyStored':False,'credentialsReadOrSent':False,'registryCalls':0,
         'newForwardingRoutes':0,'automaticRetries':0,
         'officialEndpointSource':'https://github.com/cloudflare/speedtest',
         'registryBandwidthProvedByThisProbe':False})
    for name, fn in [('mac-proxy.json', run_local), ('amd-direct.json', run_remote)]:
        try:
            result = fn()
        except BaseException as exc:
            result = {'exceptionClass':type(exc).__name__,'endedAt':utc(),'noAutomaticRetry':True}
        save(name, result)
    print(json.dumps({'status':'two-public-path-probes-ended','registryCalls':0,'registryBandwidthProved':False}))

if __name__ == '__main__':
    main()
