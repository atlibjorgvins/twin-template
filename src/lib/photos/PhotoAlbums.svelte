<script lang="ts">
  // Albums tab — browse Immich albums and batch-tag their photos.
  // The workflow: photos are grouped into an album inside Immich right
  // after an upload (event shoot, project batch), then this tab opens
  // the album so every photo can be tagged to projects/events/people
  // via the grid's select + lightbox panels. The navigator's star
  // filter is carried through like every other tab.
  import {
    listImmichAlbums,
    getImmichAlbum,
    assetThumbUrl,
    IMMICH_URL,
    type ImmichAlbum,
    type ImmichAsset
  } from '$lib/immich';
  import PhotoGrid from '$lib/photos/PhotoGrid.svelte';
  import Icon from '$lib/Icon.svelte';

  let { minRating = 0, ratedIds = new Set<string>() }: { minRating?: number; ratedIds?: Set<string> } = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let albums = $state<ImmichAlbum[]>([]);

  let open = $state<ImmichAlbum | null>(null);
  let assets = $state<ImmichAsset[]>([]);
  let assetsLoading = $state(false);
  let shown = $state(120);

  const filtered = $derived(minRating > 0 ? assets.filter((a) => ratedIds.has(a.id)) : assets);
  const shownAssets = $derived(filtered.slice(0, shown));

  $effect(() => void load());
  let loaded = false;
  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      albums = await listImmichAlbums();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function openAlbum(a: ImmichAlbum) {
    open = a;
    assets = [];
    shown = 120;
    assetsLoading = true;
    try {
      assets = (await getImmichAlbum(a.id)).assets;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      assetsLoading = false;
    }
  }

  function dateRange(a: ImmichAlbum): string | null {
    const fmt = (s: string) => {
      try {
        return new Date(s).toLocaleDateString('is-IS', { year: 'numeric', month: 'short' });
      } catch {
        return null;
      }
    };
    const from = a.startDate ? fmt(a.startDate) : null;
    const to = a.endDate ? fmt(a.endDate) : null;
    if (!from) return null;
    return to && to !== from ? `${from} – ${to}` : from;
  }
</script>

<div class="card">
  <div class="card-header flex-wrap gap-y-1">
    <div class="flex min-w-0 flex-wrap items-center gap-1 text-sm">
      <button
        type="button"
        class="inline-flex items-center gap-1 font-medium {open ? 'text-brand hover:underline' : 'text-ink-900'}"
        onclick={() => { open = null; assets = []; }}
      >
        <Icon name="image" size={15} /> Albums
        {#if !open && albums.length}<span class="font-normal text-ink-300">{albums.length}</span>{/if}
      </button>
      {#if open}
        <Icon name="chevron-right" size={13} class="text-ink-300" />
        <span class="min-w-0 break-words font-medium text-ink-900">{open.albumName}</span>
      {/if}
    </div>
    {#if open}
      <a
        href={`${IMMICH_URL}/albums/${open.id}`}
        target="_blank"
        rel="noreferrer noopener"
        class="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700"
      >Open in Immich <span aria-hidden="true">↗</span></a>
    {/if}
  </div>

  {#if loading}
    <div class="p-6 text-sm text-ink-400">Loading albums…</div>
  {:else if error}
    <div class="m-4 rounded-[10px] border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
  {:else if !open}
    {#if albums.length === 0}
      <div class="p-6 text-sm text-ink-400">
        No albums in Immich yet. Create one there (e.g. per event or shoot), drop photos in, and tag them here.
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 md:grid-cols-4">
        {#each albums as a (a.id)}
          <button
            type="button"
            class="group flex items-start gap-2 rounded-[10px] border border-surface-border bg-surface-card p-2 text-left transition hover:bg-surface-hover"
            title={a.albumName}
            onclick={() => openAlbum(a)}
          >
            <span class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px]" style="background: var(--bg-tertiary);">
              {#if a.albumThumbnailAssetId}
                <img src={assetThumbUrl(a.albumThumbnailAssetId)} alt="" class="h-full w-full object-cover" loading="lazy" />
              {:else}
                <Icon name="image" size={16} class="text-ink-400" />
              {/if}
            </span>
            <span class="min-w-0 flex-1">
              <span class="line-clamp-2 break-words text-sm font-medium leading-snug text-ink-900">{a.albumName}</span>
              <span class="block text-[11px] text-ink-400">
                {a.assetCount} photo{a.assetCount === 1 ? '' : 's'}{dateRange(a) ? ` · ${dateRange(a)}` : ''}
              </span>
            </span>
            <Icon name="chevron-right" size={14} class="mt-1 shrink-0 text-ink-300" />
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="p-4">
      {#if assetsLoading}
        <div class="text-sm text-ink-400">Loading photos…</div>
      {:else if assets.length === 0}
        <p class="text-sm text-ink-400">This album is empty.</p>
      {:else if filtered.length === 0}
        <p class="text-sm text-ink-400">None of these are rated {minRating}★ or higher.</p>
      {:else}
        <PhotoGrid
          assets={shownAssets}
          total={filtered.length}
          onMore={shown < filtered.length ? () => (shown += 120) : null}
          taggable
        />
      {/if}
    </div>
  {/if}
</div>
