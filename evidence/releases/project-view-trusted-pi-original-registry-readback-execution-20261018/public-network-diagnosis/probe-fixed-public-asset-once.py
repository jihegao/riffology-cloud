#!/usr/bin/env python3
"""Read one already-published static wheel; never execute or retain its body."""
import datetime, hashlib, json, os, signal, time, urllib.error, urllib.request
from pathlib import Path

base = Path(__file__).resolve().parent
os.mkdir(base / 'fixed-asset-once', 0o700)
digest = '8512aee3e4b36b5a79523628d97d0d34612a366aecbb5b44a08c7ae45dd50d57'
url = 'https://app.riffoid.com/browser-preview-assets/'+digest+'/assets/scipy-1.18.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl'
expected = 14029768

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

def interrupted(signum, frame):
    raise TimeoutError('public-static-asset-deadline')

started = datetime.datetime.now(datetime.timezone.utc).isoformat()
clock = time.monotonic()
h = hashlib.sha256(); count = 0; response = None; complete = False; closed = False
status = None; error = None
signal.signal(signal.SIGALRM, interrupted); signal.alarm(45)
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://127.0.0.1:7892'}),NoRedirect())
    req = urllib.request.Request(url,headers={'Accept-Encoding':'identity'},method='GET')
    response = opener.open(req,timeout=20);status = response.status
    if status != 200: raise ValueError('public-static-http-status')
    while True:
        chunk = response.read(65536)
        if not chunk: complete = True; break
        count += len(chunk);h.update(chunk)
        if count > expected: raise ValueError('public-static-oversize')
except BaseException as exc:
    error = type(exc).__name__
    if isinstance(exc,urllib.error.HTTPError):
        response=exc;status=exc.code
finally:
    signal.alarm(0)
    if response is not None:
        response.close();closed=True
elapsed = time.monotonic()-clock
r = {'schema':'jhg46-fixed-public-asset-path-diagnosis/v1',
     'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
     'publicUrl':url,'expectedBytes':expected,'expectedSha256':digest,
     'startedAt':started,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
     'seconds':elapsed,'bytesPerSecond':count/elapsed,'httpStatus':status,'capturedBytes':count,
     'capturedSha256':h.hexdigest(),'responseCaptureComplete':complete,'responseClosed':closed,
     'bytesAndHashMatched':complete and count==expected and h.hexdigest()==digest,
     'exceptionClass':error,'maxSeconds':45,'automaticRetries':0,'redirectsFollowed':0,
     'bodyStoredOrExecuted':False,'credentialsReadOrSent':False,'registryCalls':0,
     'newSshRoutes':0,'registryBandwidthOrCauseProved':False}
raw=(json.dumps(r,sort_keys=True,indent=2)+'\n').encode()
fd=os.open(base/'fixed-asset.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb') as stream: stream.write(raw)
print(json.dumps(r,sort_keys=True))
