<script lang="ts">
  // Programme insights — the BI view of a project and its cohorts.
  //
  // Shape of the page, in the order it answers questions:
  //   filter row → KPI tiles → who (people, orgs) → how it changed (cohorts)
  //   → who it was (gender) → what it attracted (grants) → what it cost
  //   (marketing) → what we don't know.
  //
  // Every figure reads the SAME filtered slice: one filter row above
  // everything, no per-card filters. Filters live in the query string so a
  // view is shareable and the back button works.
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Icon from '$lib/Icon.svelte';
  import Figure from '$lib/insights/Figure.svelte';
  import ColumnChart from '$lib/insights/ColumnChart.svelte';
  import BarList from '$lib/insights/BarList.svelte';
  import SplitBar from '$lib/insights/SplitBar.svelte';
  import StatTile from '$lib/insights/StatTile.svelte';
  import PeopleStrip from '$lib/insights/PeopleStrip.svelte';
  import LogoWall from '$lib/insights/LogoWall.svelte';
  import { downloadWorkbook } from '$lib/insights/export';
  import {
    computeMetrics,
    emptyFilters,
    availableYears,
    availablePersonRoles,
    availableOrgRoles,
    cohortLabels,
    roleLabel,
    formatCompactMoney,
    formatMoney,
    formatPercent,
    type Filters
  } from '$lib/insights/metrics';
  import type { InsightsProjectOption, LoadedInsights } from '$lib/insights/data';
  import MarketingBlock from '$lib/marketing/MarketingBlock.svelte';
  import { marketingSheets } from '$lib/marketing/export';
  import { computeMarketing, emptyMarketingFilters, windowForYears, type MarketingBundle } from '$lib/marketing/metrics';

  let {
    data
  }: {
    data: {
      projects: InsightsProjectOption[];
      insights: LoadedInsights | null;
      marketing: MarketingBundle;
      error: string | null;
    };
  } =
    $props();

  const LAST_KEY = 'twin.insights.lastProject.v1';

  // ── Filter state, mirrored to the URL ──────────────────────────────────
  // The URL is the source of truth; these are derived from it so a shared
  // link, a back navigation and a chip click all end up in the same state.
  const params = $derived($page.url.searchParams);
  const projectId = $derived.by(() => {
    const n = Number(params.get('project'));
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const filters = $derived.by<Filters>(() => {
    const years = new Set(
      (params.get('years') ?? '')
        .split(',')
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0)
    );
    return {
      years,
      personRole: params.get('prole') || 'all',
      orgRole: params.get('orole') || 'all',
      includeCohorts: params.get('cohorts') !== '0',
      includeFormerMembers: params.get('former') !== '0'
    };
  });

  function setParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams($page.url.searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    // replaceState: filter fiddling should not fill the back stack, but the
    // resulting URL is still copy-pasteable.
    goto(`?${next.toString()}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function pickProject(id: number) {
    try { localStorage.setItem(LAST_KEY, String(id)); } catch { /* private mode */ }
    // A new programme invalidates every year/role chip from the old one.
    goto(`?project=${id}`, { keepFocus: true, noScroll: true });
  }

  function toggleYear(y: number) {
    const next = new Set(filters.years);
    if (next.has(y)) next.delete(y); else next.add(y);
    setParams({ years: [...next].sort((a, b) => a - b).join(',') || null });
  }

  // Reopen on the programme you were last looking at. Only when the URL names
  // no project — never overriding an explicit link.
  $effect(() => {
    if (projectId != null || data.projects.length === 0) return;
    let last: number | null = null;
    try {
      const raw = localStorage.getItem(LAST_KEY);
      last = raw ? Number(raw) : null;
    } catch { last = null; }
    if (last && data.projects.some((p) => p.id === last)) {
      goto(`?project=${last}`, { replaceState: true, noScroll: true });
    }
  });

  // ── Derived data ───────────────────────────────────────────────────────
  const bundle = $derived(data.insights);
  const metrics = $derived(bundle ? computeMetrics(bundle, filters) : null);
  const years = $derived(bundle ? availableYears(bundle) : []);
  const personRoles = $derived(bundle ? availablePersonRoles(bundle) : []);
  const orgRoles = $derived(bundle ? availableOrgRoles(bundle) : []);

  // Programmes (rows with cohorts) first — they are what you come here for.
  const programmeOptions = $derived(
    [...data.projects].sort(
      (a, b) => b.childCount - a.childCount || a.name.localeCompare(b.name)
    )
  );
  const programmes = $derived(programmeOptions.filter((p) => p.childCount > 0));

  const activeFilterCount = $derived(
    filters.years.size +
      (filters.personRole !== 'all' ? 1 : 0) +
      (filters.orgRole !== 'all' ? 1 : 0) +
      (filters.includeCohorts ? 0 : 1) +
      (filters.includeFormerMembers ? 0 : 1)
  );

  const filterSummary = $derived.by(() => {
    const bits: string[] = [];
    bits.push(filters.years.size ? `years ${[...filters.years].sort().join(', ')}` : 'all years');
    if (filters.personRole !== 'all') bits.push(`people: ${roleLabel(filters.personRole)}`);
    if (filters.orgRole !== 'all') bits.push(`orgs: ${roleLabel(filters.orgRole)}`);
    if (!filters.includeCohorts) bits.push('programme row only');
    if (!filters.includeFormerMembers) bits.push('current members only');
    return bits.join(' · ');
  });

  // One currency label for the money figures. Mixed currencies would make a
  // single total a lie, so we say so instead of silently adding them up.
  const currencyLabel = $derived(
    !metrics || metrics.currencies.length === 0
      ? 'ISK'
      : metrics.currencies.length === 1
        ? metrics.currencies[0]
        : 'mixed'
  );
  const mixedCurrencies = $derived((metrics?.currencies.length ?? 0) > 1);

  const cohortRange = $derived.by(() => {
    const ys = (metrics?.cohorts ?? []).map((c) => c.year).filter((y): y is number => y != null);
    if (ys.length === 0) return '';
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  });

  const money = (n: number) => formatCompactMoney(n, currencyLabel);

  // The block computes this too; sharing one derivation is what stops the
  // export and the screen from disagreeing.
  const marketingMetrics = $derived.by(() => {
    const f = emptyMarketingFilters();
    const w = windowForYears(filters.years, data.marketing.window);
    f.since = w.since;
    f.until = w.until;
    f.projectId = projectId;
    f.includeDescendants = filters.includeCohorts;
    return computeMarketing(data.marketing, f);
  });

  let exporting = $state(false);
  async function exportWorkbook() {
    if (!metrics || !bundle) return;
    exporting = true;
    try {
      await downloadWorkbook(
        metrics,
        {
          programme: bundle.rootName,
          filterSummary: filterSummary,
          generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ')
        },
        // Spend rides along in the same file, over the same slice — a
        // programme report that needs two exports stapled together is two
        // reports.
        marketingSheets(marketingMetrics, data.marketing)
      );
    } finally {
      exporting = false;
    }
  }
</script>

<svelte:head><title>{bundle ? `${bundle.rootName} · Insights` : 'Insights'}</title></svelte:head>

<section class="space-y-5">
  <!-- ── Header ─────────────────────────────────────────────────────── -->
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="hero-eyebrow">Programme insights</p>
      <h1 class="mt-1 truncate text-3xl font-semibold">
        {bundle?.rootName ?? 'Pick a programme'}
      </h1>
      {#if metrics && bundle}
        <p class="mt-1 text-sm text-ink-400">
          {metrics.kpi.cohorts} cohort{metrics.kpi.cohorts === 1 ? '' : 's'}{cohortRange ? ` · ${cohortRange}` : ''}
          · <a class="underline decoration-dotted hover:text-ink-700" href={`/projects/${bundle.rootId}`}>open the project</a>
        </p>
      {/if}
    </div>
    {#if metrics}
      <div class="flex shrink-0 flex-wrap items-center gap-2 print:hidden">
        <button class="btn-ghost !min-h-0 !py-1.5 text-xs" onclick={() => window.print()}>
          <Icon name="download" size={14} /> Print / PDF
        </button>
        <button class="btn-primary !min-h-0 !py-1.5 text-xs" disabled={exporting} onclick={exportWorkbook}>
          <Icon name="download" size={14} /> {exporting ? 'Building…' : 'Export .xlsx'}
        </button>
      </div>
    {/if}
  </div>

  {#if data.error}
    <div class="card border-tag-salesText/40 p-4 text-sm">
      <p class="font-medium">Couldn't load this programme.</p>
      <p class="mt-1 text-ink-500">{data.error}</p>
    </div>
  {/if}

  <!-- ── The filter row. One row, above everything it scopes. ────────── -->
  <div class="card space-y-3 p-3 print:hidden">
    <div class="flex flex-wrap items-end gap-3">
      <label class="min-w-0 flex-1 basis-64">
        <span class="mb-1 block text-xs text-ink-400">Programme or project</span>
        <select
          class="input w-full"
          value={projectId ?? ''}
          onchange={(e) => {
            const v = Number((e.currentTarget as HTMLSelectElement).value);
            if (Number.isFinite(v) && v > 0) pickProject(v);
          }}
        >
          <option value="" disabled>Choose…</option>
          {#if programmes.length}
            <optgroup label="Programmes (with cohorts)">
              {#each programmes as p (p.id)}
                <option value={p.id}>{p.name} — {p.childCount} cohorts</option>
              {/each}
            </optgroup>
          {/if}
          <optgroup label="Single projects">
            {#each programmeOptions.filter((p) => p.childCount === 0) as p (p.id)}
              <option value={p.id}>{p.name}{p.year ? ` (${p.year})` : ''}</option>
            {/each}
          </optgroup>
        </select>
      </label>

      {#if bundle}
        <label class="min-w-0 basis-44">
          <span class="mb-1 block text-xs text-ink-400">People role</span>
          <select
            class="input w-full"
            value={filters.personRole}
            onchange={(e) => setParams({ prole: (e.currentTarget as HTMLSelectElement).value })}
          >
            <option value="all">Everyone</option>
            {#each personRoles as r (r)}<option value={r}>{roleLabel(r)}</option>{/each}
          </select>
        </label>
        <label class="min-w-0 basis-44">
          <span class="mb-1 block text-xs text-ink-400">Organization role</span>
          <select
            class="input w-full"
            value={filters.orgRole}
            onchange={(e) => setParams({ orole: (e.currentTarget as HTMLSelectElement).value })}
          >
            <option value="all">All organizations</option>
            {#each orgRoles as r (r)}<option value={r}>{roleLabel(r)}</option>{/each}
          </select>
        </label>
      {/if}
    </div>

    {#if bundle && years.length > 1}
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="mr-1 text-xs text-ink-400">Years</span>
        <button
          type="button"
          class="chip-radio"
          class:is-selected={filters.years.size === 0}
          onclick={() => setParams({ years: null })}
        >All</button>
        {#each years as y (y)}
          <button
            type="button"
            class="chip-radio tabular-nums"
            class:is-selected={filters.years.has(y)}
            onclick={() => toggleYear(y)}
          >{y}</button>
        {/each}
      </div>
    {/if}

    {#if bundle}
      <div class="flex flex-wrap items-center gap-3 text-xs text-ink-500">
        <label class="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand"
            checked={filters.includeCohorts}
            onchange={(e) => setParams({ cohorts: (e.currentTarget as HTMLInputElement).checked ? null : '0' })}
          />
          Roll up cohorts
        </label>
        <label class="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand"
            checked={filters.includeFormerMembers}
            onchange={(e) => setParams({ former: (e.currentTarget as HTMLInputElement).checked ? null : '0' })}
          />
          Include former members
        </label>
        {#if activeFilterCount > 0}
          <button
            type="button"
            class="ml-auto inline-flex items-center gap-1 text-ink-400 hover:text-ink-700"
            onclick={() => setParams({ years: null, prole: null, orole: null, cohorts: null, former: null })}
          >
            <Icon name="x" size={12} /> Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if !bundle}
    <!-- Landing state: the programmes themselves are the menu. -->
    <div class="card p-4">
      <p class="card-title"><Icon name="chart-bar" size={16} /> Pick a programme</p>
      <p class="mt-1 text-sm text-ink-400">
        A programme rolls up every cohort beneath it. Single projects work too — they just chart as one row.
      </p>
      <ul class="mt-3 grid gap-2 sm:grid-cols-2">
        {#each programmes.slice(0, 12) as p (p.id)}
          <li>
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 rounded-[10px] border border-surface-border px-3 py-2 text-left text-sm transition hover:border-brand/40 hover:bg-surface-hover"
              onclick={() => pickProject(p.id)}
            >
              <span class="min-w-0 truncate text-ink-900">{p.name}</span>
              <span class="shrink-0 text-xs text-ink-400 tabular-nums">{p.childCount} cohorts</span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {:else if metrics}
    <p class="text-xs text-ink-400 print:block hidden">Filters: {filterSummary}</p>

    <!-- ── KPIs ─────────────────────────────────────────────────────── -->
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      <StatTile
        label="Organizations"
        value={metrics.kpi.orgs}
        icon="building"
        note={`${metrics.kpi.orgLinks} memberships across cohorts`}
      />
      <StatTile
        label="People"
        value={metrics.kpi.people}
        icon="users"
        note={`${metrics.kpi.personLinks} memberships · ${metrics.kpi.returningPeople} returned`}
      />
      <StatTile
        label="Participants"
        value={metrics.kpi.participants}
        icon="sparkles"
        note={metrics.kpi.mentors ? `${metrics.kpi.mentors} mentors alongside` : 'no mentor role recorded'}
      />
      <StatTile
        label="Cohorts"
        value={metrics.kpi.cohorts}
        icon="calendar"
        note={cohortRange || 'no dated cohorts'}
      />
      <StatTile
        label={`Grant funding (${currencyLabel})`}
        value={money(metrics.kpi.grantTotal)}
        icon="gift"
        emphasis
        note={`${metrics.kpi.grantCount} awards, all-time`}
      />
      <StatTile
        label="After joining"
        value={money(metrics.kpi.grantTotalAfter)}
        icon="gift"
        note={metrics.kpi.grantTotal
          ? `${formatPercent(metrics.kpi.grantTotalAfter / metrics.kpi.grantTotal)} of the total`
          : 'no awards recorded'}
      />
      <StatTile
        label="Funded organizations"
        value={`${metrics.kpi.fundedOrgs}/${metrics.kpi.orgs}`}
        icon="gift"
        note={metrics.kpi.orgs ? `${formatPercent(metrics.kpi.fundedOrgs / metrics.kpi.orgs)} have a recorded grant` : ''}
      />
      <StatTile
        label="Still active"
        value={`${metrics.kpi.activeOrgs}/${metrics.kpi.orgs}`}
        icon="check"
        note="not marked inactive in the CRM"
      />
    </div>

    {#if mixedCurrencies}
      <p class="text-xs text-ink-400">
        <Icon name="filter" size={12} class="inline" />
        Awards are in more than one currency ({metrics.currencies.join(', ')}); the money figures add the raw
        amounts without conversion. Split by currency in the Grants sheet of the export.
      </p>
    {/if}

    <!-- ── Who ──────────────────────────────────────────────────────── -->
    <Figure
      title="Organizations"
      subtitle="Alphabetical. Click a logo to open the org."
      filename={`${bundle.rootName}-organizations`}
      empty="No organizations linked to this slice."
      table={{
        columns: ['Organization', 'Years', 'Roles', 'Active', 'Grant awards', `Grant total (${currencyLabel})`],
        rows: metrics.orgs.map((o) => [
          o.name,
          o.years.join(' / '),
          o.roles.map(roleLabel).join(', '),
          o.isActive ? 'yes' : 'no',
          o.grantCount,
          o.grantTotal
        ])
      }}
    >
      {#snippet chart()}
        <LogoWall orgs={metrics.orgs} />
      {/snippet}
    </Figure>

    <Figure
      title="People"
      subtitle="Most cohorts first. Click a face to open the person."
      filename={`${bundle.rootName}-people`}
      empty="No people linked to this slice."
      table={{
        columns: ['Name', 'Roles', 'Years', 'Cohorts', 'Gender'],
        rows: metrics.people.map((p) => [
          p.name,
          p.roles.map(roleLabel).join(', '),
          p.years.join(' / '),
          p.cohortCount,
          p.sex === 'unknown' ? 'not recorded' : p.sex
        ])
      }}
    >
      {#snippet chart()}
        <PeopleStrip people={metrics.people} />
      {/snippet}
    </Figure>

    <!-- ── Change over time ─────────────────────────────────────────── -->
    <Figure
      title="Cohort size over time"
      subtitle="Distinct organizations and people per cohort. Click a bar to open that cohort."
      filename={`${bundle.rootName}-cohorts`}
      empty="No dated cohorts to chart."
      legend={[
        { label: 'Organizations', color: 'var(--viz-1)' },
        { label: 'People', color: 'var(--viz-2)' }
      ]}
      table={{
        columns: ['Cohort', 'Year', 'Organizations', 'People', 'Participants', 'Mentors', 'Planned intake', 'Applications'],
        rows: metrics.cohorts.map((c) => [
          c.name, c.year ?? '', c.orgs, c.people, c.participants, c.mentors,
          c.participantCount ?? '', c.applicationCount ?? ''
        ])
      }}
    >
      {#snippet chart()}
        <ColumnChart
          categories={cohortLabels(metrics.cohorts, bundle.rootName)}
          series={[
            { key: 'orgs', label: 'Organizations', color: 'var(--viz-1)' },
            { key: 'people', label: 'People', color: 'var(--viz-2)' }
          ]}
          values={metrics.cohorts.map((c) => [c.orgs, c.people])}
          onpick={(i) => goto(`/projects/${metrics.cohorts[i].id}`)}
        />
      {/snippet}
    </Figure>

    <!-- ── Gender ───────────────────────────────────────────────────── -->
    <Figure
      title="Gender split"
      subtitle={`Distinct people. ${formatPercent(metrics.gender.knownShare)} of them have a gender recorded — the rest are counted as Not recorded, never redistributed.`}
      filename={`${bundle.rootName}-gender`}
      empty="No people to split."
      table={{
        columns: ['Group', 'People', 'Women', 'Men', 'Not recorded'],
        rows: [
          ['All', metrics.kpi.people, ...metrics.gender.all.map((s) => s.value)],
          ...metrics.gender.byRole.map((r) => [r.label, r.total, ...r.splits.map((s) => s.value)])
        ]
      }}
    >
      {#snippet chart()}
        <div class="space-y-4">
          <SplitBar
            segments={metrics.gender.all.map((s) => ({
              key: s.key,
              label: s.label,
              value: s.value,
              color:
                s.key === 'female' ? 'var(--viz-1)' : s.key === 'male' ? 'var(--viz-2)' : 'var(--viz-neutral)'
            }))}
            caption={`${metrics.kpi.people} people in this slice`}
            height={16}
          />
          {#if metrics.gender.byRole.length > 1}
            <div class="space-y-3 border-t border-surface-divider pt-3">
              {#each metrics.gender.byRole as r (r.role)}
                <div class="space-y-1.5">
                  <p class="flex items-baseline justify-between text-xs">
                    <span class="font-medium text-ink-700">{r.label}</span>
                    <span class="text-ink-400 tabular-nums">{r.total}</span>
                  </p>
                  <SplitBar
                    segments={r.splits.map((s) => ({
                      key: s.key,
                      label: s.label,
                      value: s.value,
                      color:
                        s.key === 'female' ? 'var(--viz-1)' : s.key === 'male' ? 'var(--viz-2)' : 'var(--viz-neutral)'
                    }))}
                    height={10}
                  />
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/snippet}
    </Figure>

    <!-- ── Grants ───────────────────────────────────────────────────── -->
    <Figure
      title={`Grant funding by year (${currencyLabel})`}
      subtitle="Split on each organization's first cohort year, so post-programme funding is separable from what it already had."
      filename={`${bundle.rootName}-grants-by-year`}
      empty="No grant awards recorded for these organizations."
      legend={[
        { label: 'Awarded after joining', color: 'var(--viz-1)' },
        { label: 'Awarded before joining', color: 'var(--viz-neutral)' }
      ]}
      table={{
        columns: ['Year', 'After joining', 'Before joining', 'Year unknown', 'Total'],
        rows: metrics.grantsByYear.map((r) => [
          r.year, r.after, r.before, r.unknown, r.after + r.before + r.unknown
        ])
      }}
    >
      {#snippet chart()}
        <ColumnChart
          mode="stacked"
          categories={metrics.grantsByYear.map((r) => String(r.year))}
          series={[
            { key: 'after', label: 'After joining', color: 'var(--viz-1)' },
            { key: 'before', label: 'Before joining', color: 'var(--viz-neutral)' }
          ]}
          values={metrics.grantsByYear.map((r) => [r.after, r.before + r.unknown])}
          format={(n) => formatCompactMoney(n, '')}
          height={220}
        />
      {/snippet}
    </Figure>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="min-w-0">
        <Figure
          title="Where the money came from"
          subtitle="By fund, largest first."
          filename={`${bundle.rootName}-funds`}
          empty="No grant awards recorded."
          table={{
            columns: ['Fund', `Amount (${currencyLabel})`, 'Awards'],
            rows: metrics.grantsByFund.map((f) => [f.fund, f.amount, f.count])
          }}
        >
          {#snippet chart()}
            <BarList
              rows={metrics.grantsByFund.map((f) => ({
                label: f.fund,
                value: f.amount,
                sub: `${f.count} award${f.count === 1 ? '' : 's'}`
              }))}
              format={(n) => formatMoney(n, '')}
            />
          {/snippet}
        </Figure>
      </div>
      <div class="min-w-0">
        <Figure
          title="Best-funded organizations"
          subtitle="All-time grants per cohort org. Click through to the org."
          filename={`${bundle.rootName}-recipients`}
          empty="No funded organizations in this slice."
          table={{
            columns: ['Organization', `Amount (${currencyLabel})`, 'Awards'],
            rows: metrics.topRecipients.map((r) => [r.name, r.amount, r.count])
          }}
        >
          {#snippet chart()}
            <BarList
              rows={metrics.topRecipients.map((r) => ({
                label: r.name,
                value: r.amount,
                id: r.orgId,
                sub: `${r.count} award${r.count === 1 ? '' : 's'}`
              }))}
              format={(n) => formatMoney(n, '')}
              href={(r) => (r.id ? `/orgs/${r.id}` : null)}
            />
          {/snippet}
        </Figure>
      </div>
    </div>

    <!-- ── What it cost ─────────────────────────────────────────────── -->
    <!-- Spend belongs next to the people it reached, not in a separate tool.
         Same project, same year chips, same slice. -->
    {#if projectId != null}
      <MarketingBlock
        bundle={data.marketing}
        {filters}
        {projectId}
        programme={bundle.rootName}
      />
    {/if}

    <!-- ── What we don't know ───────────────────────────────────────── -->
    <!-- A dashboard that only shows what it has invites you to read absence as
         zero. These are the fill rates behind the figures above; low ones are
         the work list, not a defect in the chart. -->
    <div class="card p-4 space-y-2 print:break-inside-avoid">
      <p class="card-title"><Icon name="filter" size={16} /> Data coverage</p>
      <ul class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {#each [
          { label: 'People with a gender recorded', n: metrics.people.filter((p) => p.sex !== 'unknown').length, d: metrics.people.length },
          { label: 'People with a photo', n: metrics.people.filter((p) => p.picture).length, d: metrics.people.length },
          { label: 'People with a role on the link', n: metrics.people.filter((p) => p.roles.length > 0).length, d: metrics.people.length },
          { label: 'Organizations with a logo', n: metrics.orgs.filter((o) => o.logo).length, d: metrics.orgs.length },
          { label: 'Organizations with a website', n: metrics.orgs.filter((o) => o.website).length, d: metrics.orgs.length },
          { label: 'Organizations with an industry', n: metrics.orgs.filter((o) => o.industry).length, d: metrics.orgs.length }
        ] as row (row.label)}
          <li class="flex items-baseline justify-between gap-3 border-b border-surface-divider py-1 last:border-0">
            <span class="min-w-0 text-ink-500">{row.label}</span>
            <span class="shrink-0 tabular-nums">
              <span class="text-ink-900">{row.n}/{row.d}</span>
              <span class="ml-1 text-xs text-ink-400">{row.d ? formatPercent(row.n / row.d) : '—'}</span>
            </span>
          </li>
        {/each}
      </ul>
      <p class="text-xs text-ink-400">
        Industry, employee count and revenue are near-empty on cohort orgs today, so this dashboard
        deliberately charts none of them — the enrichment run has to land first.
      </p>
    </div>
  {/if}
</section>

<style>
  /* Print: one clean report. Figures never split across a page, and the
     page surface goes white so a dark-mode screen doesn't print a black
     rectangle. */
  @media print {
    :global(html),
    :global(body) {
      background: #fff !important;
      color: #000 !important;
    }
    section {
      gap: 0.75rem;
    }
  }
</style>
