#!/usr/bin/env python3
"""Review-only until a new exact grant; cached-image mock once, never builds."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time
import probe_common as common

ROOT = Path(common.SCOPE['remoteDirectory'])
PREVIOUS_ROOT = Path(common.SCOPE['originalDirectory'])
REQUEST = common.SCOPE['requestId']
RECORDS = ROOT / 'mock-probe-once'
IMAGE_ID = common.SCOPE['imageId']
MANIFEST = 'f27b35dcbe84b58e3442018332374dbf20fa0d315528a322e56ea2a2bcfea5d4'
DOCKER = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock']
CID = re.compile(r'^[a-f0-9]{64}$')
IMAGE = re.compile(r'^sha256:[a-f0-9]{64}$')
LABEL_KEY = 'riffology.jhg46.pi-probe-readable-operation'
ORIGINAL_REQUEST = 'a21af2c8-44ff-4f67-a07f-c364bcd6d295'
ORIGINAL_CID = '65714c5c5e5377ca8f761c8a1a85d6baa5bd18bc994f95c0ae07db24c4d7ec19'
ORIGINAL_LABEL_KEY = 'riffology.jhg46.pi-package-permissions-operation'
ORIGINAL_RECORDS = PREVIOUS_ROOT / 'build-probe-once'
ORIGINAL_FILES = {
 'derived-image-inspect.stdout':(4824,'6fbb8b6aa87d9e89504f3ec229d83c53248ef3948bc5b1fa52f144a388ef8005'),
 'derived-image-identity.json':(2996,'fc8118b579fcba2a139cc1cd6167117a0c8e673973a61db5d4f330339ac42675'),
 'result.json':(1123,'eedd2b8901018fd0880cd4a02a32196c01c339023267c3076c8a3bdba216bcdb'),
 'original-container-cleanup.json':(178,'b7efc2bbacd27747eeff970e922faf16a05d7ccb5cd26bcaa7769d7b09470bb6')}
PAYLOAD = common.SCOPE['payload']
CHECKS = ['allTargetBytes', 'activeReleaseAlias', 'actualControlledPiAndProductRelease',
          'explicitSkillRevisionPathAndSha', 'unselectedBodyAbsent', 'noModelSpecFixedSimulationPrompt',
          'coldRestoreNoReplay', 'sameSourceHistoricalProvenance', 'newSourceDoesNotInheritLoadedMarker',
          'crossProjectRejected', 'synthetic503NoRetry', 'sdkCancelAbortedAndSettled',
          'allSessionsDisposed', 'temporaryDirectoryRemoved', 'environmentOnlyPath']

class Stop(Exception):
    pass

def guard(ok, code):
    if not ok:
        raise Stop(code)

def sha(b):
    return hashlib.sha256(b).hexdigest()

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def write_new(name, data):
    b = (json.dumps(data, sort_keys=True, indent=2) + '\n').encode()
    fd = os.open(RECORDS / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(b); out.flush(); os.fsync(out.fileno())

def read_bounded(path, limit):
    guard(path.is_file() and not path.is_symlink() and path.stat().st_size <= limit, 'bounded-regular-file')
    return path.read_bytes()

def verify_inputs():
    guard(sys.platform == 'linux' and ROOT.is_dir() and not ROOT.is_symlink() and ROOT.resolve() == ROOT, 'fixed-linux-task-directory')
    guard(ROOT.stat().st_uid == os.getuid() and stat.S_IMODE(ROOT.stat().st_mode) == 0o700, 'private-task-directory')
    guard(stat.S_ISSOCK(os.stat('/var/run/docker.sock').st_mode), 'fixed-daemon-socket')
    for name, item in PAYLOAD.items():
        path = ROOT / name
        guard(path.resolve() == path, 'payload-path-link')
        b = read_bounded(path, 262144);st=path.stat()
        guard(len(b) == item['bytes'] and sha(b) == item['sha256'], 'frozen-payload-drift')
        guard(st.st_uid == os.getuid() and stat.S_IMODE(st.st_mode) == 0o444, 'only-public-probe-inputs-must-be0444')
    guard(PREVIOUS_ROOT.resolve()==PREVIOUS_ROOT and ORIGINAL_RECORDS.resolve()==ORIGINAL_RECORDS
          and stat.S_IMODE(ORIGINAL_RECORDS.stat().st_mode)==0o700, 'private-original-a21-records')
    data={}
    for name,(size,digest) in ORIGINAL_FILES.items():
        raw=read_bounded(ORIGINAL_RECORDS/name,131072)
        guard(len(raw)==size and sha(raw)==digest,'original-a21-record-byte-drift');data[name]=json.loads(raw)
    cleanup_record=data['original-container-cleanup.json']
    guard(cleanup_record.get('originalContainerId')==ORIGINAL_CID and cleanup_record.get('cleanupConfirmed') is True
          and cleanup_record.get('originalIdAbsent') is True and cleanup_record.get('labelListEmpty') is True,'original-a21-cleanup-record')
    return data

def process_start_ticks(pid):
    try:
        return Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()[19]
    except FileNotFoundError:
        return None


def command(name, arguments, timeout, limit=131072):
    """Fixed Docker only, no shell/credential inheritance; keep bounded raw logs."""
    config = RECORDS / 'empty-docker-config'
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(RECORDS / 'empty-home'), 'DOCKER_CONFIG': str(config)}
    argv = DOCKER + ['--config', str(config)] + arguments
    write_new(name + '.intent.json', {'argv': argv, 'startedAt': utc(), 'timeoutSeconds': timeout,
                                     'perStreamByteLimit': limit})
    files = {k: os.open(RECORDS / (name + '.' + k), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
             for k in ('stdout', 'stderr')}
    data = {k: bytearray() for k in files}
    total = {k: 0 for k in files}
    proc = None
    failure = None
    rc = None
    original_pid = None
    original_ticks = None
    began = time.monotonic()
    try:
        proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=env, start_new_session=True)
        original_pid = proc.pid
        original_ticks = process_start_ticks(proc.pid)
        write_new(name + '.original-cli.json', {'pid': original_pid, 'linuxStartTicks': original_ticks, 'observedAt': utc()})
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdout, selectors.EVENT_READ, 'stdout')
            selector.register(proc.stderr, selectors.EVENT_READ, 'stderr')
            end = began + timeout
            while selector.get_map():
                guard(time.monotonic() < end, 'command-timeout')
                for key, _ in selector.select(min(0.5, end - time.monotonic())):
                    block = os.read(key.fileobj.fileno(), 16384)
                    if not block:
                        selector.unregister(key.fileobj); continue
                    label = key.data; total[label] += len(block)
                    kept = block[:max(0, limit - len(data[label]))]
                    data[label].extend(kept); os.write(files[label], kept)
            rc = proc.wait(timeout=max(0.1, end - time.monotonic()))
    except BaseException as exc:
        failure = str(exc) if isinstance(exc, Stop) else 'command-local-error'
    finally:
        if proc and proc.poll() is None:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(proc.pid, sig)
                except ProcessLookupError:
                    pass
                except BaseException:
                    failure = 'original-cli-stop-unconfirmed'
                try:
                    proc.wait(timeout=5); break
                except subprocess.TimeoutExpired:
                    continue
                except BaseException:
                    failure = 'original-cli-stop-unconfirmed'
            if proc.poll() is None:
                failure = 'original-cli-stop-unconfirmed'
        if proc:
            rc = proc.poll()
            for pipe in (proc.stdout, proc.stderr):
                if pipe:
                    pipe.close()
        for fd in files.values():
            os.close(fd)
        result = {'exitCode': rc, 'error': failure, 'endedAt': utc(),
                  'originalCliPid': original_pid, 'originalCliLinuxStartTicks': original_ticks,
                  'originalCliReaped': proc is not None and proc.poll() is not None, 'elapsedSeconds': round(time.monotonic() - began, 3),
                  'streams': {k: {'bytesObserved': total[k], 'bytesSaved': len(data[k]),
                                  'discardedBytes': total[k] - len(data[k]), 'sha256': sha(data[k])} for k in files}}
        write_new(name + '.result.json', result)
    guard(failure is None and all(total[k] == len(data[k]) for k in files), 'command-unknown-or-output-discarded-' + name)
    return rc, {k: bytes(v) for k, v in data.items()}

def checked(name, args, seconds, limit=131072):
    rc, data = command(name, args, seconds, limit)
    guard(rc == 0, 'command-nonzero-' + name)
    return data

def docker_json(name, args, seconds=15):
    raw = checked(name, args, seconds)['stdout']
    try:
        return json.loads(raw)
    except Exception:
        raise Stop('invalid-json-' + name) from None

def labelled_ids(name, request):
    raw = checked(name, ['ps', '--all', '--quiet', '--no-trunc', '--filter', 'label=' + LABEL_KEY + '=' + request], 15)['stdout']
    ids = raw.decode('ascii').splitlines()
    guard(len(ids) <= 1 and all(CID.fullmatch(x) for x in ids), 'original-label-identity-unknown')
    return ids

def missing_container(rc, data, original):
    # Strict, actual Docker forms only. Unknown/errors/empty listings are not404.
    return rc == 1 and data['stdout'].strip() in (b'', b'[]') and data['stderr'].decode('utf8', 'replace').strip() in (
        'Error: No such object: ' + original,
        'Error response from daemon: No such container: ' + original)

def inspect_original(name, original, request, image_id):
    rc, data = command(name, ['container', 'inspect', original, '--format', '{{json .}}'], 15)
    if missing_container(rc, data, original):
        return None
    guard(rc == 0, 'original-inspect-unknown')
    info = json.loads(data['stdout'])
    guard(info.get('Id') == original and info.get('Config', {}).get('Labels', {}).get(LABEL_KEY) == request
          and info.get('Image') == image_id, 'original-container-identity-mismatch')
    return info

def cleanup(request, image_id, original):
    result = {'originalContainerId': original, 'cleanupConfirmed': False}
    try:
        ids = labelled_ids('cleanup-label-before', request)
        if original is None and len(ids) == 1:
            original = ids[0]; result['originalContainerId'] = original
        guard(original is not None and CID.fullmatch(original), 'original-id-not-established')
        guard(not ids or ids == [original], 'original-label-conflict')
        info = inspect_original('cleanup-original-before', original, request, image_id)
        if info is not None:
            # One original-ID removal; unknown result is reconciled, never replayed.
            try:
                command('cleanup-original-remove', ['rm', '--force', original], 20)
            except BaseException:
                result['removeAckUnknown'] = True
        result['originalIdAbsent'] = inspect_original('cleanup-original-after', original, request, image_id) is None
        result['labelListEmpty'] = labelled_ids('cleanup-label-after', request) == []
        result['cleanupConfirmed'] = result['originalIdAbsent'] and result['labelListEmpty']
    except BaseException as exc:
        result['errorCode'] = str(exc) if isinstance(exc, Stop) else 'cleanup-local-error'
    write_new('original-container-cleanup.json', result)
    return result

def validate_cached_image(fresh, original):
    guard(fresh.get('Id') == IMAGE_ID and fresh.get('Os') == 'linux' and fresh.get('Architecture') == 'amd64', 'fixed-cached-local-engine-image')
    descriptor={'digest':IMAGE_ID,'mediaType':'application/vnd.oci.image.index.v1+json','size':856}
    guard(all(fresh.get('Descriptor',{}).get(k)==v for k,v in descriptor.items()), 'fixed-original-local-index-role')
    guard(fresh.get('Config',{}).get('User')=='root' and fresh.get('Config',{}).get('Entrypoint')==['/container-server/sandbox'], 'original-root-supervisor-contract')
    guard(original.get('Id')==IMAGE_ID and all(fresh.get('Config',{}).get(k)==original.get('Config',{}).get(k)
          for k in ('User','Entrypoint','Cmd','WorkingDir','Env')), 'original-a21-launch-config-matched')
    layers=fresh.get('RootFS',{}).get('Layers')
    guard(isinstance(layers,list) and len(layers)>0 and all(IMAGE.fullmatch(x) for x in layers)
          and fresh.get('RootFS')==original.get('RootFS'), 'original-a21-rootfs-exact-match')
    return {'engineId':IMAGE_ID,'engineIdRole':'descriptor','descriptor':descriptor,'launchConfigMatched':True,
            'rootfsMatched':True,'rootfsLayerCount':len(layers),'registryReadbackOrPublicationClaim':False}

def read_cid(path):
    guard(path.parent==RECORDS and RECORDS.resolve()==RECORDS and RECORDS.stat().st_uid==os.getuid()
          and stat.S_IMODE(RECORDS.stat().st_mode)==0o700, 'cid-private-parent-required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:
        st=os.fstat(f.fileno())
        guard(stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_nlink==1 and st.st_size<=256
              and not stat.S_IMODE(st.st_mode)&0o111, 'cid-owned-regular-bounded-no-execute')
        raw=f.read(257)
    value=raw.decode('ascii').strip();guard(CID.fullmatch(value),'exact-original-cid-required')
    return value

def validate_sandbox(info, image_id):
    config, host = info['Config'], info['HostConfig']
    guard(config.get('User') == '10002:10002' and config.get('WorkingDir') == '/tmp'
          and config.get('Entrypoint') == ['/usr/bin/env'] and info.get('Image') == image_id, 'probe-user-entrypoint')
    guard(host.get('NetworkMode') == 'none' and host.get('ReadonlyRootfs') is True
          and host.get('CapDrop') == ['ALL'] and host.get('SecurityOpt') == ['no-new-privileges']
          and host.get('PidsLimit') == 128 and host.get('Memory') == 768 * 1024 * 1024
          and host.get('NanoCpus') == 1000000000 and not host.get('Privileged')
          and not host.get('PortBindings') and not host.get('PublishAllPorts'), 'probe-sandbox-readback')
    binds = {x['Destination']: x for x in info.get('Mounts', []) if x.get('Type') == 'bind'}
    expected = {'/compat-input/probe/compatibility-probe.mjs': str(ROOT / 'probe/compatibility-probe.mjs'), '/compat-input/input-manifest.json': str(ROOT / 'input-manifest.json')}
    guard(set(binds) == set(expected) and all(binds[k].get('Source') == v and binds[k].get('RW') is False
          for k, v in expected.items()), 'probe-only-frozen-readonly-inputs')
    guard(all(x.get('Type') == 'bind' or x.get('Type') == 'tmpfs' and x.get('Destination') == '/tmp'
          for x in info.get('Mounts', [])), 'probe-unexpected-mount')
    guard(host.get('Tmpfs') == {'/tmp': 'rw,nosuid,nodev,size=64m,mode=1777'}, 'probe-bounded-tmpfs')


def validate_probe(raw, manifest):
    guard(len(raw) <= 131072, 'probe-stdout-limit')
    p = json.loads(raw)
    guard(p.get('schema') == 'trusted-pi-offline-compatibility-probe/v1' and p.get('mode') == 'image'
          and p.get('result') == 'passed' and p.get('manifestSha256') == MANIFEST, 'probe-mode-result')
    guard(p.get('uid') == 10002 and p.get('gid') == 10002 and p.get('activeAliasActuallyInspected') is True
          and p.get('sourceEquivalentActiveRelease') is False and p.get('sourceMacEncodingNormalized') is False
          and p.get('checkedTargets') == 12 and p.get('overlayTargets') == 6, 'probe-actual-image-user-and-alias')
    guard(set(p.get('checks', {})) == set(CHECKS) and all(p['checks'][k] is True for k in CHECKS), 'probe-all-checks')
    expected = [{'imagePath': x['imagePath'], 'bytes': x['bytes'], 'sha256': x['sha256']} for x in manifest['fileTargets']]
    guard(p.get('imageTargets') == expected, 'probe-all12-frozen-targets')
    guard(p.get('syntheticRequests') == {'model': 3, 'research': 1, 'projectToolExecutions': 0, 'ambientFetchCalls': 0}
          and p.get('realProviderRequests') == 0 and p.get('credentialsReadByProbe') is False, 'probe-fake-only')
    return p

def execute(request, grant_sha):
    guard(request == REQUEST, 'only-fixed-probe-readable-request')
    authorization = common.verify_installed_authorization(grant_sha)
    originals = verify_inputs()
    RECORDS.mkdir(mode=0o700) # Permanent one-attempt lock; no replay after any outcome.
    (RECORDS / 'empty-docker-config').mkdir(mode=0o700)
    (RECORDS / 'empty-home').mkdir(mode=0o700)
    fd = os.open(RECORDS / 'empty-docker-config/config.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(b'{"auths":{}}\n')
    write_new('intent.json', {'requestId': request, 'parentRequestId': ORIGINAL_REQUEST, 'at': utc(),
              'imageId': IMAGE_ID, 'oneBuild': False, 'oneCreate': True, **authorization})
    status = {'schema': 'trusted-pi-probe-readable-result/v1', 'requestId': request, 'status': 'unknown-stopped',
              'parentRequestId': ORIGINAL_REQUEST, 'imageId':IMAGE_ID, 'archiveSha256': common.SCOPE['archive']['sha256'],
              'noCloudOrProviderAcceptanceClaim': True, 'buildPullPushExportPerformed':False}
    original = None
    image_id = IMAGE_ID
    create_attempted = False
    try:
        # Original request cleanup is rechecked, never restarted or modified.
        rc,raw=command('previous-a21-cid-inspect',['container','inspect',ORIGINAL_CID,'--format','{{json .}}'],15)
        guard(missing_container(rc,raw,ORIGINAL_CID),'previous-a21-original-cid-must-be-absent')
        prev=checked('previous-a21-label',['ps','--all','--quiet','--no-trunc','--filter','label='+ORIGINAL_LABEL_KEY+'='+ORIGINAL_REQUEST],15)['stdout']
        guard(prev.strip()==b'','previous-a21-label-must-be-empty')
        image = docker_json('cached-image-inspect', ['image', 'inspect', IMAGE_ID, '--format', '{{json .}}'])
        status['cachedImageIdentity']=validate_cached_image(image, originals['derived-image-inspect.stdout'])
        write_new('cached-image-identity.json',status['cachedImageIdentity'])
        guard(labelled_ids('probe-label-before', request) == [], 'original-probe-label-already-present')
        write_new('create-once-intent.json', {'requestId': request, 'imageId': image_id, 'labelKey': LABEL_KEY,
                  'cidfile': str(RECORDS / 'probe.cid'), 'at': utc()})
        create_attempted = True
        created = checked('create-once', ['create', '--cidfile', str(RECORDS / 'probe.cid'), '--label', LABEL_KEY + '=' + request,
                  '--network=none', '--user=10002:10002', '--read-only', '--cap-drop=ALL',
                  '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=768m', '--cpus=1',
                  '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,mode=1777', '--workdir=/tmp',
                  '--mount', 'type=bind,src=' + str(ROOT / 'probe/compatibility-probe.mjs') + ',dst=/compat-input/probe/compatibility-probe.mjs,readonly',
                  '--mount', 'type=bind,src=' + str(ROOT / 'input-manifest.json') + ',dst=/compat-input/input-manifest.json,readonly',
                  '--entrypoint=/usr/bin/env', image_id, '-i', 'PATH=/usr/local/bin:/usr/bin:/bin',
                  '/usr/local/bin/node', '/compat-input/probe/compatibility-probe.mjs', '--manifest',
                  '/compat-input/input-manifest.json', '--manifest-sha256', MANIFEST], 30)['stdout'].decode().strip()
        original = read_cid(RECORDS / 'probe.cid')
        guard(CID.fullmatch(original) and created == original, 'original-create-ack-cid')
        info = inspect_original('created-original-inspect', original, request, image_id)
        guard(info is not None and info.get('State', {}).get('Status') == 'created', 'original-created-state')
        validate_sandbox(info, image_id)
        probe = checked('start-original-once', ['start', '--attach', original], 30)
        waited = checked('wait-original', ['wait', original], 10)['stdout'].decode().strip()
        state = inspect_original('completed-original-inspect', original, request, image_id)
        guard(waited == '0' and state is not None and state.get('State', {}).get('Running') is False
              and state.get('State', {}).get('ExitCode') == 0 and state.get('State', {}).get('Status') == 'exited', 'original-exit-zero-required')
        report = validate_probe(probe['stdout'], json.loads((ROOT / 'input-manifest.json').read_bytes()))
        write_new('probe-report.json', report)
        status['status'] = 'mock-image-probe-passed-cleanup-pending'
    except BaseException as exc:
        status['errorCode'] = str(exc) if isinstance(exc, Stop) else 'runner-local-error'
    finally:
        if create_attempted:
            if original is None and (RECORDS / 'probe.cid').exists():
                try: original = read_cid(RECORDS / 'probe.cid')
                except BaseException: pass
            result = cleanup(request, image_id, original)
            status['cleanup'] = result
            if status['status'] == 'mock-image-probe-passed-cleanup-pending' and result['cleanupConfirmed']:
                status['status'] = 'offline-image-compatibility-mock-passed'
        else:
            status['cleanup'] = {'containerCreateNeverAttempted': True, 'cleanupConfirmed': True}
        status['endedAt'] = utc()
        write_new('result.json', status)
    return status

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--request-id', required=True)
    parser.add_argument('--grant-sha256', required=True)
    args = parser.parse_args()
    try:
        guard(args.execute, 'explicit-execute-required-no-default-run')
        def interrupt(*_):
            raise Stop('runner-interrupted-original-identity-only')
        for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(sig, interrupt)
        result = execute(args.request_id, args.grant_sha256)
        print(json.dumps(result, sort_keys=True))
        return 0 if result['status'] == 'offline-image-compatibility-mock-passed' else 1
    except BaseException as exc:
        print(json.dumps({'status': 'unknown-stopped', 'errorCode': str(exc) if isinstance(exc, Stop) else 'runner-local-error'}))
        return 1

if __name__ == '__main__':
    sys.exit(main())
