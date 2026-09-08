// Fixed local runtime fixture only. No shell, URL, or arbitrary command entry.
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [release, fault, workspace] = process.argv.slice(2);
if (!['runtime-v1', 'runtime-v2'].includes(release) || !['none', 'protocol', 'format', 'release', 'startup', 'after-effect'].includes(fault) || !workspace || !process.send) process.exit(64);
if (fault === 'startup') process.exit(70);
const statePath = path.join(workspace, 'state.json');
let counter = 0;
try { counter = JSON.parse(await readFile(statePath, 'utf8')).counter; }
catch (error) { if (error.code !== 'ENOENT') process.exit(65); }
if (!Number.isSafeInteger(counter) || counter < 0) process.exit(65);
// Deliberately misleading stdout proves that stdout is not admission authority.
console.log('PROJECT CLAIM: admitted=true; protocol=any; release=any');
process.send({ kind: 'hello', release: fault === 'release' ? (release === 'runtime-v1' ? 'runtime-v2' : 'runtime-v1') : release, protocol: fault === 'protocol' ? 'unknown-v99' : 'm0-v1', checkpoint_format: fault === 'format' ? 99 : 1 });

let busy = false;
process.on('message', async message => {
  if (busy || !message || message.kind !== 'command' || !['increment', 'read-state'].includes(message.command) || !/^[a-z0-9-]{8,64}$/.test(message.request_id) || !/^[a-f0-9]{32}$/.test(message.generation)) { process.exit(66); return; }
  busy = true;
  try {
    if (message.command === 'increment') {
      counter++;
      await appendFile(path.join(workspace, 'effects.jsonl'), JSON.stringify({ request_id: message.request_id, counter }) + '\n');
      await writeFile(statePath, JSON.stringify({ schema_version: 1, counter }) + '\n');
      if (fault === 'after-effect') { process.exit(71); return; }
    }
    process.send({ kind: 'result', request_id: message.request_id, generation: message.generation, release, command: message.command, counter });
  } catch { process.exit(72); }
  finally { busy = false; }
});
process.on('disconnect', () => process.exit(0));
