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

ROOT = Path('/tmp/riffoid-jhg46-image-20261017.AU613w/pi-resource-compat-v1')
RECORDS = ROOT / 'build-probe-once'
BASE = 'registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi@sha256:9b76ab9ee7a4f31d250957fbbeefc62d71056e6bd1eb24686ebbeaff3d65873c'
MANIFEST = 'f27b35dcbe84b58e3442018332374dbf20fa0d315528a322e56ea2a2bcfea5d4'
DOCKER = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock']
UUID = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
CID = re.compile(r'^[a-f0-9]{64}$')
IMAGE = re.compile(r'^sha256:[a-f0-9]{64}$')
LABEL_KEY = 'riffology.jhg46.pi-resource-compat-operation'
ORIGINAL_REQUEST = '57a70587-2b21-4a56-aed1-09c8a32d868a'
ORIGINAL_GRANT_SHA = 'd241c2ee9c47a8f3327ab4220f3d845f24777e036aa450f3f542e4776b53e0f1'
ORIGINAL_OPERATIONS_SHA = '05100f4a7c8aa2448b289d1525498dbd10542612873630e6b1cfd980dbb87512'
PAYLOAD = {'EXECUTION-CONTRACT.md': {'bytes': 9645, 'sha256': 'd77631c31751cdbbc72ead2ce9f866db5650d64fd77109d5f994f40494afc90f'}, 'context/Dockerfile': {'bytes': 1245, 'sha256': 'bcdec6d274816323daa1c11b9245082efcf8132cc0d2901dab3cb13b2c9110b2'}, 'context/services/browser-preview/runtime/sha256.mjs': {'bytes': 2241, 'sha256': '85da435e9edaf4dca3411cf5f86fa45a95fe15c78060849d11f7eb0344b5bd24'}, 'context/services/project-resources/text.mjs': {'bytes': 6700, 'sha256': '9f7f3266549f04a0a8214e6e725ea9d85030532364f136487833e9cc45af303e'}, 'context/services/runtime/controlled-pi.mjs': {'bytes': 23072, 'sha256': 'cf4143bff6cf049d2ab8247ef86ceb5f5391da67a86acb56ea901a119b2d6871'}, 'context/services/trusted-pi/release-candidate.mjs': {'bytes': 27185, 'sha256': '034cdc9df6c09e9cd7a32320e6bbfc2f9bbf5761151fe1d585d7fd64cdcd8d07'}, 'context/services/trusted-pi/research-context.mjs': {'bytes': 1557, 'sha256': '938e89155a5d5e0c405f51db5d973a4db264e63d96e308aff8da93caaaa05076'}, 'input-manifest.json': {'bytes': 6884, 'sha256': 'f27b35dcbe84b58e3442018332374dbf20fa0d315528a322e56ea2a2bcfea5d4'}, 'probe/compatibility-probe.mjs': {'bytes': 12020, 'sha256': 'bded581766c4656b05b72c6fce39fcb43461a44cbe407c0d1e9ab4a23edf2097'}}
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
    guard(ROOT.stat().st_uid == os.getuid() and not ROOT.stat().st_mode & 0o022, 'private-task-directory')
    guard(stat.S_ISSOCK(os.stat('/var/run/docker.sock').st_mode), 'fixed-daemon-socket')
    for name, item in PAYLOAD.items():
        path = ROOT / name
        guard(path.resolve() == path, 'payload-path-link')
        b = read_bounded(path, 131072)
        guard(len(b) == item['bytes'] and sha(b) == item['sha256'], 'frozen-payload-drift')
    guard((ROOT / 'context/Dockerfile').read_text().splitlines()[0] == 'FROM ' + BASE, 'fixed-base')
    return verify_original_cleanup()

def listener_addresses():
    addresses = []
    for family, filename in ((4, '/proc/net/tcp'), (6, '/proc/net/tcp6')):
        for line in Path(filename).read_text().splitlines()[1:]:
            parts = line.split()
            guard(len(parts) >= 4, 'listener-table-format')
            address, port = parts[1].split(':')
            if int(port, 16) != 7897 or parts[3] != '0A':
                continue
            if family == 4:
                addresses.append(socket.inet_ntop(socket.AF_INET, bytes.fromhex(address)[::-1]))
            else:
                data = bytes.fromhex(address)
                addresses.append(socket.inet_ntop(socket.AF_INET6, b''.join(data[x:x+4][::-1] for x in range(0, 16, 4))))
    return sorted(addresses)

def verify_original_cleanup():
    original = ROOT / ('pull-once-' + ORIGINAL_REQUEST)
    guard(list(ROOT.glob('pull-once-*')) == [original] and original.is_dir()
          and not original.is_symlink() and original.resolve() == original, 'only-original57a-receiver-record')
    intent = json.loads(read_bounded(original / 'intent.json', 32768))
    terminal = json.loads(read_bounded(original / 'terminal.json', 32768))
    guard(intent.get('schema') == 'trusted-pi-pull-original-intent/v1' and intent.get('requestId') == ORIGINAL_REQUEST
          and intent.get('grantSha256') == ORIGINAL_GRANT_SHA and intent.get('operationsManifestSha256') == ORIGINAL_OPERATIONS_SHA
          and intent.get('baseImage') == BASE, 'original57a-identity')
    guard(terminal.get('schema') == 'trusted-pi-pull-terminal/v1' and terminal.get('requestId') == ORIGINAL_REQUEST
          and terminal.get('status') == 'unknown-stopped' and terminal.get('errorCode') == 'stdin-eof'
          and terminal.get('authConfigAbsent') is True and terminal.get('routeBindAddressesBeforeCredential') == ['127.0.0.1']
          and 'pullOutput' not in terminal and 'image' not in terminal, 'original57a-no-credential-delivery-terminal')
    pid, ticks = intent.get('receiverPid'), intent.get('receiverStartTicks')
    guard(type(pid) is int and pid > 1 and isinstance(ticks, str) and ticks.isdecimal(), 'original57a-pid-ticks')
    guard(process_start_ticks(pid) != ticks, 'original57a-receiver-still-alive')
    auth = original / 'docker-auth'
    guard(not auth.exists() and not auth.is_symlink(), 'original57a-auth-config-absence')
    listeners = listener_addresses()
    with socket.socket() as sock:
        sock.settimeout(2)
        code = sock.connect_ex(('127.0.0.1', 7897))
    guard(not listeners and code == 111, 'original57a-route-not-fully-released')
    return {'originalRequestId': ORIGINAL_REQUEST, 'originalCredentialPostOutcome': 'unknown-stopped-preserved',
            'credentialNotDeliveredToReceiver': True, 'originalReceiverPid': pid, 'originalReceiverStartTicks': ticks,
            'originalReceiverAbsent': True, 'authConfigAbsent': True, 'remote7897ListenerAddresses': listeners,
            'remote7897ConnectErrno': code, 'sourceOfBase': 'pre-existing-exact-immutable-cache-no-new-mint-or-pull',
            'cacheReadonlyEvidenceSha256': 'e824ecfd46fedda0ac378e8e7d4dbae7b878699e49b42a91cc1b25bf55c584db'}

def process_start_ticks(pid):
    try:
        return Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()[19]
    except FileNotFoundError:
        return None


ORIGINAL_PREFLIGHT_FILES = {'base-inspect.intent.json': {'bytes': 573, 'sha256': 'fbee78a85f0979c6a2b59fd715b155d9535eb8a826dacf4f4f5beb1e85882663'}, 'base-inspect.original-cli.json': {'bytes': 107, 'sha256': 'b475f3b7bd30dc0277d46d7b88f2d031ec8854c60b50b5be4a99838ad203cfa7'}, 'base-inspect.result.json': {'bytes': 605, 'sha256': '71bcd2d2df0c0922b35b62f7f726490099631dcf6d6500ed6971d17d937ac186'}, 'base-inspect.stderr': {'bytes': 0, 'sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}, 'base-inspect.stdout': {'bytes': 4908, 'sha256': 'ece74f06a98d0f3977efc8a9ce3a8f8c24278dd526d9ab0ab21a690a20ffd1a1'}, 'cached-base-entry-guard.json': {'bytes': 562, 'sha256': '8074d3aee3afef04deb54fdb50f424194c09492cdf5c3ef34b5b393cb53116c1'}, 'default-builder-inspect.intent.json': {'bytes': 423, 'sha256': 'ecb612b0ec84247aaa16b71ce8f8cadc5cadd897cb551dd13a687484cce1839c'}, 'default-builder-inspect.original-cli.json': {'bytes': 107, 'sha256': '7a62acd326b83626bd223ed03cd5981cc147bf1a1969f9ccb8217615a6a16ae9'}, 'default-builder-inspect.result.json': {'bytes': 605, 'sha256': '6918a11e1ca40b476c5f133701695929894fe5cda77662768f9654de28500826'}, 'default-builder-inspect.stderr': {'bytes': 118, 'sha256': 'efc09f33c161340d92b67de0d7b3cdf5b7e414f3730315c879d9bfedcacb2353'}, 'default-builder-inspect.stdout': {'bytes': 0, 'sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}, 'intent.json': {'bytes': 532, 'sha256': 'ed4480af533ac338b0e2a5a196854bdf03c771b9f118ed2c17a11758528a4dba'}, 'result.json': {'bytes': 380, 'sha256': '41062ccf80772745c44296cd2944b6389babb88fb6206e1edc59fdd144c412a9'}, 'empty-docker-config/config.json': {'bytes': 13, 'sha256': '81bcbd3f950f2b31b87a64e8eca0de39db52feb0060d2bc631d7d794696604eb'}}

def verify_readonly_failure_continuation():
    guard(RECORDS.is_dir() and not RECORDS.is_symlink() and RECORDS.resolve() == RECORDS
          and RECORDS.stat().st_uid == os.getuid() and not RECORDS.stat().st_mode & 0o077, 'original-task-lock-required')
    files, directories = {}, set()
    for p in RECORDS.rglob('*'):
        guard(not p.is_symlink(), 'original-record-link')
        name = p.relative_to(RECORDS).as_posix()
        if p.is_dir():
            directories.add(name)
        else:
            b = read_bounded(p, 131072)
            files[name] = {'bytes': len(b), 'sha256': sha(b)}
    guard(files == ORIGINAL_PREFLIGHT_FILES and directories == {'empty-docker-config', 'empty-home'}, 'original-readonly-snapshot-drift-or-operation-already-attempted')
    original = json.loads((RECORDS / 'result.json').read_bytes())
    intent = json.loads((RECORDS / 'intent.json').read_bytes())
    failed = json.loads((RECORDS / 'default-builder-inspect.result.json').read_bytes())
    cli = json.loads((RECORDS / 'default-builder-inspect.original-cli.json').read_bytes())
    cmd = json.loads((RECORDS / 'default-builder-inspect.intent.json').read_bytes())
    guard(original.get('requestId') == ORIGINAL_REQUEST and original.get('status') == 'unknown-stopped'
          and original.get('errorCode') == 'command-nonzero-default-builder-inspect'
          and original.get('cleanup') == {'cleanupConfirmed': True, 'containerCreateNeverAttempted': True}, 'only-known-readonly-failure')
    guard(intent.get('requestId') == ORIGINAL_REQUEST and intent.get('baseImage') == BASE
          and intent.get('oneBuild') is True and intent.get('oneCreate') is True, 'original-operation-intent')
    guard(cmd.get('argv') == DOCKER + ['--config', str(RECORDS / 'empty-docker-config'), 'buildx', 'inspect', 'default', '--format', '{{json .}}']
          and failed.get('exitCode') == 125 and failed.get('error') is None and failed.get('originalCliReaped') is True
          and failed.get('originalCliPid') == cli.get('pid') and failed.get('originalCliLinuxStartTicks') == cli.get('linuxStartTicks')
          and all(v.get('discardedBytes') == 0 for v in failed.get('streams', {}).values()), 'known-unsupported-format-command-only')
    guard(process_start_ticks(cli['pid']) != cli['linuxStartTicks'], 'original-readonly-cli-still-alive')
    guard(b'unknown flag: --format' in (RECORDS / 'default-builder-inspect.stderr').read_bytes(), 'known-format-error-required')
    return {'requestId': ORIGINAL_REQUEST, 'parentOriginalResultSha256': ORIGINAL_PREFLIGHT_FILES['result.json']['sha256'],
            'independentReadonlyProjectionSha256': '939d1de365031ece879c44ef3aa8879339828a627f26dd45b8ae5416b464ff82',
            'priorBuildAndCreateNeverAttempted': True, 'continuingFirstBuildOnly': True}

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
    name = 'continue-' + name
    config = RECORDS / 'empty-docker-config'
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'BUILDX_BUILDER': 'default',
           'HOME': str(RECORDS / 'empty-home'), 'DOCKER_CONFIG': str(config)}
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

def execute(request):
    guard(request == ORIGINAL_REQUEST, 'only-original57a-build-probe-request')
    continuation = verify_readonly_failure_continuation()
    input_guard = verify_inputs()
    write_new('continue-readonly-preflight-once.intent.json', {**continuation, 'at': utc()})
    write_new('continue-cached-base-entry-guard.json', input_guard)
    status = {'schema': 'trusted-pi-build-probe-result/v1', 'requestId': request, 'status': 'unknown-stopped',
              'parentOriginalResultSha256': continuation['parentOriginalResultSha256'], 'continuationOfOriginalReadonlyFailure': True,
              'noCloudOrProviderAcceptanceClaim': True}
    original = None
    image_id = None
    create_attempted = False
    try:
        base = docker_json('base-inspect', ['image', 'inspect', BASE, '--format', '{{json .}}'])
        guard(BASE in base.get('RepoDigests', []) and base.get('Os') == 'linux' and base.get('Architecture') == 'amd64'
              and base.get('Id') == BASE.split('@')[1] and base.get('Descriptor', {}).get('digest') == BASE.split('@')[1]
              and base.get('Config', {}).get('User') == 'root' and base.get('Config', {}).get('Entrypoint') == ['/container-server/sandbox'], 'immutable-cached-base-inspect')
        builder = parse_default_builder(checked('default-builder-inspect-plain', ['buildx', 'inspect', 'default'], 15)['stdout'])
        guard(builder.get('Name') == 'default' and builder.get('Driver') == 'docker', 'existing-default-builder-required')
        help_data = checked('build-help', ['build', '--help'], 15)
        guard(b'--metadata-file' in help_data['stdout'], 'metadata-file-supported-command-required')
        tag = 'riffology-jhg46-pi-resource-compat:' + request
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
                  'descriptor': image.get('Descriptor'), 'repoDigests': image.get('RepoDigests'),
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
                  '--mount', 'type=bind,src=' + str(ROOT / 'probe/compatibility-probe.mjs') + ',dst=/compat-input/probe/compatibility-probe.mjs,readonly',
                  '--mount', 'type=bind,src=' + str(ROOT / 'input-manifest.json') + ',dst=/compat-input/input-manifest.json,readonly',
                  '--entrypoint=/usr/bin/env', image_id, '-i', 'PATH=/usr/local/bin:/usr/bin:/bin',
                  '/usr/local/bin/node', '/compat-input/probe/compatibility-probe.mjs', '--manifest',
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
        write_new('continued-result.json', status)
    return status

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--request-id', required=True)
    args = parser.parse_args()
    try:
        guard(args.execute, 'explicit-execute-required-no-default-run')
        def interrupt(*_):
            raise Stop('runner-interrupted-original-identity-only')
        for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(sig, interrupt)
        result = execute(args.request_id)
        print(json.dumps(result, sort_keys=True))
        return 0 if result['status'] == 'offline-image-compatibility-mock-passed' else 1
    except BaseException as exc:
        print(json.dumps({'status': 'unknown-stopped', 'errorCode': str(exc) if isinstance(exc, Stop) else 'runner-local-error'}))
        return 1

if __name__ == '__main__':
    sys.exit(main())
