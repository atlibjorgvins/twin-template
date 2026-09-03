<script lang="ts">
  // Rotating photo frame, used twice on the wall display: small in the
  // dashboard corner and full-bleed in the swipe-right view.
  //
  // Two details do most of the work here:
  //
  //  - The NEXT image is mounted invisibly and only swapped in once it has
  //    actually decoded. Without that, an Immich preview fetched over the
  //    tailnet paints a half-loaded frame, which on a screen that is always
  //    on is a flicker you notice from the other side of the room.
  //  - Both layers stay mounted and cross-fade with opacity. Replacing the
  //    src on one <img> flashes white between photos.
  import { onMount } from 'svelte';
  import { assetThumbUrl, type ImmichAsset } from '$lib/immich';

  let {
    assets = [],
    intervalMs = 45_000,
    size = 'preview',
    fit = 'cover',
    onAsset = undefined
  }: {
    assets?: ImmichAsset[];
    intervalMs?: number;
    /** 'thumbnail' is enough for the small frame; 'preview' for full-bleed. */
    size?: 'thumbnail' | 'preview';
    fit?: 'cover' | 'contain';
    /** Fires whenever the visible photo changes — the frame owns the
     *  rotation, so it is the only thing that knows what is on screen. */
    onAsset?: (asset: ImmichAsset) => void;
  } = $props();

  let index = $state(0);
  /** Which layer is currently on top. */
  let showA = $state(true);
  let srcA = $state('');
  let srcB = $state('');

  const urlAt = (i: number) =>
    assets.length ? assetThumbUrl(assets[i % assets.length].id, size) : '';

  /** Decode before showing, so a slow fetch never paints a partial frame. */
  async function preload(url: string): Promise<void> {
    if (!url) return;
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      // A broken or still-processing asset should not stall the rotation —
      // fall through and let the <img> render whatever it can.
    }
  }

  async function advance() {
    if (assets.length < 2) return;
    const next = (index + 1) % assets.length;
    const url = urlAt(next);
    await preload(url);
    // Load into whichever layer is hidden, then flip.
    if (showA) srcB = url;
    else srcA = url;
    index = next;
    showA = !showA;
    onAsset?.(assets[index]);
  }

  onMount(() => {
    if (assets.length > 0) {
      srcA = urlAt(0);
      onAsset?.(assets[0]);
      void preload(urlAt(1));
    }
    const t = setInterval(() => void advance(), intervalMs);
    return () => clearInterval(t);
  });

  // Restart cleanly if the album changes under us (picker, or a reload that
  // returns a different set).
  $effect(() => {
    const first = assets[0]?.id;
    if (!first) return;
    if (!srcA && !srcB) {
      index = 0;
      showA = true;
      srcA = urlAt(0);
    }
  });
</script>

<div class="frame" class:contain={fit === 'contain'}>
  {#if srcA}
    <img class="layer" class:on={showA} src={srcA} alt="" />
  {/if}
  {#if srcB}
    <img class="layer" class:on={!showA} src={srcB} alt="" />
  {/if}
  {#if assets.length === 0}
    <div class="empty">No photos</div>
  {/if}
</div>

<style>
  .frame {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-secondary, #f2f2f2);
  }
  .layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    /* Long fade: this is furniture, not a slideshow app. */
    transition: opacity 1.2s ease-in-out;
  }
  .contain .layer {
    object-fit: contain;
  }
  .layer.on {
    opacity: 1;
  }
  .empty {
    display: grid;
    place-items: center;
    height: 100%;
    font-size: 0.85rem;
    color: var(--ink-400, #888);
  }
</style>
