<script lang="ts">
  // The marketing workspace shell — one header, four tabs.
  //
  // What this replaces: eight sibling routes under /tools/campaigns, four of
  // which were all "reporting" and disagreed with each other because each
  // blended spend differently. The tabs here are four different QUESTIONS, not
  // four views of one:
  //
  //   Plan   what are we spending, against what budget
  //   Live   what is running right now, and is it attributed
  //   Spend  the ledger — every medium, one place
  //   Setup  the plumbing: accounts, the medium vocabulary, sync
  //
  // Deep reporting is deliberately absent: it belongs on /insights next to the
  // programme's people and cohorts, not in a tool you have to know about.
  import { page } from '$app/stores';
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  const TABS: Array<{ href: string; label: string; icon: IconName; hint: string }> = [
    { href: '/marketing', label: 'Plan', icon: 'flag', hint: 'Campaigns and budgets' },
    { href: '/marketing/live', label: 'Live', icon: 'bolt', hint: 'What is running now' },
    { href: '/marketing/spend', label: 'Spend', icon: 'wallet', hint: 'Every medium, one ledger' },
    { href: '/marketing/setup', label: 'Setup', icon: 'settings', hint: 'Accounts and mediums' }
  ];

  const path = $derived($page.url.pathname.replace(/\/$/, '') || '/marketing');
  // Exact match for the index; prefix match for the rest, so
  // /marketing/live/previews still lights up Live.
  const active = $derived(
    TABS.map((t) => t.href)
      .filter((href) => (href === '/marketing' ? path === '/marketing' : path.startsWith(href)))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
  // A campaign detail page is not a tab. Showing the row there would light up
  // nothing and imply the page is a fifth sibling.
  const isDetail = $derived(/^\/marketing\/\d+/.test(path));
</script>

<div class="mx-auto max-w-4xl">
  {#if !isDetail}
    <header class="mb-4">
      <div class="hero-eyebrow">Marketing</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
        {TABS.find((t) => t.href === active)?.label ?? 'Marketing'}
      </h1>
      <p class="mt-1 text-sm text-ink-500">
        {TABS.find((t) => t.href === active)?.hint ?? ''}
      </p>
    </header>

    <nav class="mb-5 flex gap-1 overflow-x-auto border-b border-surface-divider" aria-label="Marketing sections">
      {#each TABS as t (t.href)}
        <a
          href={t.href}
          class="relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-sm font-medium transition {active ===
          t.href
            ? 'text-ink-900'
            : 'text-ink-400 hover:text-ink-700'}"
          aria-current={active === t.href ? 'page' : undefined}
        >
          <Icon name={t.icon} size={15} />
          {t.label}
          {#if active === t.href}
            <span class="absolute inset-x-0 -bottom-px h-0.5" style="background: var(--accent-electric);"></span>
          {/if}
        </a>
      {/each}
    </nav>
  {/if}

  {@render children()}
</div>
