#!/usr/bin/env python3
"""Bounded, replayable private archive transport; never executes project data."""
import base64
import json
import os
import re
import stat
import sys
from process_quiescence import spawn_lock, require_unsealed

MAX_ARCHIVE = 56 * 1024 * 1024
CHUNK = 256 * 1024
TOKEN = re.compile(r'^[a-f0-9]{52}$')


def regular(fd):
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o077:
        raise RuntimeError('service-upload-permissions')
    return info


def upload(token, raw):
    if not TOKEN.fullmatch(token) or not isinstance(raw, dict) or set(raw) != {'offset', 'total', 'sha256', 'data'}:
        raise RuntimeError('service-upload-input')
    offset, total = raw['offset'], raw['total']
    if type(offset) is not int or type(total) is not int or offset < 0 or not 1 <= total <= MAX_ARCHIVE or not isinstance(raw['sha256'], str) or not re.fullmatch('[a-f0-9]{64}', raw['sha256']):
        raise RuntimeError('service-upload-input')
    if not isinstance(raw['data'], str) or len(raw['data']) > 4 * ((CHUNK + 2) // 3):
        raise RuntimeError('service-upload-size')
    data = base64.b64decode(raw['data'], validate=True)
    if not 1 <= len(data) <= CHUNK or offset + len(data) > total:
        raise RuntimeError('service-upload-size')
    with spawn_lock() as effects:
        require_unsealed(effects)
        root = os.open('/var/lib/riffology/archives', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(root)
            if info.st_uid != 0 or info.st_mode & 0o077:
                raise RuntimeError('service-upload-root')
            meta = json.dumps({'total': total, 'sha256': raw['sha256']}, sort_keys=True, separators=(',', ':')).encode()
            fd = os.open(token + '.upload.json', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=root)
            try:
                size = regular(fd).st_size
                if size:
                    if size != len(meta) or os.read(fd, size) != meta:
                        raise RuntimeError('service-upload-conflict')
                else:
                    os.write(fd, meta)
                    os.fsync(fd)
            finally:
                os.close(fd)
            fd = os.open(token + '.input.tar', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=root)
            try:
                size = regular(fd).st_size
                if size < offset or size > total:
                    raise RuntimeError('service-upload-offset')
                overlap = min(len(data), size - offset)
                os.lseek(fd, offset, os.SEEK_SET)
                if overlap and os.read(fd, overlap) != data[:overlap]:
                    raise RuntimeError('service-upload-conflict')
                pending = memoryview(data)[overlap:]
                while pending:
                    written = os.write(fd, pending)
                    if written <= 0:
                        raise RuntimeError('service-upload-write')
                    pending = pending[written:]
                os.fsync(fd)
                complete = os.fstat(fd).st_size == total
            finally:
                os.close(fd)
            os.fsync(root)
        finally:
            os.close(root)
    return {'schemaVersion': 1, 'token': token, 'offset': offset, 'bytes': len(data), 'total': total, 'complete': complete}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise RuntimeError('service-upload-command')
        payload = sys.stdin.buffer.read(400001)
        if len(payload) > 400000:
            raise RuntimeError('service-upload-size')
        print(json.dumps(upload(sys.argv[1], json.loads(payload)), separators=(',', ':')))
    except Exception:
        print('service-upload-denied', file=sys.stderr)
        raise SystemExit(4)
