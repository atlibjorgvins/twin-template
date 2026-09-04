<script lang="ts">
  // Settings → Vaults. A vault is a saved connection — your personal data on
  // this device, a Supabase project, a team's Directus server. The client
  // holds several; one is active per page load; switching reloads (the repo
  // singleton rule). This is phase 5 of docs/opening-up-twin.md, model (a):
  // "a workspace is an instance; the client holds several connections."
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import Icon from '$lib/Icon.svelte';
  import StorageChooser from '$lib/StorageChooser.svelte';
  import { vaults, activeVault, addVault, removeVault, bindVaultScope, type Vault } from '$lib/data/repo/vaults';
  import { switchVault } from '$lib/vaultSwitch';
  import { checkSupabaseConn, connCheckMessage, normalizeSupabaseUrl, normalizeSupabaseKey } from '$lib/data/repo/validate';
  import { unifiedEnabled, setUnifiedEnabled, foreignReadableVaults } from '$lib/data/repo/crossVault';
  import { activeBackend, auth, type BackendId } from '$lib/data/repo';

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

  // Bind a vault to one side of the Work/Private toggle: clicking that side
  // in the top bar then OPENS this vault, and new records tagged with that
  // scope default here. Exclusive per side (bindVaultScope unbinds the
  // previous holder), so re-read the whole list after every change.
  function setBinding(id: string, value: string) {
    bindVaultScope(id, value === 'work' || value === 'private' ? value : undefined);
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
        <label class="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-400" title="Bind this vault to one side of the Work/Private toggle — clicking that side opens this vault">
          <span class="hidden sm:inline">Opens on</span>
          <select class="input px-2 py-1 text-xs" value={v.boundScope ?? ''}
                  onchange={(e) => setBinding(v.id, (e.currentTarget as HTMLSelectElement).value)}>
            <option value="">—</option>
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
