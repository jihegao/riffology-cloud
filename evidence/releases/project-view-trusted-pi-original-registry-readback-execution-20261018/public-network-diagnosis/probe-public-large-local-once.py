#!/usr/bin/env python3
"""One larger public GET to separate setup latency from sustained throughput."""
import datetime, hashlib, json, os, subprocess
from pathlib import Path

base = Path(__file__).resolve().parent
os.mkdir(base / 'large-local-once', 0o700)
url = 'https://speed.cloudflare.com/__down?bytes=16777216'
fmt = '%{http_code} %{size_download} %{time_total} %{speed_download} %{num_redirects}\n'
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
argv = ['/usr/bin/curl','-q','--silent','--show-error','--proto','=https',
        '--connect-timeout','10','--max-time','45','--max-filesize','16777216',
        '--output','/dev/null','--write-out',fmt,'--proxy','http://127.0.0.1:7892',
        '--noproxy','',url]
p = subprocess.run(argv,env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin'},capture_output=True,timeout=55)
parts = p.stdout.decode('ascii').strip().split()
assert len(parts) == 5
status,size,total,speed,redirects = parts
r = {'schema':'jhg46-public-large-local-path-diagnosis/v1',
     'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
     'publicUrl':url,'officialEndpointSource':'https://github.com/cloudflare/speedtest',
     'name':'mac-existing-loopback-proxy-large','startedAt':started,
     'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
     'exitCode':p.returncode,'httpStatus':int(status),'capturedBytes':int(float(size)),
     'seconds':float(total),'bytesPerSecond':float(speed),'redirectsFollowed':int(redirects),
     'maxSeconds':45,'requestedBytes':16777216,
     'stderr':{'bytes':len(p.stderr),'sha256':hashlib.sha256(p.stderr).hexdigest()},
     'bodyStored':False,'credentialsReadOrSent':False,'registryCalls':0,
     'automaticRetries':0,'registryBandwidthProved':False}
assert 0 <= r['capturedBytes'] <= 16777216 and r['redirectsFollowed'] == 0
raw=(json.dumps(r,sort_keys=True,indent=2)+'\n').encode()
fd=os.open(base/'large-local.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb') as f: f.write(raw)
print(json.dumps(r,sort_keys=True))
