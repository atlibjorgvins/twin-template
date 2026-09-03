<script lang="ts">
  // Ad previews — pull a campaign's ad creatives from Meta, save them,
  // and view each one fitted to the common placement formats (feed /
  // portrait / story) via Directus image transforms. No overlay (v1).
  import Icon from '$lib/Icon.svelte';
  import {
    assetUrl,
    fetchCampaignAds,
    importImageFromUrl,
    createAdPreview,
    deleteAdPreview,
    formatError,
    type MetaCampaignRow,
    type AdPreview
  } from '$lib/directus';

  let {
    data
  }: {
    data: { campaigns: MetaCampaignRow[]; previews: AdPreview[]; error: string | null };
  } = $props();

  let previews = $state<AdPreview[]>([...data.previews]);
  let errorMsg = $state<string | null>(data.error);
  let campaignId = $state<string>(''); // selected campaign meta_id
  let fetching = $state(false);
  let progress = $state<string | null>(null);
  let replaceExisting = $state(false); // re-import + replace already-saved creatives

  // Campaigns that have a Meta id (fetchable).
  const fetchable = $derived(data.campaigns.filter((c) => c.meta_id));

  const FORMATS = [
    { key: '1:1', label: 'Feed', w: 1080, h: 1080 },
    { key: '4:5', label: 'Portrait', w: 1080, h: 1350 },
    { key: '9:16', label: 'Story', w: 1080, h: 1920 }
  ];
  // One reasonably-sized render of the creative, never upscaled — the CSS
  // frames it per format with `object-fit: contain` so nothing is cropped
  // and tiny (video-thumbnail) creatives stay sharp instead of stretched.
  function src(fileId: string): string {
    return assetUrl(fileId, { width: 800, fit: 'inside', withoutEnlargement: 'true' });
  }
  function frameW(f: { w: number; h: number }): number {
    return Math.round((150 * f.w) / f.h);
  }

  async function fetchCreatives() {
    if (!campaignId) {
      errorMsg = 'Pick a campaign first.';
      return;
    }
    fetching = true;
    errorMsg = null;
    progress = 'Reading ads from Meta…';
    const campaign = fetchable.find((c) => String(c.meta_id) === campaignId);
    const cname = campaign?.name ?? 'Campaign';
    try {
      const ads = (await fetchCampaignAds(campaignId)).filter((a) => a.imageUrl);
      const have = new Set(previews.map((p) => p.item_id));
      const todo = replaceExisting ? ads : ads.filter((a) => !have.has(a.id));
      if (todo.length === 0) {
        progress = ads.length ? 'All creatives already saved — tick Replace to refresh.' : 'No ads with images on this campaign.';
        fetching = false;
        return;
      }
      let saved = 0;
      let skipped = 0;
      for (let i = 0; i < todo.length; i++) {
        const ad = todo[i];
        progress = `Saving ${i + 1}/${todo.length}: ${ad.name}`;
        try {
          const fileId = await importImageFromUrl(ad.imageUrl!, `${cname} — ${ad.name}`);
          if (!fileId) {
            skipped++; // Meta gave a video/redirect, not a real image
            continue;
          }
          if (replaceExisting) {
            for (const old of previews.filter((p) => p.item_id === ad.id)) await deleteAdPreview(old.id).catch(() => {});
            previews = previews.filter((p) => p.item_id !== ad.id);
          }
          const row = await createAdPreview({
            adMetaId: ad.id,
            label: `${ad.name} · ${cname}`,
            fileId,
            variant: ad.isThumb ? 'Thumbnail' : 'Creative'
          });
          previews = [row, ...previews];
          saved++;
        } catch (e) {
          errorMsg = `Some failed — ${formatError(e)}`;
        }
      }
      progress = `Saved ${saved}${skipped ? `, skipped ${skipped} (no usable image — likely video)` : ''}.`;
    } catch (e) {
      errorMsg = formatError(e);
      progress = null;
    } finally {
      fetching = false;
    }
  }

  async function remove(p: AdPreview) {
    if (!confirm(`Remove the saved preview "${p.item_label}"?`)) return;
    try {
      await deleteAdPreview(p.id);
      previews = previews.filter((x) => x.id !== p.id);
    } catch (e) {
      errorMsg = formatError(e);
    }
  }
</script>

<svelte:head><title>Ad previews · Marketing</title></svelte:head>

<section class="space-y-5">
  <div>
    <a href="/marketing/live" class="text-xs text-ink-400 hover:underline">← Live</a>
    <h2 class="font-display mt-1 text-lg font-bold text-ink-900">Ad previews</h2>
    <p class="mt-1 text-sm text-ink-500">
      Pull a campaign's ad creatives from Meta and save them — each one shown fitted to the feed,
      portrait, and story formats.
    </p>
  </div>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 text-sm" style="color: #C0392B;">{errorMsg}</div>
  {/if}

  <!-- Fetch -->
  <div class="flex flex-wrap items-center gap-2 rounded-[14px] border border-surface-border bg-surface-card p-3">
    <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Campaign</span>
    <select class="input !w-auto !py-1.5 text-sm" bind:value={campaignId} disabled={fetching}>
      <option value="">Select a campaign…</option>
      {#each fetchable as c (c.id)}<option value={String(c.meta_id)}>{c.name}</option>{/each}
    </select>
    <button class="btn-primary text-sm" disabled={fetching || !campaignId} onclick={fetchCreatives}>
      {fetching ? 'Fetching…' : 'Fetch & save creatives'}
    </button>
    <label class="flex items-center gap-1.5 text-xs text-ink-600" title="Re-import and replace creatives already saved for this campaign's ads">
      <input type="checkbox" bind:checked={replaceExisting} disabled={fetching} /> Replace existing
    </label>
    {#if progress}<span class="text-xs text-ink-500">{progress}</span>{/if}
  </div>

  <!-- Saved previews -->
  {#if previews.length === 0}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-10 text-center text-ink-500">
      <span class="inline-flex text-ink-300"><Icon name="image" size={28} /></span>
      <p class="mt-2">No saved ad previews yet — pick a campaign and fetch its creatives.</p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each previews as p (p.id)}
        {#if p.file_id}
          <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
            <div class="mb-2 flex items-center justify-between gap-2">
              <span class="min-w-0 truncate text-sm font-medium text-ink-900">
                {p.item_label}
                {#if p.variant === 'Thumbnail'}<span class="ml-1.5 rounded-full bg-tag-sales/30 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-tag-salesText" title="Meta only exposed a small thumbnail (often a video ad)">thumbnail · low-res</span>{/if}
              </span>
              <button class="shrink-0 text-ink-300 hover:text-tag-salesText" onclick={() => remove(p)} aria-label="Remove preview"><Icon name="x" size={14} /></button>
            </div>
            <div class="flex flex-wrap gap-4">
              {#each FORMATS as f (f.key)}
                <div class="text-center">
                  <a href={assetUrl(p.file_id, {})} target="_blank" rel="noreferrer" title="Open the full creative">
                    <div class="overflow-hidden rounded-md border border-surface-border" style="height:150px; width:{frameW(f)}px; background: var(--bg-tertiary);">
                      <img src={src(p.file_id)} alt={`${p.item_label} ${f.key}`} class="h-full w-full" style="object-fit:contain;" />
                    </div>
                  </a>
                  <div class="mt-1 text-[10px] text-ink-400">{f.label} · {f.key}</div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</section>
