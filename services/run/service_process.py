#!/usr/bin/env python3
"""Private, root-owned lifecycle wrapper for one immutable service instance."""
import ctypes
import fcntl
import importlib.metadata
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import resource
import stat
import subprocess
import sys
import time
import unicodedata

import process_quiescence as fence
import workspace_archive as archive

CONTROL = Path('/var/lib/riffology/services')
ARCHIVES = Path('/var/lib/riffology/archives')
WORKSPACE = Path('/workspace')
TOKEN = re.compile(r'^[a-f0-9]{52}$')
SHA = re.compile(r'^[a-f0-9]{64}$')
FIELDS = {'schemaVersion', 'token', 'entrypoint', 'dependencyLock', 'filesSha256', 'declarationSha256', 'entrypointSha256', 'dependencyLockSha256', 'deadlineAt', 'healthPath'}


def now():
    return int(time.time() * 1000)


def exact(value, fields):
    if type(value) is not dict or set(value) != fields:
        raise ValueError('invalid-service-input')


def project_path(value, roots, suffix):
    if type(value) is not str or not value.endswith(suffix) or len(value.encode('utf-8')) > 240 or unicodedata.normalize('NFC', value) != value:
        raise ValueError('invalid-service-path')
    parts = value.split('/')
    if parts[0] not in roots or len(parts) < 2 or any(p in {'', '.', '..', '.riffology'} for p in parts) or any(unicodedata.category(c).startswith('C') or c in '\\%' for c in value):
        raise ValueError('invalid-service-path')


def health_path(value):
    if type(value) is not str or len(value) > 256 or not re.fullmatch(r'/(?:[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)?', value) or any(p in {'.', '..'} for p in value.split('/')):
        raise ValueError('invalid-service-health')


def validate(value, token):
    exact(value, FIELDS)
    if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or value['token'] != token:
        raise ValueError('invalid-service-input')
    for key in ('filesSha256', 'declarationSha256', 'entrypointSha256', 'dependencyLockSha256'):
        if type(value[key]) is not str or not SHA.fullmatch(value[key]):
            raise ValueError('invalid-service-digest')
    if type(value['deadlineAt']) is not int or not 0 < value['deadlineAt'] <= 9007199254740991:
        raise ValueError('invalid-service-deadline')
    project_path(value['entrypoint'], {'app', 'model'}, '.py')
    project_path(value['dependencyLock'], {'app'}, '.lock')
    health_path(value['healthPath'])
    return value


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate-service-field')
        value[key] = item
    return value


def read_json(path, limit=16384):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:
            raise ValueError('invalid-service-file')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(limit + 1)
        if len(raw) > limit:
            raise ValueError('invalid-service-file')
        return json.loads(raw.decode('utf-8'), object_pairs_hook=unique)
    finally:
        os.close(fd)


def write(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w', closefd=False) as stream:
            json.dump(value, stream, separators=(',', ':'), sort_keys=True)
            stream.flush()
            os.fsync(fd)
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        os.close(fd)


def result(token, status, proof=None):
    return {'schemaVersion': 1, 'token': token, 'status': status, 'stop': proof}


def stop(token):
    # This durable intent precedes the process-domain fence. A crash can only
    # leave a pending stop, never permission for another start.
    intent = CONTROL / 'stop.json'
    if not intent.exists():
        write(intent, {'token': token})
    proof_path = CONTROL / 'stopped.json'
    sealed = fence.seal()
    if sealed != {'schemaVersion': 1, 'sealed': True, 'quiescent': True, 'projectUid': 10001}:
        raise RuntimeError('service-stop-unproven')
    if not proof_path.exists():
        write(proof_path, {'confirmationId': hashlib.sha256(('service-stop:' + token).encode()).hexdigest(), 'observedAt': now(), 'fenced': True})
    return result(token, 'stopped', read_json(proof_path))


def probe(path):
    connection = http.client.HTTPConnection('127.0.0.1', 8080, timeout=1)
    try:
        connection.request('GET', path, headers={'Host': '127.0.0.1:8080', 'Connection': 'close'})
        response = connection.getresponse()
        return response.status == 200  # no redirects, body reads, or proxy env
    except (OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def observe(token):
    if (CONTROL / 'stop.json').exists():
        return stop(token)
    attempt = CONTROL / 'attempt.json'
    if not attempt.exists():
        return result(token, 'absent')
    saved = validate(read_json(attempt), token)
    if now() >= saved['deadlineAt']:
        return stop(token)
    if not (CONTROL / 'spawned.json').exists():
        return result(token, 'unknown')
    return result(token, 'healthy' if probe(saved['healthPath']) else 'starting')


def verify_tree(control):
    for path, digest, limit in [(control['entrypoint'], control['entrypointSha256'], 1024 * 1024), (control['dependencyLock'], control['dependencyLockSha256'], 65536), ('app/preview.json', control['declarationSha256'], 16384)]:
        file = WORKSPACE / path
        if file.stat().st_size > limit or archive.file_sha256(file) != digest:
            raise ValueError('service-source-mismatch')
    lock = read_json(WORKSPACE / control['dependencyLock'], 65536)
    exact(lock, {'schemaVersion', 'packages'})
    if type(lock['schemaVersion']) is not int or lock['schemaVersion'] != 1 or type(lock['packages']) is not dict or any(key != 'simpy' or value != '4.1.1' for key, value in lock['packages'].items()):
        raise ValueError('unsupported-service-dependencies')
    if lock['packages'] and importlib.metadata.version('simpy') != '4.1.1':
        raise ValueError('service-dependency-version-mismatch')
    declaration = read_json(WORKSPACE / 'app/preview.json')
    required = {'schemaVersion', 'runtime', 'entrypoint', 'dependencyLock', 'port', 'healthPath'}
    if type(declaration) is not dict or set(declaration) not in (required, required | {'observation'}):
        raise ValueError('invalid-service-declaration')
    if type(declaration['schemaVersion']) is not int or declaration['schemaVersion'] != 1 or declaration['runtime'] != 'python' or type(declaration['port']) is not int or declaration['port'] != 8080 or any(declaration[key] != control[key] for key in ('entrypoint', 'dependencyLock', 'healthPath')):
        raise ValueError('service-declaration-mismatch')
    if 'observation' in declaration:
        observation = declaration['observation']
        exact(observation, {'pagePath', 'statePath'})
        for path in observation.values():
            health_path(path)
        if len({*observation.values(), control['healthPath']}) != 3:
            raise ValueError('invalid-service-observation')
    for current, directories, files in os.walk(WORKSPACE, topdown=False, followlinks=False):
        for name in files:
            path = Path(current) / name
            os.chown(path, 0, 0, follow_symlinks=False)
            os.chmod(path, 0o555 if path.stat().st_mode & 0o111 else 0o444)
        for name in directories:
            path = Path(current) / name
            os.chown(path, 0, 0, follow_symlinks=False)
            os.chmod(path, 0o555)
    os.chown(WORKSPACE, 0, 0)
    os.chmod(WORKSPACE, 0o555)


def no_new_privileges():
    if sys.platform != 'linux':
        raise RuntimeError('service-linux-required')
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(38, 1, 0, 0, 0) != 0:
        raise RuntimeError('service-no-new-privileges-unproven')


def child_setup():
    no_new_privileges()
    # Import the fixed root-owned helper before project code can execute.
    import project_network_fence
    project_network_fence.install()
    os.setgroups([])
    os.setgid(10001)
    os.setuid(10001)
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_CPU, (300, 300))
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))


def start(token):
    if (CONTROL / 'stop.json').exists() or (CONTROL / 'attempt.json').exists():
        return observe(token)
    control = validate(read_json(CONTROL / (token + '.input.json')), token)
    if control['deadlineAt'] <= now():
        return stop(token)
    with fence.spawn_lock() as directory:
        fence.require_unsealed(directory)
        source = ARCHIVES / (token + '.input.tar')
        if archive.file_sha256(source) != control['filesSha256']:
            raise ValueError('service-archive-mismatch')
        restored = archive.restore(WORKSPACE, ARCHIVES, token)
        if restored['sha256'] != control['filesSha256']:
            raise ValueError('service-archive-mismatch')
        verify_tree(control)
        if control['deadlineAt'] <= now():
            # Record intent while holding spawn lock; observe seals after unlock.
            write(CONTROL / 'stop.json', {'token': token})
            return result(token, 'unknown')
        # Persist before Popen: an ambiguous dispatch is never repeated.
        write(CONTROL / 'attempt.json', control)
        with open(CONTROL / 'stdout.log', 'ab', buffering=0) as stdout, open(CONTROL / 'stderr.log', 'ab', buffering=0) as stderr:
            process = subprocess.Popen([sys.executable, '-B', control['entrypoint']], cwd=WORKSPACE, env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/tmp', 'LANG': 'C.UTF-8', 'PORT': '8080', 'PYTHONUNBUFFERED': '1'}, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, close_fds=True, start_new_session=True, preexec_fn=child_setup)
        write(CONTROL / 'spawned.json', {'pid': process.pid})
    return observe(token)


def main(args):
    if len(args) != 2 or args[0] not in {'start', 'observe', 'stop'} or not TOKEN.fullmatch(args[1]):
        raise ValueError('invalid-service-command')
    fence.validate_account()
    info = CONTROL.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('invalid-service-control')
    fd = os.open(CONTROL / '.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        identity = CONTROL / 'identity.json'
        if identity.exists():
            if read_json(identity) != {'token': args[1]}:
                raise ValueError('service-identity-conflict')
        else:
            write(identity, {'token': args[1]})
        return {'start': start, 'observe': observe, 'stop': stop}[args[0]](args[1])
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        print(json.dumps(main(sys.argv[1:]), separators=(',', ':')))
    except Exception:
        print('service-operation-unproven', file=sys.stderr)
        raise SystemExit(4)
