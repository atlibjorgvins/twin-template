// Provision a plugin's tables in a Supabase vault — automatically, without
// weakening the security model.
//
// The rule stands: only the SECRET (service_role) key may perform DDL. The
// setup SQL ships twin_apply_schema(ddl), a security-definer function whose
// EXECUTE is granted to service_role alone — the same power the dashboard's
// SQL editor already gives that key, now callable by twin. On a device that
// holds the vault's admin key (Settings → Vaults → Members), enabling a
// plugin applies its schema in one round trip; on any other device the
// plugin reports, honestly, that the vault's admin needs to open it once.
//
// Local vaults are schemaless (IndexedDB) and Directus vaults have their own
// provisioning scripts — both return 'not-needed' here.

// Explicit .ts extensions: this module is loaded by the node test runner too
// (strip-types resolves relative imports verbatim). The repo facade is
// imported LAZILY inside ensurePluginSchema — it drags $env and the adapter
// graph, which only the browser build can resolve.
import { PLUGIN_SCHEMAS } from './pluginSchemas.ts';
import { activeVault } from './vaults.ts';

export type SchemaSyncResult =
  | 'not-needed' // wrong backend, unknown plugin, or tables already exist
  | 'applied' // tables created (and policies set) just now
  | 'no-admin-key'; // schema missing but this device cannot apply it

/** The vault-flavor policy block for a set of tables — the same shape the
 *  setup SQL uses, parameterized on managed (authenticated) vs personal
 *  (anon). Exported for the unit tests. */
export function policySql(tables: string[], managed: boolean): string {
  const role = managed ? 'authenticated' : 'anon';
  const name = managed ? 'twin_members_all' : 'twin_anon_all';
  const list = tables.map((t) => `'${t}'`).join(',');
  return `do $$
declare t text;
begin
  foreach t in array array[${list}]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists ${name} on %I', t);
    execute format('create policy ${name} on %I for all to ${role} using (true) with check (true)', t);
  end loop;
end $$;`;
}

/** The full DDL a plugin needs in a given vault flavor: its tables, the
 *  shared tag tables (chips appear on core pages too), and the policies. */
export function pluginDdl(pluginId: string, managed: boolean): string | null {
  const frag = PLUGIN_SCHEMAS[pluginId];
  if (!frag) return null;
  const tags = PLUGIN_SCHEMAS['core-tags'];
  const tables = [...new Set([...tags.tables, ...frag.tables])];
  return [tags.sql, frag.sql, policySql(tables, managed)].join('\n\n');
}

/** Does the plugin's first table exist? PostgREST answers 404 (PGRST205,
 *  "could not find the table") for a missing one; ANY other answer — 200,
 *  RLS-empty, even 401 — proves the table is known to the API. */
async function tableMissing(url: string, anonKey: string, table: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${url.replace(/\/+$/, '')}/rest/v1/${encodeURIComponent(table)}?select=id&limit=1`,
      { headers: { apikey: anonKey } }
    );
    return res.status === 404 || res.status === 406;
  } catch {
    // Unreachable ≠ missing — never trigger DDL over a network blip.
    return false;
  }
}

/** Ensure the active vault has the tables `pluginId` needs. Call when a
 *  plugin is enabled (toggleFlow) or when a plugin page hits a missing
 *  table. Returns what happened; throws only when an APPLY was attempted
 *  and the server refused it. */
export async function ensurePluginSchema(pluginId: string): Promise<SchemaSyncResult> {
  const { activeBackend } = await import('./index');
  if (activeBackend !== 'supabase') return 'not-needed';
  const v = activeVault();
  const frag = PLUGIN_SCHEMAS[pluginId];
  if (!frag || !v.supabaseUrl || !v.supabaseKey) return 'not-needed';

  if (!(await tableMissing(v.supabaseUrl, v.supabaseKey, frag.tables[0]))) return 'not-needed';
  if (!v.adminKey) return 'no-admin-key';

  const res = await fetch(`${v.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/twin_apply_schema`, {
    method: 'POST',
    headers: {
      apikey: v.adminKey,
      Authorization: `Bearer ${v.adminKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ddl: pluginDdl(pluginId, !!v.managed) })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      res.status === 404
        ? 'This vault predates in-app schema updates — paste the current setup script once (Settings → Storage → Supabase → “First time?”), then retry.'
        : `The database update was refused (${res.status}${body ? `: ${body.slice(0, 160)}` : ''}).`
    );
  }
  return 'applied';
}

/** Run arbitrary idempotent DDL through the vault's service_role RPC. Shared
 *  by the plugin and audit apply paths. */
async function applyDdl(url: string, adminKey: string, ddl: string): Promise<void> {
  const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/twin_apply_schema`, {
    method: 'POST',
    headers: {
      apikey: adminKey,
      Authorization: `Bearer ${adminKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ddl })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      res.status === 404
        ? 'This vault predates in-app schema updates — paste the current setup script once (Settings → Storage → Supabase → “First time?”), then retry.'
        : `The database update was refused (${res.status}${body ? `: ${body.slice(0, 160)}` : ''}).`
    );
  }
}

/** Turn on change history (audit log + triggers) for the active managed
 *  vault. Admin-only — needs the vault's service_role key, like any schema
 *  change. Idempotent: re-running re-attaches triggers (picking up new
 *  tables). Returns whether it applied or why not. */
export async function ensureAuditSchema(): Promise<SchemaSyncResult> {
  const { activeBackend } = await import('./index');
  if (activeBackend !== 'supabase') return 'not-needed';
  const v = activeVault();
  if (!v.supabaseUrl || !v.supabaseKey) return 'not-needed';
  if (!v.adminKey) return 'no-admin-key';
  const { auditSql } = await import('./auditSchema');
  await applyDdl(v.supabaseUrl, v.adminKey, auditSql());
  return 'applied';
}

/** Is the change-history table present in the active vault? */
export async function auditAvailable(): Promise<boolean> {
  const { activeBackend } = await import('./index');
  if (activeBackend !== 'supabase') return false;
  const v = activeVault();
  if (!v.supabaseUrl || !v.supabaseKey) return false;
  return !(await tableMissing(v.supabaseUrl, v.supabaseKey, 'twin_audit'));
}

/** Turn on per-user permissions (roles enforced by RLS) for the active
 *  managed vault. Admin-only (service_role key). Idempotent; seeds existing
 *  members as admin so no one is locked out. */
export async function ensurePermissionsSchema(): Promise<SchemaSyncResult> {
  const { activeBackend } = await import('./index');
  if (activeBackend !== 'supabase') return 'not-needed';
  const v = activeVault();
  if (!v.supabaseUrl || !v.supabaseKey) return 'not-needed';
  if (!v.adminKey) return 'no-admin-key';
  const { permissionsSql } = await import('./permissionsSchema');
  await applyDdl(v.supabaseUrl, v.adminKey, permissionsSql());
  return 'applied';
}

/** Are per-user permissions enabled (the twin_member table exists)? */
export async function permissionsAvailable(): Promise<boolean> {
  const { activeBackend } = await import('./index');
  if (activeBackend !== 'supabase') return false;
  const v = activeVault();
  if (!v.supabaseUrl || !v.supabaseKey) return false;
  return !(await tableMissing(v.supabaseUrl, v.supabaseKey, 'twin_member'));
}

/** The message for 'no-admin-key', shared by the surfaces that show it. */
export const NEEDS_ADMIN_MESSAGE =
  'This plugin needs tables this vault does not have yet. The vault admin can add them by ' +
  'enabling the plugin once on their device (twin applies the schema automatically), or by ' +
  'pasting the plugin’s setup SQL in the Supabase SQL editor.';
