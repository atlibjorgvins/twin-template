<script lang="ts">
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import Icon from '$lib/Icon.svelte';
  import {
    AI_PROVIDERS,
    AI_MODELS,
    AI_TASKS,
    createAiKey,
    deleteAiKey,
    updateAiKey,
    setAiTaskBinding,
    formatError,
    type AiKey,
    type AiTaskBinding,
    type AiProvider
  } from '$lib/directus';
  import { vault, initVault, setupVault, unlock, lock, encryptSecret } from '$lib/aiVault.svelte';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let keys = $state<AiKey[]>(data.keys);
  let bindings = $state<AiTaskBinding[]>(data.bindings);
  let error = $state('');

  onMount(() => { void initVault(); });

  // ── Vault (passphrase encryption) ────────────────────────────────────
  let pass1 = $state('');
  let pass2 = $state('');
  let remember = $state(true);
  let vaultBusy = $state(false);
  let vaultError = $state('');
  async function doSetup() {
    if (pass1.length < 8) { vaultError = 'Use at least 8 characters.'; return; }
    if (pass1 !== pass2) { vaultError = 'Passphrases don’t match.'; return; }
    vaultBusy = true; vaultError = '';
    try { await setupVault(pass1, remember); pass1 = ''; pass2 = ''; }
    catch (e) { vaultError = formatError(e); } finally { vaultBusy = false; }
  }
  async function doUnlock() {
    vaultBusy = true; vaultError = '';
    try { await unlock(pass1, remember); pass1 = ''; }
    catch (e) { vaultError = formatError(e); } finally { vaultBusy = false; }
  }

  const providerLabel = (p?: string | null) =>
    AI_PROVIDERS.find((x) => x.value === p)?.label ?? p ?? '—';

  // ── Add key ──────────────────────────────────────────────────────────
  let newLabel = $state('');
  let newProvider = $state<AiProvider>('anthropic');
  let newKeyVal = $state('');
  let newBaseUrl = $state('');
  let adding = $state(false);
  async function addKey() {
    if (!newLabel.trim() || !newKeyVal.trim() || adding || !vault.unlocked) return;
    adding = true; error = '';
    try {
      const raw = newKeyVal.trim();
      const encrypted = await encryptSecret(raw); // never store plaintext
      const created = await createAiKey({
        label: newLabel.trim(),
        provider: newProvider,
        api_key: encrypted,
        last4: raw.slice(-4),
        base_url: newProvider === 'custom' ? newBaseUrl.trim() || null : null
      });
      keys = [{ ...created, api_key: null }, ...keys];
      newLabel = ''; newKeyVal = ''; newBaseUrl = '';
    } catch (e) { error = formatError(e); } finally { adding = false; }
  }
  async function removeKey(k: AiKey) {
    if (!confirm(`Delete key "${k.label}"? Tasks bound to it will fall back to unset.`)) return;
    error = '';
    try {
      await deleteAiKey(k.id);
      keys = keys.filter((x) => x.id !== k.id);
    } catch (e) { error = formatError(e); }
  }
  async function toggleKeyStatus(k: AiKey) {
    const status = k.status === 'disabled' ? 'active' : 'disabled';
    try {
      await updateAiKey(k.id, { status });
      keys = keys.map((x) => (x.id === k.id ? { ...x, status } : x));
    } catch (e) { error = formatError(e); }
  }

  // ── Task bindings ──────────────────────────────────────────────────────
  const bindingFor = (task: string) => bindings.find((b) => b.task === task) ?? null;
  const keyById = (id?: number | null) => keys.find((k) => k.id === id) ?? null;
  // Model suggestions follow the provider of the bound key.
  function modelsForTask(task: string): string[] {
    const b = bindingFor(task);
    const k = keyById(b?.key_id);
    return k ? (AI_MODELS[(k.provider as AiProvider)] ?? []) : [];
  }

  let savingTask = $state<string | null>(null);
  async function saveBinding(task: string, patch: { key_id?: number | null; model?: string | null; enabled?: boolean }) {
    savingTask = task; error = '';
    try {
      const row = await setAiTaskBinding(task, patch);
      const idx = bindings.findIndex((b) => b.task === task);
      if (idx >= 0) bindings[idx] = row; else bindings = [...bindings, row];
    } catch (e) { error = formatError(e); } finally { savingTask = null; }
  }
  function onKeyChange(task: string, e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    void saveBinding(task, { key_id: v ? Number(v) : null });
  }
  function onModelChange(task: string, e: Event) {
    void saveBinding(task, { model: (e.currentTarget as HTMLInputElement).value.trim() || null });
  }
</script>

<svelte:head><title>AI keys & tasks · Settings · Hub</title></svelte:head>

<section class="space-y-6">
  <SettingsSubpageHeader
    title="AI keys & tasks"
    subtitle="Store provider API keys and choose which key + model each task uses. Nothing calls these yet — this is the wiring so features can pick a brain per task."
  />

  {#if error}
    <div class="rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">{error}</div>
  {/if}

  <!-- Vault: passphrase encryption -->
  <div class="rounded-[12px] border border-surface-border p-3 space-y-2">
    <div class="flex items-center gap-2">
      <Icon name="eye" size={14} />
      <span class="font-display text-sm font-semibold text-ink-900">Encryption</span>
      {#if vault.loaded}
        <span class="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={vault.unlocked
            ? 'background: var(--accent-alpha-10); color: var(--accent-electric);'
            : 'background: var(--bg-tertiary); color: var(--text-secondary);'}>
          {vault.configured ? (vault.unlocked ? 'Unlocked' : 'Locked') : 'Not set up'}
        </span>
      {/if}
    </div>

    {#if !vault.loaded}
      <p class="text-[12px] text-ink-400">Checking vault…</p>
    {:else if !vault.configured}
      <p class="text-[12px] text-ink-500">Set a passphrase to encrypt your keys (AES-GCM). Only ciphertext is stored in Directus — a leaked token or DB dump can't read your keys. The passphrase is never stored server-side; keep it safe, there's no recovery.</p>
      <div class="grid gap-2 sm:grid-cols-2">
        <input class="input" type="password" placeholder="Passphrase (min 8)" bind:value={pass1} disabled={vaultBusy} autocomplete="new-password" />
        <input class="input" type="password" placeholder="Confirm passphrase" bind:value={pass2} disabled={vaultBusy} autocomplete="new-password" />
      </div>
      <label class="flex items-center gap-2 text-[12px] text-ink-500"><input type="checkbox" bind:checked={remember} /> Remember on this device</label>
      <button class="btn-primary" onclick={doSetup} disabled={vaultBusy || !pass1 || !pass2}>{vaultBusy ? 'Setting up…' : 'Set passphrase'}</button>
    {:else if !vault.unlocked}
      <p class="text-[12px] text-ink-500">Enter your passphrase to add or use keys on this device.</p>
      <input class="input w-full" type="password" placeholder="Passphrase" bind:value={pass1} disabled={vaultBusy} autocomplete="current-password"
        onkeydown={(e) => { if (e.key === 'Enter') doUnlock(); }} />
      <label class="flex items-center gap-2 text-[12px] text-ink-500"><input type="checkbox" bind:checked={remember} /> Remember on this device</label>
      <button class="btn-primary" onclick={doUnlock} disabled={vaultBusy || !pass1}>{vaultBusy ? 'Unlocking…' : 'Unlock'}</button>
    {:else}
      <p class="text-[12px] text-ink-500">Keys are encrypted at rest. This device is unlocked.</p>
      <button class="btn-ghost !px-2 text-[12px]" onclick={lock}>Lock / forget on this device</button>
    {/if}
    {#if vaultError}<div class="text-xs text-tag-salesText">{vaultError}</div>{/if}
  </div>

  <!-- ── Keys ─────────────────────────────────────────────────────────── -->
  <div class="space-y-3">
    <h2 class="font-display text-sm font-semibold text-ink-900">Provider keys</h2>

    {#if keys.length > 0}
      <ul class="divide-y divide-surface-divider rounded-[12px] border border-surface-border">
        {#each keys as k (k.id)}
          <li class="flex items-center gap-3 px-3 py-2.5 {k.status === 'disabled' ? 'opacity-55' : ''}">
            <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-hover text-brand">
              <Icon name="sparkles" size={15} />
            </span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium text-ink-900">{k.label}</div>
              <div class="text-[11px] text-ink-500">
                {providerLabel(k.provider)} · <span class="font-mono">••••{k.last4 ?? '????'}</span>
                {#if k.base_url}· {k.base_url}{/if}
              </div>
            </div>
            <button class="btn-ghost !px-2 text-[11px]" onclick={() => toggleKeyStatus(k)} title="Enable / disable">
              {k.status === 'disabled' ? 'Enable' : 'Disable'}
            </button>
            <button class="btn-ghost !px-2 text-tag-salesText" onclick={() => removeKey(k)} aria-label="Delete key">
              <Icon name="trash" size={15} />
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="rounded-[12px] border border-dashed border-surface-border px-3 py-4 text-xs text-ink-400">No keys yet. Add one below.</p>
    {/if}

    <!-- Add form — only when the vault is unlocked (keys are encrypted before save). -->
    {#if vault.unlocked}
      <div class="rounded-[12px] border border-surface-border p-3 space-y-2">
        <div class="grid gap-2 sm:grid-cols-2">
          <input class="input" placeholder="Label (e.g. Personal Anthropic)" bind:value={newLabel} disabled={adding} />
          <select class="input" bind:value={newProvider} disabled={adding}>
            {#each AI_PROVIDERS as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
          </select>
        </div>
        <input class="input w-full" placeholder="API key" bind:value={newKeyVal} disabled={adding} autocomplete="off" spellcheck="false" />
        {#if newProvider === 'custom'}
          <input class="input w-full" placeholder="Base URL (OpenAI-compatible)" bind:value={newBaseUrl} disabled={adding} />
        {/if}
        <div class="flex justify-end">
          <button class="btn-primary" onclick={addKey} disabled={adding || !newLabel.trim() || !newKeyVal.trim()}>
            <Icon name="plus" size={14} /> {adding ? 'Adding…' : 'Add key'}
          </button>
        </div>
      </div>
    {:else}
      <p class="rounded-[12px] border border-dashed border-surface-border px-3 py-3 text-xs text-ink-400">
        {vault.configured ? 'Unlock the vault above to add a key.' : 'Set a passphrase above to start adding keys.'}
      </p>
    {/if}
  </div>

  <!-- ── Task bindings ────────────────────────────────────────────────── -->
  <div class="space-y-3">
    <h2 class="font-display text-sm font-semibold text-ink-900">Task → brain</h2>
    <p class="text-xs text-ink-500">Pick which key and model each process uses. Unset tasks fall back to the <span class="font-medium">General</span> binding.</p>

    <ul class="space-y-2">
      {#each AI_TASKS as t (t.slug)}
        {@const b = bindingFor(t.slug)}
        <li class="rounded-[12px] border border-surface-border p-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-medium text-ink-900">{t.label}</div>
              <div class="text-[11px] text-ink-500">{t.description}</div>
            </div>
            {#if savingTask === t.slug}<span class="text-[11px] text-ink-400">saving…</span>{/if}
          </div>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1 block font-display text-[10px] uppercase tracking-wider text-ink-400">Key</span>
              <select class="input w-full" value={b?.key_id ?? ''} onchange={(e) => onKeyChange(t.slug, e)}>
                <option value="">— unset —</option>
                {#each keys as k (k.id)}
                  <option value={k.id}>{k.label} ({providerLabel(k.provider)})</option>
                {/each}
              </select>
            </label>
            <label class="block">
              <span class="mb-1 block font-display text-[10px] uppercase tracking-wider text-ink-400">Model</span>
              <input
                class="input w-full"
                list={`models-${t.slug}`}
                placeholder="model id"
                value={b?.model ?? ''}
                onchange={(e) => onModelChange(t.slug, e)}
                disabled={!b?.key_id}
              />
              <datalist id={`models-${t.slug}`}>
                {#each modelsForTask(t.slug) as m (m)}<option value={m}></option>{/each}
              </datalist>
            </label>
          </div>
        </li>
      {/each}
    </ul>
  </div>
</section>
