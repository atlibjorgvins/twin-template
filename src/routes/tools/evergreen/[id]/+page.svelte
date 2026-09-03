<script lang="ts">
  // Evergreen campaign workbench — a linear, two-stage flow:
  //   SELECT   1 source + filters → 2 candidates (auto-fetched live)
  //   COMPOSE  3 platforms + template → 4 preview & brief
  // Continuing folds the selection stage into a summary bar; tapping it
  // reopens the filters. Generating a post saves a campaign_post row
  // (rotation memory) and produces a copyable brief or queues straight
  // into Buffer via the proxy flow.
  import { untrack } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import ProjectFilterTree from '$lib/admin/ProjectFilterTree.svelte';
  import PostPreview from '$lib/evergreen/PostPreview.svelte';
  import {
    updateCampaign,
    duplicateCampaign,
    listCampaignCandidates,
    createCampaignPost,
    updateCampaignPost,
    deleteCampaignPost,
    renderCampaignTemplate,
    campaignTemplateFor,
    assetUrl,
    uploadFile,
    uploadFromUrl,
    listOrgPhotos,
    queueToBuffer,
    type BufferChannel,
    type OrganizationPhoto,
    type ProjectRole,
    formatError,
    CAMPAIGN_PLATFORMS,
    CAMPAIGN_PLATFORM_LABEL,
    platformService,
    isStoryPlatform,
    CAMPAIGN_TOKENS,
    type Campaign,
    type CampaignPost,
    type CampaignPlatform,
    type CampaignSource,
    type CampaignCandidate,
    type Project,
    type Tag,
    type PostingIdentity
  } from '$lib/directus';
  import { createImageTemplate, newLayer, type ImageTemplate } from '$lib/studio/data';
  import { renderCandidatePreviewUrl, renderCandidateToDirectus, resolveStudioBaseImage } from '$lib/studio/apply';
  import FocalPointModal from '$lib/studio/FocalPointModal.svelte';
  import { listEventPhotos } from '$lib/events/data';
  import { goto } from '$app/navigation';
  import { slide } from 'svelte/transition';

  let {
    data
  }: {
    data: {
      campaign: Campaign;
      posts: CampaignPost[];
      projects: Project[];
      tags: Tag[];
      identities: PostingIdentity[];
      bufferChannels: BufferChannel[];
      projectRoles: ProjectRole[];
      studioTemplates: ImageTemplate[];
    };
  } = $props();

  // ── Editable campaign state ─────────────────────────────────────
  let name = $state(data.campaign.name ?? '');
  let status = $state(data.campaign.status ?? 'draft');
  let description = $state(data.campaign.description ?? '');
  let source = $state<CampaignSource>(
    (data.campaign.source_collection as CampaignSource) || 'organization'
  );
  let platforms = $state<CampaignPlatform[]>(
    (data.campaign.platforms as CampaignPlatform[]) ?? ['general']
  );
  let baseTemplate = $state(data.campaign.base_template ?? '');
  let overrides = $state<Partial<Record<CampaignPlatform, string>>>(
    { ...(data.campaign.platform_overrides ?? {}) }
  );
  // Posting identity — a preset picked from Settings → Posting
  // identities. The campaign's saved choice wins; otherwise the
  // default preset is preselected so the user never has to touch it.
  const campaignIdentityId =
    typeof data.campaign.identity_id === 'object'
      ? data.campaign.identity_id?.id
      : data.campaign.identity_id;
  let identityId = $state<number | null>(
    campaignIdentityId ??
      data.identities.find((i) => i.is_default)?.id ??
      data.identities[0]?.id ??
      null
  );
  const identity = $derived(data.identities.find((i) => i.id === identityId) ?? null);
  let language = $state<'is' | 'en'>(data.campaign.language === 'en' ? 'en' : 'is');
  // Marketing campaign this content is tied to (F5).
  let mkCampaignId = $state<number | ''>(
    typeof data.campaign.mk_campaign_id === 'object'
      ? (data.campaign.mk_campaign_id?.id ?? '')
      : (data.campaign.mk_campaign_id ?? '')
  );
  const f = data.campaign.filters ?? {};
  let selectedProjectIds = $state<Set<number>>(new Set(f.projectIds ?? []));
  let selectedTagIds = $state<Set<number>>(new Set(f.tagIds ?? []));
  let search = $state(f.search ?? '');
  let selectedRoles = $state<Set<string>>(new Set(f.roles ?? []));
  let requireImage = $state(!!f.requireImage);
  let requireDescription = $state(!!f.requireDescription);
  let dateFrom = $state(f.dateFrom ?? '');
  let dateTo = $state(f.dateTo ?? '');

  let dirty = $state(false);
  let saving = $state(false);
  let errorMsg = $state<string | null>(null);
  let savedFlash = $state(false);

  function markDirty() {
    dirty = true;
  }

  function currentFilters() {
    return {
      projectIds: [...selectedProjectIds],
      tagIds: [...selectedTagIds],
      roles: selectedProjectIds.size > 0 ? [...selectedRoles] : undefined,
      search: search.trim() || undefined,
      requireImage: requireImage || undefined,
      requireDescription: requireDescription || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined
    };
  }

  async function save() {
    saving = true;
    errorMsg = null;
    try {
      await updateCampaign(data.campaign.id, {
        name,
        status,
        description: description || null,
        source_collection: source,
        platforms,
        base_template: baseTemplate || null,
        platform_overrides: overrides,
        filters: currentFilters(),
        identity_id: identityId,
        mk_campaign_id: mkCampaignId === '' ? null : Number(mkCampaignId),
        language,
        image_template_id: imageSource === 'studio' ? studioTemplateId : null,
        image_templates: imageSource === 'studio' ? { ...platformTemplates } : null,
        schedule: { from: scheduleFrom || null, to: scheduleTo || null }
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

  async function duplicate() {
    try {
      const copy = await duplicateCampaign(data.campaign.id);
      await goto(`/tools/evergreen/${copy.id}`, { invalidateAll: true });
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  // ── Candidates ──────────────────────────────────────────────────
  let candidates = $state<CampaignCandidate[]>([]);
  let candidatesLoaded = $state(false);
  let loadingCandidates = $state(false);
  let selected = $state<CampaignCandidate | null>(null);

  // ── Post image ──────────────────────────────────────────────────
  // The record's own image is the default; the strip in step 4 also
  // offers the org's gallery photos, a device upload and a URL import.
  // The choice is per-post — it rides on the generated campaign_post,
  // not on the campaign.
  // Per-team manual picks (itemKey → file id). They persist while
  // paging through the batch so each team keeps its own choice until
  // the posts are saved.
  let customImages = $state<Record<string, string>>({});
  const customImageId = $derived(
    selected ? (customImages[itemKey(selected.collection, selected.id)] ?? null) : null
  );
  function setCustomImage(id: string | null) {
    if (!selected) return;
    const key = itemKey(selected.collection, selected.id);
    const next = { ...customImages };
    if (id) next[key] = id;
    else delete next[key];
    customImages = next;
  }
  // Holds org photos OR event photos — both expose file_id (+ caption);
  // org photos also carry type_id, used to prefer the "Group photo".
  type GalleryPhoto = { id: number; file_id?: string | null; caption?: string | null; type_id?: unknown };
  let galleryPhotos = $state<GalleryPhoto[]>([]);
  let uploadingImage = $state(false);
  let imageUrlInput = $state('');
  let showUrlInput = $state(false);
  let imageFileEl: HTMLInputElement | undefined = $state();

  // Image source policy: which visual a post defaults to. 'gallery'
  // prefers each team's "Group photo" (then any gallery photo), falling
  // back to the record image. 'studio' renders each team through an
  // Image Studio template (photo slot + overlays + {token} text) and
  // rides the rendered file on the post. The batch path resolves all
  // three per team.
  let studioTemplateId = $state<number | null>(data.campaign.image_template_id ?? null);
  // Per-platform template overrides — the default template covers any
  // platform without an entry, so square feed + story + wide can each
  // get their own design in one campaign.
  let platformTemplates = $state<Partial<Record<CampaignPlatform, number | null>>>(
    { ...(data.campaign.image_templates ?? {}) }
  );
  let imageSource = $state<'record' | 'gallery' | 'studio'>(
    data.campaign.image_template_id ? 'studio' : 'record'
  );
  const studioTemplate = $derived(
    imageSource === 'studio'
      ? (data.studioTemplates.find((t) => t.id === studioTemplateId) ?? null)
      : null
  );
  function templateFor(platform: CampaignPlatform): ImageTemplate | null {
    if (imageSource !== 'studio') return null;
    const id = platformTemplates[platform] ?? studioTemplateId;
    return data.studioTemplates.find((t) => t.id === id) ?? null;
  }

  // Centre-point popup — adjust a photo's crop centre without leaving
  // the workbench. Bumping focalSeq invalidates cached studio renders
  // and re-renders the live preview.
  let focalModalFile = $state<string | null>(null);
  let focalSeq = $state(0);
  function onFocalChanged() {
    studioRendered.clear();
    focalSeq++;
  }

  // The studio template's base photo for the focused team — what the
  // centre-point popup edits while in studio mode.
  let studioBaseId = $state<string | null>(null);
  $effect(() => {
    const c = selected;
    const t = studioTemplate;
    if (!c || !t) {
      studioBaseId = null;
      return;
    }
    resolveStudioBaseImage(t, $state.snapshot(c) as CampaignCandidate).then((id) => {
      if (selected === c) studioBaseId = id;
    });
  });

  // Live studio previews for the focused team — object URLs keyed by
  // template id, so platforms sharing a template share one render and
  // each platform's mockup shows its own design.
  let studioPreviews = $state<Record<number, string | null>>({});
  let studioPreviewBusy = $state(false);
  $effect(() => {
    const c = selected;
    const proj = projectName;
    void focalSeq;
    const wanted =
      imageSource === 'studio' && c
        ? [...new Set(platforms.map((p) => templateFor(p)?.id).filter((x): x is number => x != null))]
        : [];
    if (wanted.length === 0) {
      // untrack + guard, and both halves are load-bearing. Reading
      // studioPreviews here made it a dependency of this effect, and assigning
      // a fresh {} re-dirtied that dependency on every run — an effect that
      // woke itself forever. Svelte gave up with effect_update_depth_exceeded
      // and tore down the reactive graph, which is why the source buttons and
      // every filter on this page silently stopped responding. `wanted` is
      // empty whenever nothing is selected — i.e. on load — so the editor was
      // already dead by the time it finished rendering.
      const open = untrack(() => studioPreviews);
      if (Object.keys(open).length > 0) {
        for (const u of Object.values(open)) if (u) URL.revokeObjectURL(u);
        studioPreviews = {};
      }
      return;
    }
    let cancelled = false;
    studioPreviewBusy = true;
    const snapC = $state.snapshot(c!) as CampaignCandidate;
    Promise.all(
      wanted.map((tid) => {
        const t = data.studioTemplates.find((x) => x.id === tid)!;
        return renderCandidatePreviewUrl(t, snapC, proj).then(
          (url) => [tid, url] as const,
          (e) => {
            if (!cancelled) errorMsg = formatError(e);
            return [tid, null] as const;
          }
        );
      })
    )
      .then((pairs) => {
        if (cancelled) {
          for (const [, u] of pairs) if (u) URL.revokeObjectURL(u);
          return;
        }
        for (const u of Object.values(studioPreviews)) if (u) URL.revokeObjectURL(u);
        studioPreviews = Object.fromEntries(pairs);
      })
      .finally(() => {
        if (!cancelled) studioPreviewBusy = false;
      });
    return () => {
      cancelled = true;
    };
  });

  /** Spin up a Studio template pre-linked to this campaign and jump
   *  into the builder to design it. */
  let creatingTemplate = $state(false);
  async function newStudioTemplate() {
    creatingTemplate = true;
    errorMsg = null;
    try {
      const t = await createImageTemplate({
        name: `${name || 'Campaign'} graphic`,
        status: 'draft',
        width: 1080,
        height: 1080,
        source_collection: source,
        filters: currentFilters(),
        layers: [newLayer('base'), newLayer('text')]
      });
      studioTemplateId = t.id;
      await updateCampaign(data.campaign.id, { image_template_id: t.id });
      await goto(`/tools/studio/${t.id}`);
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      creatingTemplate = false;
    }
  }

  function bestGalleryFile(photos: GalleryPhoto[]): string | null {
    const group = photos.find(
      (p) => typeof p.type_id === 'object' && /group/i.test((p.type_id as { name?: string })?.name ?? '')
    );
    return (group ?? photos[0])?.file_id ?? null;
  }

  const effectiveImageId = $derived(
    customImageId ??
      (imageSource === 'gallery'
        ? (bestGalleryFile(galleryPhotos) ?? selected?.imageId ?? null)
        : (selected?.imageId ?? null))
  );

  // ── Multi-select (batch) ────────────────────────────────────────
  // Tapping a card toggles it in/out of the batch; the most recently
  // added one is the preview sample. Select all sweeps the whole
  // filtered cohort.
  let selectedKeys = $state<Set<string>>(new Set());
  const selCount = $derived(selectedKeys.size);
  let batchBusy = $state<CampaignPlatform | null>(null);
  let batchProgress = $state('');

  function focusCandidate(c: CampaignCandidate) {
    selected = c;
    showUrlInput = false;
    galleryPhotos = [];
    // Load the candidate's photo gallery so the "gallery" image source
    // and the strip can offer it. Orgs → org photos; events → the
    // event's own photo gallery (great for throwbacks).
    const loader =
      c.collection === 'organization'
        ? listOrgPhotos(c.id)
        : c.collection === 'event'
          ? listEventPhotos(c.id)
          : null;
    if (loader) {
      loader
        .then((ph) => {
          if (selected?.id === c.id && selected.collection === c.collection) {
            galleryPhotos = (ph as GalleryPhoto[]).filter((g) => !!g.file_id);
          }
        })
        .catch(() => {});
    }
  }

  function pickCandidate(c: CampaignCandidate) {
    const key = itemKey(c.collection, c.id);
    const next = new Set(selectedKeys);
    if (next.has(key)) {
      next.delete(key);
      if (selected && itemKey(selected.collection, selected.id) === key) {
        const fallback = candidates.find((x) => next.has(itemKey(x.collection, x.id))) ?? null;
        if (fallback) focusCandidate(fallback);
        else selected = null;
      }
    } else {
      next.add(key);
      focusCandidate(c);
    }
    selectedKeys = next;
  }

  // ── Preview navigation across the batch ─────────────────────────
  const selectedList = $derived(
    candidates.filter((c) => selectedKeys.has(itemKey(c.collection, c.id)))
  );
  const focusIndex = $derived(
    selected
      ? selectedList.findIndex(
          (c) => c.id === selected!.id && c.collection === selected!.collection
        )
      : -1
  );
  function goTo(i: number) {
    if (selectedList.length === 0) return;
    const n = (i + selectedList.length) % selectedList.length;
    focusCandidate(selectedList[n]);
  }
  let previewTouchX: number | null = null;
  function onPreviewTouchStart(e: TouchEvent) {
    previewTouchX = e.touches[0]?.clientX ?? null;
  }
  function onPreviewTouchEnd(e: TouchEvent) {
    if (previewTouchX === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? previewTouchX) - previewTouchX;
    previewTouchX = null;
    if (Math.abs(dx) > 60 && selCount > 1) goTo(focusIndex + (dx < 0 ? 1 : -1));
  }

  function selectAll() {
    selectedKeys = new Set(candidates.map((c) => itemKey(c.collection, c.id)));
    if (!selected && candidates.length > 0) focusCandidate(candidates[0]);
  }
  function clearSelection() {
    selectedKeys = new Set();
    selected = null;
  }

  // Studio renders are cached per template×team for the session, so
  // generating the same team for a second platform reuses the file
  // instead of rendering + uploading a duplicate.
  const studioRendered = new Map<string, string>();

  // ── One-click batch + queue ─────────────────────────────────────
  // Continue creates one draft per team per platform (each platform
  // using its own template); the batch can then be queued into Buffer
  // in one click, optionally spread evenly across a date window —
  // one slot per team (10:00 local), all of a team's platforms
  // posting together.
  let batchIds = $state<number[]>([]);
  let creatingBatch = $state(false);
  let batchCreateProgress = $state('');
  let scheduleFrom = $state(data.campaign.schedule?.from ?? '');
  let scheduleTo = $state(data.campaign.schedule?.to ?? '');

  async function createFullBatch() {
    const items = selectedList;
    if (items.length === 0 || platforms.length === 0) return;
    creatingBatch = true;
    errorMsg = null;
    const made: number[] = [];
    const total = items.length * platforms.length;
    let done = 0;
    batchCreateProgress = `0/${total}`;
    try {
      for (const c of items) {
        for (const p of platforms) {
          const imgId = await imageIdFor(c, p);
          const post = await createCampaignPost({
            campaign_id: data.campaign.id,
            item_collection: c.collection,
            item_id: String(c.id),
            item_label: c.name,
            platform: p,
            status: 'draft',
            rendered_text: renderedFor(c, p),
            image_id: imgId
          });
          posts = [post, ...posts];
          made.push(post.id);
          done++;
          batchCreateProgress = `${done}/${total}`;
        }
      }
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      batchIds = [...batchIds, ...made];
      creatingBatch = false;
      batchCreateProgress = '';
    }
  }

  /** Evenly spread the batch's teams across [from, to] at 10:00 local;
   *  a team's posts on every platform share its slot. No window set →
   *  null slots (Buffer's own queue decides). */
  function slotsForQueue(items: CampaignPost[]): Map<string, Date | null> {
    const teams: string[] = [];
    for (const p of items) {
      const k = `${p.item_collection}:${p.item_id}`;
      if (!teams.includes(k)) teams.push(k);
    }
    const out = new Map<string, Date | null>();
    if (!scheduleFrom) {
      teams.forEach((k) => out.set(k, null));
      return out;
    }
    const from = new Date(`${scheduleFrom}T10:00:00`);
    const to = scheduleTo ? new Date(`${scheduleTo}T10:00:00`) : from;
    const end = to > from ? to : from;
    teams.forEach((k, i) => {
      const t =
        teams.length > 1
          ? new Date(from.getTime() + ((end.getTime() - from.getTime()) * i) / (teams.length - 1))
          : from;
      out.set(k, t);
    });
    return out;
  }

  let queueing = $state(false);
  let queueProgress = $state('');
  // Takes an explicit list so the same path serves "queue the whole batch"
  // and "queue the four I ticked". One implementation, so the scheduling slots,
  // the Instagram image guard and the failure report cannot drift apart.
  async function queueBatch(
    itemsIn?: CampaignPost[],
    mode: 'addToQueue' | 'shareNow' = 'addToQueue'
  ) {
    const items = itemsIn ?? queueablePosts;
    if (items.length === 0) return;
    queueing = true;
    errorMsg = null;
    // Publishing now means NO slot. The spread that slotsForQueue computes is
    // the whole problem being avoided — it is what puts a story at 03:08, where
    // it expires unseen before anyone is awake.
    const now = mode === 'shareNow';
    const slots = now ? new Map<string, Date | null>() : slotsForQueue(items);
    let done = 0;
    queueProgress = `0/${items.length}`;
    const failures: string[] = [];
    for (const p of items) {
      try {
        const platform = (p.platform ?? 'general') as string;
        const channel = bufferChannelFor(platform);
        if (!channel) continue;
        if ((platformService(platform) === 'instagram' || isStoryPlatform(platform)) && !p.image_id) {
          // A story is image-only — with no image there is nothing to publish
          // at all, on either service.
          throw new Error(
            isStoryPlatform(platform) ? 'A story needs an image' : 'Instagram needs an image'
          );
        }
        const slot = slots.get(`${p.item_collection}:${p.item_id}`) ?? null;
        const queued = await queueToBuffer({
          channelId: channel.id,
          text: p.rendered_text ?? '',
          platform,
          imageId: p.image_id,
          altText: p.item_label ?? undefined,
          scheduledAt: now ? null : slot ? slot.toISOString() : null,
          mode: now ? 'shareNow' : undefined
        });
        // Buffer's own dueAt wins over the slot twin asked for. For a post
        // dropped into the channel's automatic queue there IS no slot on this
        // side — Buffer decides it — which is why a queued post could only ever
        // say "used on <date>" before. Now the row shows when it actually goes out.
        const patch: Partial<CampaignPost> = {
          buffer_post_id: queued.id,
          buffered_at: new Date().toISOString(),
          scheduled_for: queued.dueAt ?? (slot ? slot.toISOString() : null),
          status: 'used',
          used_at: new Date().toISOString()
        };
        await updateCampaignPost(p.id, patch);
        posts = posts.map((x) => (x.id === p.id ? { ...x, ...patch } : x));
      } catch (e) {
        failures.push(`${p.item_label} (${p.platform}): ${formatError(e)}`);
      }
      done++;
      queueProgress = `${done}/${items.length}`;
    }
    queueing = false;
    queueProgress = '';
    if (failures.length > 0) errorMsg = `Some posts failed to queue — ${failures.join(' · ')}`;
  }

  /** Resolve the post image for one team + platform from the policy:
   *  manual pick > that platform's studio render > gallery > record. */
  async function imageIdFor(c: CampaignCandidate, platform: CampaignPlatform): Promise<string | null> {
    const manual = customImages[itemKey(c.collection, c.id)];
    if (manual) return manual;
    if (imageSource === 'studio') {
      const t = templateFor(platform);
      if (!t) return null;
      const key = `${t.id}:${itemKey(c.collection, c.id)}`;
      let fileId = studioRendered.get(key);
      if (!fileId) {
        fileId = await renderCandidateToDirectus(
          t,
          $state.snapshot(c) as CampaignCandidate,
          projectName
        );
        studioRendered.set(key, fileId);
      }
      return fileId;
    }
    if (imageSource === 'gallery' && (c.collection === 'organization' || c.collection === 'event')) {
      try {
        const raw = c.collection === 'organization' ? await listOrgPhotos(c.id) : await listEventPhotos(c.id);
        const ph = (raw as GalleryPhoto[]).filter((g) => !!g.file_id);
        return bestGalleryFile(ph) ?? c.imageId;
      } catch {
        // gallery unreachable — record image is still right
      }
    }
    return c.imageId;
  }

  /** Create one draft post per selected team for a platform, resolving
   *  the image per team from the image-source policy. No clipboard —
   *  briefs are copied per post from the Generated posts list. */
  async function batchGenerate(platform: CampaignPlatform) {
    const items = candidates.filter((c) => selectedKeys.has(itemKey(c.collection, c.id)));
    if (items.length === 0) return;
    batchBusy = platform;
    errorMsg = null;
    let done = 0;
    batchProgress = `0/${items.length}`;
    try {
      for (const c of items) {
        const imgId = await imageIdFor(c, platform);
        const post = await createCampaignPost({
          campaign_id: data.campaign.id,
          item_collection: c.collection,
          item_id: String(c.id),
          item_label: c.name,
          platform,
          status: 'draft',
          rendered_text: renderedFor(c, platform),
          image_id: imgId
        });
        posts = [post, ...posts];
        done++;
        batchProgress = `${done}/${items.length}`;
      }
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      batchBusy = null;
      batchProgress = '';
    }
  }

  async function uploadCustomImage(file: File) {
    uploadingImage = true;
    errorMsg = null;
    try {
      setCustomImage(
        await uploadFile(file, { title: `${selected?.name ?? 'post'} — campaign image` })
      );
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      uploadingImage = false;
    }
  }

  async function importImageUrl() {
    const url = imageUrlInput.trim();
    if (!url) return;
    uploadingImage = true;
    errorMsg = null;
    try {
      const { id } = await uploadFromUrl(url, {
        title: `${selected?.name ?? 'post'} — campaign image`,
        maxEdge: 1600
      });
      setCustomImage(id);
      imageUrlInput = '';
      showUrlInput = false;
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      uploadingImage = false;
    }
  }

  async function loadCandidates() {
    loadingCandidates = true;
    errorMsg = null;
    try {
      candidates = await listCampaignCandidates(source, currentFilters(), language);
      candidatesLoaded = true;
      visibleCount = CANDIDATE_PAGE;
      selectedKeys = new Set(
        [...selectedKeys].filter((k) => candidates.some((c) => itemKey(c.collection, c.id) === k))
      );
      if (selected && !candidates.some((c) => c.id === selected!.id && c.collection === selected!.collection)) {
        selected = null;
      }
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      loadingCandidates = false;
    }
  }

  // ── Posts (rotation memory) ─────────────────────────────────────
  let posts = $state<CampaignPost[]>([...data.posts]);
  const itemKey = (collection: string, id: number | string) => `${collection}:${id}`;
  const usedKeys = $derived(
    new Set(
      posts
        .filter((p) => p.status === 'used')
        .map((p) => itemKey(p.item_collection ?? '', p.item_id ?? ''))
    )
  );
  const draftedKeys = $derived(
    new Set(posts.map((p) => itemKey(p.item_collection ?? '', p.item_id ?? '')))
  );
  // The session's Continue-batch (created above) and its queueable
  // subset — declared here so they read `posts` after its declaration.
  const batchPosts = $derived(posts.filter((p) => batchIds.includes(p.id)));
  const queueablePosts = $derived(
    batchPosts.filter(
      (p) => !p.buffer_post_id && p.platform !== 'general' && !!bufferChannelFor(p.platform ?? '')
    )
  );

  /** Can this post go to Buffer at all — regardless of which batch it came
   *  from? The Generated-posts list outlives a session, and a draft from last
   *  week is exactly the thing you want to tick alongside today's. */
  const isQueueable = (p: CampaignPost) =>
    !p.buffer_post_id && p.platform !== 'general' && !!bufferChannelFor(p.platform ?? '');

  // Ticked posts, by id. Reassigned rather than mutated so Svelte sees it.
  let queueSel = $state<Set<number>>(new Set());
  const queueSelPosts = $derived(posts.filter((p) => queueSel.has(p.id) && isQueueable(p)));
  function toggleQueueSel(id: number) {
    const n = new Set(queueSel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    queueSel = n;
  }
  async function queueSelected(mode: 'addToQueue' | 'shareNow' = 'addToQueue') {
    const items = queueSelPosts;
    if (items.length === 0) return;
    if (mode === 'shareNow' && !confirm(
      `Publish ${items.length} post${items.length === 1 ? '' : 's'} to Buffer RIGHT NOW? This goes out immediately — it is not scheduled and cannot be un-sent from twin.`
    )) return;
    await queueBatch(items, mode);
    // Drop the ones that made it; anything that failed stays ticked so the
    // retry is one click rather than a re-hunt through the list.
    queueSel = new Set(
      [...queueSel].filter((id) => {
        const p = posts.find((x) => x.id === id);
        return p ? isQueueable(p) : false;
      })
    );
  }

  // ── Preview + brief ─────────────────────────────────────────────
  const projectName = $derived.by(() => {
    const first = [...selectedProjectIds][0];
    return first != null ? (data.projects.find((p) => p.id === first)?.name ?? null) : null;
  });

  function renderedFor(c: CampaignCandidate, platform: CampaignPlatform): string {
    const tpl = campaignTemplateFor(
      { ...data.campaign, base_template: baseTemplate, platform_overrides: overrides },
      platform
    );
    return renderCampaignTemplate(tpl, c, { projectName });
  }

  /** Turn an edited preview text back into a template: the selected
   *  candidate's values are re-abstracted to {tokens} (longest value
   *  first, so a description containing the name still wins), making
   *  the edit hold when the rotation moves to the next team. */
  function reverseTemplate(edited: string, c: CampaignCandidate): string {
    const subs: Array<[string, string]> = (
      [
        [c.description?.trim() || c.descriptionAlt || '', '{description}'],
        [c.name, '{name}'],
        [c.nickname ?? '', '{nickname}'],
        [c.website ?? '', '{website}'],
        [projectName ?? '', '{project}']
      ] as Array<[string, string]>
    ).filter(([v]) => v.trim().length >= 3);
    subs.sort((a, b) => b[0].length - a[0].length);
    let out = edited;
    for (const [v, tok] of subs) out = out.split(v).join(tok);
    return out;
  }

  /** Caption edited inside a preview → that platform's override.
   *  Editing back to the base text (or to empty) clears the override. */
  function applyPreviewEdit(platform: CampaignPlatform, edited: string) {
    if (!selected) return;
    const tmpl = reverseTemplate(edited, selected);
    if (!edited.trim() || tmpl.trim() === baseTemplate.trim()) {
      const next = { ...overrides };
      delete next[platform];
      overrides = next;
    } else {
      overrides = { ...overrides, [platform]: tmpl };
    }
    markDirty();
  }

  function resetOverride(platform: CampaignPlatform) {
    const next = { ...overrides };
    delete next[platform];
    overrides = next;
    markDirty();
  }

  function briefFor(
    c: CampaignCandidate,
    platform: CampaignPlatform,
    postId?: number,
    imageId?: string | null
  ): string {
    const resolved = imageId !== undefined ? imageId : effectiveImageId;
    const img = resolved ? assetUrl(resolved) : null;
    return [
      `## Social post brief — ${name || 'Evergreen campaign'} · ${CAMPAIGN_PLATFORM_LABEL[platform]}`,
      '',
      `**Platform:** ${CAMPAIGN_PLATFORM_LABEL[platform]}`,
      `**Image:** ${img ?? 'none — pick or generate one'}`,
      '',
      '**Post text (publish verbatim):**',
      '',
      renderedFor(c, platform),
      '',
      '---',
      `Source: ${c.collection} #${c.id} — ${c.name}` +
        (postId ? ` · twin campaign #${data.campaign.id}, post #${postId}` : ''),
      'Instructions: download the image from the URL above and publish the post text unchanged to the platform via the matching connector.'
    ].join('\n');
  }

  let generating = $state<string | null>(null); // platform being generated
  let copiedFlash = $state<string | null>(null);
  // When the clipboard is unavailable (permissions, unfocused tab) the
  // brief still has to reach the user — render it for manual copy.
  let briefFallback = $state<string | null>(null);

  async function copyText(text: string, flashKey: string) {
    try {
      await navigator.clipboard.writeText(text);
      briefFallback = null;
      copiedFlash = flashKey;
      setTimeout(() => (copiedFlash = null), 2000);
    } catch {
      briefFallback = text;
    }
  }

  async function generateAndCopy(c: CampaignCandidate, platform: CampaignPlatform) {
    generating = platform;
    errorMsg = null;
    try {
      const imgId = await imageIdFor(c, platform);
      const post = await createCampaignPost({
        campaign_id: data.campaign.id,
        item_collection: c.collection,
        item_id: String(c.id),
        item_label: c.name,
        platform,
        status: 'draft',
        rendered_text: renderedFor(c, platform),
        image_id: imgId
      });
      posts = [post, ...posts];
      await copyText(briefFor(c, platform, post.id, imgId), platform);
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      generating = null;
    }
  }

  async function copyBriefForPost(p: CampaignPost) {
    const img = p.image_id ? assetUrl(p.image_id) : null;
    const platform = (p.platform ?? 'general') as CampaignPlatform;
    const text = [
      `## Social post brief — ${name || 'Evergreen campaign'} · ${CAMPAIGN_PLATFORM_LABEL[platform] ?? p.platform}`,
      '',
      `**Image:** ${img ?? 'none'}`,
      '',
      '**Post text (publish verbatim):**',
      '',
      p.rendered_text ?? '',
      '',
      '---',
      `Source: ${p.item_collection} #${p.item_id} — ${p.item_label} · twin campaign #${data.campaign.id}, post #${p.id}`,
      'Instructions: download the image from the URL above and publish the post text unchanged to the platform via the matching connector.'
    ].join('\n');
    await copyText(text, `post-${p.id}`);
  }

  async function setPostStatus(p: CampaignPost, s: 'used' | 'skipped' | 'draft') {
    try {
      const patch: Partial<CampaignPost> = {
        status: s,
        used_at: s === 'used' ? new Date().toISOString() : null
      };
      const updated = await updateCampaignPost(p.id, patch);
      posts = posts.map((x) => (x.id === p.id ? { ...x, ...updated } : x));
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  async function removePost(p: CampaignPost) {
    try {
      await deleteCampaignPost(p.id);
      posts = posts.filter((x) => x.id !== p.id);
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  // ── Buffer queueing ─────────────────────────────────────────────
  // Channel resolution: the campaign's posting identity carries a
  // default channel per platform; otherwise the first connected
  // channel of that service. 'general' has no service — no button.
  function bufferChannelFor(platform: string): BufferChannel | null {
    // A story posts through its feed sibling's channel — instagram_story and
    // instagram are the same account, so the identity mapping is keyed by
    // service, not by platform variant.
    const service = platformService(platform);
    const fromIdentity = identity?.channels?.[service];
    if (fromIdentity) {
      const c = data.bufferChannels.find((x) => x.id === fromIdentity);
      if (c && !c.is_disconnected) return c;
    }
    return (
      data.bufferChannels.find((c) => c.service === service && !c.is_disconnected) ?? null
    );
  }

  let buffering = $state<number | null>(null); // post id in flight

  async function queuePost(p: CampaignPost) {
    const platform = (p.platform ?? 'general') as string;
    const channel = bufferChannelFor(platform);
    if (!channel) return;
    if ((platformService(platform) === 'instagram' || isStoryPlatform(platform)) && !p.image_id) {
      errorMsg = isStoryPlatform(platform)
        ? 'A story needs an image — this post has none.'
        : 'Instagram needs an image — this post has none.';
      return;
    }
    buffering = p.id;
    errorMsg = null;
    try {
      const queued = await queueToBuffer({
        channelId: channel.id,
        text: p.rendered_text ?? '',
        platform,
        imageId: p.image_id,
        altText: p.item_label ?? undefined
      });
      const patch: Partial<CampaignPost> = {
        buffer_post_id: queued.id,
        buffered_at: new Date().toISOString(),
        // Same as the batch path: Buffer assigns the queue slot, so this is
        // the only place the publish time exists.
        scheduled_for: queued.dueAt ?? null,
        status: 'used',
        used_at: new Date().toISOString()
      };
      await updateCampaignPost(p.id, patch);
      posts = posts.map((x) => (x.id === p.id ? { ...x, ...patch } : x));
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      buffering = null;
    }
  }

  // Roles applicable to the current source ('both' always shows).
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

  // "More filters" disclosure — requirements + date window live here;
  // open by default only when one of them is already active.
  let moreFiltersOpen = $state(
    !!f.requireImage || !!f.requireDescription || !!f.dateFrom || !!f.dateTo
  );
  const moreFiltersActive = $derived(
    [requireImage, requireDescription, !!dateFrom || !!dateTo].filter(Boolean).length
  );

  function toggleTag(id: number) {
    const n = new Set(selectedTagIds);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    selectedTagIds = n;
    markDirty();
  }
  function togglePlatform(p: CampaignPlatform) {
    platforms = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p];
    markDirty();
  }

  // ── Linear flow ─────────────────────────────────────────────────
  // Two stages: 'select' (filters + live candidates, pick your teams)
  // and 'compose' (platforms, template, previews, queue). The whole
  // selection stage minimises to a summary bar while composing.
  let stage = $state<'select' | 'compose'>('select');

  // Tag autocomplete (replaces the tag cloud).
  let tagQuery = $state('');
  const tagMatches = $derived.by(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return [];
    return data.tags
      .filter((t) => !selectedTagIds.has(t.id) && (t.name ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  });

  // At least one NARROWING filter before we fetch — source/language
  // alone would sweep the whole database (4 000+ orgs).
  const hasAnyFilter = $derived(
    selectedProjectIds.size > 0 ||
      selectedTagIds.size > 0 ||
      !!search.trim() ||
      requireImage ||
      requireDescription ||
      !!dateFrom ||
      !!dateTo
  );

  // Render cap — big result sets show the first page with a count of
  // the rest; Select all still covers every match.
  const CANDIDATE_PAGE = 24;
  let visibleCount = $state(CANDIDATE_PAGE);

  // Candidates auto-fetch: any filter change refreshes the list after a
  // short debounce, so the matches visibly grow/shrink while filtering.
  let autoFetchTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    void source; void language; void search;
    void requireImage; void requireDescription;
    void dateFrom; void dateTo;
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

  // ── Collapsible setup steps ─────────────────────────────────────
  // A campaign that already has a template opens with steps 1–2
  // folded — the summary chips in each header keep the configuration
  // readable without the full controls. A fresh campaign opens
  // expanded so setup flows top-to-bottom.
  const startConfigured = !!data.campaign.base_template?.trim();
  let step1Open = $state(!startConfigured);
  let step2Open = $state(!startConfigured);

  const SOURCE_LABEL_MAP: Record<string, string> = {
    organization: 'Organizations',
    Person: 'People',
    Project: 'Projects'
  };

  const step1Chips = $derived.by(() => {
    const chips: string[] = [SOURCE_LABEL_MAP[source] ?? source];
    chips.push(language === 'en' ? 'English' : 'Íslenska');
    if (selectedProjectIds.size > 0) {
      if (selectedProjectIds.size <= 2) {
        chips.push(
          [...selectedProjectIds]
            .map((id) => data.projects.find((p) => p.id === id)?.name ?? `#${id}`)
            .join(', ')
        );
      } else {
        chips.push(`${selectedProjectIds.size} projects`);
      }
    }
    if (selectedProjectIds.size > 0 && selectedRoles.size > 0) {
      chips.push(
        [...selectedRoles]
          .map((k) => data.projectRoles.find((r) => r.key === k)?.label ?? k)
          .join(', ')
      );
    }
    if (selectedTagIds.size > 0) chips.push(`${selectedTagIds.size} tag${selectedTagIds.size === 1 ? '' : 's'}`);
    if (search.trim()) chips.push(`“${search.trim()}”`);
    if (requireImage) chips.push('needs image');
    if (requireDescription) chips.push('needs description');
    if (dateFrom || dateTo) chips.push(`added ${dateFrom || '…'} – ${dateTo || '…'}`);
    return chips;
  });

  const step2Chips = $derived.by(() => {
    const chips: string[] = [];
    chips.push(
      platforms.length > 0
        ? platforms.map((p) => CAMPAIGN_PLATFORM_LABEL[p]).join(', ')
        : 'no platforms'
    );
    if (identity?.name) chips.push(identity.name);
    chips.push(baseTemplate.trim() ? 'template ✓' : 'no template yet');
    const customized = CAMPAIGN_PLATFORMS.filter((p) => overrides[p]?.trim()).length;
    if (customized > 0) chips.push(`${customized} customized`);
    return chips;
  });

  let templateEl: HTMLTextAreaElement | undefined = $state();
  function insertToken(tok: string) {
    const ins = `{${tok}}`;
    if (templateEl) {
      const s = templateEl.selectionStart ?? baseTemplate.length;
      const e = templateEl.selectionEnd ?? baseTemplate.length;
      baseTemplate = baseTemplate.slice(0, s) + ins + baseTemplate.slice(e);
    } else {
      baseTemplate += ins;
    }
    markDirty();
  }

  const SOURCE_OPTIONS: Array<[CampaignSource, string]> = [
    ['organization', 'Organizations'],
    ['Person', 'People'],
    ['Project', 'Projects'],
    ['event', 'Events']
  ];
  const fmtDate = (iso?: string | null) =>
    iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '';
  /** A scheduled slot needs its time — "3 Sep" does not tell you whether the
   *  post has already gone out today. */
  const fmtWhen = (iso?: string | null) =>
    iso
      ? new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(iso))
      : '';
</script>

<svelte:head><title>{name || 'Campaign'} · Evergreen · Tools</title></svelte:head>

<section class="mx-auto max-w-3xl space-y-5 pb-16">
  <!-- Header -->
  <header class="space-y-2">
    <a href="/tools/evergreen" class="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700">
      <Icon name="chevron-left" size={12} /> Evergreen machine
    </a>
    <div class="flex items-start justify-between gap-3">
      <input
        class="input w-full max-w-md font-display text-xl font-bold"
        style="letter-spacing: -0.02em;"
        placeholder="Campaign name"
        bind:value={name}
        oninput={markDirty}
      />
      <div class="flex shrink-0 items-center gap-2">
        <button class="btn-ghost !px-2 text-xs" title="Duplicate campaign" onclick={duplicate}>
          <Icon name="copy" size={15} />
        </button>
        <button class="btn-primary" disabled={saving || !dirty} onclick={save}>
          {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <select class="input !w-auto text-xs" bind:value={status} onchange={markDirty}>
        <option value="draft">Draft</option>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>
      <input
        class="input w-full text-xs"
        placeholder="Internal note — what is this campaign for?"
        bind:value={description}
        oninput={markDirty}
      />
    </div>
    {#if data.mkCampaigns?.length}
      <div class="flex items-center gap-2 text-xs text-ink-500">
        <span>Part of marketing campaign</span>
        <select class="input !w-auto !py-1 text-xs" bind:value={mkCampaignId} onchange={markDirty}>
          <option value="">— none —</option>
          {#each data.mkCampaigns as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
        </select>
        <span class="text-ink-400">— shows this content's posts on that campaign's workbench.</span>
      </div>
    {/if}
  </header>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-3 text-sm" style="color: #C0392B;">{errorMsg}</div>
  {/if}

  {#if briefFallback}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-3 space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-xs text-ink-500">Clipboard unavailable — copy the brief manually:</span>
        <button class="btn-ghost !px-2 text-xs" onclick={() => (briefFallback = null)}><Icon name="x" size={13} /></button>
      </div>
      <textarea class="input w-full font-mono text-xs" rows="10" readonly>{briefFallback}</textarea>
    </div>
  {/if}

  {#snippet stepBadge(num: number)}
    <span
      class="font-display grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold"
      style="background: var(--accent-electric); color: var(--accent-text);"
    >{num}</span>
  {/snippet}

  <!-- Collapsible step header: number badge + title, and when folded a
       row of summary chips so the configuration stays readable. -->
  {#snippet stepHeader(num: number, title: string, chips: string[], open: boolean, toggle: () => void)}
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-hover"
      aria-expanded={open}
      onclick={toggle}
    >
      {@render stepBadge(num)}
      <span class="min-w-0 flex-1">
        <span class="font-display block text-[10px] uppercase tracking-wider text-ink-700" style="letter-spacing: 0.12em;">{title}</span>
        {#if !open && chips.length > 0}
          <span class="mt-1.5 flex flex-wrap gap-1">
            {#each chips as chip (chip)}
              <span class="max-w-full truncate rounded-full px-2 py-0.5 text-[10px]" style="background: var(--bg-tertiary); color: var(--text-secondary);">{chip}</span>
            {/each}
          </span>
        {/if}
      </span>
      <Icon
        name="chevron-right"
        size={14}
        class="shrink-0 text-ink-300 transition-transform duration-200 {open ? 'rotate-90' : ''}"
      />
    </button>
  {/snippet}

  {#if stage === 'select'}
  <!-- 1 · Source & filters -->
  <div class="overflow-hidden rounded-[14px] border border-surface-border bg-surface-card">
    {@render stepHeader(1, 'Source & filters', step1Chips, step1Open, () => (step1Open = !step1Open))}
    {#if step1Open}
    <div class="space-y-4 px-4 pb-4" transition:slide={{ duration: 200 }}>

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
          class="font-display flex-1 px-2 py-1 text-[11px] font-medium transition"
          style={source === k
            ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: calc(var(--radius-md) - 2px); letter-spacing: 0.04em;'
            : 'background: transparent; color: var(--text-secondary); letter-spacing: 0.04em;'}
          onclick={() => { source = k; candidatesLoaded = false; candidates = []; selected = null; markDirty(); }}
        >{label}</button>
      {/each}
    </div>

    <!-- Language drives which description {description} resolves to
         (falls back to the other language when the preferred is empty;
         "Needs description" filters strictly in this language). -->
    <div class="flex items-center gap-2">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Language</span>
      <div
        class="inline-flex p-0.5"
        role="radiogroup"
        aria-label="Campaign language"
        style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
      >
        {#each [['is', 'Íslenska'], ['en', 'English']] as const as [k, label] (k)}
          <button
            type="button"
            role="radio"
            aria-checked={language === k}
            class="font-display px-3 py-1 text-[11px] font-medium transition"
            style={language === k
              ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: calc(var(--radius-md) - 2px); letter-spacing: 0.04em;'
              : 'background: transparent; color: var(--text-secondary); letter-spacing: 0.04em;'}
            onclick={() => { language = k; candidatesLoaded = false; candidates = []; selected = null; markDirty(); }}
          >{label}</button>
        {/each}
      </div>
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
          <!-- Role on the project link — participants vs sponsors vs hosts. -->
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
                  class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition"
                  style="background-color: rgba(44,140,153,0.12); color: var(--brand, #2C8C99); border-color: rgba(44,140,153,0.45);"
                  title="Remove tag"
                  onclick={() => toggleTag(t.id)}
                >{t.name}<Icon name="x" size={10} /></button>
              {/each}
            </div>
          {/if}
          <div class="relative">
            <input
              class="input w-full"
              placeholder="Search tags…"
              bind:value={tagQuery}
            />
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
      </div>
    </div>

    <div>
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-2 text-left"
        aria-expanded={moreFiltersOpen}
        onclick={() => (moreFiltersOpen = !moreFiltersOpen)}
      >
        <Icon
          name="chevron-right"
          size={12}
          class="shrink-0 text-ink-300 transition-transform duration-200 {moreFiltersOpen ? 'rotate-90' : ''}"
        />
        <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">More filters</span>
        {#if moreFiltersActive > 0}
          <span class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold" style="background: rgba(44,140,153,0.12); color: var(--brand, #2C8C99);">{moreFiltersActive} active</span>
        {/if}
      </button>
      {#if moreFiltersOpen}
        <div class="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 pl-5" transition:slide={{ duration: 150 }}>
          <label class="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" bind:checked={requireImage} onchange={markDirty} />
            Needs image
          </label>
          <label class="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" bind:checked={requireDescription} onchange={markDirty} />
            Needs description
          </label>
          <label class="flex items-center gap-1.5 text-xs text-ink-500">
            Added
            <input type="date" class="input !py-1 text-xs" bind:value={dateFrom} onchange={markDirty} />
            –
            <input type="date" class="input !py-1 text-xs" bind:value={dateTo} onchange={markDirty} />
          </label>
        </div>
      {/if}
    </div>

    </div>
    {/if}
  </div>

  <!-- 3 · Candidates -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-3">
    <div class="flex items-center justify-between gap-3">
      <span class="flex min-w-0 items-center gap-3">
        {@render stepBadge(2)}
        <span class="font-display text-[10px] uppercase tracking-wider text-ink-700" style="letter-spacing: 0.12em;">Candidates</span>
      </span>
      {#if loadingCandidates}
        <span class="text-[11px] text-ink-400">Updating…</span>
      {/if}
    </div>

    {#if !hasAnyFilter}
      <div class="py-4 text-center text-xs text-ink-400">
        Add a filter above — a project, tag, search or requirement — and matching teams appear here automatically.
      </div>
    {:else if candidatesLoaded}
      <div
        class="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500"
        style:opacity={loadingCandidates ? 0.6 : 1}
      >
        <span>
          {candidates.length} match{candidates.length === 1 ? '' : 'es'} ·
          {candidates.filter((c) => !usedKeys.has(itemKey(c.collection, c.id))).length} not yet featured
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
            <!-- min-w-0 is load-bearing: a grid item defaults to
                 min-width:auto and will not shrink below its content, and
                 `truncate` sets white-space:nowrap, so one org with a long
                 description stretched every card to 2173px inside a 631px
                 viewport and the whole page scrolled sideways. The inner span's
                 min-w-0 is not enough — the shrink has to be allowed on the
                 grid item itself. -->
            <li class="min-w-0">
              <button
                type="button"
                class="relative flex w-full min-w-0 items-start gap-2.5 rounded-md border px-3 py-2 text-left transition hover:bg-surface-hover"
                style:border-color={isSel ? 'var(--accent-electric)' : 'var(--surface-border)'}
                aria-pressed={isSel}
                onclick={() => pickCandidate(c)}
              >
                {#if isSel}
                  <span
                    class="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full text-white"
                    style="background: var(--accent-electric);"
                  ><Icon name="check" size={11} /></span>
                {/if}
                {#if c.imageId}
                  <img src={assetUrl(c.imageId, { width: 80, height: 80, fit: 'contain' })} alt="" class="h-10 w-10 shrink-0 rounded object-contain" style="background: var(--bg-tertiary);" />
                {:else}
                  <span class="grid h-10 w-10 shrink-0 place-items-center rounded text-ink-300" style="background: var(--bg-tertiary);"><Icon name="building" size={16} /></span>
                {/if}
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1.5">
                    <span class="truncate text-sm font-medium text-ink-900">{c.name}</span>
                    {#if usedKeys.has(key)}
                      <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style="background: rgba(34,160,90,0.14); color: #1B8A4B;">featured</span>
                    {:else if draftedKeys.has(key)}
                      <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style="background: var(--bg-tertiary); color: var(--text-secondary);">drafted</span>
                    {/if}
                  </span>
                  <span class="mt-0.5 block truncate text-[11px] text-ink-500">{c.description ?? 'No description'}</span>
                  <span class="mt-0.5 flex gap-2 text-[10px] text-ink-400">
                    <span>{c.imageId ? '✓ image' : '✗ image'}</span>
                    <span>{c.description ? '✓ description' : '✗ description'}</span>
                  </span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
        {#if candidates.length > visibleCount}
          <button
            class="btn-ghost w-full text-xs"
            onclick={() => (visibleCount += CANDIDATE_PAGE * 2)}
          >
            Showing {visibleCount} of {candidates.length} — show more
          </button>
        {/if}
      {/if}
    {:else}
      <div class="py-4 text-center text-xs text-ink-400">Loading candidates…</div>
    {/if}
  </div>


  <!-- Continue to composing — the selection stage folds away.
       A bottom-pinned sticky bar rides over whatever content sits at the pin
       line, which at ~630px was the CANDIDATES header: the bar looked like a
       broken overlap rather than a floating control. It now carries its own
       backdrop so it reads as a layer above the page, and the scroll flow ends
       with enough room that the last candidate can always be scrolled clear
       of it instead of staying underneath. -->
  <div
    class="sticky bottom-24 z-10 -mx-1 rounded-xl border border-surface-border bg-surface-card/85 p-1 shadow-lg backdrop-blur md:bottom-4"
  >
    <button
      class="btn-primary w-full !py-3"
      disabled={selCount === 0}
      onclick={() => (stage = 'compose')}
    >
      {selCount === 0 ? 'Select teams to continue' : `Continue with ${selCount} team${selCount === 1 ? '' : 's'} →`}
    </button>
  </div>
  <!-- Scroll room under the pinned bar. Without it the last candidate can
       never be brought out from behind the bar — you can see it but not read
       or click it. -->
  <div class="h-24 md:h-4" aria-hidden="true"></div>
  {/if}

  {#if stage === 'compose'}
  <!-- Minimised selection summary — tap to go back and refilter. -->
  <button
    type="button"
    class="flex w-full cursor-pointer items-center gap-3 rounded-[14px] border border-surface-border bg-surface-card px-4 py-3 text-left transition hover:bg-surface-hover"
    onclick={() => (stage = 'select')}
  >
    <span
      class="font-display grid h-6 w-9 shrink-0 place-items-center rounded-full text-[10px] font-bold"
      style="background: var(--accent-electric); color: var(--accent-text);"
    >1–2</span>
    <span class="min-w-0 flex-1">
      <span class="font-display block text-[10px] uppercase tracking-wider text-ink-700" style="letter-spacing: 0.12em;">Selection</span>
      <span class="mt-1.5 flex flex-wrap gap-1">
        {#each step1Chips as chip (chip)}
          <span class="max-w-full truncate rounded-full px-2 py-0.5 text-[10px]" style="background: var(--bg-tertiary); color: var(--text-secondary);">{chip}</span>
        {/each}
        <span class="rounded-full px-2 py-0.5 text-[10px] font-semibold" style="background: rgba(44,140,153,0.12); color: var(--brand, #2C8C99);">{selCount} team{selCount === 1 ? '' : 's'}</span>
      </span>
    </span>
    <span class="shrink-0 text-[11px] text-ink-400">edit</span>
  </button>
  <!-- 2 · Platforms & template -->
  <div class="overflow-hidden rounded-[14px] border border-surface-border bg-surface-card">
    {@render stepHeader(3, 'Platforms & template', step2Chips, step2Open, () => (step2Open = !step2Open))}
    {#if step2Open}
    <div class="space-y-4 px-4 pb-4" transition:slide={{ duration: 200 }}>

    <div class="flex flex-wrap gap-1.5">
      {#each CAMPAIGN_PLATFORMS as p (p)}
        {@const on = platforms.includes(p)}
        <button
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11px] font-medium transition"
          style:background-color={on ? 'rgba(29,107,254,0.12)' : 'transparent'}
          style:color={on ? '#1D6BFE' : 'var(--text-secondary)'}
          style:border-color={on ? 'rgba(29,107,254,0.45)' : 'var(--surface-border)'}
          aria-pressed={on}
          onclick={() => togglePlatform(p)}
        >{CAMPAIGN_PLATFORM_LABEL[p]}</button>
      {/each}
    </div>

    <div>
      <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">
        Posting identity — shown in the previews
      </div>
      {#if data.identities.length === 0}
        <div class="text-xs text-ink-400">
          No presets yet — add your page under
          <a href="/settings/posting-identities" class="underline hover:text-ink-700">Settings → Posting identities</a>.
        </div>
      {:else}
        <div class="flex items-center gap-2">
          {#if identity?.avatar_url}
            <img src={identity.avatar_url} alt="" class="h-7 w-7 shrink-0 rounded-full object-cover" />
          {/if}
          <select
            class="input !w-auto max-w-full text-sm"
            value={identityId}
            onchange={(e) => { identityId = Number((e.currentTarget as HTMLSelectElement).value); markDirty(); }}
          >
            {#each data.identities as i (i.id)}
              <option value={i.id}>{i.name}{i.is_default ? ' (default)' : ''}</option>
            {/each}
          </select>
          <a
            href="/settings/posting-identities"
            class="shrink-0 text-[11px] text-ink-400 hover:text-ink-700"
            title="Manage presets"
          >manage</a>
        </div>
      {/if}
    </div>

    <div>
      <div class="mb-1.5 flex items-center justify-between">
        <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Base template</span>
        <span class="flex gap-1">
          {#each CAMPAIGN_TOKENS as tok (tok)}
            <button
              type="button"
              class="rounded border border-surface-border px-1.5 py-0.5 font-mono text-[10px] text-ink-500 transition hover:bg-surface-hover"
              onclick={() => insertToken(tok)}
            >{`{${tok}}`}</button>
          {/each}
        </span>
      </div>
      <textarea
        class="input w-full font-mono text-sm"
        rows="6"
        placeholder={'Meet our alumni!\n\nThe next team is {name}:\n{description}\n\nDon’t miss the deadline coming up.'}
        bind:value={baseTemplate}
        bind:this={templateEl}
        oninput={markDirty}
      ></textarea>
    </div>

    <p class="text-[11px] text-ink-400">
      Platform-specific wording? Click the text inside a preview (step 4) and edit it right
      there — the change sticks to that platform and re-fills for every team.
    </p>

    </div>
    {/if}
  </div>

  <!-- 4 · Preview & brief -->
  {#if selected}
    <div
      class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-4"
      ontouchstart={onPreviewTouchStart}
      ontouchend={onPreviewTouchEnd}
    >
      <div class="flex items-center gap-3">
        {@render stepBadge(4)}
        <span class="font-display min-w-0 flex-1 truncate text-[10px] uppercase tracking-wider text-ink-700" style="letter-spacing: 0.12em;">
          Preview — {selected.name}
        </span>
        {#if selCount > 1 && focusIndex >= 0}
          <span class="flex shrink-0 items-center gap-0.5">
            <button class="btn-ghost !px-1.5" aria-label="Previous team" onclick={() => goTo(focusIndex - 1)}>
              <Icon name="chevron-left" size={14} />
            </button>
            <span class="text-[11px] tabular-nums text-ink-500">{focusIndex + 1} / {selCount}</span>
            <button class="btn-ghost !px-1.5" aria-label="Next team" onclick={() => goTo(focusIndex + 1)}>
              <Icon name="chevron-right" size={14} />
            </button>
          </span>
        {/if}
      </div>

      <!-- Image picker: record image (default) · gallery · upload · URL.
           The pick drives every platform preview and rides on the
           generated post. -->
      <div>
        <div class="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Image</span>
          <div
            class="inline-flex p-0.5"
            role="radiogroup"
            aria-label="Image source"
            style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
          >
            {#each [['record', 'Record image'], ['gallery', 'Team photo'], ['studio', 'Studio template']] as const as [k, label] (k)}
              <button
                type="button"
                role="radio"
                aria-checked={imageSource === k}
                class="font-display cursor-pointer px-2.5 py-1 text-[10px] font-medium transition"
                style={imageSource === k
                  ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: calc(var(--radius-md) - 2px); letter-spacing: 0.04em;'
                  : 'background: transparent; color: var(--text-secondary); letter-spacing: 0.04em;'}
                onclick={() => { imageSource = k; setCustomImage(null); markDirty(); }}
              >{label}</button>
            {/each}
          </div>
        </div>
        {#if selCount > 1}
          <p class="mb-2 text-[11px] text-ink-400">
            Applied per team when saving the batch — {imageSource === 'studio'
              ? 'each team is rendered through the Studio template and the PNG rides on its post'
              : imageSource === 'gallery'
              ? 'each team\u2019s "Group photo" (or first gallery photo), falling back to its record image'
              : 'each team\u2019s own record image (logo / picture)'}.{imageSource === 'studio' ? '' : ' Manual picks below stick to the team you\u2019re viewing — swipe or use the arrows to adjust each.'}
          </p>
        {/if}
        {#if imageSource === 'studio'}
          <!-- Studio template picker: use an existing template, or jump
               into the builder with a fresh one pre-linked here. -->
          <div class="flex flex-wrap items-center gap-2">
            <select
              class="input !w-auto max-w-full text-sm"
              value={studioTemplateId ?? ''}
              onchange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                studioTemplateId = v ? Number(v) : null;
                markDirty();
              }}
            >
              <option value="">Pick a template…</option>
              {#each data.studioTemplates as t (t.id)}
                <option value={t.id}>{t.name ?? 'Untitled'} ({t.width ?? 1080}×{t.height ?? 1080})</option>
              {/each}
            </select>
            {#if studioTemplate}
              <a
                href={`/tools/studio/${studioTemplate.id}`}
                class="shrink-0 text-[11px] text-ink-400 hover:text-ink-700"
                title="Edit this template in the Studio"
              >edit template</a>
            {/if}
            <button
              type="button"
              class="btn-ghost !px-2 !py-1 text-[11px]"
              disabled={creatingTemplate}
              onclick={newStudioTemplate}
            >{creatingTemplate ? 'Creating…' : '+ New template'}</button>
            {#if studioBaseId}
              <button
                type="button"
                class="btn-ghost !px-2 !py-1 text-[11px]"
                title="Adjust where this team's photo centres in the crop"
                onclick={() => (focalModalFile = studioBaseId)}
              >Centre point</button>
            {/if}
            {#if studioPreviewBusy}
              <span class="text-[11px] text-ink-400">Rendering…</span>
            {/if}
          </div>
          {#if !studioTemplateId}
            <p class="mt-1.5 text-[11px] text-ink-400">
              Pick a template or create one — the previews then show each team rendered through it.
            </p>
          {/if}
          {#if studioTemplateId && platforms.length > 0}
            <!-- Per-platform overrides — square feed, story, wide can
                 each carry their own design. -->
            <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {#each platforms as p (p)}
                <label class="flex items-center gap-1.5 text-[11px] text-ink-500">
                  {CAMPAIGN_PLATFORM_LABEL[p]}
                  <select
                    class="input !w-auto !py-0.5 text-[11px]"
                    value={platformTemplates[p] ?? ''}
                    onchange={(e) => {
                      const v = (e.currentTarget as HTMLSelectElement).value;
                      const next = { ...platformTemplates };
                      if (v) next[p] = Number(v);
                      else delete next[p];
                      platformTemplates = next;
                      markDirty();
                    }}
                  >
                    <option value="">Default</option>
                    {#each data.studioTemplates as t (t.id)}
                      <option value={t.id}>{t.name ?? 'Untitled'} ({t.width ?? 1080}×{t.height ?? 1080})</option>
                    {/each}
                  </select>
                </label>
              {/each}
            </div>
          {/if}
        {:else}
        <div class="flex flex-wrap items-center gap-2">
          {#if selected.imageId}
            <button
              type="button"
              class="relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-md border-2 transition"
              style:border-color={effectiveImageId === selected.imageId ? 'var(--accent-electric)' : 'var(--surface-border)'}
              title="Record image (default)"
              aria-pressed={effectiveImageId === selected.imageId}
              onclick={() => { setCustomImage(null); imageSource = 'record'; }}
            >
              <img src={assetUrl(selected.imageId, { width: 128, height: 128, fit: 'cover' })} alt="" class="h-full w-full object-cover" />
            </button>
          {/if}
          {#each galleryPhotos as ph (ph.id)}
            <button
              type="button"
              class="relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-md border-2 transition"
              style:border-color={effectiveImageId === ph.file_id ? 'var(--accent-electric)' : 'var(--surface-border)'}
              title={ph.caption ?? 'Gallery photo'}
              aria-pressed={effectiveImageId === ph.file_id}
              onclick={() => setCustomImage(ph.file_id ?? null)}
            >
              <img src={assetUrl(ph.file_id, { width: 128, height: 128, fit: 'cover' })} alt={ph.caption ?? ''} class="h-full w-full object-cover" loading="lazy" />
            </button>
          {/each}
          {#if customImageId && customImageId !== selected.imageId && !galleryPhotos.some((g) => g.file_id === customImageId)}
            <!-- A freshly uploaded / imported image -->
            <button
              type="button"
              class="relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-md border-2 transition"
              style="border-color: var(--accent-electric);"
              title="Uploaded image"
              aria-pressed="true"
            >
              <img src={assetUrl(customImageId, { width: 128, height: 128, fit: 'cover' })} alt="" class="h-full w-full object-cover" />
            </button>
          {/if}
          <button
            type="button"
            class="grid h-16 w-16 shrink-0 cursor-pointer place-items-center rounded-md border-2 border-dashed border-surface-border text-ink-400 transition hover:bg-surface-hover hover:text-ink-700"
            title="Upload an image"
            disabled={uploadingImage}
            onclick={() => imageFileEl?.click()}
          >
            {#if uploadingImage}
              <span class="text-[10px]">…</span>
            {:else}
              <Icon name="plus" size={18} />
            {/if}
          </button>
          <button
            type="button"
            class="cursor-pointer text-[11px] text-ink-400 transition hover:text-ink-700"
            onclick={() => (showUrlInput = !showUrlInput)}
          >from URL</button>
          {#if effectiveImageId}
            <button
              type="button"
              class="cursor-pointer text-[11px] text-ink-400 transition hover:text-ink-700"
              title="Adjust where the selected image centres when cropped"
              onclick={() => (focalModalFile = effectiveImageId)}
            >Centre point</button>
          {/if}
        </div>
        {#if showUrlInput}
          <div class="mt-2 flex gap-2">
            <input
              class="input w-full text-sm"
              type="url"
              placeholder="https://… image URL (imported into Directus)"
              bind:value={imageUrlInput}
              onkeydown={(e) => { if (e.key === 'Enter') importImageUrl(); }}
            />
            <button class="btn-primary !px-3 text-xs" disabled={uploadingImage || !imageUrlInput.trim()} onclick={importImageUrl}>
              {uploadingImage ? 'Importing…' : 'Import'}
            </button>
          </div>
        {/if}
        {#if !effectiveImageId}
          <p class="mt-1.5 text-[11px] text-ink-400">No image yet — the previews show a placeholder. Upload one or paste a URL.</p>
        {/if}
        {/if}
        <input
          type="file"
          accept="image/*"
          class="hidden"
          bind:this={imageFileEl}
          onchange={(e) => {
            const file = (e.currentTarget as HTMLInputElement).files?.[0];
            if (file) uploadCustomImage(file);
            (e.currentTarget as HTMLInputElement).value = '';
          }}
        />
      </div>

      {#if platforms.length === 0}
        <div class="text-sm text-ink-400">Pick at least one platform in step 2.</div>
      {/if}
      {#each platforms as p (p)}
        <div class="rounded-md border border-surface-border p-3">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="flex items-center gap-2">
              <span class="text-xs font-semibold text-ink-700">{CAMPAIGN_PLATFORM_LABEL[p]}</span>
              {#if overrides[p]?.trim()}
                <span class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style="background: rgba(29,107,254,0.12); color: #1D6BFE;">customized</span>
                <button class="text-[10px] text-ink-400 hover:text-ink-700" onclick={() => resetOverride(p)}>reset to base</button>
              {/if}
            </span>
            {#if selCount > 1}
              <button
                class="btn-primary !px-3 !py-1.5 text-xs"
                disabled={batchBusy !== null}
                onclick={() => batchGenerate(p)}
              >
                {batchBusy === p ? `Saving ${batchProgress}…` : `Save ${selCount} posts`}
              </button>
            {:else}
              <button
                class="btn-primary !px-3 !py-1.5 text-xs"
                disabled={generating !== null}
                onclick={() => generateAndCopy(selected!, p)}
              >
                {generating === p ? 'Saving…' : copiedFlash === p ? 'Brief copied ✓' : 'Save post + copy brief'}
              </button>
            {/if}
          </div>
          <PostPreview
            platform={p}
            text={renderedFor(selected, p)}
            imageUrl={imageSource === 'studio'
              ? (templateFor(p) ? (studioPreviews[templateFor(p)!.id] ?? null) : null)
              : effectiveImageId
                ? assetUrl(effectiveImageId, { width: 1080 })
                : null}
            brandName={identity?.name}
            brandHandle={identity?.handle}
            avatarUrl={identity?.avatar_url}
            editable
            onEdit={(t) => applyPreviewEdit(p, t)}
          />
        </div>
      {/each}
    </div>
  {/if}

  <!-- 5 · Batch & queue — Continue creates the whole batch (teams ×
       platforms), then one click queues it into Buffer, optionally
       spread across a date window. -->
  {#if selCount > 0 && platforms.length > 0}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="flex items-center gap-3">
          {@render stepBadge(5)}
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-700" style="letter-spacing: 0.12em;">Batch & queue</span>
        </span>
        <button
          class="btn-primary !px-3 !py-1.5 text-xs"
          disabled={creatingBatch}
          onclick={createFullBatch}
        >
          {creatingBatch
            ? `Creating ${batchCreateProgress}…`
            : `Continue — create ${selCount * platforms.length} post${selCount * platforms.length === 1 ? '' : 's'}`}
        </button>
      </div>
      <p class="text-[11px] text-ink-400">
        One draft per team per platform ({selCount} team{selCount === 1 ? '' : 's'} × {platforms.length} platform{platforms.length === 1 ? '' : 's'}), each platform using its own template and copy.
      </p>

      {#if batchPosts.length > 0}
        <div class="space-y-3 border-t border-surface-divider pt-3">
          <div class="text-xs text-ink-700">
            Batch ready — <span class="font-semibold">{batchPosts.length} post{batchPosts.length === 1 ? '' : 's'}</span>
            {#if queueablePosts.length < batchPosts.length}
              · {queueablePosts.length} queueable
              {#if batchPosts.some((p) => p.platform === 'general' && !p.buffer_post_id)}
                <span class="text-ink-400">(General posts have no Buffer channel — copy their briefs instead)</span>
              {/if}
              {#if batchPosts.some((p) => !!p.buffer_post_id)}
                <span class="text-ink-400">({batchPosts.filter((p) => !!p.buffer_post_id).length} already in Buffer)</span>
              {/if}
            {/if}
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-500">
            <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Spread</span>
            <label class="flex items-center gap-1.5">
              from
              <input type="date" class="input !py-1 text-xs" bind:value={scheduleFrom} onchange={markDirty} />
            </label>
            <label class="flex items-center gap-1.5">
              to
              <input type="date" class="input !py-1 text-xs" bind:value={scheduleTo} onchange={markDirty} />
            </label>
            <span class="text-[10px] text-ink-400">
              {scheduleFrom
                ? `teams evenly spaced${scheduleTo ? ` ${fmtDate(scheduleFrom)} – ${fmtDate(scheduleTo)}` : ''} at 10:00 — a team's platforms post together`
                : 'no dates — posts drop into each channel’s own Buffer queue'}
            </span>
          </div>
          <button
            class="btn-primary !px-3 !py-1.5 text-xs"
            disabled={queueing || queueablePosts.length === 0}
            onclick={() => queueBatch()}
          >
            {queueing
              ? `Queueing ${queueProgress}…`
              : `Queue ${queueablePosts.length} post${queueablePosts.length === 1 ? '' : 's'} in Buffer`}
          </button>
        </div>
      {/if}
    </div>
  {/if}
  {/if}

  <!-- Generated posts — visible in both stages so drafts can be
       queued/marked used without re-selecting teams. -->
  {#if posts.length > 0}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <div class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">Generated posts</div>
        <!-- Bulk queue. "One at a time" and "all of them" were the only two
             options; picking four of eleven is the normal case. -->
        {#if posts.some(isQueueable)}
          <span class="ml-auto flex flex-wrap items-center gap-2 text-[11px]">
            {#if queueSelPosts.length > 0}
              <button class="cursor-pointer text-ink-400 hover:text-ink-700" onclick={() => (queueSel = new Set())}>Clear</button>
            {:else}
              <button
                class="cursor-pointer text-ink-400 hover:text-ink-700"
                onclick={() => (queueSel = new Set(posts.filter(isQueueable).map((p) => p.id)))}
              >Select queueable</button>
            {/if}
            <button
              class="btn-primary !px-3 !py-1 text-[11px]"
              disabled={queueing || queueSelPosts.length === 0}
              onclick={() => queueSelected()}
            >
              {queueing
                ? `Queueing ${queueProgress}…`
                : queueSelPosts.length > 0
                  ? `Queue ${queueSelPosts.length} in Buffer`
                  : 'Queue in Buffer'}
            </button>
            <!-- Publish now. Separate button rather than a mode switch, because
                 the two do irreversibly different things and a dropdown hides
                 which one is armed. Ghost, not primary: queueing stays the
                 default action. -->
            <button
              class="btn-ghost !px-3 !py-1 text-[11px]"
              disabled={queueing || queueSelPosts.length === 0}
              title="Send to Buffer with shareNow — publishes immediately instead of taking a queue slot"
              onclick={() => queueSelected('shareNow')}
            >Publish now</button>
          </span>
        {/if}
      </div>
      <ul class="divide-y divide-surface-divider">
        {#each posts as p (p.id)}
          <li class="flex items-center gap-3 py-2">
            {#if isQueueable(p)}
              <input
                type="checkbox"
                class="shrink-0 cursor-pointer"
                checked={queueSel.has(p.id)}
                aria-label={`Select ${p.item_label} for Buffer`}
                onchange={() => toggleQueueSel(p.id)}
              />
            {/if}
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2">
                <span class="truncate text-sm font-medium text-ink-900">{p.item_label}</span>
                <span class="text-[11px] text-ink-400">{CAMPAIGN_PLATFORM_LABEL[(p.platform ?? 'general') as CampaignPlatform] ?? p.platform}</span>
                {#if p.scheduled_for}
                  <span class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style="background: rgba(29,107,254,0.12); color: #1D6BFE;">→ {fmtWhen(p.scheduled_for)}</span>
                {/if}
                {#if p.status === 'used'}
                  <span class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style="background: rgba(34,160,90,0.14); color: #1B8A4B;">used {fmtDate(p.used_at)}</span>
                {:else if p.status === 'skipped'}
                  <span class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style="background: var(--bg-tertiary); color: var(--text-secondary);">skipped</span>
                {:else}
                  <span class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style="background: rgba(214,158,46,0.16); color: #B57A12;">draft</span>
                {/if}
              </span>
              <span class="block truncate text-[11px] text-ink-500">{p.rendered_text}</span>
            </span>
            <span class="flex shrink-0 items-center gap-1">
              {#if p.buffer_post_id}
                <!-- Buffer has no per-post URL: its UI opens a Post Details
                     drawer, and neither Post nor Channel exposes a permalink
                     in the API. This opens the queue rather than pretending to
                     deep-link to a post that has no address. -->
                <a
                  href="https://publish.buffer.com/"
                  target="_blank"
                  rel="noreferrer"
                  class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase hover:underline"
                  style="background: rgba(29,107,254,0.12); color: #1D6BFE;"
                  title={p.scheduled_for ? `Goes out ${fmtWhen(p.scheduled_for)} — open Buffer` : 'Open Buffer'}
                >in Buffer ↗</a>
              {:else if p.platform !== 'general' && bufferChannelFor(p.platform ?? '')}
                <button
                  class="btn-ghost !px-2 text-[11px]"
                  title={`Queue on ${bufferChannelFor(p.platform ?? '')?.display_name}`}
                  disabled={buffering !== null}
                  onclick={() => queuePost(p)}
                >{buffering === p.id ? 'Queueing…' : 'Queue in Buffer'}</button>
              {/if}
              <button class="btn-ghost !px-2 text-xs" title="Copy brief" onclick={() => copyBriefForPost(p)}>
                {copiedFlash === `post-${p.id}` ? '✓' : ''}<Icon name="copy" size={13} />
              </button>
              {#if p.status !== 'used'}
                <button class="btn-ghost !px-2 text-[11px]" onclick={() => setPostStatus(p, 'used')}>Mark used</button>
              {:else}
                <button class="btn-ghost !px-2 text-[11px]" onclick={() => setPostStatus(p, 'draft')}>Un-use</button>
              {/if}
              <button class="btn-ghost !px-2 text-ink-300 hover:text-ink-700" title="Delete post" onclick={() => removePost(p)}>
                <Icon name="x" size={13} />
              </button>
            </span>
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
    onChange={onFocalChanged}
  />
{/if}
