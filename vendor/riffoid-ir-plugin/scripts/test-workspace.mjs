import { readFile, writeFile, mkdir, realpath, lstat, rm } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
export const testHome = resolve(process.env.RIFFOID_IR_TEST_HOME || join(homedir(), '.local/share/riffoid-ir-plugin'));
export const defaultTestWorkspace = join(testHome, 'workspaces/pi-web-acceptance');
export const modelFiles = ['business-ir.draft.json', 'business-ir.json', 'model.simpack', 'browser-artifact.json', 'model-spec.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const contains = (root, path) => {
  const rel = relative(root, path);
  return !rel || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
export async function canonicalPath(path) {
  const absolute = resolve(path);
  try { return await realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT' || dirname(absolute) === absolute) throw error;
    return join(await canonicalPath(dirname(absolute)), relative(dirname(absolute), absolute));
  }
}
export async function externalPath(path, root = repositoryRoot) {
  const [target, repo] = await Promise.all([canonicalPath(path), canonicalPath(root)]);
  if (contains(repo, target) || contains(target, repo)) {
    throw new Error(`Test workspace and raw output must be outside the plugin repository: ${path}`);
  }
  return target;
}
export async function testPaths(env = process.env) {
  const home = resolve(env.RIFFOID_IR_TEST_HOME || testHome);
  const key = new Date().toISOString().replaceAll(/[:.]/g, '-');
  return {
    workspace: await externalPath(resolve(env.RIFFOID_IR_TEST_WORKSPACE || join(home, 'workspaces/pi-web-acceptance'))),
    output: await externalPath(resolve(env.RIFFOID_IR_TEST_OUTPUT || env.RIFFOID_IR_EVIDENCE || join(home, 'results/riff-pi', key))),
  };
}

// Preserve the user's current model while acceptance temporarily exercises B1.
// Raw backups stay outside the repository and are never evidence exports.
export async function preserveModel(workspace, output) {
  const root = await externalPath(workspace), results = await externalPath(output);
  if (!contains(root, await canonicalPath(join(workspace, 'model')))) throw new Error('Model directory escapes the test workspace');
  const backup = await canonicalPath(join(output, 'model-before'));
  if (!contains(results, backup)) throw new Error('Model backup directory escapes raw test output');
  const saved = new Map();
  for (const file of modelFiles) {
    const path = join(workspace, 'model', file);
    const stat = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (stat && !stat.isFile()) throw new Error(`Acceptance requires ordinary model files: ${path}`);
    saved.set(file, stat ? await readFile(path) : undefined);
  }
  await mkdir(backup, { recursive: true, mode: 0o700 });
  for (const [file, bytes] of saved) if (bytes) await writeFile(join(backup, file), bytes, { mode: 0o600 });
  return {
    async restore() {
      await mkdir(join(workspace, 'model'), { recursive: true });
      for (const [file, bytes] of saved) {
        const path = join(workspace, 'model', file);
        if (bytes) await writeFile(path, bytes, { mode: 0o600 });
        else await rm(path, { force: true });
      }
      for (const [file, bytes] of saved) {
        const actual = await readFile(join(workspace, 'model', file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (bytes ? !actual || !actual.equals(bytes) : actual !== undefined) throw new Error(`Original model was not restored: ${file}`);
      }
      return { restored: true, files: [...saved].filter(([, bytes]) => bytes).map(([name, bytes]) => ({ name, sha256: sha(bytes) })) };
    },
  };
}
