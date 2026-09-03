<script lang="ts">
  // "Actively working on" — front-page card. Shows the active focus task
  // with a live timer + Stop / Next, or a prompt to start the next queued
  // one. Self-loading so the Today page just drops in <FocusCard />.
  import { onMount, onDestroy } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import {
    listFocusTasks,
    startFocusTask,
    stopFocusTask,
    nextFocusTask,
    focusElapsed,
    type FocusTask
  } from '$lib/directus';

  let active = $state<FocusTask | null>(null);
  let queuedCount = $state(0);
  let loaded = $state(false);
  let busy = $state(false);
  let now = $state(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const tasks = await listFocusTasks();
      active = tasks.find((t) => t.status === 'active') ?? null;
      queuedCount = tasks.filter((t) => t.status === 'queued').length;
    } catch {
      active = null;
      queuedCount = 0;
    } finally {
      loaded = true;
    }
  }
  onMount(() => {
    void refresh();
    timer = setInterval(() => (now = Date.now()), 1000);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  // `now` is referenced so the timer re-derives every second.
  const elapsed = $derived.by(() => {
    void now;
    return active ? focusElapsed(active) : 0;
  });
  function fmt(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return (h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
  }
  function projName(t: FocusTask): string | null {
    return typeof t.project_id === 'object' ? (t.project_id?.name ?? null) : null;
  }
  function parentTitle(t: FocusTask): string | null {
    return typeof t.parent_id === 'object' ? (t.parent_id?.title ?? null) : null;
  }

  async function stop() {
    if (!active) return;
    busy = true;
    try {
      await stopFocusTask(active.id);
      await refresh();
    } finally {
      busy = false;
    }
  }
  async function next() {
    busy = true;
    try {
      await nextFocusTask();
      await refresh();
    } finally {
      busy = false;
    }
  }
  async function startNext() {
    busy = true;
    try {
      const tasks = await listFocusTasks();
      const q = tasks.find((t) => t.status === 'queued');
      if (q) await startFocusTask(q.id);
      await refresh();
    } finally {
      busy = false;
    }
  }
</script>

{#if loaded && (active || queuedCount > 0)}
  <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
    <div class="mb-2 flex items-center gap-2">
      <span class="inline-flex h-7 w-7 items-center justify-center rounded-full" style="background: var(--accent-electric); color: var(--accent-text);">
        <Icon name="bolt" size={14} />
      </span>
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Actively working on</span>
      <a href="/tools/focus" class="ml-auto text-[11px] text-ink-400 hover:text-ink-700">Queue · {queuedCount}</a>
    </div>

    {#if active}
      <div class="flex items-center gap-3">
        <div class="min-w-0 flex-1">
          {#if parentTitle(active)}<div class="truncate text-[10px] text-ink-400">{parentTitle(active)} ›</div>{/if}
          <a href="/tools/focus" class="block truncate text-base font-semibold text-ink-900 hover:underline">{active.title}</a>
          <div class="text-[11px] text-ink-500">
            {#if projName(active)}{projName(active)} · {/if}<span class="tabular-nums">{fmt(elapsed)}</span>
          </div>
        </div>
        <button class="btn-ghost text-xs" disabled={busy} onclick={stop}>Stop</button>
        <button class="btn-primary text-xs" disabled={busy || queuedCount === 0} onclick={next}>Next →</button>
      </div>
    {:else}
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm text-ink-500">Nothing active — {queuedCount} queued.</span>
        <button class="btn-primary text-xs" disabled={busy} onclick={startNext}>Start next</button>
      </div>
    {/if}
  </div>
{/if}
