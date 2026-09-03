<script lang="ts">
  // One task, everything about it, and every action that applies to it.
  //
  // Replaces deep-linking into /tools/focus. That page is a working queue —
  // it shows one active task and a list, so "open this task" landed you on a
  // page that never focused on the task you clicked. This is the record.
  //
  // Editing is inline and saves on blur rather than behind an Edit mode: with
  // one record on screen there is nothing to protect against, and a mode would
  // add a click to every change.
  import { onMount, onDestroy } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import {
    updateFocusTask,
    deleteFocusTask,
    createFocusTask,
    startFocusTask,
    completeFocusTask,
    reopenFocusTask,
    pushClosedTasksToAsana,
    getFocusTask,
    listFocusSubtasks,
    focusElapsed,
    formatError,
    type FocusTask,
    type FocusStatus,
    type Project
  } from '$lib/directus';
  import { asanaWebUrl, completeAsanaTask } from '$lib/asana';

  let {
    data
  }: {
    data: {
      task: FocusTask | null;
      subtasks: FocusTask[];
      projects: Pick<Project, 'id' | 'name' | 'parent_id'>[];
      error: string | null;
    };
  } = $props();

  let task = $state<FocusTask | null>(data.task);
  let subtasks = $state<FocusTask[]>([...data.subtasks]);
  let errorMsg = $state<string | null>(data.error);
  let notice = $state('');
  let busy = $state(false);

  // Live clock, only while something is actually running — a ticking interval
  // on a page showing a stopped task is pure waste.
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    timer = setInterval(() => (now = Date.now()), 1000);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  const STATUSES: FocusStatus[] = ['backlog', 'queued', 'active', 'done'];

  function idOf(v: unknown): number | null {
    if (v == null) return null;
    return typeof v === 'object' ? ((v as { id?: number }).id ?? null) : Number(v);
  }
  const projectId = $derived(idOf(task?.project_id));
  const parentId = $derived(idOf(task?.parent_id));
  const parentTitle = $derived(
    task?.parent_id && typeof task.parent_id === 'object'
      ? ((task.parent_id as { title?: string | null }).title ?? `#${parentId}`)
      : parentId != null ? `#${parentId}` : null
  );
  const projectName = $derived(new Map(data.projects.map((p) => [p.id, p.name ?? `#${p.id}`])));

  const projectOptions = $derived.by(() => {
    const byParent = new Map<number | null, typeof data.projects>();
    for (const p of data.projects) {
      const k = idOf(p.parent_id);
      (byParent.get(k) ?? byParent.set(k, []).get(k)!).push(p);
    }
    const out: { id: number; label: string }[] = [];
    const seen = new Set<number>();
    const walk = (parent: number | null, depth: number) => {
      for (const p of byParent.get(parent) ?? []) {
        if (seen.has(p.id)) continue;   // cycle guard
        seen.add(p.id);
        out.push({ id: p.id, label: `${'— '.repeat(depth)}${p.name ?? `#${p.id}`}` });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  const isDone = $derived(task?.status === 'done');
  const isRunning = $derived(task?.status === 'active' && !!task?.started_at);
  /** Elapsed includes the live segment while running, so the number on screen
   *  matches what Stop would bank. */
  const elapsed = $derived.by(() => {
    if (!task) return 0;
    void now;
    return focusElapsed(task);
  });
  function fmtDuration(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  function fmtDate(v?: string | null): string {
    if (!v) return '—';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const dueTone = $derived.by(() => {
    if (!task?.due_on || isDone) return '';
    if (task.due_on < todayIso) return 'td-over';
    if (task.due_on === todayIso) return 'td-today';
    return '';
  });

  /** Closed here and Asana not told yet. */
  const pendingPush = $derived(
    !!task && task.status === 'done' && task.closed_by === 'twin' &&
    task.source === 'asana' && !!task.source_ref
  );

  async function run(fn: () => Promise<unknown>) {
    if (busy) return false;
    busy = true;
    errorMsg = null;
    try {
      await fn();
      task = await getFocusTask(task!.id);
      subtasks = await listFocusSubtasks(task.id).catch(() => subtasks);
      return true;
    } catch (e) {
      errorMsg = formatError(e);
      return false;
    } finally {
      busy = false;
    }
  }

  /** Only writes when the value actually changed — blur fires on every tab
   *  through a field, and a no-op PATCH would bump date_updated for nothing. */
  async function saveField(patch: Partial<FocusTask>, changed: boolean) {
    if (!changed || !task) return;
    await run(() => updateFocusTask(task!.id, patch));
  }

  async function setStatus(s: FocusStatus) {
    if (!task) return;
    if (s === 'done') await run(() => completeFocusTask(task!.id, { source: task!.source }));
    else if (task.status === 'done') await run(() => reopenFocusTask(task!.id, s));
    else if (s === 'active') await run(() => startFocusTask(task!.id));
    else await run(() => updateFocusTask(task!.id, { status: s }));
  }

  async function push() {
    if (!task) return;
    const res = await (async () => {
      const r = await pushClosedTasksToAsana([task!], completeAsanaTask);
      return r;
    })();
    task = await getFocusTask(task.id);
    notice = res.pushed
      ? 'Closed in Asana.'
      : `Could not reach Asana — still queued, so this can be retried. ${res.firstError ?? ''}`;
  }

  let subDraft = $state('');
  async function addSubtask() {
    const title = subDraft.trim();
    if (!title || !task) return;
    const ok = await run(() =>
      createFocusTask({
        title,
        // A subtask of a parked task starts parked; of anything else, queued.
        status: task!.status === 'backlog' ? 'backlog' : 'queued',
        parent_id: task!.id,
        project_id: projectId ?? null
      })
    );
    if (ok) subDraft = '';
  }

  async function removeTask() {
    if (!task) return;
    const kids = subtasks.length;
    const warning = kids > 0
      ? `Delete "${task.title}" and orphan its ${kids} subtask${kids === 1 ? '' : 's'}?`
      : `Delete "${task.title}"?`;
    if (!confirm(warning)) return;
    try {
      await deleteFocusTask(task.id);
      location.href = '/tasks';
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  const doneSubs = $derived(subtasks.filter((s) => s.status === 'done').length);
</script>

<svelte:head><title>{task?.title ?? 'Task'} · Hub</title></svelte:head>

<div class="mx-auto w-full max-w-3xl p-4">
  <a href="/tasks" class="td-back"><Icon name="chevron-left" size={13} /> Tasks</a>

  {#if errorMsg}
    <p class="td-err">{errorMsg}</p>
  {/if}

  {#if !task}
    {#if !errorMsg}<p class="text-sm text-ink-400">No such task.</p>{/if}
  {:else}
    <!-- Title is the page heading AND the edit field. A separate read-only
         heading plus an input below would show the same string twice. -->
    <textarea
      class="td-title"
      value={task.title ?? ''}
      rows="1"
      aria-label="Task title"
      onblur={(e) => {
        const v = (e.currentTarget as HTMLTextAreaElement).value.trim();
        saveField({ title: v || null }, v !== (task!.title ?? ''));
      }}
    ></textarea>

    <div class="td-chips">
      <span class="td-chip td-status-{task.status}">{task.status}</span>
      {#if task.due_on}
        <span class="td-chip {dueTone}"><Icon name="calendar" size={11} /> {task.due_on}</span>
      {/if}
      {#if projectId != null}
        <a class="td-chip td-chip-link" href={`/projects/${projectId}`}>
          <Icon name="sparkles" size={11} /> {projectName.get(projectId) ?? `#${projectId}`}
        </a>
      {:else if task.asana_project_name}
        <span class="td-chip td-chip-dashed" title="Asana project with no twin project connected">
          {task.asana_project_name} ?
        </span>
      {/if}
      {#if parentId != null}
        <a class="td-chip td-chip-link" href={`/tasks/${parentId}`}>
          <Icon name="chevron-left" size={11} /> {parentTitle}
        </a>
      {/if}
      {#if task.source === 'asana' && task.source_ref}
        <a class="td-chip td-chip-link" href={asanaWebUrl(task.source_ref)} target="_blank" rel="noopener noreferrer">
          Asana <Icon name="arrow-right" size={10} />
        </a>
      {/if}
      {#if pendingPush}
        <button class="td-chip td-chip-push" onclick={push} disabled={busy}>
          not in Asana yet — push
        </button>
      {/if}
    </div>

    {#if notice}<p class="td-note">{notice}</p>{/if}

    <!-- Actions first: on a task record the question is almost always "what do
         I do with this", not "what are its metadata". -->
    <section class="card td-actions">
      {#if isRunning}
        <span class="td-running"><Icon name="bolt" size={13} /> Running · {fmtDuration(elapsed)}</span>
      {:else if elapsed > 0}
        <span class="td-elapsed">{fmtDuration(elapsed)} logged</span>
      {/if}
      <div class="td-btns">
        {#if !isDone}
          {#if !isRunning}
            <button class="btn-ghost text-xs" onclick={() => setStatus('active')} disabled={busy}>
              <Icon name="bolt" size={13} /> Start
            </button>
          {/if}
          <button class="btn-primary" onclick={() => setStatus('done')} disabled={busy}>
            <Icon name="check" size={13} /> Mark done
          </button>
        {:else}
          <button class="btn-ghost text-xs" onclick={() => setStatus('queued')} disabled={busy}>
            Reopen
          </button>
        {/if}
      </div>
    </section>

    <!-- Fields -->
    <section class="card td-fields">
      <label class="td-field">
        <span>Status</span>
        <select value={task.status} onchange={(e) => setStatus((e.currentTarget as HTMLSelectElement).value as FocusStatus)} disabled={busy}>
          {#each STATUSES as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      </label>

      <label class="td-field">
        <span>Due</span>
        <input
          type="date"
          value={task.due_on ?? ''}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value || null;
            saveField({ due_on: v }, v !== (task!.due_on ?? null));
          }}
        />
      </label>

      <label class="td-field">
        <span>Project</span>
        <select
          value={projectId ?? ''}
          onchange={(e) => {
            const raw = (e.currentTarget as HTMLSelectElement).value;
            const v = raw === '' ? null : Number(raw);
            saveField({ project_id: v }, v !== projectId);
          }}
        >
          <option value="">— none —</option>
          {#each projectOptions as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
        </select>
      </label>

      <label class="td-field td-field-wide">
        <span>Notes</span>
        <textarea
          rows="4"
          value={task.notes ?? ''}
          placeholder="Anything worth remembering about this task."
          onblur={(e) => {
            const v = (e.currentTarget as HTMLTextAreaElement).value;
            saveField({ notes: v || null }, v !== (task!.notes ?? ''));
          }}
        ></textarea>
      </label>
    </section>

    <!-- Subtasks -->
    <section class="card td-subs">
      <header class="td-subs-head">
        <span class="td-subs-title">Subtasks</span>
        {#if subtasks.length > 0}<span class="td-subs-n">{doneSubs}/{subtasks.length} done</span>{/if}
      </header>
      {#if subtasks.length > 0}
        <ul class="td-sub-list">
          {#each subtasks as s (s.id)}
            <li>
              <input
                type="checkbox"
                class="td-sub-check"
                checked={s.status === 'done'}
                aria-label={s.status === 'done' ? `Reopen ${s.title}` : `Mark ${s.title} done`}
                disabled={busy}
                onchange={(e) =>
                  run(() =>
                    (e.currentTarget as HTMLInputElement).checked
                      ? completeFocusTask(s.id, { source: s.source })
                      : reopenFocusTask(s.id)
                  )}
              />
              <a href={`/tasks/${s.id}`} class="td-sub-title" class:td-struck={s.status === 'done'}>
                {s.title ?? 'Untitled'}
              </a>
              {#if s.due_on}<span class="td-sub-due">{s.due_on}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
      <div class="td-sub-add">
        <input
          type="text"
          bind:value={subDraft}
          placeholder="Add a subtask…"
          onkeydown={(e) => { if (e.key === 'Enter') addSubtask(); }}
        />
        <button class="btn-ghost text-xs" onclick={addSubtask} disabled={busy || !subDraft.trim()}>
          <Icon name="plus" size={12} /> Add
        </button>
      </div>
    </section>

    <!-- Everything else. Read-only because it is either system-managed or
         Asana's to change; showing it as an editable field would imply twin
         is the source of truth for it. -->
    <section class="card td-meta">
      <span class="td-meta-head">Record</span>
      <dl>
        <div><dt>Source</dt><dd>{task.source ?? 'manual'}</dd></div>
        {#if task.source_ref}<div><dt>Asana task</dt><dd class="td-mono">{task.source_ref}</dd></div>{/if}
        {#if task.asana_project_name || task.asana_project_gid}
          <div><dt>Asana project</dt><dd>{task.asana_project_name ?? '—'} {#if task.asana_project_gid}<span class="td-mono">({task.asana_project_gid})</span>{/if}</dd></div>
        {/if}
        <div>
          <dt>Closed by</dt>
          <dd>
            {#if task.closed_by === 'twin'}twin — waiting to reach Asana
            {:else if task.closed_by === 'synced'}twin — pushed to Asana
            {:else if isDone}Asana (mirrored in)
            {:else}—{/if}
          </dd>
        </div>
        <div><dt>Time logged</dt><dd>{elapsed > 0 ? fmtDuration(elapsed) : '—'}</dd></div>
        <div><dt>Queue position</dt><dd>{task.sort ?? '—'}</dd></div>
        <div><dt>Created</dt><dd>{fmtDate(task.date_created)}</dd></div>
        <div><dt>Updated</dt><dd>{fmtDate(task.date_updated)}</dd></div>
        <div><dt>Id</dt><dd class="td-mono">{task.id}</dd></div>
      </dl>
    </section>

    <button class="td-delete" onclick={removeTask} disabled={busy}>
      <Icon name="x" size={12} /> Delete task
    </button>
  {/if}
</div>

<style>
  .td-back {
    display: inline-flex; align-items: center; gap: 0.2rem;
    font-size: 12px; color: var(--text-secondary); margin-bottom: 0.75rem;
  }
  .td-back:hover { color: var(--brand, #2f7d7d); }
  .td-err {
    margin-bottom: 0.75rem; border-radius: 10px; padding: 0.5rem 0.7rem;
    font-size: 12px; background: rgba(201,59,59,0.1); color: #B3332F;
  }
  .td-note {
    margin-bottom: 0.75rem; border-radius: 10px; padding: 0.4rem 0.6rem;
    font-size: 11px; background: var(--bg-tertiary); color: var(--text-secondary);
  }

  /* A textarea rather than an input so a long Icelandic title wraps instead of
     scrolling sideways out of view. field-sizing keeps it one line until it
     needs two. */
  .td-title {
    width: 100%;
    font-family: inherit;
    font-size: 21px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-primary);
    background: none;
    border: 0;
    border-radius: 8px;
    padding: 0.15rem 0.3rem;
    margin: 0 0 0.6rem -0.3rem;
    resize: none;
    field-sizing: content;
    overflow: hidden;
  }
  .td-title:hover { background: var(--bg-tertiary); }
  .td-title:focus { outline: 2px solid var(--brand, #2f7d7d); outline-offset: 0; background: var(--bg-tertiary); }

  .td-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.9rem; }
  .td-chip {
    display: inline-flex; align-items: center; gap: 0.25rem;
    border-radius: 999px; padding: 0.12rem 0.5rem;
    font-size: 11px; font-weight: 500;
    background: var(--bg-tertiary); color: var(--text-secondary);
    border: 1px solid transparent;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .td-chip-link:hover { color: var(--brand, #2f7d7d); border-color: color-mix(in srgb, var(--brand, #2f7d7d) 30%, transparent); }
  .td-chip-dashed { border: 1px dashed var(--border-subtle); background: transparent; font-style: italic; }
  .td-chip-push { cursor: pointer; background: rgba(29,107,254,0.13); color: #1D5FD8; font-weight: 600; }
  .td-status-active { background: rgba(30,155,85,0.16); color: #147640; font-weight: 600; }
  .td-status-done { background: var(--bg-tertiary); color: var(--text-secondary); }
  .td-over { background: rgba(201,59,59,0.14); color: #B3332F; font-weight: 600; }
  .td-today { background: rgba(198,118,42,0.16); color: #9A5A18; font-weight: 600; }

  .td-actions {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem;
    padding: 0.7rem 0.85rem; margin-bottom: 0.75rem;
  }
  .td-running { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 12px; font-weight: 600; color: #147640; }
  .td-elapsed { font-size: 12px; color: var(--text-secondary); }
  .td-btns { display: flex; gap: 0.4rem; margin-left: auto; }

  .td-fields { padding: 0.85rem; margin-bottom: 0.75rem; display: grid; gap: 0.7rem; }
  @media (min-width: 640px) { .td-fields { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .td-field { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
  .td-field-wide { grid-column: 1 / -1; }
  .td-field > span {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--text-secondary);
  }
  .td-field select, .td-field input, .td-field textarea {
    width: 100%; font-family: inherit; font-size: 12.5px;
    padding: 0.35rem 0.45rem; border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-tertiary); color: var(--text-primary);
  }
  .td-field textarea { resize: vertical; line-height: 1.5; }

  .td-subs { padding: 0.85rem; margin-bottom: 0.75rem; }
  .td-subs-head { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.5rem; }
  .td-subs-title { font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
  .td-subs-n { font-size: 10px; color: var(--text-secondary); }
  .td-sub-list { display: flex; flex-direction: column; }
  .td-sub-list li {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.35rem 0; border-top: 1px solid var(--border-subtle); font-size: 12.5px;
  }
  .td-sub-check { width: 14px; height: 14px; cursor: pointer; accent-color: var(--brand, #2f7d7d); }
  .td-sub-title { flex: 1; min-width: 0; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .td-sub-title:hover { color: var(--brand, #2f7d7d); }
  .td-struck { text-decoration: line-through; opacity: 0.6; }
  .td-sub-due { font-size: 10px; color: var(--text-secondary); }
  .td-sub-add { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
  .td-sub-add input {
    flex: 1; font-size: 12.5px; padding: 0.3rem 0.45rem;
    border-radius: 8px; border: 1px solid var(--border-subtle);
    background: var(--bg-tertiary); color: var(--text-primary);
  }

  .td-meta { padding: 0.85rem; margin-bottom: 0.75rem; }
  .td-meta-head {
    display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-secondary); margin-bottom: 0.4rem;
  }
  .td-meta dl { display: grid; gap: 0.1rem; }
  .td-meta div { display: flex; gap: 0.6rem; padding: 0.2rem 0; font-size: 11.5px; border-top: 1px solid var(--border-subtle); }
  .td-meta dt { min-width: 8rem; color: var(--text-secondary); }
  .td-meta dd { color: var(--text-primary); min-width: 0; overflow-wrap: anywhere; }
  .td-mono { font-family: ui-monospace, monospace; font-size: 11px; }

  .td-delete {
    display: inline-flex; align-items: center; gap: 0.3rem;
    font-size: 11px; color: var(--text-secondary); cursor: pointer;
    background: none; border: 0; padding: 0.3rem 0;
  }
  .td-delete:hover { color: #B3332F; }
</style>
