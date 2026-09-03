<script lang="ts">
  // Batch-tag popover — pick a project / org / person / event and link all
  // the selected photos to it at once (photo_link via explore.tagAssetsToEntity,
  // which dedupes). Used by PhotoGrid's selection mode.
  import { searchOrgs, searchProjects, searchPeople, personName, type Person } from '$lib/directus';
  import {
    tagAssetsToEntity,
    searchEvents,
    EXPLORE_META,
    EXPLORE_ORDER,
    type ExploreCollection
  } from '$lib/photos/explore';
  import Icon from '$lib/Icon.svelte';

  let {
    assetIds,
    onApplied,
    onClose
  }: {
    assetIds: string[];
    onApplied: (label: string, added: number, skipped: number) => void;
    onClose: () => void;
  } = $props();

  let kind = $state<ExploreCollection>('event');
  let query = $state('');
  let results = $state<{ id: number; label: string }[]>([]);
  let searching = $state(false);
  let applying = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function onInput() {
    if (timer) clearTimeout(timer);
    const q = query.trim();
    if (q.length < 2) {
      results = [];
      return;
    }
    timer = setTimeout(async () => {
      searching = true;
      try {
        if (kind === 'organization') {
          results = ((await searchOrgs(q, 8)) as { id: number; name: string | null }[]).map((r) => ({ id: r.id, label: r.name ?? `#${r.id}` }));
        } else if (kind === 'Project') {
          results = ((await searchProjects(q, 8)) as { id: number; name: string | null }[]).map((r) => ({ id: r.id, label: r.name ?? `#${r.id}` }));
        } else if (kind === 'event') {
          results = (await searchEvents(q, 8)).map((r) => ({ id: r.id, label: r.name ?? `#${r.id}` }));
        } else {
          results = ((await searchPeople(q, 8)) as Person[]).map((r) => ({ id: r.id, label: personName(r) }));
        }
      } finally {
        searching = false;
      }
    }, 250);
  }

  async function apply(r: { id: number; label: string }) {
    applying = true;
    try {
      const { added, skipped } = await tagAssetsToEntity(assetIds, kind, r.id);
      onApplied(r.label, added, skipped);
    } finally {
      applying = false;
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="w-full max-w-md rounded-t-[16px] border border-surface-border bg-surface-card p-4 shadow-xl sm:rounded-[16px]"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="mb-3 flex items-center justify-between">
      <div class="card-title"><Icon name="tag" size={16} /> Tag {assetIds.length} photo{assetIds.length === 1 ? '' : 's'}</div>
      <button type="button" class="btn-ghost !p-1.5" onclick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
    </div>

    <div class="inline-flex flex-wrap gap-0.5 rounded-[8px] border border-surface-border p-0.5 text-xs" role="tablist" aria-label="Tag type">
      {#each EXPLORE_ORDER as k (k)}
        <button
          type="button"
          role="tab"
          aria-selected={kind === k}
          class="cursor-pointer rounded-[6px] px-2.5 py-1.5 font-medium transition-colors {kind === k ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-700'}"
          onclick={() => { kind = k; results = []; if (query.trim().length >= 2) onInput(); }}
        >{EXPLORE_META[k].label}</button>
      {/each}
    </div>

    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="search"
      class="input mt-2 w-full text-sm"
      placeholder={`Search ${EXPLORE_META[kind].plural.toLowerCase()}…`}
      bind:value={query}
      oninput={onInput}
      autofocus
    />

    {#if applying}
      <div class="mt-2 text-xs text-ink-400">Tagging…</div>
    {:else if searching}
      <div class="mt-2 text-xs text-ink-400">Searching…</div>
    {:else if results.length > 0}
      <ul class="mt-2 max-h-60 divide-y divide-surface-divider overflow-y-auto rounded-[10px] border border-surface-border">
        {#each results as r (r.id)}
          <li>
            <button type="button" class="w-full cursor-pointer px-3 py-2.5 text-left text-sm hover:bg-surface-hover" onclick={() => apply(r)}>{r.label}</button>
          </li>
        {/each}
      </ul>
    {:else if query.trim().length >= 2}
      <div class="mt-2 text-xs text-ink-400">No matches.</div>
    {/if}
  </div>
</div>
