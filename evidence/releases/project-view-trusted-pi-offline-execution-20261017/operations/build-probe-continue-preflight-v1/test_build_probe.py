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
            with self.assertRaises(r.Stop): r.execute(REQ)
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


    def test_plain_builder_header_ignores_node_name(self):
        raw = b'Name: default\nDriver: docker\nLast Activity: now\nNodes:\nName: default-node\nEndpoint: default\n'
        self.assertEqual(r.parse_default_builder(raw), {'Name': 'default', 'Driver': 'docker'})
        for bad in [b'Name: default\nDriver: docker', b'Name: default\nName: other\nDriver: docker\nNodes:\n',
                    b'Name: default\nDriver: docker-container\nNodes:\n', b'Name: other\nDriver: docker\nNodes:\n']:
            with self.assertRaises(r.Stop): r.parse_default_builder(bad)

    def continuation_fixture(self, root):
        (root / 'empty-docker-config').mkdir(); (root / 'empty-home').mkdir()
        (root / 'empty-docker-config/config.json').write_text('{"auths":{}}\n')
        values = {
            'result.json': {'requestId': REQ, 'status': 'unknown-stopped', 'errorCode': 'command-nonzero-default-builder-inspect',
                            'cleanup': {'cleanupConfirmed': True, 'containerCreateNeverAttempted': True}},
            'intent.json': {'requestId': REQ, 'baseImage': r.BASE, 'oneBuild': True, 'oneCreate': True},
            'default-builder-inspect.intent.json': {'argv': r.DOCKER + ['--config', str(root / 'empty-docker-config'),
                                                    'buildx', 'inspect', 'default', '--format', '{{json .}}']},
            'default-builder-inspect.result.json': {'exitCode': 125, 'error': None, 'originalCliReaped': True,
                                                   'originalCliPid': 12345, 'originalCliLinuxStartTicks': '789',
                                                   'streams': {'stdout': {'discardedBytes': 0}, 'stderr': {'discardedBytes': 0}}},
            'default-builder-inspect.original-cli.json': {'pid': 12345, 'linuxStartTicks': '789'}}
        for name, value in values.items(): (root / name).write_text(json.dumps(value))
        (root / 'default-builder-inspect.stderr').write_bytes(b'unknown flag: --format\n')
        return {p.relative_to(root).as_posix(): {'bytes': len(p.read_bytes()), 'sha256': r.sha(p.read_bytes())}
                for p in root.rglob('*') if p.is_file()}

    def test_only_unchanged_readonly_failure_can_continue(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); files = self.continuation_fixture(root)
            with mock.patch.object(r, 'RECORDS', root), mock.patch.object(r, 'ORIGINAL_PREFLIGHT_FILES', files), \
                 mock.patch.object(r, 'process_start_ticks', return_value=None):
                self.assertTrue(r.verify_readonly_failure_continuation()['continuingFirstBuildOnly'])
                (root / 'build-once-intent.json').write_text('{}')
                with self.assertRaises(r.Stop): r.verify_readonly_failure_continuation()
                (root / 'build-once-intent.json').unlink()
                (root / 'result.json').write_text('{}')
                with self.assertRaises(r.Stop): r.verify_readonly_failure_continuation()

    def test_existing_continuation_or_live_old_cli_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); files = self.continuation_fixture(root)
            with mock.patch.object(r, 'RECORDS', root), mock.patch.object(r, 'ORIGINAL_PREFLIGHT_FILES', files), \
                 mock.patch.object(r, 'process_start_ticks', return_value='789'):
                with self.assertRaises(r.Stop): r.verify_readonly_failure_continuation()
            (root / 'continue-readonly-preflight-once.intent.json').write_text('{}')
            with mock.patch.object(r, 'RECORDS', root), mock.patch.object(r, 'ORIGINAL_PREFLIGHT_FILES', files), \
                 mock.patch.object(r, 'process_start_ticks', return_value=None):
                with self.assertRaises(r.Stop): r.verify_readonly_failure_continuation()


if __name__ == '__main__': unittest.main()
