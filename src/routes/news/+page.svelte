<script lang="ts">
  // The reading feed. Unread / saved / by outlet, over the frettir archive.
  //
  // This route exists in the bundle only as its own chunk — SvelteKit code
  // splits per route, so a twin with the feature off never downloads it. The
  // guard below is about not showing a broken page to someone who navigated
  // here by URL, not about weight.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import { newsConfigured, newsEnabled, newsVisible } from '$lib/news/enabled';
  import { listArticles, listOutlets, markRead, setSaved, type NewsArticle } from '$lib/news/data';

  let articles = $state<NewsArticle[]>([]);
  let outlets = $state<Array<{ outlet: string; count: number }>>([]);
  let loading = $state(true);
  let unread = $state(false);
  let savedOnly = $state(false);
  let outlet = $state<string | null>(null);
  let q = $state('');

  const visible = $derived(newsVisible($newsEnabled));

  onMount(() => {
    // Someone who typed the URL on a twin without the feature gets sent home
    // rather than shown an empty shell that will never fill.
    if (!newsConfigured()) {
      void goto('/');
      return;
    }
    void load();
    void listOutlets().then((o) => (outlets = o));
  });

  async function load() {
    loading = true;
    articles = await listArticles({ unread, saved: savedOnly, outlet, q, limit: 60 });
    loading = false;
  }

  // Re-query on any filter change. Cheap: the archive is one Directus away and
  // the alternative is filtering 60 rows client-side and lying about the rest.
  $effect(() => {
    void unread;
    void savedOnly;
    void outlet;
    void load();
  });

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function onSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void load(), 250);
  }

  async function toggleRead(a: NewsArticle) {
    const next = !a.read_at;
    a.read_at = next ? new Date().toISOString() : null;
    await markRead(a.id, next);
  }
  async function toggleSaved(a: NewsArticle) {
    a.saved = !a.saved;
    await setSaved(a.id, !!a.saved);
  }

  function fmtWhen(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d);
  }
</script>

<svelte:head><title>News · twin</title></svelte:head>

{#if visible}
  <section class="space-y-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-ink-900">News</h1>
        <p class="text-sm text-ink-500">Icelandic business and startup coverage, archived as it publishes.</p>
      </div>
      <a href="/settings" class="btn-ghost shrink-0"><Icon name="settings" size={14} /> Settings</a>
    </header>

    <div class="card p-3">
      <div class="flex flex-wrap items-center gap-2">
        <input class="input flex-1 min-w-[12rem]" bind:value={q} oninput={onSearch} placeholder="Search headlines…" />
        <button class="nw-chip" class:on={unread} onclick={() => (unread = !unread)}>Unread</button>
        <button class="nw-chip" class:on={savedOnly} onclick={() => (savedOnly = !savedOnly)}>Saved</button>
      </div>
      {#if outlets.length > 0}
        <div class="mt-2 flex flex-wrap gap-1.5">
          <button class="nw-chip" class:on={outlet === null} onclick={() => (outlet = null)}>All</button>
          {#each outlets as o (o.outlet)}
            <button class="nw-chip" class:on={outlet === o.outlet} onclick={() => (outlet = o.outlet)}>
              {o.outlet} <span class="text-ink-300">{o.count}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if loading}
      <p class="px-1 text-sm text-ink-400">Loading…</p>
    {:else if articles.length === 0}
      <div class="card p-4 text-sm text-ink-400">
        Nothing here. {#if unread || savedOnly || outlet || q}Try clearing the filters.{:else}The archive fills as the poller runs.{/if}
      </div>
    {:else}
      <ul class="space-y-1.5">
        {#each articles as a (a.id)}
          <li class="card px-3 py-2.5" class:opacity-60={!!a.read_at}>
            <div class="flex items-start gap-3">
              <div class="min-w-0 flex-1">
                <a href={a.url ?? '#'} target="_blank" rel="noreferrer"
                   class="text-[14px] font-medium text-ink-900 hover:underline">{a.title || 'Untitled'}</a>
                {#if a.summary}
                  <p class="mt-0.5 line-clamp-2 text-[12.5px] text-ink-500">{a.summary}</p>
                {/if}
                <div class="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
                  {#if a.source?.outlet}<span class="uppercase tracking-wide">{a.source.outlet}</span>{/if}
                  <span>{fmtWhen(a.published_at)}</span>
                  {#if a.author}<span>· {a.author}</span>{/if}
                </div>
              </div>
              <div class="flex shrink-0 flex-col gap-1">
                <button class="nw-act" class:read={!!a.read_at} title={a.read_at ? 'Mark unread' : 'Mark read'} onclick={() => toggleRead(a)}>
                  <Icon name={a.read_at ? 'eye-off' : 'eye'} size={13} />
                </button>
                <button class="nw-act" class:saved={a.saved} title={a.saved ? 'Unsave' : 'Save'} onclick={() => toggleSaved(a)}>
                  <Icon name="bookmark" size={13} />
                </button>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{:else if newsConfigured()}
  <!-- Configured but switched off on this device: say so, and offer the way
       back. An empty page here would look like a bug. -->
  <div class="card p-4 text-sm text-ink-500">
    News is turned off on this device.
    <button class="ml-1 text-brand hover:underline" onclick={() => newsEnabled.set(true)}>Turn it back on</button>
  </div>
{/if}

<style>
  .nw-chip {
    border-radius: 999px;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--surface-card, #fff);
    font-size: 0.72rem;
    color: var(--ink-600, #555);
    cursor: pointer;
  }
  .nw-chip.on {
    background: var(--brand, #2f7d7d);
    border-color: var(--brand, #2f7d7d);
    color: #fff;
    font-weight: 600;
  }
  .nw-act {
    display: inline-flex;
    padding: 0.25rem;
    border-radius: 6px;
    color: var(--ink-400, #888);
    background: none;
    cursor: pointer;
  }
  .nw-act:hover { background: var(--bg-secondary, #f4f4f4); color: var(--ink-900, #111); }
  .nw-act.saved { color: #C6762A; }
  .nw-act.read { color: var(--ink-300, #bbb); }
</style>
