<script lang="ts">
  // Thumbnail grid + built-in lightbox for Immich assets. Used by the
  // /photos browser and the Person detail Photos tab. Thumbs and
  // previews stream straight from Immich (the nginx proxy injects the
  // API key). With `taggable`, the lightbox grows a tag panel that
  // links the asset to orgs/projects/people in Directus (photo_link).
  import { onDestroy } from 'svelte';
  import { assetThumbUrl, assetVideoUrl, updateAsset, type ImmichAsset } from '$lib/immich';
  import Icon from '$lib/Icon.svelte';
  import PhotoInfoPanel from '$lib/photos/PhotoInfoPanel.svelte';
  import FaceBoxes from '$lib/photos/FaceBoxes.svelte';
  import { listFaceBoxes, type FaceBox } from '$lib/photos/faceBoxes';
  import PhotoBatchTag from '$lib/photos/PhotoBatchTag.svelte';

  let {
    assets,
    total = null,
    onMore = null,
    loadingMore = false,
    taggable = false,
    onTagsChanged = null,
    onUseAsAvatar = null,
    highlightClusters = []
  }: {
    assets: ImmichAsset[];
    /** Total matching count, for the "showing x of n" footer. */
    total?: number | null;
    /** Present = there are more pages; called by the "show more" button. */
    onMore?: (() => void) | null;
    loadingMore?: boolean;
    /** Show the org/project/person tag panel in the lightbox. */
    taggable?: boolean;
    /** Called after a tag is added/removed (hosts may want to refresh). */
    onTagsChanged?: (() => void) | null;
    /** When set, the lightbox shows a "Profile photo" button that hands
     *  the open asset to the host (e.g. set it as a person's avatar). */
    onUseAsAvatar?: ((asset: ImmichAsset) => void | Promise<void>) | null;
    /** Immich cluster ids belonging to the person whose page this is. Their
     *  face gets the highlighted box, which answers "which one is them" in a
     *  group shot without reading four names. */
    highlightClusters?: string[];
  } = $props();

  // "Use as profile photo" progress, keyed to the lightbox.
  let avatarBusy = $state(false);
  let avatarDone = $state(false);
  async function useAsAvatar() {
    if (!current || !onUseAsAvatar) return;
    avatarBusy = true;
    avatarDone = false;
    try {
      await onUseAsAvatar(current);
      avatarDone = true;
    } finally {
      avatarBusy = false;
    }
  }

  // ── batch selection ──────────────────────────────────────────────
  // Available wherever the grid is taggable. Tap "Select", check photos,
  // then "Tag…" to link them all to a project / org / person / event.
  let selectMode = $state(false);
  let selectedIds = $state<string[]>([]);
  let batchOpen = $state(false);
  let rateOpen = $state(false);
  let rating_busy = $state(false);
  let flash = $state<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const selectedCount = $derived(selectedIds.length);
  const isSel = (id: string) => selectedIds.includes(id);
  function toggleSel(id: string) {
    selectedIds = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
  }
  // Shift-click selects the whole range since the last clicked photo,
  // like a file manager. Plain click toggles one and re-anchors.
  let selAnchor = $state<number | null>(null);
  function selectClick(e: MouseEvent, list: { id: string }[], i: number) {
    if (e.shiftKey && selAnchor !== null && selAnchor !== i) {
      const [lo, hi] = selAnchor < i ? [selAnchor, i] : [i, selAnchor];
      const range = list.slice(lo, hi + 1).map((a) => a.id);
      selectedIds = [...new Set([...selectedIds, ...range])];
    } else {
      toggleSel(list[i].id);
    }
    selAnchor = i;
  }
  function exitSelect() {
    selectMode = false;
    selectedIds = [];
    selAnchor = null;
  }
  async function batchRate(n: number) {
    if (!selectedIds.length) return;
    rating_busy = true;
    const ids = [...selectedIds];
    try {
      for (const id of ids) await updateAsset(id, { rating: n }).catch(() => {});
      flash = n === 0 ? `Cleared rating on ${ids.length}` : `Rated ${ids.length} · ${n}★`;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => (flash = null), 2800);
      onTagsChanged?.();
    } finally {
      rating_busy = false;
      rateOpen = false;
      exitSelect();
    }
  }

  function onBatchApplied(label: string, added: number, skipped: number) {
    batchOpen = false;
    flash =
      added > 0
        ? `Added ${added} to ${label}${skipped ? ` · ${skipped} already there` : ''}`
        : `Already tagged to ${label}`;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flash = null), 2800);
    onTagsChanged?.();
    exitSelect();
  }

  // Lightbox — index into `assets`, null when closed.
  let open = $state<number | null>(null);
  const current = $derived(open === null ? null : (assets[open] ?? null));
  let infoOpen = $state(false);

  // ── Face markers ─────────────────────────────────────────────────────
  // Off by default: the boxes answer "who does Immich think is in this?",
  // which is an occasional question, not something to draw over every photo.
  // The preference sticks for the session, so checking several photos in a row
  // is one click rather than one per photo.
  let facesOn = $state(false);
  let faceBoxes = $state<FaceBox[]>([]);

  $effect(() => {
    const id = current?.id;
    if (!facesOn || !id || current?.type === 'VIDEO') {
      faceBoxes = [];
      return;
    }
    let cancelled = false;
    void (async () => {
      const boxes = await listFaceBoxes(id);
      // Paging with the arrows while a fetch is in flight would otherwise
      // paint the previous photo's boxes onto this one.
      if (!cancelled) faceBoxes = boxes;
    })();
    return () => { cancelled = true; };
  });
  // Clear the "profile photo set" flash when the open photo changes.
  $effect(() => {
    void current?.id;
    avatarDone = false;
  });

  function step(dir: 1 | -1) {
    if (open === null || assets.length === 0) return;
    open = (open + dir + assets.length) % assets.length;
  }
  function onKey(e: KeyboardEvent) {
    if (open === null) return;
    // Don't hijack arrows/Esc while typing in the tag panel.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') open = null;
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  }

  // Swipe between photos on touch.
  let touchX = 0;
  function onTouchStart(e: TouchEvent) {
    touchX = e.touches[0].clientX;
  }
  function onTouchEnd(e: TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
  }

  // Assets whose thumbnail 404s — Immich hasn't generated it yet (right
  // after an upload, behind the indexing backlog). Show a "processing"
  // overlay, but keep retrying with backoff so the tile fills in on its
  // own the moment Immich finishes — no page reload needed. (Previously
  // the first 404 stuck forever, which is why a just-uploaded photo
  // showed "processing" in the grid yet previewed fine in the lightbox:
  // the lightbox mounts a fresh <img> each open, so it picked up the
  // derivative once ready, while the grid never re-requested.)
  let pending = $state<Record<string, boolean>>({});
  let bust = $state<Record<string, number>>({}); // cache-buster per asset, forces a re-request
  const tries: Record<string, number> = {};
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};

  function thumbSrc(id: string): string {
    const base = assetThumbUrl(id);
    return bust[id] ? `${base}&_r=${bust[id]}` : base;
  }
  function onThumbOk(id: string) {
    if (pending[id]) pending[id] = false;
  }
  function onThumbError(id: string) {
    pending[id] = true;
    const n = (tries[id] = (tries[id] ?? 0) + 1);
    clearTimeout(timers[id]);
    // 4s, 8s, 16s, then every 30s — gentle, self-heals while mounted.
    timers[id] = setTimeout(() => (bust[id] = Date.now()), Math.min(2000 * 2 ** Math.min(n, 4), 30000));
  }
  onDestroy(() => {
    for (const t of Object.values(timers)) clearTimeout(t);
    clearTimeout(flashTimer);
  });

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('is-IS', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return iso?.slice(0, 10) ?? '';
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if assets.length === 0}
  <div class="rounded-[10px] border border-dashed border-surface-border p-6 text-center text-sm text-ink-400">
    No photos here yet.
  </div>
{:else}
  {#if taggable}
    <div class="mb-2 flex items-center justify-between gap-2">
      {#if selectMode}
        <div class="flex items-center gap-3 text-xs">
          <span class="font-medium text-ink-700">{selectedCount} selected</span>
          <button type="button" class="cursor-pointer text-brand hover:underline" onclick={() => (selectedIds = assets.map((a) => a.id))}>All</button>
          <button type="button" class="cursor-pointer text-ink-400 hover:text-ink-700" onclick={() => (selectedIds = [])}>Clear</button>
        </div>
        <div class="flex items-center gap-2">
          {#if rateOpen}
            <div class="flex items-center gap-0.5">
              {#each [1, 2, 3, 4, 5] as n (n)}
                <button type="button" class="cursor-pointer px-0.5 text-lg leading-none text-ink-300 hover:text-yellow-400 disabled:opacity-50" disabled={rating_busy} onclick={() => batchRate(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}>★</button>
              {/each}
              <button type="button" class="ml-1 text-[11px] text-ink-400 hover:text-ink-700" onclick={() => batchRate(0)} disabled={rating_busy}>clear</button>
              <button type="button" class="text-[11px] text-ink-400 hover:text-ink-700" onclick={() => (rateOpen = false)}>cancel</button>
            </div>
          {:else}
            <button type="button" class="btn-primary px-3 py-1.5 text-xs disabled:opacity-50" disabled={selectedCount === 0} onclick={() => (batchOpen = true)}>Tag…</button>
            <button type="button" class="btn-ghost text-xs disabled:opacity-50" disabled={selectedCount === 0} onclick={() => (rateOpen = true)}>Rate…</button>
            <button type="button" class="btn-ghost text-xs" onclick={exitSelect}>Done</button>
          {/if}
        </div>
      {:else}
        <button type="button" class="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-700" onclick={() => (selectMode = true)}>
          <Icon name="check" size={13} /> Select
        </button>
        {#if flash}<span class="text-xs text-ink-400">{flash}</span>{/if}
      {/if}
    </div>
  {/if}
  <div class="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
    {#each assets as a, i (a.id)}
      <button
        type="button"
        class="group relative aspect-square cursor-pointer overflow-hidden rounded-[6px] bg-surface-hover focus-visible:ring-2 focus-visible:ring-brand {selectMode && isSel(a.id) ? 'ring-2 ring-brand' : ''}"
        onclick={(e) => (selectMode ? selectClick(e, assets, i) : (open = i))}
        aria-label={selectMode ? `${isSel(a.id) ? 'Deselect' : 'Select'} ${a.originalFileName}` : `Open ${a.originalFileName}`}
        aria-pressed={selectMode ? isSel(a.id) : undefined}
      >
        <img
          src={thumbSrc(a.id)}
          alt={a.originalFileName}
          loading="lazy"
          class="h-full w-full object-cover transition-opacity group-hover:opacity-90 {pending[a.id] ? 'opacity-0' : ''}"
          onload={() => onThumbOk(a.id)}
          onerror={() => onThumbError(a.id)}
        />
        {#if pending[a.id]}
          <span class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-ink-300">
            <Icon name="image" size={18} />
            <span class="text-[9px]">processing…</span>
          </span>
        {/if}
        {#if a.type === 'VIDEO'}
          <span
            class="absolute right-1 top-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white"
          >▶ video</span>
        {/if}
        {#if selectMode}
          <span
            class="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border {isSel(a.id) ? 'border-brand bg-brand text-white' : 'border-white/90 bg-black/30 text-transparent'}"
          >
            <Icon name="check" size={12} />
          </span>
        {/if}
      </button>
    {/each}
  </div>
  <div class="mt-3 flex items-center justify-between text-xs text-ink-400">
    <span>{total !== null && total > assets.length ? `Showing ${assets.length} of ${total}` : `${assets.length} item${assets.length === 1 ? '' : 's'}`}</span>
    {#if onMore}
      <button type="button" class="btn-ghost text-xs" onclick={onMore} disabled={loadingMore}>
        {loadingMore ? 'Loading…' : 'Show more'}
      </button>
    {/if}
  </div>
{/if}

{#if current}
  <!-- Lightbox -->
  <div
    class="fixed inset-0 z-50 flex flex-col bg-black/90"
    role="dialog"
    aria-modal="true"
    aria-label={current.originalFileName}
    ontouchstart={onTouchStart}
    ontouchend={onTouchEnd}
  >
    <div class="flex items-center justify-between gap-3 p-3 text-white/80">
      <div class="min-w-0 text-xs">
        <div class="truncate font-medium text-white">{current.originalFileName}</div>
        <div>{fmtDate(current.fileCreatedAt)} · {open! + 1} / {assets.length}</div>
      </div>
      {#if onUseAsAvatar && current.type !== 'VIDEO'}
        <button
          type="button"
          class="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium hover:bg-white/20 disabled:opacity-60"
          onclick={useAsAvatar}
          disabled={avatarBusy || avatarDone}
        >
          <Icon name="users" size={13} />
          {avatarBusy ? 'Setting…' : avatarDone ? 'Profile photo set ✓' : 'Profile photo'}
        </button>
      {/if}
      {#if current.type !== 'VIDEO'}
        <button
          type="button"
          class="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium {facesOn ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20'}"
          onclick={() => (facesOn = !facesOn)}
          aria-pressed={facesOn}
          title="Outline the faces Immich recognised"
        >
          <Icon name="users" size={13} /> Faces{#if facesOn && faceBoxes.length > 0}{' '}{faceBoxes.length}{/if}
        </button>
      {/if}
      <button
        type="button"
        class="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium {infoOpen ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20'}"
        onclick={() => (infoOpen = !infoOpen)}
        aria-pressed={infoOpen}
      >
        <Icon name="notebook" size={13} /> Info
      </button>
      <button
        type="button"
        class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-white/10"
        onclick={() => (open = null)}
        aria-label="Close"
      >
        <Icon name="x" size={18} />
      </button>
    </div>

    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="relative flex min-h-0 flex-1 items-center justify-center" onclick={() => (open = null)}>
      {#if current.type === 'VIDEO'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          src={assetVideoUrl(current.id)}
          poster={assetThumbUrl(current.id, 'preview')}
          controls
          playsinline
          class="max-h-full max-w-full"
          onclick={(e) => e.stopPropagation()}
        ></video>
      {:else}
        <!-- The wrapper shrink-wraps the image so FaceBoxes' percentages are
             relative to the RENDERED image rect. Dropping the overlay into the
             flex centring container instead would offset every box by the
             letterboxing, silently. -->
        <span class="relative inline-flex max-h-full max-w-full">
          <img
            src={assetThumbUrl(current.id, 'preview')}
            alt={current.originalFileName}
            class="max-h-full max-w-full object-contain"
            onclick={(e) => e.stopPropagation()}
          />
          {#if facesOn}
            <FaceBoxes boxes={faceBoxes} highlight={highlightClusters} />
          {/if}
        </span>
      {/if}

      {#if assets.length > 1}
        <button
          type="button"
          class="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
          onclick={(e) => {
            e.stopPropagation();
            step(-1);
          }}
          aria-label="Previous photo"
        >
          <Icon name="chevron-left" size={20} />
        </button>
        <button
          type="button"
          class="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
          onclick={(e) => {
            e.stopPropagation();
            step(1);
          }}
          aria-label="Next photo"
        >
          <Icon name="chevron-right" size={20} />
        </button>
      {/if}

      {#if infoOpen}
        <aside
          class="absolute right-0 top-0 bottom-0 z-20 w-full max-w-[22rem] border-l border-white/10 bg-black/85 backdrop-blur"
        >
          <PhotoInfoPanel assetId={current.id} {taggable} onChanged={onTagsChanged} />
        </aside>
      {/if}
    </div>
  </div>
{/if}

{#if batchOpen}
  <PhotoBatchTag assetIds={selectedIds} onApplied={onBatchApplied} onClose={() => (batchOpen = false)} />
{/if}
