<script lang="ts">
  // Events (happenings) overview. A real-world event record connected
  // to a project, people, orgs and photos — distinct from the calendar.
  // Filtering is all client-side: the page loads the full set (small),
  // and the filter options are derived from what's actually present.
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import { assetUrl, searchProjects, type Project } from '$lib/directus';
  import {
    createEvent,
    updateEvent,
    deleteEvent,
    duplicateEvent,
    getEventContentCounts,
    updateEventsBulk,
    deleteEventsBulk,
    EVENT_KIND_LABEL,
    EVENT_STATUS_LABEL,
    eventTimeStatus,
    type EventRecord,
    type EventDuplicateContent
  } from '$lib/events/data';

  let { data }: { data: { events: EventRecord[]; error: string | null } } = $props();
  let events = $state<EventRecord[]>([...data.events]);
  let creating = $state(false);
  let errorMsg = $state<string | null>(data.error);

  // Archived view + per-row cleanup actions.
  let showArchived = $state(false);
  let menuOpenId = $state<number | null>(null);
  let busyId = $state<number | null>(null);

  const liveEvents = $derived(events.filter((e) => e.status !== 'archived'));
  const archivedCount = $derived(events.length - liveEvents.length);

  async function archiveEvent(e: EventRecord) {
    busyId = e.id;
    menuOpenId = null;
    try {
      await updateEvent(e.id, { status: 'archived' });
      events = events.map((x) => (x.id === e.id ? { ...x, status: 'archived' } : x));
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      busyId = null;
    }
  }
  async function restoreEvent(e: EventRecord) {
    busyId = e.id;
    menuOpenId = null;
    // Past events restore to "past", otherwise "upcoming".
    const back = e.start && new Date(e.start) < new Date() ? 'past' : 'upcoming';
    try {
      await updateEvent(e.id, { status: back });
      events = events.map((x) => (x.id === e.id ? { ...x, status: back } : x));
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      busyId = null;
    }
  }
  async function removeEvent(e: EventRecord) {
    menuOpenId = null;
    if (!confirm(`Delete "${e.name ?? 'event'}" permanently? This removes the event and its links (photos stay in the file library).`)) return;
    busyId = e.id;
    try {
      await deleteEvent(e.id);
      events = events.filter((x) => x.id !== e.id);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      busyId = null;
    }
  }

  // ── Duplicate ──────────────────────────────────────────────────
  // Clone an event with new timings and a chosen subset of its content.
  let dupSource = $state<EventRecord | null>(null);
  let dupName = $state('');
  let dupStart = $state('');
  let dupEnd = $state('');
  let dupContent = $state<EventDuplicateContent>({
    summary: true,
    cover: true,
    photos: true,
    people: true,
    orgs: true,
    marketing: false
  });
  let dupCounts = $state<{
    photos: number;
    people: number;
    orgs: number;
    marketing: number;
    hasCover: boolean;
    hasSummary: boolean;
  } | null>(null);
  let dupBusy = $state(false);

  const dupItems = $derived(
    [
      { key: 'cover', label: 'Cover photo', avail: dupCounts ? dupCounts.hasCover : true, meta: '' },
      { key: 'summary', label: 'Description', avail: dupCounts ? dupCounts.hasSummary : true, meta: '' },
      { key: 'photos', label: 'Gallery photos', avail: dupCounts ? dupCounts.photos > 0 : true, meta: dupCounts ? `${dupCounts.photos}` : '' },
      { key: 'people', label: 'People & roles', avail: dupCounts ? dupCounts.people > 0 : true, meta: dupCounts ? `${dupCounts.people}` : '' },
      { key: 'orgs', label: 'Organizations', avail: dupCounts ? dupCounts.orgs > 0 : true, meta: dupCounts ? `${dupCounts.orgs}` : '' },
      { key: 'marketing', label: 'Marketing material', avail: dupCounts ? dupCounts.marketing > 0 : true, meta: dupCounts ? `${dupCounts.marketing}` : '' }
    ] as const satisfies ReadonlyArray<{ key: keyof EventDuplicateContent; label: string; avail: boolean; meta: string }>
  );

  function openDuplicate(e: EventRecord) {
    menuOpenId = null;
    dupSource = e;
    dupName = `${e.name ?? 'Event'} (copy)`;
    // Default the new timings to the source's, shifted by nothing — the
    // user retimes them. Keep the time-of-day; clear if the source had none.
    dupStart = e.start ? e.start.slice(0, 16) : '';
    dupEnd = e.end ? e.end.slice(0, 16) : '';
    dupContent = { summary: true, cover: true, photos: true, people: true, orgs: true, marketing: false };
    dupCounts = null;
    getEventContentCounts(e.id)
      .then((c) => {
        dupCounts = c;
        // Don't pre-tick options that have nothing to copy.
        dupContent = {
          summary: c.hasSummary,
          cover: c.hasCover,
          photos: c.photos > 0,
          people: c.people > 0,
          orgs: c.orgs > 0,
          marketing: false
        };
      })
      .catch(() => {});
  }
  function closeDuplicate() {
    dupSource = null;
    dupBusy = false;
  }
  async function confirmDuplicate() {
    if (!dupSource || dupBusy) return;
    dupBusy = true;
    errorMsg = null;
    try {
      const copy = await duplicateEvent(dupSource.id, {
        name: dupName.trim() || `${dupSource.name ?? 'Event'} (copy)`,
        start: dupStart ? new Date(dupStart).toISOString() : null,
        end: dupEnd ? new Date(dupEnd).toISOString() : null,
        status: 'planning',
        ...dupContent
      });
      closeDuplicate();
      await goto(`/events/${copy.id}`);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      dupBusy = false;
    }
  }

  // ── Multi-select / batch edit ──────────────────────────────────
  let selectMode = $state(false);
  let selected = $state<Set<number>>(new Set());
  let bulkBusy = $state(false);
  let bulkKind = $state('');
  let bulkStatus = $state('');
  // Inline project picker for the bulk bar.
  let projQuery = $state('');
  let projResults = $state<Project[]>([]);
  let projSearching = $state(false);

  const selectedCount = $derived(selected.size);

  function toggleSelectMode() {
    selectMode = !selectMode;
    if (!selectMode) selected = new Set();
    menuOpenId = null;
  }
  function toggleSelected(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }
  function toggleSelectAll() {
    const ids = shown.map((e) => e.id);
    const next = new Set(selected);
    if (allShownSelected) for (const id of ids) next.delete(id);
    else for (const id of ids) next.add(id);
    selected = next;
  }

  async function runProjectSearch() {
    projSearching = true;
    try {
      projResults = await searchProjects(projQuery, 8);
    } catch {
      projResults = [];
    } finally {
      projSearching = false;
    }
  }

  function bulkPatchLocal(ids: Set<number>, patch: Partial<EventRecord>) {
    events = events.map((e) => (ids.has(e.id) ? { ...e, ...patch } : e));
  }

  async function bulkAssignProject(p: Project) {
    if (selectedCount === 0 || bulkBusy) return;
    bulkBusy = true;
    errorMsg = null;
    const ids = [...selected];
    try {
      await updateEventsBulk(ids, { project_id: p.id });
      // Reflect the new project (id + display fields) in the loaded rows.
      bulkPatchLocal(selected, {
        project_id: { id: p.id, name: p.name, color: p.color } as unknown as EventRecord['project_id']
      });
      projQuery = '';
      projResults = [];
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      bulkBusy = false;
    }
  }
  async function bulkClearProject() {
    if (selectedCount === 0 || bulkBusy) return;
    bulkBusy = true;
    errorMsg = null;
    try {
      await updateEventsBulk([...selected], { project_id: null });
      bulkPatchLocal(selected, { project_id: null });
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      bulkBusy = false;
    }
  }
  async function bulkSetField(patch: Partial<EventRecord>) {
    if (selectedCount === 0 || bulkBusy) return;
    bulkBusy = true;
    errorMsg = null;
    try {
      await updateEventsBulk([...selected], patch);
      bulkPatchLocal(selected, patch);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      bulkBusy = false;
    }
  }
  async function bulkArchive() {
    await bulkSetField({ status: 'archived' });
    selected = new Set();
  }
  async function bulkDelete() {
    if (selectedCount === 0 || bulkBusy) return;
    if (!confirm(`Delete ${selectedCount} event${selectedCount === 1 ? '' : 's'} permanently? Photos stay in the file library.`)) return;
    bulkBusy = true;
    errorMsg = null;
    const ids = [...selected];
    try {
      await deleteEventsBulk(ids);
      events = events.filter((e) => !selected.has(e.id));
      selected = new Set();
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      bulkBusy = false;
    }
  }

  // ── Filters (all client-side) ───────────────────────────────────
  const STATUSES = ['all', 'upcoming', 'past', 'planning', 'idea'] as const;
  let statusFilter = $state<(typeof STATUSES)[number]>('all');
  let search = $state('');
  let projectFilter = $state<number | 'all'>('all');
  let kindFilter = $state<string | 'all'>('all');
  let yearFilter = $state<number | 'all'>('all');

  const eventYear = (e: EventRecord) => (e.start ? new Date(e.start).getFullYear() : null);
  const eventProjectId = (e: EventRecord) =>
    typeof e.project_id === 'object' ? (e.project_id?.id ?? null) : (e.project_id ?? null);

  // Option lists, derived from the loaded events so we only ever offer
  // filters that would actually match something.
  const projectOptions = $derived.by(() => {
    const map = new Map<number, { id: number; name: string; color: string | null }>();
    for (const e of liveEvents) {
      if (typeof e.project_id === 'object' && e.project_id?.id) {
        map.set(e.project_id.id, {
          id: e.project_id.id,
          name: e.project_id.name ?? `#${e.project_id.id}`,
          color: e.project_id.color ?? null
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  const kindOptions = $derived(
    [...new Set(liveEvents.map((e) => e.kind ?? 'other'))].sort((a, b) =>
      (EVENT_KIND_LABEL[a] ?? a).localeCompare(EVENT_KIND_LABEL[b] ?? b)
    )
  );
  const yearOptions = $derived(
    [...new Set(liveEvents.map(eventYear).filter((y): y is number => y != null))].sort((a, b) => b - a)
  );

  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const base = showArchived ? events.filter((e) => e.status === 'archived') : liveEvents;
    return base.filter((e) => {
      // Filter on the DERIVED status for the same reason the badge does: an
      // event whose date has passed but whose `status` still says upcoming
      // would otherwise appear under Upcoming while its badge read Past.
      if (!showArchived && statusFilter !== 'all' && eventTimeStatus(e) !== statusFilter) return false;
      if (projectFilter !== 'all' && eventProjectId(e) !== projectFilter) return false;
      if (kindFilter !== 'all' && (e.kind ?? 'other') !== kindFilter) return false;
      if (yearFilter !== 'all' && eventYear(e) !== yearFilter) return false;
      if (q) {
        const hay = `${e.name ?? ''} ${e.location_name ?? ''} ${projName(e) ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });
  const allShownSelected = $derived(shown.length > 0 && shown.every((e) => selected.has(e.id)));

  const activeCount = $derived(
    (statusFilter !== 'all' ? 1 : 0) +
      (projectFilter !== 'all' ? 1 : 0) +
      (kindFilter !== 'all' ? 1 : 0) +
      (yearFilter !== 'all' ? 1 : 0) +
      (search.trim() ? 1 : 0)
  );
  function clearFilters() {
    statusFilter = 'all';
    projectFilter = 'all';
    kindFilter = 'all';
    yearFilter = 'all';
    search = '';
  }

  const STATUS_STYLE: Record<string, string> = {
    idea: 'background: var(--bg-tertiary); color: var(--text-secondary);',
    planning: 'background: rgba(214,158,46,0.16); color: #B57A12;',
    upcoming: 'background: rgba(29,107,254,0.12); color: #1D6BFE;',
    past: 'background: rgba(34,160,90,0.14); color: #1B8A4B;'
  };

  function projName(e: EventRecord): string | null {
    return typeof e.project_id === 'object' ? (e.project_id?.name ?? null) : null;
  }
  function projColor(e: EventRecord): string {
    return (typeof e.project_id === 'object' ? e.project_id?.color : null) || 'var(--accent-electric)';
  }
  const fmtDate = (iso?: string | null) =>
    iso
      ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
      : null;

  async function newEvent() {
    creating = true;
    errorMsg = null;
    try {
      const e = await createEvent({ name: 'New event', status: 'planning', kind: 'other' });
      await goto(`/events/${e.id}`);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head><title>Events · Hub</title></svelte:head>

<section class="mx-auto max-w-3xl space-y-5" class:pb-24={selectMode && selectedCount > 0}>
  <header class="flex items-start justify-between gap-3">
    <div>
      <div class="hero-eyebrow">Events</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
        Happenings
      </h1>
      <p class="mt-1 text-sm text-ink-500">
        Demo days, hackathons, ceremonies — connected to projects, teams, people and photos.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      {#if events.length > 0}
        <button class="btn-ghost text-sm" aria-pressed={selectMode} onclick={toggleSelectMode}>
          {selectMode ? 'Done' : 'Select'}
        </button>
      {/if}
      <button class="btn-primary" disabled={creating} onclick={newEvent}>
        {creating ? 'Creating…' : '+ New event'}
      </button>
    </div>
  </header>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 text-sm" style="color: #C0392B;">{errorMsg}</div>
  {/if}

  <!-- Filter bar -->
  {#if events.length > 0}
    <div class="space-y-3 rounded-[14px] border border-surface-border bg-surface-card p-3">
      <!-- Search -->
      <div class="relative">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300"><Icon name="search" size={15} /></span>
        <input
          type="search"
          inputmode="search"
          placeholder="Search events, venues…"
          class="input w-full pl-9"
          bind:value={search}
        />
      </div>

      <!-- Project / Kind / Year selects -->
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label class="flex flex-col gap-0.5">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Project</span>
          <select class="input text-sm" bind:value={projectFilter}>
            <option value="all">All projects</option>
            {#each projectOptions as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select>
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Kind</span>
          <select class="input text-sm" bind:value={kindFilter}>
            <option value="all">All kinds</option>
            {#each kindOptions as k (k)}<option value={k}>{EVENT_KIND_LABEL[k] ?? k}</option>{/each}
          </select>
        </label>
        <label class="col-span-2 flex flex-col gap-0.5 sm:col-span-1">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Year</span>
          <select class="input text-sm" bind:value={yearFilter}>
            <option value="all">All years</option>
            {#each yearOptions as y (y)}<option value={y}>{y}</option>{/each}
          </select>
        </label>
      </div>

      <!-- Status chips (live view only) + clear -->
      <div class="flex flex-wrap items-center gap-1.5">
        {#if !showArchived}
          {#each STATUSES as s (s)}
            {@const on = statusFilter === s}
            <button
              type="button"
              class="cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition"
              style:background-color={on ? 'rgba(44,140,153,0.12)' : 'transparent'}
              style:color={on ? 'var(--brand, #2C8C99)' : 'var(--text-secondary)'}
              style:border-color={on ? 'rgba(44,140,153,0.45)' : 'var(--surface-border)'}
              aria-pressed={on}
              onclick={() => (statusFilter = s)}
            >{s}</button>
          {/each}
        {:else}
          <span class="text-[11px] text-ink-400">Showing archived events — restore or delete below.</span>
        {/if}
        {#if !showArchived && activeCount > 0}
          <button class="cursor-pointer text-[11px] text-ink-400 transition hover:text-ink-700" onclick={clearFilters}>
            Clear ({activeCount})
          </button>
        {/if}
        {#if archivedCount > 0}
          <button
            type="button"
            class="ml-auto cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium transition"
            style:background-color={showArchived ? 'rgba(44,140,153,0.12)' : 'transparent'}
            style:color={showArchived ? 'var(--brand, #2C8C99)' : 'var(--text-secondary)'}
            style:border-color={showArchived ? 'rgba(44,140,153,0.45)' : 'var(--surface-border)'}
            aria-pressed={showArchived}
            onclick={() => (showArchived = !showArchived)}
          >Archived ({archivedCount})</button>
        {/if}
      </div>

      <!-- Result count -->
      <div class="text-[11px] text-ink-400">
        {shown.length} of {showArchived ? archivedCount : liveEvents.length}
        {showArchived ? 'archived' : ''} event{(showArchived ? archivedCount : liveEvents.length) === 1 ? '' : 's'}
      </div>
    </div>
  {/if}

  {#if shown.length === 0}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-10 text-center text-ink-500">
      <span class="inline-flex text-ink-300"><Icon name="calendar" size={28} /></span>
      <p class="mt-2">
        {#if events.length === 0}
          No events yet. Log your first happening.
        {:else}
          No events match these filters.
          <button class="underline hover:text-ink-700" onclick={clearFilters}>Clear filters</button>
        {/if}
      </p>
    </div>
  {:else}
    {#if selectMode}
      <div class="flex items-center justify-between rounded-[12px] border border-surface-border bg-surface-card px-3 py-2 text-sm">
        <label class="flex cursor-pointer items-center gap-2 text-ink-700">
          <input type="checkbox" class="h-4 w-4" checked={allShownSelected} onchange={toggleSelectAll} />
          Select all {shown.length}
        </label>
        <span class="text-[12px] text-ink-400">{selectedCount} selected</span>
      </div>
    {/if}
    <ul class="space-y-3" class:mt-3={selectMode}>
      {#each shown as e (e.id)}
        <li
          class="relative rounded-[14px] border border-surface-border bg-surface-card transition hover:bg-surface-hover"
          style:opacity={busyId === e.id ? 0.5 : 1}
        >
          <a
            href={`/events/${e.id}`}
            class="flex items-stretch gap-3"
            class:bg-surface-hover={selectMode && selected.has(e.id)}
            onclick={(ev) => {
              if (selectMode) {
                ev.preventDefault();
                toggleSelected(e.id);
              }
            }}
          >
            {#if selectMode}
              <span class="flex shrink-0 items-center pl-3">
                <input type="checkbox" class="pointer-events-none h-4 w-4" checked={selected.has(e.id)} tabindex="-1" aria-label={`Select ${e.name ?? 'event'}`} />
              </span>
            {/if}
            <span class="w-1 shrink-0 rounded-l-[14px]" style:background-color={projColor(e)}></span>
            {#if e.cover}
              <img src={assetUrl(e.cover, { width: 160, height: 160, fit: 'cover' })} alt="" class="my-3 h-16 w-16 shrink-0 rounded-md object-cover" />
            {:else}
              <span class="my-3 grid h-16 w-16 shrink-0 place-items-center rounded-md text-ink-300" style="background: var(--bg-tertiary);"><Icon name="calendar" size={20} /></span>
            {/if}
            <span class="min-w-0 flex-1 py-3 pr-10">
              <span class="flex items-center gap-2">
                <span class="truncate font-medium text-ink-900">{e.name ?? '(untitled)'}</span>
                <!-- Derived, matching the filter above it. Leaving this on the
                     stored status while the filter used the derived one put a
                     row under "Past" with an UPCOMING badge — one screen
                     contradicting itself, which is worse than the original bug. -->
                {#if eventTimeStatus(e) && eventTimeStatus(e) !== 'archived'}
                  {@const shown = eventTimeStatus(e)}
                  <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={STATUS_STYLE[shown] ?? STATUS_STYLE.idea}>{EVENT_STATUS_LABEL[shown] ?? shown}</span>
                {/if}
              </span>
              <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-500">
                <span>{EVENT_KIND_LABEL[e.kind ?? 'other'] ?? e.kind}</span>
                {#if fmtDate(e.start)}<span>·</span><span class="tabular-nums">{fmtDate(e.start)}</span>{/if}
                {#if e.location_name}<span>·</span><span class="truncate">📍 {e.location_name}</span>{/if}
                {#if projName(e)}<span>·</span><span class="truncate" style:color={projColor(e)}>{projName(e)}</span>{/if}
              </span>
            </span>
          </a>

          <!-- Row actions: archive / restore / delete (hidden in select mode) -->
          {#if !selectMode}
          <button
            type="button"
            class="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-ink-300 transition hover:bg-surface-hover hover:text-ink-700"
            aria-label="Event actions"
            aria-haspopup="menu"
            disabled={busyId === e.id}
            onclick={() => (menuOpenId = menuOpenId === e.id ? null : e.id)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
          </button>
          {/if}
          {#if menuOpenId === e.id}
            <div
              class="absolute right-1.5 top-11 z-30 w-40 overflow-hidden rounded-md border border-surface-border bg-surface-card py-1 shadow-lg"
              role="menu"
            >
              <button class="block w-full cursor-pointer px-3 py-2 text-left text-sm text-ink-900 transition hover:bg-surface-hover" role="menuitem" onclick={() => openDuplicate(e)}>
                Duplicate…
              </button>
              {#if e.status === 'archived'}
                <button class="block w-full cursor-pointer px-3 py-2 text-left text-sm text-ink-900 transition hover:bg-surface-hover" role="menuitem" onclick={() => restoreEvent(e)}>
                  Restore
                </button>
              {:else}
                <button class="block w-full cursor-pointer px-3 py-2 text-left text-sm text-ink-900 transition hover:bg-surface-hover" role="menuitem" onclick={() => archiveEvent(e)}>
                  Archive
                </button>
              {/if}
              <button class="block w-full cursor-pointer px-3 py-2 text-left text-sm transition hover:bg-surface-hover" style="color: #C0392B;" role="menuitem" onclick={() => removeEvent(e)}>
                Delete…
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Bulk action bar (select mode, at least one selected) -->
  {#if selectMode && selectedCount > 0}
    <div class="fixed inset-x-0 bottom-0 z-40 border-t border-surface-border bg-surface-card/95 backdrop-blur">
      <div class="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-4 py-3">
        <span class="text-sm font-medium text-ink-900">{selectedCount} selected</span>

        <!-- Assign to project -->
        <div class="relative">
          <input
            type="search"
            placeholder="Add to project…"
            class="input !w-44 !py-1.5 text-sm"
            bind:value={projQuery}
            oninput={runProjectSearch}
            onfocus={runProjectSearch}
            disabled={bulkBusy}
          />
          {#if projResults.length > 0 || projSearching}
            <div class="absolute bottom-full left-0 z-10 mb-1 max-h-60 w-60 overflow-y-auto rounded-md border border-surface-border bg-surface-card py-1 shadow-lg">
              {#if projSearching && projResults.length === 0}
                <div class="px-3 py-2 text-xs text-ink-400">Searching…</div>
              {/if}
              {#each projResults as p (p.id)}
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-900 transition hover:bg-surface-hover"
                  onclick={() => bulkAssignProject(p)}
                >
                  <span class="h-2 w-2 shrink-0 rounded-full" style:background-color={p.color || 'var(--accent-electric)'}></span>
                  <span class="truncate">{p.name}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Set status -->
        <select
          class="input !w-auto !py-1.5 text-sm"
          bind:value={bulkStatus}
          disabled={bulkBusy}
          onchange={() => { if (bulkStatus) { bulkSetField({ status: bulkStatus }); bulkStatus = ''; } }}
        >
          <option value="">Set status…</option>
          {#each ['idea', 'planning', 'upcoming', 'past'] as s (s)}<option value={s}>{EVENT_STATUS_LABEL[s] ?? s}</option>{/each}
        </select>

        <!-- Set kind -->
        <select
          class="input !w-auto !py-1.5 text-sm"
          bind:value={bulkKind}
          disabled={bulkBusy}
          onchange={() => { if (bulkKind) { bulkSetField({ kind: bulkKind }); bulkKind = ''; } }}
        >
          <option value="">Set kind…</option>
          {#each Object.keys(EVENT_KIND_LABEL) as k (k)}<option value={k}>{EVENT_KIND_LABEL[k]}</option>{/each}
        </select>

        <button class="btn-ghost text-sm" disabled={bulkBusy} onclick={bulkClearProject}>Clear project</button>
        <button class="btn-ghost text-sm" disabled={bulkBusy} onclick={bulkArchive}>Archive</button>
        <button class="btn-ghost text-sm" disabled={bulkBusy} style="color:#C0392B;" onclick={bulkDelete}>Delete</button>

        <button class="btn-ghost ml-auto text-sm" disabled={bulkBusy} onclick={() => (selected = new Set())}>Clear</button>
      </div>
    </div>
  {/if}

  <!-- Duplicate dialog -->
  {#if dupSource}
    <div class="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button class="absolute inset-0 cursor-default bg-black/40" aria-label="Close" tabindex="-1" onclick={closeDuplicate}></button>
      <div
        class="relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-t-[18px] border border-surface-border bg-surface-card p-5 shadow-xl sm:max-w-md sm:rounded-[18px]"
        role="dialog"
        aria-modal="true"
        aria-label="Duplicate event"
      >
        <h2 class="font-display text-lg font-bold text-ink-900" style="letter-spacing:-0.02em;">Duplicate event</h2>
        <p class="mt-0.5 text-[13px] text-ink-500">
          Copying <span class="font-medium text-ink-700">{dupSource.name ?? 'event'}</span>. Set new timings and pick what to carry over.
        </p>

        <div class="mt-4 space-y-3">
          <label class="flex flex-col gap-1">
            <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">New name</span>
            <input class="input w-full" bind:value={dupName} />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1">
              <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Starts</span>
              <input type="datetime-local" class="input w-full text-sm" bind:value={dupStart} />
            </label>
            <label class="flex flex-col gap-1">
              <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Ends</span>
              <input type="datetime-local" class="input w-full text-sm" bind:value={dupEnd} />
            </label>
          </div>
        </div>

        <div class="mt-4">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Include</span>
          <div class="mt-1.5 space-y-1.5">
            {#each dupItems as it (it.key)}
              <label
                class="flex items-center justify-between gap-2 rounded-[10px] border border-surface-border px-3 py-2 text-sm transition"
                class:opacity-40={!it.avail}
                style:cursor={it.avail ? 'pointer' : 'not-allowed'}
              >
                <span class="flex items-center gap-2 text-ink-800">
                  <input
                    type="checkbox"
                    bind:checked={dupContent[it.key]}
                    disabled={!it.avail || dupBusy}
                  />
                  {it.label}
                </span>
                {#if it.meta}<span class="tabular-nums text-[11px] text-ink-400">{it.meta}</span>{/if}
              </label>
            {/each}
          </div>
          <p class="mt-2 text-[11px] text-ink-400">
            Calendar date links aren't copied — the duplicate gets its own timings. The new event starts in <span class="font-medium">Planning</span>.
          </p>
        </div>

        <div class="mt-5 flex items-center justify-end gap-2">
          <button class="btn-ghost text-sm" disabled={dupBusy} onclick={closeDuplicate}>Cancel</button>
          <button class="btn-primary text-sm" disabled={dupBusy} onclick={confirmDuplicate}>
            {dupBusy ? 'Duplicating…' : 'Create duplicate'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Click-outside backdrop for the open row menu. -->
  {#if menuOpenId !== null}
    <button
      class="fixed inset-0 z-20 cursor-default"
      aria-label="Close menu"
      tabindex="-1"
      onclick={() => (menuOpenId = null)}
    ></button>
  {/if}
</section>
