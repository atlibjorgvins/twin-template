import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVaults, migrateFlat, localDbName, localMediaDbName, PRIMARY_ID,
  vaults, addVault, bindVaultScope, vaultForScope
} from './vaults.ts';

test('scope bindings are exclusive per side and unbindable', () => {
  // No localStorage in node: vaults() runs purely in memory, seeded with the
  // migrated primary — good enough to exercise the binding rules.
  const primary = vaults()[0];
  const klak = addVault({ name: 'KLAK', kind: 'workspace', backend: 'supabase' });
  const side = addVault({ name: 'Side', kind: 'workspace', backend: 'local' });

  bindVaultScope(klak.id, 'work');
  bindVaultScope(primary.id, 'private');
  assert.equal(vaultForScope('work')?.id, klak.id);
  assert.equal(vaultForScope('private')?.id, primary.id);

  // Re-binding 'work' to another vault must strip it from KLAK — a click on
  // Work needs exactly one answer.
  bindVaultScope(side.id, 'work');
  assert.equal(vaultForScope('work')?.id, side.id);
  assert.equal(vaults().find((v) => v.id === klak.id)?.boundScope, undefined);

  // Unbind.
  bindVaultScope(side.id, undefined);
  assert.equal(vaultForScope('work'), null);
  assert.equal(vaultForScope('private')?.id, primary.id, 'other side untouched');
});

test('parseVaults drops garbage and keeps well-formed vaults', () => {
  assert.deepEqual(parseVaults('not json'), []);
  assert.deepEqual(parseVaults('{}'), []);
  const good = JSON.stringify([
    { id: 'primary', name: 'Personal', kind: 'personal' },
    { id: 'x', name: 'KLAK', kind: 'workspace', backend: 'directus', directusUrl: 'https://k' },
    { broken: true },
    null
  ]);
  const out = parseVaults(good);
  assert.equal(out.length, 2);
  assert.equal(out[1].name, 'KLAK');
});

test('migrateFlat carries the pre-vault connection into the primary vault', () => {
  const v = migrateFlat({
    backend: 'directus',
    directusUrl: 'https://nas.example',
    directusToken: 'tok',
    supabaseUrl: '',
    supabaseKey: null
  });
  assert.equal(v.id, PRIMARY_ID);
  assert.equal(v.kind, 'personal');
  assert.equal(v.backend, 'directus');
  assert.equal(v.directusUrl, 'https://nas.example');
  assert.equal(v.directusToken, 'tok');
  assert.ok(!('supabaseUrl' in v));
});

test('migrateFlat with nothing set leaves backend to the build default', () => {
  const v = migrateFlat({});
  assert.ok(!('backend' in v), 'unset backend resolves via env defaults later');
});

test('the primary vault keeps the legacy database names; others are isolated', () => {
  assert.equal(localDbName(PRIMARY_ID), 'twin-local-data');
  assert.equal(localMediaDbName(PRIMARY_ID), 'twin-local-media');
  assert.equal(localDbName('abc'), 'twin-local-data--abc');
  assert.equal(localMediaDbName('abc'), 'twin-local-media--abc');
});
