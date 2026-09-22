import {strict as assert} from 'node:assert';
import {readFile, readdir} from 'node:fs/promises';
import {dictionary, locales} from '../services/web/i18n.js';

const files = ['services/web/index.html', 'services/web/admin.html'];
const sharedShellKeys = ['shell.skip', 'shell.home', 'shell.language', 'shell.signOut', 'shell.signIn', 'home.loginEyebrow', 'home.loginTitle', 'home.loginCopy', 'home.projectsEyebrow', 'home.projectsTitle', 'home.personalWorkspace', 'home.newProject', 'admin.loginTitle', 'admin.loginCopy', 'admin.signIn', 'locale.saveFailed', 'composer.send', 'composer.processing', 'composer.confirming', 'composer.retry', 'composer.stale', 'composer.processingStatus', 'composer.awaitingStatus', 'composer.confirmingStatus', 'composer.awaitingRefreshError', 'composer.refreshFailed', 'composer.invalidResponse', 'composer.receiptAccepted', 'composer.receiptStorageFailure'];
const expected = new Set(sharedShellKeys);
const reference = new Set(Object.keys(dictionary['zh-CN']));
assert.deepEqual(reference, expected, 'extend the explicit A-scope guard before adding a dictionary key');
for (const locale of locales) {
  const keys = new Set(Object.keys(dictionary[locale] ?? {}));
  assert.deepEqual(keys, reference, `${locale} must contain exactly the shared-shell dictionary keys`);
  for (const key of keys) assert.equal(typeof dictionary[locale][key], 'string', `${locale}.${key} must be text`);
}
for (const file of files) {
  const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const match of html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)) assert.ok(reference.has(match[1]), `${file} uses a key outside the A shared-shell scope: ${match[1]}`);
}
console.log('i18n shared-shell dictionary coverage passed');

// Conservative source ratchet: existing CJK text may be removed, never added
// outside the dictionary. This includes comments; English UI still needs review.
const baseline = JSON.parse(await readFile(new URL('./i18n-legacy-cjk.json', import.meta.url), 'utf8'));
for (const name of await readdir(new URL('../services/web/', import.meta.url))) {
  if (!/\.(js|html)$/.test(name) || name === 'i18n.js') continue;
  const source = await readFile(new URL(`../services/web/${name}`, import.meta.url), 'utf8');
  const counts = {};
  for (const [text] of source.matchAll(/[\p{Script=Han}]+/gu)) counts[text] = (counts[text] ?? 0) + 1;
  for (const [text, count] of Object.entries(counts)) assert.ok(count <= (baseline[name]?.[text] ?? 0), `${name}: new hardcoded CJK text ${JSON.stringify(text)}; use t() and both dictionaries`);
}
const declarations = JSON.parse(await readFile(new URL('./i18n-shell-declarations.json', import.meta.url), 'utf8'));
for (const [file, expectedKeys] of Object.entries(declarations)) {
  const html = await readFile(new URL(`../services/web/${file}`, import.meta.url), 'utf8');
  const actualKeys = [...html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(actualKeys, expectedKeys, `${file}: do not replace translated shell declarations with hardcoded text`);
}
console.log('i18n legacy CJK ratchet and translated shell declarations passed');
