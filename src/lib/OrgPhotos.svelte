<script lang="ts">
  // Photo gallery card for an organization — multiple photos, each
  // labelled with a PhotoType (Settings → Photo types) + caption.
  // Clicking a photo opens a lightbox (prev/next, keyboard, swipe)
  // with the same controls as the grid plus the Image Studio centre
  // point, so crops can be aimed right from the org page.
  // Isolated component: mounted on the (large) org detail page as a
  // single tag so it can't disturb the parent template.
  import Icon from '$lib/Icon.svelte';
  import FocalPointEditor from '$lib/studio/FocalPointEditor.svelte';
  import {
    listOrgPhotos,
    listPhotoTypes,
    addOrgPhoto,
    updateOrgPhoto,
    deleteOrgPhoto,
    uploadFile,
    assetUrl,
    formatError,
    type OrganizationPhoto,
    type PhotoType
  } from '$lib/directus';

  let { orgId, orgName = '', onCount }: { orgId: number; orgName?: string; onCount?: (n: number) => void } = $props();

  let photos = $state<OrganizationPhoto[]>([]);
  let types = $state<PhotoType[]>([]);
  let loading = $state(true);

  $effect(() => { if (!loading) onCount?.(photos.length); });
  let error = $state('');
  let uploading = $state(0); // count of in-flight uploads
  let busyId = $state<number | null>(null);
  let uploadTypeId = $state<number | ''>('');
  let fileInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    void (async () => {
      loading = true;
      try {
        [photos, types] = await Promise.all([listOrgPhotos(orgId), listPhotoTypes()]);
      } catch (e) {
        error = formatError(e);
      } finally {
        loading = false;
      }
    })();
  });

  const typeName = (p: OrganizationPhoto): string | null =>
    typeof p.type_id === 'object' ? (p.type_id?.name ?? null) : null;
  const typeIdOf = (p: OrganizationPhoto): number | '' =>
    typeof p.type_id === 'object' ? (p.type_id?.id ?? '') : (p.type_id ?? '');

  async function onPick(e: Event) {
    const files = [...((e.currentTarget as HTMLInputElement).files ?? [])];
    (e.currentTarget as HTMLInputElement).value = '';
    if (files.length === 0) return;
    error = '';
    uploading = files.length;
    for (const f of files) {
      try {
        const fileId = await uploadFile(f, {
          title: orgName ? `${orgName} — ${f.name}` : f.name
        });
        const row = await addOrgPhoto({
          organization_id: orgId,
          file_id: fileId,
          type_id: uploadTypeId === '' ? null : uploadTypeId
        });
        photos = [...photos, row];
      } catch (err) {
        error = formatError(err);
      } finally {
        uploading--;
      }
    }
  }

  async function setType(p: OrganizationPhoto, v: string) {
    busyId = p.id;
    error = '';
    try {
      const updated = await updateOrgPhoto(p.id, { type_id: v === '' ? null : Number(v) });
      photos = photos.map((x) => (x.id === p.id ? updated : x));
    } catch (e) {
      error = formatError(e);
    } finally {
      busyId = null;
    }
  }

  async function setCaption(p: OrganizationPhoto, v: string) {
    const caption = v.trim() || null;
    if (caption === (p.caption ?? null)) return;
    busyId = p.id;
    error = '';
    try {
      const updated = await updateOrgPhoto(p.id, { caption });
      photos = photos.map((x) => (x.id === p.id ? updated : x));
    } catch (e) {
      error = formatError(e);
    } finally {
      busyId = null;
    }
  }

  async function remove(p: OrganizationPhoto) {
    busyId = p.id;
    error = '';
    try {
      await deleteOrgPhoto(p.id);
      const wasOpen = open !== null && photos[open]?.id === p.id;
      photos = photos.filter((x) => x.id !== p.id);
      if (wasOpen) open = photos.length === 0 ? null : Math.min(open!, photos.length - 1);
    } catch (e) {
      error = formatError(e);
    } finally {
      busyId = null;
    }
  }

  // ── Lightbox ────────────────────────────────────────────────────
  let open = $state<number | null>(null);
  const current = $derived(open === null ? null : (photos[open] ?? null));

  function step(dir: 1 | -1) {
    if (open === null || photos.length === 0) return;
    open = (open + dir + photos.length) % photos.length;
  }
  function onKey(e: KeyboardEvent) {
    if (open === null) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.key === 'Escape') open = null;
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  }
  let touchX = 0;
  function onTouchStart(e: TouchEvent) {
    touchX = e.touches[0].clientX;
  }
  function onTouchEnd(e: TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="card">
  <div class="card-header">
    <span class="card-title">
      <Icon name="sparkles" size={16} /> Photos
      {#if photos.length > 0}<span class="font-normal text-ink-300">{photos.length}</span>{/if}
    </span>
    <span class="flex items-center gap-2">
      <select class="input !w-auto !py-1 text-xs" bind:value={uploadTypeId} title="Type for new uploads">
        <option value="">No type</option>
        {#each types as t (t.id)}
          <option value={t.id}>{t.name}</option>
        {/each}
      </select>
      <button class="btn-ghost !px-2 text-xs" disabled={uploading > 0} onclick={() => fileInput?.click()}>
        {uploading > 0 ? `Uploading ${uploading}…` : '+ Add photos'}
      </button>
      <input
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        bind:this={fileInput}
        onchange={onPick}
      />
    </span>
  </div>

  {#if error}
    <div class="px-4 py-2 text-xs" style="color: #C0392B;">{error}</div>
  {/if}

  {#if loading}
    <div class="px-4 py-6 text-center text-sm text-ink-400">Loading…</div>
  {:else if photos.length === 0}
    <div class="px-4 py-6 text-center text-sm text-ink-400">
      No photos yet — add group photos, location shots, product pictures…
    </div>
  {:else}
    <ul class="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
      {#each photos as p, i (p.id)}
        <li class="space-y-1.5" class:opacity-60={busyId === p.id}>
          <button
            type="button"
            class="group relative block w-full cursor-pointer overflow-hidden rounded-md border border-surface-border focus-visible:ring-2 focus-visible:ring-brand"
            style="background: var(--bg-tertiary); aspect-ratio: 4 / 3;"
            aria-label={`Open ${p.caption ?? typeName(p) ?? 'photo'}`}
            onclick={() => (open = i)}
          >
            <img
              src={assetUrl(p.file_id, { width: 480, height: 360, fit: 'cover' })}
              alt={p.caption ?? typeName(p) ?? 'Organization photo'}
              loading="lazy"
              class="h-full w-full object-cover transition group-hover:opacity-90"
            />
            {#if typeName(p)}
              <span
                class="absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase"
                style="background: rgba(0,0,0,0.55); color: #fff; letter-spacing: 0.06em;"
              >{typeName(p)}</span>
            {/if}
            <span
              class="absolute right-1.5 top-1.5 hidden cursor-pointer rounded-full p-1 group-hover:block"
              style="background: rgba(0,0,0,0.55); color: #fff;"
              title="Remove photo"
              aria-label="Remove photo"
              role="button"
              tabindex="-1"
              onclick={(e) => {
                e.stopPropagation();
                void remove(p);
              }}
            >
              <Icon name="x" size={12} />
            </span>
          </button>
          <select
            class="input w-full !py-0.5 text-[11px]"
            value={String(typeIdOf(p))}
            disabled={busyId === p.id}
            onchange={(e) => setType(p, (e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">No type</option>
            {#each types as t (t.id)}
              <option value={String(t.id)}>{t.name}</option>
            {/each}
          </select>
          <input
            class="input w-full !py-0.5 text-[11px]"
            placeholder="Caption…"
            value={p.caption ?? ''}
            disabled={busyId === p.id}
            onchange={(e) => setCaption(p, (e.currentTarget as HTMLInputElement).value)}
          />
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if current}
  <!-- Lightbox — same shell as the /photos browser, with this gallery's
       controls (type, caption, centre point, original, remove). -->
  <div
    class="fixed inset-0 z-50 flex flex-col bg-black/90"
    role="dialog"
    aria-modal="true"
    aria-label={current.caption ?? typeName(current) ?? 'Organization photo'}
    ontouchstart={onTouchStart}
    ontouchend={onTouchEnd}
  >
    <div class="flex items-center justify-between gap-3 p-3 text-white/80">
      <div class="min-w-0 text-xs">
        <div class="truncate font-medium text-white">
          {current.caption ?? typeName(current) ?? 'Photo'}
        </div>
        <div>{orgName}{orgName ? ' · ' : ''}{open! + 1} / {photos.length}</div>
      </div>
      <a
        href={assetUrl(current.file_id)}
        target="_blank"
        rel="noreferrer"
        class="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium hover:bg-white/20"
      >
        <Icon name="download" size={13} /> Original
      </a>
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
      <img
        src={assetUrl(current.file_id, { width: 1600, withoutEnlargement: 'true' })}
        alt={current.caption ?? typeName(current) ?? ''}
        class="max-h-full max-w-full object-contain"
        onclick={(e) => e.stopPropagation()}
      />
      {#if photos.length > 1}
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
    </div>

    <!-- Controls strip — the grid's options plus the Studio centre point. -->
    <div class="flex flex-wrap items-end justify-center gap-x-6 gap-y-3 bg-black/60 p-3">
      <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-white/50">
        Type
        <select
          class="input !w-auto !py-1 text-xs"
          value={String(typeIdOf(current))}
          disabled={busyId === current.id}
          onchange={(e) => setType(current!, (e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">No type</option>
          {#each types as t (t.id)}
            <option value={String(t.id)}>{t.name}</option>
          {/each}
        </select>
      </label>
      <label class="flex w-56 flex-col gap-1 text-[10px] uppercase tracking-wider text-white/50">
        Caption
        <input
          class="input w-full !py-1 text-xs"
          placeholder="Caption…"
          value={current.caption ?? ''}
          disabled={busyId === current.id}
          onchange={(e) => setCaption(current!, (e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      {#if current.file_id}
        <div class="text-white/80">
          <FocalPointEditor fileId={current.file_id} />
        </div>
      {/if}
      <button
        type="button"
        class="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium text-white/80 transition hover:bg-white/20"
        disabled={busyId === current.id}
        onclick={() => current && remove(current)}
      >
        <Icon name="x" size={13} /> Remove
      </button>
    </div>
  </div>
{/if}
