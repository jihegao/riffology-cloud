import {strict as assert} from 'node:assert';
import {readFile} from 'node:fs/promises';
import {dictionary, locales} from '../services/web/i18n.js';

const files = ['services/web/index.html', 'services/web/admin.html'];
const sharedShellKeys = ['shell.skip', 'shell.home', 'shell.language', 'shell.signOut', 'shell.signIn', 'home.loginEyebrow', 'home.loginTitle', 'home.loginCopy', 'home.projectsEyebrow', 'home.projectsTitle', 'home.personalWorkspace', 'home.newProject', 'admin.loginTitle', 'admin.loginCopy', 'admin.signIn', 'locale.saveFailed'];
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
