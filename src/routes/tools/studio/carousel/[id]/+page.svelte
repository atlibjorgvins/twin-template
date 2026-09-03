<script lang="ts">
  // Summary post (carousel) editor. Build collage slides, pull an
  // event's photos into a pool, drag them into placements, and add
  // per-slide overlay elements (logo/image, text, partner-logo strip,
  // box, scrim). Each slide renders to one PNG via the shared renderer.
  import Icon from '$lib/Icon.svelte';
  import { assetUrl, uploadFile, formatError, type ProjectRole } from '$lib/directus';
  import {
    updateImageTemplate,
    createGeneratedImage,
    studioFolderId,
    getProjectContext,
    newLayer,
    projectColorSlot,
    getFileFocal,
    setFileFocal,
    type GeneratedImage,
    type CarouselSlide,
    type StudioLayer,
    type ProjectContext,
    type BrandedProject
  } from '$lib/studio/data';
  import { renderToBlob } from '$lib/studio/render';
  import { faceFocal } from '$lib/studio/faceCrop';
  import { warmPoolMeta, peekMeta } from '$lib/studio/poolMeta';
  import CarouselPickerSheet from '$lib/studio/CarouselPickerSheet.svelte';
  import {
    COLLAGE_LAYOUTS,
    layoutCells,
    layoutLabel,
    placementCount,
    slideOffset,
    takenCount,
    buildSlideLayers,
    loadEventPool,
    newSlide,
    type PoolPhoto
  } from '$lib/studio/carousel';
  import type { EventRecord } from '$lib/events/data';
  import PhotoSearchDialog from '$lib/photos/PhotoSearchDialog.svelte';

  let { data }: {
    data: {
      template: any;
      events: EventRecord[];
      generated: GeneratedImage[];
      pool: PoolPhoto[];
      brandedProjects: BrandedProject[];
      projectRoles: ProjectRole[];
      projectContext: ProjectContext | null;
    };
  } = $props();

  let name = $state<string>(data.template.name ?? 'Summary post');
  let slides = $state<CarouselSlide[]>(
    Array.isArray(data.template.slides) && data.template.slides.length
      ? data.template.slides
      : [newSlide('hero-2'), newSlide('mosaic-4')]
  );
  let assignments = $state<(string | null)[]>([...(data.template.assignments ?? [])]);
  let eventId = $state<number | null>(data.template.event_id ?? null);
  let projectId = $state<number | null>(data.template.project_id ?? null);
  let projCtx = $state<ProjectContext | null>(data.projectContext);
  let width = $state<number>(data.template.width ?? 1080);
  let height = $state<number>(data.template.height ?? 1080);
  let background = $state<string>(data.template.background ?? '#111114');
  let pool = $state<PoolPhoto[]>([...data.pool]);
  let generated = $state<GeneratedImage[]>([...data.generated]);

  let error = $state('');
  let savedFlash = $state(false);
  let rendering = $state<string | null>(null);
  let downloading = $state<string | null>(null);
  let copiedLinks = $state(false);
  let addingSlide = $state(false);
  let addingEl = $state<number | null>(null); // slide index whose add-element menu is open
  let selected = $state<{ si: number; id: string } | null>(null);

  // Face-aware cropping + per-photo metadata (faces, aspect, rating).
  // See faceCrop.ts for why the boxes transfer and poolMeta.ts for the cache.

  // Gallery zoom (pool thumbnail size, px) + reposition state.
  let poolThumb = $state(72);
  // Per-file focal point (fractions) for live crop preview; mirrors what
  // the renderer reads from the Directus file. Absent = centre.
  let focals = $state<Record<string, { fx: number; fy: number }>>({});
  const focalOf = (fileId: string) => focals[fileId] ?? { fx: 0.5, fy: 0.5 };

  // ── Photo metadata (faces + rating) ─────────────────────────────────
  // Warmed once per pool. 382 of 382 gallery photos carry an Immich asset id,
  // 72% of assets have face boxes and 62% a rating — so both features degrade
  // rather than depend on the data being there.
  let metaReady = $state(0);        // bumps when a warm pass completes
  let metaLoading = $state(false);
  const assetOf = (fileId: string) => pool.find((p) => p.fileId === fileId)?.assetId ?? null;

  $effect(() => {
    const ids = pool.map((p) => p.assetId).filter(Boolean) as string[];
    if (ids.length === 0) return;
    metaLoading = true;
    void warmPoolMeta(ids)
      .then(() => (metaReady += 1))
      .finally(() => (metaLoading = false));
  });

  /** Aspect ratio of one placement's cell, in canvas terms. */
  function cellAspectAt(gi: number): number {
    let n = 0;
    for (const sl of slides) {
      const cells = layoutCells(sl.layout);
      if (gi < n + cells.length) {
        const c = cells[gi - n];
        const w = width * c.w;
        const h = height * c.h;
        return h > 0 ? w / h : 1;
      }
      n += cells.length;
    }
    return width / height;
  }

  /** Focal point that keeps this photo's faces inside this cell. */
  function faceFocalFor(
    fileId: string,
    gi: number
  ): { fx: number; fy: number; clipped: boolean } | null {
    const assetId = assetOf(fileId);
    if (!assetId) return null;
    const meta = peekMeta(assetId);
    if (!meta || meta.boxes.length === 0 || !meta.aspect) return null;
    const f = faceFocal(meta.boxes, meta.aspect, cellAspectAt(gi));
    return f.fromFaces ? { fx: f.fx, fy: f.fy, clipped: f.clipped } : null;
  }

  /** Apply face-aware focals to every placed photo that has faces. Returns
   *  how many it moved, so the UI can say something true. */
  async function applyFaceFocals(): Promise<{ moved: number; noFaces: number; clipped: number }> {
    let moved = 0;
    let noFaces = 0;
    let clipped = 0;
    const next = { ...focals };
    for (let gi = 0; gi < assignments.length; gi++) {
      const fileId = assignments[gi];
      if (!fileId) continue;
      const f = faceFocalFor(fileId, gi);
      if (!f) { noFaces += 1; continue; }
      // Measured on a 112-photo pool: a wide cell fits the faces almost
      // always (37 of 40 at 16:9), a narrow one often cannot — 43 of 54 stay
      // clipped in a half-width square cell, because five people side by side
      // do not fit a vertical slice at any focal point. Saying so beats
      // silently producing a crop through somebody's ear.
      if (f.clipped) clipped += 1;
      const cur = next[fileId];
      // Only write when it actually differs — a no-op PATCH per photo on a
      // 20-slot carousel is 20 needless writes.
      if (cur && Math.abs(cur.fx - f.fx) < 0.005 && Math.abs(cur.fy - f.fy) < 0.005) continue;
      next[fileId] = f;
      moved += 1;
      await setFileFocal(fileId, f.fx, f.fy).catch(() => {});
    }
    focals = next;
    return { moved, noFaces, clipped };
  }

  const total = $derived(placementCount(slides));
  const taken = $derived(takenCount(assignments));
  const assignedSet = $derived(new Set(assignments.filter(Boolean) as string[]));
  // ── Star filter ─────────────────────────────────────────────────────
  // 62% of the library is rated (3★ 5, 4★ 8, 5★ 5 in a 29-photo sample) and
  // 38% is unrated. `includeUnrated` is not a nicety: a plain "4★ and up"
  // would silently hide a third of the pool and read as photos going missing.
  let minStars = $state(0);            // 0 = no minimum
  let includeUnrated = $state(true);
  const ratingOf = (fileId: string): number | null => {
    const a = assetOf(fileId);
    if (!a) return null;
    return peekMeta(a)?.rating ?? null;
  };
  function passesFilter(fileId: string): boolean {
    if (minStars <= 0) return true;
    const r = ratingOf(fileId);
    if (r === null) return includeUnrated;
    return r >= minStars;
  }

  const unplacedAll = $derived(pool.filter((p) => !assignedSet.has(p.fileId)));
  const unplaced = $derived.by(() => {
    // Read metaReady so the list re-derives when ratings finish loading;
    // passesFilter() reads the cache synchronously and wouldn't otherwise
    // register as a dependency.
    void metaReady;
    return unplacedAll.filter((p) => passesFilter(p.fileId));
  });
  const hiddenByFilter = $derived(unplacedAll.length - unplaced.length);

  // ── Format / aspect ratio ───────────────────────────────────────────
  // One aspect for the whole carousel (Instagram keeps every slide the
  // same shape). Drives the canvas preview, the render and the saved
  // template — width/height already flow everywhere.
  const ASPECTS = [
    { key: '1:1', label: 'Square', w: 1080, h: 1080 },
    { key: '4:5', label: 'Portrait', w: 1080, h: 1350 },
    { key: '9:16', label: 'Story', w: 1080, h: 1920 },
    { key: '16:9', label: 'Landscape', w: 1920, h: 1080 },
    { key: '1.91:1', label: 'Link', w: 1080, h: 566 }
  ];
  const activeAspect = $derived(
    ASPECTS.find((a) => a.w === width && a.h === height)?.key ?? 'custom'
  );
  function setAspect(a: (typeof ASPECTS)[number]) {
    width = a.w;
    height = a.h;
    queueSave();
  }

  // ── Multi-select pool + build slides from selection ─────────────────
  // Pick several photos on the left, then turn them into slides in one
  // go — either one photo per slide, or spread across a fixed number of
  // slides (balanced, layout chosen to fit each slide's count).
  let picked = $state<Set<string>>(new Set());
  // The sidebar pool stays — it is where drag-into-a-slot lives. The picker is
  // for the part the sidebar is bad at: choosing a dozen photos out of 120 at
  // 72px a tile.
  let pickerOpen = $state(false);
  let buildMode = $state<'one' | 'fixed'>('one');
  let fixedSlides = $state(3);
  const pickedCount = $derived(picked.size);
  // Index of the last plainly-clicked photo, the anchor for shift-range
  // selection (kept fixed across shift-clicks so the range can be
  // re-dragged, as in Finder/Explorer).
  let pickAnchor = $state<number | null>(null);
  function togglePick(fileId: string) {
    const s = new Set(picked);
    if (s.has(fileId)) s.delete(fileId);
    else s.add(fileId);
    picked = s;
  }
  /** Pool click: plain toggles one (and re-anchors); shift selects the
   *  whole range from the anchor to here. */
  function pickAt(i: number, fileId: string, e: MouseEvent) {
    if (e.shiftKey && pickAnchor !== null) {
      const [lo, hi] = pickAnchor <= i ? [pickAnchor, i] : [i, pickAnchor];
      const s = new Set(picked);
      for (let k = lo; k <= hi; k++) {
        const id = unplaced[k]?.fileId;
        if (id) s.add(id);
      }
      picked = s;
    } else {
      togglePick(fileId);
      pickAnchor = i;
    }
  }
  /** Picker clicks go through pickAt, exactly as the sidebar's do. Routing
   *  plain clicks to togglePick instead would skip the anchor pickAt sets,
   *  and a later shift-click would find none and select one photo. */
  function pickFromPicker(i: number, fileId: string, shiftKey: boolean) {
    pickAt(i, fileId, { shiftKey } as MouseEvent);
  }

  function selectAllPool() {
    picked = new Set(unplaced.map((p) => p.fileId));
  }
  function clearPick() {
    picked = new Set();
    pickAnchor = null;
  }
  // Smallest collage layout whose cell count covers `n` photos.
  const LAYOUT_CAPACITY: Array<[string, number]> = [
    ['single', 1], ['pair-h', 2], ['hero-2', 3], ['mosaic-4', 4], ['grid-6', 6]
  ];
  function layoutForCount(n: number): string {
    for (const [key, cap] of LAYOUT_CAPACITY) if (cap >= n) return key;
    return 'grid-6';
  }
  function buildFromSelection() {
    const chosen = unplaced.filter((p) => picked.has(p.fileId)).map((p) => p.fileId);
    if (!chosen.length) return;
    let groups: string[][];
    if (buildMode === 'one') {
      groups = chosen.map((id) => [id]);
    } else {
      const n = clamp(Math.round(fixedSlides), 1, chosen.length);
      const base = Math.floor(chosen.length / n);
      const extra = chosen.length % n;
      groups = [];
      let idx = 0;
      for (let s = 0; s < n; s++) {
        const size = base + (s < extra ? 1 : 0);
        groups.push(chosen.slice(idx, idx + size));
        idx += size;
      }
    }
    const newSegs = groups.map((g) => {
      const key = layoutForCount(g.length);
      const cap = layoutCells(key).length;
      const items: (string | null)[] = Array(cap).fill(null);
      g.slice(0, cap).forEach((id, i) => (items[i] = id));
      return { slide: newSlide(key), items };
    });
    // Replace the empty starter slides; otherwise append to what's there.
    applySegments(taken === 0 ? newSegs : [...segments(), ...newSegs]);
    picked = new Set();
  }
  const roleOptions = $derived(
    data.projectRoles.filter((r) => r.applies_to === 'org' || r.applies_to === 'both' || !r.applies_to)
  );

  function normalize(a: (string | null)[]): (string | null)[] {
    const out = a.slice(0, total);
    while (out.length < total) out.push(null);
    return out;
  }
  $effect(() => {
    if (assignments.length !== total) assignments = normalize(assignments);
  });

  function thumb(fileId: string): string {
    return assetUrl(fileId, { width: 400, height: 400, fit: 'cover' });
  }
  function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
  function slug(s: string): string {
    return (s || 'summary').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  }
  /** Preview color for a layer slot (resolves {project} brand tokens). */
  function pcolor(color: string): string {
    const slot = projectColorSlot(color);
    if (!slot) return color;
    return projCtx?.colors?.[slot] ?? '#888888';
  }
  function gradientCss(l: any): string {
    const dir = l.direction === 'up' ? 'to top' : l.direction === 'left' ? 'to left' : l.direction === 'right' ? 'to right' : 'to bottom';
    const c = pcolor(l.color);
    const a = (hex: string, alpha: number) => {
      const m = hex.match(/^#([0-9a-f]{6})$/i);
      if (!m) return hex;
      const n = parseInt(m[1], 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
    };
    return `linear-gradient(${dir}, ${a(c, l.from)}, ${a(c, l.to)})`;
  }

  // ── Save (debounced) ────────────────────────────────────────────────
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function queueSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }
  async function save() {
    error = '';
    try {
      await updateImageTemplate(data.template.id, {
        name, kind: 'carousel',
        slides: $state.snapshot(slides) as CarouselSlide[],
        assignments: $state.snapshot(assignments) as (string | null)[],
        event_id: eventId, project_id: projectId, width, height, background
      });
      savedFlash = true;
      setTimeout(() => (savedFlash = false), 1200);
    } catch (e) { error = formatError(e); }
  }

  // ── Slide structure (assignments aligned via segments) ──────────────
  type Seg = { slide: CarouselSlide; items: (string | null)[] };
  function segments(): Seg[] {
    return slides.map((s, i) => {
      const off = slideOffset(slides, i);
      const len = layoutCells(s.layout).length;
      return { slide: s, items: assignments.slice(off, off + len) };
    });
  }
  function applySegments(segs: Seg[]) {
    slides = segs.map((s) => s.slide);
    assignments = segs.flatMap((s) => s.items);
    queueSave();
  }
  function addSlide(layout: string) {
    const len = layoutCells(layout).length;
    applySegments([...segments(), { slide: newSlide(layout), items: Array(len).fill(null) }]);
    addingSlide = false;
  }
  function removeSlide(i: number) { const s = segments(); s.splice(i, 1); applySegments(s); }
  function moveSlide(i: number, dir: -1 | 1) {
    const j = i + dir; if (j < 0 || j >= slides.length) return;
    const s = segments(); [s[i], s[j]] = [s[j], s[i]]; applySegments(s);
  }
  function setTitle(i: number, title: string) {
    slides = slides.map((s, idx) => (idx === i ? { ...s, title } : s));
    queueSave();
  }

  // ── Placement assignment ────────────────────────────────────────────
  function globalIdx(si: number, ci: number): number { return slideOffset(slides, si) + ci; }
  function setAt(idx: number, fileId: string | null) {
    assignments = assignments.map((v, i) => (i === idx ? fileId : v)); queueSave();
  }
  function swap(a: number, b: number) {
    if (a === b) return; const n = assignments.slice(); [n[a], n[b]] = [n[b], n[a]]; assignments = n; queueSave();
  }
  // Auto-fill places the photos AND aims each crop at the faces in it.
  // Placement alone was the old behaviour: photos landed centre-cropped, so a
  // group standing in the upper third of a portrait lost their heads to a
  // square cell and every one had to be nudged by hand.
  let autoFillNote = $state<string | null>(null);
  let autoFilling = $state(false);
  async function autoFill() {
    if (autoFilling) return;
    autoFilling = true;
    try {
      const free = unplaced.map((p) => p.fileId); let f = 0; const n = assignments.slice();
      for (let i = 0; i < n.length && f < free.length; i++) if (!n[i]) n[i] = free[f++];
      assignments = n; queueSave();
      const { moved, noFaces, clipped } = await applyFaceFocals();
      const bits: string[] = [];
      if (moved > 0) bits.push(`Aimed ${moved} crop${moved === 1 ? '' : 's'} at faces`);
      if (noFaces > 0) bits.push(`${noFaces} centred (no faces found)`);
      if (clipped > 0)
        bits.push(
          `${clipped} can't fit every face at this shape — try a wider layout`
        );
      autoFillNote = bits.length > 0 ? bits.join(' · ') : null;
    } finally {
      autoFilling = false;
    }
  }
  $effect(() => {
    if (!autoFillNote) return;
    const t = setTimeout(() => (autoFillNote = null), 5000);
    return () => clearTimeout(t);
  });
  function clearAll() { assignments = assignments.map(() => null); queueSave(); }

  // Auto-arrange: removing a photo reflows its slide to the layout that
  // fits the photos left (4→3→2→1…), compacting the rest — so an
  // auto-generated collage stays tight after you drop one out instead of
  // leaving an empty hole.
  function slideIndexOf(gi: number): number {
    let n = 0;
    for (let i = 0; i < slides.length; i++) {
      const len = layoutCells(slides[i].layout).length;
      if (gi < n + len) return i;
      n += len;
    }
    return Math.max(0, slides.length - 1);
  }
  function removePhoto(gi: number) {
    const si = slideIndexOf(gi);
    const segs = segments();
    const local = gi - slideOffset(slides, si);
    const photos = segs[si].items.filter((v, i) => !!v && i !== local) as string[];
    const key = layoutForCount(photos.length);
    const cap = layoutCells(key).length;
    const items: (string | null)[] = Array(cap).fill(null);
    photos.slice(0, cap).forEach((id, i) => (items[i] = id));
    segs[si] = { slide: { ...segs[si].slide, layout: key }, items };
    applySegments(segs);
  }

  // ── Per-slide overlay layers ────────────────────────────────────────
  const DEFAULT_POS: Record<string, Partial<StudioLayer>> = {
    image: { x: 0.72, y: 0.04, w: 0.24, h: 0.12 },          // logo top-right
    logos: { x: 0.1, y: 0.88, w: 0.8, h: 0.08 },            // bottom strip
    text: { x: 0.08, y: 0.06, w: 0.6, h: 0.1 },
    rect: { x: 0.06, y: 0.06, w: 0.3, h: 0.1 },
    gradient: { x: 0, y: 0.6, w: 1, h: 0.4 }
  };
  function addLayer(si: number, type: StudioLayer['type']) {
    const base = newLayer(type) as StudioLayer;
    const l = { ...base, ...DEFAULT_POS[type] } as StudioLayer;
    if (l.type === 'image') l.fit = 'contain';
    slides = slides.map((s, i) => (i === si ? { ...s, layers: [...(s.layers ?? []), l] } : s));
    selected = { si, id: l.id };
    addingEl = null;
    queueSave();
  }
  function updateLayer(si: number, id: string, patch: Partial<StudioLayer>) {
    slides = slides.map((s, i) =>
      i === si ? { ...s, layers: (s.layers ?? []).map((l) => (l.id === id ? ({ ...l, ...patch } as StudioLayer) : l)) } : s
    );
  }
  function removeLayer(si: number, id: string) {
    slides = slides.map((s, i) => (i === si ? { ...s, layers: (s.layers ?? []).filter((l) => l.id !== id) } : s));
    if (selected?.id === id) selected = null;
    queueSave();
  }
  function layerOf(si: number, id: string): StudioLayer | undefined {
    return (slides[si].layers ?? []).find((l) => l.id === id);
  }
  async function uploadLogo(si: number, id: string, file: File) {
    try {
      const folder = await studioFolderId();
      const fileId = await uploadFile(file, { title: `${name} — element`, folder: folder ?? undefined });
      updateLayer(si, id, { file: fileId } as Partial<StudioLayer>);
      queueSave();
    } catch (e) { error = formatError(e); }
  }

  // overlay drag (move / resize) via pointer events
  let dragL: { si: number; id: string; mode: 'move' | 'resize'; rect: DOMRect; sx: number; sy: number; o: { x: number; y: number; w: number; h: number } } | null = null;
  function startDrag(e: PointerEvent, si: number, id: string, mode: 'move' | 'resize') {
    e.preventDefault(); e.stopPropagation();
    const canvas = (e.currentTarget as HTMLElement).closest('[data-canvas]') as HTMLElement;
    const l = layerOf(si, id); if (!canvas || !l) return;
    dragL = { si, id, mode, rect: canvas.getBoundingClientRect(), sx: e.clientX, sy: e.clientY, o: { x: l.x, y: l.y, w: l.w, h: l.h } };
    selected = { si, id };
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
  }
  function onDrag(e: PointerEvent) {
    if (!dragL) return;
    const dx = (e.clientX - dragL.sx) / dragL.rect.width;
    const dy = (e.clientY - dragL.sy) / dragL.rect.height;
    if (dragL.mode === 'move') {
      updateLayer(dragL.si, dragL.id, { x: clamp(dragL.o.x + dx, 0, 1 - dragL.o.w), y: clamp(dragL.o.y + dy, 0, 1 - dragL.o.h) });
    } else {
      updateLayer(dragL.si, dragL.id, { w: clamp(dragL.o.w + dx, 0.04, 1 - dragL.o.x), h: clamp(dragL.o.h + dy, 0.03, 1 - dragL.o.y) });
    }
  }
  function endDrag() {
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', endDrag);
    if (dragL) queueSave();
    dragL = null;
  }

  // ── Reposition photo within its frame (per-file focal point) ─────────
  // Load each placed file's focal once (guarded so the effect doesn't loop).
  const focalReq = new Set<string>();
  $effect(() => {
    for (const fileId of assignments) {
      if (fileId && !focalReq.has(fileId)) {
        focalReq.add(fileId);
        void getFileFocal(fileId)
          .then((f) => (focals = { ...focals, [fileId]: f ?? { fx: 0.5, fy: 0.5 } }))
          .catch(() => (focals = { ...focals, [fileId]: { fx: 0.5, fy: 0.5 } }));
      }
    }
  });

  /** Put a cell's crop back to what auto-fill would choose: aimed at the
   *  faces when Immich knows them, centred when it doesn't. A hand-nudge
   *  should be undoable without hunting for the original numbers. */
  async function resetFocal(gi: number, fileId: string) {
    const f = faceFocalFor(fileId, gi) ?? { fx: 0.5, fy: 0.5 };
    focals = { ...focals, [fileId]: { fx: f.fx, fy: f.fy } };
    await setFileFocal(fileId, f.fx, f.fy).catch(() => {});
  }

  // ── Tap to move ─────────────────────────────────────────────────────
  // Relocating a photo needed the 11px grip, which only appears on hover.
  // Panning got the whole cell; moving kept the pinhole. A click now picks a
  // photo up and a click on another cell drops it — the same target size at
  // both ends, and identical on touch, where hovering to reveal a grip is not
  // a gesture that exists.
  //
  // No hold timer: a click and a pan are told apart by whether the pointer
  // moved, which needs no threshold anyone has to learn and cannot misfire
  // when you pause mid-drag.
  let heldIdx = $state<number | null>(null);
  const MOVE_SLOP = 5; // px of travel that still counts as a click

  $effect(() => {
    if (heldIdx === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') heldIdx = null; };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function tapCell(gi: number) {
    if (heldIdx === null) { heldIdx = gi; return; }
    if (heldIdx === gi) { heldIdx = null; return; }   // tap it again to cancel
    swap(heldIdx, gi);
    heldIdx = null;
  }

  let panning: { fileId: string; rect: DOMRect; sx: number; sy: number; o: { fx: number; fy: number }; gi: number; moved: boolean } | null = null;
  function startPan(e: PointerEvent, fileId: string, gi: number) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    panning = {
      fileId,
      rect: el.getBoundingClientRect(),
      sx: e.clientX,
      sy: e.clientY,
      o: { ...focalOf(fileId) },
      gi,
      moved: false
    };
    el.setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', onPan);
    window.addEventListener('pointerup', endPan);
  }
  function onPan(e: PointerEvent) {
    if (!panning) return;
    if (Math.abs(e.clientX - panning.sx) > MOVE_SLOP || Math.abs(e.clientY - panning.sy) > MOVE_SLOP) {
      panning.moved = true;
    }
    // Below the slop this is a click in progress, not a pan — don't nudge the
    // crop by a pixel on the way to picking the photo up.
    if (!panning.moved) return;
    const dx = (e.clientX - panning.sx) / panning.rect.width;
    const dy = (e.clientY - panning.sy) / panning.rect.height;
    // Drag the photo: moving right reveals more of its left → focal x drops.
    focals = {
      ...focals,
      [panning.fileId]: { fx: clamp(panning.o.fx - dx, 0, 1), fy: clamp(panning.o.fy - dy, 0, 1) }
    };
  }
  function endPan() {
    window.removeEventListener('pointermove', onPan);
    window.removeEventListener('pointerup', endPan);
    if (panning) {
      if (panning.moved) {
        const f = focalOf(panning.fileId);
        void setFileFocal(panning.fileId, f.fx, f.fy).catch((e) => (error = formatError(e)));
      } else {
        // Never travelled: this was a tap.
        tapCell(panning.gi);
      }
    }
    panning = null;
  }

  // ── Event + project source ──────────────────────────────────────────
  let loadingPool = $state(false);
  async function pickEvent(id: number | null) {
    eventId = id; queueSave(); pool = []; if (id == null) return;
    loadingPool = true;
    try { pool = await loadEventPool(id); } catch (e) { error = formatError(e); } finally { loadingPool = false; }
  }
  async function pickProject(id: number | null) {
    projectId = id; queueSave();
    projCtx = id == null ? null : await getProjectContext(id).catch(() => null);
  }

  // ── Photo drag/drop ─────────────────────────────────────────────────
  type Drag = { kind: 'pool'; fileId: string } | { kind: 'cell'; idx: number } | null;
  let drag: Drag = null;
  function dropOnCell(idx: number) {
    if (!drag) return;
    if (drag.kind === 'pool') setAt(idx, drag.fileId); else swap(drag.idx, idx);
    drag = null;
  }
  function dropOnPool() { if (drag?.kind === 'cell') removePhoto(drag.idx); drag = null; }

  // ── Add image by search (Immich → imported to Directus) ─────────────
  let searchOpen = $state(false);
  let searchTarget = $state<number | null>(null);
  function openSearch(gi: number) { searchTarget = gi; searchOpen = true; }
  function onSearchPick(fileId: string) {
    if (searchTarget != null) {
      setAt(searchTarget, fileId);
      if (!pool.some((p) => p.fileId === fileId)) pool = [...pool, { fileId }];
    }
    searchOpen = false;
    searchTarget = null;
  }

  // ── Render ──────────────────────────────────────────────────────────
  async function render() {
    if (eventId == null) { error = 'Pick an event first.'; return; }
    error = '';
    const folder = await studioFolderId();
    const evName = data.events.find((e) => e.id === eventId)?.name ?? 'Event';
    const snapSlides = $state.snapshot(slides) as CarouselSlide[];
    const snapAssign = $state.snapshot(assignments) as (string | null)[];
    const ctx = projCtx ? ($state.snapshot(projCtx) as ProjectContext) : null;
    const failures: string[] = [];
    for (let i = 0; i < snapSlides.length; i++) {
      rendering = `${i + 1}/${snapSlides.length}`;
      try {
        const off = slideOffset(snapSlides, i);
        const cells = layoutCells(snapSlides[i].layout);
        const files = cells.map((_, c) => snapAssign[off + c] ?? null);
        const blob = await renderToBlob({
          width, height, background: background || null,
          layers: buildSlideLayers(snapSlides[i], files),
          rc: {
            candidate: null,
            projectName: ctx?.name ?? null,
            projectColors: ctx?.colors ?? null,
            roleLogos: (ctx?.roleLogos as Record<string, string[]>) ?? null
          }
        });
        const file = new File([blob], `${slug(name)}-slide-${i + 1}.png`, { type: 'image/png' });
        const fileId = await uploadFile(file, { title: `${name} — Slide ${i + 1}`, folder: folder ?? undefined });
        const row = await createGeneratedImage({
          template_id: data.template.id, item_collection: 'event', item_id: String(eventId),
          item_label: evName, file_id: fileId, variant: `Slide ${i + 1}`
        });
        generated = [row, ...generated];
      } catch (e) { failures.push(`Slide ${i + 1}: ${formatError(e)}`); }
    }
    rendering = null;
    if (failures.length) error = `Some slides failed — ${failures.join(' · ')}`;
  }

  // Export to device — render each slide to a PNG and download it (no
  // server round-trip; the browser saves the files).
  async function downloadSlides() {
    if (taken === 0) { error = 'Place some photos first.'; return; }
    error = '';
    const snapSlides = $state.snapshot(slides) as CarouselSlide[];
    const snapAssign = $state.snapshot(assignments) as (string | null)[];
    const ctx = projCtx ? ($state.snapshot(projCtx) as ProjectContext) : null;
    try {
      for (let i = 0; i < snapSlides.length; i++) {
        downloading = `${i + 1}/${snapSlides.length}`;
        const off = slideOffset(snapSlides, i);
        const cells = layoutCells(snapSlides[i].layout);
        const files = cells.map((_, c) => snapAssign[off + c] ?? null);
        const blob = await renderToBlob({
          width, height, background: background || null,
          layers: buildSlideLayers(snapSlides[i], files),
          rc: {
            candidate: null,
            projectName: ctx?.name ?? null,
            projectColors: ctx?.colors ?? null,
            roleLogos: (ctx?.roleLogos as Record<string, string[]>) ?? null
          }
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slug(name)}-slide-${i + 1}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } catch (e) {
      error = formatError(e);
    } finally {
      downloading = null;
    }
  }

  // Copy the rendered slides' public URLs (Funnel-served) — paste straight
  // into Buffer / a post / Claude to publish the carousel.
  async function copyLinks() {
    const urls = generated.filter((g) => g.file_id).map((g) => assetUrl(g.file_id as string, {})).join('\n');
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(urls);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = urls;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      ta.remove();
    }
    copiedLinks = true;
    setTimeout(() => (copiedLinks = false), 1800);
  }

  const EL_TYPES: Array<{ type: StudioLayer['type']; label: string; icon: any }> = [
    { type: 'image', label: 'Logo / image', icon: 'image' },
    { type: 'text', label: 'Text', icon: 'pencil' },
    { type: 'logos', label: 'Partner logos', icon: 'users' },
    { type: 'rect', label: 'Box', icon: 'bookmark' },
    { type: 'gradient', label: 'Scrim', icon: 'layers' }
  ];
</script>

<svelte:head><title>{name} · Summary post · Studio</title></svelte:head>

<section class="mx-auto max-w-6xl space-y-5">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div class="min-w-0">
      <a href="/tools/studio" class="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700">
        <Icon name="chevron-left" size={12} /> Image studio
      </a>
      <div class="mt-1 flex items-center gap-2">
        <input class="input font-display text-xl font-bold" style="letter-spacing:-0.02em;" bind:value={name} oninput={queueSave} />
        <span class="rounded-full bg-tag-eventText/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tag-eventText">Summary post</span>
      </div>
    </div>
    <div class="flex items-center gap-3 text-xs text-ink-400">
      {#if savedFlash}<span class="text-tag-eventText">Saved ✓</span>{/if}
      <span class="tabular-nums"><strong class="text-ink-900">{taken}</strong>/{total} placed · {slides.length} slides</span>
    </div>
  </header>

  {#if error}<div class="rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">{error}</div>{/if}

  <!-- Source + brand -->
  <div class="grid gap-3 sm:grid-cols-2">
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-2">
      <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">Event source</div>
      <select class="input text-sm w-full" value={eventId ?? ''} onchange={(e) => pickEvent((e.currentTarget as HTMLSelectElement).value ? Number((e.currentTarget as HTMLSelectElement).value) : null)}>
        <option value="">Select an event…</option>
        {#each data.events as ev (ev.id)}<option value={ev.id}>{ev.name}</option>{/each}
      </select>
      <span class="block text-xs text-ink-500">
        {#if loadingPool}Loading…{:else if pool.length}{pool.length} photos · {unplaced.length} unplaced{:else}No photos in this event's gallery{/if}
      </span>
    </div>
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-2">
      <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">Brand (for logos + colors)</div>
      <select class="input text-sm w-full" value={projectId ?? ''} onchange={(e) => pickProject((e.currentTarget as HTMLSelectElement).value ? Number((e.currentTarget as HTMLSelectElement).value) : null)}>
        <option value="">No project</option>
        {#each data.brandedProjects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
      <span class="block text-xs text-ink-500">Feeds partner-logo strips, the {'{project}'} token and brand colors.</span>
    </div>
  </div>

  <!-- Format / aspect ratio -->
  <div class="flex flex-wrap items-center gap-3 rounded-[14px] border border-surface-border bg-surface-card p-3">
    <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Format</span>
    <div class="flex flex-wrap gap-1.5">
      {#each ASPECTS as a (a.key)}
        <button
          class="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition {activeAspect === a.key ? 'border-[var(--accent-electric)] text-ink-900' : 'border-surface-border text-ink-500 hover:bg-surface-hover'}"
          onclick={() => setAspect(a)}
          title={`${a.label} — ${a.w}×${a.h}`}
        >
          <span class="inline-block rounded-[2px] border border-current" style="width:{Math.round((a.w / Math.max(a.w, a.h)) * 14)}px; height:{Math.round((a.h / Math.max(a.w, a.h)) * 14)}px;"></span>
          {a.key}
        </button>
      {/each}
    </div>
    <span class="text-xs text-ink-500">{ASPECTS.find((a) => a.key === activeAspect)?.label ?? 'Custom'} · {width}×{height}px · applies to every slide.</span>
  </div>

  <!-- Background / gap color -->
  <div class="flex flex-wrap items-center gap-3 rounded-[14px] border border-surface-border bg-surface-card p-3">
    <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Background</span>
    <input
      type="color"
      class="h-7 w-10 cursor-pointer rounded border border-surface-border bg-transparent disabled:opacity-40"
      value={background || '#111114'}
      disabled={!background}
      oninput={(e) => { background = (e.currentTarget as HTMLInputElement).value; queueSave(); }}
      aria-label="Background color"
    />
    <span class="text-xs text-ink-500">The color of the gaps between photos (and any empty space).</span>
    <label class="ml-auto flex items-center gap-1.5 text-xs text-ink-600">
      <input type="checkbox" checked={!background} onchange={(e) => { background = (e.currentTarget as HTMLInputElement).checked ? '' : '#111114'; queueSave(); }} />
      Transparent (PNG)
    </label>
  </div>

  <!-- Split view: photo gallery (left) · slide previews (right) -->
  <div class="lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-5 lg:items-start">
  <!-- LEFT: gallery — scrolls independently of the slides column -->
  <div class="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:pr-1">
  <!-- An empty pool used to hide this whole block, so a new summary post
       showed no photo area at all — and therefore no star filter and no
       Browse — with nothing to say that picking an event source is the next
       step. Absence should state itself rather than look like a missing
       feature. -->
  {#if !pool.length && !loadingPool}
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card p-4 text-center">
      <p class="text-sm text-ink-600">
        {eventId == null
          ? 'Pick an event source above to load its photos.'
          : 'That event has no photos in its gallery yet.'}
      </p>
      <p class="mt-1 text-[11px] text-ink-400">
        {eventId == null
          ? 'The photo pool, star filter and auto-fill appear once there are photos.'
          : 'Tag photos to the event in the photo navigator, or add them on the event page.'}
      </p>
    </div>
  {/if}
  {#if pool.length}
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card p-3" role="list" ondragover={(e) => e.preventDefault()} ondrop={dropOnPool}>
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Photos — drag into a slot</span>
        <span class="flex items-center gap-2">
          <span class="flex items-center gap-0.5" title="Zoom thumbnails">
            <button class="rounded border border-surface-border px-1.5 text-sm leading-none text-ink-500 hover:bg-surface-hover disabled:opacity-40" onclick={() => (poolThumb = clamp(poolThumb - 24, 48, 168))} disabled={poolThumb <= 48} aria-label="Smaller">−</button>
            <button class="rounded border border-surface-border px-1.5 text-sm leading-none text-ink-500 hover:bg-surface-hover disabled:opacity-40" onclick={() => (poolThumb = clamp(poolThumb + 24, 48, 168))} disabled={poolThumb >= 168} aria-label="Larger">+</button>
          </span>
          <button class="btn-ghost text-xs" onclick={autoFill} disabled={!unplaced.length || taken >= total || autoFilling}>
            {autoFilling ? 'Filling…' : 'Auto-fill'}
          </button>
          <button class="btn-ghost text-xs" onclick={clearAll} disabled={!taken}>Clear</button>
        </span>
      </div>

      <!-- Build slides from a multi-selection -->
      <div class="mb-2 rounded-md border border-surface-border bg-surface-hover/30 p-2 text-xs">
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium text-ink-600">
            {#if pickedCount}{pickedCount} selected{:else}Select photos to build slides{/if}
          </span>
          <span class="flex items-center gap-2">
            <button class="text-ink-500 hover:text-ink-900" onclick={selectAllPool} disabled={!unplaced.length}>Select all</button>
            <button class="text-ink-500 hover:text-ink-900" onclick={() => (pickerOpen = true)} title="Pick photos on a full screen">
              Browse…
            </button>
            {#if pickedCount}<button class="text-ink-400 hover:text-ink-700" onclick={clearPick}>Clear</button>{/if}
          </span>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label class="flex items-center gap-1"><input type="radio" value="one" checked={buildMode === 'one'} onchange={() => (buildMode = 'one')} /> One per slide</label>
          <label class="flex items-center gap-1">
            <input type="radio" value="fixed" checked={buildMode === 'fixed'} onchange={() => (buildMode = 'fixed')} /> Fixed
            <input type="number" min="1" max="20" class="input !w-14 !py-0.5 text-xs" value={fixedSlides} oninput={(e) => (fixedSlides = clamp(Number((e.currentTarget as HTMLInputElement).value) || 1, 1, 20))} onfocus={() => (buildMode = 'fixed')} /> slides
          </label>
          <button class="btn-primary ml-auto !py-1 text-xs" onclick={buildFromSelection} disabled={!pickedCount}>
            {buildMode === 'one'
              ? `Make ${pickedCount || ''} slide${pickedCount === 1 ? '' : 's'}`
              : `Build ${clamp(Math.round(fixedSlides), 1, Math.max(1, pickedCount))} slide${clamp(Math.round(fixedSlides), 1, Math.max(1, pickedCount)) === 1 ? '' : 's'}`}
          </button>
        </div>
        {#if taken === 0}<p class="mt-1 text-[10px] text-ink-400">Replaces the empty starter slides.</p>{/if}
      </div>

      <!-- Star filter. Rated photos are the ones you already triaged, so
           narrowing to them is usually the fastest route to a good carousel —
           but 38% of the library is unrated, hence an explicit toggle rather
           than a silent exclusion. -->
      <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Stars</span>
        <span class="flex items-center gap-0.5">
          {#each [0, 3, 4, 5] as n (n)}
            <button
              type="button"
              class="chip-radio {minStars === n ? 'is-selected' : ''}"
              aria-pressed={minStars === n}
              onclick={() => (minStars = n)}
            >{n === 0 ? 'Any' : `${n}★+`}</button>
          {/each}
        </span>
        {#if minStars > 0}
          <label class="flex items-center gap-1 text-ink-500">
            <input type="checkbox" bind:checked={includeUnrated} /> include unrated
          </label>
          {#if hiddenByFilter > 0}
            <span class="text-ink-400">{hiddenByFilter} hidden</span>
          {/if}
        {/if}
        {#if metaLoading}<span class="text-ink-300">loading ratings…</span>{/if}
      </div>

      {#if autoFillNote}
        <p class="mb-2 text-[11px] text-tag-eventText">{autoFillNote}</p>
      {/if}

      <div class="flex flex-wrap gap-2">
        {#each unplaced as p, i (p.fileId)}
          {@const sel = picked.has(p.fileId)}
          <div class="relative cursor-pointer select-none overflow-hidden rounded-md border bg-cover bg-center active:cursor-grabbing {sel ? 'border-[var(--accent-electric)] ring-2 ring-[var(--accent-electric)]' : 'border-surface-border'}"
            style="width:{poolThumb}px; height:{poolThumb}px; background-image:url({thumb(p.fileId)})" draggable="true" role="listitem"
            ondragstart={() => (drag = { kind: 'pool', fileId: p.fileId })} onclick={(e) => pickAt(i, p.fileId, e)} title={p.caption ?? 'Click to select · Shift-click for a range · drag into a slot'}>
            <span class="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full border {sel ? 'border-[var(--accent-electric)] bg-[var(--accent-electric)] text-white' : 'border-white/70 bg-ink-900/30'}">
              {#if sel}<Icon name="check" size={10} />{/if}
            </span>
          </div>
        {/each}
        {#if !unplaced.length}<span class="text-xs text-ink-400">All photos placed — drop one here to pull it back.</span>{/if}
      </div>
    </div>
  {:else}
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card p-4 text-xs text-ink-400">
      Pick an event above to load its photos here, then drag them into the slides.
    </div>
  {/if}
  </div><!-- /LEFT -->

  <!-- RIGHT: slide previews — scrolls independently of the gallery -->
  <div class="space-y-4 min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:pr-1">
    {#each slides as s, si (si)}
      {@const cells = layoutCells(s.layout)}
      <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <span class="font-display text-sm font-semibold">Slide {si + 1}</span>
          <span class="text-xs text-ink-400">{layoutLabel(s.layout)} · {cells.length} photos</span>
          <input class="input ml-2 !py-1 text-xs" placeholder="Slide title (optional)" value={s.title ?? ''} oninput={(e) => setTitle(si, (e.currentTarget as HTMLInputElement).value)} />
          <div class="ml-auto flex items-center gap-1">
            <button class="text-ink-300 hover:text-ink-700 disabled:opacity-30" disabled={si === 0} onclick={() => moveSlide(si, -1)} aria-label="Move up"><Icon name="chevron-left" size={14} class="rotate-90" /></button>
            <button class="text-ink-300 hover:text-ink-700 disabled:opacity-30" disabled={si === slides.length - 1} onclick={() => moveSlide(si, 1)} aria-label="Move down"><Icon name="chevron-right" size={14} class="rotate-90" /></button>
            <button class="text-ink-300 hover:text-tag-salesText" onclick={() => removeSlide(si)} aria-label="Remove slide"><Icon name="x" size={14} /></button>
          </div>
        </div>

        <!-- Slide canvas: photo cells (drop targets) + overlay layers -->
        <div data-canvas class="relative mx-auto w-full max-w-sm overflow-hidden rounded-md" style="aspect-ratio:{width}/{height}; background:{background}; container-type:inline-size;">
          {#each cells as c, ci (ci)}
            {@const gi = globalIdx(si, ci)}
            {@const fileId = assignments[gi]}
            <div class="absolute" style="left:{c.x * 100}%; top:{c.y * 100}%; width:{c.w * 100}%; height:{c.h * 100}%; padding:2px;"
              role="button" tabindex="0" ondragover={(e) => e.preventDefault()} ondrop={() => dropOnCell(gi)}>
              {#if fileId}
                {@const f = focalOf(fileId)}
                <!-- Dragging the photo pans it. It used to relocate it to
                     another slot, with panning hidden behind an 11px mode
                     toggle in the corner — so the common act (nudge the crop)
                     needed a mode and the rare one (move between slots) got
                     the whole surface. Relocating now lives on the grip
                     below, which is the only thing that stays draggable. -->
                {@const held = heldIdx === gi}
                {@const target = heldIdx !== null && !held}
                <div
                  class="group relative h-full w-full cursor-move overflow-hidden rounded-sm bg-cover transition {held ? 'ring-2 ring-[var(--accent-electric)] brightness-110' : target ? 'ring-1 ring-white/50' : ''}"
                  style="background-image:url({thumb(fileId)}); background-position:{f.fx * 100}% {f.fy * 100}%; touch-action:none;"
                  onpointerdown={(e) => startPan(e, fileId, gi)}
                  title={held ? 'Tap another photo to swap · tap here to cancel' : target ? 'Tap to swap with the held photo' : 'Tap to pick up · drag to position'}
                >
                  {#if held}
                    <div class="pointer-events-none absolute inset-x-0 bottom-0 bg-ink-900/70 px-1 py-0.5 text-center text-[8px] font-medium text-white">
                      tap a slot
                    </div>
                  {/if}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="absolute right-1 top-1 hidden gap-1 group-hover:flex" onpointerdown={(e) => e.stopPropagation()}>
                    <!-- Re-aim moved off double-click: a double-click is two
                         clicks, and a click now picks the photo up, so the two
                         gestures fought. This is a rare action, which is what
                         the corner is for. -->
                    <button
                      class="rounded-full bg-ink-900/70 p-0.5 text-white hover:bg-ink-900"
                      onclick={(e) => { e.stopPropagation(); resetFocal(gi, fileId); }}
                      aria-label="Re-aim at faces"
                      title="Re-aim at faces"
                    ><Icon name="sparkles" size={11} /></button>
                    <!-- The grip is the drag source now. Keeping it draggable
                         while the photo pans is what lets both gestures live
                         on the same cell without a mode. -->
                    <span
                      class="cursor-grab rounded-full bg-ink-900/70 p-0.5 text-white active:cursor-grabbing hover:bg-ink-900"
                      draggable="true"
                      ondragstart={() => (drag = { kind: 'cell', idx: gi })}
                      role="button"
                      tabindex="-1"
                      aria-label="Drag to another slot"
                      title="Drag to another slot"
                    ><Icon name="move" size={11} /></span>
                    <button class="rounded-full bg-ink-900/70 p-0.5 text-white hover:bg-ink-900" onclick={(e) => { e.stopPropagation(); removePhoto(gi); }} aria-label="Remove photo"><Icon name="x" size={11} /></button>
                  </div>
                </div>
              {:else}
                <button class="flex h-full w-full items-center justify-center rounded-sm border border-dashed border-white/30 text-white/40 transition hover:border-white/60 hover:text-white/70" onclick={() => openSearch(gi)} title="Search the library for a photo"><Icon name="plus" size={16} /></button>
              {/if}
            </div>
          {/each}

          {#if (s.title ?? '').trim()}
            <div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-center font-display text-sm font-bold text-white">{s.title}</div>
          {/if}

          <!-- Overlay elements -->
          {#each (s.layers ?? []) as l (l.id)}
            {@const sel = selected?.si === si && selected?.id === l.id}
            <div
              class="absolute"
              style="left:{l.x * 100}%; top:{l.y * 100}%; width:{l.w * 100}%; height:{l.h * 100}%; opacity:{l.opacity}; z-index:{sel ? 20 : 10}; outline:{sel ? '2px solid var(--accent-electric)' : 'none'}; cursor:move; touch-action:none;"
              role="button" tabindex="0"
              onpointerdown={(e) => startDrag(e, si, l.id, 'move')}
            >
              {#if l.type === 'image'}
                {#if l.file}<img src={assetUrl(l.file, { width: 600, height: 600, fit: l.fit === 'cover' ? 'cover' : 'contain' })} alt="" class="h-full w-full" style="object-fit:{l.fit};" draggable="false" />
                {:else}<div class="flex h-full w-full items-center justify-center rounded border border-dashed border-white/40 text-[9px] text-white/60">logo</div>{/if}
              {:else if l.type === 'text'}
                <div class="h-full w-full" style="color:{pcolor(l.color)}; text-align:{l.align}; font-weight:{l.weight}; line-height:{l.lineHeight}; font-family:'{l.font}',sans-serif; font-size:{(l.size / width) * 100}cqw; overflow:hidden;">{l.template}</div>
              {:else if l.type === 'logos'}
                {@const logos = (projCtx?.roleLogos?.[l.role] ?? []).slice(0, l.max)}
                {#if logos.length}
                  <div class="flex h-full w-full items-center justify-between gap-[2%]">
                    {#each logos as lg (lg)}<img src={assetUrl(lg, { width: 200, height: 200, fit: 'contain' })} alt="" class="h-full min-w-0 flex-1 object-contain" draggable="false" />{/each}
                  </div>
                {:else}<div class="flex h-full w-full items-center justify-center rounded border border-dashed border-white/40 text-[9px] text-white/60">{l.role} logos</div>{/if}
              {:else if l.type === 'rect'}
                <div class="h-full w-full" style="background:{pcolor(l.fill)}; border-radius:{l.radius}px;"></div>
              {:else if l.type === 'gradient'}
                <div class="h-full w-full" style="background:{gradientCss(l)};"></div>
              {/if}
              {#if sel}
                <button class="absolute -right-2 -top-2 rounded-full bg-ink-900 p-0.5 text-white" onclick={(e) => { e.stopPropagation(); removeLayer(si, l.id); }} aria-label="Delete element"><Icon name="x" size={10} /></button>
                <div class="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-sm bg-[var(--accent-electric)]" role="button" tabindex="0" onpointerdown={(e) => startDrag(e, si, l.id, 'resize')}></div>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Elements toolbar -->
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <span class="text-[11px] font-medium text-ink-500">Elements:</span>
          {#each (s.layers ?? []) as l (l.id)}
            <button class="rounded-full border px-2 py-0.5 text-[11px] {selected?.si === si && selected?.id === l.id ? 'border-[var(--accent-electric)] text-ink-900' : 'border-surface-border text-ink-500'}" onclick={() => (selected = { si, id: l.id })}>{l.type === 'image' ? 'logo' : l.type}</button>
          {/each}
          {#if addingEl === si}
            <span class="flex flex-wrap gap-1">
              {#each EL_TYPES as et (et.type)}
                <button class="flex items-center gap-1 rounded-md border border-surface-border px-2 py-0.5 text-[11px] hover:bg-surface-hover" onclick={() => addLayer(si, et.type)}><Icon name={et.icon} size={11} /> {et.label}</button>
              {/each}
              <button class="text-[11px] text-ink-400" onclick={() => (addingEl = null)}>cancel</button>
            </span>
          {:else}
            <button class="flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900" onclick={() => (addingEl = si)}><Icon name="plus" size={11} /> Add element</button>
          {/if}
        </div>

        <!-- Selected element props -->
        {#if selected?.si === si}
          {@const l = layerOf(si, selected.id)}
          {#if l}
            <div class="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-surface-border bg-surface-hover/40 p-2 text-xs">
              {#if l.type === 'image'}
                <label class="btn-ghost cursor-pointer text-xs">
                  {l.file ? 'Replace image' : 'Upload image'}
                  <input type="file" accept="image/*" class="hidden" onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) uploadLogo(si, l.id, f); }} />
                </label>
                <button class="rounded border border-surface-border px-2 py-0.5" onclick={() => { updateLayer(si, l.id, { fit: l.fit === 'contain' ? 'cover' : 'contain' }); queueSave(); }}>fit: {l.fit}</button>
              {:else if l.type === 'text'}
                <input class="input !py-1 text-xs" style="min-width:14rem" value={l.template} oninput={(e) => { updateLayer(si, l.id, { template: (e.currentTarget as HTMLInputElement).value }); queueSave(); }} placeholder={'Text… ({project} works)'} />
                <input type="color" value={projectColorSlot(l.color) ? '#ffffff' : l.color} onchange={(e) => { updateLayer(si, l.id, { color: (e.currentTarget as HTMLInputElement).value }); queueSave(); }} />
                <input type="number" class="input !w-16 !py-1 text-xs" value={l.size} oninput={(e) => { updateLayer(si, l.id, { size: Number((e.currentTarget as HTMLInputElement).value) || 40 }); queueSave(); }} title="Font size" />
                <select class="input !py-1 text-xs" value={l.align} onchange={(e) => { updateLayer(si, l.id, { align: (e.currentTarget as HTMLSelectElement).value as any }); queueSave(); }}>
                  <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                </select>
              {:else if l.type === 'logos'}
                <select class="input !py-1 text-xs" value={l.role} onchange={(e) => { updateLayer(si, l.id, { role: (e.currentTarget as HTMLSelectElement).value }); queueSave(); }}>
                  {#each roleOptions as r (r.key)}<option value={r.key}>{r.label}</option>{/each}
                  {#if !roleOptions.length}<option value="sponsor">sponsor</option>{/if}
                </select>
                <input type="number" class="input !w-14 !py-1 text-xs" value={l.max} oninput={(e) => { updateLayer(si, l.id, { max: Number((e.currentTarget as HTMLInputElement).value) || 6 }); queueSave(); }} title="Max logos" />
                {#if !projectId}<span class="text-ink-400">pick a Brand project ↑</span>{/if}
              {:else if l.type === 'rect'}
                <input type="color" value={projectColorSlot(l.fill) ? '#000000' : (l.fill.startsWith('#') ? l.fill : '#000000')} onchange={(e) => { updateLayer(si, l.id, { fill: (e.currentTarget as HTMLInputElement).value }); queueSave(); }} />
                <label class="flex items-center gap-1">radius <input type="number" class="input !w-14 !py-1 text-xs" value={l.radius} oninput={(e) => { updateLayer(si, l.id, { radius: Number((e.currentTarget as HTMLInputElement).value) || 0 }); queueSave(); }} /></label>
              {:else if l.type === 'gradient'}
                <input type="color" value={projectColorSlot(l.color) ? '#000000' : l.color} onchange={(e) => { updateLayer(si, l.id, { color: (e.currentTarget as HTMLInputElement).value }); queueSave(); }} />
                <select class="input !py-1 text-xs" value={l.direction} onchange={(e) => { updateLayer(si, l.id, { direction: (e.currentTarget as HTMLSelectElement).value as any }); queueSave(); }}>
                  <option value="down">↓</option><option value="up">↑</option><option value="left">←</option><option value="right">→</option>
                </select>
              {/if}
              {#if l.type !== 'logos'}
                {#if projCtx}
                  <button class="rounded border border-surface-border px-2 py-0.5" title="Use project brand color" onclick={() => { const key = l.type === 'text' ? 'color' : l.type === 'rect' ? 'fill' : 'color'; updateLayer(si, l.id, { [key]: '{project.accent}' } as any); queueSave(); }}>brand color</button>
                {/if}
              {/if}
              <button class="ml-auto text-ink-400 hover:text-tag-salesText" onclick={() => removeLayer(si, l.id)}>Delete</button>
            </div>
          {/if}
        {/if}
      </div>
    {/each}

    <!-- Add slide -->
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card p-4">
      {#if addingSlide}
        <div class="mb-2 font-display text-[10px] uppercase tracking-wider text-ink-400">Pick a layout</div>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {#each COLLAGE_LAYOUTS as lay (lay.key)}
            <button class="rounded-md border border-surface-border p-2 text-left hover:bg-surface-hover" onclick={() => addSlide(lay.key)}>
              <div class="relative mb-1 w-full overflow-hidden rounded bg-ink-900/10" style="aspect-ratio:1;">
                {#each lay.cells as c (c.x + '-' + c.y)}<div class="absolute rounded-[1px] bg-ink-400/60" style="left:{c.x * 100}%; top:{c.y * 100}%; width:{c.w * 100}%; height:{c.h * 100}%; outline:1px solid var(--bg-secondary);"></div>{/each}
              </div>
              <div class="truncate text-[11px] text-ink-600">{lay.label}</div>
            </button>
          {/each}
        </div>
        <button class="btn-ghost mt-2 text-xs" onclick={() => (addingSlide = false)}>Cancel</button>
      {:else}
        <button class="flex w-full items-center justify-center gap-1.5 text-sm text-ink-500 hover:text-ink-900" onclick={() => (addingSlide = true)}><Icon name="plus" size={14} /> Add slide</button>
      {/if}
    </div>
  </div><!-- /RIGHT -->
  </div><!-- /split -->

  <!-- Render / export -->
  <div class="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-surface-border bg-surface-card p-3 shadow-lg">
    <span class="text-xs text-ink-500">
      {taken}/{total} placed across {slides.length} slides → {slides.length} images
      {#if savedFlash}<span class="ml-2 text-tag-eventText">· Saved ✓</span>{:else}<span class="ml-2 text-ink-400">· auto-saves</span>{/if}
    </span>
    <div class="flex items-center gap-2">
      <button class="btn-ghost" onclick={downloadSlides} disabled={!!downloading || taken === 0}>
        {downloading ? `Preparing ${downloading}…` : 'Download'}
      </button>
      <button class="btn-primary" onclick={render} disabled={!!rendering || eventId == null || taken === 0}>{rendering ? `Rendering ${rendering}…` : 'Render & save'}</button>
    </div>
  </div>

  {#if generated.length}
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">Rendered images</div>
        <button class="btn-ghost text-xs" onclick={copyLinks} title="Copy the public image links — paste into Buffer or a post">
          {copiedLinks ? 'Copied ✓' : 'Copy links'}
        </button>
      </div>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {#each generated as g (g.id)}
          {#if g.file_id}
            <a href={assetUrl(g.file_id, {})} target="_blank" rel="noreferrer" class="group relative overflow-hidden rounded-md border border-surface-border" style="aspect-ratio:{width}/{height};">
              <img src={thumb(g.file_id)} alt={g.variant ?? ''} class="h-full w-full object-cover" />
              <span class="absolute bottom-0 left-0 right-0 bg-ink-900/60 px-1 py-0.5 text-center text-[9px] text-white">{g.variant}</span>
            </a>
          {/if}
        {/each}
      </div>
    </div>
  {/if}
</section>

<PhotoSearchDialog bind:open={searchOpen} onPick={onSearchPick} onClose={() => (searchOpen = false)} />

<!-- Full-screen picker. Shares `picked` with the sidebar pool rather than
     keeping its own selection, so closing it can neither lose a choice nor
     disagree with what the sidebar shows. -->
<CarouselPickerSheet
  open={pickerOpen}
  photos={unplaced}
  {picked}
  {thumb}
  {ratingOf}
  bind:minStars
  bind:includeUnrated
  {hiddenByFilter}
  {metaLoading}
  confirmLabel={buildMode === 'one'
    ? `Make ${pickedCount} slide${pickedCount === 1 ? '' : 's'}`
    : `Build ${clamp(Math.round(fixedSlides), 1, Math.max(1, pickedCount))} slide${clamp(Math.round(fixedSlides), 1, Math.max(1, pickedCount)) === 1 ? '' : 's'}`}
  onPick={pickFromPicker}
  onSelectAll={selectAllPool}
  onClear={clearPick}
  onConfirm={() => { pickerOpen = false; buildFromSelection(); }}
  onClose={() => (pickerOpen = false)}
/>
