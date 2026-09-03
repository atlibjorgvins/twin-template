<script lang="ts">
  // Budget & spend, on the project page.
  //
  // The thing that was missing entirely: a project had no budget field, so
  // "what did we plan to spend here, and how much is left" had nowhere to live.
  // This is the answer at a glance; the drills live on /insights and the
  // envelopes are edited in the Marketing workspace, so nothing is duplicated.
  //
  // Scoped to the project AND its descendants, because a programme's spend
  // lands on its cohorts. An envelope with include_descendants off narrows
  // itself; the card does not second-guess it.
  import Icon from '$lib/Icon.svelte';
  import { formatMoney, formatPercent } from '$lib/insights/metrics';
  import {
    computeMarketing,
    emptyMarketingFilters,
    type MarketingBundle
  } from './metrics';

  let {
    bundle,
    projectId,
    projectName
  }: { bundle: MarketingBundle; projectId: number; projectName: string } = $props();

  const m = $derived.by(() => {
    const f = emptyMarketingFilters();
    f.projectId = projectId;
    f.includeDescendants = true;
    return computeMarketing(bundle, f);
  });
  const currency = $derived(m.kpi.currency);
  const money = (n: number) => formatMoney(Math.round(n), currency);

  // Envelopes that actually bear on this project. A medium-scoped envelope
  // spanning every project is not this card's business.
  const envelopes = $derived(m.budgets.filter((s) => s.budget.projectId != null));
  const budgeted = $derived(envelopes.reduce((s, x) => s + x.budget.amount, 0));
  const spentAgainst = $derived(envelopes.reduce((s, x) => s + x.spent, 0));
  const committed = $derived(envelopes.reduce((s, x) => s + x.committed, 0));
  const remaining = $derived(budgeted - spentAgainst - committed);

  const topMediums = $derived(m.byMedium.filter((s) => Math.round(s.spend) > 0).slice(0, 3));
  const insightsHref = $derived(`/insights?project=${projectId}`);
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title">
      <Icon name="wallet" size={16} />
      Budget &amp; spend
      {#if m.kpi.spend > 0}
        <span class="font-normal text-ink-300">{money(m.kpi.spend)}</span>
      {/if}
    </span>
    <a
      class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
      href={insightsHref}
    >Breakdown <Icon name="arrow-right" size={13} /></a>
  </div>

  <div class="space-y-4 p-4">
    {#if m.kpi.spend === 0 && envelopes.length === 0}
      <p class="text-sm text-ink-400">
        No spend recorded for {projectName} or its sub-projects between
        {bundle.window.since} and {bundle.window.until}, and no budget set.
        <a class="underline" href="/marketing">Set one in Marketing</a> — an envelope can cover a
        whole project, one year of it, or a single medium.
      </p>
    {:else}
      <!-- Spend first: it is the number that exists whether or not anyone
           wrote a budget down. -->
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-[10px] p-2.5" style="background: var(--bg-tertiary);">
          <div class="text-[10px] uppercase tracking-wide text-ink-400">Spent</div>
          <div class="text-base font-semibold text-ink-900">{money(m.kpi.spend)}</div>
        </div>
        <div class="rounded-[10px] p-2.5" style="background: var(--bg-tertiary);">
          <div class="text-[10px] uppercase tracking-wide text-ink-400">Budget</div>
          <div class="text-base font-semibold text-ink-900">
            {budgeted > 0 ? money(budgeted) : '—'}
          </div>
        </div>
        <div class="rounded-[10px] p-2.5" style="background: var(--bg-tertiary);">
          <div class="text-[10px] uppercase tracking-wide text-ink-400">
            {remaining < 0 ? 'Over' : 'Left'}
          </div>
          <div class="text-base font-semibold" style={remaining < 0 ? 'color:#C0392B' : 'color:var(--text-primary)'}>
            {budgeted > 0 ? money(Math.abs(remaining)) : '—'}
          </div>
        </div>
        <div class="rounded-[10px] p-2.5" style="background: var(--bg-tertiary);">
          <div class="text-[10px] uppercase tracking-wide text-ink-400">Results</div>
          <div class="text-base font-semibold text-ink-900">
            {m.kpi.results > 0 ? m.kpi.results.toLocaleString('is-IS') : '—'}
          </div>
        </div>
      </div>

      {#if envelopes.length > 0}
        <ul class="space-y-2.5">
          {#each envelopes as s (s.budget.id)}
            {@const pct = Math.min(100, Math.max(0, s.usedShare * 100))}
            <li>
              <div class="flex items-baseline justify-between gap-2 text-sm">
                <span class="min-w-0 truncate text-ink-800">
                  {s.budget.label ?? `Envelope #${s.budget.id}`}
                  <span class="text-[11px] text-ink-400">
                    {s.budget.period === 'total'
                      ? 'whole run'
                      : `${s.budget.period}${s.budget.periodStart ? ` from ${s.budget.periodStart}` : ''}`}
                  </span>
                </span>
                <span class="shrink-0 text-xs" style={s.over ? 'color:#C0392B' : 'color:var(--text-tertiary)'}>
                  {money(s.spent)} of {formatMoney(s.budget.amount, s.budget.currency)}
                </span>
              </div>
              <div class="mt-1 h-2 overflow-hidden rounded-full" style="background: var(--bg-tertiary);">
                <div
                  class="h-full rounded-full"
                  style={`width:${pct}%; background:${s.over ? '#C0392B' : 'var(--accent-electric)'};`}
                ></div>
              </div>
              <div class="mt-0.5 text-[11px] text-ink-400">
                {s.over ? `${money(-s.remaining)} over` : `${money(s.remaining)} left`} ·
                {formatPercent(s.usedShare)} used
                {#if s.committed > 0}· {money(s.committed)} committed{/if}
                {#if !s.budget.includeDescendants}· this project only{/if}
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-ink-400">
          No budget set for this project.
          <a class="underline" href="/marketing">Add an envelope</a> to track this spend against a
          target.
        </p>
      {/if}

      {#if topMediums.length > 0}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
          <span class="text-ink-400">Where it went:</span>
          {#each topMediums as s (s.key)}
            <span>{s.label} <span class="text-ink-400">{money(s.spend)}</span></span>
          {/each}
          {#if m.byMedium.length > topMediums.length}
            <a class="text-ink-400 underline" href={insightsHref}>+{m.byMedium.length - topMediums.length} more</a>
          {/if}
        </div>
      {/if}

      {#if m.mediumCoverage < 0.99 && m.kpi.spend > 0}
        <p class="text-[11px] text-ink-400">
          {formatPercent(1 - m.mediumCoverage)} of the Meta spend has no platform breakdown stored,
          so it reads as “not split by platform”.
        </p>
      {/if}
    {/if}
  </div>
</div>
