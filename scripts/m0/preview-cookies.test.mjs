import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureCookiesForUrl } from './preview-cookies.mjs';

test('manual fixture replay cannot copy parent, sibling, domain or unrelated cookies into Preview', () => {
  const host = 'p-0123456789abcdef0123456789abcdef.preview.riff-demo.gaojihe.cn';
  const common = { path: '/', secure: true, httpOnly: true };
  const allowed = { ...common, name: '__Host-m0_preview', value: 'project', domain: host };
  const cookies = [allowed,
    { ...common, name: '__Host-m0_principal', value: 'control', domain: 'riff-demo.gaojihe.cn' },
    { ...allowed, value: 'sibling', domain: 'p-other.preview.riff-demo.gaojihe.cn' },
    { ...allowed, value: 'domain', domain: '.' + host },
    { ...allowed, name: 'unrelated' },
    { ...allowed, httpOnly: false },
  ];
  assert.deepEqual(fixtureCookiesForUrl(cookies, 'https://' + host + '/api/state'), [allowed]);
  assert.deepEqual(fixtureCookiesForUrl(cookies, 'https://riff-demo.gaojihe.cn/').map(c => c.value), ['control']);
  assert.throws(() => fixtureCookiesForUrl(cookies, 'http://' + host), /https-required/);
});
