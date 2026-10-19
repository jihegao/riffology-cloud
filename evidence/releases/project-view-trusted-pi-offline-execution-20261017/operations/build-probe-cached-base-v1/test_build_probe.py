"""Pure offline guards; no Docker/SSH/API subprocess is run."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('build_probe_runner', HERE / 'build-probe-once.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
REQ = '57a70587-2b21-4a56-aed1-09c8a32d868a'
ORIGINAL = 'a' * 64
IMAGE = 'sha256:' + 'b' * 64

class Guards(unittest.TestCase):
    def test_import_is_inert(self):
        with mock.patch.object(r.subprocess, 'Popen', side_effect=AssertionError('no transport')):
            again = importlib.util.module_from_spec(spec); spec.loader.exec_module(again)

    def test_strict_original_notfound_requires_exact_id_and_status(self):
        data = {'stdout': b'[]\n', 'stderr': ('Error: No such object: ' + ORIGINAL + '\n').encode()}
        self.assertTrue(r.missing_container(1, data, ORIGINAL))
        for rc, stderr in [(0, data['stderr']), (1, b'permission denied'), (1, b'Error: No such object: other')]:
            self.assertFalse(r.missing_container(rc, {'stdout': b'[]', 'stderr': stderr}, ORIGINAL))

    def test_empty_label_still_inspects_known_original_id(self):
        with mock.patch.object(r, 'labelled_ids', return_value=[]), \
             mock.patch.object(r, 'inspect_original', return_value=None) as inspect, \
             mock.patch.object(r, 'write_new'):
            result = r.cleanup(REQ, IMAGE, ORIGINAL)
        self.assertTrue(result['cleanupConfirmed'])
        self.assertEqual(inspect.call_count, 2)
        self.assertEqual(inspect.call_args.args[1], ORIGINAL)

    def test_unknown_original_inspect_never_confirms_cleanup(self):
        with mock.patch.object(r, 'labelled_ids', return_value=[]), \
             mock.patch.object(r, 'inspect_original', side_effect=r.Stop('unknown')), \
             mock.patch.object(r, 'write_new'):
            self.assertFalse(r.cleanup(REQ, IMAGE, ORIGINAL)['cleanupConfirmed'])

    def test_fixed_task_wide_lock_blocks_second_uuid_before_docker(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(r, 'RECORDS', Path(tmp)), \
             mock.patch.object(r, 'verify_inputs'), mock.patch.object(r, 'command') as docker:
            with self.assertRaises(FileExistsError): r.execute(REQ)
            docker.assert_not_called()

    def test_image_report_requires_12_exact_targets_and_no_real_requests(self):
        manifest = {'fileTargets': [{'imagePath': str(i), 'bytes': i, 'sha256': str(i)} for i in range(12)]}
        report = {'schema': 'trusted-pi-offline-compatibility-probe/v1', 'mode': 'image', 'result': 'passed',
                  'manifestSha256': r.MANIFEST, 'uid': 10002, 'gid': 10002, 'activeAliasActuallyInspected': True,
                  'sourceEquivalentActiveRelease': False, 'sourceMacEncodingNormalized': False,
                  'checkedTargets': 12, 'overlayTargets': 6, 'checks': dict.fromkeys(r.CHECKS, True),
                  'imageTargets': manifest['fileTargets'], 'syntheticRequests': {'model': 3, 'research': 1,
                      'projectToolExecutions': 0, 'ambientFetchCalls': 0}, 'realProviderRequests': 0, 'credentialsReadByProbe': False}
        r.validate_probe(json.dumps(report).encode(), manifest)
        for key, value in [('mode', 'source-equivalence'), ('uid', 0), ('realProviderRequests', 1), ('activeAliasActuallyInspected', False)]:
            changed = dict(report); changed[key] = value
            with self.subTest(key=key), self.assertRaises(r.Stop): r.validate_probe(json.dumps(changed).encode(), manifest)

    def test_build_config_iid_and_engine_descriptor_are_cross_bound(self):
        descriptor = {'digest': 'sha256:' + 'd' * 64, 'size': 856, 'mediaType': 'application/vnd.oci.image.index.v1+json'}
        metadata = {'containerimage.config.digest': IMAGE, 'containerimage.digest': descriptor['digest'],
                    'containerimage.descriptor': descriptor}
        image = {'Id': descriptor['digest'], 'Descriptor': dict(descriptor)}
        bound = r.bind_build_identity(IMAGE, metadata, image)
        self.assertEqual(bound['iidRole'], 'config')
        self.assertEqual(bound['engineIdRole'], 'descriptor')
        for changed in [dict(image, Id='sha256:' + 'e' * 64), dict(image, Descriptor=dict(descriptor, digest='sha256:' + 'e' * 64)),
                        {'Id': IMAGE}]:
            with self.assertRaises(r.Stop): r.bind_build_identity(IMAGE, metadata, changed)


    def test_prefer_image_digest_metadata_without_config_is_explicit(self):
        descriptor = {'digest': 'sha256:' + 'd' * 64, 'size': 856, 'mediaType': 'application/vnd.oci.image.index.v1+json'}
        metadata = {'containerimage.digest': descriptor['digest'], 'containerimage.descriptor': descriptor}
        image = {'Id': descriptor['digest'], 'Descriptor': dict(descriptor)}
        result = r.bind_build_identity(descriptor['digest'], metadata, image)
        self.assertIsNone(result['configDigest'])
        self.assertEqual(result['iidRole'], 'descriptor')
        self.assertEqual(result['engineIdRole'], 'descriptor')
        with self.assertRaises(r.Stop): r.bind_build_identity(IMAGE, metadata, image)


    def cached_fixture(self, root):
        original = root / ('pull-once-' + REQ); original.mkdir()
        (original / 'intent.json').write_text(json.dumps({'schema': 'trusted-pi-pull-original-intent/v1',
            'requestId': REQ, 'grantSha256': r.ORIGINAL_GRANT_SHA, 'operationsManifestSha256': r.ORIGINAL_OPERATIONS_SHA,
            'baseImage': r.BASE, 'receiverPid': 12345, 'receiverStartTicks': '6789'}))
        (original / 'terminal.json').write_text(json.dumps({'schema': 'trusted-pi-pull-terminal/v1', 'requestId': REQ,
            'status': 'unknown-stopped', 'errorCode': 'stdin-eof', 'authConfigAbsent': True,
            'routeBindAddressesBeforeCredential': ['127.0.0.1']}))
        return original

    def test_cached_gate_preserves_unknown_and_requires_actual_original_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); original = self.cached_fixture(root)
            sock = mock.MagicMock(); sock.__enter__.return_value = sock; sock.connect_ex.return_value = 111
            with mock.patch.object(r, 'ROOT', root), mock.patch.object(r, 'process_start_ticks', return_value=None), \
                 mock.patch.object(r, 'listener_addresses', return_value=[]), mock.patch.object(r.socket, 'socket', return_value=sock):
                p = r.verify_original_cleanup()
                self.assertEqual(p['originalCredentialPostOutcome'], 'unknown-stopped-preserved')
                self.assertTrue(p['credentialNotDeliveredToReceiver'])
                (original / 'docker-auth').mkdir()
                with self.assertRaises(r.Stop): r.verify_original_cleanup()

    def test_cached_gate_rejects_live_original_pid_listener_and_ambiguous_connection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); self.cached_fixture(root)
            sock = mock.MagicMock(); sock.__enter__.return_value = sock; sock.connect_ex.return_value = 111
            with mock.patch.object(r, 'ROOT', root), mock.patch.object(r, 'process_start_ticks', return_value='6789'), \
                 mock.patch.object(r, 'listener_addresses', return_value=[]), mock.patch.object(r.socket, 'socket', return_value=sock):
                with self.assertRaises(r.Stop): r.verify_original_cleanup()
            for addresses, code in [(['127.0.0.1'], 111), ([], 5)]:
                sock.connect_ex.return_value = code
                with mock.patch.object(r, 'ROOT', root), mock.patch.object(r, 'process_start_ticks', return_value=None), \
                     mock.patch.object(r, 'listener_addresses', return_value=addresses), mock.patch.object(r.socket, 'socket', return_value=sock):
                    with self.assertRaises(r.Stop): r.verify_original_cleanup()

    def test_cached_gate_rejects_another_uuid_and_wrong_terminal(self):
        with mock.patch.object(r, 'verify_inputs') as verify:
            with self.assertRaises(r.Stop): r.execute('11111111-2222-4333-8444-555555555555')
            verify.assert_not_called()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); original = self.cached_fixture(root)
            (original / 'terminal.json').write_text(json.dumps({'status': 'fixed-base-pull-verified'}))
            with mock.patch.object(r, 'ROOT', root):
                with self.assertRaises(r.Stop): r.verify_original_cleanup()


if __name__ == '__main__': unittest.main()
