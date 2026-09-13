import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.M4_SIMULATION_DOCKER_TEST === '1';
const image = process.env.M4_SIMULATION_TEST_IMAGE || 'riffology-simulation-phase1:local';
function docker(args, options = {}) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim(); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

for (const scenario of ['success', 'failure', 'cancel', 'isolation', 'outputs']) test(`real simulation image (${image}): ${scenario}`, { skip: !enabled ? 'set M4_SIMULATION_DOCKER_TEST=1 to run local Docker acceptance' : false }, async t => {
  const probe = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
  assert.equal(probe.status, 0, `required image ${image} is unavailable`);
  const root = await mkdtemp(join(tmpdir(), 'm4-simulation-docker-')), token = 'a'.repeat(52), runId = 'run-fixture';
  const baseModel = Buffer.from("import argparse,json\np=argparse.ArgumentParser();p.add_argument('--input');p.add_argument('--output');a=p.parse_args();x=json.load(open(a.input));json.dump({'schemaVersion':1,'metrics':{'value':x['parameters']['x']+x['seed']}},open(a.output,'w'))\n");
  const model = scenario === 'failure' ? Buffer.from('raise SystemExit(7)\n') : scenario === 'cancel' ? Buffer.from('import time\ntime.sleep(120)\n') : scenario === 'isolation' ? Buffer.from("import socket\ntry:\n open('/workspace/model/run.py','w')\n raise RuntimeError('workspace writable')\nexcept PermissionError: pass\ntry:\n socket.socket().connect(('127.0.0.1',8080))\n raise RuntimeError('socket allowed')\nexcept PermissionError: pass\n" + baseModel.toString()) : scenario === 'outputs' ? Buffer.from(baseModel.toString()+"from pathlib import Path\nx=json.load(open(a.output));x['outputs']=['series.csv'];Path(a.output).with_name('series.csv').write_text('x,y\\n1,2\\n');json.dump(x,open(a.output,'w'))\n") : baseModel;
  const spec = Buffer.from(JSON.stringify({schemaVersion:1,researchQuestion:'fixture',scope:'test',entities:['item'],mechanisms:['sum'],assumptions:[],parameters:{x:{type:'integer',default:2}},metrics:{value:{}},limitations:[],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}}));
  const lock = Buffer.from(JSON.stringify({schemaVersion:1,packages:{}}));
  await mkdir(join(root, 'model')); await mkdir(join(root, 'app')); await writeFile(join(root, 'model/run.py'), model); await writeFile(join(root, 'model/model-spec.json'), spec); await writeFile(join(root, 'app/requirements.lock'), lock);
  const container = docker(['run', '-d', '--network', 'none', '--entrypoint', '/bin/sh', image, '-c', 'sleep 60']); t.after(() => { try { docker(['rm', '-f', container]); } catch {} });
  docker(['exec', container, 'mkdir', '-p', '/tmp/fixture']); docker(['cp', join(root, 'model'), `${container}:/tmp/fixture/`]); docker(['cp', join(root, 'app'), `${container}:/tmp/fixture/`]);
  docker(['exec', container, 'python3', '-c', "import sys;sys.path.insert(0,'/opt/riffology');from pathlib import Path;import workspace_archive as a;Path('/var/lib/riffology/archives').mkdir(exist_ok=True);a.canonical_tar(Path('/tmp/fixture'),Path('/var/lib/riffology/archives/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.input.tar'))"]);
  const archiveSha = docker(['exec', container, 'sha256sum', `/var/lib/riffology/archives/${token}.input.tar`]).split(' ')[0];
  const control = {schemaVersion:1,token,runId,filesSha256:archiveSha,specSha256:sha(spec),entrypoint:'model/run.py',entrypointSha256:sha(model),dependencyLock:'app/requirements.lock',dependencyLockSha256:sha(lock),parameters:{x:2},seed:5,deadlineAt:Date.now()+30000};
  await writeFile(join(root, 'control.json'), JSON.stringify(control)); docker(['cp', join(root, 'control.json'), `${container}:/tmp/control.json`]);
  docker(['exec', container, 'sh', '-c', `cp /tmp/control.json /var/lib/riffology/services/${token}.input.json && python3 /opt/riffology/simulation_process.py start ${token}`]);
  if (scenario === 'cancel') { await new Promise(r => setTimeout(r, 300)); docker(['exec', container, 'python3', '/opt/riffology/simulation_process.py', 'stop', token]); }
  let observed = null; for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 200)); observed = JSON.parse(docker(['exec', container, 'python3', '/opt/riffology/simulation_process.py', 'observe', token])); if (observed.status === 'stopped') break; }
  let stderr = ''; try { stderr = docker(['exec', container, 'cat', `/var/lib/riffology/services/${token}.stderr.log`]); } catch {} assert.equal(observed.status, 'stopped'); if (scenario === 'cancel') { assert.equal(observed.stop.fenced, true); const again=JSON.parse(docker(['exec',container,'python3','/opt/riffology/simulation_process.py','start',token])); assert.equal(again.status,'stopped'); return; } if (scenario === 'failure') { assert.notEqual(observed.result?.exitCode,0); assert.equal(observed.stop.fenced,true); return; } assert.equal(observed.result?.exitCode, 0, JSON.stringify(observed) + '\n' + stderr); assert.equal(observed.result.result.metrics.value, 7); assert.equal(observed.stop.fenced, true);if(scenario==='outputs'){const output=observed.result.result.outputs[0];assert.equal(output.path,'series.csv');assert.equal(output.sha256,sha(Buffer.from(output.data,'base64')));}
  const repeated = JSON.parse(docker(['exec', container, 'python3', '/opt/riffology/simulation_process.py', 'start', token])); assert.equal(repeated.status, 'stopped'); assert.equal(repeated.result.result.metrics.value, 7);
});
