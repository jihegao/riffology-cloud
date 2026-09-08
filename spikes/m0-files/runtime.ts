// These Python programs have fixed container paths, no caller-supplied commands,
// and no dependencies outside Python's standard library. Tests substitute these
// exact constants only inside a temporary fixture directory.
export const M0_FILES_ROOT = '/workspace/m0-files';
export const M0_FILES_STAGING_ROOT = '/workspace/m0-files-staging';
export const M0_RESTORE_INPUT = '/tmp/m0-restore.json';
export const M0_FILES_LIMITS = { entries: 1000, bytes: 32 * 1024 * 1024 } as const;

// Independent, static expectations for the controller to hash with its own
// implementation. This is a deliberately small, entirely synthetic project.
export const EXPECTED_FINAL_FILES = {
  root_mode: 0o755,
  directories: [
    { path: 'data', mode: 0o755 },
    { path: 'empty-directory', mode: 0o755 },
    { path: 'notes', mode: 0o755 },
    { path: 'private', mode: 0o700 },
    { path: 'src', mode: 0o755 },
  ],
  files: [
    { path: 'README.md', mode: 0o644, content_utf8: '# M0 files\nUpdated through the real filesystem.\n' },
    { path: 'data/blob.bin', mode: 0o600, bytes_base64: 'AAEC/0ZJTkFMCg==' },
    { path: 'data/input.json', mode: 0o644, content_utf8: '{"revision":2,"items":[1,2,3]}\n' },
    { path: 'empty.txt', mode: 0o644, content_utf8: '' },
    { path: 'notes/final.txt', mode: 0o644, content_utf8: 'A draft that will be renamed.\n' },
    { path: 'private/token.txt', mode: 0o600, content_utf8: 'SYNTHETIC_M0_VALUE\nrotation=2\n' },
    { path: 'src/main.py', mode: 0o755, content_utf8: '#!/usr/bin/env python3\nprint("m0 files")\nprint("revision 2")\n' },
  ],
  deleted_paths: ['data/obsolete.csv', 'data/remove-me.csv', 'notes/draft.txt', 'scratch.txt', 'notes/scratch-renamed.txt'],
} as const;

const FILESYSTEM_COMMON = String.raw`
import base64, hashlib, json, os, stat

ROOT = '/workspace/m0-files'
STAGING = '/workspace/m0-files-staging'
RESTORE_INPUT = '/tmp/m0-restore.json'
MAX_ENTRIES = 1000
MAX_BYTES = 32 * 1024 * 1024
MAX_JSON_BYTES = 50 * 1024 * 1024
ROOT_MODE = 0o755
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

def require(condition, reason):
    if not condition:
        raise ValueError(reason)

def validate_path(path):
    require(type(path) is str and path != '', 'invalid_path')
    require(len(path.encode('utf-8')) <= 4096, 'path_too_long')
    parts = path.split('/')
    require(len(parts) <= 64, 'path_too_deep')
    require('\\' not in path and '\x00' not in path and all(part not in ('', '.', '..') for part in parts), 'invalid_path')
    return parts

def validate_mode(mode, kind):
    require(type(mode) is int and 0 <= mode <= 0o777, 'invalid_mode')
    # Preserve owner access so the restored project can be inspected and used.
    if kind == 'directory':
        require(mode & 0o700 == 0o700, 'directory_requires_owner_access')
    else:
        require(mode & 0o400 == 0o400, 'file_requires_owner_read')

def checked_directory(path):
    info = os.lstat(path)
    require(stat.S_ISDIR(info.st_mode), 'not_regular_directory')
    descriptor = os.open(path, DIR_FLAGS)
    opened = os.fstat(descriptor)
    if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
        os.close(descriptor)
        raise ValueError('directory_changed')
    return descriptor

def check_parent():
    descriptor = checked_directory(os.path.dirname(ROOT))
    os.close(descriptor)

def require_fresh_root():
    check_parent()
    if not os.path.lexists(ROOT):
        return
    descriptor = checked_directory(ROOT)
    try:
        require(not os.listdir(descriptor), 'root_not_empty')
    finally:
        os.close(descriptor)

def sync_directory(path):
    descriptor = checked_directory(path)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def read_regular_at(directory, name, allowance):
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, 'not_single_regular_file')
        require(before.st_size <= allowance, 'byte_limit')
        chunks, size = [], 0
        while True:
            chunk = os.read(descriptor, min(65536, allowance - size + 1))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            require(size <= allowance, 'byte_limit')
        after = os.fstat(descriptor)
        require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_size, after.st_mtime_ns, after.st_ctime_ns) and size == after.st_size, 'file_changed_during_read')
        return b''.join(chunks), after
    finally:
        os.close(descriptor)

def export_tree(path):
    entries, tree, total = [], [], 0
    root_descriptor = checked_directory(path)
    try:
        require(stat.S_IMODE(os.fstat(root_descriptor).st_mode) == ROOT_MODE, 'invalid_root_mode')
        def visit(directory, prefix):
            nonlocal total
            for name in sorted(os.listdir(directory)):
                relative = prefix + name
                validate_path(relative)
                require(len(entries) < MAX_ENTRIES, 'entry_limit')
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
                mode = stat.S_IMODE(info.st_mode)
                if stat.S_ISDIR(info.st_mode):
                    validate_mode(mode, 'directory')
                    child = os.open(name, DIR_FLAGS, dir_fd=directory)
                    try:
                        opened = os.fstat(child)
                        require((info.st_dev, info.st_ino, info.st_mode) == (opened.st_dev, opened.st_ino, opened.st_mode), 'directory_changed')
                        entries.append({'path': relative, 'kind': 'directory', 'mode': mode})
                        tree.append({'path': relative, 'kind': 'directory', 'mode': mode, 'size': 0})
                        visit(child, relative + '/')
                    finally:
                        os.close(child)
                elif stat.S_ISREG(info.st_mode):
                    validate_mode(mode, 'file')
                    data, opened = read_regular_at(directory, name, MAX_BYTES - total)
                    require((info.st_dev, info.st_ino, info.st_mode) == (opened.st_dev, opened.st_ino, opened.st_mode), 'file_changed')
                    total += len(data)
                    entries.append({'path': relative, 'kind': 'file', 'mode': mode, 'bytes_base64': base64.b64encode(data).decode('ascii')})
                    tree.append({'path': relative, 'kind': 'file', 'mode': mode, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
                else:
                    raise ValueError('unsupported_entry_type')
        visit(root_descriptor, '')
    finally:
        os.close(root_descriptor)
    return {'root_mode': ROOT_MODE, 'entries': sorted(entries, key=lambda row: row['path']), 'tree': sorted(tree, key=lambda row: row['path']), 'entry_count': len(entries), 'total_bytes': total}

def write_file(path, data, mode, exclusive=False):
    flags = os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    flags |= os.O_CREAT | os.O_EXCL if exclusive else os.O_TRUNC
    descriptor = os.open(path, flags, 0o600)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'not_single_regular_file')
        remaining = memoryview(data)
        while remaining:
            written = os.write(descriptor, remaining)
            require(written > 0, 'short_write')
            remaining = remaining[written:]
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def verify_file(path, expected, mode):
    parent, name = os.path.split(path)
    directory = checked_directory(parent)
    try:
        data, info = read_regular_at(directory, name, MAX_BYTES)
    finally:
        os.close(directory)
    require(data == expected and stat.S_IMODE(info.st_mode) == mode, 'operation_verification_failed')
    return {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'mode': mode}
`;

export const CREATE_AND_MUTATE = String.raw`
${FILESYSTEM_COMMON}
require_fresh_root()
if not os.path.lexists(ROOT):
    os.mkdir(ROOT, ROOT_MODE)
os.chmod(ROOT, ROOT_MODE, follow_symlinks=False)
for relative, mode in [('src', 0o755), ('data', 0o755), ('private', 0o700), ('notes', 0o755), ('empty-directory', 0o755)]:
    os.mkdir(ROOT + '/' + relative, mode)
    os.chmod(ROOT + '/' + relative, mode, follow_symlinks=False)
receipts = []

def put(operation, path, data, mode):
    destination = ROOT + '/' + path
    write_file(destination, data, mode, exclusive=operation == 'create')
    state = verify_file(destination, data, mode)
    sync_directory(os.path.dirname(destination))
    receipts.append({'index': len(receipts) + 1, 'operation': operation, 'path': path, 'completed': True, **state})

def move(source, destination, data, mode):
    require(not os.path.lexists(ROOT + '/' + destination), 'rename_destination_exists')
    os.rename(ROOT + '/' + source, ROOT + '/' + destination)
    require(not os.path.lexists(ROOT + '/' + source), 'rename_source_still_exists')
    state = verify_file(ROOT + '/' + destination, data, mode)
    for parent in {os.path.dirname(ROOT + '/' + source), os.path.dirname(ROOT + '/' + destination)}:
        sync_directory(parent)
    receipts.append({'index': len(receipts) + 1, 'operation': 'rename', 'path': destination, 'previous_path': source, 'completed': True, 'source_absent': True, **state})

def remove(path, data, mode):
    state = verify_file(ROOT + '/' + path, data, mode)
    os.unlink(ROOT + '/' + path)
    require(not os.path.lexists(ROOT + '/' + path), 'delete_target_still_exists')
    sync_directory(os.path.dirname(ROOT + '/' + path))
    receipts.append({'index': len(receipts) + 1, 'operation': 'delete', 'path': path, 'completed': True, 'absent': True, 'previous': state})

put('create', 'README.md', b'# M0 files\nInitial revision.\n', 0o644)
put('create', 'src/main.py', b'#!/usr/bin/env python3\nprint("m0 files")\n', 0o755)
put('create', 'data/input.json', b'{"revision":1,"items":[]}\n', 0o644)
put('create', 'data/obsolete.csv', b'id,value\n1,obsolete\n', 0o644)
put('create', 'private/token.txt', b'SYNTHETIC_M0_VALUE\n', 0o600)
put('create', 'notes/draft.txt', b'A draft that will be renamed.\n', 0o644)
put('create', 'data/blob.bin', b'\x00\x01initial\xff', 0o600)
put('create', 'empty.txt', b'', 0o644)
put('update', 'README.md', b'# M0 files\nUpdated through the real filesystem.\n', 0o644)
put('update', 'src/main.py', b'#!/usr/bin/env python3\nprint("m0 files")\nprint("revision 2")\n', 0o755)
put('update', 'data/input.json', b'{"revision":2,"items":[1,2,3]}\n', 0o644)
put('update', 'private/token.txt', b'SYNTHETIC_M0_VALUE\nrotation=2\n', 0o600)
move('notes/draft.txt', 'notes/final.txt', b'A draft that will be renamed.\n', 0o644)
move('data/obsolete.csv', 'data/remove-me.csv', b'id,value\n1,obsolete\n', 0o644)
remove('data/remove-me.csv', b'id,value\n1,obsolete\n', 0o644)
put('create', 'scratch.txt', b'scratch revision 1\n', 0o600)
put('update', 'scratch.txt', b'scratch revision 2\n', 0o600)
move('scratch.txt', 'notes/scratch-renamed.txt', b'scratch revision 2\n', 0o600)
remove('notes/scratch-renamed.txt', b'scratch revision 2\n', 0o600)
put('update', 'data/blob.bin', b'\x00\x01\x02\xffFINAL\n', 0o600)
require(len(receipts) == 20, 'incorrect_operation_count')
deleted_paths = ['data/obsolete.csv', 'data/remove-me.csv', 'notes/draft.txt', 'scratch.txt', 'notes/scratch-renamed.txt']
require(all(not os.path.lexists(ROOT + '/' + path) for path in deleted_paths), 'deleted_path_present')
snapshot = export_tree(ROOT)
print(json.dumps({'operation_count': len(receipts), 'receipts': receipts, 'root_mode': ROOT_MODE, 'tree': snapshot['tree'], 'deleted_paths': deleted_paths}, sort_keys=True))
`;

export const EXPORT_TREE = String.raw`
${FILESYSTEM_COMMON}
print(json.dumps(export_tree(ROOT), sort_keys=True))
`;

export const RESTORE_TREE_AND_VERIFY = String.raw`
${FILESYSTEM_COMMON}
import binascii, shutil

def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate_json_key')
        result[key] = value
    return result

def load_restore_entries():
    # The input file is fixed, regular, unlinked elsewhere, and bounded before
    # parsing. No archive member can supply a host path or ownership metadata.
    directory = checked_directory(os.path.dirname(RESTORE_INPUT))
    try:
        raw, info = read_regular_at(directory, os.path.basename(RESTORE_INPUT), MAX_JSON_BYTES)
    finally:
        os.close(directory)
    document = json.loads(raw.decode('utf-8'), object_pairs_hook=reject_duplicate_keys)
    require(type(document) is dict and set(document) == {'entries'}, 'invalid_restore_document')
    entries = document['entries']
    require(type(entries) is list and len(entries) <= MAX_ENTRIES, 'entry_limit')
    validated, kinds, total = [], {}, 0
    for entry in entries:
        require(type(entry) is dict, 'invalid_entry')
        kind = entry.get('kind')
        require(kind in ('file', 'directory'), 'unsupported_entry_type')
        fields = {'path', 'kind', 'mode', 'bytes_base64'} if kind == 'file' else {'path', 'kind', 'mode'}
        require(set(entry) == fields, 'invalid_entry_fields')
        path = entry['path']
        validate_path(path)
        require(path.split('/')[0] not in ('.m0-restored-write-probe', '.m0-restored-write-probe-renamed'), 'reserved_write_probe_path')
        require(path not in kinds, 'duplicate_path')
        kinds[path] = kind
        mode = entry['mode']
        validate_mode(mode, kind)
        data = None
        if kind == 'file':
            encoded = entry['bytes_base64']
            require(type(encoded) is str and len(encoded) <= ((MAX_BYTES + 2) // 3) * 4, 'invalid_base64_size')
            try:
                data = base64.b64decode(encoded.encode('ascii'), validate=True)
            except (ValueError, UnicodeError, binascii.Error):
                raise ValueError('invalid_base64')
            require(base64.b64encode(data).decode('ascii') == encoded, 'noncanonical_base64')
            total += len(data)
            require(total <= MAX_BYTES, 'byte_limit')
        validated.append((path, kind, mode, data))
    for path, kind, mode, data in validated:
        parts = path.split('/')
        for index in range(1, len(parts)):
            require(kinds.get('/'.join(parts[:index])) == 'directory', 'missing_parent_directory')
    return validated

validated = load_restore_entries()
require_fresh_root()
require(not os.path.lexists(STAGING), 'staging_already_exists')
os.mkdir(STAGING, 0o700)
committed = False
try:
    directories = sorted((row for row in validated if row[1] == 'directory'), key=lambda row: (row[0].count('/'), row[0]))
    for path, kind, mode, data in directories:
        os.mkdir(STAGING + '/' + path, 0o700)
    for path, kind, mode, data in validated:
        if kind == 'file':
            write_file(STAGING + '/' + path, data, mode, exclusive=True)
            verify_file(STAGING + '/' + path, data, mode)
    for path, kind, mode, data in reversed(directories):
        os.chmod(STAGING + '/' + path, mode, follow_symlinks=False)
        sync_directory(STAGING + '/' + path)
    os.chmod(STAGING, ROOT_MODE, follow_symlinks=False)
    sync_directory(STAGING)
    before = export_tree(STAGING)
    require_fresh_root()
    # POSIX rename replaces an existing empty directory atomically; a nonempty
    # destination or an intervening symlink fails instead of being removed.
    os.replace(STAGING, ROOT)
    committed = True
    sync_directory(os.path.dirname(ROOT))
finally:
    if not committed:
        # Only the staging directory made by this invocation can be removed.
        shutil.rmtree(STAGING)

# A real write probe runs against the committed root. The reserved random-free
# names are refused if present, so imported files are never overwritten.
probe_source = ROOT + '/.m0-restored-write-probe'
probe_destination = ROOT + '/.m0-restored-write-probe-renamed'
require(not os.path.lexists(probe_source) and not os.path.lexists(probe_destination), 'write_probe_name_collision')
probe_data = b'M0 restored filesystem is writable.\n'
write_file(probe_source, probe_data, 0o600, exclusive=True)
probe_state = verify_file(probe_source, probe_data, 0o600)
sync_directory(ROOT)
os.rename(probe_source, probe_destination)
require(not os.path.lexists(probe_source), 'write_probe_rename_failed')
verify_file(probe_destination, probe_data, 0o600)
sync_directory(ROOT)
os.unlink(probe_destination)
require(not os.path.lexists(probe_source) and not os.path.lexists(probe_destination), 'write_probe_delete_failed')
sync_directory(ROOT)
after = export_tree(ROOT)
require(before == after, 'restore_tree_changed')
print(json.dumps({'restored': True, 'root_mode': ROOT_MODE, 'tree': after['tree'], 'entry_count': after['entry_count'], 'total_bytes': after['total_bytes'], 'write_probe': {'completed': True, 'created': True, 'renamed': True, 'deleted': True, **probe_state}}, sort_keys=True))
`;
