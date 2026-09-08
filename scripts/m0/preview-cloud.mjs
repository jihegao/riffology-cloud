#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCloudInputs, previewSources } from './preview-manifest.mjs';
import { runPreviewProbe } from './preview-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
try {
  if (process.argv.length === 3 && process.argv[2] === '--source-hash') {
    console.log(JSON.stringify({ deploymentSourceSha256: previewSources(root).sha256 }));
  } else {
    if (process.argv.length !== 4) throw new Error('usage');
    await runPreviewProbe(await loadCloudInputs(root, process.argv[2], process.argv[3]));
  }
} catch {
  // Do not print JSON parser excerpts, filesystem errors, URLs or credentials.
  console.error('Preview cloud preflight failed. Usage: node scripts/m0/preview-cloud.mjs <deployment-manifest.json> <0600-token-secret.json>, or --source-hash.');
  process.exitCode = 1;
}
