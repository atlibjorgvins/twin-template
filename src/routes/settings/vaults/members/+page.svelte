<script lang="ts">
  // Settings → Vaults → Members — the admin surface for a MANAGED vault.
  // Invite, remove, ban and reset passwords WITHOUT the Supabase dashboard:
  // the admin pastes the project's secret key once (stored in this device's
  // vault entry only) and twin talks to the auth admin API directly.
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import Icon from '$lib/Icon.svelte';
  import { activeVault, updateActiveVault } from '$lib/data/repo/vaults';
  import {
    listMembers, createMember, setBanned, resetPassword, deleteMember,
    isBanned, tempPassword, type VaultMember, type AdminConn
  } from '$lib/data/repo/vaultAdmin';

  const vault = activeVault();

  // Mark the admin's own row "you". The signed-in member's email comes from
  // the vault session (not the admin key), so a fresh probe is enough.
  let myEmail = $state('');
  $effect(() => {
    if (!usable) return;
    import('$lib/data/repo')
      .then(({ auth }) => auth.me<{ email?: string }>(['id', 'email']))
      .then((u) => { myEmail = (u?.email ?? '').toLowerCase(); })
      .catch(() => { myEmail = ''; });
  });
  const usable = !!(vault.managed && vault.supabaseUrl);

  let keyInput = $state('');
  let adminKey = $state(vault.adminKey ?? '');
  const conn = $derived<AdminConn | null>(
    usable && adminKey ? { url: vault.supabaseUrl!, serviceKey: adminKey } : null
  );

  let members = $state<VaultMember[]>([]);
  let loading = $state(false);
  let error = $state('');

  async function refresh(c: AdminConn) {
    loading = true;
    error = '';
    try {
      members = await listMembers(c);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  // Unlock = prove the key works by listing, THEN persist it. A mistyped or
  // anon key never gets saved.
  let unlocking = $state(false);
  async function unlock(e: Event) {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key || unlocking) return;
    unlocking = true;
    error = '';
    try {
      members = await listMembers({ url: vault.supabaseUrl!, serviceKey: key });
      adminKey = key;
      updateActiveVault({ adminKey: key });
      keyInput = '';
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : String(e2);
    } finally {
      unlocking = false;
    }
  }

  function forgetKey() {
    adminKey = '';
    members = [];
    updateActiveVault({ adminKey: undefined });
  }

  // ── Invite ────────────────────────────────────────────────────────────────
  let newEmail = $state('');
  let newPassword = $state(tempPassword());
  let inviting = $state(false);
  // The one-time credential card for the member just created (or reset).
  let issued = $state<{ email: string; password: string } | null>(null);
  let copiedCred = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function invite(e: Event) {
    e.preventDefault();
    if (!conn || inviting || !newEmail.trim()) return;
    inviting = true;
    error = '';
    try {
      await createMember(conn, newEmail.trim(), newPassword);
      issued = { email: newEmail.trim(), password: newPassword };
      newEmail = '';
      newPassword = tempPassword();
      await refresh(conn);
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : String(e2);
    } finally {
      inviting = false;
    }
  }

  async function copyIssued() {
    if (!issued) return;
    const text = `Vault: ${vault.name}\nURL: ${vault.supabaseUrl}\nEmail: ${issued.email}\nTemporary password: ${issued.password}`;
    try {
      await navigator.clipboard.writeText(text);
      copiedCred = true;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copiedCred = false), 1600);
    } catch {
      /* clipboard blocked — the card still shows the values to copy by hand */
    }
  }

  // ── Per-member actions ────────────────────────────────────────────────────
  let busyId = $state('');
  let confirmDelete = $state('');

  async function act(id: string, fn: () => Promise<unknown>) {
    if (!conn || busyId) return;
    busyId = id;
    error = '';
    try {
      await fn();
      await refresh(conn);
    } catch (e2) {
      error = e2 instanceof Error ? e2.message : String(e2);
    } finally {
      busyId = '';
    }
  }

  const toggleBan = (m: VaultMember) => act(m.id, () => setBanned(conn!, m.id, !isBanned(m)));
  const remove = (m: VaultMember) => {
    confirmDelete = '';
    return act(m.id, () => deleteMember(conn!, m.id));
  };
  const reissue = (m: VaultMember) => {
    const pw = tempPassword();
    return act(m.id, async () => {
      await resetPassword(conn!, m.id, pw);
      issued = { email: m.email ?? m.id, password: pw };
    });
  };

  function fmtDate(iso?: string | null): string {
    if (!iso) return 'never';
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toLocaleDateString() : 'never';
  }

  $effect(() => {
    if (conn) refresh(conn);
  });
</script>

<svelte:head><title>Members · {vault.name} · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Members"
    subtitle={`Who can open “${vault.name}”. Invite and remove people right here — no Supabase dashboard needed.`}
  />

  {#if !usable}
    <div class="card p-4 text-sm text-ink-500">
      This page manages a <span class="font-medium">managed team vault</span>, and the vault
      that is open right now isn't one. Open a managed vault under
      <a href="/settings/vaults" class="underline">Settings → Vaults</a> first.
    </div>
  {:else if !adminKey}
    <!-- Admin unlock: one paste, once, per device. ────────────────────── -->
    <form onsubmit={unlock} class="card space-y-3 p-4">
      <p class="text-sm text-ink-700">
        <span class="font-medium">Admins only.</span> To manage members from inside twin, paste
        this project's <span class="font-medium">secret key</span>. Find it in the
        <a href={`https://supabase.com/dashboard/project/_/settings/api-keys`} target="_blank" rel="noreferrer" class="underline">Supabase dashboard</a>
        under Project Settings → API keys → <span class="font-mono text-xs">service_role</span> — one copy, one paste, never again.
      </p>
      <label class="block">
        <span class="mb-1 block text-xs text-ink-400">Secret (service_role) key</span>
        <input type="password" class="input w-full" placeholder="paste the service_role secret…" bind:value={keyInput} autocomplete="off" />
      </label>
      <p class="text-[11px] text-ink-400">
        This key can read and write everything in the vault, which is what makes it admin-only.
        It is kept on this device and sent nowhere except your own Supabase project. Members
        never need it — they just sign in.
      </p>
      {#if error}<p class="text-xs" style="color: var(--state-danger);">{error}</p>{/if}
      <button type="submit" disabled={unlocking || !keyInput.trim()}
              class="px-5 py-2 font-display text-sm font-medium"
              style={`background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md); opacity: ${keyInput.trim() && !unlocking ? 1 : 0.4};`}>
        {unlocking ? 'Checking…' : 'Unlock member admin'}
      </button>
    </form>
  {:else}
    <!-- Invite ─────────────────────────────────────────────────────────── -->
    <form onsubmit={invite} class="card space-y-3 p-4">
      <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">Invite a member</div>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-xs text-ink-400">Email</span>
          <input type="email" class="input w-full" placeholder="coworker@company.com" bind:value={newEmail} />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-ink-400">Temporary password (generated)</span>
          <input type="text" class="input w-full font-mono" bind:value={newPassword} />
        </label>
      </div>
      <p class="text-[11px] text-ink-400">
        Creating the account activates it immediately — hand the email + temporary password to
        the person and ask them to change it. They join by adding this vault (URL + anon key,
        “Managed team vault” ticked) and signing in.
      </p>
      {#if error}<p class="text-xs" style="color: var(--state-danger);">{error}</p>{/if}
      <button type="submit" disabled={inviting || !newEmail.trim()}
              class="px-5 py-2 font-display text-sm font-medium"
              style={`background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md); opacity: ${newEmail.trim() && !inviting ? 1 : 0.4};`}>
        {inviting ? 'Creating…' : 'Create member'}
      </button>
    </form>

    {#if issued}
      <!-- Shown once; gone on navigation. The only place the password exists. -->
      <div class="card space-y-2 p-4" style="border-color: var(--accent-electric);">
        <div class="font-display text-[10px] uppercase tracking-wider" style="color: var(--accent-electric);">Hand these over</div>
        <p class="text-sm text-ink-700">
          <span class="font-medium">{issued.email}</span> can now sign in with the temporary
          password <span class="font-mono text-xs">{issued.password}</span>. This is shown only once.
        </p>
        <div class="flex gap-2">
          <button type="button" onclick={copyIssued}
                  class="rounded-[10px] border border-surface-border px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-surface-hover">
            {copiedCred ? 'Copied ✓' : 'Copy join details'}
          </button>
          <button type="button" onclick={() => (issued = null)}
                  class="rounded-[10px] px-3 py-1.5 text-xs text-ink-500 hover:text-ink-900">Done</button>
        </div>
      </div>
    {/if}

    <!-- The members ────────────────────────────────────────────────────── -->
    <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
      {#if loading && members.length === 0}
        <li class="px-4 py-3 text-sm text-ink-400">Loading members…</li>
      {/if}
      {#each members as m (m.id)}
        {@const banned = isBanned(m)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center"
                style={`border-radius: var(--radius-md); background: var(--bg-tertiary); color: ${banned ? 'var(--state-danger)' : 'var(--text-secondary)'};`}>
            <Icon name="users" size={16} />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium text-ink-900">{m.email ?? m.id}</span>
              {#if myEmail && m.email && m.email.toLowerCase() === myEmail}
                <span class="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                      style="background: var(--accent-alpha-10); color: var(--accent-electric);">you</span>
              {/if}
              {#if banned}
                <span class="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                      style="background: var(--state-danger); color: white;">banned</span>
              {/if}
            </div>
            <div class="text-xs text-ink-500">
              joined {fmtDate(m.created_at)} · last sign-in {fmtDate(m.last_sign_in_at)}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button type="button" onclick={() => reissue(m)} disabled={busyId === m.id}
                    class="rounded-[10px] border border-surface-border px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-surface-hover"
                    title="Issue a fresh temporary password">
              Reset password
            </button>
            <button type="button" onclick={() => toggleBan(m)} disabled={busyId === m.id}
                    class="rounded-[10px] border border-surface-border px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-surface-hover">
              {busyId === m.id ? '…' : banned ? 'Unban' : 'Ban'}
            </button>
            {#if confirmDelete === m.id}
              <button type="button" onclick={() => remove(m)}
                      class="rounded-[10px] px-3 py-1.5 text-xs font-medium"
                      style="background: var(--state-danger); color: white;">
                Really remove?
              </button>
            {:else}
              <button type="button" onclick={() => (confirmDelete = m.id)} disabled={busyId === m.id}
                      class="rounded-[10px] border border-surface-border px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-surface-hover">
                Remove
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <p class="px-1 text-[11px] text-ink-400">
      Banning or removing someone locks them out at their next sign-in or token refresh — a
      session that is already open can live up to the token lifetime (1&nbsp;hour by default;
      shorten it under the project's Auth settings for faster revocation). Rows they created stay.
    </p>

    <button type="button" onclick={forgetKey}
            class="text-xs text-ink-400 underline hover:text-ink-700"
            title="Remove the secret key from this device; members are untouched">
      Forget the admin key on this device
    </button>
  {/if}
</section>
