<script lang="ts">
  // Upload an order-confirmation screenshot → OCR on the NAS → review → save.
  //
  // The review step is not optional politeness: the recogniser cannot print
  // uppercase Þ or Ð, the page carries no year, and allergen information is
  // icons only (never OCR-able). So the parse is always shown as editable rows
  // before anything is written, and the source screenshot is stored alongside
  // so a questionable row can be checked against what was actually on screen.
  import Icon from '$lib/Icon.svelte';
  import { uploadFile } from '$lib/directus';
  import { ocrImage, ocrHealth, ocrConfigured, type OcrResponse, type OcrStatus } from '$lib/food/ocr';
  import { parseFoodOrder, type MealKey } from '$lib/food/parseFoodOrder';
  import { saveFoodOrders, type FoodOrderDraft } from '$lib/food/data';

  type Row = FoodOrderDraft & { keep: boolean };

  // Labels are English like the rest of twin's chrome; only the ordered
  // content stays in the language the canteen printed it in.
  const MEALS: { value: MealKey; label: string }[] = [
    { value: 'breakfast', label: 'Breakfast' },
    { value: 'lunch', label: 'Lunch' },
    { value: 'dinner', label: 'Dinner' }
  ];

  let file = $state<File | null>(null);
  let previewUrl = $state<string | null>(null);
  let busy = $state(false);
  let stage = $state<'idle' | 'ocr' | 'saving'>('idle');
  let error = $state('');
  let rows = $state<Row[]>([]);
  let emptyDates = $state<string[]>([]);
  let ocr = $state<OcrResponse | null>(null);
  let saved = $state<{ created: number; updated: number } | null>(null);
  let health = $state<OcrStatus | null>(null);

  const keepCount = $derived(rows.filter((r) => r.keep).length);

  $effect(() => {
    if (!ocrConfigured()) {
      health = { state: 'unset' };
      return;
    }
    void ocrHealth().then((h) => (health = h));
  });

  function reset() {
    rows = [];
    emptyDates = [];
    ocr = null;
    saved = null;
    error = '';
  }

  function pick(ev: Event) {
    const f = (ev.currentTarget as HTMLInputElement).files?.[0] ?? null;
    reset();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = f ? URL.createObjectURL(f) : null;
    file = f;
    if (f) void run(f);
  }

  /** Accept a screenshot pasted straight from the clipboard — that is how the
   *  image gets here in the first place, so making the user save it to disk
   *  first is a step for nothing. */
  function onPaste(ev: ClipboardEvent) {
    const item = [...(ev.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const f = item.getAsFile();
    if (!f) return;
    ev.preventDefault();
    reset();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(f);
    file = f;
    void run(f);
  }

  async function run(f: File) {
    busy = true;
    stage = 'ocr';
    error = '';
    try {
      const res = await ocrImage(f);
      ocr = res;
      const parsed = parseFoodOrder(res.lines);
      rows = parsed.entries.map((e) => ({
        order_date: e.date,
        meal: e.meal ?? 'lunch',
        restaurant: e.restaurant,
        dish: e.dish,
        diet: e.diet,
        notes: null,
        source_image: null,
        ocr_confidence: e.confidence,
        keep: true
      }));
      emptyDates = parsed.emptyDates;
      if (rows.length === 0) {
        error = 'No meals found in that image. Is it the order confirmation page?';
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      stage = 'idle';
    }
  }

  function addRow() {
    const last = rows[rows.length - 1];
    rows = [
      ...rows,
      {
        order_date: last?.order_date ?? new Date().toISOString().slice(0, 10),
        meal: 'lunch',
        restaurant: '',
        dish: '',
        diet: [],
        notes: null,
        source_image: null,
        ocr_confidence: null,
        keep: true
      }
    ];
  }

  async function save() {
    const keep = rows.filter((r) => r.keep);
    if (keep.length === 0) return;
    busy = true;
    stage = 'saving';
    error = '';
    try {
      // The screenshot is uploaded once and every row points at it, so a row
      // can always be checked against the image it came from.
      let imageId: string | null = null;
      if (file) {
        try {
          imageId = await uploadFile(file, { title: `Food order ${keep[0].order_date}` });
        } catch {
          // A failed upload must not lose the parse — save the rows anyway.
          imageId = null;
        }
      }
      const drafts: FoodOrderDraft[] = keep.map(({ keep: _keep, ...d }) => ({
        ...d,
        source_image: imageId
      }));
      saved = await saveFoodOrders(drafts);
      rows = [];
      file = null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      stage = 'idle';
    }
  }

  function fmtDay(iso: string): string {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
</script>

<svelte:window onpaste={onPaste} />

<svelte:head><title>Food orders · twin</title></svelte:head>

<section class="space-y-4">
  <header class="flex items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-semibold text-ink-900">Food orders</h1>
      <p class="text-sm text-ink-500">
        Upload or paste the order confirmation screenshot — the NAS reads it and you confirm what gets saved.
      </p>
    </div>
    <a href="/tools" class="btn-ghost shrink-0"><Icon name="chevron-left" size={14} /> Tools</a>
  </header>

  <!-- Three different faults, three different fixes. Saying "check the
       tailnet" for a CORS block sends you chasing the wrong thing. -->
  {#if health?.state === 'unset'}
    <div class="card p-3 text-sm text-tag-salesText">
      <Icon name="bell" size={14} /> PUBLIC_OCR_URL isn't set, so there's no OCR service to call. Add it to <code>.env</code> and restart the dev server.
    </div>
  {:else if health?.state === 'cors'}
    <div class="card p-3 text-sm text-tag-salesText">
      <Icon name="bell" size={14} />
      The OCR service is up, but it's refusing calls from this page ({health.origin}).
      That's the CORS middleware missing from the running container — rebuild and redeploy
      <code>twin-ocr:2.1.0</code> (see docs/ocr-service-plan.md, “Second consumer”). Nothing wrong with your network.
    </div>
  {:else if health?.state === 'down'}
    <div class="card p-3 text-sm text-tag-salesText">
      <Icon name="bell" size={14} /> The OCR service isn't answering at all. It lives on the NAS and is tailnet-only — check you're on the tailnet.
    </div>
  {/if}

  <!-- ── Upload ─────────────────────────────────────────────────── -->
  <div class="card p-4">
    <div class="flex flex-wrap items-center gap-3">
      <label class="btn-primary cursor-pointer">
        <Icon name="image" size={14} /> Choose screenshot
        <input type="file" accept="image/*" class="hidden" onchange={pick} disabled={busy} />
      </label>
      <span class="text-xs text-ink-400">…or press ⌘V to paste one.</span>
      {#if busy && stage === 'ocr'}
        <span class="text-xs text-ink-500">Reading the image on the NAS… (~12s)</span>
      {/if}
    </div>

    {#if previewUrl}
      <div class="mt-3 flex items-start gap-4">
        <img src={previewUrl} alt="Uploaded order screenshot" class="max-h-48 rounded-lg border border-surface-divider" />
        {#if ocr}
          <div class="text-xs text-ink-400">
            <div>{ocr.line_count} lines read</div>
            <div>mean score {(ocr.mean_score * 100).toFixed(1)}%</div>
            <div>{ocr.seconds.toFixed(1)}s</div>
          </div>
        {/if}
      </div>
    {/if}

    {#if error}
      <p class="mt-3 text-sm text-tag-salesText">{error}</p>
    {/if}
  </div>

  <!-- ── Review ─────────────────────────────────────────────────── -->
  {#if rows.length > 0}
    <div class="card">
      <div class="card-header">
        <span class="card-title"><Icon name="check" size={16} /> Review — {keepCount} of {rows.length} will be saved</span>
        <button class="btn-ghost" onclick={addRow} disabled={busy}>+ Add row</button>
      </div>

      <ul class="space-y-2 px-4 pb-4">
        {#each rows as row, i (i)}
          <li class="rounded-[10px] border border-surface-divider bg-surface-hover/40 p-3" class:opacity-50={!row.keep}>
            <div class="flex flex-wrap items-center gap-2">
              <input type="checkbox" bind:checked={rows[i].keep} aria-label="Include this row" class="shrink-0" />
              <input type="date" class="input !w-auto" bind:value={rows[i].order_date} aria-label="Date" />
              <select class="input !w-auto" bind:value={rows[i].meal} aria-label="Meal">
                {#each MEALS as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
              </select>
              <input class="input flex-1 min-w-[8rem]" bind:value={rows[i].restaurant} placeholder="Restaurant" aria-label="Restaurant" />
              {#if row.ocr_confidence != null && row.ocr_confidence < 0.9}
                <span class="rounded-full bg-tag-sales/15 px-2 py-0.5 text-[10px] text-tag-salesText" title="Low recogniser score — check this one">
                  {(row.ocr_confidence * 100).toFixed(0)}%
                </span>
              {/if}
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <input class="input flex-1 min-w-[12rem]" bind:value={rows[i].dish} placeholder="Dish" aria-label="Dish" />
              {#each row.diet ?? [] as d (d)}
                <span class="rounded-full bg-tag-eventText/10 px-2 py-0.5 text-[11px] text-tag-eventText">{d}</span>
              {/each}
            </div>
          </li>
        {/each}
      </ul>

      {#if emptyDates.length > 0}
        <p class="border-t border-surface-divider px-4 py-2 text-xs text-ink-400">
          Nothing was ordered on {emptyDates.map(fmtDay).join(', ')} — no rows created for those.
        </p>
      {/if}

      <div class="flex justify-end gap-2 border-t border-surface-divider px-4 py-3">
        <button class="btn-ghost" onclick={reset} disabled={busy}>Discard</button>
        <button class="btn-primary" onclick={save} disabled={busy || keepCount === 0}>
          {stage === 'saving' ? 'Saving…' : `Save ${keepCount} meal${keepCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  {/if}

  {#if saved}
    <div class="card p-4 text-sm">
      <Icon name="check" size={14} />
      Saved — {saved.created} new, {saved.updated} updated.
      <a href="/" class="ml-1 text-tag-eventText hover:underline">See it on the front page</a>
    </div>
  {/if}
</section>
