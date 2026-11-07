"""Synthetic in-memory archives only. No Docker/SSH/API/auth file is used."""
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('metadata', Path(__file__).with_name('image_layer_metadata.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
A = 'opt/riffology/a.mjs'; B = 'opt/riffology/b.mjs'
TARGETS = {A: {'bytes': 3, 'sha256': hashlib.sha256(b'aaa').hexdigest()},
           B: {'bytes': 3, 'sha256': hashlib.sha256(b'bbb').hexdigest()}}
LAYER = 'application/vnd.oci.image.layer.v1.tar'
JSON_TYPE = 'application/vnd.oci.image.config.v1+json'
MANIFEST_TYPE = 'application/vnd.oci.image.manifest.v1+json'
INDEX_TYPE = 'application/vnd.oci.image.index.v1+json'

def raw_tar(entries):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w', format=tarfile.USTAR_FORMAT) as tf:
        for name, data, uid, mode, kind in entries:
            info = tarfile.TarInfo(name); info.uid = uid; info.gid = 0; info.mode = mode
            if kind == 'link': info.type = tarfile.SYMTYPE; info.linkname = '/etc/passwd'; data = b''
            if kind == 'dir': info.type = tarfile.DIRTYPE; data = b''
            info.size = len(data); tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()

def file(name, data=b'aaa', uid=0, mode=0o444): return (name, data, uid, mode, 'file')

def fixture(layer_entries, compressed=False, reverse=False, root_index=False, corrupt=False, attestation=False):
    blobs, descriptors, diffs = {}, [], []
    def add(raw, media):
        digest = 'sha256:' + hashlib.sha256(raw).hexdigest(); blobs[digest] = raw
        return {'digest': digest, 'size': len(raw), 'mediaType': media}
    for entries in layer_entries:
        raw = raw_tar(entries); diffs.append('sha256:' + hashlib.sha256(raw).hexdigest())
        descriptors.append(add(gzip.compress(raw, mtime=0) if compressed else raw, LAYER + ('+gzip' if compressed else '')))
    config = add(json.dumps({'os': 'linux', 'architecture': 'amd64', 'rootfs': {'type': 'layers', 'diff_ids': diffs},
                             'config': {'Env': ['SYNTHETIC_SECRET=DO_NOT_RETURN']}}).encode(), JSON_TYPE)
    root = add(json.dumps({'schemaVersion': 2, 'config': config, 'layers': descriptors}).encode(), MANIFEST_TYPE)
    selected = dict(root)
    if root_index:
        children = [root]
        if attestation:
            attest_config = add(json.dumps({'os': 'unknown', 'architecture': 'unknown', 'rootfs': {'type': 'layers', 'diff_ids': []}}).encode(), JSON_TYPE)
            attest_body = add(b'{"_type":"SYNTHETIC-ATTESTATION-NOT-TRUSTED"}', 'application/vnd.in-toto+json')
            attest_manifest = add(json.dumps({'schemaVersion': 2, 'config': attest_config, 'layers': [attest_body]}).encode(), MANIFEST_TYPE)
            children.insert(0, attest_manifest)
        root = add(json.dumps({'schemaVersion': 2, 'manifests': children}).encode(), INDEX_TYPE)
    if corrupt:
        key = descriptors[0]['digest']; blobs[key] = blobs[key][:512] + b'z' + blobs[key][513:]
    entries = [('oci-layout', b'{"imageLayoutVersion":"1.0.0"}', 0, 0o444, 'file'),
               ('index.json', json.dumps({'schemaVersion': 2, 'manifests': [root]}).encode(), 0, 0o444, 'file')]
    pairs = list(blobs.items())
    if reverse: pairs.reverse()
    entries += [('blobs/sha256/' + d[7:], b, 0, 0o444, 'file') for d, b in pairs]
    return raw_tar(entries), {'rootDescriptor': root, 'diffIds': diffs, 'expectedSelectedManifest': selected}

class Tests(unittest.TestCase):
    def parse(self, raw, binding):
        with mock.patch.object(m, 'TARGETS', TARGETS):
            return m.parse_archive(io.BytesIO(raw), binding, m.Budget())

    def test_arbitrary_outer_order_gzip_and_index_bindings(self):
        raw, binding = fixture([[file(A), file(B, b'bbb', mode=0o666)]], compressed=True, reverse=True, root_index=True, attestation=True)
        result = self.parse(raw, binding)
        self.assertEqual(len(result['targets']), 2)
        self.assertEqual(result['selectedManifest'], binding['expectedSelectedManifest'])
        self.assertEqual(result['archiveBytesObserved'], len(raw))
        self.assertEqual(result['archiveSha256'], hashlib.sha256(raw).hexdigest())
        self.assertTrue(result['targets'][0]['ownershipGuardWouldPass'])
        self.assertFalse(result['targets'][1]['ownershipGuardWouldPass'])
        self.assertEqual(result['targets'][1]['modeOctal'], '0666')
        self.assertTrue(all(t['matchesFrozenSizeAndSha'] for t in result['targets']))
        self.assertNotIn('DO_NOT_RETURN', json.dumps(result))
        self.assertNotIn('Env', json.dumps(result))
        self.assertFalse(result['runtimeFilesystemStatProved'])

    def test_whiteout_opaque_applied_before_same_layer_additions(self):
        raw, binding = fixture([[file(A), file(B, b'bbb')],
            [file(A, uid=10002), file('opt/riffology/.wh..wh..opq', b'', mode=0) ]])
        targets = self.parse(raw, binding)['targets']
        self.assertTrue(targets[0]['present'])
        self.assertEqual(targets[0]['uid'], 10002)
        self.assertFalse(targets[1]['present'])

    def test_explicit_ancestor_whiteout_hides_lower_targets(self):
        raw, binding = fixture([[file(A), file(B, b'bbb')], [file('opt/.wh.riffology', b'', mode=0)]])
        self.assertTrue(all(not t['present'] for t in self.parse(raw, binding)['targets']))

    def test_paths_duplicates_and_target_links_fail(self):
        for entries in [[file('../escape')], [file(A), file(A)], [(A, b'', 0, 0o444, 'link')],
                        [('opt', b'', 0, 0o777, 'link')], [file('/absolute')]]:
            raw, binding = fixture([entries])
            with self.subTest(entries=entries), self.assertRaises(m.Stop): self.parse(raw, binding)

    def test_bad_blob_hash_and_wrong_diffid_fail(self):
        raw, binding = fixture([[file(A)]], corrupt=True)
        with self.assertRaises(m.Stop): self.parse(raw, binding)
        raw, binding = fixture([[file(A)]])
        binding['diffIds'] = ['sha256:' + 'a' * 64]
        with self.assertRaises(m.Stop): self.parse(raw, binding)

    def test_target_size_and_parser_read_bounds(self):
        raw, binding = fixture([[file(A, b'x' * (1024 * 1024 + 1))]])
        with self.assertRaises(m.Stop): self.parse(raw, binding)
        reader = m.Reader(io.BytesIO(b'x'), 10, m.Budget())
        with self.assertRaises(m.Stop): reader.read(1024 * 1024 + 1)

    def test_tar_end_blocks_are_fully_hashed_after_tarfile_first_zero(self):
        original = raw_tar([file(A)])
        for raw in (original, original[:2048]):
            with mock.patch.object(m, 'TARGETS', TARGETS):
                layer = m.layer_summary(io.BytesIO(raw), 'raw', m.Budget(), 'sha256:' + 'a' * 64)
            self.assertEqual(layer['diffId'], 'sha256:' + hashlib.sha256(raw).hexdigest())
            self.assertEqual(layer['uncompressedBytes'], len(raw))
        with mock.patch.object(m, 'TARGETS', TARGETS), self.assertRaises(m.Stop):
            m.layer_summary(io.BytesIO(original[:1536]), 'raw', m.Budget(), 'sha256:' + 'a' * 64)


    def test_parser_memory_soft_limit_is_restored(self):
        previous = (m.resource.RLIM_INFINITY, m.resource.RLIM_INFINITY)
        with mock.patch.object(m.resource, 'getrlimit', return_value=previous), \
             mock.patch.object(m.resource, 'setrlimit') as limit, \
             mock.patch.object(m, 'parse_archive', side_effect=m.Stop('synthetic')):
            with self.assertRaises(m.Stop): m.parse_with_memory_limit(None, None, None)
        self.assertEqual(limit.call_args_list[0].args[1], (256 * 1024 * 1024, previous[1]))
        self.assertEqual(limit.call_args_list[-1].args[1], previous)

    def constructor_failure(self, selector_failure):
        proc = mock.Mock(); proc.pid = 12345; proc.poll.side_effect = [None, 0, 0, 0]
        selector = mock.Mock()
        if selector_failure: selector.register.side_effect = OSError('synthetic private text')
        with mock.patch.object(m.subprocess, 'Popen', return_value=proc), \
             mock.patch.object(m, 'start_ticks', return_value='678'), \
             mock.patch.object(m, 'write_new', side_effect=None if selector_failure else OSError('synthetic private text')), \
             mock.patch.object(m.selectors, 'DefaultSelector', return_value=selector), \
             mock.patch.object(m.os, 'killpg') as kill:
            with self.assertRaises(m.Stop) as caught: m.Pipe('fake', [], m.Budget(), 1024)
        self.assertEqual(str(caught.exception), 'read-cli-initialization-failed')
        self.assertTrue(caught.exception.cli_identity['originalCliReaped'])
        kill.assert_called_once_with(12345, m.signal.SIGTERM)
        proc.stdout.close.assert_called_once(); proc.stderr.close.assert_called_once()
        if selector_failure: selector.close.assert_called_once()

    def test_pid_record_write_failure_cleans_original_child(self): self.constructor_failure(False)
    def test_selector_failure_cleans_original_child(self): self.constructor_failure(True)

    def test_import_has_no_live_side_effect(self):
        with mock.patch.object(m.subprocess, 'Popen', side_effect=AssertionError('no spawn')):
            module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

if __name__ == '__main__': unittest.main()
