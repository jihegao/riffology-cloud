"""Offline-only tests. No credential file, network, SSH or Docker is used."""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

op = module('pi_pull_operator', 'pull-operator.py')
rx = module('pi_pull_receiver', 'pull-receiver.py')
REQ = '11111111-2222-4333-8444-555555555555'
GSH = 'a' * 64
MSH = 'b' * 64
NOW = 1792234800


def grant():
    return {'schema': op.SCHEMA, 'authority': 'direct-human-instruction-recorded-by-root',
            'rootReviewCompleted': True, 'humanInstruction': 'synthetic test only; not a grant',
            'accountId': op.ACCOUNT, 'registryHost': op.REGISTRY, 'baseImage': op.BASE,
            'recipient': 'AMD128', 'remoteDirectory': op.REMOTE_ROOT,
            'archiveSha256': op.ARCHIVE_SHA, 'archiveBytes': op.ARCHIVE_BYTES,
            'operationsManifestSha256': MSH, 'packetCommit': 'c' * 40, 'requestId': REQ,
            'operations': list(op.OPERATIONS), 'credential': {'expiration_minutes': 15, 'permissions': ['pull']},
            'route': {'remoteBind': '127.0.0.1:7897', 'localDestination': '127.0.0.1:7892'},
            'startsAt': dt.datetime.fromtimestamp(NOW - 10, dt.timezone.utc).isoformat(),
            'endsAt': dt.datetime.fromtimestamp(NOW + 800, dt.timezone.utc).isoformat(),
            **{k: False for k in ['allowRegistryPush', 'allowCloudAppUpdate', 'allowRealProviderTurnRun', \
                                  'allowNewSubscription', 'allowOAuthTransfer', 'allowAutomaticRefreshLoginOrNewScopes']}}


def credential():
    return {'account_id': op.ACCOUNT, 'registry_host': op.REGISTRY,
            'username': 'synthetic-server-chosen-user', 'password': 'SYNTHETIC-NOT-A-REAL-TOKEN'}


class GuardTests(unittest.TestCase):
    def test_inert_imports_do_not_touch_auth_or_transport(self):
        with mock.patch('subprocess.Popen', side_effect=AssertionError('no subprocess')), \
             mock.patch('urllib.request.build_opener', side_effect=AssertionError('no network')):
            module('inert_operator', 'pull-operator.py')
            module('inert_receiver', 'pull-receiver.py')

    def test_missing_grant_cli_stops_before_credential_or_client(self):
        argv = ['operator', '--execute', '--grant', '/nonexistent/synthetic-grant.json', \
                '--grant-sha256', GSH, '--operations-sha256', MSH, \
                '--archive', '/nonexistent/archive', '--state-root', '/nonexistent/state']
        with mock.patch.object(op.sys, 'argv', argv), mock.patch.object(op, 'read_oauth') as auth, \
             mock.patch.object(op, 'create_pull_credential') as token, mock.patch.object(op, 'start_ssh') as ssh, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(op.main(), 1)
        auth.assert_not_called(); token.assert_not_called(); ssh.assert_not_called()
        self.assertNotIn('SYNTHETIC', output.getvalue())

    def test_exact_grant_target_and_permission(self):
        op.validate_grant(grant(), GSH, MSH, now=NOW)
        for key, value in [('baseImage', op.BASE + '0'), ('recipient', 'OTHER'), ('accountId', '0' * 32), \
                           ('credential', {'expiration_minutes': 15, 'permissions': ['pull', 'push']}), \
                           ('allowOAuthTransfer', True), ('operationsManifestSha256', 'd' * 64)]:
            g = grant(); g[key] = value
            with self.subTest(key=key), self.assertRaises(op.Stop):
                op.validate_grant(g, GSH, MSH, now=NOW)

    def test_expiry_blocks_execution_but_original_cleanup_may_continue(self):
        with self.assertRaises(op.Stop):
            op.validate_grant(grant(), GSH, MSH, now=NOW + 1000)
        op.validate_grant(grant(), GSH, MSH, now=NOW + 1000, cleanup=True)

    def test_bad_grant_hash_stops_before_later_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'grant.json'; path.write_bytes(op.canonical(grant())); path.chmod(0o600)
            with self.assertRaisesRegex(op.Stop, 'grant-file-drift'):
                op.load_inputs(path, GSH, MSH, Path(tmp) / 'absent-archive')

    def test_second_original_lock_rejected_before_auth_or_transport(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / REQ).mkdir()
            with mock.patch.object(op, 'read_oauth') as auth, mock.patch.object(op, 'start_ssh') as ssh:
                with self.assertRaises(FileExistsError):
                    op.execute(grant(), {}, b'{}\n', GSH, MSH, root)
            auth.assert_not_called(); ssh.assert_not_called()

    def test_oauth_scope_expiry_guard_only_mock_bytes(self):
        def config(expiry, scopes):
            return ('oauth_token = "synthetic-oauth-only"\nexpiration_time = "' + expiry +
                    '"\nscopes = ' + json.dumps(scopes) + '\n').encode()
        with mock.patch.object(op, 'bounded_file', return_value=config('2099-01-01T00:00:00Z', sorted(op.OAUTH_SCOPES))):
            self.assertEqual(op.read_oauth(), 'synthetic-oauth-only')
        for raw in [config('2000-01-01T00:00:00Z', sorted(op.OAUTH_SCOPES)), config('2099-01-01T00:00:00Z', ['workers:write'])]:
            with mock.patch.object(op, 'bounded_file', return_value=raw), self.assertRaises(op.Stop):
                op.read_oauth()

    def test_api_uses_exact_201_body_and_proxy_only_fake(self):
        class Response:
            status = 201
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, limit): return op.canonical({'success': True, 'result': credential()})
        fake = mock.Mock(); fake.open.return_value = Response()
        with mock.patch.object(op.urllib.request, 'build_opener', return_value=fake) as build:
            self.assertEqual(op.create_pull_credential('synthetic-oauth'), credential())
        request = fake.open.call_args.args[0]
        self.assertEqual(request.full_url, op.CREDENTIAL_URL)
        self.assertEqual(request.method, 'POST')
        self.assertEqual(json.loads(request.data), {'expiration_minutes': 15, 'permissions': ['pull']})
        self.assertEqual(build.call_args.args[0].proxies, {'https': 'http://127.0.0.1:7892'})
        self.assertEqual(fake.open.call_count, 1)

    def test_unknown_api_no_retry_or_external_error_text(self):
        fake = mock.Mock(); fake.open.side_effect = RuntimeError('SYNTHETIC-SENSITIVE-ERROR-BODY')
        with mock.patch.object(op.urllib.request, 'build_opener', return_value=fake):
            with self.assertRaisesRegex(op.Stop, '^credential-api-unknown-stop-no-retry$'):
                op.create_pull_credential('synthetic-oauth')
        self.assertEqual(fake.open.call_count, 1)

    def test_stdin_envelope_exact_target_and_server_chosen_username(self):
        e = {'schema': 'trusted-pi-pull-credential-envelope/v1', 'requestId': REQ, 'credential': credential()}
        self.assertEqual(rx.validate_credential(e, REQ)['username'], 'synthetic-server-chosen-user')
        for mutation in ['wrong-request', 'extra-field', 'wrong-registry']:
            q = json.loads(json.dumps(e))
            if mutation == 'wrong-request': q['requestId'] = 'wrong'
            if mutation == 'extra-field': q['credential']['other'] = 'bad'
            if mutation == 'wrong-registry': q['credential']['registry_host'] = 'other.invalid'
            with self.subTest(mutation=mutation), self.assertRaises(rx.Stop):
                rx.validate_credential(q, REQ)

    def test_config_mode_fixed_pull_no_password_argv_and_cleanup(self):
        calls = []
        with tempfile.TemporaryDirectory() as tmp:
            task = Path(tmp)
            def fake(argv, seconds):
                calls.append((argv, seconds))
                cfg = task / 'docker-auth/config.json'
                self.assertEqual(cfg.stat().st_mode & 0o777, 0o600)
                self.assertEqual(cfg.parent.stat().st_mode & 0o777, 0o700)
                parsed = json.loads(cfg.read_bytes())
                self.assertEqual(set(parsed), {'auths'})
                self.assertNotIn(credential()['password'], ' '.join(argv))
                self.assertEqual(argv[:3], rx.DOCKER)
                if 'pull' in argv:
                    self.assertEqual(argv[-4:], ['pull', '--platform', 'linux/amd64', rx.BASE])
                    return {'stdout': b'', 'stderr': b''}, {}
                return {'stdout': json.dumps({'Os': 'linux', 'Architecture': 'amd64', 'RepoDigests': [rx.BASE], \
                                               'Id': 'sha256:independent-engine-id'}).encode(), 'stderr': b''}, {}
            result = rx.pull_with_config(task, credential(), run=fake)
            self.assertEqual(result['image']['id'], 'sha256:independent-engine-id')
            self.assertFalse((task / 'docker-auth').exists())
        self.assertEqual([x[1] for x in calls], [600, 30])

    def test_lost_pull_ack_removes_config_without_success_or_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            calls = []
            def lost(argv, seconds):
                calls.append(argv)
                raise rx.Stop('command-timeout')
            with self.assertRaisesRegex(rx.Stop, 'command-timeout'):
                rx.pull_with_config(Path(tmp), credential(), run=lost)
            self.assertEqual(len(calls), 1)
            self.assertFalse((Path(tmp) / 'docker-auth').exists())

    def test_owned_identity_and_listener_unknown_cannot_confirm_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(rx, 'ROOT', Path(tmp)), mock.patch.object(rx, 'listener_addresses', return_value=[]):
            task = rx.fixed_task(REQ); task.mkdir()
            rx.write_new(task / 'intent.json', {'requestId': REQ, 'grantSha256': GSH, \
                         'operationsManifestSha256': MSH, 'receiverPid': 12345, 'receiverStartTicks': 'original'})
            rx.write_new(task / 'terminal.json', {'status': 'unknown-stopped'})
            sock = mock.Mock(); sock.connect_ex.return_value = 5
            with mock.patch.object(rx, 'proc_start', return_value=None), mock.patch.object(rx.socket, 'socket', return_value=sock):
                self.assertFalse(rx.readback(REQ, GSH, MSH)['cleanupConfirmed'])
            sock.connect_ex.return_value = 111
            with mock.patch.object(rx, 'proc_start', return_value='original'), mock.patch.object(rx.socket, 'socket', return_value=sock):
                self.assertFalse(rx.readback(REQ, GSH, MSH)['cleanupConfirmed'])
            with mock.patch.object(rx, 'proc_start', return_value=None), mock.patch.object(rx.socket, 'socket', return_value=sock):
                result = rx.readback(REQ, GSH, MSH)
                self.assertTrue(result['cleanupConfirmed'])
                self.assertEqual(result['terminal']['status'], 'unknown-stopped')
                self.assertNotIn('pull-verified', result)

    def test_final_stop_error_still_records_original_cleanup_and_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = mock.Mock(); proc.pid = 4321
            proc.stdin = mock.Mock()
            proc.stdin.close.side_effect = BrokenPipeError()
            cleanup = {'schema': 'trusted-pi-pull-cleanup-readback/v1', 'requestId': REQ,
                       'cleanupConfirmed': False, 'terminal': {'status': 'unknown-stopped'}}
            with mock.patch.object(op.subprocess, 'check_output', return_value=b''), \
                 mock.patch.object(op, 'start_ssh', return_value=proc), \
                 mock.patch.object(op, 'read_json_line', return_value={'schema': 'trusted-pi-pull-receiver-ready/v1', 'requestId': REQ}), \
                 mock.patch.object(op, 'validate_grant'), \
                 mock.patch.object(op, 'read_oauth', return_value='synthetic-oauth'), \
                 mock.patch.object(op, 'create_pull_credential', return_value=credential()) as create, \
                 mock.patch.object(op, 'stop_owned', side_effect=RuntimeError('synthetic-stop-error')), \
                 mock.patch.object(op, 'read_cleanup', return_value=cleanup) as read:
                result = op.execute(grant(), {}, b'{}\n', GSH, MSH, tmp)
            self.assertEqual(create.call_count, 1)
            self.assertEqual(read.call_args.args[1:], (REQ, GSH, MSH))
            self.assertEqual(result['status'], 'unknown-stopped')
            self.assertFalse(result['ownedSshTerminated'])
            saved = json.loads((Path(tmp) / REQ / 'result.json').read_bytes())
            self.assertEqual(saved, result)
            self.assertNotIn('SYNTHETIC-NOT-A-REAL-TOKEN', json.dumps(saved))


    def test_stop_owned_broken_pipe_and_exit_race_still_settles(self):
        proc = mock.Mock()
        proc.stdin.closed = False
        proc.stdin.close.side_effect = BrokenPipeError()
        proc.pid = 1234
        proc.poll.side_effect = [None, None, 0]
        proc.wait.side_effect = [op.subprocess.TimeoutExpired('fake', 15), 0]
        with mock.patch.object(op.os, 'killpg', side_effect=ProcessLookupError()):
            self.assertTrue(op.stop_owned(proc))
        self.assertEqual(proc.wait.call_count, 2)

    def test_stop_owned_unconfirmed_does_not_claim_termination(self):
        proc = mock.Mock(); proc.stdin.closed = False; proc.poll.return_value = None
        proc.stdin.close.side_effect = BrokenPipeError()
        proc.wait.side_effect = op.subprocess.TimeoutExpired('fake', 15)
        with mock.patch.object(op.os, 'killpg', side_effect=PermissionError()):
            self.assertFalse(op.stop_owned(proc))

    def test_actual_wildcard_listener_is_observed_and_rejected(self):
        header = 'sl local_address rem_address st rest\n'
        for address, expected in [('0100007F', ['127.0.0.1']), ('00000000', ['0.0.0.0'])]:
            def table(path):
                return header + ('0: ' + address + ':1ED9 00000000:0000 0A rest\n' if str(path).endswith('/tcp') else '')
            with mock.patch.object(rx.Path, 'read_text', table):
                actual = rx.listener_addresses()
                self.assertEqual(actual, expected)
                self.assertEqual(actual == ['127.0.0.1'], address == '0100007F')


    def test_ssh_argv_has_exact_route_and_no_credential(self):
        args = op.ssh_argv(b'print("public receiver")', ['execute', REQ, GSH, MSH], True)
        self.assertIn('127.0.0.1:7897:127.0.0.1:7892', args)
        self.assertIn('-oControlMaster=no', args)
        self.assertEqual(args[-2], 'AMD128')
        self.assertNotIn(credential()['password'], ' '.join(args))
        readonly = op.ssh_argv(b'print("public receiver")', ['readback', REQ, GSH, MSH], False)
        self.assertNotIn('-R', readonly)


if __name__ == '__main__':
    unittest.main()
