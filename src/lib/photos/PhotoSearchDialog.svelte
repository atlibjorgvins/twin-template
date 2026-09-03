<script lang="ts">
  // Search the photo library (Immich) and pick an image. A keyword
  // matches two ways at once: SOURCES — projects, orgs, people (faces)
  // and events by name — and CONTENT — Immich semantic search (scenes,
  // places, objects). Picking imports the photo into Directus (so the
  // studio renderer can use it) and returns the new file id.
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import {
    assetThumbUrl,
    searchImmichAssets,
    smartSearchImmich,
    fetchAssetFile,
    personThumbUrl
  } from '$lib/immich';
  import { assetIdsForEntity, clustersForPerson, searchEvents } from '$lib/photos/explore';
  import {
    searchProjects,
    searchOrgs,
    searchPeople,
    personName,
    uploadFile,
    formatError,
    type Person,
    type Organization,
    type Project
  } from '$lib/directus';
  import { studioFolderId } from '$lib/studio/data';

  type Props = { open: boolean; onPick: (fileId: string) => void; onClose: () => void };
  let { open = $bindable(false), onPick, onClose }: Props = $props();

  type Source = { kind: 'Project' | 'organization' | 'Person' | 'event'; id: number; label: string };

  let q = $state('');
  let sources = $state<Source[]>([]);
  let active = $state<Source | null>(null);
  let assetIds = $state<string[]>([]);
  let loading = $state(false);
  let importing = $state<string | null>(null);
  let error = $state('');
  let smartEmpty = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Load a recent slice to browse when there's no query.
  async function loadRecent() {
    loading = true;
    try {
      const r = await searchImmichAssets({ size: 48, type: 'IMAGE' });
      assetIds = r.items.map((a) => a.id);
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    if (open && !q && !active) void loadRecent();
  });

  function onQuery(v: string) {
    q = v;
    active = null;
    if (timer) clearTimeout(timer);
    if (!v.trim()) {
      sources = [];
      smartEmpty = false;
      void loadRecent();
      return;
    }
    timer = setTimeout(runSearch, 220);
  }

  async function runSearch() {
    loading = true;
    error = '';
    smartEmpty = false;
    try {
      const [projects, orgs, people, events, smart] = await Promise.all([
        searchProjects(q, 5).catch(() => []),
        searchOrgs(q, 5).catch(() => []),
        searchPeople(q, 6).catch(() => []),
        searchEvents(q, 5).catch(() => []),
        smartSearchImmich(q, { size: 60 }).catch(() => [])
      ]);
      const src: Source[] = [];
      for (const p of projects as Project[]) src.push({ kind: 'Project', id: p.id, label: p.name ?? `#${p.id}` });
      for (const o of orgs as Organization[]) src.push({ kind: 'organization', id: o.id, label: o.name ?? `#${o.id}` });
      for (const p of people as Person[]) src.push({ kind: 'Person', id: p.id, label: personName(p) });
      for (const e of events as { id: number; name: string }[]) src.push({ kind: 'event', id: e.id, label: e.name });
      sources = src;
      assetIds = smart.map((a) => a.id);
      smartEmpty = smart.length === 0;
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }

  async function pickSource(s: Source) {
    active = s;
    loading = true;
    error = '';
    try {
      if (s.kind === 'Person') {
        const clusters = await clustersForPerson(s.id);
        if (!clusters.length) {
          assetIds = [];
        } else {
          const r = await searchImmichAssets({ personIds: clusters, size: 100, type: 'IMAGE' });
          assetIds = r.items.map((a) => a.id);
        }
      } else {
        assetIds = await assetIdsForEntity(s.kind, s.id);
      }
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }

  async function pickAsset(id: string) {
    importing = id;
    error = '';
    try {
      const folder = await studioFolderId();
      const label = active?.label || q || 'photo';
      const file = await fetchAssetFile(id, label, 'preview');
      const fileId = await uploadFile(file, { folder: folder ?? undefined, title: `Studio — ${label}` });
      onPick(fileId);
      reset();
    } catch (e) {
      error = formatError(e);
    } finally {
      importing = null;
    }
  }

  function reset() {
    q = '';
    sources = [];
    active = null;
    assetIds = [];
    smartEmpty = false;
  }
  function close() {
    if (importing) return;
    reset();
    onClose();
  }

  const KIND_ICON = { Project: 'sparkles', organization: 'building', Person: 'users', event: 'flag' } as const;
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-900/40" role="presentation" onclick={close}>
    <div
      class="flex max-h-[85vh] w-full max-w-2xl flex-col bg-surface-card"
      style="border:1px solid var(--border-subtle); border-radius:var(--radius-lg); box-shadow:0 24px 60px rgba(0,0,0,0.32);"
      role="dialog" aria-modal="true" aria-label="Add image from library"
      onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between gap-2 border-b border-surface-divider px-4 py-3">
        <h2 class="font-display text-sm font-semibold">Add image from library</h2>
        <button type="button" class="text-ink-400 hover:text-ink-700" aria-label="Close" onclick={close}><Icon name="x" size={16} /></button>
      </div>

      <div class="border-b border-surface-divider px-4 py-3">
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300"><Icon name="search" size={15} /></span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="input w-full pl-9 text-sm"
            placeholder="Search by place, person, project, event, or what's in the photo…"
            value={q}
            oninput={(e) => onQuery((e.currentTarget as HTMLInputElement).value)}
            autofocus
          />
        </div>
        {#if sources.length}
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#each sources as s (s.kind + s.id)}
              <button
                class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs {active?.kind === s.kind && active?.id === s.id ? 'border-[var(--accent-electric)] bg-surface-hover text-ink-900' : 'border-surface-border text-ink-600 hover:bg-surface-hover'}"
                onclick={() => pickSource(s)}
              >
                {#if s.kind === 'Person'}
                  <Avatar name={s.label} src={personThumbUrl(String(s.id))} size={16} />
                {:else}
                  <Icon name={KIND_ICON[s.kind]} size={12} />
                {/if}
                {s.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if error}
        <div class="mx-4 mt-3 rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">{error}</div>
      {/if}

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div class="mb-2 text-[11px] text-ink-400">
          {#if loading}Searching…
          {:else if active}{active.label} · {assetIds.length} photo{assetIds.length === 1 ? '' : 's'}
          {:else if q}Photos matching “{q}” · {assetIds.length}
          {:else}Recent photos · pick a result, or search above
          {/if}
        </div>

        {#if !loading && q && !active && smartEmpty && !assetIds.length}
          <div class="rounded-md border border-dashed border-surface-border p-4 text-center text-xs text-ink-400">
            No content matches{sources.length ? '' : ' — and no project/person/event by that name'}.
            {#if sources.length}Pick a source chip above.{/if}
          </div>
        {/if}

        {#if assetIds.length}
          <div class="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {#each assetIds as id (id)}
              <button
                class="group relative aspect-square overflow-hidden rounded-md border border-surface-border disabled:opacity-50"
                onclick={() => pickAsset(id)}
                disabled={!!importing}
                title="Add this photo"
              >
                <img src={assetThumbUrl(id)} alt="" loading="lazy" class="h-full w-full object-cover transition group-hover:scale-105" />
                {#if importing === id}
                  <span class="absolute inset-0 grid place-items-center bg-ink-900/50 text-[10px] text-white">Adding…</span>
                {:else}
                  <span class="absolute inset-0 hidden place-items-center bg-ink-900/40 text-white group-hover:grid"><Icon name="plus" size={18} /></span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
