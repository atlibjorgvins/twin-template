<script lang="ts">
  // Photo navigator — explore the NAS photo library (indexed by Immich).
  // Three views:
  //
  //   Map      — geotagged photos on a Leaflet map, clustered by place;
  //              click a spot to see the photos taken there.
  //   Timeline — month-bucket browse of the whole library.
  //   People   — read-only browse of people whose face has been matched;
  //              open one to see every photo of them.
  //
  // The matching chore itself lives in Settings → Face matching. Everything
  // loads client-side: Immich is tailnet-only and not reachable at build time.
  import { onMount } from 'svelte';
  import {
    immichAvailable,
    immichIndexing,
    immichStatistics,
    listImmichPeople,
    personThumbUrl,
    searchImmichAssets,
    searchRatedAssets,
    timelineBuckets,
    mapMarkers,
    type ImmichPerson,
    type ImmichAsset,
    type TimelineBucket,
    type MapMarker
  } from '$lib/immich';
  import { listPhotoPersons, type PhotoPerson } from '$lib/directus';
  import PhotoGrid from '$lib/photos/PhotoGrid.svelte';
  import PhotoMap from '$lib/photos/PhotoMap.svelte';
  import PhotoFolders from '$lib/photos/PhotoFolders.svelte';
  import PhotoAlbums from '$lib/photos/PhotoAlbums.svelte';
  import Icon from '$lib/Icon.svelte';

  type View = 'map' | 'timeline' | 'people' | 'albums' | 'folders';
  let view = $state<View>('timeline');

  // ── star rating filter (N and up) ───────────────────────────────
  // Immich filters by exact rating, so searchRatedAssets merges the range.
  // Applies to Timeline (flat grid), People (per cluster) and Tagged
  // (intersection); the Map can't filter by rating (markers ignore it).
  let minRating = $state(0);
  let ratedAssets = $state<ImmichAsset[]>([]);
  let ratedLoading = $state(false);
  let ratedShown = $state(120);
  const ratedSlice = $derived(ratedAssets.slice(0, ratedShown));
  const ratedIdSet = $derived(new Set(ratedAssets.map((a) => a.id)));

  function reloadRated() {
    if (minRating <= 0) {
      ratedAssets = [];
      return;
    }
    ratedLoading = true;
    searchRatedAssets(minRating)
      .then((a) => (ratedAssets = a))
      .catch((e) => (error = e instanceof Error ? e.message : String(e)))
      .finally(() => (ratedLoading = false));
  }
  // Load the global rated set whenever the threshold changes (feeds the
  // Timeline grid + the Tagged intersection).
  $effect(() => {
    void minRating;
    ratedShown = 120;
    reloadRated();
  });

  function setMinRating(n: number) {
    minRating = minRating === n ? 0 : n;
    if (openCluster) void loadClusterAssets(openCluster, 1); // re-scope open person
  }

  // ── connection / indexing status ────────────────────────────────
  let available = $state<boolean | null>(null);
  let indexing = $state<{ active: number; waiting: number } | null>(null);
  let stats = $state<{ photos: number; videos: number } | null>(null);
  let error = $state<string | null>(null);

  // ── people (matched face clusters, read-only) ───────────────────
  let clusters = $state<ImmichPerson[]>([]);
  type Mapping = PhotoPerson & {
    person?: { id: number; full_name: string | null; first_name: string | null; last_name: string | null } | null;
  };
  let mappings = $state<Record<string, Mapping>>({});
  const mappedClusters = $derived(clusters.filter((c) => !!mappings[c.id]?.person_id));

  let openCluster = $state<ImmichPerson | null>(null);
  let clusterAssets = $state<ImmichAsset[]>([]);
  let clusterTotal = $state(0);
  let clusterNextPage = $state<number | null>(null);
  let clusterLoading = $state(false);

  // ── browse (timeline) ───────────────────────────────────────────
  let buckets = $state<TimelineBucket[]>([]);
  let openBucket = $state<TimelineBucket | null>(null);
  let bucketAssets = $state<ImmichAsset[]>([]);
  let bucketNextPage = $state<number | null>(null);
  let bucketLoading = $state(false);

  // ── map ─────────────────────────────────────────────────────────
  let markers = $state<MapMarker[]>([]);
  let markersLoaded = $state(false);
  let markersLoading = $state(false);
  // Photos at the place the user clicked on the map. A spot can hold
  // hundreds of photos, so we reveal them a page at a time.
  const MAP_PAGE = 120;
  let mapPicked = $state<ImmichAsset[]>([]);
  let mapShown = $state(MAP_PAGE);
  let mapSelectionLabel = $state('');
  const mapSelection = $derived(mapPicked.slice(0, mapShown));

  onMount(async () => {
    available = await immichAvailable();
    if (!available) return;
    void immichStatistics().then((s) => (stats = s)).catch(() => {});
    void immichIndexing().then((j) => (indexing = j)).catch(() => {});
    await loadMarkers();
    // People + timeline hydrate in the background so their tabs are instant.
    void Promise.all([loadClusters(), loadMappings()]);
    void timelineBuckets().then((b) => (buckets = b)).catch(() => {});
  });

  async function loadMarkers() {
    if (markersLoaded || markersLoading) return;
    markersLoading = true;
    try {
      markers = await mapMarkers();
      markersLoaded = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      markersLoading = false;
    }
  }

  function onMapSelect(picked: MapMarker[], label: string) {
    // Synthesize the minimal asset shape PhotoGrid needs from markers.
    mapPicked = picked.map((m) => ({
      id: m.id,
      type: 'IMAGE',
      originalFileName: [m.city, m.country].filter(Boolean).join(', ') || m.id,
      fileCreatedAt: ''
    }));
    mapShown = MAP_PAGE;
    mapSelectionLabel = label;
  }

  async function loadClusters() {
    try {
      const r = await listImmichPeople(1, 100);
      clusters = r.people;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
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

  function mappedName(c: ImmichPerson): string {
    const p = mappings[c.id]?.person;
    return (p && (p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(' '))) || c.name || 'Unknown';
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
      if (minRating > 0) {
        // Rated photos of this person — full set, no pagination.
        const a = await searchRatedAssets(minRating, { personIds: [c.id] });
        clusterAssets = a;
        clusterTotal = a.length;
        clusterNextPage = null;
      } else {
        const r = await searchImmichAssets({ personIds: [c.id], page, size: 60 });
        clusterAssets = page === 1 ? r.items : [...clusterAssets, ...r.items];
        clusterTotal = r.total;
        clusterNextPage = r.nextPage;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      clusterLoading = false;
    }
  }

  async function toggleBucket(b: TimelineBucket) {
    if (openBucket?.timeBucket === b.timeBucket) {
      openBucket = null;
      return;
    }
    openBucket = b;
    bucketAssets = [];
    bucketNextPage = null;
    await loadBucketAssets(b, 1);
  }

  function bucketRange(b: TimelineBucket): { takenAfter: string; takenBefore: string } {
    const start = new Date(`${b.timeBucket.slice(0, 10)}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { takenAfter: start.toISOString(), takenBefore: end.toISOString() };
  }

  async function loadBucketAssets(b: TimelineBucket, page: number) {
    bucketLoading = true;
    try {
      const r = await searchImmichAssets({ ...bucketRange(b), page, size: 60 });
      bucketAssets = page === 1 ? r.items : [...bucketAssets, ...r.items];
      bucketNextPage = r.nextPage;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      bucketLoading = false;
    }
  }

  function bucketLabel(b: TimelineBucket): string {
    try {
      return new Date(b.timeBucket).toLocaleDateString('is-IS', { year: 'numeric', month: 'long' });
    } catch {
      return b.timeBucket.slice(0, 7);
    }
  }

  // ── timeline drill-down: year chips + custom date range ─────────
  const bucketYears = $derived([...new Set(buckets.map((b) => b.timeBucket.slice(0, 4)))]);
  let yearFilter = $state<string | null>(null);
  const shownBuckets = $derived(yearFilter ? buckets.filter((b) => b.timeBucket.startsWith(yearFilter!)) : buckets);
  const yearCount = (y: string) => buckets.filter((b) => b.timeBucket.startsWith(y)).reduce((s, b) => s + b.count, 0);

  let rangeFrom = $state('');
  let rangeTo = $state('');
  let rangeActive = $state<{ from: string; to: string } | null>(null);
  let rangeAssets = $state<ImmichAsset[]>([]);
  let rangeTotal = $state(0);
  let rangeNextPage = $state<number | null>(null);
  let rangeLoading = $state(false);

  async function loadRangeAssets(page: number) {
    if (!rangeActive) return;
    rangeLoading = true;
    try {
      // takenBefore is exclusive-ish: bump "to" a day so the whole end date counts.
      const end = new Date(`${rangeActive.to}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const r = await searchImmichAssets({
        takenAfter: new Date(`${rangeActive.from}T00:00:00.000Z`).toISOString(),
        takenBefore: end.toISOString(),
        page,
        size: 60
      });
      rangeAssets = page === 1 ? r.items : [...rangeAssets, ...r.items];
      rangeTotal = r.total;
      rangeNextPage = r.nextPage;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      rangeLoading = false;
    }
  }
  async function applyRange() {
    if (!rangeFrom || !rangeTo) return;
    const [from, to] = rangeFrom <= rangeTo ? [rangeFrom, rangeTo] : [rangeTo, rangeFrom];
    rangeActive = { from, to };
    rangeAssets = [];
    openBucket = null;
    await loadRangeAssets(1);
  }
  function clearRange() {
    rangeActive = null;
    rangeAssets = [];
    rangeFrom = '';
    rangeTo = '';
  }
  function rangeLabel(): string {
    if (!rangeActive) return '';
    const f = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString('is-IS', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${f(rangeActive.from)} – ${f(rangeActive.to)}`;
  }

  const VIEWS: { id: View; label: string }[] = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'map', label: 'Map' },
    { id: 'people', label: 'People' },
    { id: 'albums', label: 'Albums' },
    { id: 'folders', label: 'Folders' }
  ];
</script>

<svelte:head><title>Photos · Hub</title></svelte:head>

<section class="space-y-5">
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <div class="hero-eyebrow">Photos</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
        Photo navigator
      </h1>
      <p class="mt-1 text-sm text-ink-500">
        {#if stats}
          {stats.photos.toLocaleString('is-IS')} photos · {stats.videos.toLocaleString('is-IS')} videos on the NAS.
        {:else}
          The NAS photo library — by place, time and face.
        {/if}
      </p>
    </div>
    <div class="flex items-center gap-2">
      <a href="/photos/upload" class="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
        <Icon name="plus" size={14} /> Drop photos
      </a>
      <div class="inline-flex rounded-[8px] border border-surface-border bg-surface-card p-0.5 text-xs" role="tablist" aria-label="View">
        {#each VIEWS as v (v.id)}
        <button
          type="button"
          role="tab"
          aria-selected={view === v.id}
          class="cursor-pointer rounded-[6px] px-3 py-1.5 font-medium transition-colors {view === v.id ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-700'}"
          onclick={() => (view = v.id)}
        >{v.label}</button>
        {/each}
      </div>
    </div>
  </header>

  {#if available === null}
    <div class="card p-6 text-sm text-ink-400">Connecting to the photo engine…</div>
  {:else if available === false}
    <div class="card p-6 text-sm">
      <div class="font-medium text-ink-900">Photo engine unreachable</div>
      <p class="mt-1 text-ink-500">
        Immich (port 8444 on the NAS) didn't answer. Make sure you're on the tailnet and the
        Immich stack is running — see <code>docs/photo-navigator-plan.md</code>.
      </p>
    </div>
  {:else}
    {#if indexing && indexing.active + indexing.waiting > 0}
      <div class="flex items-center gap-2 rounded-[10px] border border-surface-border bg-surface-card px-4 py-2.5 text-xs text-ink-500">
        <Icon name="sparkles" size={14} class="shrink-0" />
        Still indexing — {(indexing.active + indexing.waiting).toLocaleString('is-IS')} jobs queued.
        Faces and photos keep appearing as the scan progresses.
      </div>
    {/if}

    {#if error}
      <div class="rounded-[10px] border border-red-300 bg-red-50 px-4 py-2.5 text-xs text-red-700">{error}</div>
    {/if}

    <!-- Star rating filter (N and up) -->
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-ink-400">Stars</span>
      <div class="inline-flex items-center gap-0.5 rounded-[8px] border border-surface-border bg-surface-card p-0.5">
        {#each [1, 2, 3, 4, 5] as n (n)}
          <button
            type="button"
            class="cursor-pointer px-1 text-base leading-none transition-colors {n <= minRating ? 'text-yellow-400' : 'text-ink-300 hover:text-ink-500'}"
            onclick={() => setMinRating(n)}
            aria-label={`${n} stars and up`}
            aria-pressed={n <= minRating}
          >★</button>
        {/each}
      </div>
      {#if minRating > 0}
        <span class="text-ink-500">{minRating}★ and up{#if ratedLoading} · …{:else} · {ratedAssets.length.toLocaleString('is-IS')}{/if}</span>
        <button type="button" class="text-ink-400 hover:text-ink-700" onclick={() => (minRating = 0)}>clear</button>
      {:else}
        <span class="text-ink-400">— rate photos in the lightbox or batch-select to filter</span>
      {/if}
    </div>

    {#if view === 'map'}
      <div class="card overflow-hidden p-3 sm:p-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <span class="card-title"><Icon name="globe" size={16} /> Where photos were taken</span>
          {#if markers.length}<span class="text-xs text-ink-400">{markers.length.toLocaleString('is-IS')} geotagged</span>{/if}
        </div>
        {#if minRating > 0}
          <div class="mb-3 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            The star filter doesn't apply to the map — Immich's location index can't filter by rating. Use Timeline, People or Tagged to see your {minRating}★+ photos.
          </div>
        {/if}
        {#if markersLoading && !markersLoaded}
          <div class="flex h-[420px] items-center justify-center rounded-[12px] border border-surface-border text-sm text-ink-400 sm:h-[520px]">
            Loading map…
          </div>
        {:else}
          <PhotoMap {markers} onSelect={onMapSelect} />
        {/if}
      </div>

      {#if mapPicked.length}
        <div class="card">
          <div class="card-header">
            <span class="card-title"><Icon name="image" size={16} /> {mapSelectionLabel}
              <span class="font-normal text-ink-300">{mapPicked.length.toLocaleString('is-IS')}</span>
            </span>
            <button type="button" class="btn-ghost text-xs" onclick={() => (mapPicked = [])}>clear</button>
          </div>
          <div class="px-4 pb-4">
            <PhotoGrid
              assets={mapSelection}
              total={mapPicked.length}
              onMore={mapShown < mapPicked.length ? () => (mapShown += MAP_PAGE) : null}
              taggable
            />
          </div>
        </div>
      {/if}
    {:else if view === 'timeline'}
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="calendar" size={16} /> {minRating > 0 ? `${minRating}★ and up` : 'By month'}
            {#if minRating > 0}<span class="font-normal text-ink-300">{ratedAssets.length.toLocaleString('is-IS')}</span>{/if}
          </span>
        </div>
        {#if minRating > 0}
          <div class="px-4 py-3">
            {#if ratedLoading && ratedAssets.length === 0}
              <div class="text-sm text-ink-400">Finding photos rated {minRating}★ or higher…</div>
            {:else if ratedAssets.length === 0}
              <div class="text-sm text-ink-400">No photos rated {minRating}★ or higher yet. Open a photo and tap the stars.</div>
            {:else}
              <PhotoGrid
                assets={ratedSlice}
                total={ratedAssets.length}
                onMore={ratedShown < ratedAssets.length ? () => (ratedShown += 120) : null}
                taggable
                onTagsChanged={reloadRated}
              />
            {/if}
          </div>
        {:else if buckets.length === 0}
          <div class="p-6 text-sm text-ink-400">Timeline not ready yet.</div>
        {:else}
          <!-- Drill-down: custom date range + year quick-filter -->
          <div class="flex flex-wrap items-center gap-2 border-b border-surface-divider px-4 py-2.5">
            <label class="flex items-center gap-1.5 text-xs text-ink-500">
              From
              <input type="date" class="input px-2 py-1 text-xs" bind:value={rangeFrom} />
            </label>
            <label class="flex items-center gap-1.5 text-xs text-ink-500">
              to
              <input type="date" class="input px-2 py-1 text-xs" bind:value={rangeTo} />
            </label>
            <button
              type="button"
              class="btn-primary px-2.5 py-1 text-xs disabled:opacity-50"
              disabled={!rangeFrom || !rangeTo || rangeLoading}
              onclick={applyRange}
            >{rangeLoading && rangeActive ? 'Loading…' : 'Show range'}</button>
            {#if rangeActive}
              <button type="button" class="btn-ghost px-2 py-1 text-xs" onclick={clearRange}>Clear</button>
            {/if}
            {#if !rangeActive && bucketYears.length > 1}
              <span class="mx-1 hidden h-4 w-px bg-surface-divider sm:block"></span>
              <div class="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  class="rounded-full border px-2.5 py-1 text-xs font-medium transition {yearFilter === null
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-surface-border bg-surface-card text-ink-500 hover:bg-surface-hover'}"
                  onclick={() => (yearFilter = null)}
                >All years</button>
                {#each bucketYears as y (y)}
                  <button
                    type="button"
                    class="rounded-full border px-2.5 py-1 text-xs font-medium transition {yearFilter === y
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-surface-border bg-surface-card text-ink-500 hover:bg-surface-hover'}"
                    onclick={() => (yearFilter = yearFilter === y ? null : y)}
                  >{y} <span class="font-normal opacity-60">{yearCount(y).toLocaleString('is-IS')}</span></button>
                {/each}
              </div>
            {/if}
          </div>

          {#if rangeActive}
            <div class="px-4 py-3">
              <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                {rangeLabel()} <span class="text-ink-300">· {rangeTotal.toLocaleString('is-IS')}</span>
              </div>
              {#if rangeLoading && rangeAssets.length === 0}
                <div class="text-sm text-ink-400">Loading photos…</div>
              {:else if rangeAssets.length === 0}
                <p class="text-sm text-ink-400">No photos in this range.</p>
              {:else}
                <PhotoGrid
                  assets={rangeAssets}
                  total={rangeTotal}
                  onMore={rangeNextPage ? () => loadRangeAssets(rangeNextPage!) : null}
                  loadingMore={rangeLoading}
                  taggable
                />
              {/if}
            </div>
          {:else}
          <ul class="divide-y divide-surface-divider">
            {#each shownBuckets as b (b.timeBucket)}
              <li>
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm transition hover:bg-surface-hover"
                  onclick={() => toggleBucket(b)}
                  aria-expanded={openBucket?.timeBucket === b.timeBucket}
                >
                  <span class="font-medium text-ink-900">{bucketLabel(b)}</span>
                  <span class="text-xs text-ink-400">{b.count.toLocaleString('is-IS')}</span>
                </button>
                {#if openBucket?.timeBucket === b.timeBucket}
                  <div class="border-t border-surface-divider px-4 py-3">
                    {#if bucketLoading && bucketAssets.length === 0}
                      <div class="text-xs text-ink-400">Loading photos…</div>
                    {:else}
                      <PhotoGrid
                        assets={bucketAssets}
                        total={b.count}
                        onMore={bucketNextPage ? () => loadBucketAssets(b, bucketNextPage!) : null}
                        loadingMore={bucketLoading}
                        taggable
                      />
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
          {/if}
        {/if}
      </div>
    {:else if view === 'people'}
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="users" size={16} /> Matched people
            {#if mappedClusters.length}<span class="font-normal text-ink-300">{mappedClusters.length}</span>{/if}
          </span>
          <a href="/settings/photo-matching" class="text-xs text-brand hover:underline">Match faces →</a>
        </div>
        {#if mappedClusters.length === 0}
          <div class="p-6 text-sm text-ink-400">
            No faces matched yet. Head to
            <a href="/settings/photo-matching" class="text-brand hover:underline">Settings → Face matching</a>
            to tell the hub who's who.
          </div>
        {:else}
          <ul class="divide-y divide-surface-divider">
            {#each mappedClusters as c (c.id)}
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
                      <div class="truncate text-sm font-medium text-ink-900">{mappedName(c)}</div>
                      <div class="truncate text-xs text-ink-400">tap to see their photos</div>
                    </div>
                  </button>
                  <a class="text-xs text-brand hover:underline" href={`/people/${mappings[c.id].person_id}`}>open</a>
                </div>
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
        {/if}
      </div>
    {:else if view === 'albums'}
      <!-- Albums: Immich albums as a tagging workspace. -->
      <PhotoAlbums {minRating} ratedIds={ratedIdSet} />
    {:else}
      <!-- Folders: virtual project → events → photos hierarchy. -->
      <PhotoFolders {minRating} ratedIds={ratedIdSet} />
    {/if}
  {/if}
</section>
