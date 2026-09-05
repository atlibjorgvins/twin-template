import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionsSql, ROLES } from './permissionsSchema.ts';

test('ROLES are viewer/editor/admin in ascending capability', () => {
  assert.deepEqual([...ROLES], ['viewer', 'editor', 'admin']);
});

test('permissionsSql: read for all, write gated by twin_can_write', () => {
  const sql = permissionsSql();
  assert.match(sql, /create table if not exists twin_member/);
  assert.match(sql, /for select to authenticated using \(true\)/, 'members read');
  assert.match(sql, /for insert to authenticated with check \(twin_can_write\(\)\)/);
  assert.match(sql, /for delete to authenticated using \(twin_can_write\(\)\)/);
  // Old all-in-one policy is removed so writes actually narrow.
  assert.match(sql, /drop policy if exists twin_members_all/);
});

test('permissionsSql: only admins may change the roster, and it self-seeds', () => {
  const sql = permissionsSql();
  assert.match(sql, /twin_member_admin_write.*for all to authenticated/s);
  assert.match(sql, /using \(twin_is_admin\(\)\)/);
  assert.match(sql, /insert into twin_member[\s\S]*from auth\.users[\s\S]*on conflict \(user_id\) do nothing/);
});

test('permissionsSql: role functions are security definer (read twin_member under any RLS)', () => {
  const sql = permissionsSql();
  for (const fn of ['twin_can_write', 'twin_is_admin', 'twin_role']) {
    assert.match(sql, new RegExp(`create or replace function ${fn}\\(\\)[\\s\\S]*?security definer`), fn);
    assert.match(sql, new RegExp(`grant execute on function ${fn}\\(\\) to authenticated`), fn);
  }
});
