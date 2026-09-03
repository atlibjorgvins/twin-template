<script lang="ts">
  // "Actively working on" — focus queue with a backlog tier and subtasks.
  // Tiers: backlog (parked) → queue (committed) → active (one, timed) →
  // done. Tasks can have subtasks (child tasks) that live in the queue
  // too and are started / timed individually. Manual for now — no Asana.
  import { onMount, onDestroy } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import {
    createFocusTask,
    updateFocusTask,
    deleteFocusTask,
    startFocusTask,
    stopFocusTask,
    nextFocusTask,
    reorderFocusTasks,
    setFocusStatus,
    focusElapsed,
    formatError,
    type FocusTask,
    type FocusStatus,
    type Project
  } from '$lib/directus';

  let { data }: { data: { tasks: FocusTask[]; projects: Pick<Project, 'id' | 'name' | 'parent_id'>[]; error: string | null } } = $props();

  let tasks = $state<FocusTask[]>([...data.tasks]);
  let errorMsg = $state<string | null>(data.error);
  let busy = $state(false);
  let newTitle = $state('');
  let expanded = $state<number | null>(null);
  let subDraft = $state<Record<number, string>>({});
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    timer = setInterval(() => (now = Date.now()), 1000);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  function parentIdOf(t: FocusTask): number | null {
    return typeof t.parent_id === 'object' ? (t.parent_id?.id ?? null) : (t.parent_id ?? null);
  }
  const active = $derived(tasks.find((t) => t.status === 'active') ?? null);
  const topQueue = $derived(tasks.filter((t) => parentIdOf(t) == null && t.status === 'queued'));
  const topBacklog = $derived(tasks.filter((t) => parentIdOf(t) == null && t.status === 'backlog'));
  // Non-active children of a parent (the active one shows up top).
  function childrenOf(pid: number): FocusTask[] {
    return tasks.filter((t) => parentIdOf(t) === pid && t.status !== 'active');
  }

  // Indented project options for the picker.
  const projectOptions = $derived.by(() => {
    const byParent = new Map<number | null, typeof data.projects>();
    for (const p of data.projects) {
      const parent = p.parent_id as number | { id: number } | null;
      const k = parent == null ? null : typeof parent === 'object' ? parent.id : Number(parent);
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(p);
    }
    const out: { id: number; label: string }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const p of byParent.get(parent) ?? []) {
        out.push({ id: p.id, label: `${'  '.repeat(depth)}${p.name ?? `#${p.id}`}` });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });
  const projName = $derived(new Map(data.projects.map((p) => [p.id, p.name ?? `#${p.id}`])));
  function projectIdOf(t: FocusTask): number | null {
    return typeof t.project_id === 'object' ? (t.project_id?.id ?? null) : (t.project_id ?? null);
  }
  function parentTitle(t: FocusTask): string | null {
    return typeof t.parent_id === 'object' ? (t.parent_id?.title ?? null) : null;
  }

  function fmt(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return (h > 0 ? `${h}h ` : '') + `${m}m ${String(s).padStart(2, '0')}s`;
  }
  const elapsedOf = (t: FocusTask) => {
    void now;
    return focusElapsed(t);
  };

  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    busy = true;
    errorMsg = null;
    try {
      await fn();
      return true;
    } catch (e) {
      errorMsg = formatError(e);
      return false;
    } finally {
      busy = false;
    }
  }
  async function reload() {
    const { listFocusTasks } = await import('$lib/directus');
    tasks = await listFocusTasks();
  }

  async function add(status: FocusStatus) {
    const title = newTitle.trim();
    if (!title) return;
    if (await run(() => createFocusTask({ title, status }))) {
      newTitle = '';
      await reload();
    }
  }
  async function addSubtask(parent: FocusTask) {
    const title = (subDraft[parent.id] ?? '').trim();
    if (!title) return;
    const status: FocusStatus = parent.status === 'backlog' ? 'backlog' : 'queued';
    if (await run(() => createFocusTask({ title, parent_id: parent.id, status }))) {
      subDraft = { ...subDraft, [parent.id]: '' };
      await reload();
    }
  }
  async function start(t: FocusTask) {
    if (await run(() => startFocusTask(t.id))) await reload();
  }
  async function stop(t: FocusTask) {
    if (await run(() => stopFocusTask(t.id))) await reload();
  }
  async function goNext() {
    if (await run(() => nextFocusTask())) await reload();
  }
  async function setTier(t: FocusTask, status: FocusStatus) {
    if (await run(() => setFocusStatus(t.id, status))) await reload();
  }
  async function remove(t: FocusTask) {
    const kids = childrenOf(t.id).length;
    if (!confirm(`Delete "${t.title}"${kids ? ` and its ${kids} subtask${kids === 1 ? '' : 's'}` : ''}?`)) return;
    if (await run(() => deleteFocusTask(t.id))) await reload();
  }
  async function saveDetails(t: FocusTask, patch: Partial<FocusTask>) {
    if (await run(() => updateFocusTask(t.id, patch))) {
      tasks = tasks.map((x) => (x.id === t.id ? { ...x, ...patch } : x));
    }
  }
  async function move(t: FocusTask, dir: -1 | 1) {
    const ids = topQueue.map((q) => q.id);
    const i = ids.indexOf(t.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    if (await run(() => reorderFocusTasks(ids))) await reload();
  }
</script>

<svelte:head><title>Actively working on · Tools</title></svelte:head>

{#snippet taskRow(t: FocusTask, tier: 'queue' | 'backlog', isSub: boolean, i: number, count: number)}
  <div class="flex items-center gap-2 py-2 {isSub ? 'pl-7' : ''}">
    {#if !isSub && tier === 'queue'}
      <div class="flex flex-col">
        <button class="text-ink-300 hover:text-ink-700 disabled:opacity-30" disabled={i === 0 || busy} onclick={() => move(t, -1)} aria-label="Move up"><Icon name="chevron-left" size={12} class="rotate-90" /></button>
        <button class="text-ink-300 hover:text-ink-700 disabled:opacity-30" disabled={i === count - 1 || busy} onclick={() => move(t, 1)} aria-label="Move down"><Icon name="chevron-right" size={12} class="rotate-90" /></button>
      </div>
    {:else if isSub}
      <span class="text-ink-300">↳</span>
    {/if}
    <button class="min-w-0 flex-1 text-left" onclick={() => (expanded = expanded === t.id ? null : t.id)}>
      <span class="block truncate {isSub ? 'text-sm text-ink-800' : 'font-medium text-ink-900'}">{t.title}</span>
      <span class="text-[11px] text-ink-500">
        {#if projectIdOf(t) != null}{projName.get(projectIdOf(t)!)}{/if}
        {#if focusElapsed(t) > 0}{projectIdOf(t) != null ? ' · ' : ''}{fmt(focusElapsed(t))}{/if}
        {#if !isSub && childrenOf(t.id).length}{(projectIdOf(t) != null || focusElapsed(t) > 0) ? ' · ' : ''}{childrenOf(t.id).length} subtasks{/if}
      </span>
    </button>
    <button class="btn-primary !py-1 text-xs" disabled={busy} onclick={() => start(t)}>Start</button>
    {#if !isSub}
      {#if tier === 'queue'}
        <button class="text-ink-300 hover:text-ink-700" disabled={busy} onclick={() => setTier(t, 'backlog')} title="Move to backlog" aria-label="Move to backlog"><Icon name="chevron-right" size={14} class="rotate-90" /></button>
      {:else}
        <button class="text-ink-300 hover:text-ink-700" disabled={busy} onclick={() => setTier(t, 'queued')} title="Promote to queue" aria-label="Promote to queue"><Icon name="chevron-left" size={14} class="rotate-90" /></button>
      {/if}
    {/if}
    <button class="text-ink-300 hover:text-tag-salesText" disabled={busy} onclick={() => remove(t)} aria-label="Delete"><Icon name="x" size={14} /></button>
  </div>
  {#if expanded === t.id}
    <div class="space-y-2 pb-3 {isSub ? 'pl-7' : ''}" style="background: var(--bg-secondary);">
      <label class="block">
        <span class="mb-1 block text-xs text-ink-500">Project</span>
        <select
          class="input w-full text-sm"
          value={projectIdOf(t) != null ? String(projectIdOf(t)) : ''}
          onchange={(e) => saveDetails(t, { project_id: (e.currentTarget as HTMLSelectElement).value ? Number((e.currentTarget as HTMLSelectElement).value) : null })}
        >
          <option value="">— none —</option>
          {#each projectOptions as p (p.id)}<option value={String(p.id)}>{p.label}</option>{/each}
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-xs text-ink-500">Notes</span>
        <textarea class="input w-full text-sm" rows="2" value={t.notes ?? ''} onblur={(e) => saveDetails(t, { notes: (e.currentTarget as HTMLTextAreaElement).value || null })} placeholder="Details…"></textarea>
      </label>
      {#if !isSub}
        <div>
          <span class="mb-1 block text-xs text-ink-500">Subtasks</span>
          <div class="flex items-center gap-2">
            <input
              class="input w-full text-sm"
              placeholder="Add a subtask…"
              value={subDraft[t.id] ?? ''}
              oninput={(e) => (subDraft = { ...subDraft, [t.id]: (e.currentTarget as HTMLInputElement).value })}
              onkeydown={(e) => { if (e.key === 'Enter') addSubtask(t); }}
            />
            <button class="btn-ghost text-xs" disabled={busy || !(subDraft[t.id] ?? '').trim()} onclick={() => addSubtask(t)}>Add</button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

<section class="mx-auto max-w-2xl space-y-5">
  <header>
    <div class="hero-eyebrow"><a href="/tools" class="hover:underline">Tools</a></div>
    <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">Actively working on</h1>
    <p class="mt-1 text-sm text-ink-500">Backlog → queue → active. Start a task to run its timer; add subtasks; the active one shows on Today.</p>
  </header>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 text-sm" style="color: #C0392B;">{errorMsg}</div>
  {/if}

  <!-- Add -->
  <div class="flex flex-wrap items-center gap-2 rounded-[14px] border border-surface-border bg-surface-card p-3">
    <input
      class="input min-w-0 flex-1 text-sm"
      placeholder="What are you working on?"
      bind:value={newTitle}
      onkeydown={(e) => { if (e.key === 'Enter') add('queued'); }}
    />
    <button class="btn-primary text-sm" disabled={busy || !newTitle.trim()} onclick={() => add('queued')}>Add to queue</button>
    <button class="btn-ghost text-sm" disabled={busy || !newTitle.trim()} onclick={() => add('backlog')}>Backlog</button>
  </div>

  <!-- Active -->
  {#if active}
    <div class="rounded-[14px] border-2 bg-surface-card p-4" style="border-color: var(--accent-electric);">
      <div class="mb-1 font-display text-[10px] uppercase tracking-wider" style="color: var(--accent-electric);">Active</div>
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          {#if parentTitle(active)}<div class="truncate text-[11px] text-ink-400">{parentTitle(active)} ›</div>{/if}
          <div class="truncate text-lg font-semibold text-ink-900">{active.title}</div>
          <div class="text-xs text-ink-500">
            {#if projectIdOf(active) != null}{projName.get(projectIdOf(active)!)} · {/if}
            <span class="tabular-nums">{fmt(elapsedOf(active))}</span>
          </div>
        </div>
        <button class="btn-ghost text-sm" disabled={busy} onclick={() => stop(active)}>Stop</button>
        <button class="btn-primary text-sm" disabled={busy || topQueue.length === 0} onclick={goNext}>Next →</button>
      </div>
    </div>
  {/if}

  <!-- Queue -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card px-4 py-3">
    <div class="flex items-center justify-between">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Queue</span>
      <span class="text-xs text-ink-500">{topQueue.length}</span>
    </div>
    {#if topQueue.length === 0}
      <p class="pt-2 text-sm text-ink-400">Nothing queued. Add a task or promote one from the backlog.</p>
    {:else}
      <ul class="mt-1 divide-y divide-surface-divider">
        {#each topQueue as t, i (t.id)}
          <li>
            {@render taskRow(t, 'queue', false, i, topQueue.length)}
            {#each childrenOf(t.id) as c (c.id)}
              {@render taskRow(c, 'queue', true, 0, 0)}
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- Backlog -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card px-4 py-3">
    <div class="flex items-center justify-between">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Backlog</span>
      <span class="text-xs text-ink-500">{topBacklog.length}</span>
    </div>
    {#if topBacklog.length === 0}
      <p class="pt-2 text-sm text-ink-400">Backlog is empty. Capture ideas here with “Backlog”, promote them when ready.</p>
    {:else}
      <ul class="mt-1 divide-y divide-surface-divider">
        {#each topBacklog as t, i (t.id)}
          <li>
            {@render taskRow(t, 'backlog', false, i, topBacklog.length)}
            {#each childrenOf(t.id) as c (c.id)}
              {@render taskRow(c, 'backlog', true, 0, 0)}
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
