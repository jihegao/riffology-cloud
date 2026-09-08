import assert from 'node:assert/strict';
import { classifyCloudError, checkVersion, redactSummary } from './preflight.mjs';

assert.equal(checkVersion('1.2.3', '1.2.3'), 'passed');
assert.equal(checkVersion('1.2.4', '1.2.3'), 'failed');
assert.equal(classifyCloudError('This feature requires a paid plan'), 'paid-plan-required');
assert.equal(classifyCloudError('R2 is not enabled'), 'r2-disabled');
assert.equal(classifyCloudError('Please enable R2 through the Cloudflare Dashboard. [code:10042]'), 'r2-disabled');
assert.equal(classifyCloudError('You are not logged in'), 'auth-required');
assert.equal(classifyCloudError('a required secret is missing'), 'unknown');
assert.equal(classifyCloudError('unexpected outage'), 'unknown');
assert.match(redactSummary('token=abc123 secret: xyz'), /token=\[redacted\].*secret=\[redacted\]/);
console.log('m0 preflight self-test: passed');
