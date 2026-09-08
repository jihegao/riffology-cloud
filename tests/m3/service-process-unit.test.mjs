import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('service wrapper validates immutable input and fences stop replay without host project processes', () => {
  const script = String.raw`
import sys, pathlib, tempfile, unittest, json, hashlib, contextlib
from unittest.mock import patch
sys.path[:0] = [str(pathlib.Path('services/run').resolve()), str(pathlib.Path('services/project-tools').resolve())]
import service_process as s
T = 'a' * 52

def control():
    return dict(schemaVersion=1, token=T, entrypoint='app/main.py', dependencyLock='app/deps.lock', filesSha256='b'*64, declarationSha256='c'*64, entrypointSha256='d'*64, dependencyLockSha256='e'*64, deadlineAt=s.now()+60000, healthPath='/health')

class Cases(unittest.TestCase):
    def test_closed_input(self):
        s.validate(control(), T)
        for change in [dict(schemaVersion=True), dict(token='x'), dict(entrypoint='../main.py'), dict(entrypoint='app/../main.py'), dict(dependencyLock='model/a.lock'), dict(healthPath='//evil'), dict(healthPath='/a?x=1'), dict(deadlineAt=True), dict(filesSha256='g'*64), dict(env={})]:
            with self.assertRaises(ValueError): s.validate(control() | change,T)
        with self.assertRaises(ValueError): s.unique([('a',1),('a',2)])
    def test_stop_proof_requires_seal_and_is_stable(self):
        with tempfile.TemporaryDirectory() as d, patch.object(s,'CONTROL',pathlib.Path(d)), patch.object(s.fence,'seal',return_value={'schemaVersion':1,'sealed':True,'quiescent':True,'projectUid':10001}) as seal:
            first=s.stop(T)
            self.assertEqual(s.stop(T),first)
            self.assertEqual(s.start(T),first)
            self.assertEqual(first['status'],'stopped')
            self.assertEqual(seal.call_count,3)
            with patch.object(s.fence,'seal',side_effect=RuntimeError('unproven')):
                with self.assertRaises(RuntimeError): s.stop(T)
    def test_absent_is_never_stop_and_ambiguous_start_never_respawns(self):
        with tempfile.TemporaryDirectory() as d, patch.object(s,'CONTROL',pathlib.Path(d)), patch.object(s.subprocess,'Popen',side_effect=AssertionError('host spawn prohibited')):
            self.assertEqual(s.observe(T)['status'],'absent')
            s.write(s.CONTROL/'attempt.json',control())
            self.assertEqual(s.start(T)['status'],'unknown')
    def test_deadline_stop(self):
        with tempfile.TemporaryDirectory() as d, patch.object(s,'CONTROL',pathlib.Path(d)), patch.object(s,'stop',return_value={'deadline':True}) as stop:
            s.write(s.CONTROL/'attempt.json',control()|{'deadlineAt':1})
            self.assertEqual(s.observe(T),{'deadline':True})
            stop.assert_called_once_with(T)
    def test_source_hash_and_dependency_allowlist(self):
        with tempfile.TemporaryDirectory() as d, patch.object(s,'WORKSPACE',pathlib.Path(d)), patch.object(s.os,'chown'):
            root=pathlib.Path(d); (root/'app').mkdir()
            c=control()
            (root/c['entrypoint']).write_text('print(1)')
            decl={k:c[k] for k in ['schemaVersion','entrypoint','dependencyLock','healthPath']}|{'runtime':'python','port':8080}
            (root/'app/preview.json').write_text(json.dumps(decl))
            for packages in [{},{'simpy':'4.1.1'},{'simpy':'9'},{'evil':'1'}]:
                (root/c['dependencyLock']).write_text(json.dumps({'schemaVersion':1,'packages':packages}))
                for name,path in [('entrypointSha256',c['entrypoint']),('dependencyLockSha256',c['dependencyLock']),('declarationSha256','app/preview.json')]: c[name]=s.archive.file_sha256(root/path)
                with patch.object(s.os,'chmod'), patch.object(s.importlib.metadata,'version',return_value='4.1.1'):
                    if packages in [{},{'simpy':'4.1.1'}]: s.verify_tree(c)
                    else:
                        with self.assertRaises(ValueError): s.verify_tree(c)
            with self.assertRaises(ValueError): s.verify_tree(c|{'entrypointSha256':'0'*64})
            (root/c['dependencyLock']).write_text(json.dumps({'schemaVersion':1,'packages':{'simpy':'4.1.1'}}))
            c['dependencyLockSha256']=s.archive.file_sha256(root/c['dependencyLock'])
            with patch.object(s.importlib.metadata,'version',return_value='4.1.0'):
                with self.assertRaisesRegex(ValueError,'service-dependency-version-mismatch'): s.verify_tree(c)
            with patch.object(s.importlib.metadata,'version',side_effect=s.importlib.metadata.PackageNotFoundError('simpy')):
                with self.assertRaises(s.importlib.metadata.PackageNotFoundError): s.verify_tree(c)
    def test_no_new_privileges_fails_closed(self):
        from unittest.mock import MagicMock
        libc=MagicMock(); libc.prctl.return_value=0
        with patch.object(s.sys,'platform','linux'), patch.object(s.ctypes,'CDLL',return_value=libc):
            s.no_new_privileges()
            libc.prctl.assert_called_once_with(38,1,0,0,0)
            libc.prctl.return_value=-1
            with self.assertRaises(RuntimeError): s.no_new_privileges()
    def test_probe_no_redirects_or_response_body(self):
        from unittest.mock import MagicMock
        connection=MagicMock(); connection.getresponse.return_value.status=302
        with patch.object(s.http.client,'HTTPConnection',return_value=connection) as constructor:
            self.assertFalse(s.probe('/health'))
            constructor.assert_called_once_with('127.0.0.1',8080,timeout=1)
            connection.getresponse.return_value.read.assert_not_called()
            connection.close.assert_called_once()

unittest.main(argv=['tests'])
`;
  const result = spawnSync('python3', ['-B', '-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
