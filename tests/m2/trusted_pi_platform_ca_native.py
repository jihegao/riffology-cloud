"""CA path boundary tests; run only in a disposable network-disabled root Linux container."""
import importlib.util
import os
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('supervisor', '/opt/riffology/runtime_supervisor.py')
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)
ROOT = Path('/etc/cloudflare')
CA = ROOT / 'certs/cloudflare-containers-ca.crt'

class PlatformCA(unittest.TestCase):
    def setUp(self):
        self.assertEqual(os.geteuid(), 0)
        self.assertFalse(ROOT.exists(), 'use a disposable bare container, not a platform image')
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
    def tearDown(self):
        self.env.stop()
        if ROOT.is_symlink(): ROOT.unlink()
        elif ROOT.exists(): shutil.rmtree(ROOT)
    def valid(self):
        CA.parent.mkdir(parents=True)
        os.chmod(ROOT, 0o755); os.chmod(CA.parent, 0o755)
        CA.write_text('offline-test-certificate')
        os.chmod(CA, 0o644)
    def test_absent_offline_ca_and_no_ambient_environment(self):
        os.environ.update({'NODE_OPTIONS':'--inspect','API_KEY':'do-not-inherit','SSL_CERT_FILE':'/tmp/other'})
        self.assertEqual(supervisor.child_environment(), {'LANG':'C.UTF-8','PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/var/lib/riffology/pi'})
    def test_fixed_readonly_root_ca(self):
        self.valid(); os.environ['NODE_EXTRA_CA_CERTS'] = supervisor.PLATFORM_CA
        self.assertEqual(supervisor.child_environment()['NODE_EXTRA_CA_CERTS'], supervisor.PLATFORM_CA)
    def test_arbitrary_environment_path_rejected(self):
        self.valid(); os.environ['NODE_EXTRA_CA_CERTS'] = '/tmp/attacker.crt'
        with self.assertRaisesRegex(RuntimeError, 'path-denied'): supervisor.child_environment()
    def test_declared_missing_ca_rejected(self):
        os.environ['NODE_EXTRA_CA_CERTS'] = supervisor.PLATFORM_CA
        with self.assertRaisesRegex(RuntimeError, 'ca-missing'): supervisor.child_environment()
    def test_writable_file_rejected_even_without_environment(self):
        self.valid(); os.chmod(CA, 0o666)
        with self.assertRaisesRegex(RuntimeError, 'file-denied'): supervisor.child_environment()
    def test_nonroot_file_rejected(self):
        self.valid(); os.chown(CA, 10002, 10002)
        with self.assertRaisesRegex(RuntimeError, 'file-denied'): supervisor.child_environment()
    def test_leaf_symlink_rejected(self):
        self.valid(); CA.unlink(); CA.symlink_to('/etc/hosts')
        with self.assertRaises(OSError): supervisor.child_environment()
    def test_parent_symlink_rejected(self):
        ROOT.mkdir(); (ROOT/'certs').symlink_to('/tmp')
        with self.assertRaises(OSError): supervisor.child_environment()
    def test_writable_parent_rejected(self):
        self.valid(); os.chmod(CA.parent, 0o777)
        with self.assertRaisesRegex(RuntimeError, 'directory-denied'): supervisor.child_environment()
    def test_nonroot_parent_rejected(self):
        self.valid(); os.chown(ROOT, 10002, 10002)
        with self.assertRaisesRegex(RuntimeError, 'directory-denied'): supervisor.child_environment()
    def test_root_only_certificate_rejected(self):
        self.valid(); os.chmod(CA, 0o600)
        with self.assertRaisesRegex(RuntimeError, 'file-denied'): supervisor.child_environment()
    def test_root_only_parent_rejected(self):
        self.valid(); os.chmod(CA.parent, 0o700)
        with self.assertRaisesRegex(RuntimeError, 'directory-denied'): supervisor.child_environment()
    def test_child_group_cannot_fall_back_to_other_read(self):
        self.valid(); os.chown(CA, 0, 10002); os.chmod(CA, 0o604)
        with self.assertRaisesRegex(RuntimeError, 'file-denied'): supervisor.child_environment()
    def test_child_group_cannot_fall_back_to_other_search(self):
        self.valid(); os.chown(CA.parent, 0, 10002); os.chmod(CA.parent, 0o701)
        with self.assertRaisesRegex(RuntimeError, 'directory-denied'): supervisor.child_environment()
    def test_directory_or_fifo_not_accepted_as_certificate(self):
        self.valid(); CA.unlink(); CA.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'file-denied'): supervisor.child_environment()
        CA.rmdir(); os.mkfifo(CA)
        with self.assertRaisesRegex(RuntimeError, 'file-denied'): supervisor.child_environment()

if __name__ == '__main__': unittest.main(verbosity=2)
