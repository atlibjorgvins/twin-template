// Both URL shapes resolve correctly for Directus and Immich. Pure — no browser,
// no network. Guards the /api migration: the whole point is that an absolute
// config and a same-origin /api config both produce working backend URLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The module reads PUBLIC_DIRECTUS_URL at import time via $env, which node:test
// cannot provide, so exercise the pure logic directly rather than importing it.
function immichBaseFor(base: string, origin = 'https://app.example:8443'): string {
  const DIRECTUS_BASE = base.replace(/\/+$/, '');
  if (DIRECTUS_BASE.startsWith('/')) return '/immich';
  const abs = DIRECTUS_BASE.startsWith('/') ? origin + DIRECTUS_BASE : DIRECTUS_BASE;
  const u = new URL(abs);
  u.port = '8444'; u.pathname = ''; u.search = '';
  return u.toString().replace(/\/$/, '');
}

test('absolute Directus URL → Immich on :8444, same host', () => {
  assert.equal(
    immichBaseFor('https://twin.example.com'),
    'https://twin.example.com:8444'
  );
});

test('an absolute URL that already had a port still lands on 8444', () => {
  assert.equal(immichBaseFor('https://host.example:443'), 'https://host.example:8444');
});

test('same-origin /api → Immich at /immich, no host, no port swap', () => {
  assert.equal(immichBaseFor('/api'), '/immich');
});

test('trailing slashes do not change the answer', () => {
  assert.equal(immichBaseFor('/api/'), '/immich');
  assert.equal(immichBaseFor('https://h.example/'), 'https://h.example:8444');
});


// Regression: the SDK does `new URL(base)` internally, so whatever createDirectus
// receives MUST be a valid absolute URL — a bare path throws "Invalid URL" and
// the whole client dies at construction. This is what broke the /api flip on
// 2026-08-21. directusAbsolute() is what createDirectus must be given.
function directusAbsoluteFor(base: string, origin = 'https://app.example:8443'): string {
  const DIRECTUS_BASE = base.replace(/\/+$/, '');
  if (!DIRECTUS_BASE.startsWith('/')) return DIRECTUS_BASE;
  return origin + DIRECTUS_BASE;
}

test('new URL(directusAbsolute) never throws — absolute config', () => {
  assert.doesNotThrow(() => new URL(directusAbsoluteFor('https://twin.example.com')));
});

test('new URL(directusAbsolute) never throws — /api config', () => {
  // The bug: new URL('/api') throws; new URL(directusAbsolute('/api')) must not.
  assert.throws(() => new URL('/api'));
  assert.doesNotThrow(() => new URL(directusAbsoluteFor('/api')));
  assert.equal(directusAbsoluteFor('/api'), 'https://app.example:8443/api');
});
