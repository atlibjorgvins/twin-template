<script lang="ts">
  // Image Studio builder — linear two-stage flow like the Evergreen
  // workbench:
  //   SELECT   source + filters → records (auto-fetched live)
  //   DESIGN   visual layer editor (canvas preview = the real render)
  //            → batch generate → results
  // Rendering is fully client-side; outputs upload to Files → Studio
  // and are recorded as generated_image rows.
  import Icon from '$lib/Icon.svelte';
  import ProjectFilterTree from '$lib/admin/ProjectFilterTree.svelte';
  import {
    assetUrl,
    deleteDirectusFile,
    formatError,
    listCampaignCandidates,
    listOrgPhotos,
    uploadFile,
    CAMPAIGN_TOKENS,
    type CampaignCandidate,
    type CampaignSource,
    type OrganizationPhoto,
    type Project,
    type ProjectRole,
    type Tag
  } from '$lib/directus';
  import { makeZip, safeZipName, type ZipEntry } from '$lib/studio/zip';
  import {
    ASPECT_PRESETS,
    PROJECT_BRAND_SLOTS,
    VARIANT_PRESETS,
    applyVariant,
    createGeneratedImage,
    deleteGeneratedImage,
    getProjectContext,
    newLayer,
    newVariant,
    projectColorSlot,
    projectColorToken,
    studioFolderId,
    updateImageTemplate,
    type BrandedProject,
    type GeneratedImage,
    type ImageTemplate,
    type ProjectContext,
    type StudioLayer,
    type TemplateVariant
  } from '$lib/studio/data';
  import FocalPointEditor from '$lib/studio/FocalPointEditor.svelte';
  import FocalPointModal from '$lib/studio/FocalPointModal.svelte';
  import { renderTemplate, renderToBlob, type RenderContext } from '$lib/studio/render';
  import { slide } from 'svelte/transition';

  let {
    data
  }: {
    data: {
      template: ImageTemplate;
      generated: GeneratedImage[];
      projects: Project[];
      tags: Tag[];
      projectRoles: ProjectRole[];
      brandedProjects: BrandedProject[];
    };
  } = $props();

  // ── Editable template state ─────────────────────────────────────
  let name = $state(data.template.name ?? '');
  let status = $state(data.template.status ?? 'draft');
  let width = $state(data.template.width ?? 1080);
  let height = $state(data.template.height ?? 1080);
  let background = $state(data.template.background ?? '');
  let source = $state<CampaignSource>(
    (data.template.source_collection as CampaignSource) || 'organization'
  );
  let layers = $state<StudioLayer[]>(
    Array.isArray(data.template.layers) && data.template.layers.length > 0
      ? data.template.layers
      : [newLayer('base'), newLayer('text')]
  );
  let kind = $state(data.template.kind ?? 'template');

  // ── Project context ─────────────────────────────────────────────
  // Binding the template to a project feeds the dynamic fields: the
  // {project} token, the project color (usable in any color slot) and
  // the partner-logo layers (orgs linked to the project by role).
  let projectId = $state<number | null>(data.template.project_id ?? null);
  // Offered context projects = only the branded ones; a previously
  // bound project that lost its colors stays selectable so the
  // template doesn't silently unbind.
  const contextProjects = $derived.by(() => {
    const list: BrandedProject[] = [...data.brandedProjects];
    if (projectId != null && !list.some((p) => p.id === projectId)) {
      const p = data.projects.find((x) => x.id === projectId);
      if (p) list.unshift({ id: p.id, name: p.name ?? null, color: p.color ?? null });
    }
    return list;
  });
  const boundProject = $derived(
    projectId != null
      ? (contextProjects.find((p) => p.id === projectId) ??
          data.projects.find((p) => p.id === projectId) ??
          null)
      : null
  );
  let projCtx = $state<ProjectContext | null>(null);
  $effect(() => {
    const id = projectId;
    if (id == null) {
      projCtx = null;
      return;
    }
    getProjectContext(id).then((ctx) => {
      if (projectId === id) projCtx = ctx;
    });
  });

  // ── Placement variants ──────────────────────────────────────────
  // The base size plus extra placements (Story, Wide, …) designed in
  // the same flow. Moving/resizing a layer while a variant is active
  // writes a per-layer override for that placement only; everything
  // else just rescales via the fractional geometry.
  let variants = $state<TemplateVariant[]>(
    Array.isArray(data.template.variants) ? data.template.variants : []
  );
  let activeVariantKey = $state<string>('base');
  const activeVariant = $derived(variants.find((v) => v.key === activeVariantKey) ?? null);
  const activeW = $derived(activeVariant?.width ?? width);
  const activeH = $derived(activeVariant?.height ?? height);

  function geomOf(l: StudioLayer): { x: number; y: number; w: number; h: number } {
    const o = activeVariant?.overrides?.[l.id];
    return { x: o?.x ?? l.x, y: o?.y ?? l.y, w: o?.w ?? l.w, h: o?.h ?? l.h };
  }
  function setGeom(l: StudioLayer, patch: Partial<{ x: number; y: number; w: number; h: number }>) {
    // Every geometry write goes through here — dragging, resizing, arrow-key
    // nudges and the numeric inputs, eight call sites in all. Guarding at this
    // one point means a locked layer cannot be moved by ANY route, including
    // ones added later that forget to check. The UI also disables the
    // affordances, but that is a courtesy; this is the rule.
    if (l.locked) return;
    if (!activeVariant) {
      Object.assign(l, patch);
    } else {
      activeVariant.overrides = {
        ...(activeVariant.overrides ?? {}),
        [l.id]: { ...geomOf(l), ...patch }
      };
    }
  }
  function addVariant(preset: { label: string; width: number; height: number }) {
    const v = newVariant(preset);
    variants.push(v);
    activeVariantKey = v.key;
    markDirty();
  }
  function removeVariant(key: string) {
    const i = variants.findIndex((v) => v.key === key);
    if (i >= 0) variants.splice(i, 1);
    if (activeVariantKey === key) activeVariantKey = 'base';
    markDirty();
  }
  const f = data.template.filters ?? {};
  let selectedProjectIds = $state<Set<number>>(new Set(f.projectIds ?? []));
  let selectedTagIds = $state<Set<number>>(new Set(f.tagIds ?? []));
  let selectedRoles = $state<Set<string>>(new Set(f.roles ?? []));
  let search = $state(f.search ?? '');
  let requireImage = $state(!!f.requireImage);

  // Roles applicable to the current source — 'both' (or unset) always shows.
  // A person cannot be a Gold sponsor and an org cannot be a mentor, so
  // offering every role for every source invites filters that match nothing.
  const applicableRoles = $derived(
    data.projectRoles.filter((r) => {
      if (r.applies_to === 'both' || !r.applies_to) return true;
      if (source === 'organization') return r.applies_to === 'org';
      if (source === 'Person') return r.applies_to === 'person';
      return false;
    })
  );
  function toggleRole(key: string) {
    const n = new Set(selectedRoles);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    selectedRoles = n;
    markDirty();
  }

  let dirty = $state(false);
  let saving = $state(false);
  let savedFlash = $state(false);
  let errorMsg = $state<string | null>(null);
  const markDirty = () => (dirty = true);

  function currentFilters() {
    return {
      projectIds: [...selectedProjectIds],
      tagIds: [...selectedTagIds],
      // Only meaningful alongside a project: the role lives on the
      // project↔record link, so with no project there is no link to read it
      // from. Sending it anyway would narrow to nothing.
      roles: selectedProjectIds.size > 0 ? [...selectedRoles] : undefined,
      search: search.trim() || undefined,
      requireImage: requireImage || undefined
    };
  }

  async function save() {
    saving = true;
    errorMsg = null;
    try {
      await updateImageTemplate(data.template.id, {
        name,
        status,
        width,
        height,
        background: background || null,
        source_collection: source,
        filters: currentFilters(),
        project_id: projectId,
        layers: $state.snapshot(layers) as StudioLayer[],
        variants: $state.snapshot(variants) as TemplateVariant[],
        kind
      });
      dirty = false;
      savedFlash = true;
      setTimeout(() => (savedFlash = false), 1500);
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      saving = false;
    }
  }

  // ── Stage ───────────────────────────────────────────────────────
  let stage = $state<'select' | 'design'>('select');

  // ── Candidates (same live auto-fetch as Evergreen) ──────────────
  let candidates = $state<CampaignCandidate[]>([]);
  let candidatesLoaded = $state(false);
  let loadingCandidates = $state(false);
  let selectedKeys = $state<Set<string>>(new Set());
  let focused = $state<CampaignCandidate | null>(null);
  const itemKey = (collection: string, id: number | string) => `${collection}:${id}`;
  const selCount = $derived(selectedKeys.size);
  const selectedList = $derived(
    candidates.filter((c) => selectedKeys.has(itemKey(c.collection, c.id)))
  );
  const focusIndex = $derived(
    focused
      ? selectedList.findIndex(
          (c) => c.id === focused!.id && c.collection === focused!.collection
        )
      : -1
  );

  const hasAnyFilter = $derived(
    selectedProjectIds.size > 0 || selectedTagIds.size > 0 || !!search.trim() || requireImage
  );

  const CANDIDATE_PAGE = 24;
  let visibleCount = $state(CANDIDATE_PAGE);

  async function loadCandidates() {
    loadingCandidates = true;
    errorMsg = null;
    try {
      candidates = await listCampaignCandidates(source, currentFilters(), 'is');
      candidatesLoaded = true;
      visibleCount = CANDIDATE_PAGE;
      selectedKeys = new Set(
        [...selectedKeys].filter((k) => candidates.some((c) => itemKey(c.collection, c.id) === k))
      );
      if (focused && !candidates.some((c) => c.id === focused!.id && c.collection === focused!.collection)) {
        focused = null;
      }
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      loadingCandidates = false;
    }
  }

  let autoFetchTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    void source; void search; void requireImage;
    void selectedProjectIds; void selectedTagIds; void selectedRoles;
    if (autoFetchTimer) clearTimeout(autoFetchTimer);
    if (!hasAnyFilter) {
      candidates = [];
      candidatesLoaded = false;
      return;
    }
    autoFetchTimer = setTimeout(loadCandidates, 350);
    return () => {
      if (autoFetchTimer) clearTimeout(autoFetchTimer);
    };
  });

  // Tag autocomplete.
  let tagQuery = $state('');
  const tagMatches = $derived.by(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return [];
    return data.tags
      .filter((t) => !selectedTagIds.has(t.id) && (t.name ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  });
  function toggleTag(id: number) {
    const n = new Set(selectedTagIds);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    selectedTagIds = n;
    markDirty();
  }

  function pickCandidate(c: CampaignCandidate) {
    const key = itemKey(c.collection, c.id);
    const next = new Set(selectedKeys);
    if (next.has(key)) {
      next.delete(key);
      if (focused && itemKey(focused.collection, focused.id) === key) {
        focused = candidates.find((x) => next.has(itemKey(x.collection, x.id))) ?? null;
      }
    } else {
      next.add(key);
      focused = c;
    }
    selectedKeys = next;
  }
  function selectAll() {
    selectedKeys = new Set(candidates.map((c) => itemKey(c.collection, c.id)));
    if (!focused && candidates.length > 0) focused = candidates[0];
  }
  function clearSelection() {
    selectedKeys = new Set();
    focused = null;
  }
  function goTo(i: number) {
    if (selectedList.length === 0) return;
    focused = selectedList[(i + selectedList.length) % selectedList.length];
  }

  const projectName = $derived.by(() => {
    // The bound project context wins; first filter project is fallback.
    if (boundProject?.name) return boundProject.name;
    const first = [...selectedProjectIds][0];
    return first != null ? (data.projects.find((p) => p.id === first)?.name ?? null) : null;
  });

  const selectionChips = $derived.by(() => {
    const chips: string[] = [
      { organization: 'Organizations', Person: 'People', Project: 'Projects' }[source] ?? source
    ];
    if (selectedProjectIds.size > 0) chips.push(`${selectedProjectIds.size} project${selectedProjectIds.size === 1 ? '' : 's'}`);
    if (selectedTagIds.size > 0) chips.push(`${selectedTagIds.size} tag${selectedTagIds.size === 1 ? '' : 's'}`);
    // Named, not counted: "cohort_member" is the thing you need to see at a
    // glance when the section is folded — "1 role" tells you nothing.
    if (selectedProjectIds.size > 0 && selectedRoles.size > 0) {
      chips.push([...selectedRoles].map((k) => roleLabel(k)).join(', '));
    }
    if (search.trim()) chips.push(`“${search.trim()}”`);
    if (requireImage) chips.push('needs image');
    return chips;
  });

  // ── Base photo resolution ───────────────────────────────────────
  // The `base` layer's photo per record: the record image, or (policy
  // 'gallery', orgs only) the "Group photo" / first gallery photo.
  const baseLayer = $derived(layers.find((l) => l.type === 'base'));
  const baseImageCache = new Map<string, string | null>(); // key+policy → file id
  let resolvedBaseId = $state<string | null>(null);

  function bestGalleryFile(photos: OrganizationPhoto[]): string | null {
    const group = photos.find(
      (p) => typeof p.type_id === 'object' && /group/i.test((p.type_id as { name?: string })?.name ?? '')
    );
    return (group ?? photos[0])?.file_id ?? null;
  }

  async function resolveBaseImage(c: CampaignCandidate, policy: 'record' | 'gallery'): Promise<string | null> {
    if (policy !== 'gallery' || c.collection !== 'organization') return c.imageId;
    const key = `${itemKey(c.collection, c.id)}:${policy}`;
    if (baseImageCache.has(key)) return baseImageCache.get(key) ?? null;
    let id = c.imageId;
    try {
      const ph = (await listOrgPhotos(c.id)).filter((g) => !!g.file_id);
      id = bestGalleryFile(ph) ?? c.imageId;
    } catch {
      // gallery unreachable — the record image still stands
    }
    baseImageCache.set(key, id);
    return id;
  }

  $effect(() => {
    const c = focused;
    const policy = (baseLayer && baseLayer.type === 'base' ? baseLayer.source : 'record') as
      | 'record'
      | 'gallery';
    if (!c) {
      resolvedBaseId = null;
      return;
    }
    resolveBaseImage(c, policy).then((id) => {
      if (focused === c) resolvedBaseId = id;
    });
  });

  // ── Canvas preview ──────────────────────────────────────────────
  let canvasEl: HTMLCanvasElement | undefined = $state();
  let stageEl: HTMLDivElement | undefined = $state();
  let selectedLayerId = $state<string | null>(null);
  const selLayer = $derived(layers.find((l) => l.id === selectedLayerId) ?? null);

  // Renders are serialized on a promise chain (an in-flight render's
  // awaits would otherwise interleave with the next one's drawing) and
  // debounced so slider drags don't queue up dozens of frames.
  let renderChain: Promise<void> = Promise.resolve();
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let renderError = $state<string | null>(null);
  // Bumped when a photo's centre point changes — the focal rides on the
  // file (not the template), so the render effect needs this extra dep.
  let focalVersion = $state(0);
  // Full-screen centre-point popup for precise picks on big photos.
  let focalModalFile = $state<string | null>(null);

  $effect(() => {
    // $state.snapshot reads every nested property → deep deps.
    const snap = $state.snapshot({ layers, variants, background }) as {
      layers: StudioLayer[];
      variants: TemplateVariant[];
      background: string;
    };
    const v = activeVariant ? (snap.variants.find((x) => x.key === activeVariantKey) ?? null) : null;
    const dims = { width: activeW || 1080, height: activeH || 1080 };
    const rc: RenderContext = {
      candidate: focused ? $state.snapshot(focused) as CampaignCandidate : null,
      projectName,
      baseImageId: resolvedBaseId,
      projectColors: projCtx ? $state.snapshot(projCtx).colors : null,
      roleLogos: projCtx ? $state.snapshot(projCtx).roleLogos : null
    };
    void focalVersion;
    if (stage !== 'design' || !canvasEl) return;
    const canvas = canvasEl;
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderChain = renderChain.then(() =>
        renderTemplate(canvas, {
          width: dims.width,
          height: dims.height,
          background: snap.background || null,
          layers: applyVariant(snap.layers, v),
          rc
        }).then(
          () => {
            renderError = null;
          },
          (e) => {
            renderError = formatError(e);
          }
        )
      );
    }, 80);
    return () => {
      if (renderTimer) clearTimeout(renderTimer);
    };
  });

  // ── Layer operations ────────────────────────────────────────────
  function addLayer(type: StudioLayer['type']) {
    const l = newLayer(type);
    // Scrims exist to sit over the photo but UNDER the text — slot
    // them right below the lowest text layer instead of on top.
    const textIdx = type === 'gradient' ? layers.findIndex((x) => x.type === 'text') : -1;
    if (textIdx >= 0) layers.splice(textIdx, 0, l);
    else layers.push(l);
    selectedLayerId = l.id;
    markDirty();
  }
  function removeLayer(id: string) {
    const i = layers.findIndex((l) => l.id === id);
    if (i >= 0) layers.splice(i, 1);
    if (selectedLayerId === id) selectedLayerId = null;
    markDirty();
  }
  /** dir +1 moves the layer up (towards the viewer / end of array). */
  function moveLayer(id: string, dir: 1 | -1) {
    const i = layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= layers.length) return;
    const [l] = layers.splice(i, 1);
    layers.splice(j, 0, l);
    markDirty();
  }

  // The hidden file input serves both "add a new overlay layer" and
  // "replace the selected overlay's image" — mode set before click().
  let overlayFileEl: HTMLInputElement | undefined = $state();
  let uploadingOverlay = $state(false);
  let overlayMode: 'add' | 'replace' = 'add';

  function pickOverlayFile(mode: 'add' | 'replace') {
    overlayMode = mode;
    overlayFileEl?.click();
  }

  async function handleOverlayFile(file: File) {
    uploadingOverlay = true;
    errorMsg = null;
    try {
      const folder = await studioFolderId();
      const id = await uploadFile(file, {
        title: `${name || 'Studio'} — overlay`,
        folder: folder ?? undefined
      });
      if (overlayMode === 'replace' && selLayer?.type === 'image') {
        selLayer.file = id;
      } else {
        const l = newLayer('image');
        if (l.type === 'image') l.file = id;
        layers.push(l);
        selectedLayerId = l.id;
      }
      markDirty();
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      uploadingOverlay = false;
    }
  }

  const LAYER_LABEL: Record<StudioLayer['type'], string> = {
    base: 'Photo slot',
    image: 'Overlay',
    text: 'Text',
    rect: 'Box',
    gradient: 'Gradient',
    logos: 'Partner logos'
  };
  const LAYER_ICON: Record<StudioLayer['type'], 'image' | 'layers' | 'pencil' | 'tag' | 'sliders' | 'building'> = {
    base: 'image',
    image: 'layers',
    text: 'pencil',
    rect: 'tag',
    gradient: 'sliders',
    logos: 'building'
  };

  function roleLabel(key: string): string {
    return data.projectRoles.find((r) => r.key === key)?.label ?? key;
  }

  /** Full-canvas color wash — a rect stretched edge to edge with the
   *  opacity slider as its transparency control. */
  function addColorFill() {
    const l = newLayer('rect');
    if (l.type === 'rect') {
      l.x = 0; l.y = 0; l.w = 1; l.h = 1;
      l.fill = '#000000';
      l.opacity = 0.4;
    }
    // Like gradients: over the photo, under the text.
    const textIdx = layers.findIndex((x) => x.type === 'text');
    if (textIdx >= 0) layers.splice(textIdx, 0, l);
    else layers.push(l);
    selectedLayerId = l.id;
    markDirty();
  }
  function layerCaption(l: StudioLayer): string {
    if (l.type === 'text') return l.template.replace(/\s+/g, ' ').slice(0, 32) || 'empty';
    if (l.type === 'logos') return `Partner logos — ${roleLabel(l.role)}`;
    return LAYER_LABEL[l.type];
  }

  // ── Drag / resize on canvas ─────────────────────────────────────
  type DragState = {
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
  };
  let drag: DragState | null = null;

  function startDrag(e: PointerEvent, l: StudioLayer, mode: 'move' | 'resize') {
    e.preventDefault();
    e.stopPropagation();
    selectedLayerId = l.id;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id: l.id, mode, startX: e.clientX, startY: e.clientY, orig: geomOf(l) };
  }
  function onDragMove(e: PointerEvent) {
    if (!drag || !stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const l = layers.find((x) => x.id === drag!.id);
    if (!l) return;
    const g = geomOf(l);
    if (drag.mode === 'move') {
      setGeom(l, {
        x: Math.min(Math.max(drag.orig.x + dx, -g.w + 0.02), 0.98),
        y: Math.min(Math.max(drag.orig.y + dy, -g.h + 0.02), 0.98)
      });
    } else {
      setGeom(l, {
        w: Math.min(Math.max(drag.orig.w + dx, 0.04), 2),
        h: Math.min(Math.max(drag.orig.h + dy, 0.04), 2)
      });
    }
  }
  function endDrag() {
    if (drag) markDirty();
    drag = null;
  }

  /** Arrow keys nudge the focused layer handle — 0.5% per press,
   *  Shift for 2% strides. Writes through setGeom so placement
   *  variants get their own override, same as dragging. */
  function nudge(e: KeyboardEvent, l: StudioLayer) {
    const step = e.shiftKey ? 0.02 : 0.005;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();
    selectedLayerId = l.id;
    const g = geomOf(l);
    setGeom(l, { x: g.x + dx, y: g.y + dy });
    markDirty();
  }

  // ── Batch generate ──────────────────────────────────────────────
  let generated = $state<GeneratedImage[]>([...data.generated]);
  let generatingProgress = $state<string | null>(null);

  function slug(s: string): string {
    return s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image';
  }

  function tokensFor(c: CampaignCandidate): Record<string, string> {
    return {
      name: c.name,
      nickname: c.nickname ?? c.name,
      description: c.description?.trim() || c.descriptionAlt || '',
      website: c.website ?? '',
      project: projectName ?? ''
    };
  }

  async function generateBatch() {
    const items = selectedList;
    if (items.length === 0) return;
    errorMsg = null;
    const folder = await studioFolderId();
    const policy = (baseLayer && baseLayer.type === 'base' ? baseLayer.source : 'record') as
      | 'record'
      | 'gallery';
    const snap = $state.snapshot({ layers, variants, width, height, background }) as {
      layers: StudioLayer[];
      variants: TemplateVariant[];
      width: number;
      height: number;
      background: string;
    };
    // Every record renders at the base size plus each extra placement.
    const placements: Array<TemplateVariant | null> = [null, ...snap.variants];
    const total = items.length * placements.length;
    let done = 0;
    generatingProgress = `0/${total}`;
    const failures: string[] = [];
    for (const c of items) {
      // The base photo resolves once per record, shared by placements.
      let baseId: string | null = null;
      try {
        baseId = await resolveBaseImage(c, policy);
      } catch {
        // keep going — the render shows the placeholder slot
      }
      for (const v of placements) {
        try {
          const blob = await renderToBlob({
            width: v?.width ?? snap.width ?? 1080,
            height: v?.height ?? snap.height ?? 1080,
            background: snap.background || null,
            layers: applyVariant(snap.layers, v),
            rc: {
              candidate: c,
              projectName,
              baseImageId: baseId,
              projectColors: projCtx ? $state.snapshot(projCtx).colors : null,
              roleLogos: projCtx ? ($state.snapshot(projCtx).roleLogos as Record<string, string[]>) : null
            }
          });
          const suffix = v ? `-${slug(v.label)}` : '';
          const file = new File([blob], `${slug(name || 'studio')}-${slug(c.name)}${suffix}.png`, {
            type: 'image/png'
          });
          const fileId = await uploadFile(file, {
            title: `${name || 'Studio'} — ${c.name}${v ? ` (${v.label})` : ''}`,
            folder: folder ?? undefined
          });
          const row = await createGeneratedImage({
            template_id: data.template.id,
            item_collection: c.collection,
            item_id: String(c.id),
            item_label: c.name,
            file_id: fileId,
            variant: v?.label ?? null,
            tokens: tokensFor(c)
          });
          generated = [row, ...generated];
        } catch (e) {
          failures.push(`${c.name}${v ? ` (${v.label})` : ''}: ${formatError(e)}`);
        }
        done++;
        generatingProgress = `${done}/${total}`;
      }
    }
    generatingProgress = null;
    if (failures.length > 0) errorMsg = `Some renders failed — ${failures.join(' · ')}`;
  }

  // ── Download all ──────────────────────────────────────────────────────
  // One archive, not N clicks. Browsers throttle or silently drop consecutive
  // programmatic downloads and Safari blocks all but the first, so firing a
  // link per image loses files without telling you. See lib/studio/zip.ts for
  // why the entries are stored rather than deflated.
  let zipping = $state(false);
  let zipProgress = $state(0);

  /** `Label — Story.png`, matching what the row shows, so a file in Downloads
   *  is identifiable without opening it. */
  function downloadName(g: GeneratedImage, ext: string): string {
    const base = (g.item_label ?? `image-${g.id}`).trim() || `image-${g.id}`;
    return g.variant ? `${base} — ${g.variant}.${ext}` : `${base}.${ext}`;
  }

  async function downloadAll() {
    const withFiles = generated.filter((g) => g.file_id);
    if (zipping || withFiles.length === 0) return;
    zipping = true;
    zipProgress = 0;
    errorMsg = null;
    const taken = new Set<string>();
    const entries: ZipEntry[] = [];
    const failed: string[] = [];

    try {
      for (const g of withFiles) {
        try {
          const res = await fetch(assetUrl(g.file_id!));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = new Uint8Array(await res.arrayBuffer());
          // Trust the served type over the filename: a PNG saved as .jpg
          // opens fine, but the wrong extension makes it look broken.
          const ext = (res.headers.get('content-type') ?? '').includes('jpeg') ? 'jpg' : 'png';
          entries.push({ name: safeZipName(downloadName(g, ext), taken), bytes: buf });
        } catch (e) {
          // One unreachable file must not cost the other nineteen.
          failed.push(g.item_label ?? `#${g.id}`);
        }
        zipProgress = entries.length + failed.length;
      }

      if (entries.length === 0) {
        errorMsg = 'Could not fetch any of the images.';
        return;
      }

      const zip = makeZip(entries);
      const blob = new Blob([zip], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // `name` is the live template-name state, so renaming the template and
      // downloading gives the file you'd expect rather than the saved name.
      a.download = `${(name || 'studio').replace(/[/\\]/g, '-')} — ${entries.length} images.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on a timer, not immediately: Safari cancels the download if
      // the object URL dies before it has finished reading the blob.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);

      if (failed.length > 0) {
        errorMsg = `Downloaded ${entries.length}; ${failed.length} could not be fetched — ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`;
      }
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      zipping = false;
      zipProgress = 0;
    }
  }

  async function removeGenerated(g: GeneratedImage) {
    try {
      await deleteGeneratedImage(g.id);
      if (g.file_id) await deleteDirectusFile(g.file_id).catch(() => {});
      generated = generated.filter((x) => x.id !== g.id);
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  const SOURCE_OPTIONS: Array<[CampaignSource, string]> = [
    ['organization', 'Organizations'],
    ['Person', 'People'],
    ['Project', 'Projects']
  ];
  const FONT_OPTIONS = ['Space Grotesk', 'Inter'];
</script>

<svelte:head><title>{name || 'Template'} · Image studio · Tools</title></svelte:head>

<!-- Color slot: a custom picker, or one of the project's brand colors
     (project color / main background / secondary background / text /
     accent). Brand picks store a {project.<slot>} token and follow the
     bound project. -->
{#snippet colorSlot(value: string, set: (v: string) => void, fallback: string)}
  {@const slot = projectColorSlot(value)}
  {#if slot}
    <span
      class="inline-block h-6 w-8 shrink-0 rounded border-2"
      style="background: {projCtx?.colors?.[slot] ?? '#888888'}; border-color: var(--accent-electric);"
      title={`${PROJECT_BRAND_SLOTS.find((s) => s.key === slot)?.label ?? slot} — follows the project context`}
    ></span>
  {:else}
    <input
      type="color"
      class="h-6 w-8 cursor-pointer rounded border border-surface-border bg-transparent"
      {value}
      oninput={(e) => set((e.currentTarget as HTMLInputElement).value)}
    />
  {/if}
  {#if projectId != null}
    <select
      class="input !w-auto !py-0.5 text-[10px]"
      title="Bind this color to the project's brand palette"
      value={slot ?? 'custom'}
      onchange={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        set(v === 'custom' ? fallback : projectColorToken(v));
      }}
    >
      <option value="custom">Custom</option>
      {#each PROJECT_BRAND_SLOTS as s (s.key)}
        {#if projCtx?.colors?.[s.key] || slot === s.key}
          <option value={s.key}>{s.label}</option>
        {/if}
      {/each}
    </select>
  {/if}
{/snippet}

<section class="mx-auto space-y-5 pb-16 {stage === 'design' ? 'max-w-6xl' : 'max-w-3xl'}">
  <!-- Header -->
  <header class="space-y-2">
    <a href="/tools/studio" class="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700">
      <Icon name="chevron-left" size={12} /> Image studio
    </a>
    <div class="flex items-start justify-between gap-3">
      <input
        class="input w-full max-w-md font-display text-xl font-bold"
        style="letter-spacing: -0.02em;"
        placeholder="Template name"
        bind:value={name}
        oninput={markDirty}
      />
      <div class="flex shrink-0 items-center gap-2">
        {#if kind === 'oneoff'}
          <span
            class="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase"
            style="background: rgba(214,158,46,0.16); color: #B57A12;"
            title="Saved here with its outputs, but not offered as a reusable template"
          >one-off</span>
          <button
            class="btn-ghost !px-2 text-[11px]"
            title="Promote to a reusable template (shows up in Evergreen and the template list)"
            onclick={() => { kind = 'template'; markDirty(); }}
          >Make reusable</button>
        {/if}
        <select class="input !w-auto text-xs" bind:value={status} onchange={markDirty}>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
        <button class="btn-primary" disabled={saving || !dirty} onclick={save}>
          {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
    </div>
  </header>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-3 text-sm" style="color: #C0392B;">{errorMsg}</div>
  {/if}

  {#if stage === 'select'}
    <!-- 1 · Source & filters -->
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-4">
      <div class="flex items-center gap-3">
        <span class="font-display grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold" style="background: var(--accent-electric); color: var(--accent-text);">1</span>
        <span class="font-display text-[10px] uppercase tracking-wider text-ink-700" style="letter-spacing: 0.12em;">Source & filters</span>
      </div>

      <div
        class="inline-flex w-full max-w-sm p-0.5"
        role="radiogroup"
        aria-label="Source records"
        style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
      >
        {#each SOURCE_OPTIONS as [k, label] (k)}
          <button
            type="button"
            role="radio"
            aria-checked={source === k}
            class="font-display flex-1 cursor-pointer px-2 py-1 text-[11px] font-medium transition"
            style={source === k
              ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: calc(var(--radius-md) - 2px); letter-spacing: 0.04em;'
              : 'background: transparent; color: var(--text-secondary); letter-spacing: 0.04em;'}
            onclick={() => { source = k; candidatesLoaded = false; candidates = []; focused = null; markDirty(); }}
          >{label}</button>
        {/each}
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Projects</div>
          <div class="max-h-44 overflow-y-auto rounded-md border border-surface-border p-1">
            {#if data.projects.length === 0}
              <div class="px-2 py-3 text-xs text-ink-400">No projects.</div>
            {:else}
              <div oninput={markDirty} onclick={markDirty} role="presentation">
                <ProjectFilterTree projects={data.projects} bind:selected={selectedProjectIds} />
              </div>
            {/if}
          </div>
          {#if selectedProjectIds.size > 0 && applicableRoles.length > 0}
            <!-- Role on the project link — participants vs sponsors vs hosts.
                 Only appears once a project is picked: the role lives on that
                 link, so with no project there is nothing for it to qualify. -->
            <div class="mt-2">
              <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">
                Role in project <span class="normal-case tracking-normal">— any when none picked</span>
              </div>
              <div class="flex flex-wrap gap-1">
                {#each applicableRoles as r (r.key)}
                  {@const on = selectedRoles.has(r.key)}
                  <button
                    type="button"
                    class="cursor-pointer rounded-full border px-2 py-0.5 text-[11px] transition"
                    style:background-color={on ? 'rgba(44,140,153,0.12)' : 'transparent'}
                    style:color={on ? 'var(--brand, #2C8C99)' : 'var(--text-secondary)'}
                    style:border-color={on ? 'rgba(44,140,153,0.45)' : 'var(--surface-border)'}
                    aria-pressed={on}
                    onclick={() => toggleRole(r.key)}
                  >{r.label}</button>
                {/each}
              </div>
            </div>
          {/if}
        </div>
        <div class="space-y-3">
          <div>
            <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Tags / themes</div>
            {#if selectedTagIds.size > 0}
              <div class="mb-1.5 flex flex-wrap gap-1">
                {#each data.tags.filter((t) => selectedTagIds.has(t.id)) as t (t.id)}
                  <button
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition"
                    style="background-color: rgba(44,140,153,0.12); color: var(--brand, #2C8C99); border-color: rgba(44,140,153,0.45);"
                    title="Remove tag"
                    onclick={() => toggleTag(t.id)}
                  >{t.name}<Icon name="x" size={10} /></button>
                {/each}
              </div>
            {/if}
            <div class="relative">
              <input class="input w-full" placeholder="Search tags…" bind:value={tagQuery} />
              {#if tagQuery.trim()}
                <div class="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-surface-border bg-surface-card shadow-lg">
                  {#each tagMatches as t (t.id)}
                    <button
                      type="button"
                      class="block w-full cursor-pointer px-3 py-1.5 text-left text-sm text-ink-900 transition hover:bg-surface-hover"
                      onclick={() => { toggleTag(t.id); tagQuery = ''; }}
                    >{t.name}</button>
                  {:else}
                    <div class="px-3 py-2 text-xs text-ink-400">No tags match “{tagQuery.trim()}”</div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
          <div>
            <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Search</div>
            <input class="input w-full" placeholder="Narrow by name…" bind:value={search} oninput={markDirty} />
          </div>
          <label class="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" bind:checked={requireImage} onchange={markDirty} />
            Needs image
          </label>
        </div>
      </div>
    </div>

    <!-- 2 · Records -->
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-3">
      <div class="flex items-center justify-between gap-3">
        <span class="flex min-w-0 items-center gap-3">
          <span class="font-display grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold" style="background: var(--accent-electric); color: var(--accent-text);">2</span>
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-700" style="letter-spacing: 0.12em;">Records</span>
        </span>
        {#if loadingCandidates}
          <span class="text-[11px] text-ink-400">Updating…</span>
        {/if}
      </div>

      {#if !hasAnyFilter}
        <div class="py-4 text-center text-xs text-ink-400">
          Add a filter above — a project, tag, search or requirement — and matching records appear here automatically.
        </div>
      {:else if candidatesLoaded}
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500" style:opacity={loadingCandidates ? 0.6 : 1}>
          <span>
            {candidates.length} match{candidates.length === 1 ? '' : 'es'}
            {#if selCount > 0}
              · <span class="font-semibold" style="color: var(--accent-electric);">{selCount} selected</span>
            {/if}
          </span>
          <span class="flex gap-2">
            {#if candidates.length > 0}
              <button class="cursor-pointer text-ink-400 transition hover:text-ink-700" onclick={selectAll}>Select all</button>
            {/if}
            {#if selCount > 0}
              <button class="cursor-pointer text-ink-400 transition hover:text-ink-700" onclick={clearSelection}>Clear</button>
            {/if}
          </span>
        </div>
        {#if candidates.length === 0}
          <div class="py-6 text-center text-sm text-ink-400">Nothing matches these filters.</div>
        {:else}
          <ul class="grid gap-2 sm:grid-cols-2">
            {#each candidates.slice(0, visibleCount) as c (itemKey(c.collection, c.id))}
              {@const key = itemKey(c.collection, c.id)}
              {@const isSel = selectedKeys.has(key)}
              <li>
                <button
                  type="button"
                  class="relative flex w-full cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-left transition hover:bg-surface-hover"
                  style:border-color={isSel ? 'var(--accent-electric)' : 'var(--surface-border)'}
                  aria-pressed={isSel}
                  onclick={() => pickCandidate(c)}
                >
                  {#if isSel}
                    <span class="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full text-white" style="background: var(--accent-electric);"><Icon name="check" size={11} /></span>
                  {/if}
                  {#if c.imageId}
                    <img src={assetUrl(c.imageId, { width: 80, height: 80, fit: 'contain' })} alt="" class="h-10 w-10 shrink-0 rounded object-contain" style="background: var(--bg-tertiary);" />
                  {:else}
                    <span class="grid h-10 w-10 shrink-0 place-items-center rounded text-ink-300" style="background: var(--bg-tertiary);"><Icon name="building" size={16} /></span>
                  {/if}
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium text-ink-900">{c.name}</span>
                    <span class="mt-0.5 block text-[10px] text-ink-400">{c.imageId ? '✓ image' : '✗ image'}</span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
          {#if candidates.length > visibleCount}
            <button class="btn-ghost w-full text-xs" onclick={() => (visibleCount += CANDIDATE_PAGE * 2)}>
              Showing {visibleCount} of {candidates.length} — show more
            </button>
          {/if}
        {/if}
      {:else}
        <div class="py-4 text-center text-xs text-ink-400">Loading records…</div>
      {/if}
    </div>

    <div class="sticky bottom-24 z-10 md:bottom-4">
      <button
        class="btn-primary w-full !py-3 shadow-lg"
        disabled={selCount === 0}
        onclick={() => (stage = 'design')}
      >
        {selCount === 0 ? 'Select records to continue' : `Design with ${selCount} record${selCount === 1 ? '' : 's'} →`}
      </button>
    </div>
  {/if}

  {#if stage === 'design'}
    <!-- Minimised selection summary -->
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-3 rounded-[14px] border border-surface-border bg-surface-card px-4 py-3 text-left transition hover:bg-surface-hover"
      onclick={() => (stage = 'select')}
    >
      <span class="font-display grid h-6 w-9 shrink-0 place-items-center rounded-full text-[10px] font-bold" style="background: var(--accent-electric); color: var(--accent-text);">1–2</span>
      <span class="min-w-0 flex-1">
        <span class="font-display block text-[10px] uppercase tracking-wider text-ink-700" style="letter-spacing: 0.12em;">Selection</span>
        <span class="mt-1.5 flex flex-wrap gap-1">
          {#each selectionChips as chip (chip)}
            <span class="max-w-full truncate rounded-full px-2 py-0.5 text-[10px]" style="background: var(--bg-tertiary); color: var(--text-secondary);">{chip}</span>
          {/each}
          <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold" style="background: rgba(44,140,153,0.12); color: var(--brand, #2C8C99);">{selCount} record{selCount === 1 ? '' : 's'}</span>
        </span>
      </span>
      <span class="shrink-0 text-[11px] text-ink-400">edit</span>
    </button>

    <!-- 3 · Canvas -->
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-3" transition:slide={{ duration: 200 }}>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="flex items-center gap-3">
          <span class="font-display grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold" style="background: var(--accent-electric); color: var(--accent-text);">3</span>
          <span class="font-display min-w-0 truncate text-[10px] uppercase tracking-wider text-ink-700" style="letter-spacing: 0.12em;">
            Design{focused ? ` — ${focused.name}` : ''}
          </span>
        </span>
        {#if selCount > 1 && focusIndex >= 0}
          <span class="flex shrink-0 items-center gap-0.5">
            <button class="btn-ghost !px-1.5" aria-label="Previous record" onclick={() => goTo(focusIndex - 1)}>
              <Icon name="chevron-left" size={14} />
            </button>
            <span class="text-[11px] tabular-nums text-ink-500">{focusIndex + 1} / {selCount}</span>
            <button class="btn-ghost !px-1.5" aria-label="Next record" onclick={() => goTo(focusIndex + 1)}>
              <Icon name="chevron-right" size={14} />
            </button>
          </span>
        {/if}
      </div>

      <!-- Desktop split view: the visual side (placements + canvas)
           rides sticky on the right while the layer controls live on
           the left. Stacked on mobile with the canvas first. -->
      <div class="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      <div class="space-y-3 lg:order-2 lg:sticky lg:top-20">

      <!-- Placements: base size + extra variants designed in one flow.
           Layer moves/resizes while a variant is active only affect
           that placement. -->
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          class="cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium transition"
          style:background-color={activeVariantKey === 'base' ? 'rgba(29,107,254,0.12)' : 'transparent'}
          style:color={activeVariantKey === 'base' ? '#1D6BFE' : 'var(--text-secondary)'}
          style:border-color={activeVariantKey === 'base' ? 'rgba(29,107,254,0.45)' : 'var(--surface-border)'}
          aria-pressed={activeVariantKey === 'base'}
          onclick={() => (activeVariantKey = 'base')}
        >Base {width}×{height}</button>
        {#each variants as v (v.key)}
          <span class="inline-flex items-center">
            <button
              type="button"
              class="cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium transition"
              style:background-color={activeVariantKey === v.key ? 'rgba(29,107,254,0.12)' : 'transparent'}
              style:color={activeVariantKey === v.key ? '#1D6BFE' : 'var(--text-secondary)'}
              style:border-color={activeVariantKey === v.key ? 'rgba(29,107,254,0.45)' : 'var(--surface-border)'}
              aria-pressed={activeVariantKey === v.key}
              onclick={() => (activeVariantKey = v.key)}
            >{v.label} {v.width}×{v.height}</button>
            {#if activeVariantKey === v.key}
              <button
                type="button"
                class="ml-0.5 cursor-pointer text-ink-300 transition hover:text-ink-700"
                title={`Remove ${v.label}`}
                onclick={() => removeVariant(v.key)}
              ><Icon name="x" size={12} /></button>
            {/if}
          </span>
        {/each}
        <select
          class="input !w-auto !py-1 text-xs"
          value=""
          onchange={(e) => {
            const p = VARIANT_PRESETS.find((x) => x.label === (e.currentTarget as HTMLSelectElement).value);
            if (p) addVariant(p);
            (e.currentTarget as HTMLSelectElement).value = '';
          }}
        >
          <option value="" disabled>+ Add size…</option>
          {#each VARIANT_PRESETS as p (p.label)}
            <option value={p.label}>{p.label} ({p.width}×{p.height})</option>
          {/each}
        </select>
      </div>

      <!-- Size of the ACTIVE placement -->
      <div class="flex flex-wrap items-center gap-2 text-xs">
        {#if activeVariant}
          {@const v = activeVariant}
          <input class="input !w-28 !py-1 text-xs" bind:value={v.label} oninput={markDirty} title="Placement name" />
          <label class="flex items-center gap-1 text-ink-500">
            W <input type="number" class="input !w-20 !py-1 text-xs" bind:value={v.width} oninput={markDirty} min="64" max="4096" />
          </label>
          <label class="flex items-center gap-1 text-ink-500">
            H <input type="number" class="input !w-20 !py-1 text-xs" bind:value={v.height} oninput={markDirty} min="64" max="4096" />
          </label>
          <span class="text-[10px] text-ink-400">Layer moves here only affect this placement.</span>
        {:else}
          <select
            class="input !w-auto text-xs"
            value={ASPECT_PRESETS.find((p) => p.width === width && p.height === height)?.label ?? 'custom'}
            onchange={(e) => {
              const p = ASPECT_PRESETS.find((x) => x.label === (e.currentTarget as HTMLSelectElement).value);
              if (p) { width = p.width; height = p.height; markDirty(); }
            }}
          >
            {#each ASPECT_PRESETS as p (p.label)}
              <option value={p.label}>{p.label}</option>
            {/each}
            {#if !ASPECT_PRESETS.some((p) => p.width === width && p.height === height)}
              <option value="custom">Custom — {width}×{height}</option>
            {/if}
          </select>
          <label class="flex items-center gap-1 text-ink-500">
            W <input type="number" class="input !w-20 !py-1 text-xs" bind:value={width} oninput={markDirty} min="64" max="4096" />
          </label>
          <label class="flex items-center gap-1 text-ink-500">
            H <input type="number" class="input !w-20 !py-1 text-xs" bind:value={height} oninput={markDirty} min="64" max="4096" />
          </label>
        {/if}
        <label class="flex items-center gap-1.5 text-ink-500">
          Background
          <input type="color" class="h-7 w-9 cursor-pointer rounded border border-surface-border bg-transparent" value={background || '#000000'} oninput={(e) => { background = (e.currentTarget as HTMLInputElement).value; markDirty(); }} />
          {#if background}
            <button class="cursor-pointer text-[10px] text-ink-400 hover:text-ink-700" onclick={() => { background = ''; markDirty(); }}>transparent</button>
          {:else}
            <span class="text-[10px] text-ink-400">transparent</span>
          {/if}
        </label>
      </div>

      <!-- The preview IS the renderer output; handles sit on top. -->
      <div
        bind:this={stageEl}
        class="relative mx-auto w-full max-w-xl select-none overflow-hidden rounded-md"
        style="aspect-ratio: {activeW} / {activeH}; background:
          repeating-conic-gradient(var(--bg-tertiary) 0% 25%, transparent 0% 50%) 50% / 18px 18px;"
        role="presentation"
        onpointerdown={() => (selectedLayerId = null)}
      >
        <canvas bind:this={canvasEl} class="absolute inset-0 h-full w-full"></canvas>
        {#each layers as l (l.id)}
          {#if l.visible}
            {@const g = geomOf(l)}
            <div
              class="absolute touch-none"
              role="button"
              tabindex="0"
              aria-label={`${LAYER_LABEL[l.type]} layer`}
              style="left: {g.x * 100}%; top: {g.y * 100}%; width: {g.w * 100}%; height: {g.h * 100}%;
                transform: rotate({l.rotation ?? 0}deg);
                cursor: {l.locked ? 'default' : 'move'}; border: 1.5px {selectedLayerId === l.id ? (l.locked ? 'dotted var(--text-secondary)' : 'solid var(--accent-electric)') : 'dashed transparent'};"
              onpointerdown={(e) => startDrag(e, l, 'move')}
              onpointermove={onDragMove}
              onpointerup={endDrag}
              onpointercancel={endDrag}
              onkeydown={(e) => nudge(e, l)}
            >
              {#if selectedLayerId === l.id && !l.locked}
                <div
                  class="absolute -bottom-1.5 -right-1.5 h-4 w-4 touch-none rounded-sm"
                  style="background: var(--accent-electric); cursor: nwse-resize;"
                  role="presentation"
                  onpointerdown={(e) => startDrag(e, l, 'resize')}
                  onpointermove={onDragMove}
                  onpointerup={endDrag}
                  onpointercancel={endDrag}
                ></div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
      {#if renderError}
        <p class="text-[11px]" style="color: #C0392B;">Preview error: {renderError}</p>
      {/if}
      {#if !focused}
        <p class="text-[11px] text-ink-400">No record focused — dynamic layers show their raw {'{tokens}'}.</p>
      {/if}
      </div>

      <!-- Controls column -->
      <div class="mt-4 space-y-3 lg:order-1 lg:mt-0">
      <!-- Project context — feeds {project}, the dynamic project color
           and partner-logo layers. -->
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Project context</span>
        <select
          class="input !w-auto max-w-full text-xs"
          value={projectId ?? ''}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            projectId = v ? Number(v) : null;
            markDirty();
          }}
        >
          <option value="">None</option>
          {#each contextProjects as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
        {#if contextProjects.length === 0}
          <span class="text-[10px] text-ink-400">
            No projects with brand colors yet — set them on the Project (project color or the brand palette fields).
          </span>
        {/if}
        {#if projCtx}
          <span class="flex items-center gap-1">
            {#each PROJECT_BRAND_SLOTS as s (s.key)}
              {#if projCtx.colors?.[s.key]}
                <span
                  class="inline-block h-4 w-4 rounded-full border border-surface-border"
                  style="background: {projCtx.colors[s.key]};"
                  title={s.label}
                ></span>
              {/if}
            {/each}
          </span>
        {/if}
        {#if projectId != null}
          <span class="text-[10px] text-ink-400">
            {Object.values(projCtx?.roleLogos ?? {}).reduce((n, a) => n + a.length, 0)} linked logo{Object.values(projCtx?.roleLogos ?? {}).reduce((n, a) => n + a.length, 0) === 1 ? '' : 's'}
          </span>
        {/if}
      </div>

      <!-- Layer panel -->
      <div class="rounded-md border border-surface-border">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-surface-divider px-3 py-2">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Layers — top first</span>
          <span class="flex flex-wrap gap-1">
            <button class="btn-ghost !px-2 !py-1 text-[11px]" onclick={() => addLayer('text')}>+ Text</button>
            <button class="btn-ghost !px-2 !py-1 text-[11px]" disabled={uploadingOverlay} onclick={() => pickOverlayFile('add')}>
              {uploadingOverlay ? 'Uploading…' : '+ Overlay PNG'}
            </button>
            <button class="btn-ghost !px-2 !py-1 text-[11px]" onclick={() => addLayer('gradient')}>+ Gradient</button>
            <button class="btn-ghost !px-2 !py-1 text-[11px]" title="Full-canvas color wash with adjustable transparency" onclick={addColorFill}>+ Color fill</button>
            <button class="btn-ghost !px-2 !py-1 text-[11px]" onclick={() => addLayer('rect')}>+ Box</button>
            <button
              class="btn-ghost !px-2 !py-1 text-[11px]"
              title="Strip of logos from orgs linked to the project context (sponsors, partners…)"
              onclick={() => addLayer('logos')}
            >+ Partner logos</button>
            {#if !baseLayer}
              <button class="btn-ghost !px-2 !py-1 text-[11px]" onclick={() => addLayer('base')}>+ Photo slot</button>
            {/if}
          </span>
        </div>
        <ul class="divide-y divide-surface-divider">
          {#each [...layers].reverse() as l (l.id)}
            <li style:background={selectedLayerId === l.id ? 'var(--bg-tertiary)' : 'transparent'}>
              <div class="flex items-center gap-2 px-3 py-1.5 transition hover:bg-surface-hover">
              <button class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left" onclick={() => (selectedLayerId = l.id)}>
                <Icon name={LAYER_ICON[l.type]} size={13} class="shrink-0 text-ink-400" />
                <span class="truncate text-xs text-ink-900">{layerCaption(l)}</span>
                <span class="shrink-0 text-[10px] uppercase text-ink-300">{LAYER_LABEL[l.type]}</span>
              </button>
              <button class="btn-ghost !px-1.5 !py-1" title="Move up" onclick={() => moveLayer(l.id, 1)}><Icon name="chevron-right" size={12} class="-rotate-90" /></button>
              <button class="btn-ghost !px-1.5 !py-1" title="Move down" onclick={() => moveLayer(l.id, -1)}><Icon name="chevron-right" size={12} class="rotate-90" /></button>
              <button class="btn-ghost !px-1.5 !py-1" title={l.visible ? 'Hide layer' : 'Show layer'} onclick={() => { l.visible = !l.visible; markDirty(); }}>
                <Icon name={l.visible ? 'eye' : 'eye-off'} size={13} />
              </button>
              <!-- Pin in place. Tinted when on, because a lock you cannot see
                   at a glance is a lock you will fight without knowing why. -->
              <button
                class="btn-ghost !px-1.5 !py-1"
                style={l.locked ? 'color: var(--brand, #2f7d7d);' : ''}
                title={l.locked ? 'Unlock — allow moving and resizing' : 'Lock in place'}
                aria-pressed={!!l.locked}
                onclick={() => { l.locked = !l.locked; markDirty(); }}
              >
                <Icon name={l.locked ? 'lock' : 'lock-open'} size={13} />
              </button>
              <!-- Delete is disabled while locked. Locking says "this is
                   right"; letting one stray click erase it would make the
                   lock a half-promise. -->
              <button
                class="btn-ghost !px-1.5 !py-1 text-ink-300 hover:text-ink-700 disabled:opacity-40"
                title={l.locked ? 'Unlock this layer before deleting it' : 'Delete layer'}
                disabled={!!l.locked}
                onclick={() => removeLayer(l.id)}
              >
                <Icon name="x" size={13} />
              </button>
              </div>
              <!-- Inline settings — expand under the selected row. -->
              {#if selectedLayerId === l.id && selLayer}
        <div class="space-y-3 border-t border-surface-divider px-3 pb-3 pt-2" transition:slide={{ duration: 150 }}>
          <div class="flex items-center justify-between">
            <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">{LAYER_LABEL[selLayer.type]} settings</span>
            <label class="flex items-center gap-1.5 text-[11px] text-ink-500">
              Opacity
              <input type="range" min="0" max="1" step="0.05" bind:value={selLayer.opacity} oninput={markDirty} />
            </label>
          </div>

          <!-- Position & size — exact numbers in % of the canvas. X/Y/W/H
               write to the active placement (same as dragging); rotation
               is shared by all placements. Arrow keys nudge the selected
               layer on the canvas, Shift for bigger strides. -->
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-surface-divider pb-3 text-[11px] text-ink-500">
            {#if selLayer.locked}
              <span class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style="background: var(--bg-tertiary); color: var(--text-secondary);">
                <Icon name="lock" size={10} /> Locked — unlock to move or resize
              </span>
            {/if}
            {#each [['X', 'x'], ['Y', 'y'], ['W', 'w'], ['H', 'h']] as const as [lbl, k] (k)}
              <label class="flex items-center gap-1" style:opacity={selLayer.locked ? 0.45 : 1}>
                {lbl}
                <input
                  type="number"
                  class="input !w-16 !py-1 text-xs"
                  disabled={!!selLayer.locked}
                  step="0.5"
                  value={Math.round(geomOf(selLayer)[k] * 1000) / 10}
                  oninput={(e) => {
                    const v = Number((e.currentTarget as HTMLInputElement).value);
                    if (Number.isFinite(v) && selLayer) {
                      setGeom(selLayer, { [k]: v / 100 } as Partial<{ x: number; y: number; w: number; h: number }>);
                      markDirty();
                    }
                  }}
                />%
              </label>
            {/each}
            <label class="flex items-center gap-1">
              Rotate
              <input
                type="number"
                class="input !w-16 !py-1 text-xs"
                step="1"
                min="-180"
                max="180"
                value={selLayer.rotation ?? 0}
                oninput={(e) => {
                  const v = Number((e.currentTarget as HTMLInputElement).value);
                  if (Number.isFinite(v) && selLayer) {
                    selLayer.rotation = Math.max(-180, Math.min(180, v));
                    markDirty();
                  }
                }}
              />°
              {#if selLayer.rotation}
                <button class="cursor-pointer text-[10px] text-ink-400 transition hover:text-ink-700" onclick={() => { if (selLayer) { selLayer.rotation = 0; markDirty(); } }}>reset</button>
              {/if}
            </label>
            <span class="flex gap-1">
              <button class="btn-ghost !px-2 !py-0.5 text-[10px] disabled:opacity-40" disabled={!!selLayer?.locked} title="Center horizontally" onclick={() => { if (selLayer) { setGeom(selLayer, { x: (1 - geomOf(selLayer).w) / 2 }); markDirty(); } }}>Center H</button>
              <button class="btn-ghost !px-2 !py-0.5 text-[10px] disabled:opacity-40" disabled={!!selLayer?.locked} title="Center vertically" onclick={() => { if (selLayer) { setGeom(selLayer, { y: (1 - geomOf(selLayer).h) / 2 }); markDirty(); } }}>Center V</button>
              <button class="btn-ghost !px-2 !py-0.5 text-[10px] disabled:opacity-40" disabled={!!selLayer?.locked} title="Stretch edge to edge" onclick={() => { if (selLayer) { setGeom(selLayer, { x: 0, y: 0, w: 1, h: 1 }); markDirty(); } }}>Full bleed</button>
            </span>
          </div>

          {#if selLayer.type === 'text'}
            <div>
              <div class="mb-1 flex items-center justify-between">
                <span class="text-[10px] text-ink-400">Text — {'{tokens}'} fill per record</span>
                <span class="flex gap-1">
                  {#each CAMPAIGN_TOKENS as tok (tok)}
                    <button
                      type="button"
                      class="cursor-pointer rounded border border-surface-border px-1.5 py-0.5 font-mono text-[10px] text-ink-500 transition hover:bg-surface-hover"
                      onclick={() => { if (selLayer && selLayer.type === 'text') { selLayer.template += `{${tok}}`; markDirty(); } }}
                    >{`{${tok}}`}</button>
                  {/each}
                </span>
              </div>
              <textarea class="input w-full font-mono text-sm" rows="2" bind:value={selLayer.template} oninput={markDirty}></textarea>
            </div>
            <div class="flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
              <label class="flex items-center gap-1">
                Font
                <select class="input !w-auto !py-1 text-xs" bind:value={selLayer.font} onchange={markDirty}>
                  {#each FONT_OPTIONS as fo (fo)}<option value={fo}>{fo}</option>{/each}
                </select>
              </label>
              <label class="flex items-center gap-1">
                Size
                <input type="number" class="input !w-16 !py-1 text-xs" bind:value={selLayer.size} oninput={markDirty} min="8" max="600" />
              </label>
              <label class="flex items-center gap-1">
                Weight
                <select class="input !w-auto !py-1 text-xs" bind:value={selLayer.weight} onchange={markDirty}>
                  <option value={400}>Regular</option>
                  <option value={500}>Medium</option>
                  <option value={700}>Bold</option>
                </select>
              </label>
              <label class="flex items-center gap-1">
                Color
                {@render colorSlot(selLayer.color, (v) => { if (selLayer?.type === 'text') { selLayer.color = v; markDirty(); } }, '#ffffff')}
              </label>
              <div class="inline-flex p-0.5" role="radiogroup" aria-label="Text align" style="background: var(--bg-tertiary); border-radius: var(--radius-md);">
                {#each ['left', 'center', 'right'] as const as a (a)}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selLayer.align === a}
                    class="cursor-pointer px-2 py-0.5 text-[10px] capitalize transition"
                    style={selLayer.align === a ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: calc(var(--radius-md) - 2px);' : 'color: var(--text-secondary);'}
                    onclick={() => { if (selLayer && selLayer.type === 'text') { selLayer.align = a; markDirty(); } }}
                  >{a}</button>
                {/each}
              </div>
              <label class="flex items-center gap-1.5">
                <input type="checkbox" bind:checked={selLayer.autoFit} onchange={markDirty} />
                Shrink to fit
              </label>
            </div>
          {:else if selLayer.type === 'base'}
            <div class="flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
              <div class="inline-flex p-0.5" role="radiogroup" aria-label="Photo source" style="background: var(--bg-tertiary); border-radius: var(--radius-md);">
                {#each [['record', 'Record image'], ['gallery', 'Team photo']] as const as [k, label] (k)}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selLayer.source === k}
                    class="cursor-pointer px-2 py-0.5 text-[10px] transition"
                    style={selLayer.source === k ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: calc(var(--radius-md) - 2px);' : 'color: var(--text-secondary);'}
                    onclick={() => { if (selLayer && selLayer.type === 'base') { selLayer.source = k; markDirty(); } }}
                  >{label}</button>
                {/each}
              </div>
              <label class="flex items-center gap-1">
                Fit
                <select class="input !w-auto !py-1 text-xs" bind:value={selLayer.fit} onchange={markDirty}>
                  <option value="cover">Cover (crop)</option>
                  <option value="contain">Contain</option>
                </select>
              </label>
              <label class="flex items-center gap-1">
                Corner radius
                <input type="number" class="input !w-16 !py-1 text-xs" bind:value={selLayer.radius} oninput={markDirty} min="0" max="600" />
              </label>
            </div>
            {#if selLayer.fit === 'cover' && resolvedBaseId}
              <!-- Per-photo, not per-template: the dot saves onto the
                   Directus file, so paging through records sets each
                   team's own centre. -->
              <div class="flex items-end gap-2">
                <FocalPointEditor fileId={resolvedBaseId} onChange={() => focalVersion++} />
                <button
                  type="button"
                  class="btn-ghost !px-2 !py-1 text-[10px]"
                  title="Open the photo large for a precise pick"
                  onclick={() => (focalModalFile = resolvedBaseId)}
                >Open large</button>
              </div>
            {/if}
          {:else if selLayer.type === 'image'}
            <div class="flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
              {#if selLayer.file}
                <img src={assetUrl(selLayer.file, { width: 96 })} alt="" class="h-10 w-10 rounded border border-surface-border object-contain" style="background: var(--bg-tertiary);" />
              {/if}
              <button class="btn-ghost !px-2 !py-1 text-[11px]" disabled={uploadingOverlay} onclick={() => pickOverlayFile('replace')}>Replace image…</button>
              <label class="flex items-center gap-1">
                Fit
                <select class="input !w-auto !py-1 text-xs" bind:value={selLayer.fit} onchange={markDirty}>
                  <option value="contain">Contain</option>
                  <option value="cover">Cover (crop)</option>
                </select>
              </label>
            </div>
            {#if selLayer.fit === 'cover' && selLayer.file}
              <div class="flex items-end gap-2">
                <FocalPointEditor fileId={selLayer.file} onChange={() => focalVersion++} />
                <button
                  type="button"
                  class="btn-ghost !px-2 !py-1 text-[10px]"
                  title="Open the image large for a precise pick"
                  onclick={() => { if (selLayer?.type === 'image') focalModalFile = selLayer.file; }}
                >Open large</button>
              </div>
            {/if}
          {:else if selLayer.type === 'rect'}
            <div class="flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
              <label class="flex items-center gap-1">
                Fill
                {@render colorSlot(
                  projectColorSlot(selLayer.fill) || selLayer.fill.startsWith('#') ? selLayer.fill : '#000000',
                  (v) => { if (selLayer?.type === 'rect') { selLayer.fill = v; markDirty(); } },
                  '#000000'
                )}
              </label>
              <label class="flex items-center gap-1">
                Corner radius
                <input type="number" class="input !w-16 !py-1 text-xs" bind:value={selLayer.radius} oninput={markDirty} min="0" max="600" />
              </label>
              <span class="text-[10px] text-ink-400">Tip: drop opacity for a scrim behind text.</span>
            </div>
          {:else if selLayer.type === 'gradient'}
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-ink-500">
              <label class="flex items-center gap-1">
                Color
                {@render colorSlot(selLayer.color, (v) => { if (selLayer?.type === 'gradient') { selLayer.color = v; markDirty(); } }, '#000000')}
              </label>
              <label class="flex items-center gap-1.5">
                Start {Math.round(selLayer.from * 100)}%
                <input type="range" min="0" max="1" step="0.05" bind:value={selLayer.from} oninput={markDirty} />
              </label>
              <label class="flex items-center gap-1.5">
                End {Math.round(selLayer.to * 100)}%
                <input type="range" min="0" max="1" step="0.05" bind:value={selLayer.to} oninput={markDirty} />
              </label>
              <div class="inline-flex p-0.5" role="radiogroup" aria-label="Gradient direction" style="background: var(--bg-tertiary); border-radius: var(--radius-md);">
                {#each [['down', '↓'], ['up', '↑'], ['left', '←'], ['right', '→']] as const as [d, arrow] (d)}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selLayer.direction === d}
                    aria-label={`Fade ${d}`}
                    class="cursor-pointer px-2 py-0.5 text-[11px] transition"
                    style={selLayer.direction === d ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: calc(var(--radius-md) - 2px);' : 'color: var(--text-secondary);'}
                    onclick={() => { if (selLayer && selLayer.type === 'gradient') { selLayer.direction = d; markDirty(); } }}
                  >{arrow}</button>
                {/each}
              </div>
              <span class="text-[10px] text-ink-400">Fades from Start to End opacity along the arrow — sit it over the photo, under the text.</span>
            </div>
          {:else if selLayer.type === 'logos'}
            <div class="flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
              <label class="flex items-center gap-1">
                Role
                <select class="input !w-auto !py-1 text-xs" bind:value={selLayer.role} onchange={markDirty}>
                  {#if !data.projectRoles.some((r) => r.key === selLayer.role)}
                    <option value={selLayer.role}>{selLayer.role}</option>
                  {/if}
                  {#each data.projectRoles as r (r.key)}
                    <option value={r.key}>{r.label}</option>
                  {/each}
                </select>
              </label>
              <label class="flex items-center gap-1">
                Max logos
                <input type="number" class="input !w-16 !py-1 text-xs" bind:value={selLayer.max} oninput={markDirty} min="1" max="12" />
              </label>
              {#if projectId == null}
                <span class="text-[10px]" style="color: #B57A12;">Pick a project context above — without one this strip stays empty.</span>
              {:else}
                <span class="text-[10px] text-ink-400">
                  {(projCtx?.roleLogos?.[selLayer.role] ?? []).length} logo{(projCtx?.roleLogos?.[selLayer.role] ?? []).length === 1 ? '' : 's'} linked as “{roleLabel(selLayer.role)}” on {boundProject?.name}
                </span>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
            </li>
          {/each}
        </ul>
      </div>

      </div>
      </div>

      <input
        type="file"
        accept="image/*"
        class="hidden"
        bind:this={overlayFileEl}
        onchange={(e) => {
          const file = (e.currentTarget as HTMLInputElement).files?.[0];
          if (file) handleOverlayFile(file);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />
    </div>

    <!-- 4 · Generate -->
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-3">
      <div class="flex items-center justify-between gap-3">
        <span class="flex items-center gap-3">
          <span class="font-display grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold" style="background: var(--accent-electric); color: var(--accent-text);">4</span>
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-700" style="letter-spacing: 0.12em;">Generate</span>
        </span>
        <button class="btn-primary !px-3 !py-1.5 text-xs" disabled={generatingProgress !== null || selCount === 0} onclick={generateBatch}>
          {generatingProgress
            ? `Rendering ${generatingProgress}…`
            : `Generate ${selCount * (1 + variants.length)} image${selCount * (1 + variants.length) === 1 ? '' : 's'}`}
        </button>
      </div>
      <p class="text-[11px] text-ink-400">
        Each selected record renders at {width}×{height}{variants.length > 0
          ? ` plus ${variants.map((v) => `${v.label} ${v.width}×${v.height}`).join(', ')}`
          : ''} and saves to Directus (Files → Studio).
      </p>
    </div>
  {/if}

  <!-- Generated images — visible in both stages -->
  {#if generated.length > 0}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <div class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">Generated images</div>
        <span class="text-[10px] text-ink-400">{generated.filter((g) => g.file_id).length}</span>
        <button
          class="btn-ghost ml-auto text-xs"
          onclick={downloadAll}
          disabled={zipping || generated.filter((g) => g.file_id).length === 0}
          title="Download every image as one zip"
        >
          <Icon name="download" size={13} />
          {#if zipping}
            Zipping {zipProgress}/{generated.filter((g) => g.file_id).length}…
          {:else}
            Download all
          {/if}
        </button>
      </div>
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {#each generated as g (g.id)}
          <li class="space-y-1">
            {#if g.file_id}
              <a href={assetUrl(g.file_id)} target="_blank" rel="noreferrer" class="block overflow-hidden rounded-md border border-surface-border">
                <img src={assetUrl(g.file_id, { width: 400 })} alt={g.item_label ?? ''} class="aspect-square w-full object-cover" loading="lazy" style="background: var(--bg-tertiary);" />
              </a>
            {/if}
            <div class="flex items-center justify-between gap-1">
              <span class="min-w-0 flex-1 truncate text-[11px] text-ink-700">
                {g.item_label}{#if g.variant}<span class="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style="background: var(--bg-tertiary); color: var(--text-secondary);">{g.variant}</span>{/if}
              </span>
              {#if g.file_id}
                <a class="btn-ghost !px-1.5 !py-1" href={`${assetUrl(g.file_id)}&download`} title="Download" download>
                  <Icon name="download" size={13} />
                </a>
              {/if}
              <button class="btn-ghost !px-1.5 !py-1 text-ink-300 hover:text-ink-700" title="Delete image" onclick={() => removeGenerated(g)}>
                <Icon name="x" size={13} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

{#if focalModalFile}
  <FocalPointModal
    fileId={focalModalFile}
    onClose={() => (focalModalFile = null)}
    onChange={() => focalVersion++}
  />
{/if}
