<script lang="ts">
  // The "oversee everything" view: one row per task, sortable, with the dates
  // and context that let you decide what to do next.
  //
  // Sorted by due date ASCENDING with undated LAST by default. Sorting undated
  // rows as if they were epoch-0 would bury every real deadline under tasks
  // that have no deadline at all.
  import Icon from '$lib/Icon.svelte';
  import type { FocusTask } from '$lib/directus';
  import { asanaWebUrl } from '$lib/asana';

  let {
    tasks = [],
    projectName,
    onOpen,
    onToggleDone
  }: {
    tasks?: FocusTask[];
    projectName?: Map<number, string>;
    onOpen?: (task: FocusTask) => void;
    /** Close or reopen. The parent owns the write so twin, Asana and the
     *  other views stay in step. */
    onToggleDone?: (task: FocusTask, done: boolean) => void | Promise<void>;
  } = $props();

  type SortKey = 'due' | 'title' | 'status' | 'project';
  let sortKey = $state<SortKey>('due');
  let sortAsc = $state(true);
  let showDone = $state(false);
  let q = $state('');

  const STATUS_ORDER: Record<string, number> = { active: 0, queued: 1, backlog: 2, done: 3 };
  const todayIso = new Date().toISOString().slice(0, 10);

  function projectIdOf(t: FocusTask): number | null {
    const p = t.project_id;
    return p == null ? null : typeof p === 'object' ? p.id : Number(p);
  }
  function projLabel(t: FocusTask): string {
    const pid = projectIdOf(t);
    if (pid != null && projectName?.get(pid)) return projectName.get(pid)!;
    return '';
  }

  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    let rows = tasks.filter((t) => (showDone ? true : t.status !== 'done'));
    if (needle) {
      rows = rows.filter((t) =>
        `${t.title ?? ''} ${projLabel(t)} ${t.asana_project_name ?? ''}`.toLowerCase().includes(needle)
      );
    }
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'due') {
        // Undated always last, whichever direction — they are not "far future"
        // or "long past", they are absent, and absent has no place in a
        // deadline ordering.
        const ad = a.due_on ?? '', bd = b.due_on ?? '';
        if (!ad && !bd) return (a.title ?? '').localeCompare(b.title ?? '');
        if (!ad) return 1;
        if (!bd) return -1;
        return ad < bd ? -dir : ad > bd ? dir : 0;
      }
      if (sortKey === 'status') {
        const av = STATUS_ORDER[String(a.status)] ?? 9, bv = STATUS_ORDER[String(b.status)] ?? 9;
        return (av - bv) * dir;
      }
      if (sortKey === 'project') return projLabel(a).localeCompare(projLabel(b)) * dir;
      return (a.title ?? '').localeCompare(b.title ?? '') * dir;
    });
  });

  function sortBy(k: SortKey) {
    if (sortKey === k) sortAsc = !sortAsc;
    else { sortKey = k; sortAsc = true; }
  }

  function dueClass(t: FocusTask): string {
    if (!t.due_on || t.status === 'done') return '';
    if (t.due_on < todayIso) return 'tl-over';
    if (t.due_on === todayIso) return 'tl-today';
    return '';
  }
  function dueText(t: FocusTask): string {
    if (!t.due_on) return '—';
    const d = t.due_on.slice(0, 10);
    if (d === todayIso) return 'Today';
    // Day count is the useful unit here; a bare date makes you do the
    // arithmetic yourself for every row.
    const days = Math.round((new Date(d).getTime() - new Date(todayIso).getTime()) / 86400000);
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    if (days < 0) return `${Math.abs(days)}d late`;
    if (days <= 14) return `in ${days}d`;
    return d;
  }

  const overdueCount = $derived(
    tasks.filter((t) => t.due_on && t.status !== 'done' && t.due_on < todayIso).length
  );

  /** Which row is mid-write, so its checkbox can't be double-fired. */
  let busyId = $state<number | null>(null);
  async function toggle(t: FocusTask, done: boolean) {
    if (!onToggleDone || busyId === t.id) return;
    busyId = t.id;
    try {
      await onToggleDone(t, done);
    } finally {
      busyId = null;
    }
  }
</script>

<div class="tl">
  <div class="tl-tools">
    <label class="tl-search">
      <Icon name="search" size={13} />
      <input type="search" placeholder="Filter tasks…" bind:value={q} aria-label="Filter tasks" />
    </label>
    <label class="tl-toggle">
      <input type="checkbox" bind:checked={showDone} />
      Show done
    </label>
    {#if overdueCount > 0}
      <span class="tl-overdue">{overdueCount} overdue</span>
    {/if}
    <!-- Sorting lives in the header row, which is hidden below 640px because
         six columns do not fit. Without this, narrow screens lost sorting
         entirely — so the control moves here rather than disappearing. -->
    <label class="tl-sortby">
      <span class="tl-sr">Sort by</span>
      <select
        value={`${sortKey}:${sortAsc ? 'asc' : 'desc'}`}
        onchange={(e) => {
          const [k, dir] = (e.currentTarget as HTMLSelectElement).value.split(':');
          sortKey = k as SortKey;
          sortAsc = dir === 'asc';
        }}
      >
        <option value="due:asc">Due ↑</option>
        <option value="due:desc">Due ↓</option>
        <option value="title:asc">Task A–Z</option>
        <option value="status:asc">Status</option>
        <option value="project:asc">Project</option>
      </select>
    </label>
    <span class="tl-total">{shown.length} shown</span>
  </div>

  <div class="tl-scroll">
    <table class="tl-table">
      <thead>
        <tr>
          <th class="tl-th-check"><span class="tl-sr">Done</span></th>
          {#each [['title','Task'],['project','Project'],['status','Status'],['due','Due']] as [k, label] (k)}
            <th>
              <button type="button" onclick={() => sortBy(k as SortKey)} aria-label="Sort by {label}">
                {label}
                {#if sortKey === k}<span class="tl-caret">{sortAsc ? '▲' : '▼'}</span>{/if}
              </button>
            </th>
          {/each}
          <th class="tl-th-src"><span>Source</span></th>
        </tr>
      </thead>
      <tbody>
        {#each shown as t (t.id)}
          <tr class:tl-row-done={t.status === 'done'}>
            <td class="tl-cell-check">
              <!-- A real checkbox, not a styled div: it is the one control on
                   this row that must be reachable by keyboard and announce its
                   own state. Label carries the task title so a screen reader
                   says which task is being closed. -->
              <input
                type="checkbox"
                class="tl-check"
                checked={t.status === 'done'}
                disabled={!onToggleDone || busyId === t.id}
                aria-label={t.status === 'done' ? `Reopen ${t.title ?? 'task'}` : `Mark ${t.title ?? 'task'} done`}
                title={t.status === 'done' ? 'Reopen' : 'Mark done'}
                onchange={(e) => toggle(t, (e.currentTarget as HTMLInputElement).checked)}
              />
            </td>
            <td class="tl-cell-title">
              <button type="button" class="tl-title" onclick={() => onOpen?.(t)}>{t.title ?? 'Untitled'}</button>
              {#if t.closed_by === 'twin'}
                <!-- Closed here, Asana not told yet. Saying so beats letting
                     the two quietly disagree. -->
                <span class="tl-pending" title="Closed in twin — not pushed to Asana yet">not in Asana yet</span>
              {/if}
            </td>
            <td class="tl-cell-muted tl-cell-project">
              {#if projLabel(t)}
                {projLabel(t)}
              {:else if t.asana_project_name}
                <span class="tl-unmapped" title="No twin project — connect “{t.asana_project_name}” under Projects">{t.asana_project_name} ?</span>
              {:else}
                <span class="tl-dash">—</span>
              {/if}
            </td>
            <td class="tl-cell-status"><span class="tl-status tl-status-{t.status}">{t.status}</span></td>
            <td class="tl-due tl-cell-due {dueClass(t)}">{dueText(t)}</td>
            <td class="tl-cell-muted tl-cell-source">
              {#if t.source === 'asana' && t.source_ref}
                <a href={asanaWebUrl(t.source_ref)} target="_blank" rel="noopener noreferrer" class="tl-src">
                  Asana <Icon name="arrow-right" size={10} />
                </a>
              {:else}
                {t.source ?? 'manual'}
              {/if}
            </td>
          </tr>
        {/each}
        {#if shown.length === 0}
          <tr><td colspan="6" class="tl-empty">No tasks match.</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .tl-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem; font-size: 11px; }
  .tl-search {
    display: inline-flex; align-items: center; gap: 0.3rem;
    background: var(--bg-tertiary); border-radius: 999px; padding: 0.2rem 0.6rem;
    color: var(--text-secondary); flex: 1; min-width: 9rem; max-width: 18rem;
  }
  .tl-search input { background: none; border: 0; outline: none; font-size: 12px; color: var(--text-primary); width: 100%; }
  .tl-toggle { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--text-secondary); cursor: pointer; }
  /* Redundant on wide screens, where the sortable headers are visible. */
  .tl-sortby select {
    font-size: 11px; padding: 0.15rem 0.35rem; border-radius: 999px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-tertiary); color: var(--text-secondary);
  }
  @media (min-width: 640px) { .tl-sortby { display: none; } }
  .tl-overdue { border-radius: 999px; padding: 0.1rem 0.45rem; background: rgba(201,59,59,0.14); color: #B3332F; font-weight: 600; }
  .tl-total { margin-left: auto; color: var(--text-secondary); }

  .tl-scroll { overflow-x: auto; }
  .tl-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .tl-table th { text-align: left; padding: 0 0.5rem 0.35rem; }
  .tl-table th button {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--text-secondary); cursor: pointer; background: none; border: 0; padding: 0;
  }
  .tl-table th button:hover { color: var(--text-primary); }
  .tl-th-src span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-secondary); }
  .tl-caret { font-size: 8px; }
  .tl-table td { padding: 0.4rem 0.5rem; border-top: 1px solid var(--border-subtle); vertical-align: top; }
  .tl-row-done { opacity: 0.55; }
  .tl-row-done .tl-title { text-decoration: line-through; }

  .tl-title {
    text-align: left; font-weight: 500; color: var(--text-primary);
    cursor: pointer; background: none; border: 0; padding: 0;
    max-width: 22rem;
  }
  .tl-title:hover { color: var(--brand, #2f7d7d); }
  .tl-cell-muted { color: var(--text-secondary); }
  .tl-unmapped { font-style: italic; opacity: 0.85; }

  .tl-status {
    display: inline-block; border-radius: 999px; padding: 0.05rem 0.4rem;
    font-size: 10px; background: var(--bg-tertiary); color: var(--text-secondary);
  }
  .tl-status-active { background: rgba(30,155,85,0.16); color: #147640; font-weight: 600; }
  .tl-status-queued { background: rgba(29,107,254,0.13); color: #1D5FD8; }

  .tl-due { white-space: nowrap; color: var(--text-secondary); }
  .tl-over { color: #B3332F; font-weight: 600; }
  .tl-today { color: #9A5A18; font-weight: 600; }
  .tl-th-check { width: 1.6rem; }
  .tl-cell-check { width: 1.6rem; padding-right: 0; }
  .tl-check { width: 15px; height: 15px; cursor: pointer; accent-color: var(--brand, #2f7d7d); }
  .tl-check:disabled { cursor: default; opacity: 0.5; }
  /* Visually hidden but announced — the column needs a name for screen
     readers without putting a redundant word in the header row. */
  .tl-sr {
    position: absolute; width: 1px; height: 1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
  }
  .tl-pending {
    display: inline-block; margin-left: 0.35rem;
    border-radius: 999px; padding: 0 0.35rem;
    font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    background: rgba(198, 118, 42, 0.16); color: #8C5215;
    vertical-align: 1px;
  }
  .tl-src { display: inline-flex; align-items: center; gap: 0.2rem; color: var(--text-secondary); }
  .tl-src:hover { color: var(--brand, #2f7d7d); }
  .tl-empty { text-align: center; color: var(--text-secondary); padding: 1.2rem; }

  /* ── Narrow screens ───────────────────────────────────────────────────
     Six columns needed 544px inside a 277px scroller at 375px wide, which
     pushed Due — the field the whole view exists to show — to x=455, fully
     off-screen behind a horizontal scroll. So below 640px the row stops
     being a table row and reflows to two lines:

        [✓]  Task title, wrapping
             project · status · due · source

     flex-wrap does the work: the checkbox and title fill line one, the four
     meta cells wrap together onto line two and sit inline. The table
     returns intact at 640px and up, where it measured fine. */
  @media (max-width: 639px) {
    .tl-table, .tl-table tbody { display: block; }
    .tl-table thead { display: none; }
    /* The indent belongs to the ROW, not to the first meta cell. Hanging it off
       .tl-cell-project made the meta line start 7px further left on rows that
       have a project than on rows that don't, because the empty cell still
       carried the margin while a filled one began its text at it. Padding the
       row and pulling the checkbox out of flow indents title and meta by the
       same amount on every row, whichever meta values happen to exist. */
    .tl-table tr {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.2rem 0.45rem;
      padding: 0.5rem 0 0.5rem 1.65rem;
      border-top: 1px solid var(--border-subtle);
    }
    .tl-table td { display: block; border-top: 0; padding: 0; }
    .tl-cell-check {
      position: absolute;
      left: 0;
      top: 0.6rem;
      width: auto;
    }
    .tl-cell-title { flex: 1 1 100%; min-width: 0; }
    .tl-title { max-width: 100%; white-space: normal; }
    .tl-cell-project, .tl-cell-status, .tl-cell-due, .tl-cell-source {
      flex: 0 0 auto;
      font-size: 10.5px;
    }
    /* An em dash for "no project" is noise on a line of real values — but
       hiding only the dash left the cell as a zero-width flex item that still
       contributed a 0.45rem gap, so rows without a project started their meta
       8px right of rows with one. Collapsing the whole cell removes the slot
       and the gap with it. */
    .tl-cell-project:has(.tl-dash) { display: none; }
    .tl-empty { text-align: left; padding: 0.9rem 0; }
  }
</style>
