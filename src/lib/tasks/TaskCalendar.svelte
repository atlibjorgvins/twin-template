<script lang="ts">
  // Tasks laid out by due date.
  //
  // Deliberately NOT src/lib/Calendar.svelte. That component is 3,685 lines,
  // takes only `initialDate`, loads its own `Dates` rows, and its KIND_OPTIONS
  // are kinds *within* that collection — it has no notion of a second source.
  // Teaching it one would mean surgery on the app's central calendar to render
  // a month grid, which is the small part of it. So this is a task-shaped grid
  // that borrows the conventions (Monday-first, ISO date keys) and nothing else.
  //
  // Undated tasks are shown in a tray under the grid rather than dropped. A
  // calendar that silently hides two thirds of your tasks is worse than no
  // calendar, and "no due date" is the most common state in the live data.
  import Icon from '$lib/Icon.svelte';
  import type { FocusTask } from '$lib/directus';

  let {
    tasks = [],
    projectName,
    onOpen
  }: {
    tasks?: FocusTask[];
    projectName?: Map<number, string>;
    onOpen?: (task: FocusTask) => void;
  } = $props();

  /** First of the displayed month. Local, not UTC — a UTC anchor shows the
   *  wrong month for anyone behind Greenwich for the first hours of a month. */
  let cursor = $state(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function iso(d: Date): string {
    // Built from local parts on purpose: toISOString() would shift the date
    // across midnight for negative offsets and mis-file tasks by a day.
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
  const todayIso = iso(new Date());

  function shift(months: number) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + months, 1);
  }
  function toThisMonth() {
    const n = new Date();
    cursor = new Date(n.getFullYear(), n.getMonth(), 1);
  }

  /** Six weeks of cells, Monday-first, so the grid height never jumps as you
   *  page through months. */
  const cells = $derived.by(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    // getDay(): 0 = Sunday. Monday-first offset.
    const lead = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(1 - lead);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return { date: d, key: iso(d), inMonth: d.getMonth() === cursor.getMonth() };
    });
  });

  const byDay = $derived.by(() => {
    const m = new Map<string, FocusTask[]>();
    for (const t of tasks) {
      if (!t.due_on) continue;
      const k = String(t.due_on).slice(0, 10);
      (m.get(k) ?? m.set(k, []).get(k)!).push(t);
    }
    return m;
  });

  const undated = $derived(tasks.filter((t) => !t.due_on && t.status !== 'done'));

  const monthCount = $derived(
    cells.filter((c) => c.inMonth).reduce((n, c) => n + (byDay.get(c.key)?.length ?? 0), 0)
  );

  function projectIdOf(t: FocusTask): number | null {
    const p = t.project_id;
    return p == null ? null : typeof p === 'object' ? p.id : Number(p);
  }
  function labelOf(t: FocusTask): string {
    const pid = projectIdOf(t);
    const proj = pid != null ? projectName?.get(pid) : null;
    return proj ? `${t.title ?? 'Untitled'} · ${proj}` : (t.title ?? 'Untitled');
  }
  function toneOf(t: FocusTask, dayKey: string): string {
    if (t.status === 'done') return 'tc-done';
    if (dayKey < todayIso) return 'tc-over';
    if (dayKey === todayIso) return 'tc-today';
    return '';
  }
</script>

<div class="tc">
  <header class="tc-bar">
    <button type="button" class="tc-nav" onclick={() => shift(-1)} aria-label="Previous month">
      <Icon name="chevron-left" size={14} />
    </button>
    <span class="tc-month">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</span>
    <button type="button" class="tc-nav" onclick={() => shift(1)} aria-label="Next month">
      <Icon name="chevron-right" size={14} />
    </button>
    <span class="tc-count">{monthCount} due</span>
    <button type="button" class="tc-today-btn" onclick={toThisMonth}>Today</button>
  </header>

  <div class="tc-dow" aria-hidden="true">
    {#each DOW as d (d)}<span>{d}</span>{/each}
  </div>

  <div class="tc-grid" role="grid" aria-label="Tasks by due date">
    {#each cells as c (c.key)}
      {@const rows = byDay.get(c.key) ?? []}
      <div
        class="tc-cell"
        class:tc-out={!c.inMonth}
        class:tc-is-today={c.key === todayIso}
        role="gridcell"
        aria-label="{c.key} — {rows.length} tasks"
      >
        <span class="tc-daynum">{c.date.getDate()}</span>
        {#each rows.slice(0, 3) as t (t.id)}
          <button
            type="button"
            class="tc-pill {toneOf(t, c.key)}"
            title={labelOf(t)}
            onclick={() => onOpen?.(t)}
          >{t.title ?? 'Untitled'}</button>
        {/each}
        {#if rows.length > 3}
          <span class="tc-more">+{rows.length - 3} more</span>
        {/if}
      </div>
    {/each}
  </div>

  {#if undated.length > 0}
    <section class="tc-tray">
      <h3 class="tc-tray-head">No due date · {undated.length}</h3>
      <div class="tc-tray-rows">
        {#each undated as t (t.id)}
          <button type="button" class="tc-pill" title={labelOf(t)} onclick={() => onOpen?.(t)}>
            {t.title ?? 'Untitled'}
          </button>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .tc-bar { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.6rem; }
  .tc-nav {
    display: inline-flex; padding: 0.25rem; border-radius: 8px;
    color: var(--text-secondary); cursor: pointer; background: none; border: 0;
  }
  .tc-nav:hover { background: var(--bg-tertiary); color: var(--text-primary); }
  .tc-month { font-weight: 600; font-size: 13px; min-width: 9.5rem; }
  .tc-count { font-size: 11px; color: var(--text-secondary); }
  .tc-today-btn {
    margin-left: auto; font-size: 11px; padding: 0.15rem 0.5rem; border-radius: 999px;
    background: var(--bg-tertiary); color: var(--text-secondary); cursor: pointer; border: 0;
  }
  .tc-today-btn:hover { color: var(--text-primary); }

  .tc-dow, .tc-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
  .tc-dow span {
    font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-secondary); text-align: center; padding-bottom: 0.2rem;
  }
  .tc-cell {
    min-height: 4.2rem;
    display: flex; flex-direction: column; gap: 1px;
    padding: 0.2rem;
    border-radius: 7px;
    background: var(--bg-tertiary);
    overflow: hidden;
  }
  .tc-out { opacity: 0.38; }
  .tc-is-today { outline: 1.5px solid var(--brand, #2f7d7d); outline-offset: -1.5px; }
  .tc-daynum { font-size: 9.5px; color: var(--text-secondary); line-height: 1.4; }

  .tc-pill {
    display: block; width: 100%;
    font-size: 9.5px; line-height: 1.45;
    text-align: left;
    padding: 0.05rem 0.25rem;
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 0;
    cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tc-pill:hover { background: color-mix(in srgb, var(--brand, #2f7d7d) 14%, var(--bg-primary)); }
  .tc-over { background: rgba(201, 59, 59, 0.16); color: #A32E2A; font-weight: 600; }
  .tc-today { background: rgba(198, 118, 42, 0.18); color: #8C5215; font-weight: 600; }
  .tc-done { opacity: 0.55; text-decoration: line-through; }
  .tc-more { font-size: 9px; color: var(--text-secondary); padding-left: 0.25rem; }

  .tc-tray { margin-top: 0.8rem; }
  .tc-tray-head {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-secondary); margin-bottom: 0.3rem;
  }
  .tc-tray-rows { display: flex; flex-wrap: wrap; gap: 0.25rem; }
  .tc-tray-rows .tc-pill { width: auto; max-width: 14rem; font-size: 10.5px; padding: 0.15rem 0.45rem; border-radius: 999px; background: var(--bg-tertiary); }
</style>
