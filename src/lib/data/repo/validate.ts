// Prove a Supabase connection BEFORE it is saved as a vault.
//
// Born from a real support afternoon: a mis-pasted anon key produced a vault
// that stored fine, showed a green dot, and then turned every sign-in into
// "email and password did not match" — the server was rejecting the API key,
// not the person. The cheap cure is the same pattern Members uses for the
// admin key: hit the server with the pasted values and refuse to save what
// it rejects, while the person is still looking at the paste field.
//
// The probe target is a TABLE endpoint, not the /rest/v1/ root: the root is
// the OpenAPI schema endpoint, and Supabase restricts it to secret keys on
// some projects — a key that reads tables perfectly gets 401 there (observed
// live). "Person" is twin's own first table; on a project that hasn't run the
// setup SQL yet PostgREST answers 404, which still proves the KEY was
// accepted — only a gateway 401/403 means the key itself is bad.

export type ConnCheck = 'ok' | 'bad-key' | 'unreachable';

// ── Paste normalization ─────────────────────────────────────────────────────
// The two real-world paste accidents, both observed in the field:
//  - a long key copied from a wrapped code block arrives with an inner line
//    break — fetch() then throws TypeError('Invalid value') BEFORE anything
//    leaves the machine, which read as "server unreachable";
//  - the DASHBOARD address (supabase.com/dashboard/project/<ref>) pasted as
//    the project URL — requests go to supabase.com and die.
// Keys never legitimately contain whitespace, so it is stripped, not policed;
// a dashboard URL carries the project ref, so the real URL is rebuilt from it.

/** Remove ALL whitespace (JWTs and sb_* keys never contain any). */
export function normalizeSupabaseKey(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/** Trim/de-space, rescue a pasted dashboard address, drop trailing slashes. */
export function normalizeSupabaseUrl(raw: string): string {
  const url = raw.replace(/\s+/g, '');
  const dash = url.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{15,})/i);
  if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;
  return url.replace(/\/+$/, '');
}

/** Classify a probe response status. Exported for the unit tests. */
export function classifyStatus(status: number): ConnCheck {
  // 401/403 = the gateway rejected the key itself. Anything else the server
  // answered with (200, 404, even 500) proves the key was accepted.
  return status === 401 || status === 403 ? 'bad-key' : 'ok';
}

/** One round trip: does this project accept this key on the data plane?
 *  Normalizes both values itself, so callers may pass raw pastes. */
export async function checkSupabaseConn(url: string, key: string): Promise<ConnCheck> {
  try {
    const res = await fetch(
      `${normalizeSupabaseUrl(url)}/rest/v1/Person?select=id&limit=1`,
      { headers: { apikey: normalizeSupabaseKey(key) } }
    );
    return classifyStatus(res.status);
  } catch {
    return 'unreachable';
  }
}

/** The message for a failed check, shared by every surface that saves one. */
export function connCheckMessage(result: Exclude<ConnCheck, 'ok'>): string {
  return result === 'bad-key'
    ? 'The server rejected that API key. Copy the FULL key from the project\'s API settings (the "anon" key under Legacy API keys, or a publishable key) and paste it as one unbroken line.'
    : 'Could not reach that project URL — check it for typos (it should look like https://abcdefgh.supabase.co) and check your connection.';
}
