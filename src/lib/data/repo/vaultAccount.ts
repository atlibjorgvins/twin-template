// A managed-vault MEMBER acting on their own account — no admin key needed.
//
// The Members screen (vaultAdmin.ts) is the admin's tool and needs the secret
// service_role key. This is the other half: what an ordinary member may do to
// themselves, authorized by their own signed-in session. Today that's
// changing their own password — the temp password an admin issues is meant to
// be replaced, and until now only an admin could reset it.
//
// A fresh supabase-js client restores the member's persisted session for this
// project (same origin, same storage key), so updateUser runs as them under
// Supabase Auth — the anon key is only the address.

import { activeVault } from './vaults';

/** Change the signed-in member's own password on the active managed vault. */
export async function changeOwnPassword(newPassword: string): Promise<void> {
  const v = activeVault();
  if (!v.managed || !v.supabaseUrl || !v.supabaseKey) {
    throw new Error('Changing your password is only available in a managed team vault.');
  }
  if (newPassword.length < 8) {
    throw new Error('Use at least 8 characters.');
  }
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(v.supabaseUrl, v.supabaseKey);
  const {
    data: { user }
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Your session has expired — sign out and back in, then try again.');
  }
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) {
    throw new Error(
      /weak|short|least/i.test(error.message)
        ? 'That password was rejected as too weak — try a longer one.'
        : error.message
    );
  }
}
