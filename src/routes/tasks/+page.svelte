<script lang="ts">
  // Tasks — the overview. Board / Calendar / List over the same focus_task
  // rows the focus tool runs, plus the Asana⇄twin project connections.
  //
  // This is the *overseeing* surface; /tools/focus stays the *doing* surface
  // (one active task, live timer, subtasks). They share the collection, so a
  // card dragged to Active here is the task the focus timer picks up.
  import Icon from '$lib/Icon.svelte';
  import TaskKanban from '$lib/tasks/TaskKanban.svelte';
  import TaskCalendar from '$lib/tasks/TaskCalendar.svelte';
  import TaskList from '$lib/tasks/TaskList.svelte';
  import AsanaProjectLinks from '$lib/tasks/AsanaProjectLinks.svelte';
  import {
    setFocusStatus,
    completeFocusTask,
    reopenFocusTask,
    pushClosedTasksToAsana,
    listAllFocusTasks,
    applyAsanaProjectLinks,
    formatError,
    type FocusTask,
    type FocusStatus,
    type AsanaProjectLink,
    type Project
  } from '$lib/directus';
  import { getAsanaTaskProjects, completeAsanaTask } from '$lib/asana';

  let {
    data
  }: {
    data: {
      tasks: FocusTask[];
      projects: Pick<Project, 'id' | 'name' | 'parent_id'>[];
      links: AsanaProjectLink[];
      error: string | null;
    };
  } = $props();

  let tasks = $state<FocusTask[]>([...data.tasks]);
  let links = $state<AsanaProjectLink[]>([...data.links]);
  let errorMsg = $state<string | null>(data.error);
  let notice = $state('');
  let applying = $state(false);

  type View = 'list' | 'board' | 'calendar' | 'projects';
  // List first, and the default: it is the only view that answers "what is due
  // and what do I do next" without scrolling or interpretation.
  let view = $state<View>('list');

  const VIEWS: { value: View; label: string; icon: 'list-checks' | 'sliders' | 'calendar' | 'sparkles' }[] = [
    { value: 'list', label: 'List', icon: 'list-checks' },
    { value: 'board', label: 'Board', icon: 'sliders' },
    { value: 'calendar', label: 'Calendar', icon: 'calendar' },
    { value: 'projects', label: 'Projects', icon: 'sparkles' }
  ];

  const projectName = $derived(new Map(data.projects.map((p) => [p.id, p.name ?? `#${p.id}`])));

  const open = $derived(tasks.filter((t) => t.status !== 'done'));
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdue = $derived(open.filter((t) => t.due_on && t.due_on < todayIso).length);
  const dueToday = $derived(open.filter((t) => t.due_on === todayIso).length);
  const unassigned = $derived(open.filter((t) => !t.project_id).length);

  /** Asana projects seen on tasks with no twin project — what needs connecting,
   *  ranked by how many tasks it would fix. */
  const suggestions = $derived.by(() => {
    const m = new Map<string, { gid: string | null; name: string; count: number }>();
    for (const t of tasks) {
      if (t.project_id || t.status === 'done') continue;
      const name = t.asana_project_name;
      if (!name) continue;
      const hit = m.get(name);
      if (hit) { hit.count++; if (!hit.gid && t.asana_project_gid) hit.gid = t.asana_project_gid; }
      else m.set(name, { gid: t.asana_project_gid ?? null, name, count: 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  });

  async function move(t: FocusTask, status: FocusStatus) {
    const before = t.status;
    const beforeClosedBy = t.closed_by ?? null;
    // Optimistic: the board should respond to a drag immediately, and a failed
    // write puts the card back rather than leaving it where it never landed.
    // Mirror completeFocusTask exactly: only an asana-sourced task gets 'twin',
    // or the optimistic row would claim a push is pending that never happens.
    const nextClosedBy =
      status === 'done'
        ? (t.source === 'asana' ? 'twin' : beforeClosedBy)
        : before === 'done' ? null : beforeClosedBy;
    tasks = tasks.map((x) => (x.id === t.id ? { ...x, status, closed_by: nextClosedBy } : x));
    try {
      // Moving to Done must go through completeFocusTask, not setFocusStatus:
      // the latter leaves closed_by NULL, which the outbox reads as "closed in
      // Asana, never push" — so a card dragged to Done would stay open in
      // Asana forever. Moving OUT of Done clears the flag for the same reason.
      if (status === 'done') await completeFocusTask(t.id, { source: t.source });
      else if (before === 'done') await reopenFocusTask(t.id, status);
      else await setFocusStatus(t.id, status);
    } catch (e) {
      tasks = tasks.map((x) =>
        x.id === t.id ? { ...x, status: before, closed_by: beforeClosedBy } : x
      );
      errorMsg = formatError(e);
    }
  }

  /** List-view checkbox. Same writes as the board, one call site. */
  async function toggleDone(t: FocusTask, done: boolean) {
    await move(t, done ? 'done' : 'queued');
  }

  // ── Getting closures back to Asana ────────────────────────────────────
  // closed_by is an outbox: 'twin' means closed here and not yet pushed.
  // Surfacing the count makes the divergence visible instead of letting twin
  // and Asana quietly disagree.
  const pendingPush = $derived(
    tasks.filter(
      (t) => t.status === 'done' && t.closed_by === 'twin' && t.source === 'asana' && t.source_ref
    )
  );
  let pushing = $state(false);

  async function pushToAsana() {
    if (pushing || pendingPush.length === 0) return;
    pushing = true;
    notice = '';
    errorMsg = null;
    try {
      const res = await pushClosedTasksToAsana([...pendingPush], completeAsanaTask);
      tasks = await listAllFocusTasks();
      const bits: string[] = [];
      if (res.pushed) bits.push(`${res.pushed} closed in Asana`);
      if (res.failed) bits.push(`${res.failed} failed`);
      if (res.skipped) bits.push(`${res.skipped} not tried`);
      notice = bits.join(' · ') || 'Nothing to push.';
      if (res.failed > 0) {
        // Nothing is lost on failure — they stay queued. Say that, so a failed
        // push does not look like lost work.
        notice += ` — still queued, so this can be retried. ${res.firstError ?? ''}`;
      }
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      pushing = false;
    }
  }

  function openTask(t: FocusTask) {
    // The task's own record. This used to deep-link to /tools/focus, which is a
    // working queue — clicking a task landed you on a page that showed the
    // whole list and never singled out the one you clicked.
    location.href = `/tasks/${t.id}`;
  }

  /** `override` comes from the connect form, which knows the saved link before
   *  `bind:links` has propagated here. */
  async function applyLinks(override?: AsanaProjectLink[]) {
    applying = true;
    notice = '';
    errorMsg = null;
    try {
      const res = await applyAsanaProjectLinks(tasks, override ?? links, getAsanaTaskProjects);
      tasks = await listAllFocusTasks();
      const bits: string[] = [];
      if (res.assigned) bits.push(`${res.assigned} assigned`);
      if (res.resolved) bits.push(`${res.resolved} looked up in Asana`);
      if (res.unmatched) bits.push(`${res.unmatched} with no matching link`);
      if (res.failed) bits.push(`${res.failed} couldn’t be read from Asana`);
      if (res.skipped) bits.push(`${res.skipped} not tried`);
      notice = bits.length > 0 ? bits.join(' · ') : 'Nothing to change.';
      // Name the actual cause once, instead of leaving a row of failure counts
      // that look like a data problem when they are one missing credential.
      if (res.failed > 0 || res.skipped > 0) {
        notice += ' — Asana lookups need a token in the “Asana API proxy” Flow; cached matches still applied.';
      }
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      applying = false;
    }
  }
</script>

<svelte:head><title>Tasks · Hub</title></svelte:head>

<div class="mx-auto w-full max-w-5xl p-4">
  <header class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
    <h1 class="font-display text-2xl font-semibold text-ink-900">Tasks</h1>
    <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span class="tk-stat">{open.length} open</span>
      {#if overdue > 0}<span class="tk-stat tk-stat-over">{overdue} overdue</span>{/if}
      {#if dueToday > 0}<span class="tk-stat tk-stat-today">{dueToday} due today</span>{/if}
      {#if unassigned > 0}<span class="tk-stat">{unassigned} without a project</span>{/if}
      {#if pendingPush.length > 0}
        <button class="tk-stat tk-stat-push" onclick={pushToAsana} disabled={pushing}
          title="Closed here but not yet closed in Asana — click to push">
          <Icon name="arrow-right" size={10} />
          {pushing ? 'Pushing…' : `${pendingPush.length} to close in Asana`}
        </button>
      {/if}
    </div>
    <a href="/tools/focus" class="btn-ghost ml-auto text-xs">
      <Icon name="bolt" size={13} /> Focus timer
    </a>
  </header>

  <nav class="tk-tabs" aria-label="Task views">
    {#each VIEWS as v (v.value)}
      <button
        type="button"
        class="tk-tab"
        class:tk-tab-on={view === v.value}
        aria-current={view === v.value ? 'page' : undefined}
        onclick={() => (view = v.value)}
      >
        <Icon name={v.icon} size={13} />
        {v.label}
        {#if v.value === 'projects' && links.length > 0}<span class="tk-tab-n">{links.length}</span>{/if}
      </button>
    {/each}
  </nav>

  {#if errorMsg}
    <p class="mb-3 rounded-[10px] px-3 py-2 text-xs" style="background: rgba(201,59,59,0.1); color: #B3332F;">{errorMsg}</p>
  {/if}
  {#if notice}
    <p class="mb-3 rounded-[10px] px-3 py-2 text-xs" style="background: var(--bg-tertiary); color: var(--text-secondary);">{notice}</p>
  {/if}

  <section class="card p-4">
    {#if view === 'board'}
      <TaskKanban tasks={tasks} {projectName} onMove={move} onOpen={openTask} />
    {:else if view === 'calendar'}
      <TaskCalendar tasks={tasks} {projectName} onOpen={openTask} />
    {:else if view === 'list'}
      <TaskList tasks={tasks} {projectName} onOpen={openTask} onToggleDone={toggleDone} />
    {:else}
      <div class="mb-3 flex items-center gap-2">
        <h2 class="text-sm font-medium text-ink-900">Asana → twin projects</h2>
        <!-- Wrapped, not passed directly: onclick hands the handler a MouseEvent,
             which would arrive as `override` and be used as the link list. -->
        <button class="btn-ghost ml-auto text-xs" onclick={() => applyLinks()} disabled={applying}>
          <Icon name="bolt" size={12} /> {applying ? 'Applying…' : 'Apply to existing tasks'}
        </button>
      </div>
      <AsanaProjectLinks
        bind:links
        projects={data.projects}
        {suggestions}
        onApply={applyLinks}
      />
    {/if}
  </section>

  {#if tasks.length === 0 && !errorMsg}
    <p class="mt-3 text-sm text-ink-400">
      No tasks yet. They arrive from Asana, or add one in the
      <a href="/tools/focus" class="underline">focus tool</a>.
    </p>
  {/if}
</div>

<style>
  .tk-stat {
    display: inline-flex; align-items: center; border-radius: 999px;
    padding: 0.1rem 0.5rem; background: var(--bg-tertiary); color: var(--text-secondary);
  }
  .tk-stat-over { background: rgba(201,59,59,0.14); color: #B3332F; font-weight: 600; }
  .tk-stat-today { background: rgba(198,118,42,0.16); color: #9A5A18; font-weight: 600; }
  .tk-stat-push {
    gap: 0.2rem;
    background: rgba(29,107,254,0.13);
    color: #1D5FD8;
    font-weight: 600;
    cursor: pointer;
    border: 0;
  }
  .tk-stat-push:hover:not(:disabled) { background: rgba(29,107,254,0.2); }
  .tk-stat-push:disabled { cursor: default; opacity: 0.7; }

  .tk-tabs {
    display: flex; gap: 0.25rem; margin-bottom: 0.75rem;
    overflow-x: auto; padding-bottom: 2px;
  }
  .tk-tab {
    display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap;
    font-size: 12px; padding: 0.3rem 0.65rem; border-radius: 999px;
    background: var(--bg-tertiary); color: var(--text-secondary);
    border: 1px solid transparent; cursor: pointer;
  }
  .tk-tab:hover { color: var(--text-primary); }
  .tk-tab-on {
    background: color-mix(in srgb, var(--brand, #2f7d7d) 14%, transparent);
    border-color: color-mix(in srgb, var(--brand, #2f7d7d) 35%, transparent);
    color: var(--brand, #2f7d7d);
    font-weight: 600;
  }
  .tk-tab-n { font-size: 10px; opacity: 0.75; }

  /* At 375px the four tabs needed 326px against 311px available — clipped by
     15px, which put "Projects" half off the edge and made the strip look
     broken rather than scrollable. Trimming the horizontal padding recovers
     ~19px, so all four fit with the icons and full labels intact. */
  @media (max-width: 400px) {
    .tk-tabs { gap: 0.15rem; }
    .tk-tab { padding-left: 0.45rem; padding-right: 0.45rem; gap: 0.25rem; }
  }
</style>
