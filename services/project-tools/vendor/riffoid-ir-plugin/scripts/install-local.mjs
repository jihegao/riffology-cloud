import { mkdir, symlink, readlink, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { packageRoot } from '../src/compiler.mjs';

const entries = [
  [join(homedir(), '.pi-web/plugins/riffoid-ir'), packageRoot.replace(/\/$/, '')],
  [join(homedir(), '.pi/agent/extensions/riffoid-ir'), join(packageRoot, 'extensions/riffoid-ir')],
  [join(homedir(), '.pi/agent/skills/riffoid-ir'), join(packageRoot, 'skills/riffoid-ir')],
];
for (const [destination, source] of entries) {
  await mkdir(dirname(destination), { recursive: true });
  const exists = await lstat(destination).catch(() => undefined);
  if (exists) {
    if (exists.isSymbolicLink() && await readlink(destination) === source) continue;
    throw new Error(`Preserving existing path: ${destination}. Install manually with a different name.`);
  }
  await symlink(source, destination);
  console.log(`Linked ${destination}`);
}
console.log('Reload the PI WEB page; run /reload in idle Pi sessions, then /sim show and open IR Model.');
