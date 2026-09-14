#!/usr/bin/env python3
"""Platform archives serialized against epoch admission, spawn and sealing."""
import json
import os
import re
import stat
import sys
from process_quiescence import spawn_lock, require_staging, require_sealed, require_quiet, write_state
import workspace_archive


def root_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError('project-workspace-proof-invalid')
        return info
    finally:
        os.close(fd)


def marker_proof(archive_root, token):
    marker = archive_root / f'{token}.restore.json'
    info = root_file(marker)
    if info.st_size > 1024:
        raise RuntimeError('project-workspace-proof-invalid')
    value = json.loads(marker.read_text())
    if (set(value) != {'ok', 'operation', 'bytes', 'sha256'} or value['ok'] is not True
            or value['operation'] != 'restore' or type(value['bytes']) is not int
            or not 0 < value['bytes'] <= workspace_archive.MAX_ARCHIVE_BYTES
            or not isinstance(value['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', value['sha256'])):
        raise RuntimeError('project-workspace-proof-invalid')
    return value


def durable_marker(path, result):
    temporary = path.with_name(path.name + f'.tmp-{os.getpid()}')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(os.dup(fd), 'w') as target:
            json.dump(result, target, sort_keys=True, separators=(',', ':'))
            target.flush(); os.fsync(target.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        os.close(fd)


def run(args):
    if len(args) not in {2, 3} or args[0] not in {'restore', 'freeze', 'adopt'}:
        raise RuntimeError('project-archive-command-invalid')
    operation, token = args[:2]
    if not workspace_archive.TOKEN.fullmatch(token) or (operation == 'adopt') != (len(args) == 3):
        raise RuntimeError('project-archive-command-invalid')
    with spawn_lock() as directory:
        state = require_sealed(directory) if operation == 'freeze' else require_staging(directory)
        if state:
            require_quiet()
            if state['archiveToken'] not in {None, token} or (operation == 'freeze' and state['archiveToken'] != token):
                raise RuntimeError('project-archive-binding-denied')
        workspace, archive_root = workspace_archive.roots()
        archive_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        archive_fd = os.open(archive_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(archive_fd)
            if info.st_uid != 0 or info.st_mode & 0o077:
                raise RuntimeError('project-archive-root-invalid')
        finally:
            os.close(archive_fd)
        if operation == 'adopt':
            prior = args[2]
            expected = os.environ.get('RIFFOLOGY_EXPECTED_FILES_SHA256', '')
            if not state or prior == token or not workspace_archive.TOKEN.fullmatch(prior) or not re.fullmatch('[a-f0-9]{64}', expected):
                raise RuntimeError('project-adopt-denied')
            proof = state['previousFrozen']
            if not proof or proof['token'] != prior or proof['sha256'] != expected:
                raise RuntimeError('project-adopt-denied')
            marker_proof(archive_root, prior)
            previous = archive_root / f'{prior}.output.tar'
            info = root_file(previous)
            if info.st_size != proof['bytes'] or workspace_archive.file_sha256(previous) != expected:
                raise RuntimeError('project-adopt-denied')
            # Rehash the live tree under the same epoch lock; no unpack/rewrite.
            size, digest = workspace_archive.canonical_tar(workspace, archive_root / f'{token}.adopt-verify.tar')
            if size != proof['bytes'] or digest != expected:
                raise RuntimeError('project-adopt-workspace-drift')
            result = {'ok': True, 'operation': 'restore', 'bytes': size, 'sha256': digest}
            marker = archive_root / f'{token}.restore.json'
            if marker.exists():
                if marker_proof(archive_root, token) != result:
                    raise RuntimeError('project-adopt-replay-conflict')
            else:
                durable_marker(marker, result)
        elif operation == 'restore':
            result = workspace_archive.restore(workspace, archive_root, token)
        else:
            marker_proof(archive_root, token)
            result = workspace_archive.freeze(workspace, archive_root, token)
        if state:
            state['archiveToken'] = token
            if operation != 'freeze':
                state['prepared'] = {'token': token, 'bytes': result['bytes'], 'sha256': result['sha256']}
            if operation == 'freeze':
                output = archive_root / f'{token}.output.tar'
                fd = os.open(output, os.O_RDONLY | os.O_NOFOLLOW)
                try: os.fsync(fd)
                finally: os.close(fd)
                state['frozen'] = {'token': token, 'bytes': result['bytes'], 'sha256': result['sha256']}
            write_state(directory, state)
        print(json.dumps(result, sort_keys=True, separators=(',', ':')))
        return 0


if __name__ == '__main__':
    try:
        raise SystemExit(run(sys.argv[1:]))
    except Exception:
        print('project-archive-fence-denied', file=sys.stderr)
        raise SystemExit(4)
