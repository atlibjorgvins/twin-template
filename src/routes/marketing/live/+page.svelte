<script lang="ts">
  // All Meta campaigns — every imported campaign across all linked ad
  // accounts as a first-class, reportable row. Filter by account /
  // sub-project / status / date, attribute each to a sub-project for
  // roll-up reporting, and expand one to see its daily trend.
  import Icon from '$lib/Icon.svelte';
  import {
    formatMoney,
    setMetaCampaignProject,
    setMetaCampaignEvents,
    setMetaCampaignLiveStatus,
    setMetaCampaignLiveBudget,
    listMetaCampaignDaily,
    fetchCampaignBreakdown,
    fetchCampaignSubLevel,
    formatError,
    type MetaCampaignRow,
    type MetaBreakdownRow,
    type Project
  } from '$lib/directus';
  import type { EventRecord } from '$lib/events/data';
  import MetricsChart from '$lib/campaigns/MetricsChart.svelte';

  let {
    data
  }: {
    data: {
      campaigns: MetaCampaignRow[];
      projects: Pick<Project, 'id' | 'name' | 'parent_id'>[];
      events: EventRecord[];
      eventLinks: { mk_meta_campaign_id: number; event: { id: number; name: string } }[];
      error: string | null;
    };
  } = $props();

  let rows = $state<MetaCampaignRow[]>([...data.campaigns]);
  let errorMsg = $state<string | null>(data.error);

  // ── event tagging (campaign ↔ events, M2M) ──────────────────────────
  // campaign id → [{id,name}], seeded from the loader and kept in sync.
  let eventsByCampaign = $state<Record<number, { id: number; name: string }[]>>(
    data.eventLinks.reduce<Record<number, { id: number; name: string }[]>>((m, l) => {
      (m[l.mk_meta_campaign_id] ??= []).push(l.event);
      return m;
    }, {})
  );
  let eventFilter = $state<string>(''); // '' = any, else event id
  let eventQuery = $state<Record<number, string>>({}); // per-campaign add-event search box
  function eventsOf(id: number): { id: number; name: string }[] {
    return eventsByCampaign[id] ?? [];
  }
  function eventMatches(c: MetaCampaignRow): EventRecord[] {
    const q = (eventQuery[c.id] ?? '').trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(eventsOf(c.id).map((e) => e.id));
    return data.events.filter((e) => !taken.has(e.id) && (e.name ?? '').toLowerCase().includes(q)).slice(0, 8);
  }
  async function toggleEvent(c: MetaCampaignRow, ev: { id: number; name: string }, add: boolean) {
    const cur = eventsOf(c.id);
    const next = add ? [...cur, ev] : cur.filter((e) => e.id !== ev.id);
    eventsByCampaign = { ...eventsByCampaign, [c.id]: next };
    eventQuery = { ...eventQuery, [c.id]: '' };
    try {
      await setMetaCampaignEvents(c.id, next.map((e) => e.id));
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  // ── filters ─────────────────────────────────────────────────────────
  let search = $state('');
  let accountFilter = $state<string>('');
  let projectFilter = $state<string>(''); // '' all · 'none' unassigned · '<id>'
  let statusFilter = $state<string>('');
  let sortBy = $state<'spend' | 'recent' | 'name'>('spend');

  function accountIdOf(c: MetaCampaignRow): string | null {
    return typeof c.ad_account_id === 'object' ? (c.ad_account_id?.id ?? null) : (c.ad_account_id ?? null);
  }
  function accountNameOf(c: MetaCampaignRow): string {
    return typeof c.ad_account_id === 'object' ? (c.ad_account_id?.name ?? '—') : (c.ad_account_id ?? '—');
  }
  function projectIdOf(c: MetaCampaignRow): number | null {
    return typeof c.project_id === 'object' ? (c.project_id?.id ?? null) : (c.project_id ?? null);
  }

  const accounts = $derived.by(() => {
    const m = new Map<string, string>();
    for (const c of rows) {
      const id = accountIdOf(c);
      if (id) m.set(id, accountNameOf(c));
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  });
  const statuses = $derived([...new Set(rows.map((c) => c.status).filter(Boolean))] as string[]);

  // Indented project options for the picker + filter.
  const projectOptions = $derived.by(() => {
    const byParent = new Map<number | null, typeof data.projects>();
    for (const p of data.projects) {
      const parent = p.parent_id;
      const k = parent == null ? null : typeof parent === 'object' ? parent.id : Number(parent);
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(p);
    }
    const out: { id: number; label: string }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const p of byParent.get(parent) ?? []) {
        out.push({ id: p.id, label: `${'  '.repeat(depth)}${p.name ?? `#${p.id}`}` });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });
  const projectName = $derived.by(() => {
    const m = new Map<number, string>();
    for (const p of data.projects) m.set(p.id, p.name ?? `#${p.id}`);
    return m;
  });

  // ── scope the picker to the campaign's main project family ──────────
  // The ad account is linked to a project; that project (+ its
  // descendants) is the relevant set to attribute within.
  function pid(parent: number | { id: number } | null | undefined): number | null {
    return parent == null ? null : typeof parent === 'object' ? parent.id : Number(parent);
  }
  const childrenOf = $derived.by(() => {
    const m = new Map<number, number[]>();
    for (const p of data.projects) {
      const k = pid(p.parent_id as number | { id: number } | null);
      if (k != null) (m.get(k) ?? m.set(k, []).get(k)!).push(p.id);
    }
    return m;
  });
  function subtreeIds(root: number): Set<number> {
    const out = new Set<number>([root]);
    const stack = [root];
    while (stack.length) {
      for (const ch of childrenOf.get(stack.pop()!) ?? []) {
        if (!out.has(ch)) { out.add(ch); stack.push(ch); }
      }
    }
    return out;
  }
  // Main project = the campaign's ad account's project (preferred), else
  // its umbrella's project — both mirror the account→project link.
  function mainProjectIdOf(c: MetaCampaignRow): number | null {
    const acct = typeof c.ad_account_id === 'object' ? c.ad_account_id : null;
    const fromAcct = acct ? pid((acct.project_id ?? null) as number | { id: number } | null) : null;
    if (fromAcct != null) return fromAcct;
    const umb = typeof c.mk_campaign_id === 'object' ? c.mk_campaign_id : null;
    return umb ? pid((umb.project_id ?? null) as number | { id: number } | null) : null;
  }
  // Picker options for one campaign: its main-project subtree (always
  // including the current selection); falls back to the full tree when
  // the account isn't linked to a project.
  function scopedOptions(c: MetaCampaignRow): { id: number; label: string }[] {
    const mp = mainProjectIdOf(c);
    if (mp == null) return projectOptions;
    const ids = subtreeIds(mp);
    const cur = projectIdOf(c);
    if (cur != null) ids.add(cur);
    return projectOptions.filter((o) => ids.has(o.id));
  }

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((c) => {
      if (q && !(c.name ?? '').toLowerCase().includes(q)) return false;
      if (accountFilter && accountIdOf(c) !== accountFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (projectFilter === 'none' && projectIdOf(c) != null) return false;
      if (projectFilter && projectFilter !== 'none' && projectIdOf(c) !== Number(projectFilter)) return false;
      if (eventFilter && !eventsOf(c.id).some((e) => e.id === Number(eventFilter))) return false;
      return true;
    });
    out = [...out].sort((a, b) => {
      if (sortBy === 'spend') return b.totals.spend - a.totals.spend;
      if (sortBy === 'name') return (a.name ?? '').localeCompare(b.name ?? '');
      return (b.totals.lastDate ?? '').localeCompare(a.totals.lastDate ?? '');
    });
    return out;
  });

  const totals = $derived.by(() => {
    let spend = 0, impressions = 0, clicks = 0, results = 0;
    for (const c of filtered) {
      spend += c.totals.spend;
      impressions += c.totals.impressions;
      clicks += c.totals.clicks;
      results += c.totals.results;
    }
    return { spend, impressions, clicks, results, count: filtered.length };
  });

  const STATUS_TONE: Record<string, string> = {
    ACTIVE: 'var(--accent-electric)',
    PAUSED: '#B7791F'
  };

  // ── attribute a campaign to a sub-project ───────────────────────────
  async function assignProject(c: MetaCampaignRow, value: string) {
    const pid = value ? Number(value) : null;
    errorMsg = null;
    try {
      await setMetaCampaignProject(c.id, pid);
      rows = rows.map((x) =>
        x.id === c.id ? { ...x, project_id: pid == null ? null : { id: pid, name: projectName.get(pid) ?? '' } } : x
      );
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  // ── bulk attribution ────────────────────────────────────────────────
  let selectedIds = $state<Set<number>>(new Set());
  let bulkProject = $state<string>('');
  let bulkStatus = $state<string | null>(null);
  let bulkBusy = $state(false);
  const selectedCount = $derived(selectedIds.size);
  function toggleRow(id: number) {
    const s = new Set(selectedIds);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    selectedIds = s;
  }
  const allFilteredSelected = $derived(filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id)));
  function toggleSelectAll() {
    selectedIds = allFilteredSelected ? new Set() : new Set(filtered.map((c) => c.id));
  }
  function clearSel() {
    selectedIds = new Set();
    bulkStatus = null;
  }

  // When every selected campaign shares one main project, scope the
  // bulk dropdown to that family too; otherwise show the full tree.
  const bulkScopedOptions = $derived.by(() => {
    const sel = rows.filter((c) => selectedIds.has(c.id));
    if (!sel.length) return projectOptions;
    const mains = new Set(sel.map((c) => mainProjectIdOf(c)));
    if (mains.size === 1) {
      const mp = [...mains][0];
      if (mp != null) {
        const ids = subtreeIds(mp);
        return projectOptions.filter((o) => ids.has(o.id));
      }
    }
    return projectOptions;
  });

  function localSetProject(ids: Set<number>, pid: number | null) {
    const name = pid != null ? (projectName.get(pid) ?? '') : null;
    rows = rows.map((x) => (ids.has(x.id) ? { ...x, project_id: pid == null ? null : { id: pid, name } } : x));
  }

  async function assignBulk() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const pid = bulkProject ? Number(bulkProject) : null;
    bulkBusy = true;
    bulkStatus = null;
    errorMsg = null;
    let ok = 0;
    try {
      for (const id of ids) {
        await setMetaCampaignProject(id, pid);
        ok++;
      }
      localSetProject(new Set(ids), pid);
      bulkStatus = `Assigned ${ok} campaign${ok === 1 ? '' : 's'}${pid == null ? ' to unassigned' : ` to ${projectName.get(pid) ?? ''}`}.`;
      selectedIds = new Set();
    } catch (e) {
      errorMsg = formatError(e);
      bulkStatus = `Stopped after ${ok}.`;
    } finally {
      bulkBusy = false;
    }
  }

  // Match a campaign name to a project whose (diacritic-folded) name
  // appears in it; longest project name wins so "KLAK health" beats
  // "KLAK".
  function fold(s: string): string {
    return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  const projMatchers = $derived.by(() =>
    data.projects
      .map((p) => ({ id: p.id, name: p.name ?? '', n: fold(p.name ?? '') }))
      .filter((p) => p.n.length >= 3)
      .sort((a, b) => b.n.length - a.n.length)
  );
  // Match within `allowed` (the account's project family) when given,
  // so a campaign never matches a project outside its account.
  function matchProject(campaignName: string, allowed?: Set<number>): { id: number; name: string } | null {
    const cn = fold(campaignName);
    for (const p of projMatchers) if ((!allowed || allowed.has(p.id)) && cn.includes(p.n)) return { id: p.id, name: p.name };
    return null;
  }
  async function autoMatchSelected() {
    const targets = rows.filter((c) => selectedIds.has(c.id));
    if (!targets.length) return;
    const plan = targets
      .map((c) => {
        const mp = mainProjectIdOf(c);
        return { id: c.id, m: matchProject(c.name ?? '', mp != null ? subtreeIds(mp) : undefined) };
      })
      .filter((x): x is { id: number; m: { id: number; name: string } } => x.m != null);
    if (!plan.length) {
      bulkStatus = `No name matches among the ${targets.length} selected.`;
      return;
    }
    bulkBusy = true;
    errorMsg = null;
    let ok = 0;
    try {
      for (const p of plan) {
        await setMetaCampaignProject(p.id, p.m.id);
        const name = p.m.name;
        rows = rows.map((x) => (x.id === p.id ? { ...x, project_id: { id: p.m.id, name } } : x));
        ok++;
      }
      bulkStatus = `Auto-matched ${ok} of ${targets.length} by name · ${targets.length - plan.length} had no match (assign those manually).`;
      selectedIds = new Set();
    } catch (e) {
      errorMsg = formatError(e);
      bulkStatus = `Stopped after ${ok}.`;
    } finally {
      bulkBusy = false;
    }
  }

  // ── two-way controls (write to live Meta, behind a confirm) ─────────
  let controlBusy = $state<number | null>(null);
  let budgetDraft = $state<Record<number, string>>({});
  // The account's currency drives budget minor-unit conversion + display.
  function accountCurrencyOf(c: MetaCampaignRow): string {
    return (typeof c.ad_account_id === 'object' ? c.ad_account_id?.currency : null) || 'ISK';
  }
  // Only campaigns with a known status can be toggled (never guess and
  // risk activating a paused campaign); budget control only when the
  // budget lives at campaign level (not 'adset'/ABO).
  function canToggleStatus(c: MetaCampaignRow): boolean {
    return c.status === 'ACTIVE' || c.status === 'PAUSED';
  }
  function canSetBudget(c: MetaCampaignRow): boolean {
    return c.budget_mode === 'daily' || c.budget_mode === 'lifetime';
  }
  async function toggleLiveStatus(c: MetaCampaignRow) {
    if (!c.meta_id || !canToggleStatus(c)) return;
    const next = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    if (!confirm(`${next === 'PAUSED' ? 'Pause' : 'Activate'} "${c.name}" on Meta? This changes live ad delivery.`)) return;
    controlBusy = c.id;
    errorMsg = null;
    try {
      await setMetaCampaignLiveStatus(c.id, c.meta_id, next);
      rows = rows.map((x) => (x.id === c.id ? { ...x, status: next } : x));
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      controlBusy = null;
    }
  }
  async function applyLiveBudget(c: MetaCampaignRow) {
    if (!c.meta_id || !canSetBudget(c)) return;
    const raw = budgetDraft[c.id];
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || amount <= 0) {
      errorMsg = 'Enter a budget amount.';
      return;
    }
    const mode = c.budget_mode === 'lifetime' ? 'lifetime' : 'daily';
    const cur = accountCurrencyOf(c);
    if (!confirm(`Set ${mode} budget for "${c.name}" to ${formatMoney(amount, cur)} on Meta?`)) return;
    controlBusy = c.id;
    errorMsg = null;
    try {
      await setMetaCampaignLiveBudget(c.id, c.meta_id, mode, amount, cur);
      rows = rows.map((x) => (x.id === c.id ? { ...x, budget_mode: mode, budget_amount: amount } : x));
      budgetDraft = { ...budgetDraft, [c.id]: '' };
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      controlBusy = null;
    }
  }

  // ── expand → lazy daily trend ───────────────────────────────────────
  let expanded = $state<number | null>(null);
  let trends = $state<Record<string, { labels: string[]; spend: number[]; results: number[] } | 'loading'>>({});
  type Deep = {
    placement: MetaBreakdownRow[];
    ageGender: MetaBreakdownRow[];
    region: MetaBreakdownRow[];
    adsets: MetaBreakdownRow[];
  };
  let deep = $state<Record<string, Deep | 'loading'>>({});

  function toggle(c: MetaCampaignRow) {
    if (expanded === c.id) {
      expanded = null;
      return;
    }
    expanded = c.id;
    void loadTrend(c);
    void loadDeep(c);
  }
  async function loadTrend(c: MetaCampaignRow) {
    const key = c.meta_id;
    if (!key || trends[key]) return;
    trends = { ...trends, [key]: 'loading' };
    try {
      const days = await listMetaCampaignDaily(key);
      trends = {
        ...trends,
        [key]: {
          labels: days.map((d) => d.date.slice(5)),
          spend: days.map((d) => d.spend),
          results: days.map((d) => d.results)
        }
      };
    } catch (e) {
      errorMsg = formatError(e);
      trends = { ...trends, [key]: { labels: [], spend: [], results: [] } };
    }
  }
  // Live Graph breakdowns for the campaign, over its active date range.
  async function loadDeep(c: MetaCampaignRow) {
    const key = c.meta_id;
    if (!key || deep[key]) return;
    deep = { ...deep, [key]: 'loading' };
    const range = { since: c.totals.firstDate ?? undefined, until: c.totals.lastDate ?? undefined };
    const [placement, ageGender, region, adsets] = await Promise.all([
      fetchCampaignBreakdown(key, 'publisher_platform', range),
      fetchCampaignBreakdown(key, 'age,gender', range),
      fetchCampaignBreakdown(key, 'region', range),
      fetchCampaignSubLevel(key, 'adset', range)
    ]);
    deep = { ...deep, [key]: { placement, ageGender, region, adsets } };
  }

  function dateRange(c: MetaCampaignRow): string {
    const { firstDate, lastDate } = c.totals;
    if (!firstDate && !lastDate) return '—';
    if (firstDate === lastDate) return firstDate ?? '—';
    return `${firstDate ?? '?'} → ${lastDate ?? '?'}`;
  }
</script>

{#snippet bd(title: string, rows: MetaBreakdownRow[])}
  {@const top = [...rows].sort((a, b) => b.spend - a.spend).slice(0, 8)}
  {@const max = Math.max(1, ...top.map((r) => r.spend))}
  <div>
    <div class="mb-1 text-[10px] uppercase tracking-wide text-ink-400">{title}</div>
    {#if top.length === 0}
      <p class="text-[11px] text-ink-400">No data.</p>
    {:else}
      <div class="space-y-1">
        {#each top as r (r.key)}
          <div class="flex items-center gap-2 text-[11px]">
            <span class="w-28 shrink-0 truncate text-ink-700" title={r.key}>{r.key}</span>
            <span class="relative h-3 flex-1 overflow-hidden rounded-sm" style="background: var(--bg-tertiary);">
              <span class="absolute inset-y-0 left-0 rounded-sm" style={`width:${(r.spend / max) * 100}%; background: var(--accent-electric); opacity:0.7;`}></span>
            </span>
            <span class="w-20 shrink-0 text-right tabular-nums text-ink-600">{formatMoney(r.spend, 'ISK')}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<svelte:head><title>Live · Marketing</title></svelte:head>

<section class="space-y-5">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <p class="text-sm text-ink-500">
      Every campaign imported from your linked ad accounts. Attribute each to a sub-project — spend
      with no project can't be counted against a budget.
    </p>
    <a href="/marketing/live/previews" class="btn-ghost shrink-0 text-xs">Ad previews →</a>
  </div>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 text-sm" style="color: #C0392B;">{errorMsg}</div>
  {/if}

  <!-- KPI strip (reflects current filter) -->
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
    {#each [
      ['Campaigns', String(totals.count)],
      ['Spend', formatMoney(totals.spend, 'ISK')],
      ['Impressions', totals.impressions.toLocaleString('is-IS')],
      ['Clicks', totals.clicks.toLocaleString('is-IS')],
      ['Results', totals.results.toLocaleString('is-IS')]
    ] as [label, value] (label)}
      <div class="rounded-[10px] border border-surface-border bg-surface-card p-2.5">
        <div class="text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
        <div class="text-base font-semibold text-ink-900">{value}</div>
      </div>
    {/each}
  </div>

  <!-- Filters -->
  <div class="flex flex-wrap items-center gap-2 rounded-[14px] border border-surface-border bg-surface-card p-3">
    <input class="input !w-48 !py-1.5 text-sm" placeholder="Search campaigns…" bind:value={search} />
    <select class="input !w-auto !py-1.5 text-sm" bind:value={accountFilter}>
      <option value="">All accounts</option>
      {#each accounts as [id, name] (id)}<option value={id}>{name}</option>{/each}
    </select>
    <select class="input !w-auto !py-1.5 text-sm" bind:value={projectFilter}>
      <option value="">All sub-projects</option>
      <option value="none">— Unassigned —</option>
      {#each projectOptions as p (p.id)}<option value={String(p.id)}>{p.label}</option>{/each}
    </select>
    {#if data.events.length}
      <select class="input !w-auto !py-1.5 text-sm" bind:value={eventFilter}>
        <option value="">All events</option>
        {#each data.events as ev (ev.id)}<option value={String(ev.id)}>{ev.name}</option>{/each}
      </select>
    {/if}
    {#if statuses.length}
      <select class="input !w-auto !py-1.5 text-sm" bind:value={statusFilter}>
        <option value="">Any status</option>
        {#each statuses as s (s)}<option value={s}>{s}</option>{/each}
      </select>
    {/if}
    <select class="input !w-auto !py-1.5 text-sm" bind:value={sortBy}>
      <option value="spend">Top spend</option>
      <option value="recent">Most recent</option>
      <option value="name">Name</option>
    </select>
  </div>

  {#if rows.length}
    <!-- Bulk attribution -->
    <div class="flex flex-wrap items-center gap-2 rounded-[14px] border border-surface-border bg-surface-card p-3 text-sm">
      <label class="flex items-center gap-1.5 text-ink-600">
        <input type="checkbox" checked={allFilteredSelected} onchange={toggleSelectAll} />
        Select all ({filtered.length})
      </label>
      {#if selectedCount}
        <span class="text-ink-500">· {selectedCount} selected</span>
        <span class="ml-auto flex flex-wrap items-center gap-2">
          <select class="input !w-auto !py-1.5 text-xs" bind:value={bulkProject} disabled={bulkBusy}>
            <option value="">— unassigned —</option>
            {#each bulkScopedOptions as p (p.id)}<option value={String(p.id)}>{p.label}</option>{/each}
          </select>
          <button class="btn-primary !py-1.5 text-xs" onclick={assignBulk} disabled={bulkBusy}>Assign to {selectedCount}</button>
          <button class="btn-ghost text-xs" onclick={autoMatchSelected} disabled={bulkBusy} title="Match each selected campaign to a project whose name appears in it">
            {bulkBusy ? 'Working…' : 'Auto-match by name'}
          </button>
          <button class="btn-ghost text-xs" onclick={clearSel} disabled={bulkBusy}>Clear</button>
        </span>
      {:else}
        <span class="ml-auto text-[11px] text-ink-400">Select campaigns to bulk-assign a sub-project — or "Auto-match by name".</span>
      {/if}
    </div>
    {#if bulkStatus}<p class="-mt-1 text-xs" style="color: #2F855A;">{bulkStatus}</p>{/if}
  {/if}

  {#if rows.length === 0}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-10 text-center text-ink-500">
      <span class="inline-flex text-ink-300"><Icon name="flag" size={28} /></span>
      <p class="mt-2">No Meta campaigns imported yet.</p>
      <p class="mt-1 text-xs text-ink-400">
        Link an ad account on the <a href="/marketing/setup" class="underline">Setup</a> page,
        then run <span class="font-mono">scripts/sync-meta-metrics.mjs&nbsp;--months&nbsp;37</span>.
      </p>
    </div>
  {:else}
    <div class="overflow-hidden rounded-[14px] border border-surface-border bg-surface-card">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-surface-divider text-left text-[10px] uppercase tracking-wide text-ink-400">
              <th class="px-3 py-2 w-8"><input type="checkbox" checked={allFilteredSelected} onchange={toggleSelectAll} aria-label="Select all" /></th>
              <th class="px-3 py-2">Campaign</th>
              <th class="px-3 py-2">Account</th>
              <th class="px-3 py-2">Sub-project</th>
              <th class="px-3 py-2 text-right">Spend</th>
              <th class="px-3 py-2 text-right">Results</th>
              <th class="px-3 py-2">Active</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {#each filtered as c (c.id)}
              <tr class="border-b border-surface-divider/50 align-top">
                <td class="px-3 py-2">
                  <input type="checkbox" checked={selectedIds.has(c.id)} onchange={() => toggleRow(c.id)} aria-label="Select campaign" />
                </td>
                <td class="px-3 py-2">
                  <button class="text-left font-medium text-ink-900 hover:underline" onclick={() => toggle(c)}>
                    {c.name ?? '(untitled)'}
                  </button>
                  {#if c.status}
                    <span class="ml-1.5 inline-flex items-center gap-1 text-[10px] text-ink-400">
                      <span class="inline-block h-1.5 w-1.5 rounded-full" style={`background:${STATUS_TONE[c.status] ?? 'var(--text-tertiary)'}`}></span>
                      {c.status}
                    </span>
                  {/if}
                </td>
                <td class="px-3 py-2 text-ink-600">{accountNameOf(c)}</td>
                <td class="px-3 py-2">
                  <select
                    class="input !w-40 !py-1 text-xs"
                    value={projectIdOf(c) != null ? String(projectIdOf(c)) : ''}
                    onchange={(e) => assignProject(c, (e.currentTarget as HTMLSelectElement).value)}
                  >
                    <option value="">— unassigned —</option>
                    {#each scopedOptions(c) as p (p.id)}<option value={String(p.id)}>{p.label}</option>{/each}
                  </select>
                </td>
                <td class="px-3 py-2 text-right tabular-nums text-ink-800">{formatMoney(c.totals.spend, 'ISK')}</td>
                <td class="px-3 py-2 text-right tabular-nums text-ink-800">{c.totals.results.toLocaleString('is-IS')}</td>
                <td class="px-3 py-2 whitespace-nowrap text-[11px] text-ink-500">{dateRange(c)}</td>
                <td class="px-3 py-2 text-right">
                  <button class="text-ink-300 hover:text-ink-700" onclick={() => toggle(c)} aria-label="Toggle trend">
                    <Icon name="chevron-right" size={14} class={expanded === c.id ? 'rotate-90' : ''} />
                  </button>
                </td>
              </tr>
              {#if expanded === c.id}
                <tr class="border-b border-surface-divider/50">
                  <td colspan="8" class="px-3 py-3" style="background: var(--bg-secondary);">
                    {#if !c.meta_id}
                      <p class="text-xs text-ink-400">No Meta id on this campaign.</p>
                    {:else}
                      <!-- live controls (writes to Meta, each behind a confirm) -->
                      <div class="mb-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-surface-border p-2 text-xs" style="background: var(--bg-tertiary);">
                        <span class="inline-flex items-center gap-1.5 font-medium text-ink-700"><Icon name="bolt" size={12} /> Controls</span>
                        {#if canToggleStatus(c)}
                          <button
                            class="rounded-md border px-2 py-1 disabled:opacity-50"
                            style={c.status === 'ACTIVE' ? 'border-color:#B7791F; color:#B7791F;' : 'border-color:var(--accent-electric); color:var(--accent-electric);'}
                            disabled={controlBusy === c.id}
                            onclick={() => toggleLiveStatus(c)}
                          >{controlBusy === c.id ? '…' : c.status === 'ACTIVE' ? 'Pause on Meta' : 'Activate on Meta'}</button>
                        {:else}
                          <span class="text-ink-400">status unknown — sync to load</span>
                        {/if}
                        {#if canSetBudget(c)}
                          <span class="text-ink-400">·</span>
                          <span class="text-ink-500">{c.budget_mode === 'lifetime' ? 'Lifetime' : 'Daily'} budget ({accountCurrencyOf(c)})</span>
                          <input
                            type="number"
                            class="input !w-24 !py-1 text-xs"
                            placeholder={c.budget_amount != null ? String(c.budget_amount) : 'amount'}
                            value={budgetDraft[c.id] ?? ''}
                            oninput={(e) => (budgetDraft = { ...budgetDraft, [c.id]: (e.currentTarget as HTMLInputElement).value })}
                          />
                          <button class="btn-ghost !py-1 text-xs" disabled={controlBusy === c.id} onclick={() => applyLiveBudget(c)}>Set</button>
                        {:else}
                          <span class="text-ink-400">· budget is set at the ad-set level</span>
                        {/if}
                        <span class="text-[10px] text-ink-400">changes live delivery · status as of last sync</span>
                      </div>

                      <!-- event tagging (in addition to the sub-project) -->
                      <div class="mb-3 rounded-[10px] border border-surface-border p-2 text-xs" style="background: var(--bg-tertiary);">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="inline-flex items-center gap-1.5 font-medium text-ink-700"><Icon name="calendar" size={12} /> Events</span>
                          {#each eventsOf(c.id) as ev (ev.id)}
                            <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style="background: var(--bg-secondary);">
                              {ev.name}
                              <button class="text-ink-400 hover:text-ink-700" onclick={() => toggleEvent(c, ev, false)} aria-label={`Remove ${ev.name}`}><Icon name="x" size={10} /></button>
                            </span>
                          {/each}
                          {#if data.events.length}
                            <span class="relative">
                              <input
                                class="input !w-40 !py-1 text-xs"
                                placeholder="Tag an event…"
                                value={eventQuery[c.id] ?? ''}
                                oninput={(e) => (eventQuery = { ...eventQuery, [c.id]: (e.currentTarget as HTMLInputElement).value })}
                              />
                              {#if eventMatches(c).length}
                                <ul class="absolute z-20 mt-1 w-56 overflow-hidden rounded-[10px] border border-surface-border bg-surface-card shadow-lg">
                                  {#each eventMatches(c) as e (e.id)}
                                    <li><button class="w-full px-3 py-1.5 text-left text-xs hover:bg-surface-hover" onclick={() => toggleEvent(c, { id: e.id, name: e.name ?? `#${e.id}` }, true)}>{e.name}</button></li>
                                  {/each}
                                </ul>
                              {/if}
                            </span>
                          {:else}
                            <span class="text-ink-400">No events imported.</span>
                          {/if}
                        </div>
                      </div>

                      <!-- daily trend -->
                      {#if trends[c.meta_id] === 'loading' || !trends[c.meta_id]}
                        <p class="text-xs text-ink-400">Loading trend…</p>
                      {:else if (trends[c.meta_id] as { labels: string[] }).labels.length > 1}
                        <MetricsChart
                          labels={(trends[c.meta_id] as { labels: string[] }).labels}
                          series={[
                            { label: 'Spend', color: 'var(--accent-electric)', values: (trends[c.meta_id] as { spend: number[] }).spend },
                            { label: 'Results', color: '#2F855A', values: (trends[c.meta_id] as { results: number[] }).results }
                          ]}
                        />
                      {:else}
                        <p class="text-xs text-ink-400">Not enough daily data to chart.</p>
                      {/if}

                      <!-- live breakdowns (placement / age+gender / region / ad set) -->
                      {#if deep[c.meta_id] === 'loading'}
                        <p class="mt-3 text-xs text-ink-400">Loading breakdowns…</p>
                      {:else if deep[c.meta_id]}
                        {@const d = deep[c.meta_id] as Deep}
                        <div class="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                          {@render bd('By placement', d.placement)}
                          {@render bd('By age & gender', d.ageGender)}
                          {@render bd('Top regions', d.region)}
                          {@render bd('By ad set', d.adsets)}
                        </div>
                        {#if d.placement.length === 0 && d.ageGender.length === 0 && d.adsets.length === 0}
                          <p class="mt-1 text-[11px] text-ink-400">No live breakdown data — the account may not be readable by the token, or this campaign ran outside the available window.</p>
                        {/if}
                      {/if}
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
            {#if filtered.length === 0}
              <tr><td colspan="8" class="px-3 py-6 text-center text-sm text-ink-400">No campaigns match these filters.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</section>
