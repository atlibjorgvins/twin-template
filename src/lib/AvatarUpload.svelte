<script lang="ts">
  import Avatar from '$lib/Avatar.svelte';
  import Icon from '$lib/Icon.svelte';
  import { uploadFile, uploadFromUrl, resizeImageFile } from '$lib/directus';
  import { setFileFocal } from '$lib/studio/data';
  import PhotoPickerSheet from '$lib/photos/PhotoPickerSheet.svelte';
  import { fetchAssetFile } from '$lib/immich';
  import { faceSpotFor, clusterIdsFor, cropFaceSquare } from '$lib/photos/personPhotos';

  let {
    name,
    src,
    /** Uncropped source (no fit=cover transform) — used for repositioning. */
    rawSrc,
    size = 88,
    onUploaded,
    /** Current focal point as CSS object-position (e.g. "50% 30%"). */
    focal = '',
    /** Called when the user repositions the existing image. */
    onFocalChange,
    /** Directus file id of the picture. When set, repositioning also
     *  writes the file's native focal point, so Image Studio crops and
     *  Directus cover transforms centre on the same spot. */
    fileId = null,
    title = 'Click to change picture',
    /** Resize images to this many px on the longest edge before upload. */
    maxEdge = 800,
    quality = 0.85,
    /**
     * Optional website. Reserved for future "Grab from web" menu
     * items; currently unused after the Clearbit Logo API shutdown
     * — the dedicated Enrich Org dialog handles auto-grab from the
     * site's own icons.
     */
    website = '',
    bgColor = '',
    /** twin Person id. Shorthand for photoOwner={{ collection: 'Person', id }}
     *  — kept because most callers are people and faces only exist there. */
    personId = null,
    /** Any record photos can be tagged to (organization / Project / event).
     *  Gives the same picker without the face crop, since only people have
     *  faces. Ignored when personId is set. */
    photoOwner = null
  }: {
    name: string;
    src?: string;
    rawSrc?: string;
    size?: number;
    onUploaded: (fileId: string) => void | Promise<void>;
    focal?: string | null;
    onFocalChange?: (focal: string) => void | Promise<void>;
    fileId?: string | null;
    title?: string;
    maxEdge?: number;
    quality?: number;
    website?: string | null;
    /** Backdrop for contain-mode logos — forwarded to Avatar. */
    bgColor?: string;
    personId?: number | null;
    photoOwner?: { collection: 'organization' | 'Project' | 'Person' | 'event'; id: number } | null;
  } = $props();

  // `website` is currently unused — kept on the props for API
  // compatibility while callers slowly drop it. Reference it once
  // so the unused-var lint stays quiet.
  void website;

  let input: HTMLInputElement | undefined = $state();
  let urlInputEl: HTMLInputElement | undefined = $state();
  let menuOpen = $state(false);
  let urlOpen = $state(false);
  let urlValue = $state('');
  let uploading = $state(false);
  let status = $state<string>(''); // user-facing progress hint
  let error = $state('');

  // --- Repositioning ---
  // We track focal in *image-space* (0..1 of the natural image) so the
  // picker is intuitive on non-square sources. At save time we convert to
  // CSS object-position percentages, which depend on the image aspect.
  let reposOpen = $state(false);
  let imgFx = $state(0.5);   // 0..1
  let imgFy = $state(0.5);   // 0..1
  let zoom = $state(1);
  let fit = $state<'cover' | 'contain'>('cover');
  /** Backdrop behind a contain-mode logo. Empty = the page surface. */
  let bgDraft = $state('');
  // Contain-mode pan, as a fraction of the circle's diameter. 0,0 = centred.
  // Cover uses imgFx/imgFy (a focal point in image space); contain can't —
  // at zoom 1 the whole image is inside the frame, so there is no focal point
  // to choose, only an offset to nudge. Serialised into the same "x% y%"
  // tokens with 50% meaning centred, so values written before this still read
  // as centred.
  let panX = $state(0);
  let panY = $state(0);

  /** Scale at which the whole image sits inside the CIRCLE rather than the
   *  square it is inscribed in — the zoom-1 baseline for contain. Mirrors
   *  Avatar's inscribePct so the picker and the real avatar agree. */
  /** Zoom that makes the image cover the circle, expressed against the
   *  inscribed baseline that zoom 1 means. A square needs √2; a 4:1 wordmark
   *  needs ~4, because contain-fitting it leaves its height at a quarter. */
  const fillZoom = $derived.by(() => {
    if (!imgNW || !imgNH) return 1;
    const a = imgNW / imgNH;
    return Math.max(a, 1 / a) / inscribe;
  });

  const inscribe = $derived.by(() => {
    if (!imgNW || !imgNH) return 1;
    const w = imgNW >= imgNH ? 1 : imgNW / imgNH;
    const h = imgNH >= imgNW ? 1 : imgNH / imgNW;
    return Math.min(1, 1 / Math.hypot(w, h));
  });
  let saving = $state(false);

  // Natural image dimensions (set once the picker img loads).
  let imgEl: HTMLImageElement | undefined = $state();
  let imgNW = $state(0);
  let imgNH = $state(0);
  // If the user reopens, we have a saved object-position to restore. We
  // can only convert it back to image-space once we know the natural size,
  // so stash the pending value and resolve it on load.
  let pendingObjPos: { x: number; y: number } | null = $state(null);

  const PICK_SIZE = 220; // px — the picker viewport (square)

  /** The answers people actually want for a transparent logo, so the OS colour
   *  dialog is the fallback rather than the first step. Empty = page surface,
   *  which is what every logo does today. */
  const BACKDROP_SWATCHES: ReadonlyArray<{ value: string; label: string }> = [
    { value: '', label: 'Page surface' },
    { value: '#ffffff', label: 'White' },
    { value: '#f4f4f5', label: 'Light grey' },
    { value: '#18181b', label: 'Near black' }
  ];

  function parseFocal(s: string | null | undefined): { x: number; y: number; z: number; fit: 'cover' | 'contain'; bg: string } {
    if (!s) return { x: 50, y: 50, z: 1, fit: 'cover', bg: '' };
    const tokens = s.trim().split(/\s+/);
    let x = 50, y = 50, z = 1;
    let f: 'cover' | 'contain' = 'cover';
    let bg = '';
    let posCount = 0;
    for (const t of tokens) {
      if (/^-?\d+(\.\d+)?%$/.test(t)) {
        const n = parseFloat(t);
        if (!isNaN(n)) {
          if (posCount === 0) { x = n; posCount = 1; }
          else if (posCount === 1) { y = n; posCount = 2; }
        }
      } else if (/z$/i.test(t)) {
        const v = parseFloat(t);
        if (!isNaN(v) && v > 0) z = v;
      } else if (/^contain$/i.test(t)) f = 'contain';
      else if (/^cover$/i.test(t)) f = 'cover';
      // A backdrop colour rides in the same string. image_focal is a
      // free-form display-settings token list and both parsers skip tokens
      // they don't know, so adding one needs no schema change and old values
      // keep working.
      else if (/^#[0-9a-f]{3,8}$/i.test(t)) bg = t;
    }
    return { x, y, z, fit: f, bg };
  }

  // Convert image-fraction → CSS object-position % for a square (cover) target.
  function imgFracToObjPos(fx: number, fy: number, iw: number, ih: number) {
    if (!iw || !ih) return { x: 50, y: 50 };
    const a = iw / ih;
    let X = 50, Y = 50;
    if (a > 1) X = ((fx * a - 0.5) / (a - 1)) * 100;
    else if (a < 1) Y = ((fy / a - 0.5) / (1 / a - 1)) * 100;
    return {
      x: Math.max(0, Math.min(100, X)),
      y: Math.max(0, Math.min(100, Y))
    };
  }
  // Inverse: CSS object-position % → image fraction.
  function objPosToImgFrac(opx: number, opy: number, iw: number, ih: number) {
    if (!iw || !ih) return { fx: 0.5, fy: 0.5 };
    const a = iw / ih;
    let fx = 0.5, fy = 0.5;
    if (a > 1) fx = ((opx / 100) * (a - 1) + 0.5) / a;
    else if (a < 1) fy = a * ((opy / 100) * (1 / a - 1) + 0.5);
    return {
      fx: Math.max(0, Math.min(1, fx)),
      fy: Math.max(0, Math.min(1, fy))
    };
  }

  // Rendered image box inside the picker (object-contain).
  const renderedImg = $derived.by(() => {
    if (!imgNW || !imgNH) return { w: PICK_SIZE, h: PICK_SIZE, ox: 0, oy: 0 };
    const a = imgNW / imgNH;
    let w = PICK_SIZE, h = PICK_SIZE;
    if (a >= 1) { w = PICK_SIZE; h = PICK_SIZE / a; }
    else { h = PICK_SIZE; w = PICK_SIZE * a; }
    return { w, h, ox: (PICK_SIZE - w) / 2, oy: (PICK_SIZE - h) / 2 };
  });

  // Visible image-fraction (what the avatar will actually show), accounting
  // for cover-fit + zoom. Square avatar, so the visible region is a square
  // in image-pixel space sized by the smaller dim/zoom.
  const visible = $derived.by(() => {
    if (!imgNW || !imgNH) return { vw: 1, vh: 1, left: 0, top: 0 };
    const a = imgNW / imgNH;
    const vw = (a >= 1 ? 1 / a : 1) / zoom;
    const vh = (a >= 1 ? 1 : a) / zoom;
    // Center the viewport on the focal, clamping to image edges.
    let left = imgFx - vw / 2;
    let top = imgFy - vh / 2;
    left = Math.max(0, Math.min(1 - vw, left));
    top = Math.max(0, Math.min(1 - vh, top));
    return { vw, vh, left, top };
  });
  // Viewport rectangle in picker-pixel coordinates (the part of the
  // rendered image that will be visible in the avatar).
  const viewport = $derived.by(() => {
    const r = renderedImg, v = visible;
    return {
      x: r.ox + v.left * r.w,
      y: r.oy + v.top * r.h,
      w: v.vw * r.w,
      h: v.vh * r.h
    };
  });

  // Saved string (object-position based, so Avatar uses it directly).
  // In contain mode, focal coordinates have less effect (the whole image is
  // visible) but we still write them so toggling back to cover preserves
  // intent.
  // Serialised back into image_focal. Colour last so the older
  // "x% y% Zz contain" prefix still reads identically to anything that
  // predates this.
  const focalDraft = $derived.by(() => {
    const bg = bgDraft ? ` ${bgDraft}` : '';
    // Always the same shape. The `contain` token stays as the marker that
    // says "x/y are a pan offset, z is scale against the inscribed size" —
    // values without it predate this and are read the old way. It is a
    // storage format flag now, not a mode the user picks.
    const x = 50 + panX * 100;
    const y = 50 + panY * 100;
    return `${x.toFixed(1)}% ${y.toFixed(1)}% ${zoom.toFixed(2)}z contain${bg}`;
  });

  function openReposition() {
    if (!(rawSrc || src)) return;
    menuOpen = false;
    const p = parseFocal(focal);
    zoom = p.z;
    fit = p.fit;
    bgDraft = p.bg;
    // A legacy value's x/y is an object-position focal, which is not a pan —
    // reading it as one would jump the image. Open those centred instead.
    panX = p.fit === 'contain' ? (p.x - 50) / 100 : 0;
    panY = p.fit === 'contain' ? (p.y - 50) / 100 : 0;
    fit = 'contain';
    if (imgNW && imgNH) {
      const f = objPosToImgFrac(p.x, p.y, imgNW, imgNH);
      imgFx = f.fx; imgFy = f.fy;
      pendingObjPos = null;
    } else {
      // Image not loaded yet — resolve in onImgLoad.
      pendingObjPos = { x: p.x, y: p.y };
      imgFx = 0.5; imgFy = 0.5;
    }
    reposOpen = true;
  }
  function onImgLoad() {
    if (!imgEl) return;
    imgNW = imgEl.naturalWidth;
    imgNH = imgEl.naturalHeight;
    if (pendingObjPos) {
      const f = objPosToImgFrac(pendingObjPos.x, pendingObjPos.y, imgNW, imgNH);
      imgFx = f.fx; imgFy = f.fy;
      pendingObjPos = null;
    }
  }
  function onPickPoint(e: MouseEvent) {
    if (!imgEl) return;
    const r = imgEl.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    if (px < 0 || px > 1 || py < 0 || py > 1) return; // clicked the letterbox
    imgFx = px; imgFy = py;
  }

  // --- drag to pan ---
  let dragging = $state(false);
  let dragStart: { mx: number; my: number; fx: number; fy: number } | null = null;
  let didDrag = false; // suppresses the click that follows a real drag
  function onPointerDown(e: PointerEvent) {
    if (!imgEl) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
    didDrag = false;
    dragStart = { mx: e.clientX, my: e.clientY, fx: panX, fy: panY };
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging || !dragStart || !imgEl) return;
    if (Math.hypot(e.clientX - dragStart.mx, e.clientY - dragStart.my) > 3) didDrag = true;
    const r = imgEl.getBoundingClientRect();
    const dx = (e.clientX - dragStart.mx) / r.width;
    const dy = (e.clientY - dragStart.my) / r.height;
    // Whatever visibly moves must follow the cursor. Which element that is
    // depends on the mode: in cover the image is fixed and the crop ring moves
    // over it; in contain the ring IS the avatar boundary, fixed and centred,
    // so the image moves instead. Both read as "drag right, it goes right".
    panX = dragStart.fx + dx;
    panY = dragStart.fy + dy;
  }
  function onPointerUp(e: PointerEvent) {
    dragging = false;
    dragStart = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }
  // Click without drag = set focal directly to the click point.
  function onPickerClick(e: MouseEvent) {
    // Click-to-focus belonged to the focal-point model. Dragging is the one
    // way to position now, so a stray click no longer jumps the image.
    if (didDrag) didDrag = false;
  }
  // --- wheel / pinch to zoom ---
  function onWheel(e: WheelEvent) {
    // Zoom applies in both modes now. Past 1 in contain the logo grows beyond
    // the circle and starts to crop — deliberate: the mode sets the starting
    // point, the user owns it after that.
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    // The floor depends on the mode. Cover's job is to fill the circle, so
    // below 1 would just open gaps — keep it at 1. Contain's whole point is
    // the opposite: below 1 is breathing room around a logo that would
    // otherwise sit edge-to-edge, which is what a 4:1 wordmark needs once its
    // height has run out. Above 1 both crop, deliberately.
    zoom = Math.max(0.25, Math.min(6, zoom + delta));
  }
  async function saveReposition() {
    if (!onFocalChange) { reposOpen = false; return; }
    saving = true;
    error = '';
    try {
      await onFocalChange(focalDraft);
      // Mirror the pick onto the file itself (image-space fractions →
      // native focal_point_x/y) so Studio crops and Directus cover
      // transforms centre on the same spot. Best-effort: the display
      // focal is already saved, so a failure here shouldn't block.
      if (fileId) await setFileFocal(fileId, imgFx, imgFy).catch(() => {});
      reposOpen = false;
    }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { saving = false; }
  }

  function openMenu() {
    if (uploading) return;
    error = '';
    menuOpen = !menuOpen;
    urlOpen = false;
  }

  function startFilePick() {
    menuOpen = false;
    error = '';
    input?.click();
  }

  async function startUrl() {
    menuOpen = false;
    error = '';
    urlValue = '';
    // Try the clipboard first — clicking this menu item is a user gesture,
    // so if an image URL is already copied we can prefill + fetch straight
    // away with no extra click/paste/enter.
    try {
      const clip = (await navigator.clipboard.readText())?.trim();
      if (clip && /^https?:\/\/\S+$/i.test(clip)) {
        urlValue = clip;
        urlOpen = true;          // show the panel (with the value) …
        await submitUrl();       // … then fetch immediately; on error the
        return;                  //     panel stays open for a retry/edit.
      }
    } catch { /* clipboard blocked/empty — fall back to manual entry */ }
    // Fallback: open the field focused so a paste is one keystroke away.
    urlOpen = true;
    queueMicrotask(() => urlInputEl?.focus());
  }

  // ── From tagged photos ─────────────────────────────────────────────
  let pickerOpen = $state(false);

  /** personId is shorthand; photoOwner is the general form. */
  const owner = $derived(
    personId != null
      ? ({ collection: 'Person' as const, id: personId })
      : photoOwner
  );
  /** Only people have faces, so only they get the crop. */
  const facePersonId = $derived(owner?.collection === 'Person' ? owner.id : null);

  function startPhotoPick() {
    menuOpen = false;
    pickerOpen = true;
  }

  /**
   * Import a chosen Immich asset as the picture, then aim the crop at this
   * person's face in it.
   *
   * Order matters: the file has to exist before its focal point can be
   * written, and the focal point is best-effort — a photo Immich has no box
   * for still becomes the avatar, just centred. Failing the whole pick
   * because the crop could not be improved would be the wrong trade.
   */
  async function onPickPhoto(assetId: string, filename: string) {
    uploading = true;
    error = '';
    try {
      status = 'Fetching…';
      // 'preview' rather than the original: an avatar never needs 24 MP, and
      // the preview already has EXIF rotation applied.
      const file = await fetchAssetFile(assetId, filename || name, 'preview');

      // Look for their face BEFORE uploading, because it decides what we
      // upload: a tight portrait cut from the photo, or the photo itself.
      let spot = null;
      if (facePersonId != null) {
        status = 'Finding their face…';
        try {
          spot = await faceSpotFor(assetId, await clusterIdsFor(facePersonId));
        } catch {
          // No face data — fall through to the whole photo.
        }
      }

      let toUpload: File;
      if (spot) {
        status = 'Cropping to their face…';
        toUpload = await cropFaceSquare(file, spot, { maxEdge, quality });
      } else {
        status = 'Resizing…';
        toUpload = await resizeImageFile(file, { maxEdge, quality });
      }

      status = 'Uploading…';
      const id = await uploadFile(toUpload, { title: name });
      await onUploaded(id);

      // A face crop is already centred on the face, so any previous focal
      // point is now wrong — reset it rather than leaving a stale offset.
      if (spot) {
        await onFocalChange?.('50% 50%');
        await setFileFocal(id, 0.5, 0.5).catch(() => {});
      }
      pickerOpen = false;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      uploading = false;
      status = '';
    }
  }


  /** A freshly uploaded PNG is a logo, not a portrait: default it to contain
   *  so the whole mark shows instead of being cropped to the circle. Only on
   *  upload — it never overrides a focal the user has already tuned, because
   *  the image it described has just been replaced. */
  async function applyUploadDefaults(file: { type?: string } | null) {
    if (!onFocalChange) return;
    if ((file?.type ?? '').toLowerCase() !== 'image/png') return;
    const keepBg = parseFocal(focal).bg;
    await onFocalChange(`50.0% 50.0% 1.00z contain${keepBg ? ` ${keepBg}` : ''}`);
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;

  async function onFile(e: Event){

    const target = e.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { error = 'Please pick an image file.'; return; }
    if (file.size > 25 * 1024 * 1024) { error = 'Image too large (max 25 MB).'; return; }
    uploading = true;
    error = '';
    try {
      status = 'Resizing…';
      const small = await resizeImageFile(file, { maxEdge, quality });
      status = 'Uploading…';
      const id = await uploadFile(small, { title: name });
      await onUploaded(id);
      await applyUploadDefaults(file);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      uploading = false;
      status = '';
    }
  }

  async function submitUrl() {
    const url = urlValue.trim();
    if (!url) return;
    uploading = true;
    error = '';
    try {
      status = 'Downloading…';
      const { id, via } = await uploadFromUrl(url, { title: name, maxEdge, quality });
      status = via === 'directus-import' ? 'Imported (full-size)' : 'Resized & uploaded';
      await onUploaded(id);
      urlOpen = false;
      urlValue = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      uploading = false;
      // Brief hold so user sees the via-message; clear async.
      setTimeout(() => { status = ''; }, 1500);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { menuOpen = false; urlOpen = false; reposOpen = false; }
    if (e.key === 'Enter' && urlOpen) { e.preventDefault(); submitUrl(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="relative inline-block" style="width: {size}px;">
  <button
    type="button"
    class="group relative block rounded-full focus:outline-none focus:ring-2 focus:ring-brand"
    style="width: {size}px; height: {size}px"
    onclick={openMenu}
    {title}
    aria-label={title}
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    disabled={uploading}
  >
    <Avatar {name} {src} {size} position={focal ?? ''} {bgColor} />
    {#if uploading}
      <!-- During upload, a centred status pill is the right affordance. -->
      <span class="absolute inset-0 flex items-center justify-center rounded-full bg-ink-900/40 text-xs font-medium text-white">
        {status || 'Working…'}
      </span>
    {:else}
      <!-- Idle: a small corner edit badge instead of a full-cover overlay,
           so the logo stays visible while the user hovers/taps. -->
      <span
        class="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-card bg-brand text-white shadow-card transition group-hover:scale-110 {menuOpen ? 'scale-110' : ''}"
      >
        <Icon name="plus" size={12} />
      </span>
    {/if}
  </button>

  {#if menuOpen && !uploading}
    <div
      role="menu"
      class="absolute left-0 top-full z-30 mt-2 w-52 overflow-hidden rounded-[10px] border border-surface-border bg-surface-card shadow-card"
    >
      {#if owner}
        <button
          role="menuitem"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
          onclick={startPhotoPick}
        >
          <Icon name="image" size={14} />
          {facePersonId != null ? 'Choose from their photos…' : 'Choose from tagged photos…'}
        </button>
      {/if}
      <button
        role="menuitem"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
        onclick={startFilePick}
      >
        <Icon name="plus" size={14} /> Upload from device
      </button>
      <button
        role="menuitem"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
        onclick={startUrl}
      >
        <Icon name="globe" size={14} /> Paste image URL…
      </button>
      {#if src && onFocalChange}
        <button
          role="menuitem"
          type="button"
          class="flex w-full items-center gap-2 border-t border-surface-divider px-3 py-2 text-left text-sm hover:bg-surface-hover"
          onclick={openReposition}
        >
          <Icon name="move" size={14} /> Adjust…
        </button>
      {/if}
    </div>
  {/if}

  {#if reposOpen && (rawSrc || src)}
    <div class="absolute left-0 top-full z-30 mt-2 w-[22rem] rounded-[10px] border border-surface-border bg-surface-card p-3 shadow-card">
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="text-xs font-medium text-ink-700">
          Drag to move · scroll to resize
        </div>
        <!-- Presets, not modes. Each one just sets scale and pan to a
             sensible starting point; from there you drag and scroll, and
             nothing you picked keeps describing the result. That is why the
             words "cover" and "contain" are gone from the UI — after one drag
             they were lying. -->
        <div class="inline-flex gap-1 text-[11px]">
          <button
            type="button"
            class="rounded-md border border-surface-border px-2 py-0.5 text-ink-600 hover:bg-surface-hover"
            onclick={() => { zoom = fillZoom; panX = 0; panY = 0; }}
            title="Scale up until the image covers the whole circle"
          >Fill</button>
          <button
            type="button"
            class="rounded-md border border-surface-border px-2 py-0.5 text-ink-600 hover:bg-surface-hover"
            onclick={() => { zoom = 1; panX = 0; panY = 0; }}
            title="Show the whole image inside the circle"
          >Fit</button>
          <button
            type="button"
            class="rounded-md border border-surface-border px-2 py-0.5 text-ink-600 hover:bg-surface-hover"
            onclick={() => { panX = 0; panY = 0; }}
            title="Re-centre without changing the size"
          >Center</button>
        </div>
      </div>

      <!-- Backdrop, contain mode only. A cover image fills the circle, so a
           colour behind it could never be seen. Transparent PNGs are exactly
           why this exists: a white mark on the page surface is invisible until
           you put something behind it. -->
      {#if fit === 'contain'}
        <div class="mb-2 flex items-center gap-2">
          <span class="shrink-0 text-xs text-ink-400">Backdrop</span>
          <div class="flex items-center gap-1">
            {#each BACKDROP_SWATCHES as sw (sw.value)}
              <button
                type="button"
                class="h-6 w-6 rounded-full border {bgDraft.toLowerCase() === sw.value.toLowerCase() ? 'border-brand ring-2 ring-brand/40' : 'border-surface-border'}"
                style={sw.value ? `background:${sw.value}` : 'background:var(--bg-primary)'}
                title={sw.label}
                aria-label={sw.label}
                aria-pressed={bgDraft.toLowerCase() === sw.value.toLowerCase()}
                onclick={() => (bgDraft = sw.value)}
              >{#if !sw.value}<span class="text-[9px] text-ink-400">—</span>{/if}</button>
            {/each}
          </div>
          <input
            type="color"
            class="h-6 w-8 cursor-pointer rounded border border-surface-border bg-transparent p-0"
            value={bgDraft || '#ffffff'}
            oninput={(e) => (bgDraft = (e.currentTarget as HTMLInputElement).value)}
            title="Pick any colour"
            aria-label="Pick a backdrop colour"
          />
          {#if bgDraft}
            <button type="button" class="text-xs text-ink-400 hover:text-ink-700" onclick={() => (bgDraft = '')}>Clear</button>
          {/if}
        </div>
      {/if}

      <div class="flex gap-3">
        <div
          class="relative flex items-center justify-center overflow-hidden rounded-md border border-surface-border select-none {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
          style="width: {PICK_SIZE}px; height: {PICK_SIZE}px; touch-action: none;
                 {bgDraft
                   ? `background-color: ${bgDraft};`
                   : `background-color: #f8fafc;
                 background-image:
                   linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
                   linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
                   linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
                   linear-gradient(-45deg, transparent 75%, #e2e8f0 75%);
                 background-size: 16px 16px;
                 background-position: 0 0, 0 8px, 8px -8px, -8px 0px;`}"
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
          onclick={onPickerClick}
          onwheel={onWheel}
          role="application"
          aria-label="Reposition image"
        >
          <img
            bind:this={imgEl}
            src={rawSrc || src}
            alt=""
            class="pointer-events-none h-full w-full object-contain"
            draggable="false"
            onload={onImgLoad}
            style={`max-width:${inscribe * 100}%; max-height:${inscribe * 100}%; margin:auto;
                    transform: translate(${panX * PICK_SIZE}px, ${panY * PICK_SIZE}px) scale(${zoom});`}
          />
          {#if imgNW > 0}
            {#if false}
              <!-- Cover mode: dark overlay shows what gets cropped out. -->
              <div
                class="pointer-events-none absolute rounded-full border-2 border-white"
                style="left: {viewport.x}px; top: {viewport.y}px;
                       width: {viewport.w}px; height: {viewport.h}px;
                       box-shadow: 0 0 0 9999px rgba(0,0,0,0.55);"
              ></div>
            {:else}
              <!-- Contain mode: nothing is cropped — show a circular guide
                   indicating the avatar shape. The page background fills
                   the corners around a transparent logo. -->
              <div
                class="pointer-events-none absolute rounded-full border-2 border-white/80"
                style="left: 0; top: 0; width: {PICK_SIZE}px; height: {PICK_SIZE}px;"
              ></div>
            {/if}
          {/if}
        </div>
        <div class="flex flex-col items-center gap-2 text-xs text-ink-500">
          <div>Preview</div>
          <Avatar {name} src={rawSrc || src} size={72} position={focalDraft} />
          <div class="text-[11px] text-ink-400">
            {(imgFx * 100).toFixed(0)}% {(imgFy * 100).toFixed(0)}% · {zoom.toFixed(2)}×
          </div>
          <button
            type="button"
            class="text-[11px] text-brand hover:underline"
            onclick={() => { imgFx = 0.5; imgFy = 0.5; zoom = 1; }}
          >Reset</button>
        </div>
      </div>

      {#if fit === 'cover'}
        <label class="mt-3 block text-xs text-ink-500">
          <span class="mb-1 flex items-center justify-between">
            <span>Zoom</span>
            <span class="text-ink-400">{zoom.toFixed(2)}×</span>
          </span>
          <input
            type="range"
            min="1" max="4" step="0.05"
            bind:value={zoom}
            class="w-full"
          />
        </label>
      {/if}

      <div class="mt-3 flex justify-end gap-2">
        <button class="btn-ghost" onclick={() => (reposOpen = false)} disabled={saving}>Cancel</button>
        <button class="btn-primary" onclick={saveReposition} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  {/if}

  {#if urlOpen && !uploading}
    <div class="absolute left-0 top-full z-30 mt-2 w-72 rounded-[10px] border border-surface-border bg-surface-card p-3 shadow-card">
      <label class="block text-xs text-ink-400 mb-1" for="avatar-url">Image URL</label>
      <input
        bind:this={urlInputEl}
        id="avatar-url"
        type="url"
        class="input w-full"
        placeholder="https://example.com/photo.jpg"
        bind:value={urlValue}
      />
      <div class="mt-1 text-[11px] text-ink-400">
        Resized to {maxEdge}px max edge. If the source blocks CORS, we'll import it server-side instead.
      </div>
      <div class="mt-2 flex justify-end gap-2">
        <button class="btn-ghost" onclick={() => (urlOpen = false)}>Cancel</button>
        <button class="btn-primary" onclick={submitUrl} disabled={!urlValue.trim()}>Fetch</button>
      </div>
    </div>
  {/if}
</div>

<input bind:this={input} type="file" accept="image/*" class="hidden" onchange={onFile} />

{#if status && !uploading}
  <div class="mt-1 text-[11px] text-ink-400">{status}</div>
{/if}

{#if error}
  <div class="mt-1 text-xs text-tag-salesText">{error}</div>
{/if}

{#if owner}
  <PhotoPickerSheet
    open={pickerOpen}
    owner={owner}
    ownerName={name}
    onPick={onPickPhoto}
    onClose={() => (pickerOpen = false)}
  />
{/if}
