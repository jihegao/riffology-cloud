import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, emptyBrowserState, type BrowserAction } from './browser.ts';
import { accessStillAllowed, resolveBrowserAccess, type AccessAuthority } from './lifecycle.ts';
import type { BrowserResult } from './browser.ts';
import type { Scope } from './policy.ts';
const scope: Scope = { run_id: 'preview-race-0001', tenant: 'alpha', preview_id: 'fixture-alpha-preview', generation: '1'.repeat(32) };

test('all opaque inputs reject prototype keys before a transaction and inherited valid-looking records are ignored', () => {
  let state = emptyBrowserState(), writes = 0, transactions = 0;
  const store = { read: () => state, write: (value: typeof state) => { state = value; writes++; }, transaction: <T>(fn: () => T): T => { transactions++; return fn(); } };
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const valid = '1'.repeat(64);
  for (const value of ['__proto__', 'constructor', 'toString', '', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64)]) {
    const actions: BrowserAction[] = [
      { kind: 'login', enrollment: value }, { kind: 'session', sid: value },
      { kind: 'ticket', sid: value, grant: { ...scope, expires_at: 9999999999 } },
      { kind: 'begin', ticket: value, generation: scope.generation },
      { kind: 'authorize', sid: valid, challenge: value }, { kind: 'authorize', sid: value, challenge: valid },
      { kind: 'redeem', code: value, nonce: valid, generation: scope.generation }, { kind: 'redeem', code: valid, nonce: value, generation: scope.generation },
      { kind: 'access', access: value, scope }, { kind: 'logout', sid: value },
    ];
    for (const action of actions) assert.deepEqual(browserAction(store, action), { ok: false, error: 'invalid-opaque-credential' });
  }
  assert.equal(transactions, 0);
  assert.equal(writes, 0);
  assert.deepEqual(state.sessions, {});
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
  // Shape validation alone is not the inherited-record defense.
  state.enrollments = Object.create({ [valid]: { tenant: 'alpha', expires_at: 9999999999, used: false } });
  assert.deepEqual(browserAction(store, { kind: 'login', enrollment: valid }), { ok: false, error: 'enrollment-denied' });
  assert.equal(writes, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});

test('late authorization RPC cannot cross logout, generation or expiry fences; caller rechecks after await', async () => {
  for (const change of ['logout', 'generation', 'expiry']) {
    let resolve!: (result: BrowserResult) => void;
    let revoked = false, current = true, now = 100;
    const pending = new Promise<BrowserResult>(done => { resolve = done; });
    const authority: AccessAuthority = { nowSeconds: () => now, scopeActive: () => current, sessionRevoked: () => revoked, lookup: () => pending };
    const lookup = resolveBrowserAccess(authority, scope, '1'.repeat(64));
    // Central DO accepted the access; its response is held until after logout ACK.
    const stale = { ok: true, sid: '2'.repeat(64), expires_at: 120 };
    if (change === 'logout') revoked = true;
    else if (change === 'generation') current = false;
    else now = 120;
    resolve(stale);
    assert.equal(await lookup, null, change);
  }
  let revoked = false;
  const authority: AccessAuthority = { nowSeconds: () => 100, scopeActive: () => true, sessionRevoked: () => revoked, lookup: async () => ({ ok: true, sid: '2'.repeat(64), expires_at: 120 }) };
  const accepted = await resolveBrowserAccess(authority, scope, '1'.repeat(64));
  assert.ok(accepted);
  // Covers a second scheduling window: helper returned, consumer has not used it.
  revoked = true;
  assert.equal(accessStillAllowed(authority, scope, accepted), false);
});
