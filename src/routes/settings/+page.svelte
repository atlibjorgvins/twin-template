<script lang="ts">
  // Guided settings landing. Rather than dropping the user straight
  // onto a tabbed admin, we present grouped sections — Appearance,
  // Catalogues, Workspace — each as a clickable row with an icon, a
  // title, a short description, and a "current value" hint where
  // useful. Each row deep-links to its own sub-page.
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import { logout } from '$lib/data/auth';
  import {
    INSTANCE,
    INSTANCE_LABEL,
    authEnabled,
    disabledFeatures,
    instanceIsDefault,
    unknownDisabledFeatures
  } from '$lib/instance';
  import { theme } from '$lib/theme.svelte';
  import {
    PUBLIC_DIRECTUS_URL
  } from '$env/static/public';
  import type { IconName } from '$lib/icon-types';
  import { activeBackend, deviceDirectusUrl, type BackendId } from '$lib/data/repo';
  import { activeVault } from '$lib/data/repo/vaults';

  const BACKEND_VALUE: Record<BackendId, string> = {
    local: 'This device',
    supabase: 'Supabase',
    directus: 'Directus'
  };

  type Row = {
    href?: string;        // internal SvelteKit route
    external?: string;    // external URL (opens new tab)
    icon: IconName;
    title: string;
    desc: string;
    /** Optional right-side hint, e.g. "3 tags" or "Light". */
    value?: string;
  };
  type Group = { label: string; rows: Row[] };

  const groups = $derived<Group[]>([
    {
      label: 'Appearance',
      rows: [
        {
          href: '/settings/appearance',
          icon: 'sparkles',
          title: 'Appearance',
          desc: 'Your name, light/dark theme, and accent color.',
          value:
            theme.mode === 'auto'
              ? `Auto · ${theme.effective}`
              : theme.mode.charAt(0).toUpperCase() + theme.mode.slice(1)
        }
      ]
    },
    // Managed session-mode instances hide Storage — the operator owns the
    // database there; the route guard (settings/storage/+page.ts) matches.
    ...(!authEnabled()
      ? [
          {
            label: 'Data',
            rows: [
              {
                href: '/settings/vaults',
                icon: 'lock' as IconName,
                title: 'Vaults',
                desc: 'Your worlds of data — switch between personal and workspace vaults, or join one.',
                value: activeVault().name
              },
              {
                href: '/settings/storage',
                icon: 'layers' as IconName,
                title: 'Storage',
                desc: `Where the current vault's data lives — this device, Supabase, or your own server.`,
                value: BACKEND_VALUE[activeBackend]
              }
            ]
          }
        ]
      : []),
    {
      label: 'Catalogues',
      rows: [
        {
          href: '/settings/tags',
          icon: 'tag',
          title: 'Tags',
          desc: 'Shared label pool for people, orgs, notes, and activities.'
        },
        {
          href: '/settings/activity-kinds',
          icon: 'bolt',
          title: 'Activity kinds',
          desc: 'The vocabulary of interactions you can log.'
        },
        {
          href: '/settings/project-roles',
          icon: 'users',
          title: 'Project roles',
          desc: 'Fixed roles a person or org can have on a project — student, teacher, partner, sponsor, host…'
        },
        {
          href: '/settings/calendar-mappings',
          icon: 'calendar',
          title: 'Calendar → Project',
          desc: 'Map each synced calendar (Apple/Google) to a default project so work events land on the right project automatically.'
        }
      ]
    },
    {
      label: 'Workspace',
      rows: [
        {
          href: '/settings/plugins',
          icon: 'layers',
          title: 'Plugins',
          desc: 'What is installed in this build, a vetted marketplace, and adding one from GitHub.',
          value: `${disabledFeatures().length ? `${disabledFeatures().length} off` : 'all on'}`
        },
        // The raw-data escape hatch only exists when a Directus is connected.
        ...(activeBackend === 'directus'
          ? [
              {
                external: `${deviceDirectusUrl() || PUBLIC_DIRECTUS_URL}/admin`,
                icon: 'settings' as IconName,
                title: 'Open Directus admin',
                desc: 'Raw data access — collections, permissions, files.'
              }
            ]
          : [])
      ]
    }
  ]);

  // ── Deploy helper ──────────────────────────────────────────────────
  // This is a static PWA served by nginx, so the browser can't run the
  // deploy itself. We surface the exact command to paste into a terminal,
  // with a one-click copy. Build + push lives in twin/scripts/deploy.sh.
  const DEPLOY_CMD = instanceIsDefault()
    ? 'cd ~/Projects/twin && bash scripts/deploy.sh'
    : `cd ~/Projects/twin && bash scripts/deploy.sh --target ${INSTANCE}`;
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyDeploy() {
    try {
      await navigator.clipboard.writeText(DEPLOY_CMD);
    } catch {
      // Fallback for non-secure contexts where the Clipboard API is blocked.
      const ta = document.createElement('textarea');
      ta.value = DEPLOY_CMD;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      ta.remove();
    }
    copied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1600);
  }

  // ── Sign out ───────────────────────────────────────────────────────
  // Only meaningful in session mode (authEnabled). logout() clears the
  // httpOnly cookie server-side; then a full navigation to /login re-runs
  // the layout guard, which now sees no session. invalidateAll so every
  // store drops the signed-in user's data rather than showing it stale.
  let signingOut = $state(false);
  async function signOut() {
    if (signingOut) return;
    signingOut = true;
    try {
      await logout();
    } finally {
      await goto('/login', { invalidateAll: true });
    }
  }
</script>

<svelte:head><title>Settings · Hub</title></svelte:head>

<section class="space-y-6">
  <header>
    <div class="hero-eyebrow">Settings</div>
    <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
      Tune the Hub
    </h1>
    <p class="mt-1 text-sm text-ink-500">
      Pick a section to manage. Changes apply immediately — no save button needed.
    </p>
  </header>

  {#each groups as g (g.label)}
    <div class="space-y-2">
      <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        {g.label}
      </div>
      <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
        {#each g.rows as row (row.title)}
          {#if row.href}
            <li>
              <a
                href={row.href}
                class="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-hover"
              >
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center"
                  style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);"
                >
                  <Icon name={row.icon} size={16} />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-ink-900">{row.title}</div>
                  <div class="text-xs text-ink-500">{row.desc}</div>
                </div>
                {#if row.value}
                  <span class="font-display text-[11px] uppercase tracking-wider text-ink-400 shrink-0">
                    {row.value}
                  </span>
                {/if}
                <Icon name="chevron-right" size={14} class="shrink-0 text-ink-300" />
              </a>
            </li>
          {:else if row.external}
            <li>
              <a
                href={row.external}
                target="_blank"
                rel="noreferrer"
                class="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-hover"
              >
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center"
                  style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);"
                >
                  <Icon name={row.icon} size={16} />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-ink-900">{row.title}</div>
                  <div class="text-xs text-ink-500">{row.desc}</div>
                </div>
                <Icon name="arrow-right" size={14} class="shrink-0 text-ink-300 -rotate-45" />
              </a>
            </li>
          {/if}
        {/each}
      </ul>
    </div>
  {/each}

  <!-- Account — only in session mode. In static-token mode there is no
       session to end (the shared token authenticates every request), so
       there is nothing to sign out of and the section does not render. -->
  {#if authEnabled()}
    <div class="space-y-2">
      <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        Account
      </div>
      <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
        <li>
          <button
            type="button"
            onclick={signOut}
            disabled={signingOut}
            class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-hover disabled:opacity-60"
          >
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center"
              style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);"
            >
              <Icon name="lock" size={16} />
            </span>
            <div class="min-w-0 flex-1">
              <div class="font-medium text-ink-900">{signingOut ? 'Signing out…' : 'Sign out'}</div>
              <div class="text-xs text-ink-500">End this session and return to the login screen.</div>
            </div>
          </button>
        </li>
      </ul>
    </div>
  {/if}

  <!-- Which twin am I looking at. Same code, different database: the only
       honest place to see which one is in front of you. -->
  <div class="space-y-2">
    <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      This build
    </div>
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
      <div class="font-medium text-ink-900">{INSTANCE_LABEL || 'Personal twin'}</div>
      <div class="mt-0.5 break-all text-xs text-ink-500">
        instance <span class="font-mono">{INSTANCE}</span> ·
        <span class="font-mono">{PUBLIC_DIRECTUS_URL}</span>
      </div>
      {#if disabledFeatures().length > 0}
        <div class="mt-3 text-xs text-ink-500">
          Modules left out of this build:
          <span class="font-mono text-ink-700">{disabledFeatures().join(', ')}</span>
        </div>
      {/if}
      {#if unknownDisabledFeatures.length > 0}
        <div class="mt-2 text-xs font-medium" style="color: #b91c1c;">
          PUBLIC_DISABLED_FEATURES names
          <span class="font-mono">{unknownDisabledFeatures.join(', ')}</span>, which match no
          module — those are still switched on. Check for a typo.
        </div>
      {/if}
    </div>
  </div>

  <!-- Deploy: copy-to-terminal helper (static site can't self-deploy) -->
  <!-- The deploy helper belongs to self-hosted server deployments; a
       local-vault install has nothing to push. -->
  {#if activeBackend === 'directus'}
  <div class="space-y-2">
    <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      Deploy
    </div>
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
      <div class="flex items-start gap-3">
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center"
          style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);"
        >
          <Icon name="sparkles" size={16} />
        </span>
        <div class="min-w-0 flex-1">
          <div class="font-medium text-ink-900">Publish the Hub</div>
          <div class="text-xs text-ink-500">
            Rebuilds and pushes the site to the NAS. Run this in a terminal on
            your Mac — the browser can't do it for you. Live the moment it finishes.
          </div>

          <div class="mt-3 flex items-center gap-2">
            <code
              class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[10px] border border-surface-border px-3 py-2 font-mono text-xs text-ink-900"
              style="background: var(--bg-tertiary);"
            >{DEPLOY_CMD}</code>
            <button
              type="button"
              onclick={copyDeploy}
              class="flex shrink-0 items-center gap-1.5 rounded-[10px] border border-surface-border px-3 py-2 text-xs font-medium text-ink-700 transition hover:bg-surface-hover"
              aria-label="Copy deploy command"
            >
              <Icon name={copied ? 'check' : 'copy'} size={14} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div class="mt-2 text-[11px] text-ink-400">
            Source: <span class="font-mono">~/Projects/twin</span> · builds the
            <span class="font-mono">{INSTANCE}</span> instance and pushes it to the
            host in <span class="font-mono">deploy/targets/{INSTANCE}.conf</span>.
          </div>
        </div>
      </div>
    </div>
  </div>
  {/if}
</section>
