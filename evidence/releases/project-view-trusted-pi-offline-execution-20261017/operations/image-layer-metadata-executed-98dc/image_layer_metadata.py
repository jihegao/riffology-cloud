#!/usr/bin/env python3
"""Fixed-image metadata diagnostic. No extraction; CLI is inert without --execute."""
import argparse
import datetime as dt
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import resource
import selectors
import signal
import subprocess
import sys
import tarfile
import time

IMAGE = 'sha256:b2c2f93eff23011fe7863545e2b62b3b3d0d6fd4da161371afae399c0ce59c27'
REQUEST = '57a70587-2b21-4a56-aed1-09c8a32d868a'
ROOT = Path('/tmp/riffoid-jhg46-image-20261017.AU613w/pi-resource-compat-v1')
RECORDS = ROOT / 'build-probe-once'
PREFIX = 'layer-metadata-once'
MANIFEST_SHA = 'f27b35dcbe84b58e3442018332374dbf20fa0d315528a322e56ea2a2bcfea5d4'
DOCKER = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock', '--config', str(RECORDS / 'empty-docker-config')]
ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'}
GIB = 1024 ** 3
SHA = re.compile(r'^sha256:[a-f0-9]{64}$')
BLOB = re.compile(r'^blobs/sha256/([a-f0-9]{64})$')
INDEX_TYPES = {'application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'}
MANIFEST_TYPES = {'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'}
RAW_LAYER_TYPES = {'application/vnd.oci.image.layer.v1.tar', 'application/vnd.docker.image.rootfs.diff.tar'}
GZIP_LAYER_TYPES = {'application/vnd.oci.image.layer.v1.tar+gzip', 'application/vnd.docker.image.rootfs.diff.tar.gzip'}
TARGETS = {'opt/riffology/browser-preview/runtime/sha256.mjs': {'bytes': 2241, 'sha256': '85da435e9edaf4dca3411cf5f86fa45a95fe15c78060849d11f7eb0344b5bd24'}, 'opt/riffology/project-resources/text.mjs': {'bytes': 6700, 'sha256': '9f7f3266549f04a0a8214e6e725ea9d85030532364f136487833e9cc45af303e'}, 'opt/riffology/runtime/controlled-pi.mjs': {'bytes': 23072, 'sha256': 'cf4143bff6cf049d2ab8247ef86ceb5f5391da67a86acb56ea901a119b2d6871'}, 'opt/riffology/trusted-pi/release-candidate.mjs': {'bytes': 27185, 'sha256': '034cdc9df6c09e9cd7a32320e6bbfc2f9bbf5761151fe1d585d7fd64cdcd8d07'}, 'opt/riffology/trusted-pi/research-context.mjs': {'bytes': 1557, 'sha256': '938e89155a5d5e0c405f51db5d973a4db264e63d96e308aff8da93caaaa05076'}, 'opt/riffology/trusted-pi/trusted-pi-release.mjs': {'bytes': 27185, 'sha256': '034cdc9df6c09e9cd7a32320e6bbfc2f9bbf5761151fe1d585d7fd64cdcd8d07'}, 'opt/riffology/trusted-pi/trusted-pi-turn-host.mjs': {'bytes': 15937, 'sha256': '9964e7ab863207ce9b9a911e03bfcb4f99afc61fb6508d2d6611b66931be516b'}, 'opt/riffology/trusted-pi/product-model-transport.mjs': {'bytes': 7703, 'sha256': 'c2bece021f34f0b929e796238d132a819281d172b5d8fd3a6f431ed9d46801c6'}, 'opt/riffology/trusted-pi/product-tool-bridge.mjs': {'bytes': 11657, 'sha256': 'e536e9231a7fa41be956e3066535a62b7de460b37a4e5a40937c67d9f5981e74'}, 'opt/riffology/runtime_supervisor.py': {'bytes': 16912, 'sha256': '79e2bdedaedba063364513d853eb8325f229ba55b1e51df46cbcee359807e29c'}, 'opt/riffology/package.json': {'bytes': 244, 'sha256': '0dde532fe23b810bd09b978f990d48342f7378429f2b2c48f30e055993fa6ebe'}, 'opt/riffology/package-lock.json': {'bytes': 150262, 'sha256': 'ad20b5c766c411c5ba42a4fc997890fe3494ab8adb96cf5d75031366b3d144fc'}}

class Stop(Exception):
    def __init__(self, code, cli_identity=None):
        super().__init__(code)
        self.cli_identity = cli_identity

def guard(ok, code):
    if not ok:
        raise Stop(code)

def sha(b):
    return hashlib.sha256(b).hexdigest()

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def write_new(name, value):
    path = RECORDS / (PREFIX + '.' + name + '.json')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(json.dumps(value, sort_keys=True, indent=2).encode() + b'\n')
        out.flush(); os.fsync(out.fileno())

def bounded_file(path, limit):
    guard(path.is_file() and not path.is_symlink() and path.stat().st_size <= limit, 'bounded-regular-input')
    return path.read_bytes()

def start_ticks(pid):
    try:
        return Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()[19]
    except FileNotFoundError:
        return None

class Budget:
    def __init__(self):
        self.deadline = time.monotonic() + 180
        self.decompressed = 0
        self.json_bytes = 0
        self.entries = 0
    def check(self):
        guard(time.monotonic() < self.deadline, 'wall-time-limit')

class Reader:
    def __init__(self, source, limit, budget, decompressed=False):
        self.source, self.limit, self.budget = source, limit, budget
        self.n, self.h, self.decompressed = 0, hashlib.sha256(), decompressed
    def read(self, n):
        self.budget.check()
        guard(type(n) is int and 0 <= n <= 1024 * 1024, 'oversized-parser-read')
        b = self.source.read(n)
        self.n += len(b)
        guard(self.n <= self.limit, 'stream-size-limit')
        if self.decompressed:
            self.budget.decompressed += len(b)
            guard(self.budget.decompressed <= 4 * GIB, 'aggregate-decompression-limit')
        self.h.update(b)
        return b

class PrefixReader:
    def __init__(self, prefix, source):
        self.prefix, self.source = prefix, source
    def read(self, n):
        guard(0 <= n <= 1024 * 1024, 'oversized-parser-read')
        b = self.prefix[:n]; self.prefix = self.prefix[n:]
        if len(b) < n:
            b += self.source.read(n - len(b))
        return b

def canonical(name, directory=False):
    guard(isinstance(name, str) and len(name) <= 4096 and not name.startswith('/')
          and '\\' not in name and all(ord(c) >= 32 for c in name), 'unsafe-tar-path')
    while name.startswith('./'):
        name = name[2:]
    if directory:
        name = name.rstrip('/')
    if name in ('', '.') and directory:
        return ''
    guard(name and all(p not in ('', '.', '..') for p in name.split('/')), 'unsafe-tar-path')
    return name

def small_read(stream, limit):
    parts, n = [], 0
    while True:
        block = stream.read(min(65536, limit + 1 - n))
        if not block:
            return b''.join(parts)
        n += len(block); guard(n <= limit, 'small-object-limit'); parts.append(block)

def tar_tail(tf):
    n = 0
    while True:
        b = tf.fileobj.read(65536)
        if not b:
            break
        n += len(b)
        guard(n <= 1024 * 1024 and not b.strip(b'\0'), 'invalid-tar-tail')
    guard(n >= 512, 'missing-tar-end-blocks')

def descriptor(value):
    guard(isinstance(value, dict) and SHA.fullmatch(value.get('digest', ''))
          and type(value.get('size')) is int and 0 <= value['size'] <= 4 * GIB
          and isinstance(value.get('mediaType'), str) and len(value['mediaType']) < 256, 'invalid-descriptor')
    return {k: value[k] for k in ('digest', 'size', 'mediaType')}

def json_projection(value):
    guard(isinstance(value, dict), 'nonobject-oci-json')
    if isinstance(value.get('rootfs'), dict):
        roots = value['rootfs'].get('diff_ids')
        guard(value['rootfs'].get('type') == 'layers' and isinstance(roots, list) and len(roots) <= 96
              and all(isinstance(d, str) and SHA.fullmatch(d) for d in roots), 'invalid-config-rootfs')
        # Deliberately discard Env, history, labels, user/commands and every other field.
        return {'kind': 'config', 'os': value.get('os'), 'architecture': value.get('architecture'), 'diffIds': roots}
    if value.get('schemaVersion') == 2 and isinstance(value.get('manifests'), list):
        guard(len(value['manifests']) <= 64, 'index-member-limit')
        return {'kind': 'index', 'manifests': [descriptor(d) for d in value['manifests']]}
    if value.get('schemaVersion') == 2 and isinstance(value.get('layers'), list):
        guard(len(value['layers']) <= 96, 'manifest-layer-limit')
        return {'kind': 'manifest', 'config': descriptor(value.get('config')), 'layers': [descriptor(d) for d in value['layers']]}
    return {'kind': 'other'}

def layer_summary(stream, media, budget, layer_digest):
    source = gzip.GzipFile(fileobj=stream, mode='rb') if media == 'gzip' else stream
    data = Reader(source, 2 * GIB, budget, decompressed=True)
    additions, removals = {}, set()
    ancestors = {p.rsplit('/', i)[0] for p in TARGETS for i in range(1, len(p.split('/')))}
    seen = set()
    with tarfile.open(fileobj=data, mode='r|', bufsize=10240) as tf:
        for member in tf:
            budget.check(); budget.entries += 1
            guard(budget.entries <= 250000 and 0 <= member.size <= GIB, 'layer-member-limit')
            name = canonical(member.name, member.isdir())
            fingerprint = hashlib.sha256(name.encode('utf8')).digest()
            guard(fingerprint not in seen, 'duplicate-layer-path'); seen.add(fingerprint)
            parent, _, base = name.rpartition('/')
            if base.startswith('.wh.'):
                guard(member.isreg() and member.size == 0 and base != '.wh.', 'invalid-whiteout')
                if base == '.wh..wh..opq':
                    removals.update(t for t in TARGETS if not parent or t.startswith(parent + '/'))
                else:
                    removed = (parent + '/' if parent else '') + base[4:]
                    removals.update(t for t in TARGETS if t == removed or t.startswith(removed + '/'))
                continue
            if name in ancestors:
                guard(member.isdir(), 'relevant-ancestor-link-or-nondirectory')
            if name not in TARGETS:
                continue
            guard(member.isreg() and not member.issparse(), 'target-link-or-special-file-unsupported')
            guard(member.size <= 1024 * 1024 and type(member.uid) is int and type(member.gid) is int
                  and 0 <= member.uid <= 2147483647 and 0 <= member.gid <= 2147483647
                  and 0 <= member.mode <= 0o7777, 'target-metadata-limit')
            target = tf.extractfile(member)  # Stream only; never extract/extractall/write.
            content = Reader(target, 1024 * 1024, budget)
            while content.read(65536):
                pass
            guard(content.n == member.size, 'target-content-size')
            additions[name] = {'path': name, 'uid': member.uid, 'gid': member.gid, 'mode': member.mode,
                               'size': member.size, 'sha256': content.h.hexdigest(), 'sourceLayerDigest': layer_digest}
        tar_tail(tf)
    return {'additions': additions, 'removals': removals, 'diffId': 'sha256:' + data.h.hexdigest(), 'uncompressedBytes': data.n}

def parse_archive(stream, binding, budget):
    raw = Reader(stream, 4 * GIB, budget)
    objects, layers, blobs, outer_seen = {}, {}, {}, set()
    oci_layout = False; outer_index = None
    with tarfile.open(fileobj=raw, mode='r|', bufsize=10240) as tf:
        for number, member in enumerate(tf, 1):
            budget.check(); guard(number <= 512, 'outer-member-limit')
            name = canonical(member.name, member.isdir())
            guard(name not in outer_seen, 'duplicate-outer-path'); outer_seen.add(name)
            if member.isdir():
                guard(name in ('', 'blobs', 'blobs/sha256'), 'unexpected-outer-directory'); continue
            guard(member.isreg() and not member.issparse() and 0 <= member.size <= 4 * GIB, 'unsafe-outer-member')
            blob_match = BLOB.fullmatch(name)
            guard(blob_match or name in ('oci-layout', 'index.json', 'manifest.json', 'repositories'), 'unexpected-outer-member')
            entry = Reader(tf.extractfile(member), member.size, budget)
            prefix = entry.read(min(512, member.size)); source = PrefixReader(prefix, entry)
            if not blob_match:
                payload = small_read(source, 1024 * 1024)
                parsed = json.loads(payload)
                if name == 'oci-layout':
                    guard(isinstance(parsed, dict) and parsed.get('imageLayoutVersion') == '1.0.0', 'oci-layout-required')
                    oci_layout = True
                elif name == 'index.json':
                    outer_index = json_projection(parsed)
                    guard(outer_index['kind'] == 'index', 'outer-index-required')
                # Compatibility manifest/repositories are never used or returned.
            else:
                digest = 'sha256:' + blob_match.group(1)
                guard(digest not in blobs, 'duplicate-blob')
                if prefix.lstrip().startswith((b'{', b'[')):
                    payload = small_read(source, 1024 * 1024)
                    budget.json_bytes += len(payload); guard(budget.json_bytes <= 16 * 1024 * 1024, 'json-total-limit')
                    objects[digest] = json_projection(json.loads(payload))
                else:
                    guard(len(layers) < 96 and not prefix.startswith(b'\x28\xb5\x2f\xfd'), 'unsupported-layer-compression-or-count')
                    media = 'gzip' if prefix.startswith(b'\x1f\x8b') else 'raw'
                    summary = layer_summary(source, media, budget, digest)
                    summary['compression'] = media; layers[digest] = summary
                while entry.read(65536):
                    pass
                guard(entry.n == member.size and entry.h.hexdigest() == blob_match.group(1), 'blob-digest-or-size')
                blobs[digest] = {'size': member.size}
        tar_tail(tf)
    guard(oci_layout and outer_index is not None, 'known-oci-export-layout-required')
    root = binding['rootDescriptor']
    guard(any(d == root for d in outer_index['manifests']), 'original-image-root-not-in-export')
    def get(desc):
        guard(desc['digest'] in blobs and blobs[desc['digest']]['size'] == desc['size']
              and desc['digest'] in objects, 'referenced-json-blob-missing')
        return objects[desc['digest']]
    candidates, visited = [], set()
    def walk(desc, depth=0):
        guard(depth <= 4 and desc['digest'] not in visited, 'manifest-cycle-or-depth'); visited.add(desc['digest'])
        obj = get(desc)
        if obj['kind'] == 'index':
            guard(desc['mediaType'] in INDEX_TYPES, 'index-media-type')
            for child in obj['manifests']:
                walk(child, depth + 1)
        elif obj['kind'] == 'manifest':
            guard(desc['mediaType'] in MANIFEST_TYPES, 'manifest-media-type')
            config = get(obj['config'])
            if config['kind'] == 'config' and config['os'] == 'linux' and config['architecture'] == 'amd64':
                candidates.append((desc, obj, config))
        else:
            raise Stop('unexpected-image-root-kind')
    walk(root)
    guard(len(candidates) == 1, 'single-linux-amd64-manifest-required')
    chosen, manifest, config = candidates[0]
    guard(config['diffIds'] == binding['diffIds'] and len(manifest['layers']) == len(config['diffIds']), 'config-engine-rootfs-binding')
    final, order = {}, []
    for index, (desc, diff) in enumerate(zip(manifest['layers'], config['diffIds'])):
        digest = desc['digest']; guard(digest in layers and digest in blobs and blobs[digest]['size'] == desc['size'], 'selected-layer-missing')
        layer = layers[digest]
        guard(layer['diffId'] == diff and ((desc['mediaType'] in GZIP_LAYER_TYPES and layer['compression'] == 'gzip')
              or (desc['mediaType'] in RAW_LAYER_TYPES and layer['compression'] == 'raw')), 'selected-layer-diffid-or-media')
        # OCI whiteouts affect lower layers only, regardless of tar entry order.
        for target in layer['removals']:
            final.pop(target, None)
        for target, value in layer['additions'].items():
            final[target] = {**value, 'sourceLayerIndex': index}
        order.append({'index': index, **desc, 'diffId': diff, 'uncompressedBytes': layer['uncompressedBytes']})
    output = []
    for name, expected in TARGETS.items():
        value = final.get(name)
        if value is None:
            output.append({'path': name, 'present': False, 'ownershipGuardWouldPass': False}); continue
        output.append({**value, 'present': True, 'modeOctal': format(value['mode'], '04o'),
                       'matchesFrozenSizeAndSha': value['size'] == expected['bytes'] and value['sha256'] == expected['sha256'],
                       'ownershipGuardWouldPass': value['uid'] == 0 and value['mode'] & 0o022 == 0})
    return {'schema': 'trusted-pi-fixed-image-layer-target-metadata/v1', 'requestId': REQUEST, 'imageId': IMAGE,
            'rootDescriptor': root, 'selectedManifest': chosen, 'configDigest': manifest['config']['digest'],
            'layers': order, 'targets': output, 'archiveBytesObserved': raw.n, 'archiveSha256': raw.h.hexdigest(),
            'decompressedBytes': budget.decompressed, 'targetContentReturned': False,
            'rawArchiveSavedOrReturned': False, 'envOrFullConfigReturned': False,
            'attestationOrSignatureVerified': False, 'runtimeFilesystemStatProved': False}

# Live adapter is intentionally below the pure parser. Nothing runs on import.
class Pipe:
    def __init__(self, label, args, budget, limit):
        self.budget, self.limit, self.label = budget, limit, label
        self.n = 0; self.err_n = 0; self.err_hash = hashlib.sha256(); self.buf = bytearray(); self.eof = False
        self.proc = subprocess.Popen(DOCKER + args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, env=ENV, start_new_session=True)
        self.ticks = None; self.selector = None
        try:
            self.ticks = start_ticks(self.proc.pid)
            write_new(label + '.original-cli', {'pid': self.proc.pid, 'linuxStartTicks': self.ticks, 'at': utc()})
            self.selector = selectors.DefaultSelector(); self.selector.register(self.proc.stdout, selectors.EVENT_READ, 'out')
            self.selector.register(self.proc.stderr, selectors.EVENT_READ, 'err')
        except BaseException:
            identity = self.dispose()
            raise Stop('read-cli-initialization-failed' if identity['originalCliReaped'] else 'original-read-cli-cleanup-unconfirmed', identity) from None
    def pump(self):
        self.budget.check()
        for key, _ in self.selector.select(min(1, max(0, self.budget.deadline - time.monotonic()))):
            b = os.read(key.fileobj.fileno(), 65536)
            if not b:
                self.selector.unregister(key.fileobj)
                if key.data == 'out': self.eof = True
            elif key.data == 'out':
                self.n += len(b); guard(self.n <= self.limit, 'cli-stdout-limit'); self.buf.extend(b)
            else:
                self.err_n += len(b); self.err_hash.update(b); guard(self.err_n <= 65536, 'cli-stderr-limit')
    def read(self, n):
        guard(0 <= n <= 1024 * 1024, 'oversized-live-read')
        while len(self.buf) < n and not self.eof:
            self.pump()
        b = bytes(self.buf[:n]); del self.buf[:n]
        return b
    def finish(self):
        while self.selector.get_map(): self.pump()
        guard(not self.buf, 'unconsumed-cli-stdout')
        rc = self.proc.wait(timeout=max(0.1, self.budget.deadline - time.monotonic()))
        guard(rc == 0, 'docker-read-command-nonzero')
    def dispose(self):
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                if self.proc.poll() is not None: break
                try: os.killpg(self.proc.pid, sig)
                except ProcessLookupError: pass
                self.proc.wait(timeout=5)
            except BaseException:
                pass
        if self.selector is not None:
            try: self.selector.close()
            except BaseException: pass
        for stream in (self.proc.stdout, self.proc.stderr):
            try: stream.close()
            except BaseException: pass
        return {'pid': self.proc.pid, 'linuxStartTicks': self.ticks, 'exitCode': self.proc.poll(),
                'originalCliReaped': self.proc.poll() is not None}
    def close(self):
        result = {**self.dispose(), 'stdoutBytesObserved': self.n,
                  'stderrBytesObserved': self.err_n, 'stderrSha256': self.err_hash.hexdigest(), 'at': utc()}
        write_new(self.label + '.terminal', result)
        guard(result['originalCliReaped'], 'original-read-cli-cleanup-unconfirmed')

def inspect(label, budget):
    pipe = Pipe(label, ['image', 'inspect', IMAGE, '--format', '{{json .}}'], budget, 1024 * 1024)
    try:
        raw = small_read(pipe, 1024 * 1024); pipe.finish(); value = json.loads(raw)
        guard(isinstance(value, dict) and value.get('Id') == IMAGE and value.get('Os') == 'linux'
              and value.get('Architecture') == 'amd64', 'fixed-current-image-identity')
        root = descriptor(value.get('Descriptor')); diff = value.get('RootFS', {}).get('Layers')
        guard(isinstance(diff, list) and 0 < len(diff) <= 96 and all(SHA.fullmatch(x) for x in diff), 'actual-engine-rootfs')
        original = json.loads(bounded_file(RECORDS / 'derived-image-identity.json', 1024 * 1024))
        meta = original.get('metadata', {}); cfg = meta.get('containerimage.config.digest')
        guard(original.get('imageId') == IMAGE and descriptor(original.get('descriptor')) == root
              and meta.get('containerimage.digest') == root['digest'] and descriptor(meta.get('containerimage.descriptor')) == root
              and IMAGE in ((root['digest'],) if cfg is None else (cfg, root['digest'])), 'original-build-actual-image-binding')
        return {'rootDescriptor': root, 'diffIds': diff}
    finally:
        pipe.close()

def parse_with_memory_limit(stream, binding, budget):
    # The Docker child is already running; only this parser gets the soft limit.
    # Restore before any later Docker spawn, including post-inspect.
    previous = resource.getrlimit(resource.RLIMIT_AS)
    ceiling = 256 * 1024 * 1024
    soft = ceiling if previous[0] == resource.RLIM_INFINITY else min(ceiling, previous[0])
    resource.setrlimit(resource.RLIMIT_AS, (soft, previous[1]))
    try:
        return parse_archive(stream, binding, budget)
    finally:
        resource.setrlimit(resource.RLIMIT_AS, previous)


def execute():
    guard(sys.platform == 'linux' and ROOT.is_dir() and ROOT.resolve() == ROOT and RECORDS.is_dir()
          and not RECORDS.is_symlink() and RECORDS.stat().st_uid == os.getuid() and not RECORDS.stat().st_mode & 0o077, 'fixed-private-original-records')
    manifest = bounded_file(ROOT / 'input-manifest.json', 65536)
    guard(sha(manifest) == MANIFEST_SHA, 'frozen-manifest-required')
    guard(bounded_file(RECORDS / 'empty-docker-config/config.json', 256) == b'{"auths":{}}\n', 'empty-no-auth-docker-config')
    write_new('intent', {'requestId': REQUEST, 'imageId': IMAGE, 'at': utc(), 'saveInvocationsAtMost': 1,
                        'archivePersistence': False, 'newContainer': False, 'wallSeconds': 180})
    budget = Budget(); pipe = None
    terminal = {'requestId': REQUEST, 'imageId': IMAGE, 'status': 'unknown-stopped', 'remoteSafeRecordFilesWritten': True}
    try:
        before = inspect('pre-inspect', budget)
        pipe = Pipe('save', ['image', 'save', IMAGE], budget, 4 * GIB)
        result = parse_with_memory_limit(pipe, before, budget)
        pipe.finish(); pipe.close(); pipe = None
        after = inspect('post-inspect', budget)
        guard(before == after, 'image-changed-during-read')
        write_new('target-metadata', result)
        terminal['status'] = 'metadata-read-completed'
        terminal['metadata'] = result
    except Exception as error:
        terminal['errorCode'] = str(error) if isinstance(error, Stop) else 'metadata-parser-or-local-error'
        if isinstance(error, Stop) and error.cli_identity is not None:
            terminal['originalCliInitializationCleanup'] = error.cli_identity
    finally:
        if pipe is not None:
            try: pipe.close()
            except Exception: terminal['errorCode'] = 'original-read-cli-cleanup-unconfirmed'
        terminal['endedAt'] = utc()
        write_new('terminal', terminal)
    return terminal

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--execute', action='store_true'); parser.add_argument('--request-id', required=True)
    args = parser.parse_args()
    if not args.execute or args.request_id != REQUEST:
        print(json.dumps({'status': 'stopped', 'errorCode': 'explicit-original-request-required'})); return 1
    def interrupt(*_): raise Stop('metadata-wall-or-signal-stop')
    for sig in (signal.SIGALRM, signal.SIGTERM, signal.SIGHUP, signal.SIGINT): signal.signal(sig, interrupt)
    signal.alarm(180)
    try:
        result = execute(); print(json.dumps(result, sort_keys=True)); return 0 if result['status'] == 'metadata-read-completed' else 1
    except Exception:
        print(json.dumps({'status': 'unknown-stopped', 'errorCode': 'metadata-entry-stop'})); return 1
    finally:
        signal.alarm(0)

if __name__ == '__main__': sys.exit(main())
