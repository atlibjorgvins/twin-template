// Per-user permissions for a managed vault — enforced by Postgres RLS.
//
// Until now a managed vault's policy (twin_members_all) let any signed-in
// member read AND write everything. This adds roles: viewer / editor / admin,
// stored in twin_member and consulted by the RLS policies themselves — so a
// viewer's write is refused by the database, not merely hidden by the UI.
//
//   viewer  — read everything, change nothing
//   editor  — read + create/edit/delete records
//   admin   — editor + manage members and their roles
//
// The app reads the role to hide write controls (nice UX), but the guarantee
// is the policy: even a hand-crafted request from a viewer is rejected.
//
// Applied by an admin through the service_role RPC (schemaSync). Idempotent.
// Bootstrapping: existing members are seeded as 'admin' (on-conflict-do-
// nothing) so enabling permissions never locks anyone out of a vault they
// could already edit; the admin then downgrades people in the Members screen.
// Members added AFTER enabling default to 'editor'.

import { auditedTables } from './auditSchema.ts';

export const ROLES = ['viewer', 'editor', 'admin'] as const;
export type MemberRole = (typeof ROLES)[number];

export function permissionsSql(): string {
  // The tables whose WRITES are role-gated: the same data set the audit log
  // covers. Bookkeeping tables (plugin_sync, app_files) keep the all-members
  // policy so plugin-config sync keeps working for everyone.
  const tables = auditedTables()
    .map((t) => `'${t}'`)
    .join(',');
  return `-- twin: per-user permissions (roles enforced by RLS). Idempotent.
create table if not exists twin_member (
  user_id uuid primary key,
  email text,
  role text not null default 'editor',
  added_at timestamptz default now()
);

-- Role lookups for the policies. security definer so a policy can read
-- twin_member regardless of the caller's own RLS on it.
create or replace function twin_can_write() returns boolean
  language sql stable security definer set search_path = public as $fn$
  select coalesce((select role from twin_member where user_id = auth.uid()) in ('editor','admin'), false);
$fn$;
create or replace function twin_is_admin() returns boolean
  language sql stable security definer set search_path = public as $fn$
  select coalesce((select role from twin_member where user_id = auth.uid()) = 'admin', false);
$fn$;
create or replace function twin_role() returns text
  language sql stable security definer set search_path = public as $fn$
  select role from twin_member where user_id = auth.uid();
$fn$;
grant execute on function twin_can_write() to authenticated;
grant execute on function twin_is_admin() to authenticated;
grant execute on function twin_role() to authenticated;

-- Seed existing members as admin so nobody loses access they already had.
insert into twin_member (user_id, email, role)
  select id, email, 'admin' from auth.users
  on conflict (user_id) do nothing;

-- The roster: every member may read it (to see roles / their own); only an
-- admin may change it.
alter table twin_member enable row level security;
drop policy if exists twin_member_read on twin_member;
create policy twin_member_read on twin_member for select to authenticated using (true);
drop policy if exists twin_member_admin_write on twin_member;
create policy twin_member_admin_write on twin_member for all to authenticated
  using (twin_is_admin()) with check (twin_is_admin());

-- Rewrite each data table: read for all members, write for editors/admins.
do $$
declare t text;
begin
  foreach t in array array[${tables}]
  loop
    if not exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      continue;
    end if;
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists twin_members_all on %I', t);
    execute format('drop policy if exists twin_read on %I', t);
    execute format('drop policy if exists twin_write_ins on %I', t);
    execute format('drop policy if exists twin_write_upd on %I', t);
    execute format('drop policy if exists twin_write_del on %I', t);
    execute format('create policy twin_read on %I for select to authenticated using (true)', t);
    execute format('create policy twin_write_ins on %I for insert to authenticated with check (twin_can_write())', t);
    execute format('create policy twin_write_upd on %I for update to authenticated using (twin_can_write()) with check (twin_can_write())', t);
    execute format('create policy twin_write_del on %I for delete to authenticated using (twin_can_write())', t);
  end loop;
end $$;
`;
}
