#!/usr/bin/env python3
"""Root-owned finite simulation runner; project code never controls its receipt."""
import fcntl, hashlib, json, os, re, resource, stat, subprocess, sys, time
from pathlib import Path
sys.path.insert(0, '/opt/riffology')
from simulation_artifacts import collect_outputs
import process_quiescence as fence
import workspace_archive as archive
from service_process import child_setup, write, read_json, project_path
from contextlib import contextmanager
import importlib.metadata

CONTROL = Path('/var/lib/riffology/services')
ARCHIVES = Path('/var/lib/riffology/archives')
WORKSPACE = Path('/workspace')
INPUT_ROOT = Path('/run-input')
OUTPUT_ROOT = Path('/run-output')
TOKEN = re.compile(r'^[a-f0-9]{52}$')
SHA = re.compile(r'^[a-f0-9]{64}$')
FIELDS = {'schemaVersion','token','runId','filesSha256','specSha256','entrypoint','entrypointSha256','dependencyLock','dependencyLockSha256','parameters','seed','deadlineAt'}
MAX_JSON = 65536

def now(): return int(time.time() * 1000)
def exact(value, fields):
    if type(value) is not dict or set(value) != fields: raise ValueError('invalid-simulation-input')
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()
def validate(control, token):
    exact(control, FIELDS)
    if type(control['schemaVersion']) is not int or control['schemaVersion'] != 1 or control['token'] != token or type(control['runId']) is not str or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', control['runId']): raise ValueError('invalid-simulation-input')
    for key in ('filesSha256','specSha256','entrypointSha256','dependencyLockSha256'):
        if type(control[key]) is not str or not SHA.fullmatch(control[key]): raise ValueError('invalid-simulation-digest')
    if type(control['seed']) is not int or not 0 <= control['seed'] <= 4294967295: raise ValueError('invalid-simulation-seed')
    if type(control['deadlineAt']) is not int or control['deadlineAt'] <= 0: raise ValueError('invalid-simulation-deadline')
    project_path(control['entrypoint'], {'model'}, '.py')
    project_path(control['dependencyLock'], {'app'}, '.lock')
    if control['entrypoint'] == control['dependencyLock'] or type(control['parameters']) is not dict: raise ValueError('invalid-simulation-input')
    return control
def envelope(exit_code, result, python_version=None):
    return {'exitCode': int(exit_code), 'result': result, 'pythonVersion': python_version or sys.version.split()[0]}

def execution_runtime(control):
    lock = read_json(WORKSPACE / control['dependencyLock']); exact(lock, {'schemaVersion','packages'})
    if type(lock['schemaVersion']) is not int or lock['schemaVersion'] != 1 or type(lock['packages']) is not dict:
        raise ValueError('unsupported-simulation-dependencies')
    packages = lock['packages']
    if packages in ({}, {'simpy':'4.1.1'}):
        if packages and importlib.metadata.version('simpy') != '4.1.1': raise ValueError('simulation-dependencies-mismatch')
        return sys.executable, sys.version.split()[0]
    profile = read_json(Path('/opt/riffology/mesa-cpython-profile.json'))
    if packages != profile['sourcePackages']: raise ValueError('unsupported-simulation-dependencies')
    executable = '/opt/riffology/python-mesa/bin/python3'
    # Only fixed root-owned interpreter/metadata are evaluated; generated code
    # cannot choose its interpreter or claim a Python version in the receipt.
    probe = subprocess.run([executable, '-I', '-c', 'import sys,json,importlib.metadata as m;print(json.dumps({"pythonVersion":sys.version.split()[0],"packages":{p:m.version(p) for p in sys.argv[1:]}}))', *[item['name'] for item in profile['dependencies']]], stdin=subprocess.DEVNULL, capture_output=True, text=True, check=True, timeout=10, env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
    observed = json.loads(probe.stdout)
    expected = {item['name']:item['version'] for item in profile['dependencies']}
    if observed != {'pythonVersion':profile['pythonVersion'],'packages':expected}: raise ValueError('simulation-dependencies-mismatch')
    return executable, observed['pythonVersion']
@contextmanager
def operation_lock():
    fd = os.open(CONTROL / '.simulation.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)

def stopped(token):
    proof = fence.seal()
    if proof != {'schemaVersion': 1, 'sealed': True, 'quiescent': True, 'projectUid': 10001}:
        raise RuntimeError('simulation-stop-unproven')
    path = CONTROL / (token + '.proof.json')
    if not path.exists():
        write(path, {'confirmationId': hashlib.sha256(('simulation-stop:' + token).encode()).hexdigest(), 'observedAt': now(), 'fenced': True})
    return {'schemaVersion': 1, 'token': token, 'status': 'stopped', 'result': None, 'stop': read_json(path)}

def monitor(token, control):
    code, child, python_version = 4, None, None
    try:
        executable, python_version = execution_runtime(control)
        INPUT_ROOT.mkdir(mode=0o755, exist_ok=True)
        input_path = INPUT_ROOT / 'input.json'
        write(input_path, {'schemaVersion': 1, 'runId': control['runId'], 'parameters': control['parameters'], 'seed': control['seed']})
        os.chown(input_path, 0, 0); os.chmod(input_path, 0o444)
        with fence.spawn_lock() as directory:
            fence.require_unsealed(directory)
            if (CONTROL / (token + '.stop.json')).exists() or now() >= control['deadlineAt']:
                raise RuntimeError('simulation-cancelled')
            attempt = CONTROL / (token + '.attempt.json')
            if attempt.exists():
                return  # a duplicate monitor must not stop the original execution
            write(attempt, {'token': token, 'startedAt': now()})
            with open(CONTROL / (token + '.stdout.log'), 'ab', buffering=0) as stdout, open(CONTROL / (token + '.stderr.log'), 'ab', buffering=0) as stderr:
                child = subprocess.Popen([executable, '-B', control['entrypoint'], '--input', str(input_path), '--output', str(OUTPUT_ROOT / 'result.json')], cwd=WORKSPACE, env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/tmp','LANG':'C.UTF-8','PYTHONUNBUFFERED':'1','OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1','MKL_NUM_THREADS':'1'}, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, close_fds=True, start_new_session=True, preexec_fn=child_setup)
        while child.poll() is None:
            if now() >= control['deadlineAt'] or (CONTROL / (token + '.stop.json')).exists():
                fence.seal()
                break
            time.sleep(.05)
        code = child.wait(timeout=3)
    except Exception:
        code = 4
    # A failed seal never produces a result or a stopped claim. Only the root
    # monitor (not the project) supplies exit status and Python version.
    with operation_lock():
        proof = stopped(token)
        result = None
        if code == 0 and not (CONTROL / (token + '.stop.json')).exists():
            try:
                result = read_json(OUTPUT_ROOT / 'result.json', MAX_JSON)
                result = collect_outputs(result, OUTPUT_ROOT)
                if type(result['schemaVersion']) is not int or result['schemaVersion'] != 1 or type(result['metrics']) is not dict:
                    raise ValueError('invalid-simulation-result')
                json.dumps(result, allow_nan=False)
            except Exception:
                code, result = 4, None
        elif code == 0:
            code = 4
        write(CONTROL / (token + '.result.json'), envelope(code, result, python_version))

def protect_tree():
    for current, directories, files in os.walk(WORKSPACE, topdown=False, followlinks=False):
        for name in files:
            path = Path(current) / name
            os.chown(path, 0, 0, follow_symlinks=False); os.chmod(path, 0o444)
        for name in directories:
            path = Path(current) / name
            os.chown(path, 0, 0, follow_symlinks=False); os.chmod(path, 0o555)
    os.chown(WORKSPACE, 0, 0); os.chmod(WORKSPACE, 0o555)

def start(token):
    control = validate(read_json(CONTROL / (token + '.input.json')), token)
    if (CONTROL / (token + '.stop.json')).exists(): return stopped(token)
    if any((CONTROL / (token + suffix)).exists() for suffix in ('.result.json', '.started.json', '.monitor.json')): return observe(token)
    if control['deadlineAt'] <= now(): return stop(token)
    source = ARCHIVES / (token + '.input.tar')
    if digest(source) != control['filesSha256']: raise ValueError('simulation-archive-mismatch')
    restored = archive.restore(WORKSPACE, ARCHIVES, token)
    if restored['sha256'] != control['filesSha256']: raise ValueError('simulation-archive-mismatch')
    if digest(WORKSPACE / 'model/model-spec.json') != control['specSha256'] or digest(WORKSPACE / control['entrypoint']) != control['entrypointSha256'] or digest(WORKSPACE / control['dependencyLock']) != control['dependencyLockSha256']: raise ValueError('simulation-source-mismatch')
    execution_runtime(control)
    protect_tree()
    with fence.spawn_lock() as directory:
        fence.require_unsealed(directory); write(CONTROL / (token + '.started.json'), {'token':token,'startedAt':now()})
        process = subprocess.Popen([sys.executable, __file__, 'monitor', token], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True, start_new_session=True, env={'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C.UTF-8', 'RIFFOLOGY_SERVICE_PLATFORM_EGRESS_FENCE':os.environ.get('RIFFOLOGY_SERVICE_PLATFORM_EGRESS_FENCE','')})
        pid = process.pid
        write(CONTROL / (token + '.monitor.json'), {'pid':pid})
    return observe(token)
def observe(token):
    result = CONTROL / (token + '.result.json')
    proof = CONTROL / (token + '.proof.json')
    if proof.exists():
        reply = stopped(token)
        if result.exists(): reply['result'] = read_json(result, MAX_JSON + 1024)
        return reply
    if (CONTROL / (token + '.stop.json')).exists(): return stopped(token)
    if (CONTROL / (token + '.started.json')).exists():
        control = validate(read_json(CONTROL / (token + '.input.json'), MAX_JSON), token)
        if now() >= control['deadlineAt']: return stop(token)
        return {'schemaVersion':1,'token':token,'status':'running','result':None,'stop':None}
    return {'schemaVersion':1,'token':token,'status':'absent','result':None,'stop':None}

def stop(token):
    write(CONTROL / (token + '.stop.json'), {'token':token})
    return stopped(token)

def main(args):
    if len(args) != 2 or args[0] not in {'start','observe','stop','monitor'} or not TOKEN.fullmatch(args[1]): raise ValueError('invalid-simulation-command')
    fence.validate_account()
    info = CONTROL.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('invalid-simulation-control')
    if args[0] == 'monitor':
        # Do not hold the command lock for the project's lifetime: cancel and
        # observation must remain possible while the child is running.
        monitor(args[1], validate(read_json(CONTROL / (args[1] + '.input.json'), MAX_JSON), args[1]))
        return None
    with operation_lock():
        identity = CONTROL / 'simulation-identity.json'
        if identity.exists():
            if read_json(identity) != {'token':args[1]}: raise ValueError('simulation-identity-conflict')
        else: write(identity, {'token':args[1]})
        return {'start':start,'observe':observe,'stop':stop}[args[0]](args[1])
if __name__ == '__main__' and len(sys.argv) > 1:
    try: print(json.dumps(main(sys.argv[1:]), separators=(',',':'), allow_nan=False))
    except Exception: print('simulation-operation-unproven', file=sys.stderr); raise SystemExit(4)
