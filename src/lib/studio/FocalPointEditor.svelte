<script lang="ts">
  // Optional centre-point marker for an image. Click the thumbnail to
  // place the dot — saved on the Directus file itself (native
  // focal_point_x/y), so every cover-crop of this photo, in any
  // template or size, centres on it. Clearing falls back to the
  // geometric middle.
  import { assetUrl, formatError } from '$lib/directus';
  import { getFileFocal, setFileFocal, type FocalPoint } from './data';

  let {
    fileId,
    onChange
  }: {
    fileId: string;
    /** Fired after a save so the caller can re-render previews. */
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
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
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
</script>

<div class="space-y-1">
  <div class="flex items-center gap-2 text-[10px] text-ink-400">
    <span>Centre point {dot ? '' : '— optional, click the photo to set'}</span>
    {#if dot}
      <button type="button" class="cursor-pointer transition hover:text-ink-700" onclick={clear} disabled={busy}>clear</button>
    {/if}
    {#if busy}<span>Saving…</span>{/if}
  </div>
  <button
    type="button"
    class="relative block w-44 max-w-full cursor-crosshair overflow-hidden rounded-md border border-surface-border"
    title="Click where this photo should centre when cropped"
    disabled={busy}
    onclick={place}
  >
    <img src={assetUrl(fileId, { width: 360 })} alt="" class="block w-full" draggable="false" />
    {#if dot}
      <span
        class="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
        style="left: {dot.fx * 100}%; top: {dot.fy * 100}%; background: var(--accent-electric);"
      ></span>
    {/if}
  </button>
  {#if errorMsg}
    <p class="text-[10px]" style="color: #C0392B;">{errorMsg}</p>
  {/if}
</div>
