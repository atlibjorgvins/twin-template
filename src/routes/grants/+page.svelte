<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import {
    createGrant,
    searchOrgs,
    GRANT_CATEGORY_OPTIONS,
    GRANT_RECURRENCE_OPTIONS,
    GRANT_CURRENCY_OPTIONS,
    grantCategoryLabel,
    formatGrantAmount,
    regionLabel,
    type Grant,
    type GrantAward,
    type Organization
  } from '$lib/directus';
  import { goto } from '$app/navigation';

  let { data }: { data: { grants: Grant[]; awards: GrantAward[] } } = $props();
  let grants = $state<Grant[]>(data.grants);
  let awards = $state<GrantAward[]>(data.awards);
  $effect(() => { grants = data.grants; awards = data.awards; });

  // Tabs: Programmes (the catalogue) ↔ Awards (each instance given).
  let tab = $state<'programmes' | 'awards'>('programmes');
  let q = $state('');

  // ── Filter state ─────────────────────────────────────────────────────
  // Programmes tab filters
  let filterCategories = $state(new Set<string>());
  let filterFunderIds = $state(new Set<number>());
  let filterRecurring = $state<'all' | 'recurring' | 'one_off'>('all');
  // Awards tab filters
  let filterYears = $state(new Set<number>());
  let filterGrantIds = $state(new Set<number>());
  let filterAwardStatuses = $state(new Set<string>());
  // UI
  let filtersOpen = $state(false);

  // ── Sort (Programmes tab) ───────────────────────────────────────
  // Default is "Last edited" — a hub view's primary job is "what did
  // I touch most recently". Awards-count is the next most-asked
  // ordering, then alphabetical for find-by-name. Persisted per-
  // browser so the user's pick survives reloads.
  type SortKey = 'updated' | 'name' | 'awards' | 'created';
  const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
    { value: 'updated', label: 'Last edited' },
    { value: 'name',    label: 'Name (A→Z)' },
    { value: 'awards',  label: 'Awards (most first)' },
    { value: 'created', label: 'Newest first' }
  ];
  const SORT_STORAGE_KEY = 'twin.grants.programmes.sort.v1';
  let sortKey = $state<SortKey>('updated');
  let sortOpen = $state(false);

  // Hydrate from localStorage once on mount.
  $effect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(SORT_STORAGE_KEY);
      if (raw && SORT_OPTIONS.some((o) => o.value === raw)) sortKey = raw as SortKey;
    } catch {}
  });
  function setSort(k: SortKey) {
    sortKey = k;
    sortOpen = false;
    try { window.localStorage.setItem(SORT_STORAGE_KEY, k); } catch {}
  }
  const sortLabel = $derived(SORT_OPTIONS.find((o) => o.value === sortKey)?.label ?? 'Sort');

  function toggleSetEntry<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  }

  function clearAllFilters() {
    filterCategories = new Set();
    filterFunderIds = new Set();
    filterRecurring = 'all';
    filterYears = new Set();
    filterGrantIds = new Set();
    filterAwardStatuses = new Set();
  }

  // Distinct values derived from the loaded data — keeps the filter
  // chip rows in sync with what's actually in the DB instead of a
  // hardcoded list. Sorted: years descending, names alphabetical.
  const funderOptions = $derived.by(() => {
    const m = new Map<number, string>();
    for (const g of grants) {
      const f = g.funder_org_id;
      if (f && typeof f === 'object' && f.id) m.set(f.id, f.name ?? `Org ${f.id}`);
    }
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  const categoryOptions = $derived.by(() => {
    const used = new Set<string>();
    for (const g of grants) if (g.category) used.add(String(g.category));
    return GRANT_CATEGORY_OPTIONS.filter((o) => used.has(o.value));
  });

  const yearOptions = $derived.by(() => {
    const ys = new Set<number>();
    for (const a of awards) if (typeof a.awarded_year === 'number') ys.add(a.awarded_year);
    return [...ys].sort((a, b) => b - a);
  });

  const grantOptionsForAwards = $derived.by(() => {
    const m = new Map<number, string>();
    for (const a of awards) {
      const g = a.grant_id;
      if (g && typeof g === 'object' && g.id) m.set(g.id, g.name ?? g.short_name ?? `Grant ${g.id}`);
    }
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  const AWARD_STATUS_OPTIONS = [
    { value: 'applied',   label: 'Applied' },
    { value: 'awarded',   label: 'Awarded' },
    { value: 'active',    label: 'Active' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'rejected',  label: 'Rejected' }
  ] as const;
  const usedAwardStatuses = $derived.by(() => {
    const used = new Set<string>();
    for (const a of awards) if (a.award_status) used.add(String(a.award_status));
    return AWARD_STATUS_OPTIONS.filter((o) => used.has(o.value));
  });

  const activeProgrammeFilters = $derived(
    filterCategories.size + filterFunderIds.size + (filterRecurring !== 'all' ? 1 : 0)
  );
  const activeAwardFilters = $derived(
    filterYears.size + filterGrantIds.size + filterAwardStatuses.size
  );
  const activeFilterCount = $derived(tab === 'programmes' ? activeProgrammeFilters : activeAwardFilters);

  const sortedFilteredGrants = $derived.by(() => {
    const arr = filteredGrants.slice();
    if (sortKey === 'name') {
      arr.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    } else if (sortKey === 'awards') {
      arr.sort((a, b) => (awardCountByGrant.get(b.id) ?? 0) - (awardCountByGrant.get(a.id) ?? 0));
    } else {
      // 'updated' and 'created' both fall through to a date sort —
      // newest first, with the other date as the tie-break.
      const primary = sortKey === 'created' ? 'date_created' : 'date_updated';
      const secondary = sortKey === 'created' ? 'date_updated' : 'date_created';
      const t = (s: string | null | undefined) => (s ? Date.parse(s) : 0);
      arr.sort((a, b) => {
        const ap = t(a[primary]) || t(a[secondary]);
        const bp = t(b[primary]) || t(b[secondary]);
        if (bp !== ap) return bp - ap;
        return (a.name ?? '').localeCompare(b.name ?? '');
      });
    }
    return arr;
  });

  const filteredGrants = $derived(
    grants.filter((g) => {
      if (q.trim()) {
        const needle = q.toLowerCase();
        const funderName = g.funder_org_id && typeof g.funder_org_id === 'object' ? (g.funder_org_id.name ?? '') : '';
        if (!(
          (g.name ?? '').toLowerCase().includes(needle) ||
          (g.short_name ?? '').toLowerCase().includes(needle) ||
          (g.funder_label ?? '').toLowerCase().includes(needle) ||
          funderName.toLowerCase().includes(needle) ||
          (g.summary ?? '').toLowerCase().includes(needle)
        )) return false;
      }
      if (filterCategories.size > 0 && !filterCategories.has(String(g.category ?? ''))) return false;
      if (filterFunderIds.size > 0) {
        const f = g.funder_org_id;
        const fid = f && typeof f === 'object' ? f.id : (typeof f === 'number' ? f : null);
        if (!fid || !filterFunderIds.has(fid)) return false;
      }
      if (filterRecurring === 'recurring' && !g.is_recurring) return false;
      if (filterRecurring === 'one_off'   &&  g.is_recurring) return false;
      return true;
    })
  );

  const filteredAwards = $derived(
    awards.filter((a) => {
      if (q.trim()) {
        const needle = q.toLowerCase();
        const grant = a.grant_id && typeof a.grant_id === 'object' ? a.grant_id : null;
        const org = a.organization_id && typeof a.organization_id === 'object' ? a.organization_id : null;
        if (!(
          (grant?.name ?? '').toLowerCase().includes(needle) ||
          (org?.name ?? '').toLowerCase().includes(needle) ||
          (a.award_name ?? '').toLowerCase().includes(needle) ||
          (a.stage ?? '').toLowerCase().includes(needle)
        )) return false;
      }
      if (filterYears.size > 0) {
        const y = typeof a.awarded_year === 'number' ? a.awarded_year : null;
        if (y == null || !filterYears.has(y)) return false;
      }
      if (filterGrantIds.size > 0) {
        const g = a.grant_id;
        const gid = g && typeof g === 'object' ? g.id : (typeof g === 'number' ? g : null);
        if (!gid || !filterGrantIds.has(gid)) return false;
      }
      if (filterAwardStatuses.size > 0 && !filterAwardStatuses.has(String(a.award_status ?? ''))) return false;
      return true;
    })
  );

  // Running totals for the awards tab (per currency), reflecting the
  // current filter set so users see "what's the total for 2024?".
  const filteredAwardTotals = $derived.by(() => {
    const m = new Map<string, number>();
    for (const a of filteredAwards) {
      const cur = a.currency ?? 'ISK';
      const n = typeof a.total_amount === 'number' ? a.total_amount : Number(a.total_amount ?? 0);
      if (Number.isFinite(n)) m.set(cur, (m.get(cur) ?? 0) + n);
    }
    return [...m.entries()].map(([cur, n]) => formatGrantAmount(n, cur));
  });

  // Aggregated stats for the tab badges.
  const awardCountByGrant = $derived.by(() => {
    const m = new Map<number, number>();
    for (const a of awards) {
      const gid = a.grant_id && typeof a.grant_id === 'object' ? a.grant_id.id : (typeof a.grant_id === 'number' ? a.grant_id : null);
      if (gid != null) m.set(gid, (m.get(gid) ?? 0) + 1);
    }
    return m;
  });

  // ── New programme flow (inline) ────────────────────────────────────
  let newOpen = $state(false);
  let newName = $state('');
  let newShort = $state('');
  // Funder is always an organisation now — search + pick.
  let newFunderOrg = $state<Organization | null>(null);
  let funderQuery = $state('');
  let funderResults = $state<Organization[]>([]);
  let funderTimer: ReturnType<typeof setTimeout> | null = null;
  function onFunderQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    funderQuery = v; newFunderOrg = null;
    if (funderTimer) clearTimeout(funderTimer);
    funderTimer = setTimeout(async () => {
      if (!v.trim()) { funderResults = []; return; }
      try { funderResults = (await searchOrgs(v, 6)) as Organization[]; } catch { funderResults = []; }
    }, 180);
  }
  function pickFunder(o: Organization) { newFunderOrg = o; funderQuery = o.name ?? ''; funderResults = []; }
  let newCategory = $state('rnd');
  let newCurrency = $state<string>('ISK');
  let newRecurring = $state(true);
  let newRecurrence = $state('annual');
  let newDuration = $state<number | ''>('');
  let newWebsite = $state('');
  let newSummary = $state('');
  let creating = $state(false);
  let newError = $state('');

  function openNew() {
    newOpen = true;
    newName = ''; newShort = '';
    newFunderOrg = null; funderQuery = ''; funderResults = [];
    newCategory = 'rnd'; newCurrency = 'ISK';
    newRecurring = true; newRecurrence = 'annual';
    newDuration = ''; newWebsite = ''; newSummary = '';
    newError = '';
  }

  async function submitNew() {
    const name = newName.trim();
    if (!name) { newError = 'Name is required'; return; }
    if (!newFunderOrg) { newError = 'Pick the funder organisation'; return; }
    creating = true; newError = '';
    try {
      const created = await createGrant({
        name,
        short_name: newShort.trim() || null,
        funder_org_id: newFunderOrg.id,
        category: newCategory,
        currency: newCurrency,
        is_recurring: newRecurring,
        recurrence: newRecurring ? newRecurrence : null,
        typical_duration_years: typeof newDuration === 'number' ? newDuration : (newDuration ? Number(newDuration) : null),
        website: newWebsite.trim() || null,
        summary: newSummary.trim() || null,
        country: 'Iceland'
      });
      grants = [...grants, created];
      goto(`/grants/${created.id}`);
    } catch (e) {
      newError = e instanceof Error ? e.message : String(e);
    } finally { creating = false; }
  }
</script>

<svelte:head><title>Grants · Hub</title></svelte:head>

<section class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <h1 class="text-3xl font-semibold">
      Grants
      <span class="ml-2 text-ink-300 font-medium">{grants.length}</span>
    </h1>
    <button class="btn-primary hidden md:inline-flex" onclick={openNew}>
      <Icon name="plus" size={16} /> New programme
    </button>
  </div>

  {#if newOpen}
    <div class="card border-brand/40 p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="card-title"><Icon name="gift" size={16} /> New grant programme</div>
        <button class="text-ink-400 hover:text-ink-700" aria-label="Close" onclick={() => (newOpen = false)}>✕</button>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="block sm:col-span-2">
          <span class="block text-xs text-ink-400 mb-1">Name *</span>
          <input type="text" class="input w-full" bind:value={newName} placeholder="e.g. Tækniþróunarsjóður" />
        </label>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Short name</span>
          <input type="text" class="input w-full" bind:value={newShort} placeholder="e.g. TÞS" />
        </label>
        <label class="block relative">
          <span class="block text-xs text-ink-400 mb-1">Funder organisation *</span>
          <input
            type="text"
            class="input w-full"
            placeholder="Search organisations…"
            value={funderQuery}
            oninput={onFunderQuery}
          />
          {#if funderResults.length > 0}
            <ul class="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
              {#each funderResults as o (o.id)}
                <li>
                  <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => pickFunder(o)}>
                    <Icon name="building" size={12} />
                    <span class="truncate">{o.name}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if newFunderOrg}
            <div class="mt-1 text-xs text-ink-500">Funder: <span class="font-medium text-ink-900">{newFunderOrg.name}</span></div>
          {/if}
        </label>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Category</span>
          <select class="input w-full" bind:value={newCategory}>
            {#each GRANT_CATEGORY_OPTIONS as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
          </select>
        </label>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Currency</span>
          <select class="input w-full" bind:value={newCurrency}>
            {#each GRANT_CURRENCY_OPTIONS as c (c)}<option value={c}>{c}</option>{/each}
          </select>
        </label>
        <label class="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand" bind:checked={newRecurring} />
          Recurring (regular call)
        </label>
        {#if newRecurring}
          <label class="block">
            <span class="block text-xs text-ink-400 mb-1">Recurrence</span>
            <select class="input w-full" bind:value={newRecurrence}>
              {#each GRANT_RECURRENCE_OPTIONS as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
            </select>
          </label>
        {/if}
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Typical duration (years)</span>
          <input type="number" min="1" max="10" class="input w-full" bind:value={newDuration} placeholder="e.g. 2" />
        </label>
        <label class="block sm:col-span-2">
          <span class="block text-xs text-ink-400 mb-1">Website</span>
          <input type="url" class="input w-full" bind:value={newWebsite} placeholder="https://…" />
        </label>
        <label class="block sm:col-span-2">
          <span class="block text-xs text-ink-400 mb-1">Summary</span>
          <textarea rows="2" class="input w-full" bind:value={newSummary} placeholder="One-liner about what this programme funds."></textarea>
        </label>
      </div>
      {#if newError}<div class="text-xs text-tag-salesText">{newError}</div>{/if}
      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost" onclick={() => (newOpen = false)} disabled={creating}>Cancel</button>
        <button class="btn-primary" onclick={submitNew} disabled={creating || !newName.trim()}>
          {creating ? 'Creating…' : 'Create & open'}
        </button>
      </div>
    </div>
  {/if}

  <div class="flex items-center justify-between gap-2 border-b border-surface-divider">
    <div class="flex gap-2">
      <button
        class="relative flex items-center gap-2 px-2 py-3 text-sm font-medium transition {tab === 'programmes' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
        onclick={() => (tab = 'programmes')}
      >
        <Icon name="gift" size={14} /> Programmes <span class="text-ink-300">{grants.length}</span>
        {#if tab === 'programmes'}<span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>{/if}
      </button>
      <button
        class="relative flex items-center gap-2 px-2 py-3 text-sm font-medium transition {tab === 'awards' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
        onclick={() => (tab = 'awards')}
      >
        <Icon name="sparkles" size={14} /> Awards <span class="text-ink-300">{awards.length}</span>
        {#if tab === 'awards'}<span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>{/if}
      </button>
    </div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-[8px] border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
        onclick={() => (filtersOpen = !filtersOpen)}
        aria-expanded={filtersOpen}
      >
        <Icon name="tag" size={12} /> Filters
        {#if activeFilterCount > 0}
          <span class="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">{activeFilterCount}</span>
        {/if}
      </button>
      {#if tab === 'programmes'}
        <!-- Sort dropdown. Programmes tab only — the Awards tab list
             below has its own AwardsTable variant with column-header
             sorting; keep them visually distinct so users don't expect
             the same control to work on both. -->
        <div class="relative">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-[8px] border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
            onclick={() => (sortOpen = !sortOpen)}
            aria-expanded={sortOpen}
          >
            <Icon name="arrow-right" size={12} class="rotate-90" />
            <span class="hidden sm:inline">Sort:</span> <span>{sortLabel}</span>
          </button>
          {#if sortOpen}
            <ul
              class="absolute right-0 z-20 mt-1 w-56 rounded-md border border-surface-border bg-surface-card p-1 shadow-card"
              role="menu"
              aria-label="Sort programmes by"
            >
              {#each SORT_OPTIONS as opt (opt.value)}
                {@const active = sortKey === opt.value}
                <li>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    class="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-hover {active ? 'text-brand font-medium' : 'text-ink-700'}"
                    onclick={() => setSort(opt.value)}
                  >
                    <span>{opt.label}</span>
                    {#if active}<Icon name="check" size={14} />{/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
      <div class="relative w-full sm:w-80">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300">
          <Icon name="search" size={16} />
        </span>
        <input type="search" bind:value={q} placeholder={tab === 'programmes' ? 'Search programmes…' : 'Search awards…'} class="input pl-9 text-sm" />
      </div>
    </div>
  </div>

  <!-- Filter drawer. Collapses by default. Different chips per tab —
       programmes filter by category / funder / recurring; awards
       filter by year / programme / status. -->
  {#if filtersOpen}
    <div class="card p-3 space-y-3">
      {#if tab === 'programmes'}
        {#if categoryOptions.length > 0}
          <div>
            <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Category</div>
            <div class="flex flex-wrap gap-1.5">
              {#each categoryOptions as c (c.value)}
                {@const on = filterCategories.has(c.value)}
                <button
                  type="button"
                  class="chip-radio"
                  class:is-selected={on}
                  onclick={() => (filterCategories = toggleSetEntry(filterCategories, c.value))}
                >{c.label}</button>
              {/each}
            </div>
          </div>
        {/if}
        {#if funderOptions.length > 0}
          <div>
            <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Funder</div>
            <div class="flex flex-wrap gap-1.5">
              {#each funderOptions as f (f.id)}
                {@const on = filterFunderIds.has(f.id)}
                <button
                  type="button"
                  class="chip-radio"
                  class:is-selected={on}
                  onclick={() => (filterFunderIds = toggleSetEntry(filterFunderIds, f.id))}
                >{f.name}</button>
              {/each}
            </div>
          </div>
        {/if}
        <div>
          <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Recurrence</div>
          <div class="flex flex-wrap gap-1.5">
            {#each [['all', 'All'], ['recurring', 'Recurring only'], ['one_off', 'One-off only']] as const as [v, label]}
              <button
                type="button"
                class="chip-radio"
                class:is-selected={filterRecurring === v}
                onclick={() => (filterRecurring = v)}
              >{label}</button>
            {/each}
          </div>
        </div>
      {:else}
        {#if yearOptions.length > 0}
          <div>
            <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Year</div>
            <div class="flex flex-wrap gap-1.5">
              {#each yearOptions as y (y)}
                {@const on = filterYears.has(y)}
                <button
                  type="button"
                  class="chip-radio"
                  class:is-selected={on}
                  onclick={() => (filterYears = toggleSetEntry(filterYears, y))}
                >{y}</button>
              {/each}
            </div>
          </div>
        {/if}
        {#if grantOptionsForAwards.length > 0}
          <div>
            <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Programme</div>
            <div class="flex flex-wrap gap-1.5">
              {#each grantOptionsForAwards as g (g.id)}
                {@const on = filterGrantIds.has(g.id)}
                <button
                  type="button"
                  class="chip-radio"
                  class:is-selected={on}
                  onclick={() => (filterGrantIds = toggleSetEntry(filterGrantIds, g.id))}
                >{g.name}</button>
              {/each}
            </div>
          </div>
        {/if}
        {#if usedAwardStatuses.length > 0}
          <div>
            <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Status</div>
            <div class="flex flex-wrap gap-1.5">
              {#each usedAwardStatuses as s (s.value)}
                {@const on = filterAwardStatuses.has(s.value)}
                <button
                  type="button"
                  class="chip-radio"
                  class:is-selected={on}
                  onclick={() => (filterAwardStatuses = toggleSetEntry(filterAwardStatuses, s.value))}
                >{s.label}</button>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
      {#if activeFilterCount > 0}
        <div class="flex justify-end">
          <button type="button" class="text-xs text-ink-400 hover:text-ink-700" onclick={clearAllFilters}>Clear filters</button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Awards-tab summary band — totals reflect active filters so the
       user can see "what got awarded in 2024" at a glance. -->
  {#if tab === 'awards' && filteredAwardTotals.length > 0}
    <div class="rounded-[10px] border border-surface-border bg-surface-card px-3 py-2 text-xs">
      <span class="font-display uppercase tracking-wider text-ink-400">{filteredAwards.length} {filteredAwards.length === 1 ? 'award' : 'awards'} ·</span>
      <span class="font-medium text-ink-900">{filteredAwardTotals.join(' · ')}</span>
    </div>
  {/if}

  {#if tab === 'programmes'}
    <div class="card overflow-hidden">
      <ul class="divide-y divide-surface-divider">
        {#each sortedFilteredGrants as g (g.id)}
          <li class="hover:bg-surface-hover {g.status === 'archived' ? 'opacity-60' : ''}">
            <a href={`/grants/${g.id}`} class="flex min-h-[60px] items-center gap-3 px-4 py-3 text-sm sm:grid sm:grid-cols-[auto_2fr_1fr_1fr_auto] sm:py-2.5">
              <span
                class="hidden sm:inline-block h-3 w-3 shrink-0 rounded-full"
                style:background-color={g.color || 'transparent'}
                style:border={g.color ? 'none' : '1px dashed var(--border-subtle)'}
                aria-hidden="true"
              ></span>
              <div class="min-w-0 flex-1 sm:flex-initial">
                <div class="flex items-center gap-2">
                  {#if g.color}<span class="sm:hidden inline-block h-2 w-2 shrink-0 rounded-full" style:background-color={g.color}></span>{/if}
                  <div class="truncate font-medium text-ink-900">{g.name}</div>
                  {#if g.short_name && g.short_name !== g.name}<span class="text-xs text-ink-400">({g.short_name})</span>{/if}
                </div>
                {#if g.summary}<div class="truncate text-xs text-ink-400 hidden sm:block">{g.summary}</div>{/if}
              </div>
              <span class="hidden sm:inline truncate text-ink-500">
                {#if g.funder_org_id && typeof g.funder_org_id === 'object'}
                  {g.funder_org_id.name}
                {:else}
                  {g.funder_label ?? '—'}
                {/if}
              </span>
              <span class="hidden sm:inline truncate text-ink-500">{grantCategoryLabel(g.category)}</span>
              <span class="shrink-0 inline-flex items-center gap-2">
                {#if g.is_recurring}<TagPill tone="online">{g.recurrence ?? 'recurring'}</TagPill>{/if}
                {#if awardCountByGrant.get(g.id)}
                  <span class="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] text-ink-500">{awardCountByGrant.get(g.id)} {awardCountByGrant.get(g.id) === 1 ? 'award' : 'awards'}</span>
                {/if}
              </span>
            </a>
          </li>
        {:else}
          <li class="px-4 py-6 text-center text-sm text-ink-400">No programmes yet. Create one above.</li>
        {/each}
      </ul>
    </div>
  {:else}
    <div class="card overflow-hidden">
      <ul class="divide-y divide-surface-divider">
        {#each filteredAwards as a (a.id)}
          {@const grant = a.grant_id && typeof a.grant_id === 'object' ? a.grant_id : null}
          {@const org = a.organization_id && typeof a.organization_id === 'object' ? a.organization_id : null}
          {@const dom = a.domain_id && typeof a.domain_id === 'object' ? a.domain_id : null}
          {@const sub = a.subdomain_id && typeof a.subdomain_id === 'object' ? a.subdomain_id : null}
          {@const displayLabel = org?.name ?? a.applicant_label ?? '(unknown applicant)'}
          {@const unlinked = !org && !!a.applicant_label}
          <li class="hover:bg-surface-hover {a.status === 'archived' ? 'opacity-60' : ''}">
            <a href={`/grants/awards/${a.id}`} class="flex min-h-[60px] items-center gap-3 px-4 py-3 text-sm sm:grid sm:grid-cols-[1.4fr_1fr_auto_auto] sm:py-2.5">
              <div class="min-w-0 flex-1 sm:flex-initial">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span class="truncate font-medium text-ink-900">{displayLabel}</span>
                  {#if unlinked}
                    <span
                      class="shrink-0 rounded-full border border-tag-sales bg-tag-sales/30 px-1.5 py-0.5 text-[10px] font-medium text-tag-salesText"
                      title="No org linked yet — click into the award to link one."
                    >link?</span>
                  {/if}
                </div>
                <div class="truncate text-xs text-ink-500">
                  {a.award_name ?? grant?.name ?? '—'}{a.stage ? ` · ${a.stage}` : ''}
                </div>
                {#if dom || a.region_acronym}
                  <div class="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
                    {#if dom}
                      <span class="rounded-full bg-surface-hover px-1.5 py-0.5 text-ink-600">{dom.name}{sub ? ` · ${sub.name}` : ''}</span>
                    {/if}
                    {#if a.region_acronym}
                      <span class="rounded-full border border-surface-border px-1.5 py-0.5 text-ink-500" title={regionLabel(a.region_acronym) ?? ''}>{a.region_acronym}</span>
                    {/if}
                  </div>
                {/if}
              </div>
              <span class="hidden sm:inline truncate text-ink-500">{a.awarded_year ?? a.fund_year ?? '—'}</span>
              <span class="shrink-0 tabular-nums text-ink-900">{formatGrantAmount(a.total_amount, a.currency)}</span>
              <span class="shrink-0">
                {#if a.award_status === 'active'}<TagPill tone="online">active</TagPill>
                {:else if a.award_status === 'completed'}<TagPill tone="neutral">completed</TagPill>
                {:else if a.award_status === 'cancelled' || a.award_status === 'rejected'}<TagPill tone="sales">{a.award_status}</TagPill>
                {:else}<TagPill tone="neutral">{a.award_status ?? 'awarded'}</TagPill>{/if}
              </span>
            </a>
          </li>
        {:else}
          <li class="px-4 py-6 text-center text-sm text-ink-400">No awards recorded yet.</li>
        {/each}
      </ul>
    </div>
  {/if}

  <button
    type="button"
    class="fixed right-4 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-card transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand md:hidden"
    style="bottom: calc(env(safe-area-inset-bottom) + 4.75rem);"
    aria-label="New programme"
    onclick={openNew}
  >
    <Icon name="plus" size={24} />
  </button>
</section>
