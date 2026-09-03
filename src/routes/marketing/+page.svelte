<script lang="ts">
  // Plan — what are we spending, against what budget.
  //
  // One filter row above everything, borrowed from /insights: every figure on
  // the page reads the SAME slice. The old campaign manager had a rollup on the
  // index, another on /dashboard and a third on /report, each blending spend
  // differently — so all three disagreed and none said which was right.
  //
  // Money never comes from a campaign's budget_total here. It comes from the
  // read model, which reads stored daily rows. The builder authors intent; it
  // does not report.
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import BarList from '$lib/insights/BarList.svelte';
  import StatTile from '$lib/insights/StatTile.svelte';
  import MetricsChart from '$lib/campaigns/MetricsChart.svelte';
  import {
    createMkCampaign,
    duplicateMkCampaign,
    updateMkCampaign,
    formatError,
    MK_STATUS_LABELS,
    type MkCampaign
  } from '$lib/directus';
  import { createBudget, deleteBudget, updateBudget } from '$lib/marketing/data';
  import {
    computeMarketing,
    daysBefore,
    emptyMarketingFilters,
    formatMoney,
    formatPercent,
    type MarketingBundle
  } from '$lib/marketing/metrics';
  import { manualMediums } from '$lib/marketing/media';
  import type { Budget } from '$lib/marketing/budget';

  let {
    data
  }: { data: { bundle: MarketingBundle; campaigns: MkCampaign[]; error: string | null } } = $props();

  let bundle = $state<MarketingBundle>(data.bundle);
  let campaigns = $state<MkCampaign[]>([...data.campaigns]);
  let errorMsg = $state<string | null>(data.error);
  let busy = $state(false);

  // A fresh load must win over the local copy — invalidate() after a write
  // elsewhere, or a back-navigation, both re-run the loader.
  $effect(() => {
    bundle = data.bundle;
    campaigns = [...data.campaigns];
  });

  // ── Filter row ──────────────────────────────────────────────────────
  const PERIODS = [
    { key: '30d', label: '30 days', days: 30 },
    { key: '90d', label: '90 days', days: 90 },
    { key: '365d', label: '12 months', days: 365 }
  ];
  let period = $state('90d');
  let projectId = $state('');
  let medium = $state('');

  const filters = $derived.by(() => {
    const f = emptyMarketingFilters();
    const days = PERIODS.find((p) => p.key === period)?.days ?? 90;
    f.until = bundle.window.until;
    f.since = daysBefore(bundle.window.until, days);
    if (projectId) f.projectId = Number(projectId);
    if (medium) f.mediums = new Set([medium]);
    return f;
  });
  const m = $derived(computeMarketing(bundle, filters));
  const currency = $derived(m.kpi.currency);

  // Indented project options, so a cohort reads as a child of its programme.
  const projectOptions = $derived.by(() => {
    const byParent = new Map<number | null, typeof bundle.projects>();
    for (const p of bundle.projects) {
      if (!byParent.has(p.parentId)) byParent.set(p.parentId, []);
      byParent.get(p.parentId)!.push(p);
    }
    const out: { id: number; label: string }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const p of (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'is'))) {
        out.push({ id: p.id, label: `${'  '.repeat(depth)}${p.name}` });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });
  const usedMediums = $derived(bundle.mediums.filter((x) => m.byMedium.some((s) => s.key === x.code)));

  // ── Budget envelopes ────────────────────────────────────────────────
  type Draft = {
    id: number | null;
    label: string;
    scope: string;
    status: string;
    projectId: string;
    includeDescendants: boolean;
    campaignId: string;
    medium: string;
    period: string;
    periodStart: string;
    amount: string;
    committed: string;
    currency: string;
  };
  const blankDraft = (): Draft => ({
    id: null,
    label: '',
    scope: 'project',
    status: 'approved',
    projectId: '',
    includeDescendants: true,
    campaignId: '',
    medium: '',
    period: 'year',
    periodStart: `${bundle.window.until.slice(0, 4)}-01-01`,
    amount: '',
    committed: '0',
    currency: 'ISK'
  });
  let draft = $state<Draft | null>(null);
  const editingBudget = $derived(draft?.id != null);

  function newBudget() {
    draft = blankDraft();
  }
  function editBudget(b: Budget) {
    draft = {
      id: b.id,
      label: b.label ?? '',
      scope: String(b.scope),
      status: String(b.status),
      projectId: b.projectId != null ? String(b.projectId) : '',
      includeDescendants: b.includeDescendants,
      campaignId: b.campaignId != null ? String(b.campaignId) : '',
      medium: b.medium ?? '',
      period: String(b.period),
      periodStart: b.periodStart ?? '',
      amount: String(b.amount ?? ''),
      committed: String(b.committed ?? 0),
      currency: b.currency ?? 'ISK'
    };
  }

  function draftPatch(d: Draft): Partial<Budget> {
    return {
      label: d.label.trim() || null,
      scope: d.scope,
      status: d.status,
      projectId: d.scope === 'project' && d.projectId ? Number(d.projectId) : null,
      includeDescendants: d.includeDescendants,
      campaignId: d.scope === 'campaign' && d.campaignId ? Number(d.campaignId) : null,
      medium: d.medium || null,
      period: d.period,
      periodStart: d.period === 'total' ? (d.periodStart || null) : d.periodStart || null,
      amount: Number(d.amount) || 0,
      committed: Number(d.committed) || 0,
      currency: d.currency.trim() || 'ISK'
    };
  }

  async function saveBudget() {
    if (!draft) return;
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errorMsg = 'A budget needs a positive amount.';
      return;
    }
    if (draft.scope === 'project' && !draft.projectId) {
      errorMsg = 'A project envelope needs a project.';
      return;
    }
    if (draft.scope === 'campaign' && !draft.campaignId) {
      errorMsg = 'A campaign envelope needs a campaign.';
      return;
    }
    if (draft.scope === 'medium' && !draft.medium) {
      errorMsg = 'A medium envelope needs a medium.';
      return;
    }
    if (draft.period !== 'total' && !draft.periodStart) {
      errorMsg = 'A yearly or monthly envelope needs a start date.';
      return;
    }
    busy = true;
    errorMsg = null;
    try {
      const patch = draftPatch(draft);
      if (draft.id != null) {
        const saved = await updateBudget(draft.id, patch);
        bundle = { ...bundle, budgets: bundle.budgets.map((b) => (b.id === saved.id ? saved : b)) };
      } else {
        const saved = await createBudget(patch);
        bundle = { ...bundle, budgets: [saved, ...bundle.budgets] };
      }
      draft = null;
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      busy = false;
    }
  }

  async function removeBudget(b: Budget) {
    if (!confirm(`Delete the envelope "${b.label ?? b.id}"?`)) return;
    errorMsg = null;
    try {
      await deleteBudget(b.id);
      bundle = { ...bundle, budgets: bundle.budgets.filter((x) => x.id !== b.id) };
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  // ── Campaigns ───────────────────────────────────────────────────────
  const spendByCampaign = $derived.by(() => {
    const out = new Map<number, number>();
    for (const r of m.rows) {
      if (r.campaignId == null) continue;
      out.set(r.campaignId, (out.get(r.campaignId) ?? 0) + r.amount);
    }
    return out;
  });

  async function newCampaign() {
    busy = true;
    errorMsg = null;
    try {
      const c = await createMkCampaign({ name: 'New campaign', status: 'planning', currency: 'ISK' });
      await goto(`/marketing/${c.id}`);
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      busy = false;
    }
  }
  async function duplicate(c: MkCampaign) {
    errorMsg = null;
    try {
      campaigns = [await duplicateMkCampaign(c.id), ...campaigns];
    } catch (e) {
      errorMsg = formatError(e);
    }
  }
  async function archive(c: MkCampaign) {
    if (!confirm(`Archive ${c.name ?? 'this campaign'}?`)) return;
    errorMsg = null;
    try {
      await updateMkCampaign(c.id, { status: 'archived' });
      campaigns = campaigns.filter((x) => x.id !== c.id);
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  const STATUS_TONE: Record<string, string> = {
    planning: 'var(--text-secondary)',
    live: 'var(--accent-electric)',
    paused: '#B7791F',
    completed: '#2F855A',
    archived: 'var(--text-tertiary)'
  };
  const money = (n: number) => formatMoney(Math.round(n), currency);
  // The read model keeps every group, deliberately. A spend bar chart still
  // shouldn't draw a bar for a group that spent nothing — that's a display
  // decision, not a reason to drop the row upstream.
  const spendBars = (slices: { label: string; spend: number }[]) =>
    slices.filter((s) => Math.round(s.spend) > 0).map((s) => ({ label: s.label, value: Math.round(s.spend) }));
  const trend = $derived({
    labels: m.trend.labels.map((d) => d.slice(5)),
    spend: m.trend.spend
  });
</script>

<svelte:head><title>Plan · Marketing</title></svelte:head>

<section class="space-y-5">
  <!-- ── Filter row: one slice for the whole page ──────────────────── -->
  <div class="flex flex-wrap items-end gap-3 rounded-[14px] border border-surface-border bg-surface-card p-3">
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
    <label class="block">
      <span class="mb-1 block text-[10px] uppercase tracking-wide text-ink-400">Project</span>
      <select class="input !py-1 text-xs" bind:value={projectId}>
        <option value="">Every project</option>
        {#each projectOptions as p (p.id)}<option value={String(p.id)}>{p.label}</option>{/each}
      </select>
    </label>
    <label class="block">
      <span class="mb-1 block text-[10px] uppercase tracking-wide text-ink-400">Medium</span>
      <select class="input !py-1 text-xs" bind:value={medium}>
        <option value="">Every medium</option>
        {#each usedMediums as x (x.code)}<option value={x.code}>{x.label}</option>{/each}
      </select>
    </label>
    <span class="ml-auto text-[11px] text-ink-400">
      {filters.since} → {filters.until}
    </span>
  </div>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 text-sm" style="color: #C0392B;">
      {errorMsg}
    </div>
  {/if}

  <!-- ── KPI strip ─────────────────────────────────────────────────── -->
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
    <StatTile
      label="Spend"
      value={money(m.kpi.spend)}
      note={`${m.kpi.days} days · ${m.kpi.campaigns} campaigns`}
      emphasis
    />
    <StatTile label="Results" value={m.kpi.results.toLocaleString('is-IS')} note={m.kpi.cpr != null ? `${money(m.kpi.cpr)} each` : 'no results recorded'} />
    <StatTile label="Clicks" value={m.kpi.clicks.toLocaleString('is-IS')} note={m.kpi.cpc != null ? `CPC ${money(m.kpi.cpc)}` : 'no clicks recorded'} />
    <StatTile
      label="Unattributed"
      value={formatPercent(m.unattributed.share)}
      note={m.unattributed.spend > 0 ? `${money(m.unattributed.spend)} with no project` : 'every krona has a project'}
    />
  </div>

  {#if m.kpi.mixedCurrency}
    <p class="text-[11px] text-ink-400">
      More than one currency in this slice — the totals are sums of unlike things.
    </p>
  {/if}

  <!-- ── Trend ─────────────────────────────────────────────────────── -->
  {#if trend.labels.length > 1}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
      <div class="mb-2 flex items-center justify-between">
        <span class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
          Spend per day
        </span>
        <span class="text-[11px] text-ink-500">{money(m.kpi.spend)} over {m.kpi.days} days</span>
      </div>
      <MetricsChart
        labels={trend.labels}
        series={[{ label: 'Spend', color: 'var(--accent-electric)', values: trend.spend }]}
      />
    </div>
  {/if}

  <!-- ── Splits ────────────────────────────────────────────────────── -->
  <div class="grid gap-3 sm:grid-cols-2">
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
      <div class="mb-2 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        By medium
      </div>
      <BarList rows={spendBars(m.byMedium)} format={money} />
      {#if m.mediumCoverage < 0.99}
        <p class="mt-2 text-[11px] text-ink-400">
          {formatPercent(1 - m.mediumCoverage)} of Meta spend has no platform breakdown yet and reads as
          “not split by platform”. The nightly sync fills this in going forward.
        </p>
      {/if}
    </div>
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
      <div class="mb-2 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        By project
      </div>
      <BarList rows={spendBars(m.byProject)} format={money} />
      <p class="mt-2 text-[11px] text-ink-400">
        Deeper drills — age, gender, placement, region — live on
        <a class="underline" href={projectId ? `/insights?project=${projectId}` : '/insights'}>the programme dashboard</a>.
      </p>
    </div>
  </div>

  <!-- ── Budget envelopes ──────────────────────────────────────────── -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card">
    <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        Budgets
      </span>
      <div class="flex items-center gap-2">
        {#if m.unbudgeted.spend > 0}
          <span class="text-[11px] text-ink-500">
            {money(m.unbudgeted.spend)} outside every envelope
          </span>
        {/if}
        <button class="btn-ghost text-xs" onclick={newBudget}>+ Budget</button>
      </div>
    </div>

    {#if draft}
      <div class="border-t border-surface-divider p-4 space-y-3">
        <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">
          {editingBudget ? 'Edit envelope' : 'New envelope'}
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-xs text-ink-500">Label</span>
            <input class="input w-full text-sm" bind:value={draft.label} placeholder="e.g. SuperNova 2026 — paid social" />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-ink-500">Covers</span>
            <select class="input w-full text-sm" bind:value={draft.scope}>
              <option value="project">A project</option>
              <option value="campaign">A campaign</option>
              <option value="medium">A medium, across everything</option>
            </select>
          </label>

          {#if draft.scope === 'project'}
            <label class="block">
              <span class="mb-1 block text-xs text-ink-500">Project</span>
              <select class="input w-full text-sm" bind:value={draft.projectId}>
                <option value="">— pick one —</option>
                {#each projectOptions as p (p.id)}<option value={String(p.id)}>{p.label}</option>{/each}
              </select>
            </label>
            <label class="flex items-center gap-2 pt-5 text-sm text-ink-600">
              <input type="checkbox" bind:checked={draft.includeDescendants} />
              Count sub-projects too
            </label>
          {:else if draft.scope === 'campaign'}
            <label class="block sm:col-span-2">
              <span class="mb-1 block text-xs text-ink-500">Campaign</span>
              <select class="input w-full text-sm" bind:value={draft.campaignId}>
                <option value="">— pick one —</option>
                {#each campaigns as c (c.id)}<option value={String(c.id)}>{c.name ?? `#${c.id}`}</option>{/each}
              </select>
            </label>
          {/if}

          <label class="block">
            <span class="mb-1 block text-xs text-ink-500">
              Medium {draft.scope === 'medium' ? '' : '(optional — narrows the envelope)'}
            </span>
            <select class="input w-full text-sm" bind:value={draft.medium}>
              <option value="">— any medium —</option>
              {#each bundle.mediums.filter((x) => x.isEnabled) as x (x.code)}
                <option value={x.code}>{x.label}</option>
              {/each}
            </select>
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="block">
              <span class="mb-1 block text-xs text-ink-500">Period</span>
              <select class="input w-full text-sm" bind:value={draft.period}>
                <option value="total">Whole run</option>
                <option value="year">Year</option>
                <option value="month">Month</option>
              </select>
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-ink-500">
                {draft.period === 'total' ? 'From (optional)' : 'Starting'}
              </span>
              <input type="date" class="input w-full text-sm" bind:value={draft.periodStart} />
            </label>
          </div>
          <div class="grid grid-cols-[1fr_1fr_5rem] gap-2">
            <label class="block">
              <span class="mb-1 block text-xs text-ink-500">Amount</span>
              <input type="number" class="input w-full text-sm" bind:value={draft.amount} placeholder="0" />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-ink-500">Committed</span>
              <input type="number" class="input w-full text-sm" bind:value={draft.committed} />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs text-ink-500">Currency</span>
              <input class="input w-full text-sm" bind:value={draft.currency} />
            </label>
          </div>
          <label class="block">
            <span class="mb-1 block text-xs text-ink-500">Status</span>
            <select class="input w-full text-sm" bind:value={draft.status}>
              <option value="approved">Approved</option>
              <option value="draft">Draft — excluded from roll-ups</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>
        <p class="text-[11px] text-ink-400">
          Committed is money booked but not yet spent — a signed insertion order. It counts against
          what's left.
        </p>
        <div class="flex items-center gap-2">
          <button class="btn-primary text-sm" disabled={busy} onclick={saveBudget}>
            {busy ? 'Saving…' : editingBudget ? 'Save envelope' : 'Add envelope'}
          </button>
          <button class="btn-ghost text-sm" onclick={() => (draft = null)}>Cancel</button>
        </div>
      </div>
    {/if}

    {#if m.budgets.length === 0}
      <p class="px-4 pb-4 text-sm text-ink-400">
        No budgets yet. An envelope is how a project gets a spending target you can track against —
        per year, or narrowed to one medium.
      </p>
    {:else}
      <ul class="divide-y divide-surface-divider border-t border-surface-divider">
        {#each m.budgets as s (s.budget.id)}
          {@const pct = Math.min(100, Math.max(0, s.usedShare * 100))}
          <li class="px-4 py-3">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <span class="min-w-0">
                <span class="font-medium text-ink-900">{s.budget.label ?? `Envelope #${s.budget.id}`}</span>
                {#if s.budget.status === 'draft'}
                  <span class="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase" style="background: var(--bg-tertiary); color: var(--text-tertiary);">Draft</span>
                {/if}
                <span class="ml-1 text-[11px] text-ink-400">
                  {s.budget.period === 'total' ? 'whole run' : `${s.budget.period}${s.budget.periodStart ? ` from ${s.budget.periodStart}` : ''}`}
                  {#if s.budget.medium}· {bundle.mediums.find((x) => x.code === s.budget.medium)?.label ?? s.budget.medium}{/if}
                </span>
              </span>
              <span class="shrink-0 text-xs" style={s.over ? 'color: #C0392B;' : ''}>
                {money(s.spent)} of {formatMoney(s.budget.amount, s.budget.currency)}
                {#if s.committed > 0}<span class="text-ink-400"> · {money(s.committed)} committed</span>{/if}
              </span>
            </div>
            <div class="mt-1.5 h-2 overflow-hidden rounded-full" style="background: var(--bg-tertiary);">
              <div
                class="h-full rounded-full"
                style={`width:${pct}%; background:${s.over ? '#C0392B' : 'var(--accent-electric)'};`}
              ></div>
            </div>
            <div class="mt-1 flex items-center justify-between text-[11px] text-ink-500">
              <span>
                {s.over ? `${money(-s.remaining)} over` : `${money(s.remaining)} left`} ·
                {formatPercent(s.usedShare)} used
              </span>
              <span class="flex items-center gap-2">
                <button class="text-ink-300 hover:text-ink-700" aria-label="Edit envelope" onclick={() => editBudget(s.budget)}>
                  <Icon name="pencil" size={13} />
                </button>
                <button class="text-ink-300 hover:text-ink-700" aria-label="Delete envelope" onclick={() => removeBudget(s.budget)}>
                  <Icon name="trash" size={13} />
                </button>
              </span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- ── Campaigns ─────────────────────────────────────────────────── -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card">
    <div class="flex items-center justify-between px-4 py-3">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        Campaigns
      </span>
      <button class="btn-primary text-xs" disabled={busy} onclick={newCampaign}>+ New campaign</button>
    </div>
    {#if campaigns.length === 0}
      <p class="px-4 pb-4 text-sm text-ink-400">No campaigns yet.</p>
    {:else}
      <ul class="divide-y divide-surface-divider border-t border-surface-divider">
        {#each campaigns as c (c.id)}
          {@const spent = spendByCampaign.get(c.id) ?? 0}
          <li class="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-hover">
            <a href={`/marketing/${c.id}`} class="flex min-w-0 flex-1 items-center gap-3">
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center"
                style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);"
              >
                <Icon name="flag" size={16} />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="truncate font-medium text-ink-900">{c.name ?? '(untitled)'}</span>
                  <span
                    class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                    style={`background: var(--bg-tertiary); color: ${STATUS_TONE[c.status ?? 'planning'] ?? 'var(--text-secondary)'};`}
                  >{MK_STATUS_LABELS[c.status ?? 'planning'] ?? c.status}</span>
                </span>
                <span class="mt-0.5 block text-[11px] text-ink-500">
                  {spent > 0 ? `${money(spent)} in this period` : 'no spend in this period'}
                </span>
              </span>
            </a>
            <button class="btn-ghost !px-2 shrink-0 text-xs" aria-label="Duplicate campaign" onclick={() => duplicate(c)}>
              <Icon name="copy" size={15} />
            </button>
            <button class="btn-ghost !px-2 shrink-0 text-xs" aria-label="Archive campaign" onclick={() => archive(c)}>
              <Icon name="x" size={15} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <p class="text-[11px] text-ink-400">
    Hand-entered spend on billboards, print and radio goes in
    <a class="underline" href="/marketing/spend">Spend</a>; there are
    {manualMediums(bundle.mediums).length} mediums to pick from.
  </p>
</section>
