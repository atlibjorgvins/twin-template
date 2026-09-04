import { test } from 'node:test';
import assert from 'node:assert/strict';
import { policySql, pluginDdl } from './schemaSync.ts';
import { PLUGIN_SCHEMAS } from './pluginSchemas.ts';

test('policySql speaks the vault flavor', () => {
  const managed = policySql(['notes', 'Tag'], true);
  assert.match(managed, /to authenticated/);
  assert.match(managed, /twin_members_all/);
  assert.doesNotMatch(managed, /to anon/);
  const personal = policySql(['notes'], false);
  assert.match(personal, /to anon/);
  assert.match(personal, /twin_anon_all/);
});

test('pluginDdl bundles the plugin tables, the shared tag tables, and policies', () => {
  const ddl = pluginDdl('notes', true);
  assert.ok(ddl);
  assert.match(ddl!, /create table if not exists notes/);
  assert.match(ddl!, /create table if not exists "Tag"/, 'tag tables ride along');
  assert.match(ddl!, /twin_members_all/);
  assert.equal(pluginDdl('no-such-plugin', true), null);
});

test('every schema fragment is idempotent DDL over its declared tables', () => {
  for (const [id, frag] of Object.entries(PLUGIN_SCHEMAS)) {
    for (const t of frag.tables) {
      const quoted = /[A-Z]/.test(t) ? `"${t}"` : t;
      assert.match(frag.sql, new RegExp(`create table if not exists ${quoted.replace(/"/g, '"')}`), `${id}: ${t}`);
    }
    assert.doesNotMatch(frag.sql, /drop |truncate |delete /i, `${id}: creation only`);
  }
});

test('the reserved-word landmine stays quoted', () => {
  // Dates.end broke the very first generated migration — regression-pin it.
  assert.match(PLUGIN_SCHEMAS.events.sql, /"end" timestamptz/);
});
