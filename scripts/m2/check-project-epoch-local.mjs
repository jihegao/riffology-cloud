// Actual Project Python entrypoints in native Linux, cached image, no network.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const image=process.env.RIFFOLOGY_PROJECT_EPOCH_TEST_IMAGE || 'python:3.11-slim-bookworm';
const run=spawnSync('docker',['run','--rm','--pull=never','--network=none','--user=0','--entrypoint=python3',
  '--mount',`type=bind,src=${root}/services/project-tools,dst=/opt/riffology,readonly`,
  '--mount',`type=bind,src=${root}/tests/m2/project_epoch_native.py,dst=/tmp/project_epoch_native.py,readonly`,
  image,'/tmp/project_epoch_native.py'],{stdio:'inherit',timeout:120000});
if(run.error) console.error(run.error.message);
process.exit(run.status??1);
