<script lang="ts">
  // Pick a picture from the photos a person, org, project or event is already in.
  //
  // Three things make this more than a file browser:
  //
  //   Tagged first. A photo somebody deliberately linked here is nearly always
  //   a better portrait than one Immich merely recognised a face in.
  //
  //   It cuts a real portrait (people only). Picking a group shot crops the
  //   pixels around THIS person's face, so twelve people sharing one photo get
  //   twelve different portraits. Panning cannot do that — a portrait photo in
  //   a square avatar has no horizontal freedom, so every face resolves to the
  //   same crop.
  //
  //   You see the crop before you commit. Tapping a photo does not apply it; it
  //   shows the photo with the face outlined and the square that will be cut,
  //   because "will this pick the right person out of six" is the only question
  //   that matters here, and it deserves an answer rather than an undo.
  import BottomSheet from '$lib/BottomSheet.svelte';
  import Icon from '$lib/Icon.svelte';
  import FaceBoxes from '$lib/photos/FaceBoxes.svelte';
  import { assetThumbUrl } from '$lib/immich';
  import { listFaceBoxes, type FaceBox } from '$lib/photos/faceBoxes';
  import {
    listOwnerPhotos,
    clusterIdsFor,
    faceSpotFor,
    faceCropRect,
    type PersonPhoto,
    type PhotoOwner,
    type FaceSpot
  } from '$lib/photos/personPhotos';

  let {
    open = false,
    owner,
    ownerName = '',
    onPick,
    onClose
  }: {
    open?: boolean;
    owner: PhotoOwner;
    ownerName?: string;
    /** Called with the confirmed asset. The parent does the import. */
    onPick: (assetId: string, filename: string) => void | Promise<void>;
    onClose: () => void;
  } = $props();

  const isPerson = $derived(owner.collection === 'Person');

  let photos = $state<PersonPhoto[]>([]);
  let problems = $state<string[]>([]);
  let loading = $state(false);
  let loadedKey = $state('');
  let error = $state('');
  let applying = $state(false);

  // ── Confirm step ────────────────────────────────────────────────────
  let chosen = $state<PersonPhoto | null>(null);
  let boxes = $state<FaceBox[]>([]);
  let spot = $state<FaceSpot | null>(null);
  let clusters = $state<string[]>([]);
  let inspecting = $state(false);
  /** Natural size of the preview image — needed to place the crop square. */
  let previewW = $state(0);
  let previewH = $state(0);

  const key = $derived(`${owner.collection}:${owner.id}`);

  $effect(() => {
    if (!open || loadedKey === key) return;
    loadedKey = key;
    loading = true;
    error = '';
    void (async () => {
      try {
        const res = await listOwnerPhotos(owner);
        photos = res.photos;
        problems = res.problems;
        if (owner.collection === 'Person') clusters = await clusterIdsFor(owner.id);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        loading = false;
      }
    })();
  });

  const tagged = $derived(photos.filter((p) => p.via === 'tag'));
  const recognised = $derived(photos.filter((p) => p.via === 'face'));

  async function inspect(p: PersonPhoto) {
    chosen = p;
    boxes = [];
    spot = null;
    previewW = 0;
    previewH = 0;
    if (!isPerson) return;
    inspecting = true;
    try {
      // Both of these come from the same cached asset request.
      boxes = await listFaceBoxes(p.assetId);
      spot = await faceSpotFor(p.assetId, clusters);
    } finally {
      inspecting = false;
    }
  }

  /** The crop square as percentages of the preview image, from the SAME
   *  geometry the crop itself uses — so the preview cannot show a different
   *  square than you get. */
  const cropBox = $derived.by(() => {
    if (!spot || !previewW || !previewH) return null;
    const r = faceCropRect(spot, previewW, previewH);
    return {
      left: (r.left / previewW) * 100,
      top: (r.top / previewH) * 100,
      w: (r.side / previewW) * 100,
      h: (r.side / previewH) * 100
    };
  });

  async function confirm() {
    if (!chosen || applying) return;
    applying = true;
    try {
      await onPick(chosen.assetId, chosen.filename);
    } finally {
      applying = false;
    }
  }
</script>

<BottomSheet
  {open}
  title={chosen ? 'Use this photo?' : 'Choose from photos'}
  expandable
  onClose={onClose}
>
  {#if chosen}
    <div class="space-y-3">
      <div class="pp-preview">
        <!-- Deliberately NO crossorigin here. It looks like the tidy fix for
             the cache clash with fetchAssetFile() (see immich.ts), and it
             works on a cold cache — but any device that had already viewed
             this preview holds an opaque entry that a CORS-mode img cannot
             use, so the picture renders black with the face frame drawn over
             nothing. Rendering must never depend on cache state; the retry in
             fetchAssetFile handles the fetch side instead. -->
        <img
          src={assetThumbUrl(chosen.assetId, 'preview')}
          alt=""
          onload={(e) => {
            const el = e.currentTarget as HTMLImageElement;
            previewW = el.naturalWidth;
            previewH = el.naturalHeight;
          }}
        />
        <!-- Faces first, then the crop square on top of them. -->
        <FaceBoxes {boxes} highlight={clusters} labels={false} />
        {#if cropBox}
          <span
            class="pp-crop"
            style="left:{cropBox.left}%; top:{cropBox.top}%; width:{cropBox.w}%; height:{cropBox.h}%;"
          ></span>
        {/if}
      </div>

      <p class="text-xs text-ink-500">
        {#if inspecting}
          Looking for {ownerName || 'their'} face…
        {:else if cropBox}
          The teal box is {ownerName || 'them'}; the bright square is what will be
          cut. Wrong person? Go back and pick another photo.
        {:else if isPerson}
          Immich doesn’t know where {ownerName || 'they'} are in this one, so the
          whole photo will be used. You can drag it into place afterwards.
        {:else}
          The whole photo will be used — drag it into place afterwards.
        {/if}
      </p>

      {#if error}
        <p class="text-xs" style="color: #C0392B;">{error}</p>
      {/if}

      <div class="flex items-center justify-between gap-2">
        <button class="btn-ghost text-xs" onclick={() => (chosen = null)} disabled={applying}>
          <Icon name="chevron-left" size={13} /> Back
        </button>
        <button class="btn-primary" onclick={confirm} disabled={applying}>
          <Icon name="check" size={14} /> {applying ? 'Applying…' : 'Use this'}
        </button>
      </div>
    </div>
  {:else if loading}
    <p class="text-sm text-ink-400">Looking for photos of {ownerName || 'this record'}…</p>
  {:else if error}
    <p class="text-xs" style="color: #C0392B;">{error}</p>
  {:else if photos.length === 0}
    {#if problems.length > 0}
      <!-- Say what actually failed. "No photos found" would send you off to tag
           photos when the library simply could not be reached. -->
      <p class="text-sm text-ink-600">Couldn’t finish looking:</p>
      <ul class="mt-1 space-y-0.5">
        {#each problems as p (p)}
          <li class="text-xs" style="color: #a3271c;">{p}</li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm text-ink-400">
        No photos found. Tag a photo to {ownerName || 'this record'} in the photo
        navigator{#if isPerson}, or match their face in Settings → Photo matching{/if}, and it
        will show up here.
      </p>
    {/if}
  {:else}
    <div class="space-y-4">
      {#if problems.length > 0}
        <p class="rounded-[10px] px-3 py-2 text-xs" style="background: #fdf3e3; color: #8a5a12;">
          Showing a partial list — {problems.join('; ')}
        </p>
      {/if}

      {#each [{ label: 'Tagged to them', rows: tagged, hint: 'Linked on purpose' }, { label: 'Recognised in', rows: recognised, hint: 'Found by face matching' }] as group (group.label)}
        {#if group.rows.length > 0}
          <div>
            <div class="mb-1.5 flex items-baseline gap-2 px-0.5">
              <span
                class="font-display text-[10px] uppercase tracking-wider text-ink-400"
                style="letter-spacing: 0.12em;"
              >{group.label}</span>
              <span class="text-[10px] text-ink-300">{group.hint} · {group.rows.length}</span>
            </div>
            <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {#each group.rows as p (p.assetId)}
                <button
                  type="button"
                  class="pp-tile"
                  title={p.filename || p.assetId}
                  aria-label={`Preview ${p.filename || 'this photo'}`}
                  onclick={() => inspect(p)}
                >
                  <img src={assetThumbUrl(p.assetId, 'thumbnail')} alt="" loading="lazy" />
                </button>
              {/each}
            </div>
          </div>
        {/if}
      {/each}

      <p class="px-0.5 text-[11px] text-ink-400">
        {#if isPerson}
          Tap a photo to see which face twin will use before anything changes.
        {:else}
          Tap a photo to preview it before anything changes.
        {/if}
      </p>
    </div>
  {/if}
</BottomSheet>

<style>
  .pp-tile {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--bg-tertiary, #f2f2f2);
    cursor: pointer;
    transition: box-shadow 200ms;
  }
  .pp-tile:hover { box-shadow: 0 0 0 2px var(--brand, #2f7d7d); }
  .pp-tile:focus-visible { outline: 2px solid var(--brand, #2f7d7d); outline-offset: 2px; }
  .pp-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }

  /* Shrink-wraps the image so the face boxes and the crop square — both
     percentages — are relative to the RENDERED image, not this container. */
  .pp-preview {
    position: relative;
    display: inline-flex;
    max-width: 100%;
    border-radius: 12px;
    overflow: hidden;
    background: #000;
  }
  .pp-preview img {
    max-width: 100%;
    max-height: 52vh;
    object-fit: contain;
    display: block;
  }
  /* The huge outer shadow dims everything outside the square, so what will be
     kept reads at a glance rather than having to be traced. */
  .pp-crop {
    position: absolute;
    border: 2px solid #fff;
    border-radius: 4px;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.6),
      0 0 0 9999px rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }
</style>
