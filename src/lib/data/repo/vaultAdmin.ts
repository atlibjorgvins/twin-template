// Member administration for MANAGED vaults — in the app, not the dashboard.
//
// A managed vault's members live in Supabase Auth, and the anon key cannot
// touch them: creating, banning and deleting users is service-role territory.
// Rather than sending admins to the Supabase dashboard for every hire and
// departure, twin talks to the GoTrue admin API directly — the admin pastes
// the project's SECRET key (Project Settings → API keys → service_role) once,
// it is stored in the vault entry on THIS device only, and Settings → Vaults →
// Members becomes the whole admin surface.
//
// The secret key bypasses row security entirely, which is exactly why only an
// admin may hold it. That is stated loudly in the UI; the model is "the admin
// device is trusted", the same trust the dashboard login already implies.
//
// Deliberately SDK-free (plain fetch), like credentials.ts: this module loads
// on a settings page only and must not drag supabase-js into any bundle.

export interface VaultMember {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
}

export interface AdminConn {
  /** The vault's Supabase project URL. */
  url: string;
  /** The project's SECRET (service_role) key — admin's device only. */
  serviceKey: string;
}

/** GoTrue admin endpoint for a project URL, tolerant of a trailing slash. */
export function adminEndpoint(baseUrl: string, path = ''): string {
  return `${baseUrl.replace(/\/+$/, '')}/auth/v1/admin/users${path}`;
}

/** Banned = a ban timestamp in the future. GoTrue reports 'none' as absence. */
export function isBanned(m: Pick<VaultMember, 'banned_until'>): boolean {
  if (!m.banned_until) return false;
  const t = Date.parse(m.banned_until);
  return Number.isFinite(t) && t > Date.now();
}

/** Effectively-forever ban (GoTrue takes a duration, not a flag). */
export const BAN_FOREVER = '876000h'; // ~100 years

/** A password the admin hands to the new member — random, unambiguous
 *  alphabet (no 0/O/1/l/I), long enough that online guessing is hopeless. */
export function tempPassword(length = 14): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Pull the members array out of a GoTrue list response (shape: {users}). */
export function parseMembers(payload: unknown): VaultMember[] {
  const users = (payload as { users?: unknown })?.users;
  if (!Array.isArray(users)) return [];
  return users.filter(
    (u): u is VaultMember => !!u && typeof u === 'object' && typeof (u as VaultMember).id === 'string'
  );
}

async function call<T>(conn: AdminConn, method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(adminEndpoint(conn.url, path), {
    method,
    headers: {
      apikey: conn.serviceKey,
      Authorization: `Bearer ${conn.serviceKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body — fall through to the status message */
  }
  if (!res.ok) {
    const j = json as { msg?: string; message?: string; error_description?: string } | null;
    const detail = j?.msg || j?.message || j?.error_description || '';
    throw new Error(
      res.status === 401 || res.status === 403
        ? `That key was rejected (${res.status}${detail ? `: ${detail}` : ''}). Members need the SECRET service_role key, not the anon key.`
        : `Supabase said no (${res.status}${detail ? `: ${detail}` : ''}).`
    );
  }
  return json as T;
}

/** All members, newest first. Also the "does this key work" probe. */
export async function listMembers(conn: AdminConn): Promise<VaultMember[]> {
  const payload = await call<unknown>(conn, 'GET', '?page=1&per_page=200');
  return parseMembers(payload).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}

/** Create a member with a known password (no SMTP needed — the admin hands
 *  the temp password over and the member should change it). */
export function createMember(conn: AdminConn, email: string, password: string): Promise<VaultMember> {
  return call<VaultMember>(conn, 'POST', '', { email, password, email_confirm: true });
}

/** Ban or unban. A live session's JWT survives until it expires (default 1h),
 *  so revocation is "at next token refresh" — the UI says so. */
export function setBanned(conn: AdminConn, id: string, banned: boolean): Promise<VaultMember> {
  return call<VaultMember>(conn, 'PUT', `/${id}`, { ban_duration: banned ? BAN_FOREVER : 'none' });
}

/** Set a new password (lost-password flow: admin issues a fresh temp one). */
export function resetPassword(conn: AdminConn, id: string, password: string): Promise<VaultMember> {
  return call<VaultMember>(conn, 'PUT', `/${id}`, { password });
}

/** Delete the member outright. Their auth account is gone; rows they created
 *  stay (user_created is a plain text column, not a foreign key). */
export function deleteMember(conn: AdminConn, id: string): Promise<void> {
  return call<void>(conn, 'DELETE', `/${id}`);
}

// ── Roles (per-user permissions — twin_member table) ────────────────────────
// These hit PostgREST (the data plane), not the auth admin API, with the
// service_role key — which bypasses RLS, so an admin can read and set any
// role. Return {} rather than throwing when twin_member doesn't exist yet
// (permissions not enabled), so the Members screen degrades quietly.

async function rest(conn: AdminConn, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${conn.url.replace(/\/+$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: conn.serviceKey,
      Authorization: `Bearer ${conn.serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
}

/** Map of user_id → role. Empty when permissions aren't enabled. */
export async function listRoles(conn: AdminConn): Promise<Record<string, string>> {
  const res = await rest(conn, 'twin_member?select=user_id,role');
  if (!res.ok) return {};
  const rows = (await res.json()) as { user_id: string; role: string }[];
  return Object.fromEntries(rows.map((r) => [r.user_id, r.role]));
}

/** Set (upsert) a member's role. Upsert so it works whether or not a row
 *  exists yet. No-op-safe on a vault without permissions (throws, caller
 *  guards on listRoles first). */
export async function setRole(
  conn: AdminConn,
  member: { id: string; email?: string },
  role: string
): Promise<void> {
  const res = await rest(conn, 'twin_member?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: member.id, email: member.email ?? null, role })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Could not set role (${res.status}${body ? `: ${body.slice(0, 120)}` : ''}).`);
  }
}
