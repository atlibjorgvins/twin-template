<script lang="ts">
  // The marketing section of /insights — spend next to the people it reached.
  //
  // This is the half of the redesign that isn't a tool: management asks "what
  // did this programme cost and who did it reach", and until now the answer
  // lived in a campaign manager you had to know existed, while the cohort and
  // gender figures lived here. Now they are on one page, under one filter row.
  //
  // It reads the SAME slice as every other figure: the page's project and its
  // year chips, mapped to dates by windowForYears. No filters of its own — the
  // dimension picker chooses which split to SHOW, not which rows to count.
  //
  // Every figure states its coverage. A drill over 3% of the spend and a drill
  // over all of it look identical on a bar chart, so the ones that don't
  // explain the whole slice say so in the subtitle rather than in a footnote
  // nobody reads.
  import BarList from '$lib/insights/BarList.svelte';
  import ColumnChart from '$lib/insights/ColumnChart.svelte';
  import Figure from '$lib/insights/Figure.svelte';
  import StatTile from '$lib/insights/StatTile.svelte';
  import { formatCompactMoney, formatMoney, formatPercent } from '$lib/insights/metrics';
  import type { Filters } from '$lib/insights/metrics';
  import {
    computeMarketing,
    emptyMarketingFilters,
    spendByMonth,
    windowForYears,
    DIMENSION_LABELS,
    type MarketingBundle
  } from './metrics';

  let {
    bundle,
    filters,
    projectId,
    programme
  }: {
    bundle: MarketingBundle;
    /** The page's filters — years and includeCohorts are the ones that bite. */
    filters: Filters;
    projectId: number;
    programme: string;
  } = $props();

  const window = $derived(windowForYears(filters.years, bundle.window));
  const marketingFilters = $derived.by(() => {
    const f = emptyMarketingFilters();
    f.since = window.since;
    f.until = window.until;
    f.projectId = projectId;
    // "Programme row only" on the page means exactly that here too: don't
    // count the cohorts' spend.
    f.includeDescendants = filters.includeCohorts;
    return f;
  });
  const m = $derived(computeMarketing(bundle, marketingFilters));
  const currency = $derived(m.kpi.currency);
  const money = (n: number) => formatMoney(Math.round(n), currency);

  // Which split to show. A view control, not a filter — every option reads the
  // same rows.
  let dimension = $state('medium');
  const options = $derived([
    { key: 'medium', label: 'Medium' },
    { key: 'project', label: 'Project' },
    { key: 'campaign', label: 'Campaign' },
    ...m.drills.map((d) => ({ key: d.dimension, label: DIMENSION_LABELS[d.dimension] ?? d.dimension }))
  ]);

  const shown = $derived.by(() => {
    if (dimension === 'medium') return { rows: m.byMedium, coverage: 1, ignored: false };
    if (dimension === 'project') return { rows: m.byProject, coverage: 1, ignored: false };
    if (dimension === 'campaign') return { rows: m.byCampaign, coverage: 1, ignored: false };
    const d = m.drills.find((x) => x.dimension === dimension);
    return d ? { rows: d.rows, coverage: d.coverage, ignored: d.mediumFilterIgnored } : { rows: [], coverage: 0, ignored: false };
  });
  const bars = $derived(
    shown.rows.filter((r) => Math.round(r.spend) > 0).map((r) => ({ label: r.label, value: Math.round(r.spend) }))
  );
  const coverageNote = $derived(
    shown.coverage >= 0.995
      ? ''
      : `Covers ${formatPercent(shown.coverage)} of the Meta spend in this slice — the rest ran on days the breakdown sync has no rows for.`
  );

  const months = $derived(spendByMonth(m.rows));
  const dimLabel = $derived(options.find((o) => o.key === dimension)?.label ?? dimension);

  // Everything here is derived from stored rows, so an empty block has exactly
  // three causes and it is worth naming which.
  const emptyReason = $derived.by(() => {
    if (m.kpi.spend > 0) return null;
    if (bundle.meta.length === 0 && bundle.manual.length === 0)
      return `No spend is stored for ${bundle.window.since} → ${bundle.window.until} at all. The nightly Meta sync fills this in; hand-entered spend goes in the Spend ledger.`;
    if (filters.years.size > 0)
      return `No spend recorded in ${[...filters.years].sort().join(', ')}. Stored spend covers ${bundle.window.since} → ${bundle.window.until}.`;
    return `No spend is attributed to ${programme} or its cohorts. Attribution is set per campaign under Marketing → Live.`;
  });
</script>

<section class="space-y-3">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2 class="font-display text-lg font-bold text-ink-900">Marketing</h2>
    <a class="text-xs text-ink-400 hover:underline" href="/marketing">Open the workspace →</a>
  </div>

  {#if emptyReason}
    <div class="card p-4 text-sm text-ink-500">{emptyReason}</div>
  {:else}
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label={`Spend (${currency})`} value={formatCompactMoney(m.kpi.spend, '')} note={`${m.kpi.days} days · ${m.kpi.campaigns} campaigns`} emphasis />
      <StatTile label="Reached" value={m.kpi.impressions.toLocaleString('is-IS')} note="impressions" />
      <StatTile label="Clicks" value={m.kpi.clicks.toLocaleString('is-IS')} note={m.kpi.cpc != null ? `${money(m.kpi.cpc)} each` : '—'} />
      <StatTile label="Results" value={m.kpi.results.toLocaleString('is-IS')} note={m.kpi.cpr != null ? `${money(m.kpi.cpr)} each` : 'none recorded'} />
    </div>

    {#if m.kpi.mixedCurrency}
      <p class="text-xs text-ink-400">
        This slice holds more than one currency; the totals add the raw amounts without conversion.
      </p>
    {/if}

    <!-- ── The drill. One picker, one chart, the same rows underneath. ── -->
    <Figure
      title={`Spend by ${dimLabel.toLowerCase()}`}
      subtitle={[
        `${money(m.kpi.spend)} over ${window.since} → ${window.until}`,
        coverageNote,
        shown.ignored ? 'This split carries no medium of its own, so a medium filter cannot narrow it.' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      filename={`${programme}-spend-by-${dimension}`}
      empty="No spend in this slice."
      table={{
        columns: [dimLabel, `Spend (${currency})`, 'Share', 'Impressions', 'Clicks', 'Results'],
        rows: shown.rows.map((r) => [
          r.label,
          Math.round(r.spend),
          formatPercent(r.share, 1),
          Math.round(r.impressions),
          Math.round(r.clicks),
          Math.round(r.results)
        ])
      }}
    >
      {#snippet chart()}
        <div class="space-y-3">
          <div class="flex flex-wrap gap-1">
            {#each options as o (o.key)}
              <button
                type="button"
                class="chip-radio"
                class:is-selected={dimension === o.key}
                aria-pressed={dimension === o.key}
                onclick={() => (dimension = o.key)}
              >{o.label}</button>
            {/each}
          </div>
          <BarList rows={bars} format={(n) => money(n)} limit={12} color="var(--viz-1)" />
        </div>
      {/snippet}
    </Figure>

    <!-- ── Spend over time, monthly — the shape a board reads. ───────── -->
    {#if months.length > 1}
      <Figure
        title="Spend per month"
        subtitle={`${money(m.kpi.spend)} total${m.kpi.results > 0 ? `, ${m.kpi.results.toLocaleString('is-IS')} results` : ''}`}
        legend={[
          { label: `Spend (${currency})`, color: 'var(--viz-1)' },
          { label: 'Results', color: 'var(--viz-2)' }
        ]}
        filename={`${programme}-spend-per-month`}
        empty="Nothing to plot."
        table={{
          columns: ['Month', `Spend (${currency})`, 'Results'],
          rows: months.map((x) => [x.month, Math.round(x.spend), Math.round(x.results)])
        }}
      >
        {#snippet chart()}
          <ColumnChart
            categories={months.map((x) => x.month)}
            series={[
              { key: 'spend', label: `Spend (${currency})`, color: 'var(--viz-1)' },
              { key: 'results', label: 'Results', color: 'var(--viz-2)' }
            ]}
            values={months.map((x) => [Math.round(x.spend), Math.round(x.results)])}
            format={(n) => formatCompactMoney(n, '')}
          />
        {/snippet}
      </Figure>
    {/if}

    <!-- ── Budgets, when there are any for this slice. ───────────────── -->
    {#if m.budgets.length > 0}
      <Figure
        title="Budgets"
        subtitle={m.unbudgeted.spend > 0
          ? `${money(m.unbudgeted.spend)} of this slice sits outside every envelope.`
          : 'Every krona in this slice is covered by an envelope.'}
        filename={`${programme}-budgets`}
        empty="No budgets."
        table={{
          columns: ['Envelope', 'Period', `Budget (${currency})`, 'Spent', 'Committed', 'Remaining', 'Used'],
          rows: m.budgets.map((s) => [
            s.budget.label ?? `#${s.budget.id}`,
            s.budget.period === 'total' ? 'whole run' : `${s.budget.period} ${s.budget.periodStart ?? ''}`.trim(),
            Math.round(s.budget.amount),
            Math.round(s.spent),
            Math.round(s.committed),
            Math.round(s.remaining),
            formatPercent(s.usedShare, 1)
          ])
        }}
      >
        {#snippet chart()}
          <ul class="space-y-2.5">
            {#each m.budgets as s (s.budget.id)}
              {@const pct = Math.min(100, Math.max(0, s.usedShare * 100))}
              <li>
                <div class="flex items-baseline justify-between gap-2 text-sm">
                  <span class="min-w-0 truncate text-ink-800">{s.budget.label ?? `Envelope #${s.budget.id}`}</span>
                  <span class="shrink-0 text-xs" style={s.over ? 'color:#C0392B' : 'color:var(--text-tertiary)'}>
                    {money(s.spent)} of {formatMoney(s.budget.amount, s.budget.currency)}
                  </span>
                </div>
                <div class="mt-1 h-2 overflow-hidden rounded-full" style="background:var(--bg-tertiary)">
                  <div class="h-full rounded-full" style={`width:${pct}%;background:${s.over ? '#C0392B' : 'var(--viz-1)'}`}></div>
                </div>
                <div class="mt-0.5 text-[11px] text-ink-400">
                  {s.over ? `${money(-s.remaining)} over` : `${money(s.remaining)} left`} · {formatPercent(s.usedShare)} used
                </div>
              </li>
            {/each}
          </ul>
        {/snippet}
      </Figure>
    {/if}

    <p class="text-[11px] text-ink-400">
      Spend comes from stored daily rows — Meta via the nightly sync, everything else hand-entered.
      Stored spend covers {bundle.window.since} → {bundle.window.until}.
      {#if m.unattributed.spend > 0}
        {formatPercent(m.unattributed.share)} of it has no project and is excluded from this programme.
      {/if}
    </p>
  {/if}
</section>
