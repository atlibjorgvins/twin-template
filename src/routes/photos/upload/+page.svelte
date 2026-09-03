<script lang="ts">
  // Drop zone — bulk-upload photos/videos into Immich and attach metadata
  // as you go. Built for "I'm at an event": pick the event (or project /
  // org / person) + an optional caption once, drop a batch, and every
  // uploaded asset is linked + captioned on the way in. The batch then
  // shows in a grid so you can open any one and refine via the Info panel.
  //
  // Uploads go straight to Immich (managed storage) through the same
  // key-injecting proxy as the rest of the navigator; only photo_link tags
  // land in Directus. Nothing is stored twice.
  import { onDestroy } from 'svelte';
  import {
    uploadAsset,
    updateAsset,
    type ImmichAsset
  } from '$lib/immich';
  import { searchProjects, searchOrgs, searchPeople, personName, type Person } from '$lib/directus';
  import {
    createLink,
    searchEvents,
    EXPLORE_META,
    EXPLORE_ORDER,
    type ExploreCollection
  } from '$lib/photos/explore';
  import PhotoGrid from '$lib/photos/PhotoGrid.svelte';
  import Icon from '$lib/Icon.svelte';

  // ── batch metadata ──────────────────────────────────────────────
  let kind = $state<ExploreCollection>('event');
  let target = $state<{ collection: ExploreCollection; id: number; label: string } | null>(null);
  let caption = $state('');

  let query = $state('');
  let results = $state<{ id: number; label: string }[]>([]);
  let searching = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function onQuery() {
    if (timer) clearTimeout(timer);
    const q = query.trim();
    if (q.length < 2) {
      results = [];
      return;
    }
    timer = setTimeout(async () => {
      searching = true;
      try {
        if (kind === 'event') {
          results = (await searchEvents(q, 8)).map((r) => ({ id: r.id, label: r.name ?? `#${r.id}` }));
        } else if (kind === 'Project') {
          results = ((await searchProjects(q, 8)) as { id: number; name: string | null }[]).map((r) => ({ id: r.id, label: r.name ?? `#${r.id}` }));
        } else if (kind === 'organization') {
          results = ((await searchOrgs(q, 8)) as { id: number; name: string | null }[]).map((r) => ({ id: r.id, label: r.name ?? `#${r.id}` }));
        } else {
          results = ((await searchPeople(q, 8)) as Person[]).map((r) => ({ id: r.id, label: personName(r) }));
        }
      } finally {
        searching = false;
      }
    }, 250);
  }

  function choose(r: { id: number; label: string }) {
    target = { collection: kind, id: r.id, label: r.label };
    query = '';
    results = [];
  }

  // ── the queue ───────────────────────────────────────────────────
  type Status = 'queued' | 'uploading' | 'done' | 'dup' | 'error';
  type Item = {
    key: number;
    file: File;
    isVideo: boolean;
    previewUrl: string;
    status: Status;
    assetId: string | null;
    error: string | null;
  };
  let items = $state<Item[]>([]);
  let seq = 0;
  let running = $state(false);
  let bodyTooLarge = $state(false);
  let dragOver = $state(false);

  const queuedCount = $derived(items.filter((i) => i.status === 'queued').length);
  const doneItems = $derived(items.filter((i) => (i.status === 'done' || i.status === 'dup') && i.assetId));
  const errorCount = $derived(items.filter((i) => i.status === 'error').length);
  // The successfully uploaded set, as assets the grid can render + refine.
  const doneAssets = $derived<ImmichAsset[]>(
    doneItems.map((i) => ({
      id: i.assetId as string,
      type: i.isVideo ? 'VIDEO' : 'IMAGE',
      originalFileName: i.file.name,
      fileCreatedAt: new Date(i.file.lastModified || Date.now()).toISOString()
    }))
  );

  function addFiles(list: FileList | null | undefined) {
    if (!list) return;
    for (const file of Array.from(list)) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
      items.push({
        key: seq++,
        file,
        isVideo: file.type.startsWith('video/'),
        previewUrl: URL.createObjectURL(file),
        status: 'queued',
        assetId: null,
        error: null
      });
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    addFiles(e.dataTransfer?.files);
  }

  function removeItem(it: Item) {
    URL.revokeObjectURL(it.previewUrl);
    items = items.filter((x) => x.key !== it.key);
  }

  async function uploadOne(it: Item) {
    it.status = 'uploading';
    it.error = null;
    try {
      const r = await uploadAsset(it.file);
      it.assetId = r.id;
      if (target) await createLink(r.id, target.collection, target.id).catch(() => {});
      // Only set caption on freshly created assets — don't clobber an
      // existing description if Immich recognised a duplicate.
      if (caption.trim() && r.status === 'created') await updateAsset(r.id, { description: caption.trim() }).catch(() => {});
      it.status = r.status === 'duplicate' ? 'dup' : 'done';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      it.status = 'error';
      it.error = msg;
      if (/\b413\b/.test(msg)) bodyTooLarge = true;
    }
  }

  async function uploadAll() {
    if (running) return;
    running = true;
    bodyTooLarge = false;
    const CONCURRENCY = 3;
    const next = () => items.find((i) => i.status === 'queued');
    async function worker() {
      for (;;) {
        const it = next();
        if (!it) break;
        await uploadOne(it);
      }
    }
    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      running = false;
    }
  }

  function clearDone() {
    for (const i of items) if (i.status === 'done' || i.status === 'dup') URL.revokeObjectURL(i.previewUrl);
    items = items.filter((i) => i.status === 'queued' || i.status === 'uploading' || i.status === 'error');
  }

  onDestroy(() => {
    for (const i of items) URL.revokeObjectURL(i.previewUrl);
  });

  const STATUS_LABEL: Record<Status, string> = {
    queued: 'queued',
    uploading: 'uploading…',
    done: 'uploaded ✓',
    dup: 'already in library',
    error: 'failed'
  };
</script>

<svelte:head><title>Drop photos · Hub</title></svelte:head>

<section class="space-y-5">
  <header>
    <a href="/photos" class="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700">
      <Icon name="chevron-left" size={13} /> Photo navigator
    </a>
    <div class="hero-eyebrow mt-2">Photos</div>
    <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">Drop photos</h1>
    <p class="mt-1 text-sm text-ink-500">
      Bulk-upload to the library and tag the whole batch as you go. Great for events — set the event, drop, done.
    </p>
  </header>

  <!-- Batch metadata -->
  <div class="card space-y-4 p-4">
    <div>
      <div class="muted-label mb-2">Link this batch to</div>
      {#if target}
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-surface-hover px-2.5 py-1 text-sm">
            <Icon name={EXPLORE_META[target.collection].icon} size={13} />
            {target.label}
            <span class="text-xs text-ink-400">· {EXPLORE_META[target.collection].label}</span>
          </span>
          <button type="button" class="btn-ghost text-xs" onclick={() => (target = null)}>change</button>
        </div>
      {:else}
        <div class="space-y-2">
          <div class="inline-flex flex-wrap gap-0.5 rounded-[8px] border border-surface-border p-0.5 text-xs" role="tablist" aria-label="Link type">
            {#each EXPLORE_ORDER as k (k)}
              <button
                type="button"
                role="tab"
                aria-selected={kind === k}
                class="cursor-pointer rounded-[6px] px-2.5 py-1.5 font-medium transition-colors {kind === k ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-700'}"
                onclick={() => { kind = k; results = []; if (query.trim().length >= 2) onQuery(); }}
              >{EXPLORE_META[k].label}</button>
            {/each}
          </div>
          <input
            type="search"
            class="input w-full text-sm"
            placeholder={`Search ${EXPLORE_META[kind].plural.toLowerCase()}… (optional)`}
            bind:value={query}
            oninput={onQuery}
          />
          {#if searching}
            <div class="text-xs text-ink-400">Searching…</div>
          {:else if results.length > 0}
            <ul class="divide-y divide-surface-divider rounded-[10px] border border-surface-border bg-surface-card">
              {#each results as r (r.id)}
                <li>
                  <button type="button" class="w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => choose(r)}>{r.label}</button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>

    <div>
      <label for="batch-caption" class="muted-label mb-1.5 block">Caption for all (optional)</label>
      <input id="batch-caption" type="text" class="input w-full text-sm" placeholder="e.g. Demo Day 2026 — finalists" bind:value={caption} />
    </div>
  </div>

  <!-- Drop zone -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="rounded-[14px] border-2 border-dashed p-8 text-center transition-colors {dragOver ? 'border-brand bg-surface-hover' : 'border-surface-border'}"
    ondragover={(e) => { e.preventDefault(); dragOver = true; }}
    ondragleave={() => (dragOver = false)}
    ondrop={onDrop}
  >
    <Icon name="image" size={28} class="mx-auto text-ink-300" />
    <p class="mt-2 text-sm text-ink-600">Drag photos &amp; videos here</p>
    <p class="text-xs text-ink-400">or</p>
    <label class="btn-primary mt-2 inline-flex cursor-pointer items-center gap-1.5 text-sm">
      <Icon name="plus" size={14} /> Choose files
      <input
        type="file"
        accept="image/*,video/*"
        multiple
        class="hidden"
        onchange={(e) => { addFiles((e.currentTarget as HTMLInputElement).files); (e.currentTarget as HTMLInputElement).value = ''; }}
      />
    </label>
  </div>

  {#if bodyTooLarge}
    <div class="rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
      The photo proxy rejected an upload as too large (HTTP 413). The Immich nginx proxy needs a higher
      <code>client_max_body_size</code> (in <code>api-proxy.conf</code> on the NAS). Smaller files may still go through.
    </div>
  {/if}

  {#if items.length > 0}
    <div class="card">
      <div class="card-header">
        <span class="card-title"><Icon name="layers" size={16} /> Batch
          <span class="font-normal text-ink-300">{items.length}</span>
        </span>
        <div class="flex items-center gap-2">
          {#if doneItems.length > 0}<span class="text-xs text-ink-400">{doneItems.length} uploaded{errorCount ? ` · ${errorCount} failed` : ''}</span>{/if}
          <button type="button" class="btn-primary px-3 py-1.5 text-xs" onclick={uploadAll} disabled={running || queuedCount === 0}>
            {running ? 'Uploading…' : queuedCount > 0 ? `Upload ${queuedCount}` : 'Done'}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 md:grid-cols-6">
        {#each items as it (it.key)}
          <div class="relative overflow-hidden rounded-[8px] bg-surface-hover">
            <div class="aspect-square">
              {#if it.isVideo}
                <div class="flex h-full w-full items-center justify-center text-ink-300"><Icon name="image" size={20} /></div>
              {:else}
                <img src={it.previewUrl} alt={it.file.name} class="h-full w-full object-cover {it.status === 'done' || it.status === 'dup' ? '' : 'opacity-70'}" />
              {/if}
            </div>
            <div class="absolute inset-x-0 bottom-0 truncate px-1.5 py-1 text-[10px] {it.status === 'error' ? 'bg-red-600/80 text-white' : it.status === 'done' || it.status === 'dup' ? 'bg-black/55 text-white' : 'bg-black/45 text-white/90'}">
              {STATUS_LABEL[it.status]}
            </div>
            {#if it.status === 'queued'}
              <button type="button" class="absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75" onclick={() => removeItem(it)} aria-label="Remove">
                <Icon name="x" size={11} />
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if doneAssets.length > 0}
    <div class="card">
      <div class="card-header">
        <span class="card-title"><Icon name="check" size={16} /> Uploaded — refine
          <span class="font-normal text-ink-300">{doneAssets.length}</span>
        </span>
        <button type="button" class="btn-ghost text-xs" onclick={clearDone}>clear</button>
      </div>
      <div class="px-4 pb-4">
        <p class="mb-3 text-xs text-ink-400">
          Open any photo to add people, tags or a caption.
          {#if target}All are linked to <span class="font-medium text-ink-600">{target.label}</span>.{/if}
          Faces appear here once Immich finishes recognising them.
        </p>
        <PhotoGrid assets={doneAssets} total={doneAssets.length} taggable />
      </div>
    </div>
  {/if}
</section>
