import assert from 'node:assert/strict';
import test from 'node:test';
import { PREVIEW_DECLARATION_PATH, parsePreviewDeclaration } from '../../services/preview/declaration.ts';

const starter = () => ({ schemaVersion: 1, runtime: 'python', entrypoint: 'app/main.py', dependencyLock: 'app/requirements.lock', port: 8080, healthPath: '/health', observation: { pagePath: '/', statePath: '/state' } });
const denied = (raw: unknown) => assert.throws(() => parsePreviewDeclaration(raw), /invalid-preview-declaration/);

test('starter declaration is detached and ordinary web preview needs no observation', () => {
  assert.equal(PREVIEW_DECLARATION_PATH, 'app/preview.json');
  const input = starter(), parsed = parsePreviewDeclaration(input);
  assert.deepEqual(parsed, input);
  input.observation.statePath = '/changed';
  assert.equal(parsed.observation?.statePath, '/state');
  const { observation, ...ordinary } = starter();
  assert.deepEqual(parsePreviewDeclaration(ordinary), ordinary);
  assert.equal(Object.hasOwn(parsePreviewDeclaration(ordinary), 'observation'), false);
  assert.equal(parsePreviewDeclaration({ ...ordinary, entrypoint: 'model/模型.py' }).entrypoint, 'model/模型.py');
});

test('closed schema rejects platform capabilities, commands and wrong fixed values', () => {
  for (const key of ['env', 'args', 'command', 'url', 'permissions', 'tenantId', 'previewId']) denied({ ...starter(), [key]: {} });
  for (const [key, values] of Object.entries({ schemaVersion: [0, '1', 2], runtime: ['node', null], port: [80, '8080', 8081], observation: [null, undefined, [], {}] })) {
    for (const value of values) denied({ ...starter(), [key]: value });
  }
  for (const key of ['schemaVersion', 'runtime', 'entrypoint', 'dependencyLock', 'port', 'healthPath']) {
    const input: Record<string, unknown> = starter(); delete input[key]; denied(input);
  }
  for (const raw of [null, [], 'json', 1, Object.create(null), new Date()]) denied(raw);
  denied({ ...starter(), observation: { ...starter().observation, permissions: {} } });
});

test('project paths reject traversal, reserved controls, encoding and incompatible locations', () => {
  for (const entrypoint of ['/app/main.py', '../app/main.py', 'app/../main.py', 'app/./main.py', 'app//main.py', 'app/.riffology/main.py', '.riffology/main.py', 'app\\main.py', 'app/%2e/main.py', 'app/main.py\n', 'app/\u0000main.py', 'app/\ud800.py', 'app/e\u0301.py', 'docs/main.py', 'app/main.sh', `app/${'字'.repeat(80)}.py`]) denied({ ...starter(), entrypoint });
  for (const dependencyLock of ['model/requirements.lock', '/app/requirements.lock', 'app/../requirements.lock', 'app/.riffology/deps.lock', 'app/requirements.txt', 'app/a%20.lock']) denied({ ...starter(), dependencyLock });
  const exact = `app/${'a'.repeat(233)}.py`;
  assert.equal(new TextEncoder().encode(exact).length, 240);
  assert.equal(parsePreviewDeclaration({ ...starter(), entrypoint: exact }).entrypoint, exact);
  denied({ ...starter(), entrypoint: exact.replace('.py', 'a.py') });
});

test('local routes cannot select origins, traversal or ambiguous URL encodings', () => {
  for (const path of ['https://example.com', '//example.com', '/a//b', '/./a', '/a/..', '/a%2fb', '/a?b=1', '/a#b', '/a\\b', '/a b', '/中文', '/a\n', 'health', '/a/', `/${'a'.repeat(256)}`]) {
    denied({ ...starter(), healthPath: path });
    denied({ ...starter(), observation: { pagePath: path, statePath: '/state' } });
    denied({ ...starter(), observation: { pagePath: '/', statePath: path } });
  }
  assert.equal(parsePreviewDeclaration({ ...starter(), healthPath: `/${'a'.repeat(255)}` }).healthPath.length, 256);
  for (const observation of [{ pagePath: '/', statePath: '/' }, { pagePath: '/health', statePath: '/state' }, { pagePath: '/', statePath: '/health' }]) denied({ ...starter(), observation });
});

test('own accessors, symbols and hidden fields reject without invoking getters', () => {
  let calls = 0;
  const getter = () => { calls++; throw new Error('getter ran'); };
  const top = starter(); Object.defineProperty(top, 'entrypoint', { get: getter }); denied(top);
  const nested = starter(); Object.defineProperty(nested.observation, 'statePath', { get: getter }); denied(nested);
  denied({ ...starter(), [Symbol('permissions')]: {} });
  denied({ ...starter(), observation: { ...starter().observation, [Symbol('permissions')]: {} } });
  const hidden = starter(); Object.defineProperty(hidden, 'env', { value: {}, enumerable: false }); denied(hidden);
  const inherited = Object.create(starter()); denied(inherited);
  assert.equal(calls, 0);
});
