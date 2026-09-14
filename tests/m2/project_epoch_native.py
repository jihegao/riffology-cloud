"""Native Linux project epoch/archive tests, no network or model calls."""
import json, os, signal, subprocess, sys, time, unittest
from pathlib import Path
sys.path.insert(0,'/opt/riffology')
import process_quiescence as q
import workspace_archive as archive
import effect_wrapper as effects
EFFECTS=Path('/var/lib/riffology/effects')
ARCHIVES=Path('/var/lib/riffology/archives')
WORKSPACE=Path('/workspace')
A='a'*52; B='b'*52; C='c'*52


def command(program,args,epoch=None,ok=True,extra=None):
    env={**os.environ,**(extra or {})}
    if epoch is not None: env['RIFFOLOGY_BINDING_EPOCH']=epoch
    else: env.pop('RIFFOLOGY_BINDING_EPOCH',None)
    p=subprocess.run(['python3','/opt/riffology/'+program+'.py',*args],env=env,capture_output=True,text=True,timeout=12)
    if ok:
        assert p.returncode==0,(p.stdout,p.stderr)
        return json.loads(p.stdout)
    assert p.returncode!=0,(p.stdout,p.stderr)
    return p


def act(epoch): return command('process_quiescence',['stage','--epoch',epoch])
def activate(epoch,ok=True): return command('process_quiescence',['activate','--epoch',epoch],ok=ok)
def seal(epoch=None): return command('process_quiescence',['seal'],epoch)
def arc(op,token,epoch=None,ok=True,prior=None,sha=None):
    return command('platform_workspace_archive',[op,token]+([prior] if prior else []),epoch,ok,{'RIFFOLOGY_EXPECTED_FILES_SHA256':sha} if sha else None)


def stage_effect(name,script):
    request=json.dumps({'deadlineAt':int(time.time()*1000)+60000,'operation':'bash','arguments':{'script':script,'timeoutMs':30000}})
    (EFFECTS/(name+'.json')).write_text(json.dumps({'schemaVersion':1,'effectId':name,'request':request}))


class EpochTests(unittest.TestCase):
    def setUp(self):
        q.kill_as_project(-1)
        import shutil
        for root in (EFFECTS,ARCHIVES,WORKSPACE):
            for child in root.iterdir():
                if child.is_dir() and not child.is_symlink(): shutil.rmtree(child)
                else: child.unlink()
        os.environ.pop('RIFFOLOGY_BINDING_EPOCH',None)
        for token in (A,B,C): (ARCHIVES/(token+'.input.tar')).write_bytes(bytes(10240))

    def frozen_a(self):
        act('A'); arc('restore',A,'A'); activate('A')
        (WORKSPACE/'result.txt').write_text('persisted')
        seal('A')
        return arc('freeze',A,'A')

    def test_cold_compatibility(self):
        arc('restore',A)
        stage_effect('cold','printf legacy > cold.txt')
        result=command('effect_wrapper',['cold'])
        self.assertTrue((WORKSPACE/'cold.txt').exists())
        self.assertEqual(seal(),{'schemaVersion':1,'sealed':True,'quiescent':True,'projectUid':10001})
        arc('freeze',A); arc('restore',A,ok=False)

    def test_strict_adopt_preserves_inode_and_replay(self):
        proof=self.frozen_a(); inode=(WORKSPACE/'result.txt').stat().st_ino
        act('B')
        adopted=arc('adopt',B,'B',prior=A,sha=proof['sha256'])
        self.assertEqual(adopted,{**proof,'operation':'restore'})
        self.assertEqual((WORKSPACE/'result.txt').stat().st_ino,inode)
        self.assertEqual(arc('adopt',B,'B',prior=A,sha=proof['sha256']),adopted)
        activate('B')
        arc('restore',C,'B',ok=False)
        arc('freeze',B,'B',ok=False)
        seal('B'); self.assertEqual(arc('freeze',B,'B')['sha256'],proof['sha256'])

    def test_adopt_denies_drift_wrong_digest_and_history(self):
        proof=self.frozen_a(); act('B')
        arc('adopt',B,'B',ok=False,prior=A,sha='0'*64)
        (WORKSPACE/'result.txt').write_text('drift')
        arc('adopt',B,'B',ok=False,prior=A,sha=proof['sha256'])
        (WORKSPACE/'result.txt').write_text('persisted')
        arc('adopt',B,'B',prior=A,sha=proof['sha256']);seal('B');arc('freeze',B,'B');act('C')
        arc('adopt',C,'C',ok=False,prior=A,sha=proof['sha256'])
        arc('adopt',C,'C',prior=B,sha=proof['sha256'])

    def test_old_epoch_commands_do_not_consume_new_controls(self):
        proof=self.frozen_a();act('B')
        stage_effect('late','printf bad > late.txt')
        command('effect_wrapper',['late'],'A',ok=False)
        self.assertTrue((EFFECTS/'late.json').exists())
        command('effect_wrapper',['late'],ok=False)
        command('process_quiescence',['seal'],'A',ok=False)
        arc('restore',A,'A',ok=False);arc('freeze',A,'A',ok=False)
        arc('adopt',B,'B',prior=A,sha=proof['sha256']);activate('B')
        command('effect_wrapper',['late'],'B')
        self.assertTrue((WORKSPACE/'late.txt').exists())
        seal('B'); self.assertEqual(act('B')['status'],'sealed')
        command('process_quiescence',['activate','--epoch','A'],ok=False)

    def test_reserved_old_wrapper_rechecks_after_new_binding(self):
        act('A');arc('restore',A,'A');activate('A');stage_effect('queued','printf bad > queued.txt')
        with q.spawn_lock() as directory:
            p=subprocess.Popen(['python3','/opt/riffology/effect_wrapper.py','queued'],
                env={**os.environ,'RIFFOLOGY_BINDING_EPOCH':'A'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            time.sleep(.1)
            self.assertTrue((EFFECTS/'queued.json').exists())
            state=q.read_state(directory);state['status']='sealed';q.write_state(directory,state)
            q.require_quiet()
            state.update(epoch='B',status='staging',used=['A','B'],archiveToken=None,prepared=None)
            q.write_state(directory,state)
        self.assertNotEqual(p.wait(timeout=3),0)
        self.assertTrue((EFFECTS/'queued.json').exists())
        self.assertFalse((WORKSPACE/'queued.txt').exists())
        seal('B')

    def test_corrupt_epoch_journal_denies_cold_fallback(self):
        (EFFECTS/'binding.json').write_text('{')
        os.chmod(EFFECTS/'binding.json',0o600)
        command('process_quiescence',['activate','--epoch','A'],ok=False)
        command('process_quiescence',['seal'],ok=False)
        arc('restore',A,ok=False)

    def test_prune_commit_hash_scope_and_archive_bound(self):
        proof=self.frozen_a(); prior=A
        def prune(epoch,sha,ok=True):
            return command('process_quiescence',['prune','--epoch',epoch,'--files-sha256',sha],ok=ok)
        (EFFECTS/'config.json').write_text('{"retain":true}')
        stage_effect('leftover','echo unused')
        prune('old',proof['sha256'],False);prune('A','0'*64,False)
        prune('A',proof['sha256'])
        self.assertEqual(len(list(ARCHIVES.iterdir())),2)
        self.assertTrue((EFFECTS/'config.json').exists());self.assertFalse((EFFECTS/'leftover.json').exists())
        for index in range(1,5):
            epoch='prune'+str(index);token='%052x'%index
            act(epoch);arc('adopt',token,epoch,prior=prior,sha=proof['sha256'])
            prune(epoch,proof['sha256'],False)
            seal(epoch);proof=arc('freeze',token,epoch)
            prune(epoch,proof['sha256'])
            self.assertEqual(set(p.name for p in ARCHIVES.iterdir()),{token+'.restore.json',token+'.output.tar'})
            self.assertEqual(prune(epoch,proof['sha256'])['removed'],0)
            prior=token

    def test_prune_with_active_uid_is_denied(self):
        proof=self.frozen_a()
        p=subprocess.Popen(['sleep','20'],user=10001,group=10001)
        try:
            command('process_quiescence',['prune','--epoch','A','--files-sha256',proof['sha256']],ok=False)
            self.assertTrue((ARCHIVES/(A+'.input.tar')).exists())
        finally:p.kill();p.wait()

    def test_staging_blocks_spawn_and_requires_preparation(self):
        activate('A',False)
        self.assertEqual(act('A')['status'],'staging')
        activate('A',False)
        stage_effect('notready','printf forbidden > notready.txt')
        command('effect_wrapper',['notready'],'A',ok=False)
        self.assertTrue((EFFECTS/'notready.json').exists())
        (ARCHIVES/(A+'.input.tar')).write_bytes(b'bad tar')
        arc('restore',A,'A',ok=False);activate('A',False)
        (ARCHIVES/(A+'.input.tar')).write_bytes(bytes(10240))
        arc('restore',A,'A')
        (WORKSPACE/'drift.txt').write_text('drift')
        activate('A',False)
        self.assertFalse((WORKSPACE/'notready.txt').exists())
        (WORKSPACE/'drift.txt').unlink()
        self.assertEqual(activate('A')['status'],'active')
        self.assertEqual(activate('A')['status'],'active')
        self.assertEqual(act('A')['status'],'active')
        arc('restore',A,'A',ok=False)
        command('effect_wrapper',['notready'],'A')
        self.assertTrue((WORKSPACE/'notready.txt').exists())
        seal('A');self.assertEqual(activate('A')['status'],'sealed')
        self.assertEqual(act('A')['status'],'sealed')

    def test_prepare_crash_before_journal_cannot_activate(self):
        act('A')
        program="import sys;sys.path.insert(0,'/opt/riffology');import platform_workspace_archive as p;p.write_state=lambda *args: (_ for _ in ()).throw(RuntimeError('crash-before-prepared'));p.run(['restore', '"+A+"'])"
        crashed=subprocess.run(['python3','-c',program],env={**os.environ,'RIFFOLOGY_BINDING_EPOCH':'A'},capture_output=True)
        self.assertNotEqual(crashed.returncode,0)
        self.assertTrue((ARCHIVES/(A+'.restore.json')).exists())
        activate('A',False)
        arc('restore',A,'A')
        self.assertEqual(activate('A')['status'],'active')

    def test_no_state_and_absent_restore_fail_closed(self):
        command('process_quiescence',['seal'],'A',ok=False)
        act('A');arc('freeze',A,'A',ok=False)
        seal('A');arc('freeze',A,'A',ok=False)
        command('process_quiescence',['seal'],ok=False)

    def test_parent_death_before_drop_cannot_run_old_effect(self):
        act('A');arc('restore',A,'A');activate('A');stage_effect('delayed','printf bad > delayed.txt')
        marker=EFFECTS/'pre-drop-pid'
        wrapper=os.fork()
        if wrapper==0:
            os.environ['RIFFOLOGY_BINDING_EPOCH']='A'
            original=effects.drop_to_project
            def delay():
                marker.write_text(str(os.getpid()));os.kill(os.getpid(),signal.SIGSTOP);original()
            effects.drop_to_project=delay
            sys.argv=['effect_wrapper.py','delayed']
            try: effects.main()
            finally: os._exit(0)
        until=time.monotonic()+3
        while not marker.exists() and time.monotonic()<until:time.sleep(.01)
        self.assertTrue(marker.exists());child=int(marker.read_text())
        os.kill(wrapper,signal.SIGKILL);os.waitpid(wrapper,0)
        seal('A');arc('freeze',A,'A');act('B')
        os.kill(child,signal.SIGCONT);time.sleep(.15)
        self.assertFalse((WORKSPACE/'delayed.txt').exists())
        seal('B');self.assertEqual(q.live_project_pids(),[])

    def test_detached_effect_killed_before_handoff(self):
        act('A');arc('restore',A,'A');activate('A')
        stage_effect('detach',"setsid /usr/local/bin/python3 -c 'import signal,time,pathlib; signal.signal(signal.SIGTERM,signal.SIG_IGN); pathlib.Path(\"ready\").write_text(\"yes\"); time.sleep(1); pathlib.Path(\"late\").write_text(\"bad\")' >/dev/null 2>&1 & while [ ! -f ready ]; do sleep .01; done")
        command('effect_wrapper',['detach'],'A')
        self.assertTrue(q.live_project_pids())
        proof=seal('A');self.assertEqual(proof['bindingEpoch'],'A')
        arc('freeze',A,'A');act('B');time.sleep(1.1)
        self.assertFalse((WORKSPACE/'late').exists())
        self.assertEqual(q.live_project_pids(),[])


if __name__=='__main__':
    subprocess.run(['groupadd','-g','10001','project'],check=True)
    subprocess.run(['useradd','-u','10001','-g','10001','-M','-s','/usr/sbin/nologin','project'],check=True)
    for root in (EFFECTS,ARCHIVES,WORKSPACE):root.mkdir(parents=True,exist_ok=True);os.chmod(root,0o700 if root!=WORKSPACE else 0o755)
    os.chown(WORKSPACE,10001,10001)
    unittest.main(verbosity=2)
