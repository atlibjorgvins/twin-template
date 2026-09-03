<script lang="ts">
  // Every tracked stretch, and where each one is going.
  //
  // The Clockify settings page can only say how much is owed. A number tells
  // you something is wrong; it cannot tell you which row to fix. This does —
  // and the "why" column is the reason it exists: in Clockify afterwards,
  // "landed on the catch-all" and "landed on its real project" look identical,
  // and only one of them is a mistake.
  //
  // Two views over one list. The calendar is not decoration: a stretch in the
  // wrong place is usually obvious from when it happened — a block at 03:00, or
  // one overlapping a meeting — and that is invisible in a table.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import { repo } from '$lib/data/repo';
  import { clockifyConfigured, clockifyMe, clockifyProjects, type ClockifyProject } from '$lib/clockify';
  import { pushSession, type FocusSession } from '$lib/focusSession';
  import {
    sessionsBetween,
    sessionsOwed,
    assignSessionProject,
    clearPushError,
    targetOf,
    projectIdOfSession,
    type SessionRow
  } from '$lib/clockifySessions';
  import type { ProjectNode } from '$lib/clockifyTree';

  type View = 'list' | 'calendar';
  type Filter = 'owed' | 'week' | 'all';

  let view = $state<View>('list');
  let filter = $state<Filter>('owed');
  /** Monday of the shown week, local. */
  let weekStart = $state(mondayOf(new Date()));
  let rows = $state<SessionRow[]>([]);
  let projects = $state<ProjectNode[]>([]);
  let cProjects = $state<ClockifyProject[]>([]);
  let workspaceId = $state<string | null>(null);
  let loading = $state(true);
  let busyId = $state<number | null>(null);
  let error = $state('');
  let note = $state('');

  const cName = $derived(new Map(cProjects.map((c) => [c.id, c.name])));
  const pName = $derived(new Map(projects.map((p) => [Number(p.id), p.name ?? `#${p.id}`])));
  /** Only projects that resolve somewhere are worth offering — assigning one
   *  that maps nowhere just moves the failure. */
  const assignable = $derived(
    projects
      .filter((p) => targetOf({ id: 0, project_id: Number(p.id) } as SessionRow, projects))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'is'))
  );
  const unattributed = $derived(rows.filter((r) => !targetOf(r, projects)).length);

  const days = $derived(
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    })
  );

  /** Grouped for the list, newest day first — the day you are fixing is today. */
  const byDay = $derived.by(() => {
    const m = new Map<string, SessionRow[]>();
    for (const r of rows) {
      const k = dayKey(new Date(r.started_at));
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  });

  // The calendar only needs to span the hours that actually contain work —
  // a fixed 00–24 grid wastes most of its height on an empty night.
  const span = $derived.by(() => {
    const inWeek = rows.filter((r) => inShownWeek(r));
    if (inWeek.length === 0) return { from: 8, to: 18 };
    let from = 24;
    let to = 0;
    for (const r of inWeek) {
      const a = new Date(r.started_at);
      const b = new Date(r.ended_at ?? r.started_at);
      from = Math.min(from, a.getHours());
      to = Math.max(to, b.getHours() + (b.getMinutes() > 0 ? 1 : 0));
    }
    return { from: Math.max(0, from - 1), to: Math.min(24, Math.max(to + 1, from + 4)) };
  });

  onMount(() => void load());

  async function load() {
    loading = true;
    error = '';
    try {
      projects = await repo.list<ProjectNode>('Project', {
        fields: ['id', 'name', 'parent_id', 'clockify_project_id', 'clockify_fallback']
      });
      rows = await fetchRows();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (clockifyConfigured()) {
      try {
        const me = await clockifyMe();
        workspaceId = me.activeWorkspace;
        cProjects = await clockifyProjects(me.activeWorkspace);
      } catch {
        // A dead Clockify must not hide the list — assigning projects is
        // exactly what you would come here to do while it is down.
        workspaceId = null;
      }
    }
    loading = false;
  }

  async function fetchRows(): Promise<SessionRow[]> {
    if (filter === 'owed') return sessionsOwed();
    const from = filter === 'week' ? weekStart : new Date(2000, 0, 1);
    const to = new Date(from);
    if (filter === 'week') to.setDate(to.getDate() + 7);
    else to.setFullYear(to.getFullYear() + 100);
    return sessionsBetween(from.toISOString(), to.toISOString());
  }

  async function refresh() {
    loading = true;
    rows = await fetchRows().catch(() => rows);
    loading = false;
  }

  async function assign(r: SessionRow, projectId: number | null) {
    busyId = r.id;
    note = '';
    try {
      await assignSessionProject(r.id, projectId);
      r.project_id = projectId;
      // A corrected row that keeps its old error reads as still broken.
      if (r.push_status === 'failed' && targetOf(r, projects)) {
        await clearPushError(r.id);
        r.push_status = 'pending';
        r.push_error = null;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = null;
    }
  }

  async function push(r: SessionRow) {
    if (!workspaceId) return;
    busyId = r.id;
    note = '';
    const outcome = await pushSession(r as FocusSession, {
      workspaceId,
      projectIdFor: async (s) => targetOf(s as SessionRow, projects)?.clockifyId ?? null
    });
    note = `${r.description || 'Session'}: ${outcome}.`;
    rows = await fetchRows().catch(() => rows);
    busyId = null;
  }

  function mondayOf(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function shiftWeek(n: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + n * 7);
    weekStart = d;
    if (filter === 'week') void refresh();
  }
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const inShownWeek = (r: SessionRow) => {
    const t = new Date(r.started_at).getTime();
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    return t >= weekStart.getTime() && t < end.getTime();
  };
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`);
  const dayLabel = (k: string) =>
    new Date(k + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  /** Vertical placement inside the calendar column, in percent. */
  function place(r: SessionRow) {
    const a = new Date(r.started_at);
    const b = new Date(r.ended_at ?? r.started_at);
    const total = (span.to - span.from) * 60;
    const top = (a.getHours() * 60 + a.getMinutes() - span.from * 60) / total;
    const h = Math.max((b.getTime() - a.getTime()) / 60000 / total, 0.02);
    return `top:${Math.max(0, top) * 100}%; height:${Math.min(h, 1 - Math.max(0, top)) * 100}%`;
  }

  const SOURCE_LABEL: Record<string, string> = {
    session: 'set here',
    task: 'from task',
    inherited: 'inherited',
    fallback: 'catch-all'
  };
</script>

<svelte:head><title>Time · Tools</title></svelte:head>

<section class="space-y-4">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-xl font-semibold text-ink-900">Time</h1>
      <p class="text-sm text-ink-500">
        Every tracked stretch, and which Clockify project it lands on. Reassign anything that
        resolves nowhere or went to the catch-all.
      </p>
    </div>
    <a href="/settings/clockify" class="btn-ghost shrink-0">
      <Icon name="sparkles" size={14} /> Mapping
    </a>
  </header>

  {#if error}<p class="card p-3 text-sm text-tag-salesText">{error}</p>{/if}

  <div class="flex flex-wrap items-center gap-2">
    <div class="flex gap-1">
      {#each [{ v: 'owed', l: 'Owed' }, { v: 'week', l: 'This week' }, { v: 'all', l: 'All' }] as f (f.v)}
        <button
          class={filter === f.v ? 'btn-primary' : 'btn-ghost'}
          onclick={() => {
            filter = f.v as Filter;
            void refresh();
          }}>{f.l}</button>
      {/each}
    </div>
    <div class="ml-auto flex gap-1">
      <button class={view === 'list' ? 'btn-primary' : 'btn-ghost'} onclick={() => (view = 'list')}>
        <Icon name="list-checks" size={14} /> List
      </button>
      <button class={view === 'calendar' ? 'btn-primary' : 'btn-ghost'} onclick={() => (view = 'calendar')}>
        <Icon name="calendar" size={14} /> Calendar
      </button>
    </div>
  </div>

  {#if unattributed > 0}
    <p class="card p-3 text-sm text-ink-600">
      <strong class="text-ink-900">{unattributed}</strong> of {rows.length} stretches resolve to no
      Clockify project. Clockify refuses an entry without one, so these cannot push until you assign
      a project below — or set a catch-all under Mapping.
    </p>
  {/if}
  {#if note}<p class="text-xs text-ink-500">{note}</p>{/if}

  {#if loading}
    <p class="card p-4 text-sm text-ink-400">Loading…</p>
  {:else if rows.length === 0}
    <p class="card p-4 text-sm text-ink-400">
      {filter === 'owed' ? 'Nothing owed — every stretch has been pushed.' : 'No tracked time in this range.'}
    </p>
  {:else if view === 'list'}
    <div class="space-y-3">
      {#each byDay as [key, list] (key)}
        <div class="card">
          <div class="card-header">
            <span class="card-title">{dayLabel(key)}
              <span class="font-normal text-ink-300">
                {dur(list.reduce((n, r) => n + (r.seconds ?? 0), 0))}
              </span>
            </span>
          </div>
          <ul class="divide-y divide-surface-divider">
            {#each list as r (r.id)}
              {@const t = targetOf(r, projects)}
              <li class="space-y-2 px-4 py-3">
                <div class="flex flex-wrap items-baseline gap-2">
                  <span class="font-mono text-xs text-ink-400">
                    {hhmm(new Date(r.started_at))}–{r.ended_at ? hhmm(new Date(r.ended_at)) : '…'}
                  </span>
                  <span class="text-sm text-ink-900">{r.description || 'Work'}</span>
                  <span class="text-xs text-ink-400">{dur(r.seconds ?? 0)}</span>
                  <span
                    class="ml-auto rounded-full px-2 py-0.5 text-xs"
                    class:bg-surface-hover={r.push_status !== 'failed'}
                    class:text-ink-500={r.push_status !== 'failed'}
                    class:text-tag-salesText={r.push_status === 'failed'}
                  >{r.push_status}</span>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <select
                    class="input w-full sm:!w-auto sm:max-w-[60%]"
                    value={projectIdOfSession(r) ?? ''}
                    disabled={busyId === r.id || r.push_status === 'pushed'}
                    onchange={(e) =>
                      assign(r, Number((e.currentTarget as HTMLSelectElement).value) || null)}
                  >
                    <option value="">— no project —</option>
                    {#each assignable as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
                  </select>

                  {#if t}
                    <span class="text-xs text-ink-400">
                      → {cName.get(t.clockifyId) ?? t.clockifyId}
                      <span class="text-ink-300">({SOURCE_LABEL[t.source]})</span>
                    </span>
                  {:else}
                    <span class="text-xs text-tag-salesText">→ nowhere; cannot push</span>
                  {/if}

                  {#if r.push_status !== 'pushed'}
                    <button
                      class="btn-ghost ml-auto text-xs"
                      disabled={busyId === r.id || !workspaceId || !t}
                      onclick={() => push(r)}
                    >{busyId === r.id ? 'Pushing…' : 'Push'}</button>
                  {/if}
                </div>

                {#if r.push_error}
                  <p class="text-xs text-tag-salesText">{r.push_error}</p>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  {:else}
    <!-- Calendar. Blocks are positioned within the hours that actually contain
         work, so a mis-timed stretch stands out instead of being lost in an
         empty 24-hour grid. -->
    <div class="card p-3">
      <div class="mb-2 flex items-center gap-2">
        <button class="btn-ghost" onclick={() => shiftWeek(-1)} aria-label="Previous week">
          <Icon name="chevron-left" size={14} />
        </button>
        <span class="text-sm text-ink-900">
          {days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} –
          {days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </span>
        <button class="btn-ghost" onclick={() => shiftWeek(1)} aria-label="Next week">
          <Icon name="chevron-right" size={14} />
        </button>
        <button class="btn-ghost ml-auto text-xs" onclick={() => (weekStart = mondayOf(new Date()))}>
          This week
        </button>
      </div>

      <!-- pb-2: the last hour label is centred on the grid's bottom edge, so
           half of it falls outside without room to sit in. -->
      <div class="overflow-x-auto pb-2">
        <div class="flex min-w-[640px] gap-1">
          <!-- Hour gutter. The spacer is load-bearing: without a stand-in for
               the day-name row the labels sit 20px above the grid they label,
               and every block reads an hour late. -->
          <div class="w-10 shrink-0">
            <div class="mb-1 text-center text-xs" aria-hidden="true">&nbsp;</div>
            <div class="relative" style="height:{(span.to - span.from) * 44}px">
              {#each Array.from({ length: span.to - span.from + 1 }, (_, i) => span.from + i) as h (h)}
                <span
                  class="absolute -translate-y-1/2 text-right text-[10px] text-ink-300"
                  style="top:{((h - span.from) / (span.to - span.from)) * 100}%; right:2px"
                >{String(h).padStart(2, '0')}</span>
              {/each}
            </div>
          </div>

          {#each days as d (d.toISOString())}
            {@const key = dayKey(d)}
            {@const list = rows.filter((r) => dayKey(new Date(r.started_at)) === key)}
            <div class="min-w-0 flex-1">
              <div class="mb-1 truncate text-center text-xs text-ink-500">
                {d.toLocaleDateString('en-GB', { weekday: 'short' })}
                <span class="text-ink-300">{d.getDate()}</span>
              </div>
              <div
                class="relative rounded-lg bg-surface-hover"
                style="height:{(span.to - span.from) * 44}px"
              >
                {#each Array.from({ length: span.to - span.from }, (_, i) => i) as i (i)}
                  <div
                    class="absolute inset-x-0 border-t border-surface-divider"
                    style="top:{(i / (span.to - span.from)) * 100}%"
                  ></div>
                {/each}
                {#each list as r (r.id)}
                  {@const t = targetOf(r, projects)}
                  <!-- Solid accent = attributed. Pale with a red outline = needs
                       a project. tag-online and tag-onlineText are the same
                       colour, so text-white is what makes a block legible. -->
                  <button
                    class="absolute inset-x-0.5 overflow-hidden rounded px-1 text-left text-[10px] leading-tight"
                    class:bg-tag-online={!!t}
                    class:text-white={!!t}
                    class:bg-tag-sales={!t}
                    class:text-tag-salesText={!t}
                    class:ring-1={!t}
                    class:ring-tag-salesText={!t}
                    style={place(r)}
                    title={`${r.description || 'Work'} — ${dur(r.seconds ?? 0)} — ${
                      t ? (cName.get(t.clockifyId) ?? t.clockifyId) + ' (' + SOURCE_LABEL[t.source] + ')' : 'no project'
                    }`}
                    onclick={() => {
                      view = 'list';
                    }}
                  >
                    <span class="block truncate font-medium">{r.description || 'Work'}</span>
                    <span class="block truncate">
                      {t ? (pName.get(projectIdOfSession(r) ?? -1) ?? SOURCE_LABEL[t.source]) : 'unassigned'}
                    </span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
      <p class="mt-2 text-xs text-ink-400">
        Red blocks resolve to no Clockify project. Click any block to go to the list and assign it.
      </p>
    </div>
  {/if}
</section>
