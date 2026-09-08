import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const hash = data => createHash('sha256').update(data).digest('hex');
export function safePath(root, input, label = 'file', newFile = false) {
  if (typeof input !== 'string' || input.includes('\0')) throw new Error(`${label} path is invalid`);
  const result = resolve(input), rel = relative(root, result);
  if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} path must be inside repository`);
  const parts = rel.split(sep);
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index]);
    const last = index === parts.length - 1;
    let stat;
    try { stat = lstatSync(current); }
    catch (error) {
      if (last && newFile && error.code === 'ENOENT') return result;
      throw new Error(`${label} file or parent is missing`);
    }
    if (stat.isSymbolicLink()) throw new Error(`${label} symlink path is forbidden`);
    if (last ? !stat.isFile() : !stat.isDirectory()) throw new Error(`${label} path is not a regular file`);
    if (last && newFile) throw new Error(`${label} output already exists`);
  }
  return result;
}
export function sourceSnapshot(root) {
  const output = execFileSync('rg', ['--files', '--hidden', 'services', 'spikes', 'scripts', 'tests', 'infra', 'ui', '-g', '!.dev.vars*', '-g', '!.env*', '-g', '!**/.wrangler/**', '-g', '!**/.local/**'], { cwd: root, encoding: 'utf8' }).trim();
  const paths = (output ? output.split('\n') : []).concat(['package.json', 'package-lock.json', 'tsconfig.json', 'Dockerfile.trusted-pi.cloud', '.dockerignore', '.gitignore']).sort();
  const files = paths.map(path => ({ path, sha256: hash(readFileSync(safePath(root, resolve(root, path), 'source'))) }));
  return { sha256: hash(JSON.stringify(files)), files };
}
