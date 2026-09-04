<script lang="ts">
  import {
    searchOrgs,
    countOrgs,
    createOrg,
    orgSizeLabel,
    avatarSrc,
    ORG_INDUSTRY_OPTIONS,
    industryLabel,
    orgLifecycleLabel,
    orgLifecycleColor,
    bulkUpdateOrgs,
    bulkDeleteOrgs,
    mergeOrgInto,
    mergeOrgIntoWithPatch,
    getOrg,
    ORG_LIFECYCLE_OPTIONS,
    listProjectsForTree,
    getOrgIdsForProjects,
    formatError,
    type Organization,
    type OrgLifecycleStatus,
    type Project
  } from '$lib/directus';
  import ProjectFilterTree from '$lib/admin/ProjectFilterTree.svelte';
  import { scope, scopeWhere } from '$lib/scope';
  import VaultPicker from '$lib/VaultPicker.svelte';
  import { createInVault, canCreateInto } from '$lib/data/repo/crossVault';
  import { activeVault, vaultForScope, vaults } from '$lib/data/repo/vaults';
  import type { Filter } from '$lib/data/repo';
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import MergeReview, { type MergeField } from '$lib/MergeReview.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import SortMenu from '$lib/SortMenu.svelte';

  // ─── Sort options ────────────────────────────────────────────────────────
  // Each option has a stable `value` (persisted) and the Directus sort array.
  const SORT_OPTIONS = [
    { value: 'updated',  label: 'Last modified',     sort: ['-date_updated', '-date_created', 'name'] },
    { value: 'created',  label: 'Recently added',    sort: ['-date_created', 'name'] },
    { value: 'az',       label: 'Name A→Z',           sort: ['name'] },
    { value: 'za',       label: 'Name Z→A',           sort: ['-name'] },
    { value: 'size',     label: 'Most employees',    sort: ['-employee_count', 'name'] },
    { value: 'enriched', label: 'Recently enriched', sort: ['-last_enriched_at', '-date_updated'] }
  ] as const;
  type SortKey = (typeof SORT_OPTIONS)[number]['value'];

  // ─── New org flow ────────────────────────────────────────────────────────
  let newOpen = $state(false);
  let newName = $state('');
  let newWebsite = $state('');
  let newIndustry = $state('');
  let newScope = $state<'work' | 'private' | 'both'>('work');
  let creating = $state(false);
  let newError = $state('');
  let newDone = $state('');
  // Destination vault follows the scope tag (a scope bound to a vault in
  // Settings → Vaults pulls new records of that scope there by default);
  // the picker in the form still overrides per record.
  let newVault = $state(activeVault().id);
  $effect(() => {
    const s = newScope;
    const bound = s === 'work' || s === 'private' ? vaultForScope(s) : null;
    newVault = bound && canCreateInto(bound) ? bound.id : activeVault().id;
  });

  function openNew() {
    newOpen = true;
    newName = '';
    newWebsite = '';
    newIndustry = '';
    newScope = $scope === 'private' ? 'private' : 'work';
    newError = '';
    newDone = '';
  }

  async function submitNew() {
    const name = newName.trim();
    if (!name) { newError = 'Name is required'; return; }
    creating = true;
    newError = '';
    newDone = '';
    try {
      const data = {
        name,
        website: newWebsite.trim() || null,
        industry: newIndustry.trim() || null,
        scope: newScope
      };
      if (newVault !== activeVault().id) {
        // Saved into ANOTHER vault — no detail page here to navigate to.
        await createInVault(newVault, 'organization', { status: 'active', ...data });
        const dest = vaults().find((v) => v.id === newVault);
        newDone = `Saved ${name} to “${dest?.name ?? 'the other vault'}”.`;
        newName = '';
        newWebsite = '';
        newIndustry = '';
        return;
      }
      const created = await createOrg(data);
      goto(`/orgs/${created.id}`);
    } catch (e) {
      newError = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }

  // ─── Listing state ───────────────────────────────────────────────────────
  type View = 'list' | 'grid';
  const ls = (k: string, fallback = ''): string =>
    typeof localStorage !== 'undefined' ? (localStorage.getItem(k) ?? fallback) : fallback;
  const setLs = (k: string, v: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
  };

  let q = $state(ls('twin.orgs.q'));
  // Default view: respect explicit preference, else grid on mobile (denser
  // touch grid feels right on a small screen) and list on desktop (more
  // metadata per row). The user's explicit choice always wins after first
  // toggle since it lands in localStorage.
  function defaultView(): View {
    const saved = ls('twin.orgs.view') as View;
    if (saved === 'list' || saved === 'grid') return saved;
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      return 'grid';
    }
    return 'list';
  }
  let view = $state<View>(defaultView());
  let industry = $state<string>(ls('twin.orgs.industry'));
  let showArchived = $state(ls('twin.orgs.archived') === '1');
  let showInactive = $state(ls('twin.orgs.inactive') === '1');
  let sortKey = $state<SortKey>(((SORT_OPTIONS.find((o) => o.value === ls('twin.orgs.sort'))?.value) as SortKey) ?? 'updated');

  let results: Organization[] = $state([]);
  let total = $state<number | null>(null);
  let loading = $state(false);
  let error = $state('');
  const PAGE_SIZE = 100;

  // Persistence — fire-and-forget effects
  $effect(() => setLs('twin.orgs.view', view));
  $effect(() => setLs('twin.orgs.q', q));
  $effect(() => setLs('twin.orgs.industry', industry));
  $effect(() => setLs('twin.orgs.archived', showArchived ? '1' : '0'));
  $effect(() => setLs('twin.orgs.inactive', showInactive ? '1' : '0'));
  $effect(() => setLs('twin.orgs.sort', sortKey));

  // Active sort for the current selection.
  const activeSort = $derived(SORT_OPTIONS.find((o) => o.value === sortKey) ?? SORT_OPTIONS[0]);

  // ── Custom filters (collapsible drawer) ────────────────────────────────
  let filtersOpen = $state(false);
  let filterProjectIds = $state(new Set<number>());
  let projectsAll = $state<Array<Pick<Project, 'id' | 'name' | 'parent_id' | 'kind' | 'color' | 'status'>>>([]);
  let projectsLoading = $state(false);
  // Pre-resolve selected projects → set of org ids the index should
  // narrow to. Resolved server-side via the helper so it crosses both
  // owner_org_id AND the Project_organization junction.
  let filterOrgIds = $state<number[] | null>(null); // null = no project filter
  $effect(() => {
    const ids = [...filterProjectIds];
    if (ids.length === 0) { filterOrgIds = null; return; }
    (async () => {
      try { filterOrgIds = await getOrgIdsForProjects(ids); }
      catch { filterOrgIds = []; }
    })();
  });
  async function loadProjectsForTree() {
    if (projectsAll.length > 0 || projectsLoading) return;
    projectsLoading = true;
    try { projectsAll = await listProjectsForTree(); }
    catch { /* ignore — tree just stays empty */ }
    finally { projectsLoading = false; }
  }
  $effect(() => { if (filtersOpen) void loadProjectsForTree(); });

  // Quick lookups for active-chip labels.
  const projectsById = $derived(new Map(projectsAll.map((p) => [p.id, p])));
  const activeFilterCount = $derived(filterProjectIds.size);

  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    clearTimeout(timer);
    const query = q;
    const s = $scope;
    const ind = industry;
    const archived = showArchived;
    const inactive = showInactive;
    const srt = activeSort.sort;
    const orgIds = filterOrgIds;
    timer = setTimeout(async () => {
      loading = true;
      error = '';
      try {
        const extra: Array<Filter | null> = [];
        const sf = scopeWhere(s);
        if (sf) extra.push(sf);
        if (ind) extra.push({ field: 'industry', op: 'eq', value: ind });
        // Project filter: when at least one project is selected,
        // narrow to orgs linked to any of them. Empty resolved set
        // means "no matches" — we send an impossible filter so the
        // result is empty (rather than skipping the filter).
        if (orgIds !== null) extra.push({ field: 'id', op: 'in', value: orgIds.length ? orgIds : [-1] });
        // Fetch the page and the total in parallel — the heading shows
        // "100 of 4,127" when results are capped so the user knows there's
        // more behind the visible page.
        const [rows, n] = await Promise.all([
          searchOrgs(query, PAGE_SIZE, extra, {
            includeArchived: archived,
            includeInactive: inactive,
            sort: [...srt]
          }),
          countOrgs(query, extra, { includeArchived: archived, includeInactive: inactive })
        ]);
        results = rows;
        total = n;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        loading = false;
      }
    }, 200);
  });

  /** Return one pill per scope this entity belongs to. `both` yields both. */
  function scopePills(s?: string | null): Array<'work' | 'private'> {
    if (s === 'both') return ['work', 'private'];
    if (s === 'work' || s === 'private') return [s];
    return [];
  }

  // ─── Last-modified relative formatter ────────────────────────────────────
  function relTime(iso?: string | null): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const min = Math.round(ms / 60000);
    if (min < 1)   return 'just now';
    if (min < 60)  return `${min}m ago`;
    const h = Math.round(min / 60);
    if (h < 24)    return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 30)    return `${d}d ago`;
    const mo = Math.round(d / 30);
    if (mo < 12)   return `${mo}mo ago`;
    return `${Math.round(mo / 12)}y ago`;
  }
  function fullTime(iso?: string | null): string {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(new Date(iso));
    } catch { return iso; }
  }

  // ─── Active-filter chips ─────────────────────────────────────────────────
  type ChipKey = 'q' | 'industry' | 'archived' | 'inactive';
  const filterChips = $derived.by(() => {
    const chips: { key: ChipKey; label: string }[] = [];
    if (q.trim())     chips.push({ key: 'q', label: `"${q.trim()}"` });
    if (industry)     chips.push({ key: 'industry', label: `Industry: ${industryLabel(industry)}` });
    if (showInactive) chips.push({ key: 'inactive', label: 'Including inactive' });
    if (showArchived) chips.push({ key: 'archived', label: 'Including archived' });
    return chips;
  });

  function clearChip(key: ChipKey) {
    if (key === 'q') q = '';
    else if (key === 'industry') industry = '';
    else if (key === 'inactive') showInactive = false;
    else showArchived = false;
  }
  function clearAll() {
    q = '';
    industry = '';
    showArchived = false;
    showInactive = false;
  }

  // ── Batch select + actions ────────────────────────────────────────────
  // Same opt-in pattern as /people: tap "Select" → checkbox per row +
  // sticky action bar.
  let selectMode = $state(false);
  let selected = $state(new Set<number>());
  const selectedCount = $derived(selected.size);
  const allOnPageSelected = $derived(
    results.length > 0 && results.every((o) => selected.has(o.id))
  );

  function toggleSelect(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    selected = next;
  }
  function selectAllOnPage() { selected = new Set(results.map((o) => o.id)); }
  function clearSelection() { selected = new Set(); }
  function exitSelectMode() { selectMode = false; clearSelection(); mergeMode = false; mergeWinnerId = null; lifecyclePickerOpen = false; }

  let mergeMode = $state(false);
  let mergeWinnerId = $state<number | null>(null);
  const selectedRows = $derived(results.filter((o) => selected.has(o.id)));

  // ── Field-level merge review ────────────────────────────────────
  let mergeReviewOpen = $state(false);
  let mergeReviewRecords = $state<Organization[]>([]);
  const ORG_MERGE_FIELDS = [
    { key: 'name',             label: 'Name' },
    { key: 'legal_name',       label: 'Legal name' },
    { key: 'previous_names',   label: 'Previous names' },
    { key: 'description',      label: 'Description' },
    { key: 'website',          label: 'Website' },
    { key: 'email',            label: 'Email' },
    { key: 'phone',            label: 'Phone' },
    { key: 'industry',         label: 'Industry' },
    { key: 'region',           label: 'Region' },
    { key: 'lifecycle_status', label: 'Lifecycle' },
    { key: 'size_bucket',      label: 'Size' },
    { key: 'address_line1',    label: 'Address line 1' },
    { key: 'address_line2',    label: 'Address line 2' },
    { key: 'city',             label: 'City' },
    { key: 'postal_code',      label: 'Postal code' },
    { key: 'state_province',   label: 'State / Province' },
    { key: 'country',          label: 'Country' }
  ] as const satisfies ReadonlyArray<MergeField<Organization>>;

  async function openMergeReview() {
    if (!mergeWinnerId || selectedCount < 2 || batchBusy) return;
    batchBusy = true; batchError = '';
    try {
      const ids = [...selected];
      ids.sort((a, b) => (a === mergeWinnerId ? -1 : b === mergeWinnerId ? 1 : 0));
      const full = await Promise.all(ids.map((id) => getOrg(id)));
      mergeReviewRecords = full;
      mergeReviewOpen = true;
    } catch (e) {
      batchError = formatError(e);
    } finally {
      batchBusy = false;
    }
  }

  async function performMerge(winnerId: number, loserIds: number[], patch: Partial<Organization>) {
    batchBusy = true; batchError = '';
    try {
      let first = true;
      for (const loserId of loserIds) {
        if (first) {
          await mergeOrgIntoWithPatch(loserId, winnerId, patch);
          first = false;
        } else {
          await mergeOrgInto(loserId, winnerId);
        }
      }
      results = results.map((o) => (loserIds.includes(o.id) ? { ...o, status: 'archived', is_active: false } : o));
      mergeReviewOpen = false;
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }

  let batchBusy = $state(false);
  let batchError = $state('');

  async function batchArchive() {
    if (selectedCount === 0 || batchBusy) return;
    if (!confirm(`Archive ${selectedCount} ${selectedCount === 1 ? 'organisation' : 'organisations'}?`)) return;
    batchBusy = true; batchError = '';
    try {
      await bulkUpdateOrgs([...selected], { status: 'archived' } as Partial<Organization>);
      results = results.map((o) => (selected.has(o.id) ? { ...o, status: 'archived' } : o));
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }

  async function batchRestore() {
    if (selectedCount === 0 || batchBusy) return;
    batchBusy = true; batchError = '';
    try {
      await bulkUpdateOrgs([...selected], { status: 'published' } as Partial<Organization>);
      results = results.map((o) => (selected.has(o.id) ? { ...o, status: 'published' } : o));
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }

  async function batchMarkInactive() {
    if (selectedCount === 0 || batchBusy) return;
    batchBusy = true; batchError = '';
    try {
      await bulkUpdateOrgs([...selected], { is_active: false } as Partial<Organization>);
      results = results.map((o) => (selected.has(o.id) ? { ...o, is_active: false } : o));
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }

  async function batchMarkActive() {
    if (selectedCount === 0 || batchBusy) return;
    batchBusy = true; batchError = '';
    try {
      await bulkUpdateOrgs([...selected], { is_active: true } as Partial<Organization>);
      results = results.map((o) => (selected.has(o.id) ? { ...o, is_active: true } : o));
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }

  async function batchDelete() {
    if (selectedCount === 0 || batchBusy) return;
    if (!confirm(`Permanently DELETE ${selectedCount} ${selectedCount === 1 ? 'organisation' : 'organisations'}? This cannot be undone.`)) return;
    batchBusy = true; batchError = '';
    try {
      await bulkDeleteOrgs([...selected]);
      results = results.filter((o) => !selected.has(o.id));
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }

  // Lifecycle picker for batch mode (set N orgs to "dormant", etc.).
  let lifecyclePickerOpen = $state(false);
  async function batchSetLifecycle(value: OrgLifecycleStatus | null) {
    if (selectedCount === 0 || batchBusy) return;
    batchBusy = true; batchError = '';
    try {
      await bulkUpdateOrgs([...selected], { lifecycle_status: value } as Partial<Organization>);
      results = results.map((o) => (selected.has(o.id) ? { ...o, lifecycle_status: value } : o));
      lifecyclePickerOpen = false;
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }
</script>

<svelte:head>
  <title>Organization · Hub</title>
</svelte:head>

<section class="space-y-5">
  <!-- Header row -->
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-2xl font-semibold sm:text-3xl">
      Organization
      <span class="ml-2 text-ink-300 font-medium" title={total != null && total > results.length ? `Showing the first ${results.length} of ${total.toLocaleString()} matching` : ''}>
        {#if total != null && total > results.length}
          {results.length} of {total.toLocaleString()}
        {:else if total != null}
          {total.toLocaleString()}
        {:else}
          {results.length}
        {/if}
      </span>
    </h1>
    <div class="flex items-center gap-2">
      <div class="inline-flex rounded-[10px] border border-surface-border bg-surface-card p-0.5 text-xs" role="tablist" aria-label="View">
        <button
          class="rounded-md px-2 py-1 {view === 'list' ? 'bg-surface-hover text-ink-900' : 'text-ink-400'}"
          onclick={() => (view = 'list')}
          aria-selected={view === 'list'} role="tab"
        >List</button>
        <button
          class="rounded-md px-2 py-1 {view === 'grid' ? 'bg-surface-hover text-ink-900' : 'text-ink-400'}"
          onclick={() => (view = 'grid')}
          aria-selected={view === 'grid'} role="tab"
        >Grid</button>
      </div>
      <button class="btn-primary hidden md:inline-flex" onclick={openNew}>
        <Icon name="plus" size={16} /> New org
      </button>
    </div>
  </div>

  <!-- ── Filters drawer ───────────────────────────────────────────────────
       Collapsible custom-filter panel above the toolbar. Each section
       inside (currently Projects, room to add more later — lifecycle,
       tags, …) collapses independently. Closed by default so the page
       is calm; the count badge surfaces how many filters are active. -->
  <details class="card group" bind:open={filtersOpen}>
    <summary class="card-header cursor-pointer list-none">
      <span class="card-title">
        <Icon name="tag" size={14} /> Filters
        {#if activeFilterCount > 0}
          <span class="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">{activeFilterCount}</span>
        {/if}
      </span>
      <div class="flex items-center gap-2">
        {#if activeFilterCount > 0}
          <button type="button" class="text-xs text-ink-400 hover:text-ink-700" onclick={(e) => { e.preventDefault(); filterProjectIds = new Set(); }}>Clear all</button>
        {/if}
        <Icon name="chevron-right" size={14} class="text-ink-300 transition-transform group-open:rotate-90" />
      </div>
    </summary>
    <div class="px-4 pb-4">
      <details class="rounded-md border border-surface-divider open:bg-surface-hover/40" open>
        <summary class="cursor-pointer list-none px-3 py-2 text-sm font-medium text-ink-700">
          <span class="inline-flex items-center gap-2">
            <Icon name="sparkles" size={14} /> Projects
            {#if filterProjectIds.size > 0}
              <span class="text-xs text-brand">{filterProjectIds.size} selected</span>
            {/if}
          </span>
        </summary>
        <div class="px-3 py-2">
          {#if projectsLoading}
            <p class="text-xs text-ink-400">Loading projects…</p>
          {:else}
            <ProjectFilterTree projects={projectsAll} bind:selected={filterProjectIds} />
          {/if}
        </div>
      </details>
    </div>
  </details>

  <!-- Active filter chips (always rendered when filters are active,
       even with the drawer collapsed) so the user can see + remove
       what's filtering the list without re-opening the drawer. -->
  {#if filterProjectIds.size > 0}
    <div class="flex flex-wrap items-center gap-1.5 text-xs">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Filtering by</span>
      {#each [...filterProjectIds] as pid (pid)}
        {@const proj = projectsById.get(pid)}
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/[0.08] px-2 py-0.5 font-medium text-brand hover:bg-brand/[0.16]"
          onclick={() => { const next = new Set(filterProjectIds); next.delete(pid); filterProjectIds = next; }}
          aria-label="Remove filter"
        >
          {#if proj?.color}<span class="h-1.5 w-1.5 rounded-full" style:background-color={proj.color}></span>{/if}
          <span class="truncate">{proj?.name ?? `Project ${pid}`}</span>
          <span aria-hidden="true">×</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Toolbar (sticky search/filter/sort) -->
  <div class="card p-3 space-y-2">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative flex-1 min-w-[12rem]">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300">
          <Icon name="search" size={16} />
        </span>
        <input type="search" bind:value={q} placeholder="Search organizations…" class="input pl-9" />
      </div>
      <select class="input !py-1.5 !text-sm w-auto" bind:value={industry} aria-label="Industry filter">
        <option value="">All industries</option>
        {#each ORG_INDUSTRY_OPTIONS as ind (ind.value)}
          <option value={ind.value}>{ind.label}</option>
        {/each}
      </select>
      <SortMenu
        value={sortKey}
        options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        onChange={(v) => (sortKey = v as SortKey)}
      />
      <label class="inline-flex items-center gap-2 text-xs text-ink-500" title="Inactive orgs are real-world dissolved/inactive companies, kept in the DB but hidden by default.">
        <input type="checkbox" class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand" bind:checked={showInactive} />
        Show inactive
      </label>
      <label class="inline-flex items-center gap-2 text-xs text-ink-500">
        <input type="checkbox" class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand" bind:checked={showArchived} />
        Show archived
      </label>
      <!-- Batch-select toggle, mirrors /people. -->
      {#if !selectMode}
        <button
          type="button"
          class="ml-auto inline-flex items-center gap-1 rounded-[8px] border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
          onclick={() => (selectMode = true)}
          title="Select multiple to batch-update"
        >
          <Icon name="check" size={12} /> Select
        </button>
      {:else}
        <div class="ml-auto inline-flex items-center gap-2 text-xs text-ink-500">
          <button type="button" class="text-brand hover:underline" onclick={selectAllOnPage}>
            {allOnPageSelected ? 'All selected' : `Select all (${results.length})`}
          </button>
          <button type="button" class="hover:text-ink-700" onclick={exitSelectMode}>Cancel</button>
        </div>
      {/if}
    </div>

    {#if filterChips.length > 0}
      <div class="flex flex-wrap items-center gap-1.5 pt-1">
        {#each filterChips as c (c.key)}
          <button
            class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-hover px-2 py-0.5 text-xs text-ink-700 hover:bg-surface-divider"
            onclick={() => clearChip(c.key)}
            aria-label="Clear {c.key} filter"
          >
            <span>{c.label}</span>
            <span aria-hidden="true">×</span>
          </button>
        {/each}
        <button class="ml-1 text-xs text-ink-400 hover:text-ink-700" onclick={clearAll}>Clear all</button>
      </div>
    {/if}
  </div>

  {#if newOpen}
    <div class="card border-brand/40 p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="card-title"><Icon name="building" size={16} /> New organization</div>
        <button class="text-ink-400 hover:text-ink-700" aria-label="Close" onclick={() => (newOpen = false)}>✕</button>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="block sm:col-span-2">
          <span class="block text-xs text-ink-400 mb-1">Name *</span>
          <input type="text" class="input w-full" bind:value={newName} placeholder="e.g. Acme Inc" autofocus />
        </label>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Website</span>
          <input type="url" class="input w-full" bind:value={newWebsite} placeholder="https://…" />
        </label>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Industry</span>
          <select class="input w-full" bind:value={newIndustry}>
            <option value="">— pick one —</option>
            {#each ORG_INDUSTRY_OPTIONS as ind (ind.value)}
              <option value={ind.value}>{ind.label}</option>
            {/each}
          </select>
        </label>
        <label class="block sm:col-span-2">
          <span class="block text-xs text-ink-400 mb-1">Scope</span>
          <select class="input w-full" bind:value={newScope}>
            <option value="work">Work</option>
            <option value="private">Private</option>
            <option value="both">Both</option>
          </select>
        </label>
        <div class="sm:col-span-2"><VaultPicker bind:value={newVault} /></div>
      </div>
      {#if newError}<div class="text-xs text-tag-salesText">{newError}</div>{/if}
      {#if newDone}<div class="text-xs" style="color: var(--state-success, #16a34a);">{newDone}</div>{/if}
      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost" onclick={() => (newOpen = false)} disabled={creating}>Cancel</button>
        <button class="btn-primary" onclick={submitNew} disabled={creating || !newName.trim()}>
          {creating ? 'Creating…' : 'Create & open'}
        </button>
      </div>
      <div class="text-xs text-ink-400">Created as <span class="font-medium">draft</span>. Publish from the detail page when ready.</div>
    </div>
  {/if}

  {#if error}
    <p class="rounded-[10px] border border-tag-sales bg-tag-sales px-3 py-2 text-sm text-tag-salesText">{error}</p>
  {/if}

  {#if view === 'list'}
    <div class="card overflow-hidden">
      <!-- Column headers only at sm+; mobile is a stacked card. -->
      <div class="hidden sm:grid grid-cols-[1.6fr_1fr_1fr_auto_auto] items-center gap-3 border-b border-surface-divider px-4 py-3 text-xs text-ink-400">
        <span class="flex items-center gap-1"><Icon name="building" size={14} /> Organization</span>
        <span class="flex items-center gap-1"><Icon name="globe" size={14} /> Website</span>
        <span class="flex items-center gap-1"><Icon name="tag" size={14} /> Industry</span>
        <span>Scope</span>
        <span class="text-right">Updated</span>
      </div>
      <ul class="divide-y divide-surface-divider">
        {#each results as org (org.id)}
          {@const pills = scopePills(org.scope)}
          <li class="hover:bg-surface-hover {org.status === 'archived' || org.is_active === false ? 'opacity-60' : ''} {selectMode && selected.has(org.id) ? 'bg-brand/[0.06]' : ''}">
            <svelte:element
              this={selectMode ? 'div' : 'a'}
              href={selectMode ? undefined : `/orgs/${org.id}`}
              role={selectMode ? 'button' : undefined}
              tabindex={selectMode ? 0 : undefined}
              class="flex min-h-[60px] items-center gap-3 px-4 py-3 text-sm sm:grid sm:py-2.5 {selectMode ? 'sm:grid-cols-[auto_1.6fr_1fr_1fr_auto_auto] cursor-pointer' : 'sm:grid-cols-[1.6fr_1fr_1fr_auto_auto]'}"
              style="touch-action: manipulation;"
              onclick={selectMode ? () => toggleSelect(org.id) : undefined}
              onkeydown={selectMode ? ((e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSelect(org.id); } }) : undefined}
            >
              {#if selectMode}
                <input
                  type="checkbox"
                  class="h-5 w-5 shrink-0 rounded border-surface-border text-brand focus:ring-brand"
                  checked={selected.has(org.id)}
                  onclick={(e) => e.stopPropagation()}
                  onchange={() => toggleSelect(org.id)}
                  aria-label={`Select ${org.name ?? 'organisation'}`}
                />
              {/if}
              <div class="flex flex-1 items-center gap-3 min-w-0 sm:flex-initial">
                <Avatar name={org.name ?? '?'} src={avatarSrc(org.logo, org.image_focal, 80)} position={org.image_focal ?? ''} lazy />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-base font-medium text-ink-900 sm:text-sm">{org.name ?? '(no name)'}</div>
                  <!-- Mobile compound secondary line: industry · website · size · updated -->
                  <div class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-400 sm:hidden">
                    {#if industryLabel(org.industry)}<span class="truncate">{industryLabel(org.industry)}</span>{/if}
                    {#if org.website}
                      {#if industryLabel(org.industry)}<span>·</span>{/if}
                      <span class="truncate">{org.website.replace(/^https?:\/\//, '')}</span>
                    {/if}
                    {#if orgSizeLabel(org)}
                      <span>·</span>
                      <span class="truncate">{orgSizeLabel(org)}</span>
                    {/if}
                    {#if org.date_updated}
                      <span class="ml-auto whitespace-nowrap" title={fullTime(org.date_updated)}>{relTime(org.date_updated)}</span>
                    {/if}
                  </div>
                  {#if orgSizeLabel(org)}
                    <div class="hidden sm:block truncate text-xs text-ink-400">{orgSizeLabel(org)}</div>
                  {/if}
                </div>
              </div>
              <span class="hidden sm:inline truncate text-ink-500">{org.website ?? '—'}</span>
              <span class="hidden sm:inline truncate text-ink-500">{industryLabel(org.industry) ?? '—'}</span>
              <!-- Scope pills are desktop-only; the header scope toggle already filters mobile. -->
              <span class="hidden sm:inline-flex shrink-0 flex-wrap items-center justify-end gap-1">
                {#if org.lifecycle_status}
                  {@const lcColor = orgLifecycleColor(org.lifecycle_status)}
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={lcColor ? `background:${lcColor}22; color:${lcColor}; border:1px solid ${lcColor}55;` : ''}
                    title="Lifecycle"
                  >{orgLifecycleLabel(org.lifecycle_status)}</span>
                {/if}
                {#if org.status === 'archived'}
                  <TagPill tone="neutral">archived</TagPill>
                {:else if org.is_active === false}
                  <TagPill tone="neutral">inactive</TagPill>
                {:else if pills.length > 0}
                  {#each pills as p}
                    {#if p === 'work'}<TagPill tone="online">Work</TagPill>{:else}<TagPill tone="chat">Private</TagPill>{/if}
                  {/each}
                {:else}
                  <TagPill tone="neutral">{org.status ?? '—'}</TagPill>
                {/if}
              </span>
              <span class="hidden sm:inline whitespace-nowrap text-right text-xs text-ink-400" title={fullTime(org.date_updated)}>
                {relTime(org.date_updated)}
              </span>
            </svelte:element>
          </li>
        {:else}
          <li class="px-4 py-6 text-center text-sm text-ink-400">{loading ? 'Searching…' : 'No results'}</li>
        {/each}
      </ul>
    </div>
  {:else}
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {#each results as org (org.id)}
        {@const pills = scopePills(org.scope)}
        <svelte:element
          this={selectMode ? 'div' : 'a'}
          href={selectMode ? undefined : `/orgs/${org.id}`}
          role={selectMode ? 'button' : undefined}
          tabindex={selectMode ? 0 : undefined}
          class="card relative p-4 flex flex-col items-center text-center hover:shadow-card transition {org.status === 'archived' || org.is_active === false ? 'opacity-60' : ''} {selectMode ? 'cursor-pointer' : ''} {selectMode && selected.has(org.id) ? 'ring-2 ring-brand bg-brand/[0.04]' : ''}"
          title={org.date_updated ? `Last modified ${relTime(org.date_updated)} · ${fullTime(org.date_updated)}` : ''}
          onclick={selectMode ? () => toggleSelect(org.id) : undefined}
          onkeydown={selectMode ? ((e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSelect(org.id); } }) : undefined}
        >
          {#if selectMode}
            <input
              type="checkbox"
              class="absolute right-3 top-3 h-5 w-5 rounded border-surface-border bg-surface-card text-brand focus:ring-brand"
              checked={selected.has(org.id)}
              onclick={(e) => e.stopPropagation()}
              onchange={() => toggleSelect(org.id)}
              aria-label={`Select ${org.name ?? 'organisation'}`}
            />
          {/if}
          <Avatar name={org.name ?? '?'} src={avatarSrc(org.logo, org.image_focal, 144)} position={org.image_focal ?? ''} size={72} lazy />
          <div class="mt-3 truncate w-full font-medium text-ink-900">{org.name ?? '(no name)'}</div>
          <div class="mt-0.5 truncate w-full text-xs text-ink-400">{industryLabel(org.industry) ?? '—'}</div>
          <div class="mt-2 inline-flex flex-wrap items-center justify-center gap-1">
            {#if org.status === 'archived'}
              <TagPill tone="neutral">archived</TagPill>
            {:else if org.is_active === false}
              <TagPill tone="neutral">inactive</TagPill>
            {:else}
              {#each pills as p}
                {#if p === 'work'}<TagPill tone="online">Work</TagPill>{:else}<TagPill tone="chat">Private</TagPill>{/if}
              {/each}
            {/if}
          </div>
        </svelte:element>
      {:else}
        <div class="col-span-full rounded-[10px] border border-dashed border-surface-border p-8 text-center text-sm text-ink-400">
          {loading ? 'Searching…' : 'No results'}
        </div>
      {/each}
    </div>
  {/if}

  <!-- ── Batch action bar ────────────────────────────────────────────────
       Sticky bottom card, visible only when ≥1 org is selected.
       Mirrors the /people pattern. -->
  {#if selectMode && selectedCount > 0}
    <div
      class="fixed inset-x-0 z-30 mx-auto w-full max-w-3xl px-3 sm:px-6"
      style="bottom: calc(env(safe-area-inset-bottom) + 4.75rem);"
    >
      <div class="rounded-[14px] border border-surface-border bg-surface-card p-3 shadow-card">
        {#if batchError}
          <div class="mb-2 rounded-md border border-tag-sales bg-tag-sales/30 px-2 py-1 text-xs text-tag-salesText">{batchError}</div>
        {/if}
        {#if lifecyclePickerOpen}
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="font-display text-xs uppercase tracking-wider text-ink-500">Set lifecycle for {selectedCount}</span>
              <button class="text-xs text-ink-400 hover:text-ink-700" onclick={() => (lifecyclePickerOpen = false)}>Back</button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              {#each ORG_LIFECYCLE_OPTIONS as o (o.value)}
                <button
                  type="button"
                  class="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium transition hover:brightness-95 disabled:opacity-50"
                  style={`background:${o.color}22; color:${o.color}; border:1px solid ${o.color}55;`}
                  onclick={() => batchSetLifecycle(o.value)}
                  disabled={batchBusy}
                >{o.label}</button>
              {/each}
              <button
                type="button"
                class="inline-flex items-center rounded-full border border-surface-border bg-surface-card px-2 py-1 text-xs font-medium text-ink-500 hover:bg-surface-hover"
                onclick={() => batchSetLifecycle(null)}
                disabled={batchBusy}
              >Clear</button>
            </div>
          </div>
        {:else if mergeMode}
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="font-display text-xs uppercase tracking-wider text-ink-500">Merge into…</span>
              <button class="text-xs text-ink-400 hover:text-ink-700" onclick={() => { mergeMode = false; mergeWinnerId = null; }}>Back</button>
            </div>
            <ul class="max-h-48 overflow-auto rounded-[10px] border border-surface-border bg-surface-card">
              {#each selectedRows as row (row.id)}
                <li>
                  <label class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover">
                    <input type="radio" name="merge-winner" class="h-4 w-4 border-surface-border text-brand focus:ring-brand" value={row.id} checked={mergeWinnerId === row.id} onchange={() => (mergeWinnerId = row.id)} />
                    <span class="truncate flex-1">{row.name ?? `Org ${row.id}`}</span>
                  </label>
                </li>
              {/each}
            </ul>
            <div class="flex items-center justify-end gap-2">
              <button class="btn-primary" onclick={openMergeReview} disabled={batchBusy || !mergeWinnerId || selectedCount < 2}>
                {batchBusy ? 'Merging…' : `Merge ${selectedCount - 1} into winner`}
              </button>
            </div>
            <p class="text-[11px] text-ink-400">Roles, activities, dates, projects, and tags from the losers re-point to the winner. Losers get archived with successor_id set.</p>
          </div>
        {:else}
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-display text-xs uppercase tracking-wider text-ink-500">{selectedCount} selected</span>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <button class="btn-ghost" onclick={() => (mergeMode = true)} disabled={batchBusy || selectedCount < 2} title={selectedCount < 2 ? 'Pick at least two to merge' : 'Merge selected orgs into one'}>
              <Icon name="move" size={14} /> Merge
            </button>
            <button class="btn-ghost" onclick={() => (lifecyclePickerOpen = true)} disabled={batchBusy} title="Set lifecycle status (active, dormant, acquired, …)">
              <Icon name="bolt" size={14} /> Lifecycle
            </button>
            <button class="btn-ghost" onclick={batchMarkActive} disabled={batchBusy} title="Mark as currently operating">
              <Icon name="check" size={14} /> Active
            </button>
            <button class="btn-ghost" onclick={batchMarkInactive} disabled={batchBusy} title="Mark as no longer operating">
              <Icon name="tag" size={14} /> Inactive
            </button>
            <button class="btn-ghost" onclick={batchRestore} disabled={batchBusy} title="Restore to published">
              <Icon name="check" size={14} /> Restore
            </button>
            <button class="btn-ghost text-tag-salesText hover:text-tag-salesText" onclick={batchArchive} disabled={batchBusy} title="Move to archive">
              <Icon name="tag" size={14} /> {batchBusy ? '…' : 'Archive'}
            </button>
            <button class="btn-ghost text-tag-salesText hover:text-tag-salesText" onclick={batchDelete} disabled={batchBusy} title="Permanently delete">
              <Icon name="x" size={14} /> Delete
            </button>
            <button class="btn-ghost" onclick={clearSelection} disabled={batchBusy}>Clear</button>
          </div>
        </div>
        {/if}
      </div>
    </div>
  {/if}

  <MergeReview
    open={mergeReviewOpen}
    records={mergeReviewRecords}
    fields={[...ORG_MERGE_FIELDS]}
    title="Merge organisations — review fields"
    busy={batchBusy}
    labelOf={(o) => o.name ?? `Org ${o.id}`}
    onCancel={() => (mergeReviewOpen = false)}
    onConfirm={(winnerId, losers, patch) => performMerge(winnerId, losers, patch)}
  />
</section>
