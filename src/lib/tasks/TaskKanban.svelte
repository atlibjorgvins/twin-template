<script lang="ts">
  // Kanban over the focus tiers: backlog → queued → active → done.
  //
  // The columns are not invented for this board; they are the four values
  // focus_task.status already takes, so dragging a card is the same write
  // the focus tool's tier buttons make. A board with its own private notion
  // of columns would drift from the queue the moment either side changed.
  //
  // `active` is deliberately allowed more than one card even though the
  // focus tool runs one at a time — the board must show the truth, and if
  // two rows ever end up active you need to see that, not have it hidden.
  import Icon from '$lib/Icon.svelte';
  import { focusElapsed, type FocusTask, type FocusStatus } from '$lib/directus';

  let {
    tasks = [],
    projectName,
    onMove,
    onOpen
  }: {
    tasks?: FocusTask[];
    /** id → display name, so the card can show its project without a join. */
    projectName?: Map<number, string>;
    onMove: (task: FocusTask, status: FocusStatus) => void | Promise<void>;
    onOpen?: (task: FocusTask) => void;
  } = $props();

  const COLUMNS: { value: FocusStatus; label: string; tone: string }[] = [
    { value: 'backlog', label: 'Backlog', tone: '#5F6B7A' },
    { value: 'queued', label: 'Queued', tone: '#1D6BFE' },
    { value: 'active', label: 'Active', tone: '#1E9B55' },
    { value: 'done', label: 'Done', tone: '#8A93A0' }
  ];

  function parentIdOf(t: FocusTask): number | null {
    const p = t.parent_id;
    return p == null ? null : typeof p === 'object' ? p.id : Number(p);
  }
  function projectIdOf(t: FocusTask): number | null {
    const p = t.project_id;
    return p == null ? null : typeof p === 'object' ? p.id : Number(p);
  }

  const byColumn = $derived.by(() => {
    const m = new Map<string, FocusTask[]>(COLUMNS.map((c) => [c.value, []]));
    for (const t of tasks) {
      const k = String(t.status ?? 'queued');
      (m.get(k) ?? m.get('queued')!).push(t);
    }
    return m;
  });

  const today = new Date().toISOString().slice(0, 10);
  /** null when undated — undated is not overdue, and treating it as overdue
   *  would paint most of the board red. */
  function dueTone(t: FocusTask): 'over' | 'today' | 'soon' | null {
    const d = t.due_on;
    if (!d) return null;
    if (t.status === 'done') return null;
    if (d < today) return 'over';
    if (d === today) return 'today';
    return 'soon';
  }
  function shortDue(d: string): string {
    const [, m, day] = d.split('-');
    return `${Number(day)}/${Number(m)}`;
  }

  // ── Drag and drop ─────────────────────────────────────────────────────
  // HTML5 DnD, with click-to-advance as the accessible equivalent below —
  // a board that can only be driven by dragging is unusable by keyboard and
  // awkward on a phone.
  let dragId = $state<number | null>(null);
  let overColumn = $state<string | null>(null);

  function onDragStart(e: DragEvent, t: FocusTask) {
    dragId = t.id;
    e.dataTransfer?.setData('text/plain', String(t.id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  function onDrop(e: DragEvent, status: FocusStatus) {
    e.preventDefault();
    overColumn = null;
    const id = Number(e.dataTransfer?.getData('text/plain') ?? dragId);
    dragId = null;
    const t = tasks.find((x) => x.id === id);
    if (t && t.status !== status) void onMove(t, status);
  }

  /** Next tier along, for the keyboard/tap path. */
  function nextOf(s: string): FocusStatus | null {
    const i = COLUMNS.findIndex((c) => c.value === s);
    return i < 0 || i >= COLUMNS.length - 1 ? null : COLUMNS[i + 1].value;
  }
  function prevOf(s: string): FocusStatus | null {
    const i = COLUMNS.findIndex((c) => c.value === s);
    return i <= 0 ? null : COLUMNS[i - 1].value;
  }

  function fmtElapsed(t: FocusTask): string | null {
    const s = focusElapsed(t);
    if (!s) return null;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
</script>

<div class="kb" role="list" aria-label="Task board">
  {#each COLUMNS as col (col.value)}
    {@const rows = byColumn.get(col.value) ?? []}
    <section
      class="kb-col"
      class:kb-over={overColumn === col.value}
      role="listitem"
      aria-label="{col.label} — {rows.length} tasks"
      ondragover={(e) => { e.preventDefault(); overColumn = col.value; }}
      ondragleave={() => { if (overColumn === col.value) overColumn = null; }}
      ondrop={(e) => onDrop(e, col.value)}
    >
      <header class="kb-head">
        <span class="kb-dot" style="background: {col.tone};"></span>
        <span class="kb-title">{col.label}</span>
        <span class="kb-count">{rows.length}</span>
      </header>

      <div class="kb-body">
        {#each rows as t (t.id)}
          {@const tone = dueTone(t)}
          {@const pid = projectIdOf(t)}
          {@const el = fmtElapsed(t)}
          <article
            class="kb-card"
            class:kb-dragging={dragId === t.id}
            draggable="true"
            ondragstart={(e) => onDragStart(e, t)}
            ondragend={() => (dragId = null)}
          >
            <button
              type="button"
              class="kb-card-main"
              onclick={() => onOpen?.(t)}
              title={t.title ?? ''}
            >
              <span class="kb-card-title" class:kb-done={t.status === 'done'}>{t.title ?? 'Untitled'}</span>
              <span class="kb-meta">
                {#if tone}
                  <span class="kb-due kb-due-{tone}">
                    <Icon name="calendar" size={10} />{shortDue(t.due_on!)}
                  </span>
                {:else if t.due_on}
                  <span class="kb-due">{shortDue(t.due_on)}</span>
                {/if}
                {#if pid != null && projectName?.get(pid)}
                  <span class="kb-proj">{projectName.get(pid)}</span>
                {:else if t.asana_project_name}
                  <!-- Known Asana project but no twin project: the mapping is
                       missing, and saying which one makes it actionable. -->
                  <span class="kb-proj kb-proj-unmapped" title="No twin project — connect “{t.asana_project_name}” under Projects">
                    {t.asana_project_name} ?
                  </span>
                {/if}
                {#if el}<span class="kb-el">{el}</span>{/if}
                {#if parentIdOf(t) != null}<span class="kb-sub">subtask</span>{/if}
              </span>
            </button>
            <!-- Keyboard/tap equivalent of dragging. -->
            <span class="kb-nudge">
              {#if prevOf(String(t.status))}
                <button type="button" title="Move to {prevOf(String(t.status))}" aria-label="Move “{t.title}” to {prevOf(String(t.status))}" onclick={() => onMove(t, prevOf(String(t.status))!)}>
                  <Icon name="chevron-left" size={12} />
                </button>
              {/if}
              {#if nextOf(String(t.status))}
                <button type="button" title="Move to {nextOf(String(t.status))}" aria-label="Move “{t.title}” to {nextOf(String(t.status))}" onclick={() => onMove(t, nextOf(String(t.status))!)}>
                  <Icon name="chevron-right" size={12} />
                </button>
              {/if}
            </span>
          </article>
        {/each}

        {#if rows.length === 0}
          <p class="kb-empty">Nothing here.</p>
        {/if}
      </div>
    </section>
  {/each}
</div>

<style>
  /* Horizontal scroll rather than reflow: four columns squeezed into 375px
     are four unreadable slivers, and a board you scroll sideways is the
     familiar behaviour on a phone. */
  .kb {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(15rem, 1fr);
    gap: 0.75rem;
    overflow-x: auto;
    padding-bottom: 0.5rem;
    scroll-snap-type: x proximity;
  }
  .kb-col {
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    min-height: 8rem;
    border-radius: 12px;
    background: var(--bg-tertiary);
    border: 1px solid transparent;
    transition: border-color 150ms, background 150ms;
  }
  .kb-over {
    border-color: var(--brand, #2f7d7d);
    background: color-mix(in srgb, var(--brand, #2f7d7d) 7%, var(--bg-tertiary));
  }
  .kb-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.7rem;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
  }
  .kb-dot { width: 7px; height: 7px; border-radius: 999px; flex-shrink: 0; }
  .kb-title { font-weight: 600; }
  .kb-count { margin-left: auto; opacity: 0.7; }
  .kb-body { display: flex; flex-direction: column; gap: 0.4rem; padding: 0 0.5rem 0.6rem; }

  .kb-card {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 0.25rem;
    border-radius: 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border-subtle);
    cursor: grab;
  }
  .kb-dragging { opacity: 0.45; }
  .kb-card-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.5rem 0.55rem;
    text-align: left;
    cursor: pointer;
    background: none;
    border: 0;
  }
  .kb-card-title {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-primary);
    /* Wrap to three lines then clip: task titles here are full sentences in
       Icelandic and one-line truncation hid which task it was. */
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .kb-done { text-decoration: line-through; opacity: 0.6; }

  .kb-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; font-size: 10px; }
  .kb-due, .kb-proj, .kb-el, .kb-sub {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    border-radius: 999px;
    padding: 0.05rem 0.35rem;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kb-due-over { background: rgba(201, 59, 59, 0.14); color: #B3332F; font-weight: 600; }
  .kb-due-today { background: rgba(198, 118, 42, 0.16); color: #9A5A18; font-weight: 600; }
  .kb-proj-unmapped { border: 1px dashed var(--border-subtle); background: transparent; font-style: italic; }
  .kb-sub { opacity: 0.75; }

  .kb-nudge { display: flex; flex-direction: column; gap: 0.1rem; padding: 0.4rem 0.3rem 0.4rem 0; }
  .kb-nudge button {
    display: inline-flex;
    padding: 0.1rem;
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    background: none;
    border: 0;
  }
  .kb-nudge button:hover { background: var(--bg-tertiary); color: var(--text-primary); }
  .kb-empty { padding: 0.3rem 0.2rem 0.5rem; font-size: 11px; color: var(--text-secondary); opacity: 0.7; }
</style>
