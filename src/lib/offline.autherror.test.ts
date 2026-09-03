// isAuthError must recognise a real Directus 401/403 and nothing else — it is
// what keeps a session-expiry from marking an offline edit permanently failed.
// Shapes taken from the live server: a bad token on /users/me returns HTTP 401
// with errors[0].extensions.code === 'INVALID_CREDENTIALS'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthError, isNetworkError } from './offline.ts';

test('Directus INVALID_CREDENTIALS is an auth error', () => {
  assert.equal(isAuthError({ errors: [{ extensions: { code: 'INVALID_CREDENTIALS' } }] }), true);
});

test('a 401/403 response status is an auth error', () => {
  assert.equal(isAuthError({ response: { status: 401 } }), true);
  assert.equal(isAuthError({ status: 403 }), true);
  assert.equal(isAuthError({ errors: [{ extensions: { code: 'TOKEN_EXPIRED' } }] }), true);
});

test('a network failure is NOT an auth error (stays offline, not needs-auth)', () => {
  assert.equal(isAuthError(new TypeError('Failed to fetch')), false);
  assert.equal(isNetworkError(new TypeError('Failed to fetch')), true);
});

test('a real validation error is neither auth nor network — it truly failed', () => {
  const validation = { errors: [{ extensions: { code: 'FAILED_VALIDATION' } }], response: { status: 400 } };
  assert.equal(isAuthError(validation), false);
  assert.equal(isNetworkError(validation), false);
});

test('a 500 is neither — it retries as a genuine failure, not a re-login', () => {
  assert.equal(isAuthError({ response: { status: 500 } }), false);
});
