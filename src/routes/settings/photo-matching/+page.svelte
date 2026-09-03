<script lang="ts">
  // Face matching — the curation chore, moved out of the photo navigator.
  // Immich groups the library into face clusters; here you decide who each
  // unknown face belongs to (or hide strangers). Picking a Person stores
  // the mapping in Directus photo_person, so every past and future photo
  // of that face links to the record and surfaces in the navigator.
  import { onMount } from 'svelte';
  import {
    immichAvailable,
    immichIndexing,
    listImmichPeople,
    personThumbUrl,
    renameImmichPerson,
    hideImmichPerson,
    searchImmichAssets,
    type ImmichPerson,
    type ImmichAsset
  } from '$lib/immich';
  import {
    listPhotoPersons,
    upsertPhotoPerson,
    searchPeople,
    personName,
    type Person,
    type PhotoPerson
  } from '$lib/directus';
  import PhotoGrid from '$lib/photos/PhotoGrid.svelte';
  import FaceMapperDialog from '$lib/photos/FaceMapperDialog.svelte';
  import Icon from '$lib/Icon.svelte';

  let available = $state<boolean | null>(null);
  let indexing = $state<{ active: number; waiting: number } | null>(null);

  let clusters = $state<ImmichPerson[]>([]);
  let clustersTotal = $state(0);
  let clustersPage = $state(1);
  let clustersHasMore = $state(false);
  let clustersLoading = $state(false);
  type Mapping = PhotoPerson & {
    person?: { id: number; full_name: string | null; first_name: string | null; last_name: string | null } | null;
  };
  let mappings = $state<Record<string, Mapping>>({});

  let openCluster = $state<ImmichPerson | null>(null);
  let clusterAssets = $state<ImmichAsset[]>([]);
  let clusterTotal = $state(0);
  let clusterNextPage = $state<number | null>(null);
  let clusterLoading = $state(false);

  let pickerFor = $state<string | null>(null);
  let pickerQuery = $state('');
  let pickerResults = $state<Person[]>([]);
  let pickerBusy = $state(false);
  let pickerTimer: ReturnType<typeof setTimeout> | undefined;

  let peopleTab = $state<'unmapped' | 'mapped'>('unmapped');
  const unmappedClusters = $derived(clusters.filter((c) => !mappings[c.id]?.person_id));
  const mappedClusters = $derived(clusters.filter((c) => !!mappings[c.id]?.person_id));
  const unmappedCount = $derived(unmappedClusters.length);
  const mappedCount = $derived(mappedClusters.length);
  const visibleClusters = $derived(peopleTab === 'mapped' ? mappedClusters : unmappedClusters);

  let mapperFor = $state<ImmichPerson | null>(null);
  let error = $state<string | null>(null);

  onMount(async () => {
    available = await immichAvailable();
    if (!available) return;
    void immichIndexing().then((j) => (indexing = j)).catch(() => {});
    await Promise.all([loadClusters(1), loadMappings()]);
  });

  // Immich returns clusters biggest-first, and the biggest are usually the
  // ones already mapped — so the unmapped review queue lives deeper in the
  // list (here: ~104 of 3.9k clusters are mapped). When the loaded set has
  // nothing left to map but more pages exist, pull the next page
  // automatically so "To map" fills in instead of showing a misleading 0.
  let autoPages = $state(0);
  $effect(() => {
    if (
      peopleTab === 'unmapped' &&
      !clustersLoading &&
      clustersHasMore &&
      clusters.length > 0 &&
      unmappedClusters.length === 0 &&
      autoPages < 50 // safety cap (~5k clusters)
    ) {
      autoPages += 1;
      void loadClusters(clustersPage + 1);
    }
  });

  async function loadClusters(page: number) {
    clustersLoading = true;
    try {
      const r = await listImmichPeople(page, 100);
      clusters = page === 1 ? r.people : [...clusters, ...r.people];
      clustersTotal = r.total;
      clustersHasMore = r.hasNextPage;
      clustersPage = page;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      clustersLoading = false;
    }
  }

  async function loadMappings() {
    try {
      const rows = await listPhotoPersons();
      const next: Record<string, Mapping> = {};
      for (const r of rows) {
        const person = (r as Mapping).person_id;
        next[r.id] = {
          ...r,
          person: person && typeof person === 'object' ? (person as Mapping['person']) : null,
          person_id:
            person && typeof person === 'object'
              ? ((person as { id: number }).id ?? null)
              : ((person as number | null) ?? null)
        };
      }
      mappings = next;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function mappedName(c: ImmichPerson): string | null {
    const m = mappings[c.id];
    if (!m?.person_id) return null;
    const p = m.person;
    return p ? p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(' ') : `#${m.person_id}`;
  }

  async function toggleCluster(c: ImmichPerson) {
    if (openCluster?.id === c.id) {
      openCluster = null;
      return;
    }
    openCluster = c;
    clusterAssets = [];
    clusterTotal = 0;
    clusterNextPage = null;
    await loadClusterAssets(c, 1);
  }

  async function loadClusterAssets(c: ImmichPerson, page: number) {
    clusterLoading = true;
    try {
      const r = await searchImmichAssets({ personIds: [c.id], page, size: 60 });
      clusterAssets = page === 1 ? r.items : [...clusterAssets, ...r.items];
      clusterTotal = r.total;
      clusterNextPage = r.nextPage;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      clusterLoading = false;
    }
  }

  function openPicker(c: ImmichPerson) {
    pickerFor = pickerFor === c.id ? null : c.id;
    // A cluster already named in Immich seeds the search — most of the
    // time the match is the first result and mapping is a single click.
    pickerQuery = pickerFor ? (c.name ?? '').trim() : '';
    pickerResults = [];
    if (pickerQuery) onPickerInput();
  }

  function onPickerInput() {
    if (pickerTimer) clearTimeout(pickerTimer);
    const q = pickerQuery.trim();
    if (q.length < 2) {
      pickerResults = [];
      return;
    }
    pickerTimer = setTimeout(async () => {
      pickerBusy = true;
      try {
        pickerResults = await searchPeople(q, 8);
      } finally {
        pickerBusy = false;
      }
    }, 250);
  }

  async function mapCluster(c: ImmichPerson, p: Person) {
    const name = personName(p);
    try {
      await upsertPhotoPerson(c.id, {
        person_id: p.id,
        immich_name: c.name || name,
        mapped_at: new Date().toISOString(),
        hidden: false
      });
      void renameImmichPerson(c.id, name).catch(() => {});
      pickerFor = null;
      await loadMappings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function unmapCluster(c: ImmichPerson) {
    try {
      await upsertPhotoPerson(c.id, { person_id: null, mapped_at: null });
      await loadMappings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function hideCluster(c: ImmichPerson) {
    try {
      await upsertPhotoPerson(c.id, { hidden: true });
      void hideImmichPerson(c.id).catch(() => {});
      clusters = clusters.filter((x) => x.id !== c.id);
      if (openCluster?.id === c.id) openCluster = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<svelte:head><title>Face matching · Settings</title></svelte:head>

<section class="space-y-5">
  <header>
    <a href="/settings" class="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700">
      <Icon name="chevron-left" size={13} /> Settings
    </a>
    <div class="hero-eyebrow mt-2">Catalogues</div>
    <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
      Face matching
    </h1>
    <p class="mt-1 text-sm text-ink-500">
      Tell the hub who each face belongs to. Mapped faces flow into the
      <a href="/photos" class="text-brand hover:underline">photo navigator</a> and onto each person's page.
    </p>
  </header>

  {#if available === null}
    <div class="card p-6 text-sm text-ink-400">Connecting to the photo engine…</div>
  {:else if available === false}
    <div class="card p-6 text-sm">
      <div class="font-medium text-ink-900">Photo engine unreachable</div>
      <p class="mt-1 text-ink-500">
        Immich (port 8444 on the NAS) didn't answer. Make sure you're on the tailnet and the
        Immich stack is running.
      </p>
    </div>
  {:else}
    {#if indexing && indexing.active + indexing.waiting > 0}
      <div class="flex items-center gap-2 rounded-[10px] border border-surface-border bg-surface-card px-4 py-2.5 text-xs text-ink-500">
        <Icon name="sparkles" size={14} class="shrink-0" />
        Still indexing — {(indexing.active + indexing.waiting).toLocaleString('is-IS')} jobs queued.
        Faces keep appearing as the scan progresses.
      </div>
    {/if}

    {#if error}
      <div class="rounded-[10px] border border-red-300 bg-red-50 px-4 py-2.5 text-xs text-red-700">{error}</div>
    {/if}

    <div class="card">
      <div class="card-header">
        <span class="card-title"><Icon name="users" size={16} /> Faces
          {#if clustersTotal > 0}<span class="font-normal text-ink-300">{clustersTotal} loaded</span>{/if}
        </span>
        <div class="inline-flex rounded-[8px] border border-surface-border p-0.5 text-xs" role="tablist" aria-label="Mapping status">
          <button
            type="button"
            role="tab"
            aria-selected={peopleTab === 'unmapped'}
            class="cursor-pointer rounded-[6px] px-3 py-1.5 font-medium transition-colors {peopleTab === 'unmapped' ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-700'}"
            onclick={() => (peopleTab = 'unmapped')}
          >To map <span class="font-normal opacity-70">{unmappedCount}</span></button>
          <button
            type="button"
            role="tab"
            aria-selected={peopleTab === 'mapped'}
            class="cursor-pointer rounded-[6px] px-3 py-1.5 font-medium transition-colors {peopleTab === 'mapped' ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-700'}"
            onclick={() => (peopleTab = 'mapped')}
          >Mapped <span class="font-normal opacity-70">{mappedCount}</span></button>
        </div>
      </div>

      {#if clusters.length === 0}
        <div class="p-6 text-sm text-ink-400">
          No face clusters yet — face recognition is still working through the library. Check back in a while.
        </div>
      {:else if visibleClusters.length === 0}
        <div class="p-6 text-sm text-ink-400">
          {#if peopleTab === 'unmapped'}
            {#if clustersLoading || (clustersHasMore && autoPages > 0)}
              Scanning for faces to map… ({clusters.length.toLocaleString('is-IS')} of {clustersTotal.toLocaleString('is-IS')} clusters)
            {:else if clustersHasMore}
              Nothing to map in the loaded set. <button type="button" class="text-brand hover:underline" onclick={() => loadClusters(clustersPage + 1)}>Load more</button> to keep going.
            {:else}
              Nothing left to map — every face is mapped or hidden. Nice work.
            {/if}
          {:else}
            No mapped faces yet — start with the “To map” tab.
          {/if}
        </div>
      {:else}
        <ul class="divide-y divide-surface-divider">
          {#each visibleClusters as c (c.id)}
            {@const mapped = mappedName(c)}
            <li>
              <div class="flex items-center gap-3 px-4 py-2.5">
                <button
                  type="button"
                  class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                  onclick={() => toggleCluster(c)}
                  aria-expanded={openCluster?.id === c.id}
                >
                  <img
                    src={personThumbUrl(c.id)}
                    alt=""
                    loading="lazy"
                    class="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-surface-border"
                  />
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-ink-900">
                      {mapped ?? (c.name || 'Unknown face')}
                    </div>
                    <div class="truncate text-xs text-ink-400">
                      {#if mapped}
                        mapped{c.name && c.name !== mapped ? ` · "${c.name}" in Immich` : ''}
                      {:else if c.name}
                        named "{c.name}" in Immich — not mapped yet
                      {:else}
                        who is this?
                      {/if}
                    </div>
                  </div>
                </button>

                {#if mapped}
                  {@const m = mappings[c.id]}
                  <a class="text-xs text-brand hover:underline" href={`/people/${m.person_id}`}>open</a>
                  <button type="button" class="btn-ghost text-xs" onclick={() => unmapCluster(c)}>unmap</button>
                {:else}
                  <button type="button" class="btn-primary px-2.5 py-1 text-xs" onclick={() => openPicker(c)}>Map</button>
                  <button
                    type="button"
                    class="btn-ghost text-xs"
                    onclick={() => (mapperFor = c)}
                    title="Know the face but not the name? Find them by an org or project"
                  >by relation</button>
                  <button type="button" class="btn-ghost text-xs" onclick={() => hideCluster(c)} title="Not someone to track — hide this cluster">hide</button>
                {/if}
              </div>

              {#if pickerFor === c.id}
                <div class="border-t border-surface-divider bg-surface-hover/40 px-4 py-3">
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    type="search"
                    class="input w-full text-sm"
                    placeholder="Search people…"
                    bind:value={pickerQuery}
                    oninput={onPickerInput}
                    autofocus
                  />
                  {#if pickerBusy}
                    <div class="mt-2 text-xs text-ink-400">Searching…</div>
                  {:else if pickerResults.length > 0}
                    <ul class="mt-2 divide-y divide-surface-divider rounded-[10px] border border-surface-border bg-surface-card">
                      {#each pickerResults as p (p.id)}
                        <li>
                          <button
                            type="button"
                            class="w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-surface-hover"
                            onclick={() => mapCluster(c, p)}
                          >{personName(p)}</button>
                        </li>
                      {/each}
                    </ul>
                  {:else if pickerQuery.trim().length >= 2}
                    <div class="mt-2 text-xs text-ink-400">No matches.</div>
                  {/if}
                </div>
              {/if}

              {#if openCluster?.id === c.id}
                <div class="border-t border-surface-divider px-4 py-3">
                  {#if clusterLoading && clusterAssets.length === 0}
                    <div class="text-xs text-ink-400">Loading photos…</div>
                  {:else}
                    <PhotoGrid
                      assets={clusterAssets}
                      total={clusterTotal}
                      onMore={clusterNextPage ? () => loadClusterAssets(c, clusterNextPage!) : null}
                      loadingMore={clusterLoading}
                      taggable
                    />
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
        {#if clustersHasMore}
          <div class="border-t border-surface-divider p-3 text-center">
            <button type="button" class="btn-ghost text-xs" onclick={() => loadClusters(clustersPage + 1)} disabled={clustersLoading}>
              {clustersLoading ? 'Loading…' : 'Load more clusters'}
            </button>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</section>

{#if mapperFor}
  <FaceMapperDialog
    cluster={mapperFor}
    onClose={() => (mapperFor = null)}
    onMap={(p) => mapCluster(mapperFor!, p)}
  />
{/if}
