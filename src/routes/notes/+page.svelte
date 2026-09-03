<script lang="ts">
  import { goto } from '$app/navigation';
  import { searchNotes, searchTags, createNote, deleteNote, formatError, type Note, type Tag } from '$lib/directus';
  import { scope } from '$lib/scope';
  import Icon from '$lib/Icon.svelte';

  type Filter = 'all' | 'inbox' | 'meeting' | 'journal' | 'general';

  let q = $state('');
  let filter = $state<Filter>('all');
  let sortBy = $state<'created' | 'updated'>('created');
  let showArchived = $state(false);
  let notes: Note[] = $state([]);
  let loading = $state(false);
  let error = $state('');
  let creating = $state(false);

  // Tag filter — uses the shared `Tag` collection (same pool as
  // People / Orgs). Selected tags AND-with the text/type filters; the
  // resolver short-circuits to an empty list if no notes carry any of
  // the chosen tags.
  let selectedTags = $state<Tag[]>([]);
  let tagPickerOpen = $state(false);
  let tagQuery = $state('');
  let tagResults = $state<Tag[]>([]);
  let tagTimer: ReturnType<typeof setTimeout> | null = null;
  function queueTagSearch(v: string) {
    if (tagTimer) clearTimeout(tagTimer);
    tagTimer = setTimeout(async () => {
      try { tagResults = await searchTags(v, 12); } catch { tagResults = []; }
    }, 150);
  }
  function openTagPicker() {
    tagPickerOpen = true;
    tagQuery = '';
    queueTagSearch('');
  }
  function pickTag(t: Tag) {
    if (selectedTags.some((x) => x.id === t.id)) {
      // Toggle off.
      selectedTags = selectedTags.filter((x) => x.id !== t.id);
    } else {
      selectedTags = [...selectedTags, t];
    }
    tagQuery = '';
    queueTagSearch('');
  }
  function removeTag(id: number) {
    selectedTags = selectedTags.filter((x) => x.id !== id);
  }

  // Debounced search whenever a knob turns.
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    clearTimeout(timer);
    const query = q;
    const f = filter;
    const archived = showArchived;
    const order = sortBy;
    const tagIds = selectedTags.map((t) => t.id);
    const sc = $scope;
    timer = setTimeout(async () => {
      loading = true;
      error = '';
      try {
        notes = await searchNotes({
          q: query,
          noteType: f === 'all' ? null : f,
          includeArchived: archived,
          tagIds,
          sort: order,
          scope: sc,
          limit: 200,
        });
      } catch (e) {
        error = formatError(e);
      } finally {
        loading = false;
      }
    }, 200);
  });

  let deletingId = $state<number | null>(null);
  async function del(n: Note) {
    if (!confirm(`Delete "${n.title || 'Untitled'}" permanently? This cannot be undone.`)) return;
    deletingId = n.id;
    error = '';
    try {
      await deleteNote(n.id);
      notes = notes.filter((x) => x.id !== n.id);
    } catch (e) {
      error = formatError(e);
    } finally {
      deletingId = null;
    }
  }

  async function newNote() {
    creating = true;
    try {
      const n = await createNote({
        title: 'Untitled',
        note_type: 'general',
        scope: $scope === 'all' ? null : $scope
      });
      goto(`/notes/${n.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }

  function fmtDate(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function snippet(s: string | null | undefined, max = 120): string {
    if (!s) return '';
    const cleaned = s
      .replace(/^---[\s\S]*?---/, '')          // strip frontmatter if present
      .replace(/```[\s\S]*?```/g, '')          // code blocks
      .replace(/[#*_`>~\[\]]/g, '')            // markdown punctuation
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length > max ? cleaned.slice(0, max - 1) + '…' : cleaned;
  }

  const FILTERS: { label: string; value: Filter }[] = [
    { label: 'All',     value: 'all' },
    { label: 'Inbox',   value: 'inbox' },
    { label: 'General', value: 'general' },
    { label: 'Meeting', value: 'meeting' },
    { label: 'Journal', value: 'journal' },
  ];
</script>

<div class="space-y-4">
  <!-- Header row -->
  <!-- Header: title + count on one line, action button below on phone, inline ≥sm. -->
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <h1 class="text-xl font-semibold text-ink-900">
      Notes
      {#if notes.length > 0}
        <span class="ml-2 text-sm font-normal text-ink-500">{notes.length}</span>
      {/if}
    </h1>
    <button
      class="btn-primary inline-flex min-h-[44px] items-center justify-center gap-1.5 sm:w-auto"
      onclick={newNote}
      disabled={creating}
    >
      <Icon name="plus" size={16} />
      New note
    </button>
  </div>

  <!-- Search + filter bar -->
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
    <div class="relative flex-1">
      <Icon name="search" size={16} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
      <input
        bind:value={q}
        type="text"
        placeholder="Search title or body…"
        class="w-full rounded-[12px] border border-surface-border bg-surface-card py-2.5 pl-9 pr-3 text-base focus:border-brand focus:outline-none sm:text-sm"
      />
    </div>
    <!-- Filter chips: horizontal scroll on phone so they never overflow -->
    <div class="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 sm:mx-0 sm:px-0">
      {#each FILTERS as f}
        <button
          class="chip {filter === f.value ? 'chip-active' : ''}"
          onclick={() => (filter = f.value)}
        >
          {f.label}
        </button>
      {/each}
      <label class="ml-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-ink-500">
        <input type="checkbox" bind:checked={showArchived} class="accent-brand" />
        Archived
      </label>
      <span class="shrink-0 text-ink-300" aria-hidden="true">·</span>
      <!-- Sort order: by creation date (default) or last updated. -->
      <div
        class="inline-flex shrink-0 items-center rounded-full border border-surface-border bg-surface-card p-0.5 text-xs font-medium"
        role="group"
        aria-label="Sort notes"
      >
        <button
          type="button"
          class="rounded-full px-2.5 py-1 transition {sortBy === 'created' ? 'bg-brand text-white shadow-card' : 'text-ink-500 hover:text-ink-900'}"
          aria-pressed={sortBy === 'created'}
          title="Sort by date created"
          onclick={() => (sortBy = 'created')}
        >Created</button>
        <button
          type="button"
          class="rounded-full px-2.5 py-1 transition {sortBy === 'updated' ? 'bg-brand text-white shadow-card' : 'text-ink-500 hover:text-ink-900'}"
          aria-pressed={sortBy === 'updated'}
          title="Sort by last updated"
          onclick={() => (sortBy = 'updated')}
        >Updated</button>
      </div>
    </div>
  </div>

  <!-- Tag filter — selected tags AND-with the search/type filters. -->
  <div class="flex flex-wrap items-center gap-1.5">
    {#each selectedTags as t (t.id)}
      <span
        class="inline-flex items-center gap-1 border px-2 py-0.5 text-xs font-medium"
        style="background: var(--accent-alpha-10); color: var(--accent-electric); border-color: var(--accent-alpha-30); border-radius: var(--radius-pill);"
      >
        # {t.name}
        <button
          class="rounded-full p-0.5 hover:bg-black/5"
          aria-label={`Remove ${t.name}`}
          onclick={() => removeTag(t.id)}
        ><Icon name="plus" size={10} class="rotate-45" /></button>
      </span>
    {/each}
    {#if !tagPickerOpen}
      <button
        class="inline-flex items-center gap-1 px-2 py-0.5 text-xs"
        style="border: 1px dashed var(--border-subtle); border-radius: var(--radius-pill); color: var(--text-tertiary);"
        onclick={openTagPicker}
      >
        <Icon name="tag" size={12} />
        {selectedTags.length === 0 ? 'Filter by tag…' : 'Add tag…'}
      </button>
    {/if}
  </div>

  {#if tagPickerOpen}
    <div
      class="p-2"
      style="background: var(--bg-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
    >
      <div class="relative">
        <Icon name="search" size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          type="text"
          bind:value={tagQuery}
          oninput={() => queueTagSearch(tagQuery)}
          placeholder="Search tags…"
          class="w-full pl-7 pr-2 py-1.5 text-sm focus:outline-none"
          style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: var(--text-primary);"
          onkeydown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              if (tagQuery) { tagQuery = ''; queueTagSearch(''); }
              else { tagPickerOpen = false; }
            }
          }}
        />
      </div>
      {#if tagResults.length > 0}
        <ul class="mt-1 max-h-72 overflow-y-auto">
          {#each tagResults as t (t.id)}
            {@const picked = selectedTags.some((x) => x.id === t.id)}
            <li>
              <button
                class="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
                style="border-radius: var(--radius-sm);"
                onclick={() => pickTag(t)}
              >
                <span class="truncate"># {t.name}</span>
                <span class="text-xs" style={picked ? 'color: var(--accent-electric);' : 'color: var(--text-tertiary);'}>
                  {picked ? 'selected ✓' : '+'}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if tagQuery.trim()}
        <div class="px-2 py-2 text-xs text-ink-500">No matches.</div>
      {/if}
      <div class="flex justify-end pt-2">
        <button class="btn-ghost text-xs" onclick={() => (tagPickerOpen = false)}>Done</button>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {error}
    </div>
  {/if}

  {#if loading && notes.length === 0}
    <div class="text-sm text-ink-500">Loading…</div>
  {:else if notes.length === 0}
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card px-4 py-10 text-center text-sm text-ink-500">
      No notes yet. Hit <strong>New note</strong> or capture from anywhere on the Hub.
    </div>
  {:else}
    <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
      {#each notes as n}
        <li class="group flex items-stretch">
          <a
            href={`/notes/${n.id}`}
            class="flex min-h-[60px] min-w-0 flex-1 flex-col gap-1 px-4 py-3 transition hover:bg-surface-hover"
            style="touch-action: manipulation;"
          >
            <!-- Title row: take full width, push meta to a second line on
                 narrow viewports so the title isn't squeezed to two words. -->
            <div class="flex min-w-0 items-center gap-2">
              {#if n.is_pinned}
                <span title="Pinned" class="text-amber-500">★</span>
              {/if}
              <span class="truncate text-base font-medium text-ink-900 sm:text-sm">
                {n.title || 'Untitled'}
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
              {#if n.note_type}
                <span class="rounded-full bg-surface-hover px-2 py-0.5">{n.note_type}</span>
              {/if}
              {#if n.status === 'archived'}
                <span class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">archived</span>
              {/if}
              {#if n.priority}<span>· {n.priority}</span>{/if}
              {#if n.is_done}<span class="text-emerald-700">· ✓ done</span>{/if}
              <span class="ml-auto whitespace-nowrap" title={sortBy === 'updated' ? 'Last updated' : 'Created'}>
                {fmtDate(sortBy === 'updated' ? (n.date_updated || n.date_created) : (n.date_created || n.note_date))}
              </span>
            </div>
          </a>
          <!-- Delete: own button outside the <a> so it never navigates.
               Always tappable on touch; reveals on hover on desktop. -->
          <button
            type="button"
            class="flex shrink-0 items-center justify-center px-3 text-ink-400 transition hover:bg-surface-hover hover:text-[color:var(--state-danger)] focus:text-[color:var(--state-danger)] disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
            onclick={() => del(n)}
            disabled={deletingId === n.id}
            aria-label={`Delete ${n.title || 'Untitled'}`}
            title="Delete note"
          >
            <Icon name="trash" size={16} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .chip {
    @apply whitespace-nowrap rounded-full border border-surface-border bg-surface-card px-3 py-1 text-xs text-ink-500 transition;
  }
  .chip:hover { @apply bg-surface-hover; }
  .chip-active { @apply border-brand/50 bg-brand/10 text-brand; }
</style>
