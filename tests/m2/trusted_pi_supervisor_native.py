"""Runs only inside an isolated, network-disabled Linux container as root."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time
import unittest

SUP = '/opt/riffology/runtime_supervisor.py'
HOST = '/opt/riffology/trusted-pi/trusted-pi-turn-host.mjs'
ROOT = Path('/var/lib/riffology/runtime-control')
TURNS = Path('/var/lib/riffology/turns')
TOKEN = 'a' * 52
spec = importlib.util.spec_from_file_location('supervisor', SUP)
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)

FIXTURE = r'''
import os,sys,signal,time,json
from pathlib import Path
root=Path('/var/lib/riffology/turns')
mode=(root/(sys.argv[1]+'.control.json')).read_text().strip()
denied=False
try: Path('/var/lib/riffology/runtime-control/binding.json').read_text()
except PermissionError: denied=True
(root/'started').write_text(json.dumps({'uid':os.getuid(),'denied':denied,'status':Path('/proc/self/status').read_text()}))
if mode=='detach':
 if os.fork()==0:
  os.setsid()
  if os.fork()!=0: os._exit(0)
  signal.signal(signal.SIGTERM,signal.SIG_IGN)
  (root/'detached').write_text(str(os.getpid()))
  while True:
   with (root/'writes').open('a') as out: out.write('x')
   time.sleep(.02)
elif mode=='wait':
 def stop(*args):
  (root/'graceful').write_text('yes');sys.exit(0)
 signal.signal(signal.SIGTERM,stop)
 while True: time.sleep(.1)
'''



def cli(command, epoch='A', ok=True, **kwargs):
    result = subprocess.run(['python3', SUP, command, '--epoch', epoch], capture_output=True, text=True, timeout=12, **kwargs)
    if ok:
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)
    assert result.returncode != 0 and not result.stdout, result
    return result


def await_file(name):
    until = time.monotonic() + 3
    while time.monotonic() < until:
        if (TURNS/name).exists():
            return
        time.sleep(.01)
    raise AssertionError('missing '+name)


class NativeTests(unittest.TestCase):
    def setUp(self):
        # Test isolation only: production CLI never resets its journal.
        supervisor.kill_as_trustedpi(-1)
        for path in (ROOT, TURNS):
            for item in path.iterdir():
                if item.is_dir(): shutil.rmtree(item)
                else: item.unlink()
        os.chmod(ROOT, 0o700)

    def start(self, mode, epoch='A'):
        (TURNS/(TOKEN+'.control.json')).write_text(mode)
        os.chmod(TURNS/(TOKEN+'.control.json'), 0o644)  # existing root SDK write shape
        return subprocess.Popen(['python3',SUP,'spawn','--epoch',epoch,'--','/usr/local/bin/node',HOST,TOKEN], stdout=subprocess.DEVNULL, stderr=None)

    def test_detached_domain_and_permissions(self):
        cli('activate')
        process = self.start('detach')
        self.assertEqual(process.wait(timeout=3), 0)
        await_file('detached'); await_file('writes')
        info=json.loads((TURNS/'started').read_text())
        self.assertEqual(info['uid'],10002); self.assertTrue(info['denied'])
        self.assertIn('NoNewPrivs:\t1',info['status'])
        self.assertEqual((TURNS/'started').stat().st_mode & 0o777,0o600)
        self.assertEqual(cli('seal'),{'schemaVersion':1,'bindingEpoch':'A','status':'quiescent','remaining':0})
        self.assertEqual(supervisor.live_trustedpi_pids(),[])
        size=(TURNS/'writes').stat().st_size; time.sleep(.15)
        self.assertEqual((TURNS/'writes').stat().st_size,size)
        self.assertEqual(os.geteuid(),0)  # root test supervisor survived UID sweep

    def test_epoch_fences_and_stale_seal(self):
        cli('activate'); cli('activate','B',ok=False)
        cli('seal'); self.assertEqual(cli('activate')['status'],'sealed')
        self.assertNotEqual(self.start('wait').wait(timeout=3),0)
        cli('activate','B'); p=self.start('wait','B'); await_file('started')
        cli('seal','A',ok=False); self.assertIsNone(p.poll())
        cli('seal','B'); p.wait(timeout=3)
        cli('activate','A',ok=False)

    def test_duplicate_and_signal_forwarding(self):
        cli('activate'); p=self.start('wait'); await_file('started')
        self.assertNotEqual(self.start('wait').wait(timeout=3),0)
        p.send_signal(signal.SIGTERM); self.assertEqual(p.wait(timeout=3),0)
        await_file('graceful')
        self.assertNotEqual(self.start('wait').wait(timeout=3),0)
        cli('seal')

    def test_late_wrapper_cannot_spawn_after_rebind(self):
        cli('activate')
        # Reserve a wrapper while the root admission lock is held, then switch
        # journal under that same lock before its delayed admission executes.
        with supervisor.spawn_lock() as directory:
            p=self.start('wait'); time.sleep(.1)
            state=supervisor.read_state(directory); state['status']='sealed'
            supervisor.write_state(directory,state)
            supervisor.require_quiet()
            state.update(epoch='B',status='active',used=['A','B'])
            supervisor.write_state(directory,state)
        self.assertNotEqual(p.wait(timeout=3),0)
        self.assertFalse((TURNS/'started').exists())
        cli('seal','B')

    def test_spawn_seal_race_no_late_writes(self):
        for index in range(8):
            epoch='race'+str(index); cli('activate',epoch)
            p=self.start('detach',epoch)
            cli('seal',epoch); p.wait(timeout=3)
            self.assertEqual(supervisor.live_trustedpi_pids(),[])
        before=(TURNS/'writes').read_bytes() if (TURNS/'writes').exists() else b''
        time.sleep(.1)
        self.assertEqual((TURNS/'writes').read_bytes() if (TURNS/'writes').exists() else b'',before)

    def test_corrupt_state_and_nonroot_fail_closed(self):
        (ROOT/'binding.json').write_text('{'); os.chmod(ROOT/'binding.json',0o600)
        cli('activate',ok=False); cli('seal',ok=False)
        (ROOT/'binding.json').unlink(); (ROOT/'binding.json').symlink_to('/etc/passwd')
        cli('activate',ok=False)
        result=subprocess.run(['python3',SUP,'activate','--epoch','A'],user=10002,group=10002,capture_output=True)
        self.assertNotEqual(result.returncode,0); self.assertFalse(result.stdout)

    def test_foreign_domain_prevents_virgin_activation(self):
        p=subprocess.Popen(['sleep','20'],user=10002,group=10002)
        try: cli('activate',ok=False)
        finally: p.kill(); p.wait()
        cli('activate'); cli('seal')

    def test_parent_dies_before_drop_handshake(self):
        cli('activate')
        (TURNS/(TOKEN+'.control.json')).write_text('detach')
        os.chmod(TURNS/(TOKEN+'.control.json'),0o644)
        marker=ROOT/'pre-drop-pid'
        wrapper=os.fork()
        if wrapper==0:
            original=supervisor.drop_domain
            def delayed_drop():
                marker.write_text(str(os.getpid()))
                os.kill(os.getpid(),signal.SIGSTOP)
                original()
            supervisor.drop_domain=delayed_drop
            try: supervisor.spawn('A',[supervisor.NODE,HOST,TOKEN])
            finally: os._exit(0)
        until=time.monotonic()+3
        while not marker.exists() and time.monotonic()<until: time.sleep(.01)
        self.assertTrue(marker.exists())
        child=int(marker.read_text())
        os.kill(wrapper,signal.SIGKILL); os.waitpid(wrapper,0)
        cli('seal'); cli('activate','B')
        os.kill(child,signal.SIGCONT)
        time.sleep(.15)
        self.assertFalse((TURNS/'started').exists())
        cli('seal','B')
        self.assertEqual(supervisor.live_trustedpi_pids(),[])

    def test_no_state_is_not_seal_proof(self):
        cli('seal',ok=False)
        self.assertFalse((ROOT/'binding.json').exists())

    def test_fixed_command_only(self):
        cli('activate')
        result=subprocess.run(['python3',SUP,'spawn','--epoch','A','--','/bin/sh','-c','id'],capture_output=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIsNone(json.loads((ROOT/'binding.json').read_text())['spawnToken'])
        cli('seal')


if __name__ == '__main__':
    subprocess.run(['groupadd','-g','10002','trustedpi'],check=True)
    subprocess.run(['useradd','-u','10002','-g','10002','-M','-s','/usr/sbin/nologin','trustedpi'],check=True)
    ROOT.mkdir(parents=True,exist_ok=True); os.chmod(ROOT,0o700)
    for path in (TURNS,Path('/var/lib/riffology/pi')):
        path.mkdir(parents=True,exist_ok=True); os.chown(path,10002,10002); os.chmod(path,0o700)
    # This native Python fixture is deliberately not a Pi/Node integration proof.
    Path('/usr/local/bin/node').symlink_to('/usr/local/bin/python3')
    Path(HOST).parent.mkdir(parents=True,exist_ok=True)
    Path(HOST).write_text(FIXTURE); os.chmod(HOST,0o555)
    print('native Linux pidfd/UID tests; fixture host, network disabled',flush=True)
    unittest.main(verbosity=2)
