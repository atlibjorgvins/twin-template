import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBackend } from './choice.ts';

test('build default wins when the device has no stored choice', () => {
  assert.equal(resolveBackend('local', '', '', {}).backend, 'local');
  // Nothing chose a backend anywhere: local unless a Directus URL is
  // configured — a bare clone works out of the box; a real .env keeps
  // pointing at its server.
  assert.equal(resolveBackend(undefined, '', '', {}).backend, 'local');
  assert.equal(resolveBackend(undefined, '', '', {}, 'https://nas.example').backend, 'directus');
  assert.equal(resolveBackend(undefined, '', '', {}, '/api').backend, 'directus');
});

test('a stored device choice beats the build default', () => {
  const r = resolveBackend('directus', '', '', { backend: 'local' });
  assert.equal(r.backend, 'local');
  assert.equal(r.fallbackReason, null);
});

test('supabase resolves with stored credentials, and stored beats build', () => {
  const r = resolveBackend('directus', 'https://build.supabase.co', 'buildkey', {
    backend: 'supabase',
    supabaseUrl: 'https://mine.supabase.co',
    supabaseKey: 'minekey'
  });
  assert.equal(r.backend, 'supabase');
  assert.equal(r.supabaseUrl, 'https://mine.supabase.co');
  assert.equal(r.supabaseKey, 'minekey');
});

test('supabase choice falls back to build credentials when the device has none', () => {
  const r = resolveBackend('directus', 'https://build.supabase.co', 'buildkey', {
    backend: 'supabase'
  });
  assert.equal(r.backend, 'supabase');
  assert.equal(r.supabaseUrl, 'https://build.supabase.co');
});

test('supabase without any credentials falls back to the build default, loudly', () => {
  const r = resolveBackend('supabase', '', '', {});
  assert.equal(r.backend, 'local'); // no Directus URL configured
  assert.ok(r.fallbackReason);
  const r2 = resolveBackend('supabase', '', '', {}, 'https://nas.example');
  assert.equal(r2.backend, 'directus');
});

test('directus needs a URL from somewhere — build or device — else local, loudly', () => {
  const none = resolveBackend('directus', '', '', {});
  assert.equal(none.backend, 'local');
  assert.ok(none.fallbackReason?.includes('no server URL'));
  const viaDevice = resolveBackend(undefined, '', '', {
    backend: 'directus',
    directusUrl: 'https://my.directus.example'
  });
  assert.equal(viaDevice.backend, 'directus');
  assert.equal(viaDevice.fallbackReason, null);
});

test('an unknown backend name falls back to the build default, loudly', () => {
  const r = resolveBackend('directus', '', '', { backend: 'postgres' }, 'https://nas.example');
  assert.equal(r.backend, 'directus');
  assert.ok(r.fallbackReason?.includes('postgres'));
  assert.equal(resolveBackend(undefined, '', '', { backend: 'postgres' }).backend, 'local');
});
