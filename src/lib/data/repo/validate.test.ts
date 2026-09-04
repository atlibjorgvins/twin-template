import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStatus, connCheckMessage, normalizeSupabaseKey, normalizeSupabaseUrl } from './validate.ts';

test('normalizeSupabaseKey strips every kind of paste whitespace', () => {
  // A key copied from a wrapped code block: inner newline + edge spaces.
  assert.equal(normalizeSupabaseKey(' eyJhbGci\nOiJIUzI1 NiJ9\t'), 'eyJhbGciOiJIUzI1NiJ9');
  assert.equal(normalizeSupabaseKey('sb_publishable_abc'), 'sb_publishable_abc');
});

test('normalizeSupabaseUrl rescues a pasted dashboard address', () => {
  assert.equal(
    normalizeSupabaseUrl('https://supabase.com/dashboard/project/egpzbyhoukwddomwmnit'),
    'https://egpzbyhoukwddomwmnit.supabase.co'
  );
  assert.equal(
    normalizeSupabaseUrl('https://supabase.com/dashboard/project/EGPZBYHOUKWDDOMWMNIT/settings/api-keys'),
    'https://egpzbyhoukwddomwmnit.supabase.co'
  );
});

test('normalizeSupabaseUrl trims, de-spaces and drops trailing slashes', () => {
  assert.equal(normalizeSupabaseUrl(' https://abc.supabase.co/ '), 'https://abc.supabase.co');
  assert.equal(normalizeSupabaseUrl('https://abc.supa base.co'), 'https://abc.supabase.co');
});

test('classifyStatus: only a gateway key rejection is bad-key', () => {
  assert.equal(classifyStatus(401), 'bad-key');
  assert.equal(classifyStatus(403), 'bad-key');
  // Any answered request proves the key was accepted — including "no such
  // route" (404 on /rest/v1/ root variants) and server errors.
  assert.equal(classifyStatus(200), 'ok');
  assert.equal(classifyStatus(404), 'ok');
  assert.equal(classifyStatus(500), 'ok');
});

test('connCheckMessage names the actual fix for each failure', () => {
  assert.match(connCheckMessage('bad-key'), /Legacy API keys/);
  assert.match(connCheckMessage('bad-key'), /unbroken line/);
  assert.match(connCheckMessage('unreachable'), /project URL/);
});
