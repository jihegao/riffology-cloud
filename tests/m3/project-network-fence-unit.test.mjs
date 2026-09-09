import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('project connection fence requires every syscall rule and fails closed', () => {
  const script = String.raw`
import sys, pathlib, unittest
from unittest.mock import patch, MagicMock, mock_open
sys.path.insert(0,str(pathlib.Path('services/project-tools').resolve()))
import project_network_fence as f
import effect_wrapper as effect
class Cases(unittest.TestCase):
    def library(self):
        lib=MagicMock()
        lib.seccomp_init.return_value=1
        lib.seccomp_syscall_resolve_name.return_value=42
        lib.seccomp_rule_add.return_value=0
        lib.seccomp_load.return_value=0
        return lib
    def test_all_rules(self):
        lib=self.library()
        with patch.object(f,'no_new_privileges') as nnp, patch.object(f.ctypes,'CDLL',return_value=lib):
            f.install(); nnp.assert_called_once()
        self.assertEqual([call.args[0] for call in lib.seccomp_syscall_resolve_name.call_args_list], [n.encode() for n in f.DENIED_SYSCALLS])
        self.assertEqual(lib.seccomp_rule_add.call_count,4)
        lib.seccomp_load.assert_called_once_with(1)
        lib.seccomp_release.assert_called_once_with(1)
    def test_fail_closed(self):
        for name,value in [('seccomp_init',0),('seccomp_syscall_resolve_name',-1),('seccomp_rule_add',-1),('seccomp_load',-1)]:
            lib=self.library(); getattr(lib,name).return_value=value
            with patch.object(f,'no_new_privileges'), patch.object(f.ctypes,'CDLL',return_value=lib):
                with self.assertRaises(RuntimeError): f.install()
            if name!='seccomp_init': lib.seccomp_release.assert_called_once_with(1)
        with patch.object(f,'no_new_privileges'), patch.object(f.ctypes,'CDLL',side_effect=OSError('missing')):
            with self.assertRaisesRegex(RuntimeError,'unavailable'): f.install()
        with patch.object(f,'no_new_privileges',side_effect=RuntimeError('NNP')), patch.object(f.ctypes,'CDLL') as load:
            with self.assertRaises(RuntimeError): f.install()
            load.assert_not_called()
    def test_nnp(self):
        with patch.object(f.sys,'platform','darwin'):
            with self.assertRaises(RuntimeError): f.no_new_privileges()
        lib=MagicMock(); lib.prctl.return_value=-1
        with patch.object(f.sys,'platform','linux'), patch.object(f.ctypes,'CDLL',return_value=lib):
            with self.assertRaises(RuntimeError): f.no_new_privileges()
    def test_effect_never_drops_or_runs_after_fence_failure(self):
        account=MagicMock(pw_uid=10001,pw_gid=10001)
        with patch.object(effect.pwd,'getpwnam',return_value=account), patch.object(f,'install',side_effect=RuntimeError('fence')), patch.object(effect.os,'setuid') as uid:
            with self.assertRaises(RuntimeError): effect.drop_to_project()
            uid.assert_not_called()
    def test_locked_vertical_marker_allows_only_cross_arch_cancel_then_drops_uid(self):
        account=MagicMock(pw_uid=10001,pw_gid=10001)
        status='NoNewPrivs:\t1\nSeccomp:\t2\n'
        with patch.object(effect.pwd,'getpwnam',return_value=account), patch.object(f,'install',side_effect=RuntimeError('project-network-seccomp-load-failed:-125')), patch.dict(effect.os.environ,{effect.PLATFORM_EGRESS_ENV:effect.PLATFORM_EGRESS_MARKER}), patch('builtins.open',mock_open(read_data=status)), patch.object(effect.os,'setgroups') as groups, patch.object(effect.os,'setgid') as gid, patch.object(effect.os,'setuid') as uid:
            effect.drop_to_project()
        groups.assert_called_once_with([]);gid.assert_called_once_with(10001);uid.assert_called_once_with(10001)
    def test_vertical_marker_does_not_accept_other_seccomp_or_runtime_failures(self):
        status='NoNewPrivs:\t1\nSeccomp:\t2\n'
        with patch.dict(effect.os.environ,{effect.PLATFORM_EGRESS_ENV:effect.PLATFORM_EGRESS_MARKER}), patch('builtins.open',mock_open(read_data=status)):
            for message in ('project-network-seccomp-load-failed:-1','project-network-seccomp-rule-failed'):
                with patch.object(f,'install',side_effect=RuntimeError(message)):
                    with self.assertRaisesRegex(RuntimeError,message): effect.install_child_network_fence()
        with patch.object(f,'install',side_effect=RuntimeError('project-network-seccomp-load-failed:-125')), patch.dict(effect.os.environ,{effect.PLATFORM_EGRESS_ENV:effect.PLATFORM_EGRESS_MARKER}), patch('builtins.open',mock_open(read_data='NoNewPrivs:\t0\nSeccomp:\t2\n')):
            with self.assertRaisesRegex(RuntimeError,'-125'): effect.install_child_network_fence()
unittest.main(argv=['tests'])
`;
  const result = spawnSync('python3', ['-B', '-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
