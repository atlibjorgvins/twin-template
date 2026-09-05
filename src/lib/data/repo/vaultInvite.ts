// Vault invites — a shareable link/code that carries a managed vault's
// CONNECTION so a coworker joins without hand-typing Supabase details.
//
// What travels: the vault name, its Supabase URL, the ANON key, and the
// managed flag. Never a password, never the admin (service_role) key — the
// anon key on a managed vault opens nothing on its own (RLS denies anon), so
// it is "the address, not the key to the door." Still, an invite lets someone
// REACH the sign-in page, so share it like you'd share the URL+key: with the
// people you're inviting, not in public.
//
// Encoding is base64url of compact JSON — no secret, just tidy. Pure module
// (no DOM), unit-tested.

export interface VaultInvite {
  name: string;
  supabaseUrl: string;
  supabaseKey: string;
  managed: boolean;
}

const PREFIX = 'twinvault1:'; // versioned, so a future shape is detectable

function toB64Url(s: string): string {
  const b64 = typeof btoa !== 'undefined' ? btoa(s) : Buffer.from(s, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
}

/** Encode an invite to a compact, URL-safe code. */
export function encodeInvite(inv: VaultInvite): string {
  const compact = { n: inv.name, u: inv.supabaseUrl, k: inv.supabaseKey, m: inv.managed ? 1 : 0 };
  return PREFIX + toB64Url(JSON.stringify(compact));
}

/** Decode a code back to an invite, or null if it isn't a valid twin invite.
 *  Tolerant of a full URL (…/join#i=CODE or ?i=CODE) or the bare code. */
export function decodeInvite(raw: string): VaultInvite | null {
  if (!raw) return null;
  let code = raw.trim();
  // Pull the code out of a pasted link.
  const m = code.match(/[#?]i=([^&\s]+)/);
  if (m) code = decodeURIComponent(m[1]);
  if (!code.startsWith(PREFIX)) return null;
  try {
    const obj = JSON.parse(fromB64Url(code.slice(PREFIX.length))) as {
      n?: string;
      u?: string;
      k?: string;
      m?: number;
    };
    if (!obj.u || !obj.k) return null;
    return {
      name: obj.n || 'Team vault',
      supabaseUrl: obj.u,
      supabaseKey: obj.k,
      managed: obj.m === 1
    };
  } catch {
    return null;
  }
}

/** The full shareable link for an origin (hash, so the code never reaches a
 *  server as a query param). */
export function inviteLink(origin: string, inv: VaultInvite): string {
  return `${origin.replace(/\/+$/, '')}/join#i=${encodeInvite(inv)}`;
}
