<script lang="ts">
  import {
    searchProjects,
    createProject,
    bulkUpdateProjects,
    bulkDeleteProjects,
    mergeProjectInto,
    resolveProjectMarks,
    assetUrl,
    formatError,
    type Organization,
    type Project
  } from '$lib/directus';
  import { scope, scopeWhere } from '$lib/scope';
  import type { Filter } from '$lib/data/repo';
  import { goto } from '$app/navigation';
  import Avatar from '$lib/Avatar.svelte';
  import Icon from '$lib/Icon.svelte';
  import TagPill from '$lib/TagPill.svelte';

  type Kind = '' | 'project' | 'course' | 'program' | 'campaign' | 'theme' | 'hraðall' | 'hugmyndahraðhlaup' | 'other';
  type View = 'list' | 'grid';

  let q = $state('');
  let kind = $state<Kind>('');
  let showArchived = $state(false);
  let results: Project[] = $state([]);
  // Effective small-avatar mark per project (own Simple/Original, else
  // inherited from an ancestor). Resolved after each search.
  let markById = $state<Map<number, string | null>>(new Map());
  let loading = $state(false);
  let error = $state('');

  // List ↔ Grid toggle, persisted per-device — same pattern as /people.
  function lsView(): View {
    if (typeof localStorage === 'undefined') return 'list';
    const v = localStorage.getItem('twin.projects.view');
    return v === 'grid' ? 'grid' : 'list';
  }
  let view = $state<View>(lsView());
  $effect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('twin.projects.view', view);
  });

  // --- New project flow ---
  let newOpen = $state(false);
  let newName = $state('');
  let newKind = $state<string>('project');
  let newScope = $state<'work' | 'private' | 'both'>('work');
  let newError = $state('');
  let creating = $state(false);

  function openNew() {
    newOpen = true;
    newName = '';
    newKind = 'project';
    newScope = $scope === 'private' ? 'private' : 'work';
    newError = '';
  }

  async function submitNew() {
    const name = newName.trim();
    if (!name) { newError = 'Name is required'; return; }
    creating = true;
    newError = '';
    try {
      const created = await createProject({ name, kind: newKind, scope: newScope });
      goto(`/projects/${created.id}`);
    } catch (e) {
      newError = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }

  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    clearTimeout(timer);
    const query = q;
    const s = $scope;
    const k = kind;
    const archived = showArchived;
    timer = setTimeout(async () => {
      loading = true;
      error = '';
      try {
        const extra: Array<Filter | null> = [];
        const sf = scopeWhere(s);
        if (sf) extra.push(sf);
        if (k) extra.push({ field: 'kind', op: 'eq', value: k });
        results = await searchProjects(query, 100, extra, { includeArchived: archived });
        try {
          markById = await resolveProjectMarks(results.map((p) => p.id));
        } catch {
          markById = new Map();
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        loading = false;
      }
    }, 200);
  });

  // ── Hierarchy (list view only) ──────────────────────────────────
  // Group projects by parent so the list reads as a calm overview of
  // top-level work. A row only gets an expand chevron when one of its
  // children is in the current `results` (filtered by scope/kind/
  // archived/search — children outside the filter simply don't show).
  function parentIdOf(p: Project): number | null {
    const pid = p.parent_id;
    if (pid == null) return null;
    if (typeof pid === 'object') return (pid as { id?: number }).id ?? null;
    return typeof pid === 'number' ? pid : null;
  }
  const childrenByParent = $derived.by(() => {
    const m = new Map<number, Project[]>();
    for (const p of results) {
      const pid = parentIdOf(p);
      if (pid == null) continue;
      if (!m.has(pid)) m.set(pid, []);
      m.get(pid)!.push(p);
    }
    // Stable child order — alphabetical for cohorts named like
    // "Hringiða 2024", "Hringiða 2025" so years line up.
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    }
    return m;
  });
  const topLevelRows = $derived.by(() => {
    // A row is "top level" in this view if its parent isn't visible
    // here. Otherwise the parent will render it as a child.
    const ids = new Set(results.map((p) => p.id));
    return results.filter((p) => {
      const pid = parentIdOf(p);
      return pid == null || !ids.has(pid);
    });
  });
  let expanded = $state(new Set<number>());
  function toggleExpand(id: number) {
    const n = new Set(expanded);
    if (n.has(id)) n.delete(id); else n.add(id);
    expanded = n;
  }

  type RenderRow = { project: Project; depth: number; hasChildren: boolean; isExpanded: boolean };
  /** Flatten the visible tree (top-level rows + the children of any
   *  expanded ancestor) into one array so the list renders with a
   *  single each block. */
  const renderedRows = $derived.by<RenderRow[]>(() => {
    const out: RenderRow[] = [];
    const visit = (p: Project, depth: number) => {
      const kids = childrenByParent.get(p.id) ?? [];
      const hasKids = kids.length > 0;
      const isOpen = expanded.has(p.id);
      out.push({ project: p, depth, hasChildren: hasKids, isExpanded: isOpen });
      if (hasKids && isOpen) {
        for (const k of kids) visit(k, depth + 1);
      }
    };
    for (const p of topLevelRows) visit(p, 0);
    return out;
  });

  function ownerOf(p: Project): Organization | null {
    return p.owner_org_id && typeof p.owner_org_id === 'object'
      ? (p.owner_org_id as Organization)
      : null;
  }

  const KIND_FILTERS: { value: Kind; label: string }[] = [
    { value: '',         label: 'All' },
    { value: 'project',  label: 'Projects' },
    { value: 'course',   label: 'Courses' },
    { value: 'program',  label: 'Programs' },
    { value: 'campaign', label: 'Campaigns' },
    { value: 'theme',    label: 'Themes' },
    { value: 'hraðall',  label: 'Hraðlar' },
    { value: 'hugmyndahraðhlaup', label: 'Hugmyndahraðhlaup' },
    { value: 'other',    label: 'Other' }
  ];

  function fmtDateRange(start?: string | null, end?: string | null): string {
    const fmt = (d: string) => {
      try {
        return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d));
      } catch { return d; }
    };
    if (start && end) return `${fmt(start)} – ${fmt(end)}`;
    if (start) return `From ${fmt(start)}`;
    if (end) return `Until ${fmt(end)}`;
    return '';
  }

  // Owner-initial badge for the grid view (projects have no logo of
  // their own, so we lean on the owner org's first letter — same
  // visual language as Avatar fallback).
  function initial(name?: string | null): string {
    if (!name) return '?';
    const c = name.trim().charAt(0);
    return c ? c.toUpperCase() : '?';
  }

  // ── Batch select + actions ────────────────────────────────────────────
  let selectMode = $state(false);
  let selected = $state(new Set<number>());
  const selectedCount = $derived(selected.size);
  const allOnPageSelected = $derived(results.length > 0 && results.every((p) => selected.has(p.id)));
  function toggleSelect(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    selected = next;
  }
  function selectAllOnPage() { selected = new Set(results.map((p) => p.id)); }
  function clearSelection() { selected = new Set(); }
  function exitSelectMode() { selectMode = false; clearSelection(); mergeMode = false; }

  let batchBusy = $state(false);
  let batchError = $state('');
  let mergeMode = $state(false);
  let mergeWinnerId = $state<number | null>(null);
  const selectedRows = $derived(results.filter((p) => selected.has(p.id)));

  async function batchArchive() {
    if (selectedCount === 0 || batchBusy) return;
    if (!confirm(`Archive ${selectedCount} project${selectedCount === 1 ? '' : 's'}?`)) return;
    batchBusy = true; batchError = '';
    try {
      await bulkUpdateProjects([...selected], { status: 'archived' });
      results = results.map((p) => (selected.has(p.id) ? { ...p, status: 'archived' } : p));
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }
  async function batchRestore() {
    if (selectedCount === 0 || batchBusy) return;
    batchBusy = true; batchError = '';
    try {
      await bulkUpdateProjects([...selected], { status: 'published' });
      results = results.map((p) => (selected.has(p.id) ? { ...p, status: 'published' } : p));
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }
  async function batchDelete() {
    if (selectedCount === 0 || batchBusy) return;
    if (!confirm(`Permanently DELETE ${selectedCount} project${selectedCount === 1 ? '' : 's'}? This cannot be undone.`)) return;
    batchBusy = true; batchError = '';
    try {
      await bulkDeleteProjects([...selected]);
      results = results.filter((p) => !selected.has(p.id));
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }
  async function performMerge() {
    if (!mergeWinnerId || selectedCount < 2 || batchBusy) return;
    const losers = [...selected].filter((id) => id !== mergeWinnerId);
    const winner = results.find((p) => p.id === mergeWinnerId);
    if (!confirm(`Merge ${losers.length} project${losers.length === 1 ? '' : 's'} into "${winner?.name ?? mergeWinnerId}"? The losers' people, activities, dates, and child projects re-point to the winner and the losers are archived.`)) return;
    batchBusy = true; batchError = '';
    try {
      for (const loserId of losers) {
        await mergeProjectInto(loserId, mergeWinnerId);
      }
      results = results.map((p) => (losers.includes(p.id) ? { ...p, status: 'archived' } : p));
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }
</script>

<section class="space-y-5">
  <!-- Title row: title left, primary CTA right (desktop only). On
       mobile the CTA hides here and re-appears as a fixed FAB at
       bottom-right so it stays one thumb-reach away while scrolling. -->
  <div class="flex flex-wrap items-end justify-between gap-3">
    <h1 class="text-3xl font-semibold">
      Projects <span class="ml-2 text-ink-300 font-medium">{results.length}</span>
    </h1>
    <button class="btn-primary hidden md:inline-flex" onclick={openNew}>
      <Icon name="plus" size={16} /> New project
    </button>
  </div>

  <!-- Secondary controls: search + view + archived. -->
  <div class="flex flex-wrap items-center gap-2">
    <div class="relative w-full sm:w-72">
      <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300">
        <Icon name="search" size={16} />
      </span>
      <input type="search" bind:value={q} placeholder="Search projects…" class="input pl-9" />
    </div>
    <div class="inline-flex rounded-[10px] border border-surface-border bg-surface-card p-0.5 text-xs">
      <button class="rounded-md px-2 py-1 {view === 'list' ? 'bg-surface-hover text-ink-900' : 'text-ink-400'}" onclick={() => (view = 'list')} title="List view">List</button>
      <button class="rounded-md px-2 py-1 {view === 'grid' ? 'bg-surface-hover text-ink-900' : 'text-ink-400'}" onclick={() => (view = 'grid')} title="Grid view">Grid</button>
    </div>
    <label class="inline-flex items-center gap-2 text-xs text-ink-500">
      <input type="checkbox" class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand" bind:checked={showArchived} />
      Show archived
    </label>
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

  <!-- Kind filter row — chip-radio same as the Activity tab on
       /people/[id]. Touch-friendly, visible state, no hidden select. -->
  <div
    class="flex flex-wrap items-center gap-1.5"
    role="radiogroup"
    aria-label="Project kind filter"
  >
    {#each KIND_FILTERS as f (f.value)}
      {@const selected = kind === f.value}
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        class="chip-radio"
        class:is-selected={selected}
        onclick={() => (kind = f.value)}
      >
        {f.label}
      </button>
    {/each}
  </div>

  {#if newOpen}
    <div class="card border-brand/40 p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="card-title"><Icon name="sparkles" size={16} /> New project</div>
        <button class="text-ink-400 hover:text-ink-700" aria-label="Close" onclick={() => (newOpen = false)}>✕</button>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="block sm:col-span-2">
          <span class="block text-xs text-ink-400 mb-1">Name *</span>
          <input type="text" class="input w-full" bind:value={newName} placeholder="e.g. IB700 Autumn 2026" autofocus />
        </label>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Kind</span>
          <select class="input w-full" bind:value={newKind}>
            <option value="project">Project</option>
            <option value="course">Course</option>
            <option value="program">Program</option>
            <option value="campaign">Campaign</option>
            <option value="theme">Theme</option>
            <option value="hraðall">Hraðall</option>
            <option value="hugmyndahraðhlaup">Hugmyndahraðhlaup</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Scope</span>
          <select class="input w-full" bind:value={newScope}>
            <option value="work">Work</option>
            <option value="private">Private</option>
            <option value="both">Both</option>
          </select>
        </label>
      </div>
      {#if newError}<div class="text-xs text-tag-salesText">{newError}</div>{/if}
      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost" onclick={() => (newOpen = false)} disabled={creating}>Cancel</button>
        <button class="btn-primary" onclick={submitNew} disabled={creating || !newName.trim()}>
          {creating ? 'Creating…' : 'Create & open'}
        </button>
      </div>
      <div class="text-xs text-ink-400">On the detail page, set the <span class="font-medium">owner org</span> (e.g. your hat) and link the people involved.</div>
    </div>
  {/if}

  {#if error}
    <p class="rounded-[10px] border border-tag-sales bg-tag-sales px-3 py-2 text-sm text-tag-salesText">{error}</p>
  {/if}

  {#if view === 'list'}
    <div class="card overflow-hidden">
      <div class="hidden sm:grid grid-cols-[1.6fr_1fr_1fr_auto] items-center gap-3 border-b border-surface-divider px-4 py-3 text-xs text-ink-400">
        <span class="flex items-center gap-1"><Icon name="sparkles" size={14} /> Project</span>
        <span class="flex items-center gap-1"><Icon name="building" size={14} /> Owner org</span>
        <span class="flex items-center gap-1"><Icon name="tag" size={14} /> Kind</span>
        <!-- Replaced the Status header (was always "published") with
             the expand-toggle column. Empty in the header. -->
        <span aria-hidden="true"></span>
      </div>
      <ul class="divide-y divide-surface-divider">
        {#each renderedRows as row (row.project.id)}
          {@const p = row.project}
          {@const owner = ownerOf(p)}
          {@const range = fmtDateRange(p.start_date, p.end_date)}
          <li class="hover:bg-surface-hover {p.status === 'archived' ? 'opacity-60' : ''} {selectMode && selected.has(p.id) ? 'bg-brand/[0.06]' : ''}">
            <svelte:element
              this={selectMode ? 'div' : 'a'}
              href={selectMode ? undefined : `/projects/${p.id}`}
              role={selectMode ? 'button' : undefined}
              tabindex={selectMode ? 0 : undefined}
              class="flex min-h-[60px] items-center gap-3 px-4 py-3 text-sm sm:grid sm:py-2.5 {selectMode ? 'sm:grid-cols-[auto_auto_1.6fr_1fr_1fr_auto] cursor-pointer' : 'sm:grid-cols-[auto_1.6fr_1fr_1fr_auto]'}"
              style="touch-action: manipulation; padding-left: calc(1rem + {row.depth * 1.25}rem);"
              onclick={selectMode ? () => toggleSelect(p.id) : undefined}
              onkeydown={selectMode ? ((e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSelect(p.id); } }) : undefined}
            >
              {#if selectMode}
                <input
                  type="checkbox"
                  class="h-5 w-5 shrink-0 rounded border-surface-border text-brand focus:ring-brand"
                  checked={selected.has(p.id)}
                  onclick={(e) => e.stopPropagation()}
                  onchange={() => toggleSelect(p.id)}
                  aria-label={`Select ${p.name ?? 'project'}`}
                />
              {/if}
              {#if markById.get(p.id)}
                <span class="block shrink-0">
                  <Avatar name={p.name ?? '?'} src={assetUrl(markById.get(p.id), { width: 48, height: 48, fit: 'contain' })} size={22} position="contain" bgColor={p.color ?? ''} />
                </span>
              {:else}
                <span
                  class="hidden sm:inline-block h-3 w-3 shrink-0 rounded-full"
                  style:background-color={p.color || 'transparent'}
                  style:border={p.color ? 'none' : '1px dashed var(--border-subtle)'}
                  aria-hidden="true"
                  title={p.color ? `Project colour` : 'No colour set'}
                ></span>
              {/if}
              <div class="min-w-0 flex-1 sm:flex-initial">
                <div class="flex items-center gap-2">
                  {#if p.color && !markById.get(p.id)}
                    <span class="sm:hidden inline-block h-2 w-2 shrink-0 rounded-full" style:background-color={p.color} aria-hidden="true"></span>
                  {/if}
                  <div class="truncate text-base font-medium text-ink-900 sm:text-sm">{p.name ?? '(no name)'}</div>
                </div>
                <!-- Mobile compound: owner · kind · date range · summary -->
                <div class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-400 sm:hidden">
                  {#if owner?.name}<span class="truncate">{owner.name}</span>{/if}
                  {#if p.kind}
                    {#if owner?.name}<span>·</span>{/if}
                    <span class="truncate">{p.kind}</span>
                  {/if}
                  {#if range}
                    {#if owner?.name || p.kind}<span>·</span>{/if}
                    <span class="truncate">{range}</span>
                  {/if}
                </div>
                {#if p.summary}
                  <div class="hidden sm:block truncate text-xs text-ink-400">{p.summary}</div>
                {/if}
              </div>
              <span class="hidden sm:inline truncate text-ink-500">{owner?.name ?? '—'}</span>
              <span class="hidden sm:inline truncate text-ink-500">{p.kind ?? '—'}</span>
              <!-- Replaces the always-"published" status pill.
                   When the row has children: a circular count badge
                   sits flush against the rotating chevron, so the
                   "how many under this?" answer reads in the same
                   eye-line as the expand affordance. Leaf projects
                   render nothing. -->
              <span class="shrink-0 inline-flex items-center gap-1">
                {#if row.hasChildren}
                  {@const count = (childrenByParent.get(p.id) ?? []).length}
                  <span
                    class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-hover text-[10px] font-medium tabular-nums text-ink-600"
                    aria-label={`${count} sub-project${count === 1 ? '' : 's'}`}
                    title={`${count} sub-project${count === 1 ? '' : 's'}`}
                  >{count}</span>
                  <button
                    type="button"
                    class="-mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-400 hover:bg-surface-hover hover:text-ink-700"
                    aria-label={row.isExpanded ? `Collapse sub-projects of ${p.name ?? 'project'}` : `Expand sub-projects of ${p.name ?? 'project'}`}
                    aria-expanded={row.isExpanded}
                    onclick={(e) => { e.preventDefault(); e.stopPropagation(); toggleExpand(p.id); }}
                  >
                    <!-- Same chevron, rotated when expanded — keeps
                         the visual mass consistent between states. -->
                    <Icon name="chevron-right" size={14} class={row.isExpanded ? 'rotate-90 transition-transform' : 'transition-transform'} />
                  </button>
                {/if}
              </span>
            </svelte:element>
          </li>
        {:else}
          <li class="px-4 py-6 text-center text-sm text-ink-400">{loading ? 'Searching…' : 'No projects yet. Create one above.'}</li>
        {/each}
      </ul>
    </div>
  {:else}
    <!-- Grid view — square-ish cards. Project initial / owner initial
         badge as a stand-in for an avatar, then name, owner, kind,
         summary preview, and a status pill at the bottom. -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {#each results as p (p.id)}
        {@const owner = ownerOf(p)}
        {@const range = fmtDateRange(p.start_date, p.end_date)}
        <svelte:element
          this={selectMode ? 'div' : 'a'}
          href={selectMode ? undefined : `/projects/${p.id}`}
          role={selectMode ? 'button' : undefined}
          tabindex={selectMode ? 0 : undefined}
          class="card group relative flex flex-col gap-2 p-4 hover:shadow-card transition {p.status === 'archived' ? 'opacity-60' : ''} {selectMode ? 'cursor-pointer' : ''} {selectMode && selected.has(p.id) ? 'ring-2 ring-brand bg-brand/[0.04]' : ''}"
          onclick={selectMode ? () => toggleSelect(p.id) : undefined}
          onkeydown={selectMode ? ((e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSelect(p.id); } }) : undefined}
        >
          {#if selectMode}
            <input
              type="checkbox"
              class="absolute right-3 top-3 h-5 w-5 rounded border-surface-border bg-surface-card text-brand focus:ring-brand"
              checked={selected.has(p.id)}
              onclick={(e) => e.stopPropagation()}
              onchange={() => toggleSelect(p.id)}
              aria-label={`Select ${p.name ?? 'project'}`}
            />
          {/if}
          <div class="flex items-center gap-2">
            <span
              class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-surface-border bg-surface-card font-display text-sm font-semibold text-ink-700"
              aria-hidden="true"
              title={p.name ?? ''}
            >{initial(p.name)}</span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium text-ink-900">{p.name ?? '(no name)'}</div>
              {#if owner}
                <div class="truncate text-xs text-ink-400">{owner.name}</div>
              {/if}
            </div>
          </div>
          {#if p.summary}
            <div class="line-clamp-3 text-xs text-ink-500">{p.summary}</div>
          {/if}
          {#if range}
            <div class="text-[11px] text-ink-400">{range}</div>
          {/if}
          <div class="mt-auto flex items-center justify-between gap-2 pt-1">
            {#if p.kind}
              <span class="truncate text-[11px] uppercase tracking-wider text-ink-400">{p.kind}</span>
            {:else}
              <span></span>
            {/if}
            {#if p.status === 'archived'}<TagPill tone="neutral">archived</TagPill>
            {:else if p.status === 'draft'}<TagPill tone="sales">draft</TagPill>
            {:else}<TagPill tone="online">{p.status ?? 'published'}</TagPill>{/if}
          </div>
        </svelte:element>
      {:else}
        <div class="col-span-full rounded-[10px] border border-dashed border-surface-border p-8 text-center text-sm text-ink-400">
          {loading ? 'Searching…' : 'No projects yet. Create one above.'}
        </div>
      {/each}
    </div>
  {/if}

  <!-- ── Batch action bar ───────────────────────────────────────────────
       Sticky bottom card visible while ≥1 row is selected. Supports the
       Merge sub-mode where the user picks one row as the winner; the
       others fold into it and archive. -->
  {#if selectMode && selectedCount > 0}
    <div
      class="fixed inset-x-0 z-30 mx-auto w-full max-w-3xl px-3 sm:px-6"
      style="bottom: calc(env(safe-area-inset-bottom) + 4.75rem);"
    >
      <div class="rounded-[14px] border border-surface-border bg-surface-card p-3 shadow-card">
        {#if batchError}
          <div class="mb-2 rounded-md border border-tag-sales bg-tag-sales/30 px-2 py-1 text-xs text-tag-salesText">{batchError}</div>
        {/if}
        {#if mergeMode}
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="font-display text-xs uppercase tracking-wider text-ink-500">Merge into…</span>
              <button class="text-xs text-ink-400 hover:text-ink-700" onclick={() => { mergeMode = false; mergeWinnerId = null; }}>Back</button>
            </div>
            <ul class="max-h-48 overflow-auto rounded-[10px] border border-surface-border bg-surface-card">
              {#each selectedRows as row (row.id)}
                <li>
                  <label class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover">
                    <input
                      type="radio"
                      name="merge-winner"
                      class="h-4 w-4 border-surface-border text-brand focus:ring-brand"
                      value={row.id}
                      checked={mergeWinnerId === row.id}
                      onchange={() => (mergeWinnerId = row.id)}
                    />
                    <span class="truncate flex-1">{row.name ?? `Project ${row.id}`}</span>
                    {#if row.kind}<span class="ml-auto text-xs text-ink-400">{row.kind}</span>{/if}
                  </label>
                </li>
              {/each}
            </ul>
            <div class="flex items-center justify-end gap-2">
              <button class="btn-primary" onclick={performMerge} disabled={batchBusy || !mergeWinnerId || selectedCount < 2}>
                {batchBusy ? 'Merging…' : `Merge ${selectedCount - 1} into winner`}
              </button>
            </div>
            <p class="text-[11px] text-ink-400">People, activities, dates, and child projects from the losers re-point to the winner. The losers are archived (kept for history).</p>
          </div>
        {:else}
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-display text-xs uppercase tracking-wider text-ink-500">{selectedCount} selected</span>
            <div class="ml-auto flex flex-wrap items-center gap-2">
              <button class="btn-ghost" onclick={() => (mergeMode = true)} disabled={batchBusy || selectedCount < 2} title={selectedCount < 2 ? 'Pick at least two rows to merge' : 'Merge selected rows into one'}>
                <Icon name="move" size={14} /> Merge
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

</section>
