import { readdir, readFile, writeFile, copyFile, mkdir, lstat, rename, rm } from 'node:fs/promises';
import { resolve, join, basename, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { externalPath, repositoryRoot, canonicalPath, contains } from './test-workspace.mjs';

const fixed = new Set(['summary.json', 'syntax-diagnostic.json', 'business-edit.json', 'host-manifest.json',
  'riff-pi-observation.json', 'domain-extension-diagnostic.json', 'check.txt', 'riff-pi-preview.png', 'pi-diagnosis.jpg',
  'workspace-migration.json', 'workspace-migration.jpg']);
const caseFile = /^(baseline|variant|replay)-(record\.json|business\.json|browser-artifact\.json|plan\.json|independent-reference\.json|model\.simpack|runtime\.js)$/;

export async function exportAcceptance(from, to = join(repositoryRoot, 'acceptance/results/pi-web', basename(resolve(from))), { root = repositoryRoot } = {}) {
  const source = await externalPath(from, root), destination = await canonicalPath(to);
  const evidenceRoot = await canonicalPath(join(root, 'acceptance/results'));
  if (!contains(evidenceRoot, destination) || destination === evidenceRoot) throw new Error('Export destination must be a named directory below acceptance/results');
  if (await lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; })) throw new Error(`Preserving existing evidence: ${destination}`);
  const summary = JSON.parse(await readFile(join(source, 'summary.json'), 'utf8'));
  if (summary.status !== 'passed') throw new Error('Only a completed acceptance run can be exported; keep failure/debug output outside the repository');
  const selected = [], skipped = [];
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!fixed.has(entry.name) && !caseFile.test(entry.name)) { skipped.push(entry.name); continue; }
    if (!entry.isFile()) throw new Error(`Evidence must be an ordinary file: ${entry.name}`);
    const bytes = await readFile(join(source, entry.name));
    selected.push({ name: entry.name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await mkdir(temporary, { mode: 0o700 });
  try {
    for (const file of selected) await copyFile(join(source, file.name), join(temporary, file.name));
    const manifest = { version: 1, exportedAt: new Date().toISOString(), source, files: selected.sort((a, b) => a.name.localeCompare(b.name)), skipped: skipped.sort() };
    await writeFile(join(temporary, 'evidence-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await rename(temporary, destination); return { destination, files: selected.length, skipped: manifest.skipped };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const from = process.argv.indexOf('--from'), to = process.argv.indexOf('--to');
  if (from < 0 || !process.argv[from + 1]) throw new Error('Usage: npm run acceptance:export -- --from /external/results [--to acceptance/results/pi-web/name]');
  console.log(JSON.stringify(await exportAcceptance(process.argv[from + 1], to < 0 ? undefined : process.argv[to + 1]), null, 2));
}
