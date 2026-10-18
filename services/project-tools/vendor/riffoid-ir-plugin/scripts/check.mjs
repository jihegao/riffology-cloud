import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
async function check(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await check(child);
    else if (/\.(mjs|js)$/.test(entry.name)) execFileSync(process.execPath, ['--check', child], { stdio: 'inherit' });
  }
}
for (const dir of ['src', 'browser', 'extensions', 'scripts', 'adapters']) await check(dir);
console.log('JavaScript sources checked; the package ships native ES modules without a bundling step.');
