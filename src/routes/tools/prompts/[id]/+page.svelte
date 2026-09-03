<script lang="ts">
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import {
    updatePrompt,
    deletePrompt,
    setPromptTags,
    setPromptProjects,
    recordPromptUse,
    promptTokens,
    fillPromptTokens,
    splitPromptMeta,
    tokenKind,
    searchTags,
    createTag,
    searchProjects,
    formatError,
    type Prompt,
    type Tag
  } from '$lib/directus';
  import { copyText } from '$lib/clipboard';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const p = data.prompt;

  let title = $state(p.title ?? '');
  let purpose = $state(p.purpose ?? '');
  let body = $state(p.body ?? '');
  let systems = $state<string[]>([...(p.systems ?? [])]);
  let isFavorite = $state(!!p.is_favorite);
  let tags = $state<Tag[]>([...(p.tags ?? [])]);
  let projects = $state<Array<{ id: number; name?: string | null }>>([...(p.projects ?? [])]);

  let savedAt = $state('');
  let error = $state('');
  // The body may carry a trailing "How to use" section — split it out so the
  // copyable prompt (and its tokens) exclude the meta.
  const split = $derived(splitPromptMeta(body));
  const tokens = $derived(promptTokens(split.prompt));
  function tokenOptions(name: string): string[] {
    const k = tokenKind(name);
    if (k === 'project') return projects.map((pr) => pr.name ?? `Project ${pr.id}`);
    if (k === 'system') return systems;
    return [];
  }

  // Debounced autosave of the text fields.
  let baseline = $state({ title: p.title ?? '', purpose: p.purpose ?? '', body: p.body ?? '' });
  const dirty = $derived(title !== baseline.title || purpose !== baseline.purpose || body !== baseline.body);
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    if (!dirty) return;
    const t = title, pu = purpose, b = body;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await updatePrompt(p.id, { title: t, purpose: pu || null, body: b || null });
        baseline = { title: t, purpose: pu, body: b };
        savedAt = new Date().toLocaleTimeString();
      } catch (e) { error = formatError(e); }
    }, 700);
  });

  async function toggleFav() {
    isFavorite = !isFavorite;
    try { await updatePrompt(p.id, { is_favorite: isFavorite }); } catch (e) { error = formatError(e); }
  }

  // ── Systems chips ────────────────────────────────────────────────────
  let systemDraft = $state('');
  async function saveSystems() {
    try { await updatePrompt(p.id, { systems }); } catch (e) { error = formatError(e); }
  }
  function addSystem() {
    const v = systemDraft.trim();
    if (v && !systems.includes(v)) { systems = [...systems, v]; void saveSystems(); }
    systemDraft = '';
  }
  function removeSystem(s: string) { systems = systems.filter((x) => x !== s); void saveSystems(); }

  // ── Tags ─────────────────────────────────────────────────────────────
  let tagQ = $state('');
  let tagResults = $state<Tag[]>([]);
  let tagTimer: ReturnType<typeof setTimeout>;
  function onTagQuery(v: string) {
    tagQ = v;
    clearTimeout(tagTimer);
    tagTimer = setTimeout(async () => {
      try { tagResults = (await searchTags(v, 8)).filter((t) => !tags.some((x) => x.id === t.id)); } catch { tagResults = []; }
    }, 160);
  }
  async function addTag(t: Tag) {
    tags = [...tags, t]; tagQ = ''; tagResults = [];
    try { await setPromptTags(p.id, tags.map((x) => x.id)); } catch (e) { error = formatError(e); }
  }
  async function createAndAddTag() {
    const name = tagQ.trim(); if (!name) return;
    try { const t = await createTag({ name }); await addTag(t); } catch (e) { error = formatError(e); }
  }
  async function removeTag(id: number) {
    tags = tags.filter((t) => t.id !== id);
    try { await setPromptTags(p.id, tags.map((x) => x.id)); } catch (e) { error = formatError(e); }
  }

  // ── Projects ─────────────────────────────────────────────────────────
  let projQ = $state('');
  let projResults = $state<Array<{ id: number; name?: string | null }>>([]);
  let projTimer: ReturnType<typeof setTimeout>;
  function onProjQuery(v: string) {
    projQ = v;
    clearTimeout(projTimer);
    projTimer = setTimeout(async () => {
      if (!v.trim()) { projResults = []; return; }
      try { projResults = (await searchProjects(v, 8)).map((r) => ({ id: r.id, name: r.name })).filter((r) => !projects.some((x) => x.id === r.id)); } catch { projResults = []; }
    }, 160);
  }
  async function addProject(pr: { id: number; name?: string | null }) {
    projects = [...projects, pr]; projQ = ''; projResults = [];
    try { await setPromptProjects(p.id, projects.map((x) => x.id)); } catch (e) { error = formatError(e); }
  }
  async function removeProject(id: number) {
    projects = projects.filter((x) => x.id !== id);
    try { await setPromptProjects(p.id, projects.map((x) => x.id)); } catch (e) { error = formatError(e); }
  }

  // ── Copy ─────────────────────────────────────────────────────────────
  let copied = $state(false);
  let filling = $state(false);
  let fillValues = $state<Record<string, string>>({});
  async function doCopy(text: string) {
    const ok = await copyText(text);
    if (!ok) { error = 'Could not copy to the clipboard.'; return; }
    copied = true; setTimeout(() => (copied = false), 1500);
    void recordPromptUse(p.id, p.times_used ?? 0);
  }
  function onCopy() {
    if (tokens.length === 0) { void doCopy(split.prompt); return; }
    fillValues = Object.fromEntries(tokens.map((t) => [t, '']));
    filling = true;
  }
  async function copyFilled() { await doCopy(fillPromptTokens(split.prompt, fillValues)); filling = false; }

  let confirming = $state(false);
  async function del() {
    try { await deletePrompt(p.id); goto('/tools/prompts'); } catch (e) { error = formatError(e); }
  }
</script>

<svelte:head><title>{title || 'Prompt'} · Prompt library</title></svelte:head>

<section class="mx-auto max-w-2xl space-y-4">
  <div class="flex items-center justify-between gap-2">
    <a href="/tools/prompts" class="inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-700"><Icon name="chevron-left" size={14} /> Prompt library</a>
    <div class="flex items-center gap-2">
      <button class="btn-ghost !px-2" title={isFavorite ? 'Unfavorite' : 'Favorite'} onclick={toggleFav}>
        <span style={isFavorite ? 'color: var(--accent-electric)' : ''} class:text-ink-300={!isFavorite}>★</span>
      </button>
      <button class="btn-primary" onclick={onCopy}><Icon name="copy" size={14} /> {copied ? 'Copied' : tokens.length ? 'Copy…' : 'Copy'}</button>
    </div>
  </div>

  {#if error}<div class="rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">{error}</div>{/if}

  <input class="w-full bg-transparent font-display text-2xl font-bold text-ink-900 placeholder:text-ink-300 focus:outline-none" placeholder="Untitled prompt" bind:value={title} />

  <div>
    <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Purpose</div>
    <textarea class="input w-full resize-none" rows="2" placeholder="What is this prompt for?" bind:value={purpose}></textarea>
  </div>

  <div>
    <div class="mb-1 flex items-center justify-between">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Prompt</span>
      {#if tokens.length > 0}<span class="text-[11px] text-ink-400">{tokens.length} fill-in {tokens.length === 1 ? 'token' : 'tokens'}: {tokens.map((t) => `{${t}}`).join(' ')}</span>{/if}
    </div>
    <textarea class="input w-full resize-y font-mono text-sm" rows="10" placeholder="The prompt text. Use {'{tokens}'} for fill-in values." bind:value={body}></textarea>
    <p class="mt-1 text-[11px] text-ink-400">
      Add a <span class="font-medium">## How to use</span> (or Usage / Instructions / Notes) heading and everything below it becomes a separate section — never copied.
    </p>
  </div>

  {#if split.meta}
    <div class="rounded-[12px] border border-surface-border bg-surface-hover/40 p-3">
      <div class="mb-1 flex items-center gap-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">
        <Icon name="book-open" size={12} /> How to use <span class="normal-case text-ink-300">— not copied</span>
      </div>
      <div class="whitespace-pre-wrap text-sm text-ink-600">{split.meta}</div>
    </div>
  {/if}

  <!-- Systems -->
  <div>
    <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Systems</div>
    <div class="flex flex-wrap items-center gap-1.5">
      {#each systems as s (s)}
        <span class="inline-flex items-center gap-1 rounded-full border border-surface-border px-2 py-0.5 text-xs text-ink-600">
          {s}<button class="hover:text-tag-salesText" aria-label="Remove" onclick={() => removeSystem(s)}>×</button>
        </span>
      {/each}
      <input
        class="input !py-1 !text-xs min-w-[120px] flex-1"
        list="prompt-systems"
        placeholder="Add system + Enter"
        bind:value={systemDraft}
        onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSystem(); } }}
      />
      <datalist id="prompt-systems">{#each data.systems as s (s)}<option value={s}></option>{/each}</datalist>
    </div>
  </div>

  <!-- Tags (purpose search) -->
  <div>
    <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Tags <span class="normal-case text-ink-300">— search by purpose</span></div>
    <div class="flex flex-wrap items-center gap-1.5">
      {#each tags as t (t.id)}
        <span class="inline-flex items-center gap-1"><TagPill tone="neutral">{t.name}</TagPill><button class="text-ink-300 hover:text-tag-salesText" aria-label="Remove" onclick={() => removeTag(t.id)}>×</button></span>
      {/each}
    </div>
    <div class="relative mt-1">
      <input class="input w-full !py-1 !text-xs" placeholder="Add a tag…" value={tagQ} oninput={(e) => onTagQuery((e.currentTarget as HTMLInputElement).value)} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (tagResults[0]) addTag(tagResults[0]); else createAndAddTag(); } }} />
      {#if tagResults.length > 0}
        <ul class="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
          {#each tagResults as t (t.id)}<li><button class="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-hover" onclick={() => addTag(t)}>{t.name}</button></li>{/each}
        </ul>
      {:else if tagQ.trim()}
        <button class="mt-1 text-xs text-brand hover:underline" onclick={createAndAddTag}>Create tag “{tagQ.trim()}”</button>
      {/if}
    </div>
  </div>

  <!-- Projects -->
  <div>
    <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Projects</div>
    <div class="flex flex-wrap items-center gap-1.5">
      {#each projects as pr (pr.id)}
        <span class="inline-flex items-center gap-1 rounded-full border border-surface-border px-2 py-0.5 text-xs text-ink-600">
          {pr.name ?? `Project ${pr.id}`}<button class="hover:text-tag-salesText" aria-label="Remove" onclick={() => removeProject(pr.id)}>×</button>
        </span>
      {/each}
    </div>
    <div class="relative mt-1">
      <input class="input w-full !py-1 !text-xs" placeholder="Link a project…" value={projQ} oninput={(e) => onProjQuery((e.currentTarget as HTMLInputElement).value)} />
      {#if projResults.length > 0}
        <ul class="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
          {#each projResults as pr (pr.id)}<li><button class="w-full px-3 py-1.5 text-left text-sm hover:bg-surface-hover" onclick={() => addProject(pr)}>{pr.name ?? `Project ${pr.id}`}</button></li>{/each}
        </ul>
      {/if}
    </div>
  </div>

  <div class="flex items-center justify-between pt-2 text-xs text-ink-400">
    <span>{dirty ? 'Unsaved…' : savedAt ? `Saved ${savedAt}` : ''}{(p.times_used ?? 0) > 0 ? ` · used ${p.times_used}×` : ''}</span>
    {#if confirming}
      <span class="flex items-center gap-2">Delete this prompt? <button class="text-tag-salesText hover:underline" onclick={del}>Yes</button> <button class="hover:text-ink-700" onclick={() => (confirming = false)}>No</button></span>
    {:else}
      <button class="inline-flex items-center gap-1 text-tag-salesText hover:opacity-80" onclick={() => (confirming = true)}><Icon name="trash" size={13} /> Delete</button>
    {/if}
  </div>
</section>

{#if filling}
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" onclick={() => (filling = false)} onkeydown={(e) => { if (e.key === 'Escape') filling = false; }} tabindex="-1">
    <div class="w-full max-w-md rounded-t-[16px] bg-surface-card p-4 shadow-card sm:rounded-[16px]" onclick={(e) => e.stopPropagation()} role="document">
      <div class="mb-2 font-display text-sm font-semibold text-ink-900">Choose values</div>
      <div class="space-y-2">
        {#each tokens as tk (tk)}
          {@const opts = tokenOptions(tk)}
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
        <button class="btn-ghost" onclick={() => (filling = false)}>Cancel</button>
        <button class="btn-primary" onclick={copyFilled}><Icon name="copy" size={13} /> Copy filled</button>
      </div>
    </div>
  </div>
{/if}
