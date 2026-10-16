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

test('a selection made during auth bootstrap persists instead of accepting the stale account locale', async () => {
  const writes = [];
  let locale = 'zh-CN';
  const controller = createLocalePreferenceController({
    read: async () => ({locale:null}), write: async value => { writes.push(value); },
    currentLocale: () => locale, applyLocale: value => { locale = value; }, onSaveFailure: () => {},
  });
  const start = controller.begin();
  locale = 'en'; controller.select('en');
  controller.activate('account-a', 1, start, {locale:'zh-CN'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(locale, 'en');
  assert.deepEqual(writes, ['en']);
});

test('rapid selections serialize writes and retain only the newest queued value', async () => {
  const first = deferred(), writes = [];
  let concurrent = 0, maximum = 0;
  const controller = createLocalePreferenceController({
    read: async () => ({locale:null}),
    write: value => {
      writes.push(value); concurrent++; maximum = Math.max(maximum, concurrent);
      return writes.length === 1 ? first.promise.finally(() => { concurrent--; }) : Promise.resolve().then(() => { concurrent--; });
    },
    currentLocale: () => 'zh-CN', applyLocale: () => {}, onSaveFailure: () => {},
  });
  controller.activate('account-a', 1);
  controller.select('en'); controller.select('zh-CN'); controller.select('en');
  first.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, ['en', 'en']);
  assert.equal(maximum, 1);
});

test('a queued old-account write never dispatches after authentication changes', async () => {
  const first = deferred(), writes = [];
  const controller = createLocalePreferenceController({
    read: async () => ({locale:null}), write: value => { writes.push(value); return first.promise; },
    currentLocale: () => 'en', applyLocale: () => {}, onSaveFailure: () => {},
  });
  controller.activate('account-a', 1);
  controller.select('en'); controller.select('zh-CN');
  controller.begin(); controller.activate('account-b', 2);
  first.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, ['en']);
});

test('an old hydration response cannot replace a newer identity', async () => {
  const first = deferred(), second = deferred();
  let locale = 'zh-CN', reads = 0;
  const controller = createLocalePreferenceController({
    read: () => (++reads === 1 ? first.promise : second.promise), write: async () => {},
    currentLocale: () => locale, applyLocale: value => { locale = value; }, onSaveFailure: () => {},
  });
  controller.activate('account-a', 1);
  controller.begin(); controller.activate('account-b', 2);
  first.resolve({locale:'en'}); second.resolve({locale:'zh-CN'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(locale, 'zh-CN');
});

test('a failed preference read keeps the already selected local locale', async () => {
  let locale = 'en';
  const controller = createLocalePreferenceController({
    read: async () => { throw Error('offline'); }, write: async () => {},
    currentLocale: () => locale, applyLocale: value => { locale = value; }, onSaveFailure: () => {},
  });
  controller.activate('account-a', 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(locale, 'en');
});

test('a failed write only reports locally and a later choice recovers', async () => {
  const writes = [], failures = [];
  let reject = true;
  const controller = createLocalePreferenceController({
    read: async () => ({locale:null}), write: async value => { writes.push(value); if (reject) throw Error('offline'); },
    currentLocale: () => 'en', applyLocale: () => {}, onSaveFailure: () => failures.push('failed'),
  });
  controller.activate('account-a', 1);
  controller.select('en');
  await new Promise(resolve => setImmediate(resolve));
  reject = false; controller.select('zh-CN');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(failures, ['failed']);
  assert.deepEqual(writes, ['en', 'zh-CN']);
});

test('locale storage exceptions do not prevent locale reads or changes', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {configurable:true, get() { throw Error('storage denied'); }});
  try {
    const module = await import(`../../services/web/i18n.js?storage=${Date.now()}`);
    assert.equal(module.getLocale(), 'en');
    assert.equal(module.setLocale('zh-CN'), 'zh-CN');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
  }
});


test('getItem and setItem failures preserve switching, and an unchanged explicit choice persists', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const writes = [];
  Object.defineProperty(globalThis, 'window', {configurable:true, value:{localStorage:{
    getItem() { throw Error('read denied'); },
    setItem() { throw Error('write denied'); },
  }}});
  try {
    const module = await import(`../../services/web/i18n.js?method-failures=${Date.now()}`);
    assert.equal(module.setLocale('zh-CN'), 'zh-CN');
    window.localStorage.setItem = (key, value) => writes.push([key, value]);
    assert.equal(module.setLocale('zh-CN'), 'zh-CN');
    assert.deepEqual(writes, [['riffology:locale', 'zh-CN']]);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete globalThis.window;
  }
});
