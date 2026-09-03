<script lang="ts">
  // Spend — the ledger. Every medium in one place.
  //
  // What this replaces: /tools/campaigns/spend, which listed hand-entered rows
  // only, so "what did we spend" had two answers depending on which page you
  // were standing on. Meta rows appear here too, read-only, because a ledger
  // that omits 95% of the money is not a ledger.
  //
  // Hand-entered rows carry a `medium` from the shared vocabulary rather than
  // the old free-text `channel`, which is what lets a by-medium split cross
  // paid and manual.
  import Icon from '$lib/Icon.svelte';
  import { formatError } from '$lib/directus';
  import {
    createManualSpendRow,
    deleteManualSpendRow,
    updateManualSpendRow,
    type ManualSpendInput
  } from '$lib/marketing/data';
  import {
    computeMarketing,
    daysBefore,
    emptyMarketingFilters,
    formatMoney,
    type ManualRow,
    type MarketingBundle
  } from '$lib/marketing/metrics';
  import { manualMediums, mediumLabel } from '$lib/marketing/media';
  import type { EventRecord } from '$lib/events/data';

  let {
    data
  }: { data: { bundle: MarketingBundle; events: EventRecord[]; error: string | null } } = $props();

  let bundle = $state<MarketingBundle>(data.bundle);
  let errorMsg = $state<string | null>(data.error);
  let busy = $state(false);

  // A fresh load must win over the local copy — invalidate() after a write
  // elsewhere, or a back-navigation, both re-run the loader.
  $effect(() => {
    bundle = data.bundle;
  });

  const PERIODS = [
    { key: '30d', label: '30 days', days: 30 },
    { key: '90d', label: '90 days', days: 90 },
    { key: '365d', label: '12 months', days: 365 }
  ];
  let period = $state('90d');
  let source = $state<'all' | 'manual' | 'meta'>('all');

  const filters = $derived.by(() => {
    const f = emptyMarketingFilters();
    const days = PERIODS.find((p) => p.key === period)?.days ?? 90;
    f.until = bundle.window.until;
    f.since = daysBefore(bundle.window.until, days);
    if (source !== 'all') f.sources = new Set([source]);
    return f;
  });
  const m = $derived(computeMarketing(bundle, filters));

  // One row per campaign-day would be unreadable at 365 rows, so Meta rows are
  // grouped per campaign for the ledger view. The daily detail is what
  // /marketing/live is for.
  const ledger = $derived.by(() => {
    type Row = {
      key: string;
      label: string;
      medium: string;
      project: string;
      dates: string;
      amount: number;
      currency: string;
      source: 'meta' | 'manual';
      manual?: ManualRow;
    };
    const projectName = new Map(bundle.projects.map((p) => [p.id, p.name]));
    const out: Row[] = [];

    // Meta: fold to campaign × medium, keeping the date span.
    const groups = new Map<string, { spend: number; first: string; last: string; row: (typeof m.rows)[number] }>();
    for (const r of m.rows) {
      if (r.source !== 'meta') continue;
      const k = `${r.refId ?? r.campaignId}|${r.medium}`;
      const g = groups.get(k);
      if (!g) groups.set(k, { spend: r.amount, first: r.date, last: r.date, row: r });
      else {
        g.spend += r.amount;
        if (r.date < g.first) g.first = r.date;
        if (r.date > g.last) g.last = r.date;
      }
    }
    for (const [k, g] of groups) {
      out.push({
        key: `meta:${k}`,
        label: g.row.label ?? 'Untitled campaign',
        medium: mediumLabel(bundle.mediums, g.row.medium),
        project: g.row.projectId != null ? (projectName.get(g.row.projectId) ?? `#${g.row.projectId}`) : 'Unassigned',
        dates: g.first === g.last ? g.first : `${g.first} → ${g.last}`,
        amount: g.spend,
        currency: g.row.currency,
        source: 'meta'
      });
    }

    // Manual: one row each, editable.
    for (const r of bundle.manual) {
      if (filters.since && r.date < filters.since) continue;
      if (filters.until && r.date > filters.until) continue;
      if (source === 'meta') continue;
      out.push({
        key: `manual:${r.id}`,
        label: r.label ?? '(no label)',
        medium: mediumLabel(bundle.mediums, r.medium),
        project: r.projectId != null ? (projectName.get(r.projectId) ?? `#${r.projectId}`) : 'Unassigned',
        dates: r.endDate ? `${r.date} → ${r.endDate}` : r.date,
        amount: r.amount,
        currency: r.currency,
        source: 'manual',
        manual: r
      });
    }
    return out.sort((a, b) => b.amount - a.amount);
  });

  const manualTotal = $derived(m.bySource.find((s) => s.key === 'manual')?.spend ?? 0);
  const metaTotal = $derived(m.bySource.find((s) => s.key === 'meta')?.spend ?? 0);
  const money = (n: number) => formatMoney(Math.round(n), m.kpi.currency);

  const projectOptions = $derived.by(() => {
    const byParent = new Map<number | null, typeof bundle.projects>();
    for (const p of bundle.projects) {
      if (!byParent.has(p.parentId)) byParent.set(p.parentId, []);
      byParent.get(p.parentId)!.push(p);
    }
    const out: { id: number; label: string }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const p of (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'is'))) {
        out.push({ id: p.id, label: `${'  '.repeat(depth)}${p.name}` });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });
  const pickable = $derived(manualMediums(bundle.mediums));

  // ── Draft (new + edit) ──────────────────────────────────────────────
  type Draft = ManualSpendInput & { id: number | null };
  const blank = (): Draft => ({
    id: null,
    label: '',
    medium: pickable[0]?.code ?? 'other',
    amount: 0,
    currency: 'ISK',
    date: bundle.window.until,
    endDate: null,
    projectId: null,
    eventId: null,
    notes: null
  });
  let draft = $state<Draft | null>(null);
  const editing = $derived(draft?.id != null);
  // Bound to the inputs; `null` and `0` are awkward to bind directly.
  let amountText = $state('');
  let projectText = $state('');
  let eventText = $state('');

  function startNew() {
    draft = blank();
    amountText = '';
    projectText = '';
    eventText = '';
  }
  function startEdit(r: ManualRow) {
    draft = {
      id: r.id,
      label: r.label ?? '',
      medium: r.medium,
      amount: r.amount,
      currency: r.currency,
      date: r.date,
      endDate: r.endDate,
      projectId: r.projectId,
      eventId: r.eventId,
      notes: r.notes
    };
    amountText = String(r.amount);
    projectText = r.projectId != null ? String(r.projectId) : '';
    eventText = r.eventId != null ? String(r.eventId) : '';
  }

  async function save() {
    if (!draft) return;
    const amount = Number(amountText);
    if (!draft.label?.trim() || !Number.isFinite(amount) || amount <= 0 || !draft.date) {
      errorMsg = 'Need a label, a positive amount and a date.';
      return;
    }
    busy = true;
    errorMsg = null;
    const input: ManualSpendInput = {
      label: draft.label.trim(),
      medium: draft.medium,
      amount,
      currency: (draft.currency || 'ISK').trim(),
      date: draft.date,
      endDate: draft.endDate || null,
      projectId: projectText ? Number(projectText) : null,
      eventId: eventText ? Number(eventText) : null,
      notes: draft.notes?.trim() || null
    };
    try {
      if (draft.id != null) {
        const saved = await updateManualSpendRow(draft.id, input);
        bundle = { ...bundle, manual: bundle.manual.map((x) => (x.id === saved.id ? saved : x)) };
      } else {
        const saved = await createManualSpendRow(input);
        bundle = { ...bundle, manual: [saved, ...bundle.manual] };
      }
      draft = null;
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      busy = false;
    }
  }

  async function remove(r: ManualRow) {
    if (!confirm(`Delete "${r.label ?? r.id}"?`)) return;
    errorMsg = null;
    try {
      await deleteManualSpendRow(r.id);
      bundle = { ...bundle, manual: bundle.manual.filter((x) => x.id !== r.id) };
      if (draft?.id === r.id) draft = null;
    } catch (e) {
      errorMsg = formatError(e);
    }
  }
</script>

<svelte:head><title>Spend · Marketing</title></svelte:head>

<section class="space-y-5">
  <div class="flex flex-wrap items-center gap-3 rounded-[14px] border border-surface-border bg-surface-card p-3">
    <div class="flex gap-1">
      {#each PERIODS as p (p.key)}
        <button
          class="rounded-full px-2.5 py-1 text-xs font-medium transition"
          style={period === p.key
            ? 'background: var(--accent-electric); color: white;'
            : 'background: var(--bg-tertiary); color: var(--text-secondary);'}
          onclick={() => (period = p.key)}
        >{p.label}</button>
      {/each}
    </div>
    <div class="flex gap-1">
      {#each [['all', 'Everything'], ['meta', 'Meta'], ['manual', 'Hand-entered']] as [key, label] (key)}
        <button
          class="rounded-full px-2.5 py-1 text-xs font-medium transition"
          style={source === key
            ? 'background: var(--bg-secondary); color: var(--text-primary); box-shadow: inset 0 0 0 1px var(--border-default);'
            : 'color: var(--text-tertiary);'}
          onclick={() => (source = key as typeof source)}
        >{label}</button>
      {/each}
    </div>
    <button class="btn-primary ml-auto text-xs" onclick={startNew}>+ Add spend</button>
  </div>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 text-sm" style="color: #C0392B;">
      {errorMsg}
    </div>
  {/if}

  <div class="grid grid-cols-3 gap-3">
    <div class="rounded-[10px] p-2.5" style="background: var(--bg-tertiary);">
      <div class="text-[10px] uppercase tracking-wide text-ink-400">Total</div>
      <div class="text-base font-semibold text-ink-900">{money(m.kpi.spend)}</div>
    </div>
    <div class="rounded-[10px] p-2.5" style="background: var(--bg-tertiary);">
      <div class="text-[10px] uppercase tracking-wide text-ink-400">Meta</div>
      <div class="text-base font-semibold text-ink-900">{money(metaTotal)}</div>
    </div>
    <div class="rounded-[10px] p-2.5" style="background: var(--bg-tertiary);">
      <div class="text-[10px] uppercase tracking-wide text-ink-400">Hand-entered</div>
      <div class="text-base font-semibold text-ink-900">{money(manualTotal)}</div>
    </div>
  </div>

  {#if draft}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-3">
      <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">
        {editing ? 'Edit spend' : 'Add spend'}
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-xs text-ink-500">Label</span>
          <input class="input w-full text-sm" bind:value={draft.label} placeholder="e.g. Lækjartorg billboard" />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-ink-500">Medium</span>
          <select class="input w-full text-sm" bind:value={draft.medium}>
            {#each pickable as x (x.code)}<option value={x.code}>{x.label}</option>{/each}
          </select>
        </label>
        <div class="grid grid-cols-[1fr_5rem] gap-2">
          <label class="block">
            <span class="mb-1 block text-xs text-ink-500">Amount</span>
            <input type="number" class="input w-full text-sm" bind:value={amountText} placeholder="0" />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-ink-500">Currency</span>
            <input class="input w-full text-sm" bind:value={draft.currency} />
          </label>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="mb-1 block text-xs text-ink-500">Date</span>
            <input type="date" class="input w-full text-sm" bind:value={draft.date} />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-ink-500">End (optional)</span>
            <input type="date" class="input w-full text-sm" bind:value={draft.endDate} />
          </label>
        </div>
        <label class="block">
          <span class="mb-1 block text-xs text-ink-500">Project</span>
          <select class="input w-full text-sm" bind:value={projectText}>
            <option value="">— none —</option>
            {#each projectOptions as p (p.id)}<option value={String(p.id)}>{p.label}</option>{/each}
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-ink-500">Event (optional)</span>
          <select class="input w-full text-sm" bind:value={eventText}>
            <option value="">— none —</option>
            {#each data.events as ev (ev.id)}<option value={String(ev.id)}>{ev.name}</option>{/each}
          </select>
        </label>
      </div>
      <label class="block">
        <span class="mb-1 block text-xs text-ink-500">Notes</span>
        <input class="input w-full text-sm" bind:value={draft.notes} placeholder="Optional" />
      </label>
      <p class="text-[11px] text-ink-400">
        Spend with no project can't be counted against a budget — it shows up as unattributed on Plan.
      </p>
      <div class="flex items-center gap-2">
        <button class="btn-primary text-sm" disabled={busy} onclick={save}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Add spend'}
        </button>
        <button class="btn-ghost text-sm" onclick={() => (draft = null)}>Cancel</button>
      </div>
    </div>
  {/if}

  <div class="rounded-[14px] border border-surface-border bg-surface-card">
    <div class="flex items-center justify-between px-4 py-3">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        Ledger
      </span>
      <span class="text-xs text-ink-500">{ledger.length} rows · {filters.since} → {filters.until}</span>
    </div>
    {#if ledger.length === 0}
      <p class="px-4 pb-4 text-sm text-ink-400">Nothing in this period.</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-y border-surface-divider text-left text-[10px] uppercase tracking-wide text-ink-400">
              <th class="px-4 py-2">What</th>
              <th class="px-3 py-2">Medium</th>
              <th class="px-3 py-2">Project</th>
              <th class="px-3 py-2">Dates</th>
              <th class="px-3 py-2 text-right">Amount</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {#each ledger as r (r.key)}
              <tr class="border-b border-surface-divider/50">
                <td class="px-4 py-2 text-ink-900">
                  {r.label}
                  {#if r.source === 'meta'}
                    <span class="ml-1 text-[10px] uppercase tracking-wide text-ink-400">Meta</span>
                  {/if}
                </td>
                <td class="px-3 py-2 text-ink-600">{r.medium}</td>
                <td class="px-3 py-2 text-ink-600">{r.project}</td>
                <td class="px-3 py-2 whitespace-nowrap text-[11px] text-ink-500">{r.dates}</td>
                <td class="px-3 py-2 text-right tabular-nums text-ink-800">{formatMoney(Math.round(r.amount), r.currency)}</td>
                <td class="px-3 py-2 text-right whitespace-nowrap">
                  {#if r.manual}
                    <button class="text-ink-300 hover:text-ink-700" aria-label="Edit" onclick={() => startEdit(r.manual!)}>
                      <Icon name="pencil" size={13} />
                    </button>
                    <button class="ml-1 text-ink-300 hover:text-ink-700" aria-label="Delete" onclick={() => remove(r.manual!)}>
                      <Icon name="trash" size={13} />
                    </button>
                  {:else}
                    <a class="text-ink-300 hover:text-ink-700" href="/marketing/live" aria-label="Open in Live">
                      <Icon name="chevron-right" size={13} />
                    </a>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <p class="text-[11px] text-ink-400">
    Meta rows are grouped per campaign and medium — they arrive from the nightly sync and can't be
    edited here. Day-by-day detail lives in <a class="underline" href="/marketing/live">Live</a>.
  </p>
</section>
