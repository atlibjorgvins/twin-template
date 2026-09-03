<script lang="ts">
  // "Photos from this time" — suggests NAS photos whose capture time falls
  // in the event's window, so you can pull the real event photos in without
  // hunting the timeline. Candidates are clustered into time bursts (an
  // event is a dense burst; stray one-off shots fall to the bottom), so
  // even an all-day window surfaces the actual event first. Adding tags the
  // photo to the event and materializes it into the gallery (same path as
  // navigator tagging), so it jumps into the Photos section above.
  import { searchImmichAssets, assetThumbUrl, type ImmichAsset } from '$lib/immich';
  import { tagAssetsToEntity, assetIdsForEntity } from '$lib/photos/explore';
  import { importEventTaggedPhotos, listEventPhotos } from '$lib/events/data';
  import Icon from '$lib/Icon.svelte';

  let {
    eventId,
    start,
    end,
    onAdded = null
  }: { eventId: number; start: string | null; end: string | null; onAdded?: (() => void) | null } = $props();

  type Burst = { startTs: number; endTs: number; assets: ImmichAsset[] };

  let open = $state(false);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let bursts = $state<Burst[]>([]);
  let totalCandidates = $state(0);
  let selectedIds = $state<string[]>([]);
  let adding = $state(false);

  const selectedCount = $derived(selectedIds.length);
  const isSel = (id: string) => selectedIds.includes(id);

  // Pad timed events ±2h (setup / after-party); all-day windows are wide
  // enough already.
  function windowFor(): { after: string; before: string } | null {
    if (!start) return null;
    const s = new Date(start).getTime();
    const e = end ? new Date(end).getTime() : s;
    const pad = e - s < 12 * 3600_000 ? 2 * 3600_000 : 0;
    return { after: new Date(s - pad).toISOString(), before: new Date(e + pad).toISOString() };
  }

  const tsOf = (a: ImmichAsset) => new Date(a.localDateTime || a.fileCreatedAt).getTime();

  function clusterBursts(assets: ImmichAsset[]): Burst[] {
    const sorted = [...assets].sort((a, b) => tsOf(a) - tsOf(b));
    const GAP = 60 * 60_000; // a new burst when >60 min since the last shot
    const out: Burst[] = [];
    for (const a of sorted) {
      const t = tsOf(a);
      const last = out[out.length - 1];
      if (last && t - last.endTs <= GAP) {
        last.assets.push(a);
        last.endTs = t;
      } else {
        out.push({ startTs: t, endTs: t, assets: [a] });
      }
    }
    return out.sort((x, y) => y.assets.length - x.assets.length); // densest first
  }

  async function load() {
    const w = windowFor();
    if (!w) return;
    loading = true;
    error = null;
    try {
      const [tagged, gallery] = await Promise.all([
        assetIdsForEntity('event', eventId),
        listEventPhotos(eventId)
      ]);
      const exclude = new Set<string>([
        ...tagged,
        ...gallery.map((g) => g.source_asset_id).filter((x): x is string => !!x)
      ]);
      const items: ImmichAsset[] = [];
      let page: number | null = 1;
      while (page && items.length < 800) {
        const r = await searchImmichAssets({ takenAfter: w.after, takenBefore: w.before, order: 'asc', page, size: 100 });
        items.push(...r.items);
        page = r.nextPage;
      }
      const cands = items.filter((a) => !exclude.has(a.id));
      totalCandidates = cands.length;
      bursts = clusterBursts(cands);
      loaded = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function toggleOpen() {
    open = !open;
    if (open && !loaded && !loading) void load();
  }
  function toggle(id: string) {
    selectedIds = isSel(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
  }
  function toggleBurst(b: Burst) {
    const ids = b.assets.map((a) => a.id);
    const all = ids.every(isSel);
    selectedIds = all
      ? selectedIds.filter((x) => !ids.includes(x))
      : [...new Set([...selectedIds, ...ids])];
  }

  async function addSelected() {
    if (!selectedIds.length) return;
    adding = true;
    error = null;
    try {
      await tagAssetsToEntity(selectedIds, 'event', eventId);
      await importEventTaggedPhotos(eventId);
      const added = new Set(selectedIds);
      bursts = bursts.map((b) => ({ ...b, assets: b.assets.filter((a) => !added.has(a.id)) })).filter((b) => b.assets.length > 0);
      totalCandidates -= added.size;
      selectedIds = [];
      onAdded?.();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      adding = false;
    }
  }

  function fmtRange(b: Burst): string {
    const dt = (t: number) => new Date(t).toLocaleString('is-IS', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const tm = (t: number) => new Date(t).toLocaleTimeString('is-IS', { hour: '2-digit', minute: '2-digit' });
    return b.startTs === b.endTs ? dt(b.startTs) : `${dt(b.startTs)} – ${tm(b.endTs)}`;
  }
</script>

{#if start}
  <div class="rounded-[14px] border border-surface-border bg-surface-card">
    <button
      type="button"
      class="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left"
      onclick={toggleOpen}
      aria-expanded={open}
    >
      <span class="card-title !mb-0"><Icon name="clock" size={16} /> Photos from this time
        {#if loaded}<span class="font-normal text-ink-300">{totalCandidates}</span>{/if}
      </span>
      <Icon name={open ? 'chevron-left' : 'chevron-right'} size={14} class="text-ink-300" />
    </button>

    {#if open}
      <div class="border-t border-surface-divider p-4">
        {#if loading}
          <div class="text-sm text-ink-400">Scanning the library for photos taken during this event…</div>
        {:else if error}
          <div class="rounded-[10px] border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        {:else if totalCandidates === 0}
          <div class="text-sm text-ink-400">No untagged photos found in this event's window — everything from this time is already on the event, or there are none.</div>
        {:else}
          <p class="mb-3 text-xs text-ink-400">
            Grouped by when they were taken — the event is usually the biggest group. Select what belongs and add it.
          </p>
          <div class="space-y-4">
            {#each bursts as b (b.startTs)}
              {@const allSel = b.assets.every((a) => isSel(a.id))}
              <div>
                <div class="mb-1.5 flex items-center justify-between gap-2">
                  <span class="text-xs font-medium text-ink-700">{fmtRange(b)} <span class="font-normal text-ink-400">· {b.assets.length}</span></span>
                  <button type="button" class="cursor-pointer text-[11px] text-brand hover:underline" onclick={() => toggleBurst(b)}>
                    {allSel ? 'Deselect' : 'Select all'}
                  </button>
                </div>
                <div class="grid grid-cols-4 gap-1 sm:grid-cols-6 md:grid-cols-8">
                  {#each b.assets as a (a.id)}
                    <button
                      type="button"
                      class="relative aspect-square cursor-pointer overflow-hidden rounded-[6px] bg-surface-hover {isSel(a.id) ? 'ring-2 ring-brand' : ''}"
                      onclick={() => toggle(a.id)}
                      aria-pressed={isSel(a.id)}
                      aria-label={`${isSel(a.id) ? 'Deselect' : 'Select'} photo`}
                    >
                      <img src={assetThumbUrl(a.id)} alt="" loading="lazy" class="h-full w-full object-cover" />
                      {#if a.type === 'VIDEO'}
                        <span class="absolute right-0.5 top-0.5 rounded-full bg-black/55 px-1 text-[8px] font-medium text-white">▶</span>
                      {/if}
                      <span class="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full border {isSel(a.id) ? 'border-brand bg-brand text-white' : 'border-white/90 bg-black/30 text-transparent'}">
                        <Icon name="check" size={10} />
                      </span>
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>

          {#if selectedCount > 0}
            <div class="mt-4 flex items-center justify-between gap-2 border-t border-surface-divider pt-3">
              <span class="text-xs text-ink-500">{selectedCount} selected</span>
              <div class="flex items-center gap-2">
                <button type="button" class="btn-ghost text-xs" onclick={() => (selectedIds = [])}>Clear</button>
                <button type="button" class="btn-primary px-3 py-1.5 text-xs disabled:opacity-50" disabled={adding} onclick={addSelected}>
                  {adding ? 'Adding…' : `Add ${selectedCount} to event`}
                </button>
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}
