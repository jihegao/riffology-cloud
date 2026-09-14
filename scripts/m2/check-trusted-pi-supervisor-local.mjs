// Explicit local-only native check. Uses an already cached image, never pulls.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const image = process.env.RIFFOLOGY_TRUSTED_PI_TEST_IMAGE || 'python:3.11-slim-bookworm';
const result = spawnSync('docker', ['run', '--rm', '--pull=never', '--network=none', '--user=0',
  '--entrypoint=python3', '--mount', `type=bind,src=${root}/services/trusted-pi/runtime_supervisor.py,dst=/opt/riffology/runtime_supervisor.py,readonly`,
  '--mount', `type=bind,src=${root}/tests/m2/trusted_pi_supervisor_native.py,dst=/tmp/native_test.py,readonly`,
  image, '/tmp/native_test.py'], { stdio: 'inherit', timeout: 120000 });
if (result.error) console.error(result.error.message);
if (result.status !== 0) process.exit(result.status ?? 1);
const hostImage = process.env.RIFFOLOGY_TRUSTED_PI_HOST_TEST_IMAGE || 'riffology-trusted-pi-vertical:local';
const host = spawnSync('docker', ['run', '--rm', '--pull=never', '--network=none', '--user=0',
  '--entrypoint=/usr/local/bin/node', '--mount', `type=bind,src=${root}/services/trusted-pi/trusted-pi-turn-host.mjs,dst=/opt/riffology/trusted-pi/trusted-pi-turn-host.mjs,readonly`,
  '--mount', `type=bind,src=${root}/tests/m2/trusted-pi-supervisor-host-files.mjs,dst=/tmp/host-files.mjs,readonly`,
  hostImage, '/tmp/host-files.mjs'], { stdio: 'inherit', timeout: 60000 });
if (host.error) console.error(host.error.message);
process.exit(host.status ?? 1);
