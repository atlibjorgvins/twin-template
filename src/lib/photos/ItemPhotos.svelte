<script lang="ts">
  // NAS photos tagged to one record (org or project) via photo_link.
  // Hydrates the tagged asset ids from Immich and renders the shared
  // grid — taggable, so tags can also be removed (or added) right here.
  import { onMount } from 'svelte';
  import { listPhotoLinks, type PhotoLinkCollection } from '$lib/directus';
  import { immichAvailable, getImmichAsset, type ImmichAsset } from '$lib/immich';
  import PhotoGrid from '$lib/photos/PhotoGrid.svelte';

  let { collection, itemId, onCount }: { collection: PhotoLinkCollection; itemId: number; onCount?: (n: number) => void } = $props();

  let state_ = $state<'loading' | 'offline' | 'empty' | 'ready'>('loading');
  let assets = $state<ImmichAsset[]>([]);

  // 'offline' deliberately reports nothing: we cannot know the count, and a
  // wrong 0 would fold away a card that has photos.
  $effect(() => { if (state_ === 'ready' || state_ === 'empty') onCount?.(assets.length); });

  onMount(load);

  async function load() {
    try {
      const links = await listPhotoLinks(collection, itemId);
      if (links.length === 0) {
        state_ = 'empty';
        return;
      }
      if (!(await immichAvailable())) {
        state_ = 'offline';
        return;
      }
      const hydrated = await Promise.all(
        links.map((l) => getImmichAsset(l.asset_id).catch(() => null))
      );
      assets = hydrated.filter((a): a is ImmichAsset => a !== null);
      state_ = assets.length > 0 ? 'ready' : 'empty';
    } catch {
      state_ = 'offline';
    }
  }
</script>

{#if state_ === 'loading'}
  <div class="text-sm text-ink-400">Loading photos…</div>
{:else if state_ === 'offline'}
  <div class="rounded-[10px] border border-dashed border-surface-border p-6 text-center text-sm text-ink-400">
    The photo engine isn't reachable right now — photos live on the NAS and need the tailnet.
  </div>
{:else if state_ === 'empty'}
  <div class="rounded-[10px] border border-dashed border-surface-border p-6 text-center text-sm text-ink-400">
    No NAS photos tagged yet. Browse <a class="text-brand hover:underline" href="/photos">Photos</a>,
    open one, and tag it here with the Tag button.
  </div>
{:else}
  <PhotoGrid {assets} taggable onTagsChanged={load} />
{/if}
