<script lang="ts">
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import {
    listPrompts,
    createPrompt,
    updatePrompt,
    recordPromptUse,
    promptTokens,
    fillPromptTokens,
    splitPromptMeta,
    tokenKind,
    formatError,
    type Prompt,
    type PromptSort
  } from '$lib/directus';
  import { copyText } from '$lib/clipboard';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let prompts = $state<Prompt[]>(data.prompts);
  let loading = $state(false);
  let error = $state('');

  // ── Filters ──────────────────────────────────────────────────────────
  let q = $state('');
  let selectedTagIds = $state<number[]>([]);
  let projectId = $state<number | ''>('');
  let system = $state('');
  let favoritesOnly = $state(false);
  let sort = $state<PromptSort>('recent');

  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const _q = q, _tags = selectedTagIds, _proj = projectId, _sys = system, _fav = favoritesOnly, _sort = sort;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      loading = true; error = '';
      try {
        prompts = await listPrompts({
          q: _q,
          tagIds: _tags,
          projectId: _proj === '' ? undefined : Number(_proj),
          system: _sys || undefined,
          favoritesOnly: _fav,
          sort: _sort
        });
      } catch (e) { error = formatError(e); } finally { loading = false; }
    }, 200);
  });

  function toggleTag(id: number) {
    selectedTagIds = selectedTagIds.includes(id) ? selectedTagIds.filter((t) => t !== id) : [...selectedTagIds, id];
  }

  // Searchable tag filter — type to find a purpose tag instead of rendering
  // the whole cloud. Only selected tags show as chips.
  let tagQ = $state('');
  const selectedTags = $derived(selectedTagIds.map((id) => data.tags.find((t) => t.id === id)).filter((t): t is (typeof data.tags)[number] => !!t));
  const tagMatches = $derived(
    tagQ.trim()
      ? data.tags.filter((t) => !selectedTagIds.includes(t.id) && t.name.toLowerCase().includes(tagQ.trim().toLowerCase())).slice(0, 8)
      : []
  );
  function pickTag(id: number) { if (!selectedTagIds.includes(id)) selectedTagIds = [...selectedTagIds, id]; tagQ = ''; }
  const activeFilters = $derived(
    (q.trim() ? 1 : 0) + selectedTagIds.length + (projectId !== '' ? 1 : 0) + (system ? 1 : 0) + (favoritesOnly ? 1 : 0)
  );
  function clearFilters() { q = ''; selectedTagIds = []; projectId = ''; system = ''; favoritesOnly = false; }

  // ── New ──────────────────────────────────────────────────────────────
  let creating = $state(false);
  async function newPrompt() {
    creating = true;
    try {
      const p = await createPrompt({ title: 'Untitled prompt' });
      goto(`/tools/prompts/${p.id}`);
    } catch (e) { error = formatError(e); } finally { creating = false; }
  }

  // ── Copy (with {token} fill) ───────────────────────────────────────────
  let copiedId = $state<number | null>(null);
  let fillFor = $state<Prompt | null>(null);
  let fillValues = $state<Record<string, string>>({});

  async function doCopy(text: string, p: Prompt) {
    const ok = await copyText(text);
    if (!ok) { error = 'Could not copy to the clipboard.'; return; }
    copiedId = p.id;
    setTimeout(() => { if (copiedId === p.id) copiedId = null; }, 1500);
    // usage tracking — optimistic + persisted
    const n = (p.times_used ?? 0) + 1;
    prompts = prompts.map((x) => (x.id === p.id ? { ...x, times_used: n } : x));
    void recordPromptUse(p.id, p.times_used ?? 0);
  }
  // Copy operates on the PROMPT part only — the "How to use" meta is stripped.
  function promptPart(p: Prompt): string { return splitPromptMeta(p.body).prompt; }
  function onCopy(p: Prompt) {
    const body = promptPart(p);
    const toks = promptTokens(body);
    if (toks.length === 0) { void doCopy(body, p); return; }
    fillValues = Object.fromEntries(toks.map((t) => [t, '']));
    fillFor = p;
  }
  async function copyFilled() {
    if (!fillFor) return;
    const text = fillPromptTokens(promptPart(fillFor), fillValues);
    await doCopy(text, fillFor);
    fillFor = null;
  }
  // Options for a selectable token — the prompt's related info.
  function tokenOptions(p: Prompt, name: string): string[] {
    const k = tokenKind(name);
    if (k === 'project') return (p.projects ?? []).map((pr) => pr.name ?? `Project ${pr.id}`);
    if (k === 'system') return p.systems ?? [];
    return [];
  }

  async function toggleFav(p: Prompt) {
    const next = !p.is_favorite;
    prompts = prompts.map((x) => (x.id === p.id ? { ...x, is_favorite: next } : x));
    try { await updatePrompt(p.id, { is_favorite: next }); } catch (e) { error = formatError(e); }
  }

  function fmtWhen(iso?: string | null) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  }
</script>

<svelte:head><title>Prompt library · Hub</title></svelte:head>

<section class="space-y-5">
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <div class="hero-eyebrow">Tools</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">Prompt library</h1>
      <p class="mt-1 text-sm text-ink-500">Reusable prompts — tag by purpose, link to projects &amp; systems, copy in one tap.</p>
    </div>
    <button class="btn-primary" onclick={newPrompt} disabled={creating}>
      <Icon name="plus" size={14} /> {creating ? 'Creating…' : 'New prompt'}
    </button>
  </header>

  <!-- Search + facets -->
  <div class="space-y-2">
    <div class="relative">
      <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300"><Icon name="search" size={16} /></span>
      <input class="input w-full pl-9" placeholder="Search title, body, purpose…" bind:value={q} />
    </div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <select class="input !py-1 !text-xs" bind:value={sort}>
        <option value="recent">Recent</option>
        <option value="used">Most used</option>
        <option value="title">Title</option>
      </select>
      <select class="input !py-1 !text-xs" bind:value={projectId}>
        <option value="">All projects</option>
        {#each data.projects as p (p.id)}<option value={p.id}>{p.name ?? `Project ${p.id}`}</option>{/each}
      </select>
      {#if data.systems.length > 0}
        <select class="input !py-1 !text-xs" bind:value={system}>
          <option value="">All systems</option>
          {#each data.systems as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      {/if}
      <button
        class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition"
        style:background-color={favoritesOnly ? 'var(--accent-alpha-10)' : 'transparent'}
        style:color={favoritesOnly ? 'var(--accent-electric)' : 'var(--text-secondary)'}
        style:border-color={favoritesOnly ? 'var(--accent-alpha-30)' : 'var(--surface-border)'}
        onclick={() => (favoritesOnly = !favoritesOnly)}
      >★ Favorites</button>
      {#if activeFilters > 0}
        <button class="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline" onclick={clearFilters}>Clear</button>
      {/if}
    </div>
    <!-- Purpose tags — searchable, so the list doesn't render the whole cloud. -->
    {#if data.tags.length > 0}
      <div class="flex flex-wrap items-center gap-1.5">
        {#each selectedTags as t (t.id)}
          <button
            class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition"
            style="background-color: rgba(44,140,153,0.12); color: var(--brand, #2C8C99); border-color: rgba(44,140,153,0.45);"
            onclick={() => toggleTag(t.id)}
            title="Remove tag filter"
          >{t.name} <span aria-hidden="true">×</span></button>
        {/each}
        <div class="relative">
          <input
            class="input !py-1 !text-xs min-w-[10rem]"
            placeholder={selectedTags.length ? 'Add tag…' : 'Filter by purpose tag…'}
            bind:value={tagQ}
            onkeydown={(e) => { if (e.key === 'Enter' && tagMatches[0]) { e.preventDefault(); pickTag(tagMatches[0].id); } }}
          />
          {#if tagMatches.length > 0}
            <ul class="absolute z-20 mt-1 max-h-52 w-full min-w-[12rem] overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
              {#each tagMatches as t (t.id)}
                <li><button type="button" class="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-hover" onclick={() => pickTag(t.id)}>{t.name}</button></li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  {#if error}<div class="rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">{error}</div>{/if}

  {#if loading && prompts.length === 0}
    <div class="text-sm text-ink-400">Loading…</div>
  {:else if prompts.length === 0}
    <div class="rounded-[14px] border border-dashed border-surface-border px-4 py-10 text-center text-sm text-ink-500">
      {activeFilters > 0 ? 'No prompts match these filters.' : 'No prompts yet. Create your first one.'}
    </div>
  {:else}
    <ul class="space-y-2">
      {#each prompts as p (p.id)}
        <li class="card p-4">
          <div class="flex items-start justify-between gap-3">
            <a href={`/tools/prompts/${p.id}`} class="min-w-0 flex-1 hover:text-brand">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium text-ink-900">{p.title || 'Untitled prompt'}</span>
                {#if p.is_favorite}<span class="text-[var(--accent-electric)]">★</span>{/if}
              </div>
              {#if p.purpose}<div class="mt-0.5 line-clamp-2 text-sm text-ink-500">{p.purpose}</div>{/if}
            </a>
            <div class="flex shrink-0 items-center gap-1.5">
              <button class="btn-ghost !px-2" title={p.is_favorite ? 'Unfavorite' : 'Favorite'} onclick={() => toggleFav(p)}>
                <span class:text-ink-300={!p.is_favorite} style={p.is_favorite ? 'color: var(--accent-electric)' : ''}>★</span>
              </button>
              <button class="btn-primary !px-3 !py-1.5 text-xs" onclick={() => onCopy(p)}>
                <Icon name="copy" size={13} /> {copiedId === p.id ? 'Copied' : promptTokens(promptPart(p)).length ? 'Copy…' : 'Copy'}
              </button>
            </div>
          </div>

          {#if (p.tags && p.tags.length) || (p.systems && p.systems.length) || (p.projects && p.projects.length)}
            <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              {#each p.systems ?? [] as s (s)}
                <span class="inline-flex items-center gap-1 rounded-full border border-surface-border px-2 py-0.5 text-ink-500"><Icon name="sliders" size={10} /> {s}</span>
              {/each}
              {#each p.projects ?? [] as pr (pr.id)}
                <span class="inline-flex items-center gap-1 rounded-full border border-surface-border px-2 py-0.5 text-ink-500"><Icon name="sparkles" size={10} /> {pr.name}</span>
              {/each}
              {#each p.tags ?? [] as t (t.id)}<TagPill tone="neutral">{t.name}</TagPill>{/each}
            </div>
          {/if}

          {#if (p.times_used ?? 0) > 0}
            <div class="mt-2 text-[11px] text-ink-400">Used {p.times_used}×{p.last_used_at ? ` · last ${fmtWhen(p.last_used_at)}` : ''}</div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<!-- {token} fill dialog — project/system tokens become pickers over the
     prompt's linked info; others stay free text. -->
{#if fillFor}
  {@const toks = promptTokens(promptPart(fillFor))}
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" onclick={() => (fillFor = null)} onkeydown={(e) => { if (e.key === 'Escape') fillFor = null; }} tabindex="-1">
    <div class="w-full max-w-md rounded-t-[16px] bg-surface-card p-4 shadow-card sm:rounded-[16px]" onclick={(e) => e.stopPropagation()} role="document">
      <div class="mb-2 font-display text-sm font-semibold text-ink-900">Choose values</div>
      <div class="space-y-2">
        {#each toks as tk (tk)}
          {@const opts = tokenOptions(fillFor, tk)}
          <label class="block">
            <span class="mb-0.5 block font-display text-[10px] uppercase tracking-wider text-ink-400">{tk}</span>
            {#if opts.length > 0}
              <select class="input w-full" bind:value={fillValues[tk]}>
                <option value="">— choose —</option>
                {#each opts as o (o)}<option value={o}>{o}</option>{/each}
              </select>
            {:else}
              <input class="input w-full" bind:value={fillValues[tk]} placeholder={`{${tk}}`} />
            {/if}
          </label>
        {/each}
      </div>
      <div class="mt-3 flex items-center justify-end gap-2">
        <button class="btn-ghost" onclick={() => (fillFor = null)}>Cancel</button>
        <button class="btn-primary" onclick={copyFilled}><Icon name="copy" size={13} /> Copy filled</button>
      </div>
    </div>
  </div>
{/if}
