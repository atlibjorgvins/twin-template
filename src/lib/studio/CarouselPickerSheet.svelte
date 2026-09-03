<script lang="ts">
  // Full-screen photo picker for the carousel builder.
  //
  // The pool it replaces lives in a sidebar at 72px per tile, zoomable to 168
  // but inside a column too narrow for that to help. Selecting and deselecting
  // a dozen photos out of 120 meant hitting 72px squares — so this trades the
  // sidebar's always-visible convenience for targets you can actually hit,
  // and hands selection back when you close.
  //
  // It owns no selection state: `picked` is the parent's Set, so closing the
  // sheet cannot lose or diverge from what the sidebar shows.
  import Icon from '$lib/Icon.svelte';

  type Photo = { fileId: string; caption?: string | null };

  let {
    open = false,
    photos,
    picked,
    thumb,
    ratingOf,
    minStars = $bindable(0),
    includeUnrated = $bindable(true),
    hiddenByFilter = 0,
    metaLoading = false,
    confirmLabel = 'Use photos',
    onPick,
    onSelectAll,
    onClear,
    onConfirm,
    onClose
  }: {
    open?: boolean;
    photos: Photo[];
    picked: Set<string>;
    thumb: (fileId: string) => string;
    ratingOf: (fileId: string) => number | null;
    minStars?: number;
    includeUnrated?: boolean;
    hiddenByFilter?: number;
    metaLoading?: boolean;
    confirmLabel?: string;
    /** Forwarded with the modifier so the parent keeps one selection path —
     *  and therefore one shift-range anchor. */
    onPick: (index: number, fileId: string, shiftKey: boolean) => void;
    onSelectAll: () => void;
    onClear: () => void;
    onConfirm: () => void;
    onClose: () => void;
  } = $props();

  // Tile size is a preference, not a workaround for a cramped column — the
  // sheet is full width, so even the small end is a comfortable target.
  let tile = $state(150);

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    // ⌘/Ctrl+A selects everything shown, matching the file-manager habit the
    // shift-range selection already borrows.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); onSelectAll(); }
  }

  function click(i: number, fileId: string, e: MouseEvent) {
    onPick(i, fileId, e.shiftKey);
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <!-- Fixed rather than a BottomSheet: that component caps at max-w-md on
       desktop, which is the constraint this exists to escape. -->
  <div class="fixed inset-0 z-50 flex flex-col bg-surface-page" role="dialog" aria-modal="true" aria-label="Choose photos">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-surface-divider px-4 py-3">
      <span class="font-display text-sm font-semibold text-ink-900">Choose photos</span>
      <span class="text-xs text-ink-500">{picked.size} of {photos.length} selected</span>

      <span class="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span class="flex items-center gap-0.5" title="Tile size">
          <button class="rounded border border-surface-border px-1.5 leading-none text-ink-500 hover:bg-surface-hover disabled:opacity-40"
            onclick={() => (tile = Math.max(110, tile - 30))} disabled={tile <= 110} aria-label="Smaller tiles">−</button>
          <button class="rounded border border-surface-border px-1.5 leading-none text-ink-500 hover:bg-surface-hover disabled:opacity-40"
            onclick={() => (tile = Math.min(260, tile + 30))} disabled={tile >= 260} aria-label="Larger tiles">+</button>
        </span>
        <button class="btn-ghost text-xs" onclick={onSelectAll}>Select all</button>
        <button class="btn-ghost text-xs" onclick={onClear} disabled={picked.size === 0}>Clear</button>
        <button class="btn-ghost !px-2" onclick={onClose} aria-label="Close">×</button>
      </span>
    </header>

    <!-- The star filter travels with the picker: narrowing to your rated
         photos is most useful exactly when you're choosing. -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-surface-divider px-4 py-2 text-xs">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Stars</span>
      {#each [0, 3, 4, 5] as n (n)}
        <button type="button" class="chip-radio {minStars === n ? 'is-selected' : ''}"
          aria-pressed={minStars === n} onclick={() => (minStars = n)}>{n === 0 ? 'Any' : `${n}★+`}</button>
      {/each}
      {#if minStars > 0}
        <label class="flex items-center gap-1 text-ink-500">
          <input type="checkbox" bind:checked={includeUnrated} /> include unrated
        </label>
        {#if hiddenByFilter > 0}<span class="text-ink-400">{hiddenByFilter} hidden</span>{/if}
      {/if}
      {#if metaLoading}<span class="text-ink-300">loading ratings…</span>{/if}
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto scroll-momentum p-4">
      {#if photos.length === 0}
        <p class="mt-8 text-center text-sm text-ink-400">
          Nothing matches this filter{minStars > 0 ? ' — try Any, or include unrated' : ''}.
        </p>
      {:else}
        <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax({tile}px, 1fr));">
          {#each photos as p, i (p.fileId)}
            {@const on = picked.has(p.fileId)}
            {@const stars = ratingOf(p.fileId)}
            <button
              type="button"
              class="relative aspect-square overflow-hidden rounded-[10px] border-2 bg-cover bg-center transition {on ? 'border-brand' : 'border-transparent hover:border-surface-border'}"
              style="background-image:url({thumb(p.fileId)})"
              aria-pressed={on}
              title="Click to select · shift-click for a range"
              onclick={(e) => click(i, p.fileId, e)}
            >
              <!-- A real checkmark, sized to be hit rather than admired. The
                   sidebar's only cue was a border on a 72px square. -->
              <span
                class="absolute left-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border-2 {on ? 'border-brand bg-brand text-white' : 'border-white/80 bg-ink-900/30 text-transparent'}"
                aria-hidden="true"
              ><Icon name="check" size={13} /></span>
              {#if stars}
                <span class="absolute bottom-1.5 right-1.5 rounded-full bg-ink-900/70 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
                  {stars}★
                </span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <footer class="flex items-center justify-between gap-3 border-t border-surface-divider px-4 py-3 pb-safe-plus-2">
      <span class="text-xs text-ink-500">{picked.size} selected</span>
      <span class="flex items-center gap-2">
        <button class="btn-ghost text-sm" onclick={onClose}>Cancel</button>
        <button class="btn-primary text-sm" disabled={picked.size === 0} onclick={onConfirm}>
          {confirmLabel}
        </button>
      </span>
    </footer>
  </div>
{/if}
