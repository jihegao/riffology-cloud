import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { sha256 } from './util.mjs';

const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z');

async function collectFiles(root, current = root, result = []) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(current, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error(`skill-symlink-not-allowed:${path}`);
    if (metadata.isDirectory()) await collectFiles(root, path, result);
    else if (metadata.isFile()) result.push(path);
  }
  return result;
}

export async function buildSkillArchive(skillDirectory) {
  const rootName = basename(skillDirectory);
  const files = await collectFiles(skillDirectory);
  const archiveEntries = {};
  for (const file of files) {
    const relativePath = relative(skillDirectory, file).split(sep).join('/');
    archiveEntries[`${rootName}/${relativePath}`] = [await readFile(file), { mtime: ZIP_EPOCH }];
  }
  if (!archiveEntries[`${rootName}/SKILL.md`]) throw new Error('skill-manifest-missing');
  const bytes = zipSync(archiveEntries, { level: 9 });
  return {
    bytes,
    base64: Buffer.from(bytes).toString('base64'),
    sha256: sha256(bytes),
    files: Object.keys(archiveEntries),
  };
}

export function inlineSkill(archive, name, description) {
  return {
    type: 'inline',
    name,
    description,
    source: {
      type: 'base64',
      media_type: 'application/zip',
      data: archive.base64,
    },
  };
}
