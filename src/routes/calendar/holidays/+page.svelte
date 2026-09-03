<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import BottomSheet from '$lib/BottomSheet.svelte';
  import {
    createDateRow,
    updateDateRow,
    deleteDateRow,
    searchOrgs,
    searchProjects,
    formatError,
    type DateEvent,
    type Organization,
    type Project
  } from '$lib/directus';
  import { expandRecurrence, buildRrule, describeRrule, type RruleFreq } from '$lib/recurrence';
  import { invalidateAll } from '$app/navigation';

  let { data }: { data: { rows: DateEvent[] } } = $props();
  let rows = $state<DateEvent[]>(data.rows);
  $effect(() => { rows = data.rows; });

  // ── Next occurrence per row ────────────────────────────────────────────
  // For yearly/monthly/weekly rules we expand 540 days forward so we
  // always have at least one upcoming hit even on Dec 30th.
  function nextOccurrence(r: DateEvent): Date | null {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today.getTime() + 540 * 86_400_000);
    const occs = expandRecurrence(r, today, horizon);
    if (occs.length === 0) return null;
    return new Date(occs[0].start);
  }

  function fmtNext(r: DateEvent): string {
    const next = nextOccurrence(r);
    if (!next) return '—';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
    const dateStr = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short',
      ...(next.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' })
    }).format(next);
    if (days === 0) return `Today · ${dateStr}`;
    if (days === 1) return `Tomorrow · ${dateStr}`;
    if (days > 0 && days < 14) return `In ${days} days · ${dateStr}`;
    return dateStr;
  }

  function fmtAnchor(r: DateEvent): string {
    if (!r.start) return '';
    const d = new Date(r.start);
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  }

  function ownerOf(r: DateEvent): Organization | null {
    return r.organization && typeof r.organization === 'object' ? (r.organization as Organization) : null;
  }
  function projectOf(r: DateEvent): Project | null {
    return r.project_id && typeof r.project_id === 'object' ? (r.project_id as Project) : null;
  }

  // ── Add / edit flow ───────────────────────────────────────────────────
  let sheetOpen = $state(false);
  let editingId = $state<number | null>(null);
  let newTitle = $state('');
  let newDate = $state(new Date().toISOString().slice(0, 10));
  let newFreq = $state<RruleFreq | ''>('YEARLY');
  let newInterval = $state(1);
  let newScope = $state<'work' | 'private' | 'both'>('both');
  let newOrg = $state<Organization | null>(null);
  let newProject = $state<Project | null>(null);
  let orgQuery = $state('');
  let orgResults = $state<Organization[]>([]);
  let orgTimer: ReturnType<typeof setTimeout> | null = null;
  let projectQuery = $state('');
  let projectResults = $state<Project[]>([]);
  let projectTimer: ReturnType<typeof setTimeout> | null = null;
  let busy = $state(false);
  let error = $state('');

  function openNew() {
    editingId = null;
    newTitle = '';
    newDate = new Date().toISOString().slice(0, 10);
    newFreq = 'YEARLY';
    newInterval = 1;
    newScope = 'both';
    newOrg = null;
    newProject = null;
    orgQuery = '';
    orgResults = [];
    projectQuery = '';
    projectResults = [];
    error = '';
    sheetOpen = true;
  }

  function openEdit(r: DateEvent) {
    editingId = r.id;
    newTitle = r.title ?? '';
    newDate = r.start ? r.start.slice(0, 10) : new Date().toISOString().slice(0, 10);
    if (r.is_recurring) {
      // Parse the FREQ from the stored rule.
      const m = (r.recurrence_rule ?? '').match(/FREQ=(YEARLY|MONTHLY|WEEKLY|DAILY)/i);
      newFreq = (m?.[1]?.toUpperCase() as RruleFreq) ?? 'YEARLY';
      const im = (r.recurrence_rule ?? '').match(/INTERVAL=(\d+)/i);
      newInterval = im ? parseInt(im[1], 10) : 1;
    } else {
      newFreq = '';
      newInterval = 1;
    }
    newScope = (r.scope as 'work' | 'private' | 'both') ?? 'both';
    newOrg = ownerOf(r);
    newProject = projectOf(r);
    error = '';
    sheetOpen = true;
  }

  function onOrgQuery(e: Event) {
    orgQuery = (e.currentTarget as HTMLInputElement).value;
    if (orgTimer) clearTimeout(orgTimer);
    orgTimer = setTimeout(async () => {
      if (!orgQuery.trim()) { orgResults = []; return; }
      try { orgResults = (await searchOrgs(orgQuery, 6)) as Organization[]; }
      catch { orgResults = []; }
    }, 180);
  }
  function onProjectQuery(e: Event) {
    projectQuery = (e.currentTarget as HTMLInputElement).value;
    if (projectTimer) clearTimeout(projectTimer);
    projectTimer = setTimeout(async () => {
      if (!projectQuery.trim()) { projectResults = []; return; }
      try { projectResults = (await searchProjects(projectQuery, 6)) as Project[]; }
      catch { projectResults = []; }
    }, 180);
  }

  async function submitHoliday() {
    const title = newTitle.trim();
    if (!title || busy) return;
    busy = true;
    error = '';
    try {
      const startISO = new Date(`${newDate}T00:00:00`).toISOString();
      const endISO = new Date(`${newDate}T23:59:59`).toISOString();
      const rrule = newFreq ? buildRrule(newFreq as RruleFreq, newInterval) : null;
      const patch: Partial<DateEvent> = {
        title,
        event_type: 'holiday',
        all_day: true,
        start: startISO,
        end: endISO,
        is_recurring: !!rrule,
        recurrence_rule: rrule,
        scope: newScope,
        organization: (newOrg?.id ?? null) as never,
        project_id: (newProject?.id ?? null) as never
      };
      if (editingId != null) {
        await updateDateRow(editingId, patch);
      } else {
        await createDateRow({ ...(patch as Partial<DateEvent> & { title: string; start: string }) });
      }
      sheetOpen = false;
      void invalidateAll();
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = false;
    }
  }

  async function archiveRow(r: DateEvent) {
    if (!confirm(`Remove ${r.title ?? 'this holiday'}?`)) return;
    try {
      await deleteDateRow(r.id);
      rows = rows.filter((x) => x.id !== r.id);
    } catch (e) {
      alert(formatError(e));
    }
  }

  // Holidays sorted by next occurrence.
  const sorted = $derived(
    [...rows].sort((a, b) => {
      const ax = nextOccurrence(a)?.getTime() ?? Number.POSITIVE_INFINITY;
      const bx = nextOccurrence(b)?.getTime() ?? Number.POSITIVE_INFINITY;
      return ax - bx;
    })
  );
</script>

<section class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <a href="/calendar" class="text-xs text-ink-400 hover:text-brand">← Calendars</a>
      <h1 class="mt-1 text-3xl font-semibold">
        Public holidays <span class="ml-2 text-ink-300 font-medium">{rows.length}</span>
      </h1>
      <p class="text-sm text-ink-500 mt-1">Recurring days you care about — Icelandic and beyond.</p>
    </div>
    <button class="btn-primary hidden md:inline-flex" onclick={openNew}>
      <Icon name="plus" size={16} /> New holiday
    </button>
  </div>

  {#if sorted.length === 0}
    <div class="card p-6 text-center text-sm text-ink-400">
      No holidays yet. Add one — yearly Bun Day, Christmas, your company anniversary — and it'll repeat for you forever.
      <div class="mt-3">
        <button class="btn-primary" onclick={openNew}>
          <Icon name="plus" size={16} /> Add first holiday
        </button>
      </div>
    </div>
  {:else}
    <ul class="card divide-y divide-surface-divider">
      {#each sorted as r (r.id)}
        {@const owner = ownerOf(r)}
        {@const project = projectOf(r)}
        <li class="px-4 py-3">
          <div class="flex items-start gap-3">
            <span
              class="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
              style:background-color={r.color ?? '#F87171'}
              aria-hidden="true"
            ></span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="truncate text-base font-medium text-ink-900 hover:text-brand"
                  onclick={() => openEdit(r)}
                >{r.title || '(untitled)'}</button>
                {#if r.is_recurring}
                  <TagPill tone="online">{describeRrule(r.recurrence_rule, r.start ? new Date(r.start) : null)}</TagPill>
                {:else}
                  <TagPill tone="neutral">one-shot</TagPill>
                {/if}
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                <span>Next: {fmtNext(r)}</span>
                {#if r.start}
                  <span class="text-ink-300">·</span>
                  <span>Anchor {fmtAnchor(r)}</span>
                {/if}
                {#if owner}
                  <span class="text-ink-300">·</span>
                  <a href={`/orgs/${owner.id}`} class="hover:text-brand">
                    <Icon name="building" size={12} class="inline" /> {owner.name}
                  </a>
                {/if}
                {#if project}
                  <span class="text-ink-300">·</span>
                  <a href={`/projects/${project.id}`} class="hover:text-brand">
                    <Icon name="tag" size={12} class="inline" /> {project.name}
                  </a>
                {/if}
              </div>
              {#if r.description}
                <p class="mt-1 text-xs text-ink-400 line-clamp-2">{r.description}</p>
              {/if}
            </div>
            <button
              type="button"
              class="shrink-0 rounded p-1 text-ink-300 hover:bg-surface-hover hover:text-ink-700"
              aria-label="Remove"
              title="Remove holiday"
              onclick={() => archiveRow(r)}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<BottomSheet open={sheetOpen} title={editingId ? 'Edit holiday' : 'Add holiday'} expandable onClose={() => (sheetOpen = false)}>
  <label class="block">
    <span class="block text-xs text-ink-400 mb-1">Name</span>
    <input type="text" class="input w-full" placeholder="e.g. Bun Day / Bolludagur" bind:value={newTitle} autofocus />
  </label>
  <label class="block mt-3">
    <span class="block text-xs text-ink-400 mb-1">First occurrence</span>
    <input type="date" class="input w-full" bind:value={newDate} />
    <span class="block text-xs text-ink-400 mt-1">The anchor date — recurrence is calculated forward from here.</span>
  </label>

  <div class="mt-5 border-t border-surface-divider pt-4">
    <div class="mb-3 font-display text-[10px] uppercase tracking-wider text-ink-400">Recurrence</div>
    <label class="block">
      <span class="block text-xs text-ink-400 mb-1">Repeat</span>
      <select class="input w-full" bind:value={newFreq}>
        <option value="">Doesn't repeat</option>
        <option value="DAILY">Daily</option>
        <option value="WEEKLY">Weekly</option>
        <option value="MONTHLY">Monthly</option>
        <option value="YEARLY">Yearly</option>
      </select>
    </label>
    {#if newFreq}
      <label class="block mt-3">
        <span class="block text-xs text-ink-400 mb-1">Every</span>
        <div class="flex items-center gap-2">
          <input type="number" min="1" max="99" class="input w-20" bind:value={newInterval} />
          <span class="text-sm text-ink-500">{newFreq === 'YEARLY' ? 'year(s)' : newFreq === 'MONTHLY' ? 'month(s)' : newFreq === 'WEEKLY' ? 'week(s)' : 'day(s)'}</span>
        </div>
      </label>
    {/if}
  </div>

  <div class="mt-5 border-t border-surface-divider pt-4">
    <div class="mb-3 font-display text-[10px] uppercase tracking-wider text-ink-400">Connections</div>
    <label class="block">
      <span class="block text-xs text-ink-400 mb-1">Scope</span>
      <select class="input w-full" bind:value={newScope}>
        <option value="both">Both</option>
        <option value="work">Work</option>
        <option value="private">Private</option>
      </select>
    </label>
    <div class="mt-3">
      <span class="block text-xs text-ink-400 mb-1">Owner organisation</span>
      {#if newOrg}
        <div class="flex items-center gap-2 rounded-[8px] border border-surface-border bg-surface-card px-2 py-1.5">
          <Icon name="building" size={14} />
          <span class="truncate text-sm">{newOrg.name}</span>
          <button class="ml-auto text-ink-400 hover:text-ink-700" onclick={() => (newOrg = null)} aria-label="Clear org"><Icon name="x" size={12} /></button>
        </div>
      {:else}
        <input type="text" class="input w-full" autocomplete="off" placeholder="Search orgs…" value={orgQuery} oninput={onOrgQuery} />
        {#if orgResults.length > 0}
          <ul class="mt-1 max-h-40 overflow-auto rounded-[10px] border border-surface-border bg-surface-card">
            {#each orgResults as o (o.id)}
              <li>
                <button class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => { newOrg = o; orgQuery = ''; orgResults = []; }}>
                  <Icon name="building" size={14} />
                  <span class="truncate">{o.name}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
    <div class="mt-3">
      <span class="block text-xs text-ink-400 mb-1">Project</span>
      {#if newProject}
        <div class="flex items-center gap-2 rounded-[8px] border border-surface-border bg-surface-card px-2 py-1.5">
          <Icon name="tag" size={14} />
          <span class="truncate text-sm">{newProject.name}</span>
          <button class="ml-auto text-ink-400 hover:text-ink-700" onclick={() => (newProject = null)} aria-label="Clear project"><Icon name="x" size={12} /></button>
        </div>
      {:else}
        <input type="text" class="input w-full" autocomplete="off" placeholder="Search projects…" value={projectQuery} oninput={onProjectQuery} />
        {#if projectResults.length > 0}
          <ul class="mt-1 max-h-40 overflow-auto rounded-[10px] border border-surface-border bg-surface-card">
            {#each projectResults as p (p.id)}
              <li>
                <button class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => { newProject = p; projectQuery = ''; projectResults = []; }}>
                  <Icon name="tag" size={14} />
                  <span class="truncate">{p.name}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>

  {#snippet footer()}
    {#if error}<div class="mb-2 text-xs text-tag-salesText">{error}</div>{/if}
    <div class="flex justify-end">
      <button class="btn-primary" onclick={submitHoliday} disabled={busy || !newTitle.trim()}>
        <Icon name="plus" size={14} />
        {busy ? 'Saving…' : editingId != null ? 'Save' : 'Create'}
      </button>
    </div>
  {/snippet}
</BottomSheet>
