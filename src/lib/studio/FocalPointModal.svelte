<script lang="ts">
  // Full-screen centre-point editor — the lightbox-sized sibling of
  // FocalPointEditor for use inside content flows (Evergreen, Studio),
  // so the crop centre can be adjusted without leaving the page.
  // Click the large image to place the dot; saved on the Directus file
  // itself (native focal_point_x/y), same store as everywhere else.
  import Icon from '$lib/Icon.svelte';
  import { assetUrl, formatError } from '$lib/directus';
  import { getFileFocal, setFileFocal, type FocalPoint } from './data';

  let {
    fileId,
    onClose,
    onChange
  }: {
    fileId: string;
    onClose: () => void;
    /** Fired after each save so the host can re-render previews. */
    onChange?: () => void;
  } = $props();

  let dot = $state<FocalPoint | null>(null);
  let busy = $state(false);
  let errorMsg = $state<string | null>(null);

  $effect(() => {
    const id = fileId;
    dot = null;
    errorMsg = null;
    getFileFocal(id).then((f) => {
      if (id === fileId) dot = f;
    });
  });

  async function place(e: MouseEvent) {
    const img = e.currentTarget as HTMLElement;
    const r = img.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    busy = true;
    errorMsg = null;
    try {
      await setFileFocal(fileId, fx, fy);
      dot = { fx, fy };
      onChange?.();
    } catch (err) {
      errorMsg = formatError(err);
    } finally {
      busy = false;
    }
  }

  async function clear() {
    busy = true;
    errorMsg = null;
    try {
      await setFileFocal(fileId, null, null);
      dot = null;
      onChange?.();
    } catch (err) {
      errorMsg = formatError(err);
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="fixed inset-0 z-50 flex flex-col bg-black/90"
  role="dialog"
  aria-modal="true"
  aria-label="Centre point"
>
  <div class="flex items-center justify-between gap-3 p-3 text-white/80">
    <div class="min-w-0 text-xs">
      <div class="font-medium text-white">Centre point</div>
      <div>Click where the image should centre when cropped{dot ? '' : ' — none set, crops use the middle'}</div>
    </div>
    <span class="flex shrink-0 items-center gap-2">
      {#if busy}
        <span class="text-xs">Saving…</span>
      {/if}
      {#if dot}
        <button
          type="button"
          class="flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium hover:bg-white/20"
          disabled={busy}
          onclick={clear}
        >
          <Icon name="x" size={13} /> Clear point
        </button>
      {/if}
      <button
        type="button"
        class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-white/10"
        onclick={onClose}
        aria-label="Close"
      >
        <Icon name="x" size={18} />
      </button>
    </span>
  </div>

  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="flex min-h-0 flex-1 items-center justify-center p-4" onclick={onClose}>
    <span class="relative inline-block max-h-full max-w-full">
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
      <img
        src={assetUrl(fileId, { width: 1600, withoutEnlargement: 'true' })}
        alt=""
        class="block max-h-[78vh] max-w-full cursor-crosshair object-contain"
        draggable="false"
        onclick={(e) => {
          e.stopPropagation();
          void place(e);
        }}
      />
      {#if dot}
        <span
          class="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg"
          style="left: {dot.fx * 100}%; top: {dot.fy * 100}%; background: var(--accent-electric);"
        ></span>
      {/if}
    </span>
  </div>

  {#if errorMsg}
    <p class="p-3 text-center text-xs" style="color: #E07060;">{errorMsg}</p>
  {/if}
</div>
