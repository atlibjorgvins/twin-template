<script lang="ts">
  // Lightbox info sidebar — everything known about the open asset, in one
  // minimal scrollable column:
  //   • People  — faces Immich found, resolved to twin People where mapped.
  //   • Tags    — photo_link to project / org / person / event (editable).
  //   • Caption — editable, written back to Immich (shows in Immich too).
  //   • Favourite — toggled on Immich.
  //   • Details — date, place, camera, exposure, dimensions, size.
  //
  // Edits sync at the source: photo_link tags live in Directus (every twin
  // page reads them), caption + favourite are PUT to the Immich server.
  import {
    getAssetFull,
    updateAsset,
    personThumbUrl,
    immichAssetWebUrl,
    renameImmichPerson,
    type ImmichAssetFull
  } from '$lib/immich';
  import { facePeople } from '$lib/photos/explore';
  import { searchPeople, personName, upsertPhotoPerson, type Person } from '$lib/directus';
  import PhotoTagPanel from '$lib/photos/PhotoTagPanel.svelte';
  import Icon from '$lib/Icon.svelte';

  let {
    assetId,
    taggable = true,
    onChanged = null
  }: { assetId: string; taggable?: boolean; onChanged?: (() => void) | null } = $props();

  let asset = $state<ImmichAssetFull | null>(null);
  let loading = $state(true);
  let faces = $state<Record<string, { personId: number | null; name: string | null }>>({});

  // Local editable mirrors so typing/toggling feels instant.
  let caption = $state('');
  let favorite = $state(false);
  let rating = $state(0); // 0–5 stars (0 = unrated)
  let savingCaption = $state(false);
  let captionSaved = $state(false);
  let captionTimer: ReturnType<typeof setTimeout> | undefined;
  let saveError = $state<string | null>(null);

  // Editable capture date ("Taken"), written back to Immich.
  let dateLocal = $state(''); // datetime-local value "YYYY-MM-DDTHH:MM"
  let savingDate = $state(false);
  let dateSaved = $state(false);

  /** ISO → datetime-local value in the browser's local time. */
  function toLocalInput(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  $effect(() => {
    const id = assetId;
    loading = true;
    asset = null;
    faces = {};
    saveError = null;
    captionSaved = false;
    dateSaved = false;
    void (async () => {
      try {
        const a = await getAssetFull(id);
        if (assetId !== id) return; // moved on
        asset = a;
        caption = a.exifInfo?.description ?? '';
        favorite = !!a.isFavorite;
        rating = a.exifInfo?.rating ?? 0;
        dateLocal = toLocalInput(a.exifInfo?.dateTimeOriginal || a.fileCreatedAt);
        const ids = (a.people ?? []).filter((p) => !p.isHidden).map((p) => p.id);
        faces = await facePeople(ids);
      } catch (e) {
        saveError = e instanceof Error ? e.message : String(e);
      } finally {
        if (assetId === id) loading = false;
      }
    })();
  });

  const visibleFaces = $derived((asset?.people ?? []).filter((p) => !p.isHidden));

  // Inline face → Person mapping — map a detected face right here instead
  // of bouncing to the whole Face matching list.
  let mapForFace = $state<string | null>(null);
  let faceQuery = $state('');
  let faceResults = $state<Person[]>([]);
  let faceBusy = $state(false);
  let faceTimer: ReturnType<typeof setTimeout> | undefined;

  function openFaceMap(id: string) {
    mapForFace = mapForFace === id ? null : id;
    faceQuery = '';
    faceResults = [];
  }
  function onFaceInput() {
    if (faceTimer) clearTimeout(faceTimer);
    const q = faceQuery.trim();
    if (q.length < 2) {
      faceResults = [];
      return;
    }
    faceTimer = setTimeout(async () => {
      faceBusy = true;
      try {
        faceResults = await searchPeople(q, 8);
      } finally {
        faceBusy = false;
      }
    }, 250);
  }
  async function mapFace(clusterId: string, p: Person) {
    const name = personName(p);
    try {
      await upsertPhotoPerson(clusterId, {
        person_id: p.id,
        immich_name: name,
        mapped_at: new Date().toISOString(),
        hidden: false
      });
      void renameImmichPerson(clusterId, name).catch(() => {});
      faces = { ...faces, [clusterId]: { personId: p.id, name } };
      mapForFace = null;
      faceQuery = '';
      faceResults = [];
      onChanged?.();
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  function onCaptionInput() {
    captionSaved = false;
    if (captionTimer) clearTimeout(captionTimer);
    captionTimer = setTimeout(saveCaption, 700);
  }

  async function saveCaption() {
    if (!asset) return;
    savingCaption = true;
    saveError = null;
    try {
      await updateAsset(asset.id, { description: caption });
      captionSaved = true;
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      savingCaption = false;
    }
  }

  async function toggleFavorite() {
    if (!asset) return;
    favorite = !favorite;
    saveError = null;
    try {
      await updateAsset(asset.id, { isFavorite: favorite });
    } catch (e) {
      favorite = !favorite; // revert
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  async function setRating(n: number) {
    if (!asset) return;
    const prev = rating;
    rating = n === rating ? 0 : n; // click the current star to clear
    saveError = null;
    try {
      await updateAsset(asset.id, { rating });
      onChanged?.();
    } catch (e) {
      rating = prev; // revert
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  async function saveDate() {
    if (!asset || !dateLocal) return;
    const d = new Date(dateLocal);
    if (isNaN(d.getTime())) return;
    savingDate = true;
    dateSaved = false;
    saveError = null;
    try {
      await updateAsset(asset.id, { dateTimeOriginal: d.toISOString() });
      // Reflect locally so the formatted date + ordering update at once.
      if (asset.exifInfo) asset.exifInfo.dateTimeOriginal = d.toISOString();
      dateSaved = true;
      onChanged?.();
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      savingDate = false;
    }
  }

  // ── formatting ───────────────────────────────────────────────────
  const place = $derived(
    [asset?.exifInfo?.city, asset?.exifInfo?.state, asset?.exifInfo?.country].filter(Boolean).join(', ') || null
  );
  const camera = $derived([asset?.exifInfo?.make, asset?.exifInfo?.model].filter(Boolean).join(' ') || null);
  const dimensions = $derived(
    asset?.exifInfo?.exifImageWidth && asset?.exifInfo?.exifImageHeight
      ? `${asset.exifInfo.exifImageWidth} × ${asset.exifInfo.exifImageHeight}`
      : asset?.width && asset?.height
        ? `${asset.width} × ${asset.height}`
        : null
  );
  const fileSize = $derived(
    asset?.exifInfo?.fileSizeInByte ? `${(asset.exifInfo.fileSizeInByte / 1_048_576).toFixed(1)} MB` : null
  );
  const exposure = $derived.by(() => {
    const e = asset?.exifInfo;
    if (!e) return null;
    const parts = [
      e.fNumber != null ? `ƒ/${e.fNumber}` : null,
      e.exposureTime ? `${e.exposureTime}s` : null,
      e.iso != null ? `ISO ${e.iso}` : null,
      e.focalLength != null ? `${Math.round(e.focalLength)} mm` : null
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="flex h-full flex-col text-white" onclick={(e) => e.stopPropagation()}>
  <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
    <span class="text-xs font-semibold uppercase tracking-wider text-white/60">Details</span>
    <button
      type="button"
      class="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs font-medium {favorite ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20'}"
      onclick={toggleFavorite}
      aria-pressed={favorite}
      title="Favourite (syncs to Immich)"
    >
      <Icon name="bookmark" size={13} /> {favorite ? 'Favourited' : 'Favourite'}
    </button>
  </div>

  <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
    {#if loading}
      <div class="text-xs text-white/50">Loading details…</div>
    {:else if asset}
      <!-- Rating -->
      <section>
        <div class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">Rating</div>
        <div class="flex items-center gap-0.5">
          {#each [1, 2, 3, 4, 5] as n (n)}
            <button
              type="button"
              class="cursor-pointer px-0.5 text-xl leading-none transition-colors {n <= rating ? 'text-yellow-400' : 'text-white/25 hover:text-white/50'}"
              onclick={() => setRating(n)}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              aria-pressed={n <= rating}
            >★</button>
          {/each}
          {#if rating > 0}
            <button type="button" class="ml-2 text-[11px] text-white/40 hover:text-white/70" onclick={() => setRating(0)}>clear</button>
          {/if}
        </div>
      </section>

      <!-- People -->
      <section>
        <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">People</div>
        {#if visibleFaces.length === 0}
          <p class="text-xs text-white/50">No faces detected.</p>
        {:else}
          <ul class="space-y-1.5">
            {#each visibleFaces as f (f.id)}
              {@const mapped = faces[f.id]}
              <li>
                <div class="flex items-center gap-2">
                  <img src={personThumbUrl(f.id)} alt="" loading="lazy" class="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/20" />
                  <div class="min-w-0 flex-1">
                    {#if mapped?.personId}
                      <a href={`/people/${mapped.personId}`} class="truncate text-sm text-white hover:underline">{mapped.name}</a>
                    {:else}
                      <span class="truncate text-sm text-white/80">{f.name || 'Unknown'}</span>
                    {/if}
                  </div>
                  {#if !mapped?.personId}
                    <button
                      type="button"
                      class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium {mapForFace === f.id ? 'bg-white text-black' : 'bg-white/10 text-white/80 hover:bg-white/20'}"
                      onclick={() => openFaceMap(f.id)}
                    >map</button>
                  {/if}
                </div>

                {#if mapForFace === f.id}
                  <div class="mt-1.5 pl-10">
                    <!-- svelte-ignore a11y_autofocus -->
                    <input
                      type="search"
                      class="w-full rounded-[7px] border border-white/20 bg-white/10 px-2 py-1 text-xs text-white placeholder-white/40 outline-none focus:border-white/50"
                      placeholder="Who is this? Search people…"
                      bind:value={faceQuery}
                      oninput={onFaceInput}
                      autofocus
                    />
                    {#if faceBusy}
                      <div class="mt-1 text-[11px] text-white/50">Searching…</div>
                    {:else if faceResults.length > 0}
                      <ul class="mt-1 max-h-40 overflow-y-auto rounded-[8px] bg-black/60">
                        {#each faceResults as p (p.id)}
                          <li>
                            <button type="button" class="w-full cursor-pointer px-2.5 py-1.5 text-left text-xs text-white hover:bg-white/15" onclick={() => mapFace(f.id, p)}>{personName(p)}</button>
                          </li>
                        {/each}
                      </ul>
                    {:else if faceQuery.trim().length >= 2}
                      <div class="mt-1 text-[11px] text-white/50">No matches.</div>
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- Tags (photo_link) -->
      {#if taggable}
        <section>
          <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40">Tags</div>
          <PhotoTagPanel {assetId} {onChanged} />
        </section>
      {/if}

      <!-- Caption (synced to Immich) -->
      <section>
        <div class="mb-1.5 flex items-center justify-between">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-white/40">Caption</span>
          <span class="text-[10px] text-white/40">
            {#if savingCaption}saving…{:else if captionSaved}saved ✓{/if}
          </span>
        </div>
        <textarea
          class="w-full resize-y rounded-[8px] border border-white/20 bg-white/10 px-2.5 py-2 text-xs text-white placeholder-white/40 outline-none focus:border-white/50"
          rows="2"
          placeholder="Add a caption… (saved to Immich)"
          bind:value={caption}
          oninput={onCaptionInput}
          onblur={saveCaption}
        ></textarea>
      </section>

      <!-- Details -->
      <section class="space-y-1.5">
        <div class="text-[10px] font-semibold uppercase tracking-wider text-white/40">Metadata</div>
        {#snippet row(label: string, value: string | null)}
          {#if value}
            <div class="flex items-start justify-between gap-3">
              <span class="shrink-0 text-xs text-white/40">{label}</span>
              <span class="min-w-0 break-words text-right text-xs text-white/90">{value}</span>
            </div>
          {/if}
        {/snippet}
        {@render row('File', asset.originalFileName)}
        {@render row('Type', asset.type === 'VIDEO' ? `Video${asset.duration ? ` · ${asset.duration.slice(0, 8)}` : ''}` : 'Photo')}
        <!-- Taken — editable, written back to Immich -->
        <div class="flex items-center justify-between gap-3">
          <span class="shrink-0 text-xs text-white/40">Taken</span>
          <span class="flex items-center gap-1.5">
            {#if savingDate}<span class="text-[10px] text-white/40">saving…</span>{:else if dateSaved}<span class="text-[10px] text-white/40">saved ✓</span>{/if}
            <input
              type="datetime-local"
              class="rounded-[6px] border border-white/20 bg-white/10 px-1.5 py-1 text-xs text-white outline-none [color-scheme:dark] focus:border-white/50"
              bind:value={dateLocal}
              onchange={saveDate}
              title="Capture date — saved to Immich"
            />
          </span>
        </div>
        {@render row('Place', place)}
        {@render row('Camera', camera)}
        {@render row('Lens', asset.exifInfo?.lensModel ?? null)}
        {@render row('Exposure', exposure)}
        {@render row('Size', [dimensions, fileSize].filter(Boolean).join(' · ') || null)}
        {#if asset.exifInfo?.latitude != null && asset.exifInfo?.longitude != null}
          <div class="flex items-center justify-between gap-3">
            <span class="shrink-0 text-xs text-white/40">GPS</span>
            <a
              class="text-right text-xs text-white/90 hover:underline"
              href={`https://www.openstreetmap.org/?mlat=${asset.exifInfo.latitude}&mlon=${asset.exifInfo.longitude}#map=15/${asset.exifInfo.latitude}/${asset.exifInfo.longitude}`}
              target="_blank"
              rel="noreferrer"
            >{asset.exifInfo.latitude.toFixed(4)}, {asset.exifInfo.longitude.toFixed(4)}</a>
          </div>
        {/if}
        <!-- Fallback for metadata twin doesn't edit yet (place, camera, albums…) -->
        <a
          href={immichAssetWebUrl(asset.id)}
          target="_blank"
          rel="noreferrer"
          class="mt-2 inline-flex items-center gap-1 text-[11px] text-white/50 hover:text-white"
          title="Edit place, camera and other metadata in Immich"
        >
          Open in Immich <Icon name="arrow-right" size={11} class="-rotate-45" />
        </a>
      </section>

      {#if saveError}
        <div class="rounded-[8px] border border-red-400/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-200">{saveError}</div>
      {/if}
    {/if}
  </div>
</div>
