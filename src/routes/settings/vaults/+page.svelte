<script lang="ts">
  // Settings → Vaults. A vault is a saved connection — your personal data on
  // this device, a Supabase project, a team's Directus server. The client
  // holds several; one is active per page load; switching reloads (the repo
  // singleton rule). This is phase 5 of docs/opening-up-twin.md, model (a):
  // "a workspace is an instance; the client holds several connections."
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import Icon from '$lib/Icon.svelte';
  import StorageChooser from '$lib/StorageChooser.svelte';
  import { vaults, activeVault, addVault, removeVault, setVaultWorld, vaultWorld, type Vault } from '$lib/data/repo/vaults';
  import { switchVault } from '$lib/vaultSwitch';
  import { checkSupabaseConn, connCheckMessage, normalizeSupabaseUrl, normalizeSupabaseKey } from '$lib/data/repo/validate';
  import { unifiedEnabled, setUnifiedEnabled, foreignReadableVaults } from '$lib/data/repo/crossVault';
  import { inviteLink } from '$lib/data/repo/vaultInvite';

  // Copy a shareable invite link for a managed vault so a coworker joins
  // without hand-typing the URL + anon key. Carries no password/admin key.
  let invited = $state<string | null>(null);
  let inviteTimer: ReturnType<typeof setTimeout> | undefined;
  async function copyInvite(v: Vault) {
    if (!v.supabaseUrl || !v.supabaseKey) return;
    const link = inviteLink(location.origin, {
      name: v.name,
      supabaseUrl: v.supabaseUrl,
      supabaseKey: v.supabaseKey,
      managed: !!v.managed
    });
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      ta.remove();
    }
    invited = v.id;
    clearTimeout(inviteTimer);
    inviteTimer = setTimeout(() => (invited = null), 1800);
  }
  import { activeBackend, auth, type BackendId } from '$lib/data/repo';
  import { changeOwnPassword } from '$lib/data/repo/vaultAccount';

  // A member changing their OWN password (no admin key). Shown for the active
  // managed vault — the temp password an admin issues is meant to be replaced.
  let pwOpen = $state(false);
  let pwValue = $state('');
  let pwBusy = $state(false);
  let pwError = $state('');
  let pwDone = $state(false);
  async function submitPassword() {
    if (pwBusy || pwValue.length < 8) return;
    pwBusy = true;
    pwError = '';
    pwDone = false;
    try {
      await changeOwnPassword(pwValue);
      pwValue = '';
      pwDone = true;
      pwOpen = false;
    } catch (e) {
      pwError = e instanceof Error ? e.message : String(e);
    } finally {
      pwBusy = false;
    }
  }

  // Managed vault: end the member session. The guard then routes to
  // /vault-login on the next navigation.
  let signingOut = $state(false);
  async function signOutVault() {
    if (signingOut) return;
    signingOut = true;
    try {
      await auth.logout();
    } finally {
      window.location.href = '/';
    }
  }

  const BACKEND_LABEL: Record<BackendId, string> = {
    local: 'this device',
    supabase: 'Supabase',
    directus: 'Directus'
  };
  function backendLabel(v: Vault): string {
    if (v.backend) return BACKEND_LABEL[v.backend];
    return v.id === activeVault().id ? BACKEND_LABEL[activeBackend] : 'build default';
  }

  let all = $state(vaults());
  const active = activeVault();
  const hasForeign = foreignReadableVaults().length > 0;
  let unified = $state(unifiedEnabled());

  function open(id: string) {
    if (id === active.id) return;
    const v = all.find((x) => x.id === id);
    // A vault swap re-points the whole module graph — full load, behind the
    // switch curtain.
    switchVault(id, v?.name ?? 'vault');
  }

  let confirmRemove = $state<string | null>(null);
  function doRemove(id: string) {
    if (removeVault(id)) all = vaults();
    confirmRemove = null;
  }

  // Flag a vault's WORLD. The Work/Private toggle then shows every work vault
  // together (and every private vault together); 'both' appears under either.
  // Not exclusive — a team and a side-project can both be 'work'.
  function setWorld(id: string, value: string) {
    setVaultWorld(id, value === 'work' || value === 'private' ? value : 'both');
    all = vaults();
  }

  // ── Add a vault ──────────────────────────────────────────────────────────
  let adding = $state(false);
  let name = $state('');
  let kind = $state<'personal' | 'workspace'>('workspace');
  let backendPick = $state<BackendId>('directus');
  let sbUrl = $state('');
  let sbKey = $state('');
  let dxUrl = $state('');
  let dxToken = $state('');
  let sbManaged = $state(false);
  const valid = $derived(
    name.trim().length > 0 &&
      (backendPick === 'local' ||
        (backendPick === 'supabase' && sbUrl.trim().length > 0 && sbKey.trim().length > 0) ||
        (backendPick === 'directus' && dxUrl.trim().length > 0))
  );

  // A Supabase vault is probed BEFORE it is saved — a mis-pasted key used to
  // store fine and then masquerade as a login failure. Refuse it here, while
  // the paste field is still on screen.
  let addBusy = $state(false);
  let addError = $state('');
  async function create() {
    if (!valid || addBusy) return;
    addError = '';
    if (backendPick === 'supabase') {
      addBusy = true;
      const check = await checkSupabaseConn(sbUrl.trim(), sbKey.trim());
      addBusy = false;
      if (check !== 'ok') {
        addError = connCheckMessage(check);
        return;
      }
    }
    const v = addVault({
      name: name.trim(),
      kind,
      backend: backendPick,
      ...(backendPick === 'directus'
        ? { directusUrl: dxUrl.trim(), ...(dxToken.trim() ? { directusToken: dxToken.trim() } : {}) }
        : {}),
      ...(backendPick === 'supabase'
        ? {
            // Save the NORMALIZED values — the vault must hold what the probe
            // just blessed, not the raw paste (wrapped keys, dashboard URLs).
            supabaseUrl: normalizeSupabaseUrl(sbUrl),
            supabaseKey: normalizeSupabaseKey(sbKey),
            ...(sbManaged ? { managed: true } : {})
          }
        : {})
    });
    switchVault(v.id, v.name);
  }
</script>

<svelte:head><title>Vaults · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Vaults"
    subtitle="Every vault is its own world of people and organizations — your personal one, a team's server, a project's Supabase. Switch any time; nothing mixes."
  />

  <!-- Unified browsing (the 1Password model) ────────────────────────── -->
  {#if hasForeign}
    <label class="flex items-start gap-3 rounded-[14px] border border-surface-border bg-surface-card p-4">
      <input type="checkbox" class="mt-0.5 h-4 w-4" bind:checked={unified} onchange={() => setUnifiedEnabled(unified)} />
      <span class="text-sm text-ink-700">
        <span class="font-medium text-ink-900">See all vaults together</span> — in the
        <span class="font-medium">All</span> view, People and Organizations show every vault's
        records at once, each tagged with its vault. Opening one from another vault switches into
        it. Turn this off to see only the vault you're in.
      </span>
    </label>
  {/if}

  <!-- The vaults on this device ─────────────────────────────────────── -->
  <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
    {#each all as v (v.id)}
      {@const isActive = v.id === active.id}
      <li class="flex items-center gap-3 px-4 py-3">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center"
              style={`border-radius: var(--radius-md); background: ${isActive ? 'var(--accent-alpha-10)' : 'var(--bg-tertiary)'}; color: ${isActive ? 'var(--accent-electric)' : 'var(--text-secondary)'};`}>
          <Icon name={v.kind === 'workspace' ? 'building' : 'lock'} size={16} />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="font-medium text-ink-900">{v.name}</span>
            <span class="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                  style="background: var(--bg-tertiary); color: var(--text-tertiary);">{v.kind}</span>
            {#if v.managed}
              <span class="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                    style="background: var(--accent-alpha-10); color: var(--accent-electric);">managed</span>
            {/if}
            {#if isActive}
              <span class="text-[10px] uppercase tracking-wider" style="color: var(--accent-electric);">current</span>
            {/if}
          </div>
          <div class="truncate text-xs text-ink-500">
            {backendLabel(v)}{#if v.directusUrl} · {v.directusUrl}{:else if v.supabaseUrl} · {v.supabaseUrl}{/if}
          </div>
        </div>
        <label class="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-400" title="Which world this vault belongs to — the Work/Private toggle groups vaults by this">
          <span class="hidden sm:inline">World</span>
          <select class="input px-2 py-1 text-xs" value={vaultWorld(v)}
                  onchange={(e) => setWorld(v.id, (e.currentTarget as HTMLSelectElement).value)}>
            <option value="both">Both</option>
            <option value="work">Work</option>
            <option value="private">Private</option>
          </select>
        </label>
        {#if isActive && v.managed}
          <a href="/settings/vaults/members"
             class="shrink-0 rounded-[10px] px-3 py-1.5 text-xs font-medium"
             style="background: var(--accent-electric); color: var(--accent-text);">
            Members
          </a>
          <a href="/history"
             class="shrink-0 rounded-[10px] border border-surface-border px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-surface-hover">
            History
          </a>
          <button type="button" onclick={() => copyInvite(v)}
                  class="shrink-0 rounded-[10px] border border-surface-border px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-surface-hover"
                  title="Copy a link that lets a coworker join this vault without typing the URL and key">
            {invited === v.id ? 'Copied ✓' : 'Invite'}
          </button>
          <button type="button" onclick={() => { pwOpen = !pwOpen; pwError = ''; pwDone = false; }}
                  class="shrink-0 rounded-[10px] border border-surface-border px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-surface-hover">
            Password
          </button>
          <button type="button" onclick={signOutVault} disabled={signingOut}
                  class="shrink-0 rounded-[10px] border border-surface-border px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-surface-hover">
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        {/if}
        {#if !isActive}
          <button type="button"
                  onclick={() => open(v.id)}
                  class="shrink-0 rounded-[10px] px-3 py-1.5 text-xs font-medium"
                  style="background: var(--accent-electric); color: var(--accent-text);">
            Open
          </button>
          {#if confirmRemove === v.id}
            <button type="button" onclick={() => doRemove(v.id)}
                    class="shrink-0 rounded-[10px] px-3 py-1.5 text-xs font-medium"
                    style="background: var(--state-danger); color: white;">
              Really remove?
            </button>
          {:else}
            <button type="button" onclick={() => (confirmRemove = v.id)}
                    class="shrink-0 rounded-[10px] border border-surface-border px-3 py-1.5 text-xs font-medium text-ink-500 hover:bg-surface-hover"
                    title="Remove this vault from the list (its data is not deleted)">
              Remove
            </button>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
  <p class="px-1 text-[11px] text-ink-400">
    Removing a vault only forgets the connection on this device — no data is deleted. A local
    vault's rows stay in this app's storage; a server vault's rows stay on its server.
  </p>

  {#if pwOpen}
    <form class="card space-y-3 p-4" onsubmit={(e) => { e.preventDefault(); submitPassword(); }}>
      <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">Change your password</div>
      <p class="text-xs text-ink-500">Sets a new password for your account on this team vault. Use at least 8 characters.</p>
      <input type="password" class="input w-full" placeholder="New password" autocomplete="new-password"
             bind:value={pwValue} />
      {#if pwError}<p class="text-xs" style="color: var(--state-danger);">{pwError}</p>{/if}
      <div class="flex items-center gap-3">
        <button type="submit" disabled={pwBusy || pwValue.length < 8}
                class="px-5 py-2 font-display text-sm font-medium"
                style={`background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md); opacity: ${pwBusy || pwValue.length < 8 ? 0.4 : 1};`}>
          {pwBusy ? 'Saving…' : 'Save password'}
        </button>
        <button type="button" class="text-sm text-ink-500 hover:text-ink-900" onclick={() => (pwOpen = false)}>Cancel</button>
      </div>
    </form>
  {/if}
  {#if pwDone}
    <p class="px-1 text-xs" style="color: var(--state-success, #16a34a);">Password changed. Use it next time you sign in.</p>
  {/if}

  <!-- Join / create ─────────────────────────────────────────────────── -->
  {#if !adding}
    <button type="button" onclick={() => (adding = true)}
            class="flex items-center gap-2 px-4 py-2 font-display text-sm font-medium"
            style="background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md);">
      <Icon name="plus" size={14} /> Add a vault
    </button>
  {:else}
    <fieldset class="card p-4 space-y-3" aria-label="Add a vault">
      <legend class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400">New vault</legend>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-xs text-ink-400">Name</span>
          <input type="text" class="input w-full" placeholder="e.g. Work, Family, Side project" bind:value={name} />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-ink-400">Kind</span>
          <select class="input w-full" bind:value={kind}>
            <option value="workspace">Workspace — shared with a team</option>
            <option value="personal">Personal — just you</option>
          </select>
        </label>
      </div>
      <div>
        <span class="mb-1 block text-xs text-ink-400">Where its data lives</span>
        <StorageChooser bind:backendPick bind:sbUrl bind:sbKey bind:dxUrl bind:dxToken bind:sbManaged />
      </div>
      <p class="text-xs text-ink-400">
        Joining a managed team vault: ask the admin for the project URL + anon key, tick
        “Managed team vault”, and sign in with the account they created for you.
      </p>
      {#if addError}
        <p class="text-xs" style="color: var(--state-danger);">{addError}</p>
      {/if}
      <div class="flex items-center gap-3">
        <button type="button" onclick={create} disabled={!valid || addBusy}
                class="px-5 py-2 font-display text-sm font-medium transition"
                style={`background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md); opacity: ${valid && !addBusy ? 1 : 0.4};`}>
          {addBusy ? 'Checking connection…' : 'Add & open'}
        </button>
        <button type="button" onclick={() => (adding = false)}
                class="text-sm text-ink-500 hover:text-ink-900">
          Cancel
        </button>
      </div>
    </fieldset>
  {/if}
</section>
