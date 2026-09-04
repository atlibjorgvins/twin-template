<script lang="ts">
  // Settings → Plugins. Obsidian-style discovery for a static, self-hosted SPA:
  //  - Installed: what is compiled into THIS build (registry.PLUGINS) + its
  //    on/off state (featureOn / the PUBLIC_DISABLED_FEATURES deny-list).
  //  - Marketplace: a vetted catalogue you can add (catalogue.CATALOGUE).
  //  - Add from GitHub: paste any repo; we surface the trust step + the exact
  //    add-and-redeploy commands.
  //
  // "Install" is build-time on purpose: twin is a browser SPA, not Electron, so
  // there is no runtime loading of third-party code inside your session. You add
  // a plugin to your instance and redeploy. See docs/plugin-authoring.md.
  import Icon from '$lib/Icon.svelte';
  import { PLUGINS } from '$lib/plugins/registry';
  import { CATALOGUE, type CatalogueEntry } from '$lib/plugins/catalogue';
  import {
    FEATURE_KEYS,
    featureOn,
    featureDisabledInBuild,
    setFeatureEnabled,
    INSTANCE,
    instanceIsDefault
  } from '$lib/instance';
  import type { FeatureKey } from '$lib/instance';
  import { applyAndReload, restoreToggleScroll } from '$lib/plugins/toggleFlow';
  import PluginSwitch from '$lib/PluginSwitch.svelte';
  import { onMount } from 'svelte';

  onMount(restoreToggleScroll);

  // Toggle a plugin on/off, then reload so the nav, tiles, and route guard all
  // re-read the new state consistently (they call featureOn at load / on
  // navigation). applyAndReload owns the choreography: the switch animates,
  // the sync fires without blocking, the page fades, then reloads.
  function toggle(id: FeatureKey, on: boolean) {
    // Pass the id on ENABLE so a Supabase vault can grow the plugin's tables
    // before the reload (schemaSync via toggleFlow).
    applyAndReload(() => setFeatureEnabled(id, on), on ? id : undefined);
  }

  const installedIds = new Set<string>(FEATURE_KEYS);

  // Installed = the registry, alphabetical within its category — a STABLE
  // order on purpose. It used to sort enabled-first, which meant the row you
  // had just toggled jumped to a different position after the reload: the
  // exact spatial inconsistency that makes a settings list feel broken. State
  // is shown by the switch (and the dimmed row), never by reordering.
  const installed = $derived([...PLUGINS].sort((a, b) => a.label.localeCompare(b.label)));

  // Grouped by category for the list, in a stable order (unknown categories last).
  const CATEGORY_ORDER = [
    'People & CRM',
    'Productivity',
    'Finance',
    'Marketing & media',
    'Utilities',
    'Integrations',
    'System',
    'Other'
  ];
  const installedByCategory = $derived.by(() => {
    const groups = new Map<string, typeof installed>();
    for (const p of installed) {
      const c = p.category ?? 'Other';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(p);
    }
    return [...groups.keys()]
      .sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a);
        const ib = CATEGORY_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      })
      .map((c) => ({ category: c, plugins: groups.get(c)! }));
  });

  function catalogueInstalled(e: CatalogueEntry): boolean {
    return e.provides.some((id) => installedIds.has(id));
  }
  /** Shipped in this build but currently off — one click turns it on, no
   *  terminal. True install-from-marketplace for everything already compiled
   *  in (which, in the strip build, is every registered plugin). */
  function catalogueEnableable(e: CatalogueEntry): boolean {
    const ids = e.provides.filter((id): id is FeatureKey => installedIds.has(id));
    return ids.length > 0 && ids.some((id) => !featureOn(id) && !featureDisabledInBuild(id));
  }
  // Which marketplace entry is mid-activation — its button reads "Turning on…"
  // for the settle-and-fade beat before the reload lands.
  let enabling = $state<string | null>(null);
  function enableEntry(e: CatalogueEntry) {
    enabling = e.id;
    applyAndReload(() => {
      for (const id of e.provides) {
        if (installedIds.has(id) && !featureDisabledInBuild(id as FeatureKey)) {
          setFeatureEnabled(id as FeatureKey, true);
        }
      }
    }, e.provides[0]);
  }
  // Marketplace: show the ones you don't already have first.
  const marketplace = $derived(
    [...CATALOGUE].sort(
      (a, b) => Number(catalogueInstalled(a)) - Number(catalogueInstalled(b)) || a.name.localeCompare(b.name)
    )
  );

  const DEPLOY = instanceIsDefault()
    ? 'bash scripts/deploy.sh'
    : `bash scripts/deploy.sh --target ${INSTANCE}`;

  // ── Add from GitHub ────────────────────────────────────────────────
  let repoUrl = $state('');
  const GH_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i;
  const repoValid = $derived(GH_RE.test(repoUrl.trim()));
  const repoName = $derived.by(() => {
    const m = repoUrl.trim().match(/github\.com\/[\w.-]+\/([\w.-]+?)(?:\.git)?\/?$/i);
    return m ? m[1] : 'plugin';
  });
  // The plugin id twin knows it by — the repo name with a conventional
  // `twin-plugin-` prefix stripped (twin-plugin-habits → habits).
  const pluginId = $derived(repoName.replace(/^twin-plugin-/, ''));

  // ── copy helper (shared) ───────────────────────────────────────────
  let copiedKey = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      ta.remove();
    }
    copiedKey = key;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copiedKey = null), 1600);
  }

  // Which marketplace card has its "how to add" expanded.
  let openEntry = $state<string | null>(null);

  function addSteps(e: CatalogueEntry): string {
    const src = e.repo ? `# source: ${e.repo}\n` : '';
    return (
      `${src}# 1. add the plugin under src/lib/plugins/<id>/ (manifest.ts + data.ts)\n` +
      `# 2. register it in src/lib/plugins/registry.ts\n` +
      `# 3. run the schema step if it adds collections\n` +
      `# 4. redeploy:\ncd ~/Projects/twin && ${DEPLOY}`
    );
  }
</script>

<svelte:head><title>Plugins · Settings · Hub</title></svelte:head>

<section class="space-y-6">
  <header>
    <a href="/settings" class="mb-2 inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-600">
      <Icon name="chevron-left" size={14} /> Settings
    </a>
    <div class="hero-eyebrow">Settings</div>
    <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">Plugins</h1>
    <p class="mt-1 text-sm text-ink-500">
      Every feature is a plugin. Anything in this build switches on and off right here — no
      terminal, no redeploy. Only brand-new code from outside the build needs the add-and-redeploy
      path at the bottom.
      <a href="https://github.com/atlibjorgvins/twin/blob/main/docs/plugin-authoring.md"
         target="_blank" rel="noreferrer" class="underline hover:text-ink-700">Write your own →</a>
    </p>
  </header>

  <!-- Installed ─────────────────────────────────────────────────────── -->
  <div class="space-y-2">
    <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      Installed in this build · {installed.length}
    </div>
    {#each installedByCategory as g (g.category)}
      <div class="mt-3 mb-1 px-1 text-[11px] font-medium text-ink-500">{g.category} · {g.plugins.length}</div>
      <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
        {#each g.plugins as p (p.id)}
          {@const on = featureOn(p.id)}
          <li class="flex items-center gap-3 px-4 py-3">
            <a href={`/settings/plugins/${p.id}`}
               class="flex min-w-0 flex-1 items-center gap-3 -my-3 py-3 hover:opacity-70 {on ? '' : 'opacity-[.55]'}"
               style="transition: opacity 200ms ease;">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center"
                    style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);">
                <Icon name="layers" size={16} />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-ink-900">{p.label}</span>
                  <span class="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                        style="background: var(--bg-tertiary); color: var(--text-tertiary);">{p.tier}</span>
                </div>
                <div class="truncate text-xs text-ink-500">
                  {p.description ?? `${p.id}`}
                </div>
              </div>
            </a>
            {#if featureDisabledInBuild(p.id)}
              <!-- Build decision — can't be overridden on-device. -->
              <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style="background: var(--bg-tertiary); color: var(--text-tertiary);"
                    title="Left out of this build (PUBLIC_DISABLED_FEATURES)">Off · build</span>
            {:else}
              <PluginSwitch
                checked={on}
                label={`Turn ${p.label} ${on ? 'off' : 'on'} on this device`}
                onchange={(next) => toggle(p.id, next)}
              />
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
    <p class="px-1 text-[11px] text-ink-400">
      The switch turns a plugin on or off <em>on this device</em> — remembered here (and synced when
      signed in) and applied to its nav, tiles, and routes. In a core build everything starts off;
      flip on what you want. Only plugins an operator removed with
      <span class="font-mono">PUBLIC_DISABLED_FEATURES</span> show
      <span class="font-medium">Off · build</span> and can't be switched on here.
    </p>
  </div>

  <!-- Marketplace ───────────────────────────────────────────────────── -->
  <div class="space-y-2">
    <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      Marketplace · vetted
    </div>
    <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
      {#each marketplace as e (e.id)}
        {@const isInstalled = catalogueInstalled(e)}
        <li class="px-4 py-3">
          <div class="flex items-center gap-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center"
                  style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);">
              <Icon name={e.tier === 'official' ? 'sparkles' : 'globe'} size={16} />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="font-medium text-ink-900">{e.name}</span>
                <span class="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                      style="background: var(--bg-tertiary); color: var(--text-tertiary);">{e.tier}</span>
              </div>
              <div class="text-xs text-ink-500">{e.description}</div>
              <div class="mt-0.5 text-[11px] text-ink-400">
                by {e.author}{#if e.repo} ·
                  <a href={e.repo} target="_blank" rel="noreferrer" class="underline hover:text-ink-600">repo</a>
                {/if}{#if e.collections?.length} · adds <span class="font-mono">{e.collections.join(', ')}</span>{/if}
              </div>
            </div>
            {#if isInstalled && catalogueEnableable(e)}
              <button type="button"
                      onclick={() => enableEntry(e)}
                      disabled={enabling === e.id}
                      class="marketplace-turn-on shrink-0 rounded-[10px] px-3 py-1.5 text-xs font-medium"
                      style="background: var(--accent-electric); color: var(--accent-text);">
                {enabling === e.id ? 'Turning on…' : 'Turn on'}
              </button>
            {:else if isInstalled}
              <span class="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style="background: color-mix(in srgb, #16A34A 15%, transparent); color: #16A34A;">
                <Icon name="check" size={12} /> Installed
              </span>
            {:else}
              <button type="button"
                      onclick={() => (openEntry = openEntry === e.id ? null : e.id)}
                      class="shrink-0 rounded-[10px] border border-surface-border px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:bg-surface-hover">
                {openEntry === e.id ? 'Hide' : 'Add'}
              </button>
            {/if}
          </div>

          {#if openEntry === e.id && !isInstalled}
            <div class="mt-3 rounded-[10px] border border-surface-border p-3" style="background: var(--bg-tertiary);">
              <div class="mb-2 text-xs font-medium text-ink-700">Add to this build, then redeploy:</div>
              <div class="flex items-start gap-2">
                <pre class="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-[8px] px-3 py-2 font-mono text-[11px] text-ink-900"
                     style="background: var(--bg-secondary);">{addSteps(e)}</pre>
                <button type="button" onclick={() => copy(addSteps(e), e.id)}
                        class="flex shrink-0 items-center gap-1.5 rounded-[8px] border border-surface-border px-2.5 py-2 text-xs font-medium text-ink-700 transition hover:bg-surface-hover"
                        aria-label="Copy install steps">
                  <Icon name={copiedKey === e.id ? 'check' : 'copy'} size={13} />
                </button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>

  <!-- Add from GitHub ──────────────────────────────────────────────── -->
  <div class="space-y-2">
    <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      Add from GitHub
    </div>
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
      <div class="text-xs text-ink-500">
        Paste a plugin repo. Because installing runs its code inside your instance, only add repos you
        trust and have looked at — there is no sandbox (build-time model).
      </div>
      <div class="mt-3 flex items-center gap-2">
        <input
          type="url"
          bind:value={repoUrl}
          placeholder="https://github.com/user/twin-plugin-something"
          class="min-w-0 flex-1 rounded-[10px] border border-surface-border px-3 py-2 text-sm text-ink-900"
          style="background: var(--bg-tertiary);"
        />
      </div>
      {#if repoUrl.trim() && !repoValid}
        <div class="mt-2 text-[11px] font-medium" style="color: #b91c1c;">
          That doesn't look like a GitHub repo URL (https://github.com/owner/name).
        </div>
      {/if}
      {#if repoValid}
        {@const cmd = `# review the code first: ${repoUrl.trim()}\n` +
          `# 1. add to plugins.json → "external":\n` +
          `#    { "id": "${pluginId}", "repo": "${repoUrl.trim()}", "ref": "main" }\n` +
          `# 2. pull it in (deploy runs this too):\n` +
          `cd ~/Projects/twin && bash scripts/fetch-plugins.sh\n` +
          `# 3. register "${pluginId}" in src/lib/plugins/registry.ts, run its schema step if any, then:\n` +
          `${DEPLOY}`}
        <div class="mt-3 flex items-start gap-2">
          <pre class="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-[8px] px-3 py-2 font-mono text-[11px] text-ink-900"
               style="background: var(--bg-tertiary);">{cmd}</pre>
          <button type="button" onclick={() => copy(cmd, 'gh')}
                  class="flex shrink-0 items-center gap-1.5 rounded-[8px] border border-surface-border px-2.5 py-2 text-xs font-medium text-ink-700 transition hover:bg-surface-hover"
                  aria-label="Copy install steps">
            <Icon name={copiedKey === 'gh' ? 'check' : 'copy'} size={13} />
          </button>
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .marketplace-turn-on {
    transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), opacity 160ms ease;
  }
  .marketplace-turn-on:active {
    transform: scale(0.97);
  }
  .marketplace-turn-on:disabled {
    opacity: 0.7;
  }
  @media (prefers-reduced-motion: reduce) {
    .marketplace-turn-on {
      transition: none;
    }
  }
</style>
