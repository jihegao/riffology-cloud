import test from 'node:test';
import assert from 'node:assert/strict';
import {englishLiterals} from '../../scripts/i18n-source-check.mjs';

test('copy guard recognizes prose and actions without treating comments or translation keys as copy', () => {
  const source = `// user's comment is not a string
    /* another 'comment' */
    button.textContent = 'Launch experiment';
    node('button', 'Retry');
    msg('experiment.run');
    const route = 'https://example.test/api';
    const type = 'waiting_for_capacity';`;
  assert.deepEqual(englishLiterals(source), {'Launch experiment':1, Retry:1});
});

test('copy guard counts repeated and interpolated prose, leaving technical exceptions explicit', () => {
  const source = "button('Retry');button('Retry');node('p', `Saved revision ${revision}`);node('div', 'button primary');";
  assert.deepEqual(englishLiterals(source), {Retry:2, 'Saved revision ${revision}':1, 'button primary':1});
});
