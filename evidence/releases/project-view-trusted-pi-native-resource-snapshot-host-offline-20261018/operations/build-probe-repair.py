#!/usr/bin/env python3
"""Local review artifact; on AMD, one fixed offline build and original-CID mock probe."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import selectors
import signal
import stat
import subprocess
import sys
import time
import repair_common as common

ROOT = Path(common.SCOPE['remoteDirectory'])
REQUEST = common.SCOPE['requestId']
RECORDS = ROOT / 'build-probe-once'
BASE = common.SCOPE['baseImage']
MANIFEST = common.SCOPE['inputManifestSha256']
DOCKER = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock']
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
CID = re.compile(r'^[a-f0-9]{64}$')
IMAGE = re.compile(r'^sha256:[a-f0-9]{64}$')
LABEL_KEY = 'riffology.jhg46.pi-native-resource-snapshot-host-operation'
PAYLOAD = common.SCOPE['payload']
CHECKS = list(common.SCOPE['probeChecks'])

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
    guard(ROOT.stat().st_uid == os.getuid() and not ROOT.stat().st_mode & 0o022, 'private-task-directory')
    guard(stat.S_ISSOCK(os.stat('/var/run/docker.sock').st_mode), 'fixed-daemon-socket')
    for name, item in PAYLOAD.items():
        path = ROOT / name
        guard(path.resolve() == path, 'payload-path-link')
        b = read_bounded(path, 262144)
        guard(len(b) == item['bytes'] and sha(b) == item['sha256'], 'frozen-payload-drift')
    for name in ('input-manifest.json', 'probe/host-resource-snapshot-probe.mjs'):
        guard(stat.S_IMODE((ROOT / name).stat().st_mode) == 0o444, 'public-probe-input-mode0444')
    guard((ROOT / 'context/Dockerfile').read_text().splitlines()[0] == 'FROM ' + BASE, 'fixed-base')
    return {'priorHistoryPreserved': True, 'noPreviousAttemptReplayed': True}

def process_start_ticks(pid):
    try:
        return Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()[19]
    except FileNotFoundError:
        return None


def parse_default_builder(raw):
    lines = raw.decode('utf8').splitlines()
    markers = [i for i, line in enumerate(lines) if line.strip() == 'Nodes:']
    guard(len(markers) == 1, 'plain-inspect-complete-nodes-section-required')
    headers = lines[:markers[0]]
    names = [line.split(':', 1)[1].strip() for line in headers if line.startswith('Name:')]
    drivers = [line.split(':', 1)[1].strip() for line in headers if line.startswith('Driver:')]
    guard(names == ['default'] and drivers == ['docker'], 'existing-default-builder-required')
    return {'Name': names[0], 'Driver': drivers[0]}


def command(name, arguments, timeout, limit=131072):
    """Fixed Docker only, no shell/credential inheritance; keep bounded raw logs."""
    config = RECORDS / 'empty-docker-config'
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'BUILDX_BUILDER': 'default',
           'HOME': str(RECORDS / 'empty-home'), 'DOCKER_CONFIG': str(config), 'DOCKER_API_VERSION':'1.56'}
    argv = DOCKER + ['--config', str(config)] + arguments
    write_new(name + '.intent.json', {'argv': argv, 'startedAt': utc(), 'timeoutSeconds': timeout,
                                     'perStreamByteLimit': limit, 'builder': 'default'})
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

def bind_build_identity(iid, metadata, image):
    config_digest = metadata.get('containerimage.config.digest')
    digest = metadata.get('containerimage.digest')
    declared = metadata.get('containerimage.descriptor')
    actual = image.get('Descriptor')
    guard((config_digest is None or IMAGE.fullmatch(config_digest)) and IMAGE.fullmatch(digest or '')
          and isinstance(declared, dict) and isinstance(actual, dict), 'explicit-build-descriptor-required')
    guard(declared.get('digest') == digest and all(actual.get(k) == declared.get(k) for k in ('digest', 'mediaType', 'size'))
          and declared.get('mediaType') in ('application/vnd.oci.image.index.v1+json', 'application/vnd.oci.image.manifest.v1+json',
              'application/vnd.docker.distribution.manifest.list.v2+json', 'application/vnd.docker.distribution.manifest.v2+json')
          and isinstance(declared.get('size'), int) and declared['size'] > 0, 'actual-image-build-descriptor-mismatch')
    allowed = (digest,) if config_digest is None else (config_digest, digest)
    guard(iid in allowed and image.get('Id') in allowed, 'actual-image-build-iid-mismatch')
    return {'configDigest': config_digest, 'descriptorDigest': digest,
            'iidRole': 'config' if config_digest is not None and iid == config_digest else 'descriptor',
            'engineIdRole': 'config' if config_digest is not None and image['Id'] == config_digest else 'descriptor',
            'descriptorCoreMatched': True}


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
    expected = {'/compat-input/probe/host-resource-snapshot-probe.mjs': str(ROOT / 'probe/host-resource-snapshot-probe.mjs'), '/compat-input/input-manifest.json': str(ROOT / 'input-manifest.json')}
    guard(set(binds) == set(expected) and all(binds[k].get('Source') == v and binds[k].get('RW') is False
          for k, v in expected.items()), 'probe-only-frozen-readonly-inputs')
    guard(all(x.get('Type') == 'bind' or x.get('Type') == 'tmpfs' and x.get('Destination') == '/tmp'
          for x in info.get('Mounts', [])), 'probe-unexpected-mount')
    guard(host.get('Tmpfs') == {'/tmp': 'rw,nosuid,nodev,size=64m,mode=1777'}, 'probe-bounded-tmpfs')


def validate_probe(raw, manifest):
    guard(len(raw) <= 131072, 'probe-stdout-limit')
    p = json.loads(raw)
    guard(p.get('schema') == 'trusted-pi-native-resource-snapshot-host-probe/v1' and p.get('requestId') == REQUEST and p.get('mode') == 'image'
          and p.get('result') == 'passed' and p.get('manifestSha256') == MANIFEST, 'probe-mode-result')
    guard(p.get('uid') == 10002 and p.get('gid') == 10002 and p.get('checkedTargets') == 12
          and p.get('overlayTargets') == 1, 'probe-image-user-targets')
    guard(set(p.get('checks', {})) == set(CHECKS) and all(p['checks'][k] is True for k in CHECKS), 'probe-all-checks')
    expected = [{'imagePath': x['imagePath'], 'bytes': x['bytes'], 'sha256': x['sha256']} for x in manifest['fileTargets']]
    guard(p.get('imageTargets') == expected, 'probe-all12-frozen-targets')
    guard(p.get('realProviderRequests') == 0 and p.get('credentialsReadByProbe') is False
          and p.get('sourceMacEncodingNormalized') is False
          and p.get('syntheticRequests') == {'model':3,'research':3,'projectToolExecutions':0,'ambientFetch':0,'sessionCreations':3,'sessionDisposals':3}, 'probe-synthetic-only')
    return p

# Closed official OCI+Docker image configuration representation contract.
# Sources pinned in official-config-contract.json; daemon API fixed to1.56.
CONFIG_TYPES = {'User':'str','ExposedPorts':'set','Env':'list','Entrypoint':'list','Cmd':'list',
                'Volumes':'set','WorkingDir':'str','Labels':'labels','StopSignal':'str','ArgsEscaped':'bool',
                'Healthcheck':'health','OnBuild':'list','Shell':'list'}
LEGACY_149 = {'AttachStderr':False,'AttachStdin':False,'AttachStdout':False,'Domainname':'','Hostname':'',
              'Image':'','OpenStdin':False,'StdinOnce':False,'Tty':False}
def config_normal_form(raw, api='1.56', engine=False):
    guard(type(raw) is dict and api in ('1.49','1.50','1.51','1.56'), 'closed-config-object-api')
    fields=dict(raw)
    for key in set(fields)-set(CONFIG_TYPES):
        guard(engine and api=='1.49' and key in LEGACY_149
              and type(fields[key]) is type(LEGACY_149[key]) and fields[key]==LEGACY_149[key], 'unknown-or-nondefault-config-field')
        del fields[key]
    result={}
    for key,value in fields.items():
        kind=CONFIG_TYPES[key]
        if kind=='str':
            guard(type(value) is str,'config-string');normal=value
        elif kind=='bool':
            guard(type(value) is bool,'config-boolean');normal=value
        elif kind=='list':
            guard(value is None or type(value) is list and all(type(x) is str for x in value),'config-string-array');normal=value or None
        elif kind in ('set','labels'):
            guard(value is None or type(value) is dict and all(type(k) is str and (type(v) is dict and not v if kind=='set' else type(v) is str) for k,v in value.items()),'config-map')
            normal=value or None
        else:
            guard(value is None or type(value) is dict,'config-healthcheck')
            normal={}
            for h,v in (value or {}).items():
                guard(h in ('Test','Interval','Timeout','StartPeriod','StartInterval','Retries'),'config-healthcheck-field')
                if h=='Test':
                    guard(v is None or type(v) is list and all(type(x) is str for x in v),'config-healthcheck-test')
                    if v:normal[h]=v
                else:
                    guard(type(v) is int and v>=0,'config-healthcheck-integer')
                    if v:normal[h]=v
            normal=None if value is None else normal
        # Only official typed zero values are omission-equivalent, never generic null removal.
        if normal not in (None,'',False) or type(normal) is int:result[key]=normal
    return result

def verify_config_representation(engine, raw, api='1.56'):
    guard(config_normal_form(engine,api,True)==config_normal_form(raw,api,False),'base-original-config')
    return True

def verify_cached_base(base, index_raw, manifest_raw, config_raw):
    pins = common.SCOPE['baseRawRecords']
    for key, raw in [('index', index_raw), ('manifest', manifest_raw), ('config', config_raw)]:
        guard(len(raw) == pins[key]['bytes'] and sha(raw) == pins[key]['sha256'], 'original-small-raw-' + key)
    index, manifest, config = [json.loads(x) for x in (index_raw, manifest_raw, config_raw)]
    guard(any(x.get('digest') == 'sha256:' + pins['manifest']['sha256'] and x.get('size') == pins['manifest']['bytes']
              for x in index.get('manifests', [])), 'base-index-manifest-chain')
    guard(manifest.get('config', {}).get('digest') == 'sha256:' + pins['config']['sha256']
          and manifest.get('config', {}).get('size') == pins['config']['bytes'], 'base-manifest-config-chain')
    guard(base.get('Id') == common.SCOPE['baseEngineId'] and base.get('Descriptor', {}).get('digest') == common.SCOPE['baseEngineId']
          and base.get('Descriptor', {}).get('size') == 856 and base.get('Os') == 'linux' and base.get('Architecture') == 'amd64', 'fixed-local-tag-identity')
    layers = config.get('rootfs', {}).get('diff_ids')
    guard(isinstance(layers, list) and len(layers) == 48 and base.get('RootFS', {}).get('Layers') == layers
          and len(manifest.get('layers', [])) == 48, 'base-original48-rootfs')
    verify_config_representation(base.get('Config'), config.get('config'), '1.56')
    guard(base['Config'].get('User') == 'root'
          and base['Config'].get('Entrypoint') == ['/container-server/sandbox'], 'base-original-config')
    return {'indexSha256': sha(index_raw), 'manifestSha256': sha(manifest_raw), 'configSha256': sha(config_raw),
            'rootfsLayers': 48, 'launchConfigMatched': True, 'noRepoDigestClaim': True}

def execute(request, grant_sha):
    guard(request == REQUEST, 'only-fixed-repair-request')
    authorization = common.verify_installed_authorization(grant_sha)
    input_guard = verify_inputs()
    # Fixed directory mkdir is the task-wide once lock, across every UUID.
    RECORDS.mkdir(mode=0o700)
    (RECORDS / 'empty-docker-config').mkdir(mode=0o700)
    (RECORDS / 'empty-home').mkdir(mode=0o700)
    fd = os.open(RECORDS / 'empty-docker-config/config.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(b'{"auths":{}}\n')
    write_new('intent.json', {'requestId': request, 'parentRequestId': common.SCOPE['parentRequestId'], 'at': utc(),
              'baseImage': BASE, 'oneBuild': True, 'oneCreate': True, **authorization})
    write_new('cached-base-entry-guard.json', input_guard)
    status = {'schema': 'trusted-pi-build-probe-result/v1', 'requestId': request, 'status': 'unknown-stopped',
              'parentRequestId': common.SCOPE['parentRequestId'], 'repairArchiveSha256': common.SCOPE['archive']['sha256'],
              'canonicalImplementationCommit': common.SCOPE['canonicalImplementationCommit'],
              'noCloudOrProviderAcceptanceClaim': True}
    original = None
    image_id = None
    create_attempted = False
    try:
        base = docker_json('base-inspect', ['image', 'inspect', BASE, '--format', '{{json .}}'])
        small = common.SCOPE['baseRawRecords']
        base_binding = verify_cached_base(base, *[read_bounded(Path(small[k]['path']), 131072) for k in ('index','manifest','config')])
        write_new('base-raw-chain-binding.json', base_binding)
        builder = parse_default_builder(checked('default-builder-inspect-plain', ['buildx', 'inspect', 'default'], 15)['stdout'])
        guard(builder.get('Name') == 'default' and builder.get('Driver') == 'docker', 'existing-default-builder-required')
        help_data = checked('build-help', ['build', '--help'], 15)
        guard(b'--metadata-file' in help_data['stdout'], 'metadata-file-supported-command-required')
        tag = 'riffology-jhg46-native-resource-snapshot-host:' + request
        # A unique local-only tag enables authoritative image lookup even when iid is a config identity.
        absent_rc, absent_data = command('derived-tag-before', ['image', 'inspect', tag], 15)
        guard(absent_rc == 1 and absent_data['stdout'].strip() in (b'', b'[]') and absent_data['stderr'].decode('utf8', 'replace').strip() in
              ('Error response from daemon: No such image: ' + tag, 'Error: No such image: ' + tag), 'derived-local-tag-must-be-absent')
        write_new('build-once-intent.json', {'tag': tag, 'at': utc(), 'baseImage': BASE})
        checked('build-once', ['build', '--network=none', '--pull=false', '--platform=linux/amd64',
                 '--iidfile', str(RECORDS / 'derived.iid'), '--metadata-file', str(RECORDS / 'build-metadata.json'),
                 '--tag', tag, '-f', str(ROOT / 'context/Dockerfile'), str(ROOT / 'context')], 600, 2097152)
        iid = read_bounded(RECORDS / 'derived.iid', 256).decode().strip()
        metadata = json.loads(read_bounded(RECORDS / 'build-metadata.json', 131072))
        image = docker_json('derived-image-inspect', ['image', 'inspect', tag, '--format', '{{json .}}'])
        image_id = image.get('Id')
        guard(IMAGE.fullmatch(image_id or '') and IMAGE.fullmatch(iid) and image.get('Os') == 'linux'
              and image.get('Architecture') == 'amd64', 'derived-image-identity')
        binding = bind_build_identity(iid, metadata, image)
        base_layers = base.get('RootFS', {}).get('Layers')
        derived_layers = image.get('RootFS', {}).get('Layers')
        guard(isinstance(base_layers, list) and len(base_layers) > 0 and all(IMAGE.fullmatch(x) for x in base_layers)
              and isinstance(derived_layers, list) and derived_layers[:len(base_layers)] == base_layers
              and len(derived_layers) >= len(base_layers), 'derived-base-rootfs-prefix-required')
        binding['baseRootfsDiffIdPrefixMatched'] = True
        binding['baseRootfsLayerCount'] = len(base_layers)
        binding['derivedRootfsLayerCount'] = len(derived_layers)
        write_new('derived-image-identity.json', {'iidFile': iid, 'metadata': metadata, 'imageId': image_id, 'buildIdentityBinding': binding,
                  'descriptor': image.get('Descriptor'), 'repoDigestPresenceNotClaimed': True,
                  'localOnlyTag': tag, 'configUser': image.get('Config', {}).get('User'),
                  'baseConfigUser': base.get('Config', {}).get('User'),
                  'identityNote': 'Local Engine Id, build iid/config and registry manifest are retained separately; no push occurred.'})
        status['imageId'] = image_id
        status['actualImageConfigUser'] = image.get('Config', {}).get('User')
        preserved = ['User', 'Entrypoint', 'Cmd', 'WorkingDir', 'Env']
        guard(all(image.get('Config', {}).get(k) == base.get('Config', {}).get(k) for k in preserved), 'base-derived-launch-config-must-match')
        status['baseDerivedLaunchConfigPreserved'] = preserved
        status['runtimeContract'] = 'Root supervisor and original Sandbox entrypoint retained; native supervisor drops child to10002. Mock overrides user10002 and proves SDK only.'
        guard(labelled_ids('probe-label-before', request) == [], 'original-probe-label-already-present')
        write_new('create-once-intent.json', {'requestId': request, 'imageId': image_id, 'labelKey': LABEL_KEY,
                  'cidfile': str(RECORDS / 'probe.cid'), 'at': utc()})
        create_attempted = True
        created = checked('create-once', ['create', '--cidfile', str(RECORDS / 'probe.cid'), '--label', LABEL_KEY + '=' + request,
                  '--network=none', '--user=10002:10002', '--read-only', '--cap-drop=ALL',
                  '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=768m', '--cpus=1',
                  '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,mode=1777', '--workdir=/tmp',
                  '--mount', 'type=bind,src=' + str(ROOT / 'probe/host-resource-snapshot-probe.mjs') + ',dst=/compat-input/probe/host-resource-snapshot-probe.mjs,readonly',
                  '--mount', 'type=bind,src=' + str(ROOT / 'input-manifest.json') + ',dst=/compat-input/input-manifest.json,readonly',
                  '--entrypoint=/usr/bin/env', image_id, '-i', 'PATH=/usr/local/bin:/usr/bin:/bin',
                  '/usr/local/bin/node', '/compat-input/probe/host-resource-snapshot-probe.mjs', '--manifest',
                  '/compat-input/input-manifest.json', '--manifest-sha256', MANIFEST], 30)['stdout'].decode().strip()
        original = read_bounded(RECORDS / 'probe.cid', 256).decode().strip()
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
                try:
                    candidate = read_bounded(RECORDS / 'probe.cid', 256).decode().strip()
                    if CID.fullmatch(candidate):
                        original = candidate
                except BaseException:
                    pass
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
