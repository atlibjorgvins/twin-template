<script lang="ts">
  // Plugin detail — click a plugin to see what it is and manage it. Obsidian's
  // community-plugin detail view, adapted to twin's build-time model: metadata
  // (what it owns, where it came from), the on/off switch, and a link to the
  // plugin's own settings page when it has one.
  import Icon from '$lib/Icon.svelte';
  import {
    featureOn,
    featureDisabledInBuild,
    setFeatureEnabled,
    type FeatureKey
  } from '$lib/instance';
  import { getPluginSetting, setPluginSetting } from '$lib/plugins/settings';
  import { savePluginConfig } from '$lib/data/pluginConfig';
  import { applyAndReload, restoreToggleScroll } from '$lib/plugins/toggleFlow';
  import { onMount } from 'svelte';
  import PluginSwitch from '$lib/PluginSwitch.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const p = $derived(data.plugin);
  const cat = $derived(data.catalogue);

  const on = $derived(featureOn(p.id));
  const buildOff = $derived(featureDisabledInBuild(p.id));
  const description = $derived(p.description ?? cat?.description ?? p.label);
  const author = $derived(cat?.author ?? 'twin');
  const repo = $derived(cat?.repo);
  const collections = $derived(p.collections ?? cat?.collections ?? []);
  const settings = $derived(p.settings ?? []);
  const settingsLinks = $derived(p.settingsLinks ?? []);
  const hasManage = $derived(settingsLinks.length > 0 || settings.length > 0);

  onMount(restoreToggleScroll);

  function toggle(next: boolean) {
    applyAndReload(() => setFeatureEnabled(p.id as FeatureKey, next), next ? p.id : undefined);
  }

  // Inline settings: seed from storage, persist on change. Per-device, no
  // reload — the plugin reads its value with getPluginSetting on its next load.
  let values = $state<Record<string, string | number | boolean>>({});
  $effect(() => {
    const next: Record<string, string | number | boolean> = {};
    for (const s of settings) next[s.key] = getPluginSetting(p.id, s.key, s.default ?? '');
    values = next;
  });
  function saveSetting(key: string, value: string | number | boolean) {
    values = { ...values, [key]: value };
    setPluginSetting(p.id, key, value);
    void savePluginConfig(); // mirror to cross-device sync (fire-and-forget)
  }
</script>

<svelte:head><title>{p.label} · Plugins · Hub</title></svelte:head>

<section class="space-y-6">
  <header>
    <a href="/settings/plugins" class="mb-2 inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-600">
      <Icon name="chevron-left" size={14} /> Plugins
    </a>
    <div class="flex items-start gap-3">
      <span class="flex h-11 w-11 shrink-0 items-center justify-center"
            style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);">
        <Icon name="layers" size={20} />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="font-display text-2xl font-bold" style="letter-spacing: -0.03em;">{p.label}</h1>
          <span class="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                style="background: var(--bg-tertiary); color: var(--text-tertiary);">{p.tier}</span>
          {#if on}
            <span class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style="background: color-mix(in srgb, #16A34A 15%, transparent); color: #16A34A;">On</span>
          {:else if buildOff}
            <span class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style="background: var(--bg-tertiary); color: var(--text-tertiary);">Off · build</span>
          {:else}
            <span class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style="background: var(--bg-tertiary); color: var(--text-tertiary);">Off</span>
          {/if}
        </div>
        <p class="mt-1 text-sm text-ink-500">{description}</p>
        <div class="mt-1 text-[11px] text-ink-400">
          <span class="font-mono">{p.id}</span> · by {author}{#if repo} ·
            <a href={repo} target="_blank" rel="noreferrer" class="underline hover:text-ink-600">repository</a>
          {/if}
        </div>
      </div>
    </div>
  </header>

  <!-- Manage ─────────────────────────────────────────────────────────── -->
  <div class="space-y-2">
    <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      Manage
    </div>
    <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
      <li class="flex items-center gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="font-medium text-ink-900">Enabled on this device</div>
          <div class="text-xs text-ink-500">
            {#if buildOff}
              Left out of this build (<span class="font-mono">PUBLIC_DISABLED_FEATURES</span>) — can't be
              switched on here.
            {:else}
              Hides or shows its nav, tiles, and routes on this device.
            {/if}
          </div>
        </div>
        {#if buildOff}
          <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style="background: var(--bg-tertiary); color: var(--text-tertiary);">Off · build</span>
        {:else}
          <PluginSwitch
            checked={on}
            label={`Turn ${p.label} ${on ? 'off' : 'on'} on this device`}
            onchange={(next) => toggle(next)}
          />
        {/if}
      </li>

      {#each settingsLinks as link (link.href)}
        <li>
          <a href={link.href}
             class="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-hover">
            <div class="min-w-0 flex-1">
              <div class="font-medium text-ink-900">{link.label}</div>
              <div class="text-xs text-ink-500">Configure {p.label}.</div>
            </div>
            <Icon name="chevron-right" size={14} class="shrink-0 text-ink-300" />
          </a>
        </li>
      {/each}
      {#if !hasManage}
        <li class="px-4 py-3">
          <div class="font-medium text-ink-900">Settings</div>
          <div class="text-xs text-ink-500">This plugin has no settings of its own.</div>
        </li>
      {/if}
    </ul>
  </div>

  <!-- Inline settings ────────────────────────────────────────────────── -->
  {#if settings.length}
    <div class="space-y-2">
      <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        Settings · this device
      </div>
      <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
        {#each settings as s (s.key)}
          <li class="flex items-center gap-3 px-4 py-3">
            <div class="min-w-0 flex-1">
              <div class="font-medium text-ink-900">{s.label}</div>
              {#if s.description}<div class="text-xs text-ink-500">{s.description}</div>{/if}
            </div>
            {#if s.type === 'toggle'}
              {@const v = values[s.key] === true}
              <button
                type="button" role="switch" aria-checked={v} aria-label={s.label}
                onclick={() => saveSetting(s.key, !v)}
                class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition"
                style={`background: ${v ? '#16A34A' : 'var(--bg-tertiary)'};`}
              >
                <span class="inline-block h-4 w-4 rounded-full bg-white transition"
                      style={`transform: translateX(${v ? '18px' : '2px'});`}></span>
              </button>
            {:else if s.type === 'select'}
              <select
                class="shrink-0 rounded-[10px] border border-surface-border px-2 py-1.5 text-sm text-ink-900"
                style="background: var(--bg-tertiary);"
                value={String(values[s.key] ?? '')}
                onchange={(e) => saveSetting(s.key, e.currentTarget.value)}
              >
                {#each s.options ?? [] as o (o.value)}
                  <option value={o.value}>{o.label}</option>
                {/each}
              </select>
            {:else if s.type === 'number'}
              <input
                type="number"
                class="w-24 shrink-0 rounded-[10px] border border-surface-border px-2 py-1.5 text-sm text-ink-900"
                style="background: var(--bg-tertiary);"
                placeholder={s.placeholder ?? ''}
                value={String(values[s.key] ?? '')}
                onchange={(e) => saveSetting(s.key, e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}
              />
            {:else}
              <input
                type="text"
                class="w-44 shrink-0 rounded-[10px] border border-surface-border px-2 py-1.5 text-sm text-ink-900"
                style="background: var(--bg-tertiary);"
                placeholder={s.placeholder ?? ''}
                value={String(values[s.key] ?? '')}
                onchange={(e) => saveSetting(s.key, e.currentTarget.value)}
              />
            {/if}
          </li>
        {/each}
      </ul>
      <p class="px-1 text-[11px] text-ink-400">Saved on this device as you change them.</p>
    </div>
  {/if}

  <!-- What it is ─────────────────────────────────────────────────────── -->
  <div class="space-y-2">
    <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      Details
    </div>
    <dl class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card text-sm">
      <div class="flex gap-3 px-4 py-3">
        <dt class="w-28 shrink-0 text-ink-500">Category</dt>
        <dd class="min-w-0 flex-1 text-ink-900">{p.category ?? 'Other'}</dd>
      </div>
      <div class="flex gap-3 px-4 py-3">
        <dt class="w-28 shrink-0 text-ink-500">Routes</dt>
        <dd class="min-w-0 flex-1 text-ink-900">
          {#if p.routes?.length}
            <span class="font-mono text-xs">{p.routes.join(', ')}</span>
          {:else}
            <span class="text-ink-400">None — an in-page section or static asset.</span>
          {/if}
        </dd>
      </div>
      <div class="flex gap-3 px-4 py-3">
        <dt class="w-28 shrink-0 text-ink-500">Collections</dt>
        <dd class="min-w-0 flex-1 text-ink-900">
          {#if collections.length}
            <span class="font-mono text-xs">{collections.join(', ')}</span>
          {:else}
            <span class="text-ink-400">None.</span>
          {/if}
        </dd>
      </div>
      <div class="flex gap-3 px-4 py-3">
        <dt class="w-28 shrink-0 text-ink-500">Depends on</dt>
        <dd class="min-w-0 flex-1 text-ink-900">
          <span class="font-mono text-xs">{(p.dependsOn ?? ['contacts']).join(', ')}</span>
        </dd>
      </div>
      <div class="flex gap-3 px-4 py-3">
        <dt class="w-28 shrink-0 text-ink-500">Removable</dt>
        <dd class="min-w-0 flex-1 text-ink-900">{p.removable === false ? 'No — core to this build' : 'Yes'}</dd>
      </div>
    </dl>
    <p class="px-1 text-[11px] text-ink-400">
      Want to build one like this?
      <a href="https://github.com/atlibjorgvins/twin/blob/main/docs/plugin-authoring.md"
         target="_blank" rel="noreferrer" class="underline hover:text-ink-600">Plugin authoring guide →</a>
    </p>
  </div>
</section>
