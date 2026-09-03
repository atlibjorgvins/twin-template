<script lang="ts">
  // Tools landing.
  //
  // This page grew to eighteen tools across eleven groups, EIGHT of which
  // held exactly one item — a heading per tool, a three-line paragraph per
  // tool, and five screens of scrolling to reach the dice roller. Group
  // headings stop being navigation at that point and become noise.
  //
  // Three changes, in order of how much they help:
  //
  //   Search      eighteen items is past the point where scanning beats
  //               typing. Filters on title, description and group, so
  //               "bank" finds both Personal finances and Receipts.
  //   Recents     the honest access pattern: you reopen the same three
  //               tools all week. Kept in localStorage, no backend.
  //   Tiles       icon + name + one clamped line, in a grid. The full
  //               description is still there on hover and for search — it
  //               just is not shouted at you eighteen times.
  //
  // Groups collapse from eleven to five, so a heading means something again.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';
  import { scope, surfaceInScope, type SurfaceScope } from '$lib/scope';
  import { newsConfigured } from '$lib/news/enabled';
  import { featureOn, type FeatureKey } from '$lib/instance';
  import { TOOL_GROUPS, type Row, type Group } from '$lib/tools/catalogue';

  // Tiles live in $lib/tools/catalogue as data, checked against the plugin
  // registry by a test. This file owns rendering, search + filtering, and the
  // one runtime-conditional tile (News) below.
  // Tiles come from $lib/tools/catalogue as data (checked against the plugin
  // registry by a test). The News tile is added here, immutably, because it is
  // the one tile that depends on runtime config rather than the build.
  const groups: Group[] = newsConfigured()
    ? TOOL_GROUPS.map((g) =>
        g.label === 'Day'
          ? {
              ...g,
              rows: [
                ...g.rows,
                {
                  href: '/news',
                  icon: 'notebook' as IconName,
                  title: 'News',
                  desc: 'Icelandic business and startup coverage, archived as it publishes — unread, saved, by outlet.'
                }
              ]
            }
          : g
      )
    : TOOL_GROUPS;

  // Filter whole groups by the active Work/Private toggle (All shows all).
  // Two filters, different lifetimes: `feature` is fixed by the build, the
  // Work/Private toggle is this device right now. A group whose every tool
  // was built out disappears with its heading rather than leaving one.
  const visibleGroups = $derived(
    groups
      .map((g) => ({ ...g, rows: g.rows.filter((r) => !r.feature || featureOn(r.feature)) }))
      .filter((g) => surfaceInScope($scope, g.scope) && g.rows.length > 0)
  );

  // ── Search ──────────────────────────────────────────────────────────
  // Matches the description too, not just the title: "bank" finds both
  // Personal finances and Receipts, neither of which has "bank" in its name.
  // That only works because the descriptions are real sentences.
  let q = $state('');

  const results = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const hits: Array<Row & { group: string }> = [];
    for (const g of visibleGroups) {
      for (const r of g.rows) {
        const hay = `${r.title} ${r.desc} ${g.label}`.toLowerCase();
        if (hay.includes(needle)) hits.push({ ...r, group: g.label });
      }
    }
    return hits;
  });

  function openFirst(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    const first = results?.[0];
    if (!first) return;
    e.preventDefault();
    // A static app needs a real navigation, not a client-side route.
    if (first.reload) window.location.href = first.href;
    else void goto(first.href);
  }

  // ── Recents ─────────────────────────────────────────────────────────
  // The access pattern here is not "browse the catalogue", it is "open the
  // three things I always open". Local to the device, because which tools
  // you reach for on the wall tablet is not the same as on a laptop.
  const RECENT_KEY = 'twin.tools.recent';
  const RECENT_MAX = 5;
  let recentHrefs = $state<string[]>([]);

  onMount(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      recentHrefs = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      recentHrefs = [];
    }
  });

  function remember(href: string) {
    const next = [href, ...recentHrefs.filter((h) => h !== href)].slice(0, RECENT_MAX);
    recentHrefs = next;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Private mode — recents just do not persist.
    }
  }

  /** Recents resolved to rows, dropping anything renamed away or out of scope. */
  const recents = $derived.by(() => {
    const all = new Map(visibleGroups.flatMap((g) => g.rows.map((r) => [r.href, r] as const)));
    return recentHrefs.map((h) => all.get(h)).filter((r): r is Row => !!r);
  });

  const total = $derived(visibleGroups.reduce((n, g) => n + g.rows.length, 0));
</script>

<svelte:head><title>Tools · Hub</title></svelte:head>

<section class="space-y-5">
  <header>
    <div class="hero-eyebrow">Tools</div>
    <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
      Utilities
    </h1>
    <p class="mt-1 text-sm text-ink-500">
      {total} standalone helpers that don't belong in the main nav.
    </p>
  </header>

  <div class="relative">
    <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300">
      <Icon name="search" size={15} />
    </span>
    <input
      type="text"
      class="input w-full pl-9"
      placeholder="Search tools…"
      bind:value={q}
      onkeydown={openFirst}
      autocomplete="off"
      aria-label="Search tools"
    />
  </div>

  {#if results}
    {#if results.length === 0}
      <p class="text-sm text-ink-400">Nothing matches “{q}”.</p>
    {:else}
      <div class="tool-grid">
        {#each results as r (r.href)}
          {@render tile(r, r.group)}
        {/each}
      </div>
    {/if}
  {:else}
    {#if recents.length > 0}
      <div>
        <div class="tool-heading">Recent</div>
        <div class="tool-grid">
          {#each recents as r (r.href)}
            {@render tile(r, null)}
          {/each}
        </div>
      </div>
    {/if}

    {#each visibleGroups as g (g.label)}
      <div>
        <div class="tool-heading">{g.label}</div>
        <div class="tool-grid">
          {#each g.rows as r (r.href)}
            {@render tile(r, null)}
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</section>

{#snippet tile(row: Row, group: string | null)}
  <a
    href={row.href}
    data-sveltekit-reload={row.reload ? '' : undefined}
    class="tool-tile"
    title={row.desc}
    onclick={() => remember(row.href)}
  >
    <span class="tool-icon"><Icon name={row.icon} size={16} /></span>
    <span class="tool-title">{row.title}</span>
    <span class="tool-desc">{row.desc}</span>
    {#if group}<span class="tool-group">{group}</span>{/if}
  </a>
{/snippet}

<style>
  .tool-heading {
    margin: 0 0 0.5rem 0.15rem;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ink-400, #888);
  }
  .tool-grid {
    display: grid;
    gap: 0.6rem;
    grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  }
  .tool-tile {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    /* 44px+ of vertical target either way, per the touch-target rule; these
       get tapped on a tablet as often as clicked on a laptop. */
    min-height: 104px;
    padding: 0.75rem;
    border-radius: 14px;
    border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--surface-card, #fff);
    text-decoration: none;
    transition: background-color 200ms, box-shadow 200ms;
  }
  .tool-tile:hover { background: var(--bg-secondary, #f6f6f6); }
  .tool-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-md, 8px);
    background: var(--bg-tertiary, #f0f0f0);
    color: var(--text-secondary, #555);
  }
  .tool-title {
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.25;
    color: var(--ink-900, #111);
  }
  /* Two lines, then stop. The whole description is still in the title
     attribute and in the search index — it just is not shouted eighteen
     times down the page. */
  .tool-desc {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.72rem;
    line-height: 1.4;
    color: var(--ink-400, #888);
  }
  .tool-group {
    margin-top: auto;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-300, #aaa);
  }
</style>
