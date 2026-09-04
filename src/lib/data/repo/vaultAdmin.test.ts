import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminEndpoint, isBanned, tempPassword, parseMembers } from './vaultAdmin.ts';

test('adminEndpoint builds the GoTrue admin URL, trailing slash or not', () => {
  assert.equal(
    adminEndpoint('https://abc.supabase.co'),
    'https://abc.supabase.co/auth/v1/admin/users'
  );
  assert.equal(
    adminEndpoint('https://abc.supabase.co/', '/user-id'),
    'https://abc.supabase.co/auth/v1/admin/users/user-id'
  );
  assert.equal(
    adminEndpoint('https://abc.supabase.co', '?page=1'),
    'https://abc.supabase.co/auth/v1/admin/users?page=1'
  );
});

test('isBanned: only a FUTURE ban timestamp counts', () => {
  assert.equal(isBanned({}), false);
  assert.equal(isBanned({ banned_until: null }), false);
  assert.equal(isBanned({ banned_until: 'garbage' }), false);
  assert.equal(isBanned({ banned_until: '2001-01-01T00:00:00Z' }), false, 'expired ban is over');
  const future = new Date(Date.now() + 3600_000).toISOString();
  assert.equal(isBanned({ banned_until: future }), true);
});

test('tempPassword: right length, unambiguous alphabet, not constant', () => {
  const a = tempPassword();
  const b = tempPassword();
  assert.equal(a.length, 14);
  assert.match(a, /^[23456789a-km-np-zA-HJ-NP-Z]+$/);
  assert.ok(!/[0O1lI]/.test(a), 'no look-alike characters');
  assert.notEqual(a, b, 'two draws differ');
  assert.equal(tempPassword(20).length, 20);
});

test('parseMembers keeps well-formed users and drops the rest', () => {
  assert.deepEqual(parseMembers(null), []);
  assert.deepEqual(parseMembers({}), []);
  assert.deepEqual(parseMembers({ users: 'nope' }), []);
  const out = parseMembers({
    users: [{ id: 'u1', email: 'a@b.c' }, { nope: true }, null, { id: 'u2' }]
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'u1');
});
