<script lang="ts">
  // Tag card for notes — uses the same shared `Tag` collection that
  // Person and Organisation tag against, so a single tag like
  // "investor" or "kennsla" can decorate any record kind and search
  // cuts across them all. Structure mirrors TagsCard so it reads as
  // the same UX on every detail surface.
  import Icon from '$lib/Icon.svelte';
  import {
    searchTags,
    createTag,
    getNoteTags,
    attachTagToNote,
    detachTagFromNote,
    formatError,
    type Tag,
    type NoteTag
  } from '$lib/directus';

  type Props = { noteId: number };
  let { noteId }: Props = $props();

  let links = $state<NoteTag[]>([]);
  let loading = $state(true);
  let error = $state('');

  function tagOf(link: NoteTag): Tag | null {
    return link.tag_id && typeof link.tag_id === 'object' ? (link.tag_id as Tag) : null;
  }

  async function refresh() {
    loading = true;
    try {
      links = await getNoteTags(noteId);
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => { void refresh(); });

  // ── Picker ─────────────────────────────────────────────────────────────
  let adding = $state(false);
  let query = $state('');
  let results = $state<Tag[]>([]);
  let searched = $state(false);
  let busy = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEl = $state<HTMLInputElement | null>(null);

  function openAdd() {
    adding = true;
    query = '';
    results = [];
    searched = false;
    error = '';
    queueSearch('');
    queueMicrotask(() => inputEl?.focus());
  }
  function cancelAdd() {
    adding = false;
    if (searchTimer) clearTimeout(searchTimer);
  }
  function onInput(e: Event) {
    query = (e.currentTarget as HTMLInputElement).value;
    queueSearch(query);
  }
  function queueSearch(v: string) {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try {
        results = await searchTags(v, 12);
        searched = true;
      } catch (e) {
        error = formatError(e);
      }
    }, 150);
  }

  const linkedIds = $derived(new Set(links.map((l) => tagOf(l)?.id).filter(Boolean) as number[]));
  const filtered = $derived(results.filter((t) => !linkedIds.has(t.id)));
  const exactMatch = $derived(
    !!query.trim() && results.some((t) => t.name.trim().toLowerCase() === query.trim().toLowerCase())
  );

  async function attach(tag: Tag) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const created = await attachTagToNote(noteId, tag.id);
      // Inline the resolved tag so the chip renders immediately.
      links = [...links, { ...created, tag_id: tag } as NoteTag];
      query = '';
      results = [];
      searched = false;
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = false;
    }
  }
  async function createAndAttach() {
    const name = query.trim();
    if (!name || busy) return;
    busy = true;
    error = '';
    try {
      const t = await createTag({ name });
      await attach(t);
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = false;
    }
  }
  async function detach(link: NoteTag) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await detachTagFromNote(link.id);
      links = links.filter((l) => l.id !== link.id);
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = false;
    }
  }

  function pillStyle(t: Tag | null) {
    // Custom color from the tag itself, falling back to the accent so
    // chips look on-brand without ever venturing outside the token set.
    const c = t?.color?.trim();
    if (c && /^#[0-9a-fA-F]{6}$/.test(c)) {
      return `background: ${c}1f; color: ${c}; border-color: ${c}55;`;
    }
    return 'background: var(--accent-alpha-10); color: var(--accent-electric); border-color: var(--accent-alpha-30);';
  }
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title">
      <Icon name="tag" size={16} /> Tags
      {#if links.length > 0}<span class="text-ink-300 font-normal">{links.length}</span>{/if}
    </span>
    {#if !adding}
      <button class="btn-ghost inline-flex items-center gap-1 text-sm" onclick={openAdd}>
        <Icon name="plus" size={14} /> Add
      </button>
    {/if}
  </div>

  {#if error}
    <div
      class="mx-4 mb-3 px-3 py-1.5 text-xs"
      style="background: var(--bg-tertiary); color: var(--state-danger); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
    >{error}</div>
  {/if}

  {#if loading}
    <div class="px-4 pb-4 text-sm text-ink-400">Loading…</div>
  {:else}
    <div class="px-4 pb-3 flex flex-wrap gap-1.5">
      {#each links as link (link.id)}
        {@const t = tagOf(link)}
        {#if t}
          <span
            class="inline-flex items-center gap-1 border px-2 py-0.5 text-xs"
            style={`${pillStyle(t)} border-radius: var(--radius-pill);`}
          >
            <span class="font-medium">{t.name}</span>
            <button
              class="rounded-full p-0.5 hover:bg-black/5"
              aria-label={`Remove ${t.name}`}
              onclick={() => detach(link)}
            >
              <Icon name="plus" size={10} class="rotate-45" />
            </button>
          </span>
        {/if}
      {/each}
      {#if links.length === 0 && !adding}
        <span class="text-xs text-ink-400">No tags yet. Add one to group this note with people, orgs, and other notes.</span>
      {/if}
    </div>

    {#if adding}
      <div
        class="mx-4 mb-3 p-2"
        style="background: var(--bg-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
      >
        <div class="relative">
          <Icon name="search" size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            type="text"
            bind:this={inputEl}
            value={query}
            oninput={onInput}
            placeholder="Find or create a tag…"
            class="w-full pl-7 pr-2 py-1.5 text-sm focus:outline-none"
            style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: var(--text-primary);"
            onkeydown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                if (query) { query = ''; results = []; searched = false; queueSearch(''); }
                else { cancelAdd(); }
              }
            }}
          />
        </div>
        {#if filtered.length > 0}
          <ul class="mt-1 max-h-72 overflow-y-auto">
            {#each filtered as t (t.id)}
              <li>
                <button
                  class="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
                  style="border-radius: var(--radius-sm);"
                  onclick={() => attach(t)}
                  disabled={busy}
                >
                  <span class="truncate">{t.name}</span>
                  <span class="text-xs text-ink-400">+</span>
                </button>
              </li>
            {/each}
          </ul>
        {:else if searched && query.trim()}
          <div class="px-2 py-2 text-xs text-ink-500">No tag named "{query.trim()}". Create it?</div>
        {/if}
        <div class="flex items-center justify-between gap-2 pt-2">
          <button class="btn-ghost text-xs" onclick={cancelAdd}>Cancel</button>
          {#if query.trim() && !exactMatch}
            <button class="btn-primary !px-3 !py-1 text-xs" onclick={createAndAttach} disabled={busy}>
              <Icon name="plus" size={12} /> Create "{query.trim()}"
            </button>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
