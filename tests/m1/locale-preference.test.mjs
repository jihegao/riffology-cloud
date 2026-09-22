import assert from 'node:assert/strict';
import test from 'node:test';
import {createLocalePreferenceController} from '../../services/web/locale-preference.js';

function deferred() {
  let resolve;
  return {promise:new Promise(done => { resolve = done; }), resolve};
}

test('a selection during hydration wins and is persisted for the current account', async () => {
  const read = deferred(), writes = [];
  let locale = 'zh-CN';
  const controller = createLocalePreferenceController({
    read: () => read.promise,
    write: async value => { writes.push(value); },
    currentLocale: () => locale,
    applyLocale: value => { locale = value; },
    onSaveFailure: () => assert.fail('save should succeed'),
  });
  const start = controller.begin();
  controller.activate('account-a', 1, start);
  locale = 'en'; controller.select('en');
  read.resolve({locale:'zh-CN'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(locale, 'en');
  assert.deepEqual(writes, ['en']);
});

test('a new auth generation drops pending writes from the prior account', async () => {
  const first = deferred(), writes = [];
  const controller = createLocalePreferenceController({
    read: async () => ({locale:null}),
    write: value => { writes.push(value); return first.promise; },
    currentLocale: () => 'en',
    applyLocale: () => {},
    onSaveFailure: () => {},
  });
  controller.activate('account-a', 1);
  controller.select('en');
  controller.begin();
  controller.activate('account-b', 2);
  first.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, ['en']);
});
