<script lang="ts">
  // Shared awards table — column picker, filter drawer, sort, mobile
  // stacked layout. Used by /grants/[id] (programme detail) and by
  // ProjectGrantsCard (project hierarchy roll-up). Each caller passes
  // its own storage/URL keys so multiple tables on the same site
  // don't fight over localStorage or URL search params.
  //
  // Column visibility persists per-browser via localStorage (key per
  // caller). Filter state syncs to URL query params unless `urlPrefix`
  // is the literal string `null` (passed as a flag to disable URL
  // sync — useful when the table sits inside a card on a page that
  // owns the URL for other reasons).
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import {
    formatGrantAmount,
    avatarSrc,
    regionLabel,
    personName,
    type GrantAward,
    type Organization,
    type Person
  } from '$lib/directus';

  // ── Column definitions ─────────────────────────────────────────
  // Order in ALL_COLS = render order in the table. Mirror the Rannís
  // grid layout (Númer → Úthlutun) so users reading both at once map
  // them mentally without re-orienting.
  export type ColKey =
    | 'rannis_id' | 'fund_year' | 'booking_year' | 'award_name'
    | 'applicant' | 'programme' | 'domain' | 'subdomain'
    | 'contact' | 'region' | 'amount';

  type Col = { key: ColKey; label: string };
  // Order matters — this is the column render order. Umsækjandi leads
  // because the recipient is the most important thing about an award
  // in our context (we read this table to find out who got what,
  // not to admire the Rannís numbering scheme).
  const ALL_COLS_BASE: Col[] = [
    { key: 'applicant',    label: 'Umsækjandi' },
    { key: 'award_name',   label: 'Heiti verkefnis' },
    { key: 'amount',       label: 'Úthlutun' },
    { key: 'fund_year',    label: 'Úthlutunarár' },
    { key: 'booking_year', label: 'Bókunarár' },
    { key: 'programme',    label: 'Tegund styrks' },
    { key: 'domain',       label: 'Yfirflokkur' },
    { key: 'subdomain',    label: 'Undirflokkur' },
    { key: 'contact',      label: 'Verkefnisstjóri' },
    { key: 'region',       label: 'Landshluti' },
    { key: 'rannis_id',    label: 'Númer' }
  ];

  type Props = {
    awards: GrantAward[];
    /** localStorage key for column-visibility persistence. */
    storageKey?: string;
    /** Default visible columns when nothing's persisted. */
    defaultCols?: ColKey[];
    /** Whether to show the Programme column at all (rarely useful on
     *  a programme-detail page; very useful on a project roll-up). */
    showProgramme?: boolean;
    /** Whether the archive (x) action column is rendered. */
    archiveable?: boolean;
    /** Callback for archive button clicks. */
    onArchive?: (awardId: number) => void;
    /** When `null`, no URL sync. Otherwise the string is prefixed to
     *  every query param ("g_" → ?g_q=… etc.) so multiple tables on
     *  the same route don't collide. */
    urlPrefix?: string | null;
    /** Empty-state copy. */
    emptyMessage?: string;
  };
  let {
    awards,
    storageKey = 'twin.awards.columns.v1',
    defaultCols = ['applicant', 'award_name', 'amount', 'fund_year', 'domain', 'region'],
    showProgramme = false,
    archiveable = false,
    onArchive,
    urlPrefix = '',
    emptyMessage = 'No awards yet.'
  }: Props = $props();

  const ALL_COLS = $derived(
    showProgramme ? ALL_COLS_BASE : ALL_COLS_BASE.filter((c) => c.key !== 'programme')
  );

  // ── Column visibility ──────────────────────────────────────────
  let visibleCols = $state<Set<ColKey>>(new Set(defaultCols));
  let colPickerOpen = $state(false);

  onMount(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const known = new Set<ColKey>(ALL_COLS.map((c) => c.key));
        const restored = (parsed as string[]).filter((k): k is ColKey => known.has(k as ColKey));
        if (restored.length) visibleCols = new Set(restored);
      }
    } catch { /* keep defaults */ }
  });

  function toggleCol(k: ColKey) {
    const next = new Set(visibleCols);
    if (next.has(k)) next.delete(k); else next.add(k);
    // Never leave the table empty — applicant is the canonical anchor.
    if (next.size === 0) next.add('applicant');
    visibleCols = next;
    try { window.localStorage.setItem(storageKey, JSON.stringify([...next])); } catch {}
  }
  function resetCols() {
    visibleCols = new Set(defaultCols);
    try { window.localStorage.setItem(storageKey, JSON.stringify(defaultCols)); } catch {}
  }

  // ── Sort ───────────────────────────────────────────────────────
  type SortKey = 'fund_year' | 'amount' | 'applicant';
  type SortDir = 'asc' | 'desc';
  let sortKey = $state<SortKey>('fund_year');
  let sortDir = $state<SortDir>('desc');
  function clickSort(k: SortKey) {
    if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortKey = k; sortDir = k === 'applicant' ? 'asc' : 'desc'; }
  }

  // ── Filters ────────────────────────────────────────────────────
  let filterPanelOpen = $state(false);
  let qText = $state('');
  let fYears = $state<Set<number>>(new Set());
  let fRegions = $state<Set<string>>(new Set());
  let fDomainIds = $state<Set<number>>(new Set());
  let fSubdomainIds = $state<Set<number>>(new Set());
  let fAmountMin = $state<string>('');
  let fAmountMax = $state<string>('');
  let filtersReady = $state(false);

  const yearOptions = $derived.by(() => {
    const s = new Set<number>();
    for (const a of awards) {
      const y = a.fund_year ?? a.awarded_year;
      if (typeof y === 'number') s.add(y);
    }
    return [...s].sort((x, y) => y - x);
  });
  const regionOptions = $derived.by(() => {
    const s = new Set<string>();
    for (const a of awards) if (a.region_acronym) s.add(a.region_acronym);
    return [...s].sort();
  });
  const domainOptions = $derived.by(() => {
    const m = new Map<number, string>();
    for (const a of awards) {
      const d = a.domain_id && typeof a.domain_id === 'object' ? a.domain_id : null;
      if (d?.id && d.name) m.set(d.id, d.name);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  });
  const subdomainOptions = $derived.by(() => {
    const m = new Map<number, string>();
    for (const a of awards) {
      const s = a.subdomain_id && typeof a.subdomain_id === 'object' ? a.subdomain_id : null;
      if (s?.id && s.name) m.set(s.id, s.name);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  });

  function passesFilters(a: GrantAward): boolean {
    if (qText.trim()) {
      const needle = qText.trim().toLowerCase();
      const org = a.organization_id && typeof a.organization_id === 'object' ? a.organization_id : null;
      const grant = a.grant_id && typeof a.grant_id === 'object' ? a.grant_id : null;
      const hay = [
        a.award_name, a.applicant_label, org?.name, grant?.name, a.contact_label,
        a.external_id, a.description
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (fYears.size) {
      const y = a.fund_year ?? a.awarded_year ?? null;
      if (y == null || !fYears.has(y)) return false;
    }
    if (fRegions.size) {
      if (!a.region_acronym || !fRegions.has(a.region_acronym)) return false;
    }
    if (fDomainIds.size) {
      const d = a.domain_id && typeof a.domain_id === 'object' ? a.domain_id : null;
      if (!d || !fDomainIds.has(d.id)) return false;
    }
    if (fSubdomainIds.size) {
      const s = a.subdomain_id && typeof a.subdomain_id === 'object' ? a.subdomain_id : null;
      if (!s || !fSubdomainIds.has(s.id)) return false;
    }
    const amt = Number(a.total_amount ?? 0);
    if (fAmountMin.trim() && amt < Number(fAmountMin)) return false;
    if (fAmountMax.trim() && amt > Number(fAmountMax)) return false;
    return true;
  }

  const activeFilterCount = $derived(
    (qText.trim() ? 1 : 0) +
      (fYears.size ? 1 : 0) +
      (fRegions.size ? 1 : 0) +
      (fDomainIds.size ? 1 : 0) +
      (fSubdomainIds.size ? 1 : 0) +
      (fAmountMin.trim() || fAmountMax.trim() ? 1 : 0)
  );
  function clearAllFilters() {
    qText = '';
    fYears = new Set(); fRegions = new Set();
    fDomainIds = new Set(); fSubdomainIds = new Set();
    fAmountMin = ''; fAmountMax = '';
  }
  function toggleNumber(set: Set<number>, v: number): Set<number> {
    const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n;
  }
  function toggleString(set: Set<string>, v: string): Set<string> {
    const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n;
  }

  // ── URL ↔ filter state ─────────────────────────────────────────
  const urlKey = (k: string) => (urlPrefix == null ? null : `${urlPrefix}${k}`);
  onMount(() => {
    if (urlPrefix == null) { filtersReady = true; return; }
    const sp = get(page).url.searchParams;
    const k = (s: string) => `${urlPrefix}${s}`;
    if (sp.has(k('q'))) qText = sp.get(k('q')) ?? '';
    if (sp.has(k('year'))) fYears = new Set(sp.get(k('year'))!.split(',').map(Number).filter(Number.isFinite));
    if (sp.has(k('region'))) fRegions = new Set(sp.get(k('region'))!.split(',').filter(Boolean));
    if (sp.has(k('domain'))) fDomainIds = new Set(sp.get(k('domain'))!.split(',').map(Number).filter(Number.isFinite));
    if (sp.has(k('sub'))) fSubdomainIds = new Set(sp.get(k('sub'))!.split(',').map(Number).filter(Number.isFinite));
    if (sp.has(k('min'))) fAmountMin = sp.get(k('min')) ?? '';
    if (sp.has(k('max'))) fAmountMax = sp.get(k('max')) ?? '';
    filtersReady = true;
  });

  $effect(() => {
    if (!filtersReady || urlPrefix == null || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const set = (k: string, v: string | null) => {
      const key = urlKey(k);
      if (!key) return;
      if (v && v.length) params.set(key, v); else params.delete(key);
    };
    set('q', qText.trim() || null);
    set('year', fYears.size ? [...fYears].join(',') : null);
    set('region', fRegions.size ? [...fRegions].join(',') : null);
    set('domain', fDomainIds.size ? [...fDomainIds].join(',') : null);
    set('sub', fSubdomainIds.size ? [...fSubdomainIds].join(',') : null);
    set('min', fAmountMin.trim() || null);
    set('max', fAmountMax.trim() || null);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState({}, '', next);
    }
  });

  const filteredAwards = $derived(awards.filter(passesFilters));
  const sortedAwards = $derived.by(() => {
    const arr = [...filteredAwards];
    const m = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'amount') {
        return (Number(a.total_amount ?? 0) - Number(b.total_amount ?? 0)) * m;
      }
      if (sortKey === 'applicant') {
        const an = (a.organization_id && typeof a.organization_id === 'object' ? a.organization_id.name : null) ?? a.applicant_label ?? '';
        const bn = (b.organization_id && typeof b.organization_id === 'object' ? b.organization_id.name : null) ?? b.applicant_label ?? '';
        return an.localeCompare(bn) * m;
      }
      const av = a.fund_year ?? a.awarded_year ?? 0;
      const bv = b.fund_year ?? b.awarded_year ?? 0;
      return (av - bv) * m;
    });
    return arr;
  });

  function contactDisplay(a: GrantAward): string | null {
    const p = a.contact_person_id && typeof a.contact_person_id === 'object' ? a.contact_person_id as Person : null;
    const o = a.contact_org_id && typeof a.contact_org_id === 'object' ? a.contact_org_id as Organization : null;
    if (p) return personName(p);
    if (o) return o.name ?? null;
    return a.contact_label ?? null;
  }
  function contactHref(a: GrantAward): string | null {
    const p = a.contact_person_id && typeof a.contact_person_id === 'object' ? a.contact_person_id as Person : null;
    const o = a.contact_org_id && typeof a.contact_org_id === 'object' ? a.contact_org_id as Organization : null;
    if (p?.id) return `/people/${p.id}`;
    if (o?.id) return `/orgs/${o.id}`;
    return null;
  }
</script>

<!-- Toolbar — count + filter / column buttons. The count shows
     filtered-of-total when filters are active. -->
<div class="flex flex-wrap items-center justify-between gap-2 border-b border-surface-divider px-4 py-2">
  <span class="text-xs text-ink-400">
    {#if activeFilterCount > 0}
      {filteredAwards.length} of {awards.length} award{awards.length === 1 ? '' : 's'}
    {:else}
      {awards.length} award{awards.length === 1 ? '' : 's'}
    {/if}
    {#if sortKey === 'fund_year'} · sorted by year ({sortDir}){/if}
  </span>
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md border border-surface-border px-2 py-1 text-xs font-medium hover:bg-surface-hover"
      class:bg-surface-hover={filterPanelOpen || activeFilterCount > 0}
      onclick={() => (filterPanelOpen = !filterPanelOpen)}
      aria-expanded={filterPanelOpen}
    >
      <Icon name="filter" size={12} />
      Filters
      {#if activeFilterCount > 0}
        <span class="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white">{activeFilterCount}</span>
      {/if}
    </button>
    {#if activeFilterCount > 0}
      <button class="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline" onclick={clearAllFilters}>Clear</button>
    {/if}
    <div class="relative">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border border-surface-border px-2 py-1 text-xs font-medium hover:bg-surface-hover"
        onclick={() => (colPickerOpen = !colPickerOpen)}
        aria-expanded={colPickerOpen}
      >
        <Icon name="filter" size={12} />
        Columns
        <span class="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-600">{visibleCols.size}/{ALL_COLS.length}</span>
      </button>
      {#if colPickerOpen}
        <div
          class="absolute right-0 z-20 mt-1 w-64 rounded-md border border-surface-border bg-surface-card p-2 shadow-card"
          role="dialog"
          aria-label="Pick visible columns"
        >
          <div class="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-400">
            <span>Show columns</span>
            <button class="text-[10px] text-ink-400 hover:text-ink-700" onclick={resetCols}>reset</button>
          </div>
          <ul class="space-y-0.5">
            {#each ALL_COLS as col (col.key)}
              <li>
                <label class="flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-surface-hover text-sm">
                  <input
                    type="checkbox"
                    class="accent-brand"
                    checked={visibleCols.has(col.key)}
                    onchange={() => toggleCol(col.key)}
                  />
                  <span class="flex-1 text-ink-700">{col.label}</span>
                </label>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if filterPanelOpen}
  <div class="border-b border-surface-divider bg-surface-hover/30 px-4 py-3 space-y-3">
    <div>
      <span class="mb-1 block font-display text-[10px] uppercase tracking-wider text-ink-400">Search</span>
      <input
        type="search"
        placeholder="Heiti, Umsækjandi, Verkefnisstjóri, Númer…"
        bind:value={qText}
        class="w-full rounded-md border border-surface-border bg-surface-card px-2 py-1.5 text-sm placeholder:text-ink-400 focus:border-brand focus:outline-none"
      />
    </div>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {#if yearOptions.length > 0}
        <div>
          <div class="mb-1 flex items-center justify-between">
            <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Úthlutunarár</span>
            {#if fYears.size > 0}<button class="text-[10px] text-ink-400 hover:text-ink-700" onclick={() => (fYears = new Set())}>reset</button>{/if}
          </div>
          <div class="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {#each yearOptions as y (y)}
              {@const on = fYears.has(y)}
              <button
                type="button"
                class="rounded-full border px-2 py-0.5 text-[11px] tabular-nums transition"
                style:background-color={on ? 'rgba(44,140,153,0.12)' : 'transparent'}
                style:color={on ? 'var(--brand, #2C8C99)' : 'var(--text-secondary)'}
                style:border-color={on ? 'rgba(44,140,153,0.45)' : 'var(--surface-border)'}
                aria-pressed={on}
                onclick={() => (fYears = toggleNumber(fYears, y))}
              >{y}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#if regionOptions.length > 0}
        <div>
          <div class="mb-1 flex items-center justify-between">
            <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Landshluti</span>
            {#if fRegions.size > 0}<button class="text-[10px] text-ink-400 hover:text-ink-700" onclick={() => (fRegions = new Set())}>reset</button>{/if}
          </div>
          <div class="flex flex-wrap gap-1">
            {#each regionOptions as r (r)}
              {@const on = fRegions.has(r)}
              <button
                type="button"
                class="rounded-full border px-2 py-0.5 text-[11px] transition"
                style:background-color={on ? 'rgba(29,107,254,0.12)' : 'transparent'}
                style:color={on ? '#1D6BFE' : 'var(--text-secondary)'}
                style:border-color={on ? 'rgba(29,107,254,0.45)' : 'var(--surface-border)'}
                aria-pressed={on}
                title={regionLabel(r) ?? ''}
                onclick={() => (fRegions = toggleString(fRegions, r))}
              >{r}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#if domainOptions.length > 0}
        <div>
          <div class="mb-1 flex items-center justify-between">
            <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Yfirflokkur</span>
            {#if fDomainIds.size > 0}<button class="text-[10px] text-ink-400 hover:text-ink-700" onclick={() => (fDomainIds = new Set())}>reset</button>{/if}
          </div>
          <div class="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {#each domainOptions as [id, name] (id)}
              {@const on = fDomainIds.has(id)}
              <button
                type="button"
                class="rounded-full border px-2 py-0.5 text-[11px] transition"
                style:background-color={on ? 'rgba(107,90,219,0.12)' : 'transparent'}
                style:color={on ? '#6B5ADB' : 'var(--text-secondary)'}
                style:border-color={on ? 'rgba(107,90,219,0.45)' : 'var(--surface-border)'}
                aria-pressed={on}
                title={name}
                onclick={() => (fDomainIds = toggleNumber(fDomainIds, id))}
              >{name.length > 22 ? name.slice(0, 22) + '…' : name}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#if subdomainOptions.length > 0}
        <div>
          <div class="mb-1 flex items-center justify-between">
            <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Undirflokkur</span>
            {#if fSubdomainIds.size > 0}<button class="text-[10px] text-ink-400 hover:text-ink-700" onclick={() => (fSubdomainIds = new Set())}>reset</button>{/if}
          </div>
          <div class="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {#each subdomainOptions as [id, name] (id)}
              {@const on = fSubdomainIds.has(id)}
              <button
                type="button"
                class="rounded-full border px-2 py-0.5 text-[11px] transition"
                style:background-color={on ? 'rgba(198,118,42,0.12)' : 'transparent'}
                style:color={on ? '#C6762A' : 'var(--text-secondary)'}
                style:border-color={on ? 'rgba(198,118,42,0.45)' : 'var(--surface-border)'}
                aria-pressed={on}
                title={name}
                onclick={() => (fSubdomainIds = toggleNumber(fSubdomainIds, id))}
              >{name.length > 22 ? name.slice(0, 22) + '…' : name}</button>
            {/each}
          </div>
        </div>
      {/if}

      <div>
        <div class="mb-1 flex items-center justify-between">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Úthlutun (ISK)</span>
          {#if fAmountMin || fAmountMax}<button class="text-[10px] text-ink-400 hover:text-ink-700" onclick={() => { fAmountMin = ''; fAmountMax = ''; }}>reset</button>{/if}
        </div>
        <div class="flex items-center gap-1.5">
          <input type="number" inputmode="numeric" min="0" placeholder="Min" bind:value={fAmountMin} class="w-full rounded-md border border-surface-border bg-surface-card px-2 py-1 text-xs tabular-nums focus:border-brand focus:outline-none" />
          <span class="text-ink-400">–</span>
          <input type="number" inputmode="numeric" min="0" placeholder="Max" bind:value={fAmountMax} class="w-full rounded-md border border-surface-border bg-surface-card px-2 py-1 text-xs tabular-nums focus:border-brand focus:outline-none" />
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Desktop table -->
<div class="hidden sm:block overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="bg-surface-hover/40 text-[10px] uppercase tracking-wider text-ink-400">
      <tr>
        {#each ALL_COLS as col (col.key)}
          {#if visibleCols.has(col.key)}
            {@const sortable = col.key === 'fund_year' || col.key === 'applicant' || col.key === 'amount'}
            <th
              scope="col"
              class="whitespace-nowrap px-3 py-2 text-left font-medium {col.key === 'amount' ? 'text-right' : ''} {sortable ? 'cursor-pointer hover:text-ink-700' : ''}"
              onclick={sortable ? (() => clickSort(col.key as SortKey)) : undefined}
            >
              {col.label}
              {#if sortable && sortKey === col.key}
                <span class="text-ink-300">{sortDir === 'asc' ? '↑' : '↓'}</span>
              {/if}
            </th>
          {/if}
        {/each}
        {#if archiveable}<th class="w-8"></th>{/if}
      </tr>
    </thead>
    <tbody class="divide-y divide-surface-divider">
      {#each sortedAwards as a (a.id)}
        {@const org = a.organization_id && typeof a.organization_id === 'object' ? a.organization_id : null}
        {@const grant = a.grant_id && typeof a.grant_id === 'object' ? a.grant_id : null}
        {@const dom = a.domain_id && typeof a.domain_id === 'object' ? a.domain_id : null}
        {@const sub = a.subdomain_id && typeof a.subdomain_id === 'object' ? a.subdomain_id : null}
        {@const contact = contactDisplay(a)}
        {@const cHref = contactHref(a)}
        {@const unlinked = !org && !!a.applicant_label}
        <!-- Whole row navigates to the award detail; the nested
             links (applicant org, programme, contact) stop their
             click so they can route to their own targets. -->
        <tr
          class="cursor-pointer hover:bg-surface-hover {a.status === 'archived' ? 'opacity-60' : ''}"
          onclick={(e) => {
            // Honour cmd/ctrl-click + middle-click to open in a new tab.
            if (e.metaKey || e.ctrlKey) {
              window.open(`/grants/awards/${a.id}`, '_blank');
              return;
            }
            if ((e.target as HTMLElement).closest('a, button')) return;
            goto(`/grants/awards/${a.id}`);
          }}>
          {#each ALL_COLS as col (col.key)}
            {#if visibleCols.has(col.key)}
              <td class="whitespace-nowrap px-3 py-2 {col.key === 'amount' ? 'tabular-nums text-right text-ink-900' : 'text-ink-700'}">
                {#if col.key === 'rannis_id'}
                  <span class="font-mono text-[11px] text-ink-500">{a.external_id ?? '—'}</span>
                {:else if col.key === 'fund_year'}
                  <span class="tabular-nums text-ink-700">{a.fund_year ?? a.awarded_year ?? '—'}</span>
                {:else if col.key === 'booking_year'}
                  <span class="tabular-nums text-ink-700">{a.booking_year ?? '—'}</span>
                {:else if col.key === 'award_name'}
                  <!-- Title is plain text — the whole row is the link
                       to the award detail. Avoids a redundant nested
                       link that the user's cmd-click would target. -->
                  <span class="text-ink-900" title={a.award_name ?? ''}>{a.award_name ?? '—'}</span>
                {:else if col.key === 'applicant'}
                  {#if org}
                    <a href={`/orgs/${org.id}`} class="inline-flex items-center gap-1.5 text-ink-900 hover:text-brand">
                      <Avatar name={org.name ?? '?'} src={avatarSrc(org.logo, org.image_focal, 48)} size={20} lazy />
                      <span class="truncate max-w-[18rem]">{org.name}</span>
                    </a>
                  {:else if a.applicant_label}
                    <span class="inline-flex items-center gap-1.5">
                      <span class="truncate max-w-[18rem] text-ink-700">{a.applicant_label}</span>
                      {#if unlinked}<span class="rounded-full border border-tag-sales bg-tag-sales/30 px-1.5 py-0.5 text-[10px] font-medium text-tag-salesText" title="No org linked">link?</span>{/if}
                    </span>
                  {:else}
                    <span class="text-ink-400 italic">—</span>
                  {/if}
                {:else if col.key === 'programme'}
                  {#if grant}
                    <a href={`/grants/${grant.id}`} class="text-ink-700 hover:text-brand">{grant.name}</a>
                  {:else}—{/if}
                {:else if col.key === 'domain'}
                  {dom?.name ?? '—'}
                {:else if col.key === 'subdomain'}
                  <span class="truncate" title={sub?.name ?? ''}>{sub?.name ?? '—'}</span>
                {:else if col.key === 'contact'}
                  {#if contact && cHref}
                    <a href={cHref} class="text-ink-700 hover:text-brand">{contact}</a>
                  {:else if contact}
                    <span class="text-ink-700">{contact}</span>
                  {:else}—{/if}
                {:else if col.key === 'region'}
                  {#if a.region_acronym}
                    <span class="rounded-full border border-surface-border px-1.5 py-0.5 text-[11px]" title={regionLabel(a.region_acronym) ?? ''}>{a.region_acronym}</span>
                  {:else}—{/if}
                {:else if col.key === 'amount'}
                  {formatGrantAmount(a.total_amount, a.currency)}
                {/if}
              </td>
            {/if}
          {/each}
          {#if archiveable}
            <td class="w-8 px-2 py-2 text-right">
              <button class="text-ink-300 hover:text-tag-salesText" title="Archive award" onclick={() => onArchive?.(a.id)}>
                <Icon name="x" size={14} />
              </button>
            </td>
          {/if}
        </tr>
      {:else}
        <tr>
          <td colspan={visibleCols.size + (archiveable ? 1 : 0)} class="px-4 py-6 text-center text-sm text-ink-400">
            {activeFilterCount > 0 ? 'No awards match the current filters.' : emptyMessage}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<!-- Mobile stacked rows -->
<ul class="sm:hidden divide-y divide-surface-divider">
  {#each sortedAwards as a (a.id)}
    {@const org = a.organization_id && typeof a.organization_id === 'object' ? a.organization_id : null}
    {@const grant = a.grant_id && typeof a.grant_id === 'object' ? a.grant_id : null}
    {@const dom = a.domain_id && typeof a.domain_id === 'object' ? a.domain_id : null}
    {@const unlinked = !org && !!a.applicant_label}
    <li class="{a.status === 'archived' ? 'opacity-60' : ''}">
      <a href={`/grants/awards/${a.id}`} class="flex items-start justify-between gap-3 px-4 py-3 hover:bg-surface-hover">
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium text-ink-900">{a.award_name ?? grant?.name ?? '(unknown)'}</div>
          <div class="mt-0.5 flex min-w-0 items-center gap-1.5">
            {#if org}
              <Avatar name={org.name ?? '?'} src={avatarSrc(org.logo, org.image_focal, 48)} size={18} lazy />
              <span class="truncate text-xs text-ink-600">{org.name}</span>
            {:else if a.applicant_label}
              <span class="truncate text-xs text-ink-600">{a.applicant_label}</span>
              {#if unlinked}<span class="rounded-full border border-tag-sales bg-tag-sales/30 px-1.5 py-0.5 text-[10px] font-medium text-tag-salesText" title="No org linked">link?</span>{/if}
            {/if}
          </div>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-500">
            <span class="tabular-nums">{a.fund_year ?? a.awarded_year ?? '—'}</span>
            {#if showProgramme && grant}<span>·</span><span class="truncate max-w-[12rem]">{grant.name}</span>{/if}
            {#if dom}<span>·</span><span class="truncate max-w-[12rem]">{dom.name}</span>{/if}
            {#if a.region_acronym}<span>·</span><span>{a.region_acronym}</span>{/if}
          </div>
        </div>
        <div class="text-right">
          <div class="tabular-nums text-sm text-ink-900">{formatGrantAmount(a.total_amount, a.currency)}</div>
          {#if archiveable}
            <button class="mt-1 text-ink-300 hover:text-tag-salesText" title="Archive award" onclick={(e) => { e.preventDefault(); onArchive?.(a.id); }}>
              <Icon name="x" size={14} />
            </button>
          {/if}
        </div>
      </a>
    </li>
  {:else}
    <li class="px-4 py-6 text-center text-sm text-ink-400">
      {activeFilterCount > 0 ? 'No awards match the current filters.' : emptyMessage}
    </li>
  {/each}
</ul>
