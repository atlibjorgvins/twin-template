<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import {
    searchTags,
    createTag,
    attachTagToPerson,
    detachTagFromPerson,
    attachTagToOrganization,
    detachTagFromOrganization,
    type Tag,
    type PersonTag,
    type OrganizationTag
  } from '$lib/directus';

  // Caller passes either a person OR an org id, and the corresponding link
  // rows. We bind back so the parent re-renders the pill list optimistically.
  type Props = {
    target: 'person' | 'organization';
    targetId: number;
    links: PersonTag[] | OrganizationTag[];
  };
  let { target, targetId, links = $bindable() }: Props = $props();

  function tagOf(link: PersonTag | OrganizationTag): Tag | null {
    return link.tag_id && typeof link.tag_id === 'object' ? (link.tag_id as Tag) : null;
  }

  // ── Picker state ──────────────────────────────────────────────────────────
  let adding = $state(false);
  let query = $state('');
  let results = $state<Tag[]>([]);
  let searched = $state(false);
  let busy = $state(false);
  let error = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEl = $state<HTMLInputElement | null>(null);

  function openAdd() {
    adding = true;
    query = '';
    results = [];
    searched = false;
    error = '';
    // Pre-fill suggestions on open.
    queueSearch('');
    // Focus the input as soon as it mounts.
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
        error = e instanceof Error ? e.message : String(e);
      }
    }, 150);
  }

  // Tags already on this entity — exclude from picker so we don't double-attach.
  const linkedIds = $derived(new Set(links.map((l) => tagOf(l)?.id).filter(Boolean) as number[]));
  const filtered = $derived(results.filter((t) => !linkedIds.has(t.id)));

  async function attach(tag: Tag) {
    busy = true;
    error = '';
    try {
      const created =
        target === 'person'
          ? await attachTagToPerson(targetId, tag.id)
          : await attachTagToOrganization(targetId, tag.id);
      // Re-attach the expanded tag so the pill renders without a re-fetch.
      const withTag = { ...created, tag_id: tag } as PersonTag | OrganizationTag;
      links = [...(links as (PersonTag | OrganizationTag)[]), withTag] as
        | PersonTag[]
        | OrganizationTag[];
      // Stay in editor mode — clear the input, refresh suggestions, refocus
      // so the user can keep typing the next tag without reaching for the
      // mouse. Done/Escape closes the editor.
      query = '';
      searched = false;
      queueSearch('');
      inputEl?.focus();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function createAndAttach() {
    const name = query.trim().toLowerCase();
    if (!name) return;
    busy = true;
    error = '';
    try {
      const t = await createTag({ name });
      await attach(t);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      busy = false; // attach didn't run
    }
  }

  async function detach(link: PersonTag | OrganizationTag) {
    busy = true;
    error = '';
    try {
      if (target === 'person') await detachTagFromPerson(link.id);
      else await detachTagFromOrganization(link.id);
      links = (links as (PersonTag | OrganizationTag)[]).filter((l) => l.id !== link.id) as
        | PersonTag[]
        | OrganizationTag[];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!adding) return;
    if (e.key === 'Escape') cancelAdd();
    if (e.key === 'Enter') {
      e.preventDefault();
      // Pick the top match if it isn't already linked, else create.
      const top = filtered[0];
      if (top && top.name.toLowerCase() === query.trim().toLowerCase()) attach(top);
      else if (filtered.length === 1) attach(filtered[0]);
      else if (query.trim()) createAndAttach();
    }
  }

  // Pill background — use the tag's saved color if any, fall back to neutral.
  function pillStyle(t: Tag | null) {
    if (!t?.color) return '';
    return `background-color: ${t.color}1f; color: ${t.color}; border-color: ${t.color}55;`;
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="card">
  <div class="card-header">
    <span class="card-title">
      <Icon name="tag" size={16} /> Tags
      <span class="text-ink-300 font-normal">{links.length}</span>
    </span>
    {#if !adding}
      <button
        class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
        aria-label="Add tag"
        onclick={openAdd}
      ><Icon name="plus" size={14} /> Add tag</button>
    {/if}
  </div>

  <div class="px-4 pb-4">
    {#if links.length === 0 && !adding}
      <div class="text-sm text-ink-400">No tags yet. Add one to group this with others.</div>
    {/if}

    <div class="flex flex-wrap items-center gap-1.5">
      {#each links as link (link.id)}
        {@const t = tagOf(link)}
        {#if t}
          <span
            class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-hover px-2 py-0.5 text-xs text-ink-700"
            style={pillStyle(t)}
            title={t.description ?? ''}
          >
            {t.name}
            <button
              class="-mr-1 rounded-full p-0.5 text-ink-400 hover:bg-black/10 hover:text-ink-700 disabled:opacity-50"
              aria-label={`Remove tag ${t.name}`}
              onclick={() => detach(link)}
              disabled={busy}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" width="10" height="10" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </span>
        {/if}
      {/each}
    </div>

    {#if adding}
      <div class="relative mt-3 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3">
        <label class="block text-xs text-ink-400 mb-1" for="tag-q">Tag</label>
        <input
          bind:this={inputEl}
          id="tag-q"
          type="text"
          autocomplete="off"
          class="input w-full"
          placeholder="Type a tag, press Enter, repeat. Done to close."
          value={query}
          oninput={onInput}
        />

        {#if filtered.length > 0}
          <ul class="mt-2 flex flex-wrap gap-1.5">
            {#each filtered as t (t.id)}
              <li>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2 py-0.5 text-xs hover:bg-surface-hover disabled:opacity-50"
                  style={pillStyle(t)}
                  onclick={() => attach(t)}
                  disabled={busy}
                >+ {t.name}</button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if searched && query.trim() && !filtered.some((t) => t.name.toLowerCase() === query.trim().toLowerCase())}
          <button
            type="button"
            class="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline disabled:opacity-50"
            onclick={createAndAttach}
            disabled={busy || !query.trim()}
          >
            <Icon name="plus" size={12} />
            {busy ? 'Creating…' : `Create "${query.trim().toLowerCase()}" and add`}
          </button>
        {/if}

        {#if error}
          <div class="mt-2 text-xs text-tag-salesText">{error}</div>
        {/if}

        <div class="mt-3 flex items-center justify-end gap-2">
          <button class="btn-ghost" onclick={cancelAdd} disabled={busy}>Done</button>
        </div>
      </div>
    {/if}
  </div>
</div>
