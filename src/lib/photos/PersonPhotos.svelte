<script lang="ts">
  // Photos tab on the Person detail page. Two sources, merged:
  //   1. The person's Immich face-cluster mapping(s) (photo_person) —
  //      automatic, covers every photo recognition caught.
  //   2. Manual per-photo tags (photo_link) — group shots and photos
  //      where recognition missed them.
  // Assets stream straight from Immich; the page's +page.ts stays
  // Immich-free (the engine is tailnet-only and optional).
  import { onMount } from 'svelte';
  import { photoPersonsForPerson, listPhotoLinks } from '$lib/directus';
  import {
    immichAvailable,
    searchImmichAssets,
    getImmichAsset,
    type ImmichAsset
  } from '$lib/immich';
  import PhotoGrid from '$lib/photos/PhotoGrid.svelte';

  let {
    personId,
    onSetAvatar = null
  }: {
    personId: number;
    /** Set the open library photo as this person's profile picture. */
    onSetAvatar?: ((asset: ImmichAsset) => void | Promise<void>) | null;
  } = $props();

  let state_ = $state<'loading' | 'offline' | 'unmapped' | 'ready'>('loading');
  let assets = $state<ImmichAsset[]>([]);
  let total = $state(0);
  // The merged set is held in memory; reveal it a page at a time so a
  // prolific person doesn't render a thousand thumbnails up front.
  let shown = $state(120);
  const visible = $derived(assets.slice(0, shown));
  let clusterIds = $state<string[]>([]);
  let manualAssets: ImmichAsset[] = [];

  onMount(async () => {
    try {
      const [mappings, links] = await Promise.all([
        photoPersonsForPerson(personId),
        listPhotoLinks('Person', personId).catch(() => [])
      ]);
      clusterIds = mappings.map((m) => m.id);
      if (clusterIds.length === 0 && links.length === 0) {
        state_ = 'unmapped';
        return;
      }
      if (!(await immichAvailable())) {
        state_ = 'offline';
        return;
      }
      manualAssets = (
        await Promise.all(links.map((l) => getImmichAsset(l.asset_id).catch(() => null)))
      ).filter((a): a is ImmichAsset => a !== null);
      await loadFaces();
      state_ = 'ready';
    } catch {
      state_ = 'offline';
    }
  });

  // Query each mapped cluster SEPARATELY and merge. Immich re-clusters
  // faces as it indexes, so a person's mapping can accumulate cluster ids
  // that have since been merged/deleted. Passing all ids in one search
  // makes a single stale id zero out the whole result — which is why a
  // mapped person could suddenly show no photos. Per-cluster queries keep
  // the still-valid clusters working and silently drop the dead ones.
  async function loadFaces() {
    const byId = new Map<string, ImmichAsset>();
    for (const a of manualAssets) byId.set(a.id, a);
    await Promise.all(
      clusterIds.map(async (cid) => {
        try {
          let page: number | null = 1;
          while (page && byId.size < 1000) {
            const r = await searchImmichAssets({ personIds: [cid], page, size: 100 });
            for (const a of r.items) byId.set(a.id, a);
            page = r.nextPage;
          }
        } catch {
          /* stale/merged cluster — skip it */
        }
      })
    );
    assets = [...byId.values()].sort(
      (a, b) => new Date(b.fileCreatedAt).getTime() - new Date(a.fileCreatedAt).getTime()
    );
    total = assets.length;
  }
</script>

{#if state_ === 'loading'}
  <div class="text-sm text-ink-400">Loading photos…</div>
{:else if state_ === 'offline'}
  <div class="rounded-[10px] border border-dashed border-surface-border p-6 text-center text-sm text-ink-400">
    The photo engine isn't reachable right now — photos live on the NAS and need the tailnet.
  </div>
{:else if state_ === 'unmapped'}
  <div class="rounded-[10px] border border-dashed border-surface-border p-6 text-center text-sm text-ink-400">
    No face mapping yet for this person.
    <a class="text-brand hover:underline" href="/photos">Map their face in Photos</a> and every
    photo of them on the NAS shows up here.
  </div>
{:else}
  <PhotoGrid
    assets={visible}
    {total}
    onMore={shown < assets.length ? () => (shown += 120) : null}
    taggable
    onUseAsAvatar={onSetAvatar}
    highlightClusters={clusterIds}
  />
{/if}
