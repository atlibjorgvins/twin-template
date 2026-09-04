// Prove a Supabase connection BEFORE it is saved as a vault.
//
// Born from a real support afternoon: a mis-pasted anon key produced a vault
// that stored fine, showed a green dot, and then turned every sign-in into
// "email and password did not match" — the server was rejecting the API key,
// not the person. The cheap cure is the same pattern Members uses for the
// admin key: hit the server with the pasted values and refuse to save what
// it rejects, while the person is still looking at the paste field.
//
// The probe target is /rest/v1/ on purpose: twin's data plane is PostgREST,
// and Supabase's newer sb_publishable_* keys pass AUTH yet are refused by
// REST — verified against a live project — so probing auth would bless a key
// the app cannot actually read rows with. Only a REST-accepted key is a
// working twin key (the legacy "anon" JWT under Legacy API keys).

export type ConnCheck = 'ok' | 'bad-key' | 'unreachable';

/** Classify a probe response status. Exported for the unit tests. */
export function classifyStatus(status: number): ConnCheck {
  // 401/403 = the gateway rejected the key itself. Anything else the server
  // answered with (200, 404, even 500) proves the key was accepted.
  return status === 401 || status === 403 ? 'bad-key' : 'ok';
}

/** One round trip: does this project accept this key on the data plane? */
export async function checkSupabaseConn(url: string, key: string): Promise<ConnCheck> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/`, {
      headers: { apikey: key }
    });
    return classifyStatus(res.status);
  } catch {
    return 'unreachable';
  }
}

/** The message for a failed check, shared by every surface that saves one. */
export function connCheckMessage(result: Exclude<ConnCheck, 'ok'>): string {
  return result === 'bad-key'
    ? 'The server rejected that API key. Copy the FULL "anon" key — in the Supabase dashboard it lives under Project Settings → API keys → Legacy API keys (the newer sb_publishable_… key cannot read data).'
    : 'Could not reach that project URL — check it for typos (it should look like https://abcdefgh.supabase.co) and check your connection.';
}
