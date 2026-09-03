<script lang="ts">
  // Per-photo tagging panel — lives inside the PhotoGrid lightbox.
  // Tags the current Immich asset to organizations, Projects, People or
  // Events via the photo_link collection. Only ids are stored; the photo
  // stays in Immich. Link CRUD goes through $lib/photos/explore so the
  // `event` link type works without touching directus.ts.
  import { searchOrgs, searchProjects, searchPeople, personName, type Person } from '$lib/directus';
  import {
    listLinksForAsset,
    createLink,
    removeLink,
    searchEvents,
    EXPLORE_META,
    type ExploreCollection,
    type NamedLink
  } from '$lib/photos/explore';
  import Icon from '$lib/Icon.svelte';

  let { assetId, onChanged = null }: { assetId: string; onChanged?: (() => void) | null } = $props();

  let links = $state<NamedLink[]>([]);
  let loading = $state(true);

  let kind = $state<ExploreCollection>('Project');
  let query = $state('');
  let results = $state<{ id: number; label: string }[]>([]);
  let busy = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const KINDS: ExploreCollection[] = ['Project', 'organization', 'Person', 'event'];

  // Reload when the lightbox moves to another asset.
  $effect(() => {
    void assetId;
    loading = true;
    query = '';
    results = [];
    void listLinksForAsset(assetId)
      .then((l) => (links = l))
      .finally(() => (loading = false));
  });

  function onInput() {
    if (timer) clearTimeout(timer);
    const q = query.trim();
    if (q.length < 2) {
      results = [];
      return;
    }
    timer = setTimeout(async () => {
      busy = true;
      try {
        if (kind === 'organization') {
          const rows = (await searchOrgs(q, 8)) as { id: number; name: string | null }[];
          results = rows.map((r) => ({ id: r.id, label: r.name ?? `#${r.id}` }));
        } else if (kind === 'Project') {
          const rows = (await searchProjects(q, 8)) as { id: number; name: string | null }[];
          results = rows.map((r) => ({ id: r.id, label: r.name ?? `#${r.id}` }));
        } else if (kind === 'event') {
          const rows = await searchEvents(q, 8);
          results = rows.map((r) => ({ id: r.id, label: r.name ?? `#${r.id}` }));
        } else {
          const rows = (await searchPeople(q, 8)) as Person[];
          results = rows.map((r) => ({ id: r.id, label: personName(r) }));
        }
      } finally {
        busy = false;
      }
    }, 250);
  }

  async function add(r: { id: number; label: string }) {
    if (links.some((l) => l.collection === kind && l.item_id === r.id)) {
      query = '';
      results = [];
      return;
    }
    const created = await createLink(assetId, kind, r.id);
    links = [{ ...created, name: r.label }, ...links];
    query = '';
    results = [];
    onChanged?.();
  }

  async function remove(l: NamedLink) {
    await removeLink(l.id);
    links = links.filter((x) => x.id !== l.id);
    onChanged?.();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="w-full max-w-md rounded-[12px] bg-white/10 p-3 text-sm text-white backdrop-blur"
  onclick={(e) => e.stopPropagation()}
>
  {#if loading}
    <div class="text-xs text-white/60">Loading tags…</div>
  {:else}
    {#if links.length > 0}
      <ul class="mb-2 flex flex-wrap gap-1.5">
        {#each links as l (l.id)}
          <li class="flex items-center gap-1 rounded-full bg-white/15 py-0.5 pl-2 pr-1 text-xs">
            <Icon name={EXPLORE_META[l.collection].icon} size={11} />
            <a class="hover:underline" href={EXPLORE_META[l.collection].href(l.item_id)}>{l.name}</a>
            <button
              type="button"
              class="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full hover:bg-white/20"
              onclick={() => remove(l)}
              aria-label={`Remove tag ${l.name}`}
            >
              <Icon name="x" size={10} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="flex items-center gap-1.5">
      <div class="inline-flex shrink-0 rounded-[7px] bg-white/10 p-0.5" role="tablist" aria-label="Tag type">
        {#each KINDS as k (k)}
          <button
            type="button"
            role="tab"
            aria-selected={kind === k}
            class="cursor-pointer rounded-[5px] px-2 py-1 text-xs font-medium transition-colors {kind === k ? 'bg-white text-black' : 'text-white/60 hover:text-white'}"
            onclick={() => {
              kind = k;
              results = [];
              if (query.trim().length >= 2) onInput();
            }}
          >{EXPLORE_META[k].label}</button>
        {/each}
      </div>
      <input
        type="search"
        class="min-w-0 flex-1 rounded-[7px] border border-white/20 bg-white/10 px-2 py-1 text-xs text-white placeholder-white/40 outline-none focus:border-white/50"
        placeholder={`Tag ${EXPLORE_META[kind].label.toLowerCase()}…`}
        bind:value={query}
        oninput={onInput}
      />
    </div>

    {#if busy}
      <div class="mt-1.5 text-xs text-white/50">Searching…</div>
    {:else if results.length > 0}
      <ul class="mt-1.5 max-h-44 overflow-y-auto rounded-[8px] bg-black/50">
        {#each results as r (r.id)}
          <li>
            <button
              type="button"
              class="w-full cursor-pointer px-2.5 py-1.5 text-left text-xs hover:bg-white/15"
              onclick={() => add(r)}
            >{r.label}</button>
          </li>
        {/each}
      </ul>
    {:else if query.trim().length >= 2}
      <div class="mt-1.5 text-xs text-white/50">No matches.</div>
    {/if}
  {/if}
</div>
