<script lang="ts">
  import { onDestroy } from 'svelte';
  import { parseSchedule, todayAt, type Slot } from '$lib/scheduleTimer/parse';

  type Props = {
    initialSchedule?: string;
    storageKey?: string;
    onSlotChange?: (slot: Slot | null) => void;
  };
  let {
    initialSchedule = '',
    storageKey = 'scheduleTimer.v1',
    onSlotChange
  }: Props = $props();

  const SAMPLE = `13:30 - 13:40Sól5613:40 - 13:50sól 7713:50 - 14:00Sól514:00 - 14:10SOL3014:10 - 14:20Sól7014:20 - 14:30Sól 73Pása14:40 - 14:50Sól414:50 - 15:00Sól1815:00 - 15:10Sól 8415:10 - 15:20Sól 9315:20 - 15:30Sól 53`;

  // ─── State ─────────────────────────────────────────────────────────────
  let raw = $state<string>('');
  let slots = $state<Slot[]>([]);
  let now = $state<Date>(new Date());
  let editing = $state(false);
  let parseError = $state('');

  // Initial load: prop > localStorage > sample
  function initialRaw(): string {
    if (initialSchedule && initialSchedule.trim()) return initialSchedule;
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(storageKey);
      if (saved && saved.trim()) return saved;
    }
    return SAMPLE;
  }

  $effect(() => {
    const r = initialRaw();
    raw = r;
    slots = parseSchedule(r);
  });

  // ─── Tick loop (1Hz) ───────────────────────────────────────────────────
  const interval = setInterval(() => {
    now = new Date();
  }, 1000);
  onDestroy(() => clearInterval(interval));

  // ─── Active-slot detection + onSlotChange callback ─────────────────────
  const activeIndex = $derived.by(() => {
    const t = now.getTime();
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const start = todayAt(s.start, now).getTime();
      const end = todayAt(s.end, now).getTime();
      if (t >= start && t < end) return i;
    }
    return -1;
  });

  let lastSlotKey = $state<string | null>(null);
  $effect(() => {
    const cur = activeIndex >= 0 ? slots[activeIndex] : null;
    const key = cur ? `${cur.start}|${cur.end}|${cur.label}` : null;
    if (key !== lastSlotKey) {
      lastSlotKey = key;
      onSlotChange?.(cur);
    }
  });

  const nextIndex = $derived.by(() => {
    const t = now.getTime();
    for (let i = 0; i < slots.length; i++) {
      if (todayAt(slots[i].start, now).getTime() > t) return i;
    }
    return -1;
  });

  // ─── Derived display values ────────────────────────────────────────────
  function pad(n: number): string {
    return n.toString().padStart(2, '0');
  }

  const wallClock = $derived(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);

  const remaining = $derived.by(() => {
    if (activeIndex >= 0) {
      const end = todayAt(slots[activeIndex].end, now).getTime();
      const ms = Math.max(0, end - now.getTime());
      return { ms, label: 'remaining' as const };
    }
    if (nextIndex >= 0) {
      const start = todayAt(slots[nextIndex].start, now).getTime();
      const ms = Math.max(0, start - now.getTime());
      return { ms, label: 'until next' as const };
    }
    return { ms: 0, label: 'done' as const };
  });

  const remainingDisplay = $derived.by(() => {
    if (remaining.label === 'done') return '—';
    const totalSec = Math.floor(remaining.ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${pad(m)}:${pad(s)}`;
  });

  const remainingShortLabel = $derived(
    remaining.label === 'remaining'
      ? 'Time remaining'
      : remaining.label === 'until next'
        ? 'Until next slot'
        : 'Done'
  );

  const progressPct = $derived.by(() => {
    if (activeIndex < 0) return 0;
    const s = slots[activeIndex];
    const start = todayAt(s.start, now).getTime();
    const end = todayAt(s.end, now).getTime();
    if (end <= start) return 0;
    return Math.min(100, Math.max(0, ((now.getTime() - start) / (end - start)) * 100));
  });

  function statusFor(i: number): 'upcoming' | 'active' | 'break-active' | 'done' | 'break-upcoming' | 'break-done' {
    const s = slots[i];
    const start = todayAt(s.start, now).getTime();
    const end = todayAt(s.end, now).getTime();
    const t = now.getTime();
    if (t >= end) return s.type === 'break' ? 'break-done' : 'done';
    if (t >= start) return s.type === 'break' ? 'break-active' : 'active';
    return s.type === 'break' ? 'break-upcoming' : 'upcoming';
  }

  function slotMsLeft(i: number): number {
    const end = todayAt(slots[i].end, now).getTime();
    return Math.max(0, end - now.getTime());
  }

  function fmtMs(ms: number): string {
    const total = Math.floor(ms / 1000);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }

  // ─── Controls ──────────────────────────────────────────────────────────
  function loadSchedule() {
    parseError = '';
    const parsed = parseSchedule(raw);
    if (parsed.length === 0 && raw.trim().length > 0) {
      parseError = "Couldn't parse any slots — check the format (HH:MM - HH:MMTitle).";
      return;
    }
    slots = parsed;
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, raw);
  }

  function reset() {
    raw = SAMPLE;
    slots = parseSchedule(raw);
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, raw);
    parseError = '';
  }

  function clearSaved() {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(storageKey);
  }

  function updateSlot(i: number, patch: Partial<Slot>) {
    slots = slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
  }
</script>

<section class="schedule-timer space-y-5">
  <!-- Stat cards -->
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <div class="card p-4">
      <div class="muted-label">Now</div>
      <div class="mt-1 text-3xl font-semibold tabular">{wallClock}</div>
    </div>
    <div class="card p-4" role="timer" aria-live="polite" aria-atomic="true">
      <div class="muted-label">{remainingShortLabel}</div>
      <div class="mt-1 text-3xl font-semibold tabular">{remainingDisplay}</div>
    </div>
  </div>

  <!-- Current slot panel -->
  {#if activeIndex >= 0}
    {@const cur = slots[activeIndex]}
    <div
      class="rounded-card border p-4 shadow-card {cur.type === 'break'
        ? 'panel-break'
        : 'panel-session'}"
      aria-current="true"
    >
      <div class="muted-label">{cur.type === 'break' ? 'Break' : 'Current slot'}</div>
      <div class="mt-1 flex items-baseline justify-between gap-3">
        <h2 class="text-2xl font-semibold leading-tight">{cur.label}</h2>
        <span class="text-sm tabular opacity-80">{cur.start}–{cur.end}</span>
      </div>
      <div class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          class="h-full rounded-full transition-[width] duration-1000 ease-linear {cur.type ===
          'break'
            ? 'bg-amber-500'
            : 'bg-brand'}"
          style="width: {progressPct}%"
        ></div>
      </div>
    </div>
  {:else if nextIndex >= 0}
    {@const nxt = slots[nextIndex]}
    <div class="rounded-card border border-surface-border bg-surface-card p-4 shadow-card">
      <div class="muted-label">Up next</div>
      <div class="mt-1 flex items-baseline justify-between gap-3">
        <h2 class="text-2xl font-semibold leading-tight">{nxt.label}</h2>
        <span class="text-sm tabular text-ink-500">Starts at {nxt.start}</span>
      </div>
    </div>
  {:else if slots.length > 0}
    <div class="rounded-card border border-surface-border bg-surface-card p-4 text-ink-500 shadow-card">
      All done for today.
    </div>
  {/if}

  <!-- Slot list -->
  {#if slots.length > 0}
    <ul class="space-y-2">
      {#each slots as s, i (i)}
        {@const status = statusFor(i)}
        {@const isActive = status === 'active' || status === 'break-active'}
        {@const isDone = status === 'done' || status === 'break-done'}
        {@const isBreak = s.type === 'break'}
        <li
          aria-current={isActive ? 'true' : undefined}
          class="flex items-center gap-3 rounded-[10px] border bg-surface-card px-3 py-2 transition
            {isActive
            ? isBreak
              ? 'row-break-active'
              : 'row-active'
            : 'border-surface-divider'}
            {isDone ? 'opacity-45' : ''}
            {!isActive && isBreak ? 'row-break' : ''}"
        >
          <span class="tabular w-24 shrink-0 text-sm text-ink-500">{s.start}–{s.end}</span>
          {#if editing}
            <span class="flex flex-1 items-center gap-1.5">
              <input
                type="time"
                class="input !w-24 !py-1 text-xs"
                value={s.start}
                onchange={(e) =>
                  updateSlot(i, { start: (e.currentTarget as HTMLInputElement).value })}
              />
              <input
                type="time"
                class="input !w-24 !py-1 text-xs"
                value={s.end}
                onchange={(e) =>
                  updateSlot(i, { end: (e.currentTarget as HTMLInputElement).value })}
              />
              <input
                type="text"
                class="input flex-1 !py-1 text-xs"
                value={s.label}
                onchange={(e) =>
                  updateSlot(i, { label: (e.currentTarget as HTMLInputElement).value })}
              />
            </span>
          {:else}
            <span class="min-w-0 flex-1 truncate font-medium text-ink-900">{s.label}</span>
          {/if}
          <span class="tabular shrink-0 text-xs">
            {#if status === 'active'}
              <span class="rounded-full bg-brand/10 px-2 py-0.5 font-medium text-brand-700"
                >Active · {fmtMs(slotMsLeft(i))} left</span
              >
            {:else if status === 'break-active'}
              <span
                class="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                >Break · {fmtMs(slotMsLeft(i))} left</span
              >
            {:else if status === 'upcoming'}
              <span class="text-ink-400">Upcoming</span>
            {:else if status === 'break-upcoming'}
              <span class="text-amber-700 dark:text-amber-400">Break</span>
            {:else}
              <span class="text-ink-400">Done</span>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="rounded-card border border-dashed border-surface-border p-6 text-center text-sm text-ink-400">
      No slots loaded yet — paste a schedule below and click <strong>Load schedule</strong>.
    </div>
  {/if}

  <!-- Controls / paste box -->
  <div class="card p-4 space-y-3">
    <div class="flex items-center justify-between">
      <div class="card-title">Schedule input</div>
      <label class="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-500">
        <input
          type="checkbox"
          class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand"
          bind:checked={editing}
        />
        Edit slots
      </label>
    </div>
    <textarea
      class="input min-h-[120px] font-mono text-xs"
      placeholder="Paste your schedule, e.g. 13:30 - 13:40Sól56…"
      bind:value={raw}
    ></textarea>
    {#if parseError}
      <div class="text-xs text-tag-salesText">{parseError}</div>
    {/if}
    <div class="flex flex-wrap items-center gap-2">
      <button class="btn-primary" onclick={loadSchedule}>Load schedule</button>
      <button class="btn-ghost" onclick={reset}>Reset to sample</button>
      <button class="btn-ghost ml-auto" onclick={clearSaved}>Clear saved</button>
    </div>
  </div>
</section>

<style>
  /* Tabular numerals so digits don't jitter as the seconds tick. */
  :global(.schedule-timer) .tabular,
  :global(.schedule-timer) .tabular-nums {
    font-variant-numeric: tabular-nums;
  }

  /* Theme tokens via CSS custom properties — light/dark aware. */
  .schedule-timer {
    --st-session-bg: rgb(234 244 246);
    --st-session-border: rgb(118 184 197);
    --st-session-fg: rgb(20 69 76);
    --st-break-bg: rgb(254 243 199);
    --st-break-border: rgb(217 119 6);
    --st-break-fg: rgb(120 53 15);
  }
  @media (prefers-color-scheme: dark) {
    .schedule-timer {
      --st-session-bg: rgb(20 69 76 / 0.4);
      --st-session-border: rgb(71 159 171);
      --st-session-fg: rgb(208 232 236);
      --st-break-bg: rgb(120 53 15 / 0.35);
      --st-break-border: rgb(217 119 6);
      --st-break-fg: rgb(252 211 77);
    }
  }

  .panel-session {
    background: var(--st-session-bg);
    border-color: var(--st-session-border);
    color: var(--st-session-fg);
  }
  .panel-break {
    background: var(--st-break-bg);
    border-color: var(--st-break-border);
    color: var(--st-break-fg);
  }
  .row-active {
    border-color: var(--st-session-border);
    background: var(--st-session-bg);
  }
  .row-break-active {
    border-color: var(--st-break-border);
    background: var(--st-break-bg);
  }
  .row-break {
    background: color-mix(in srgb, var(--st-break-bg) 40%, transparent);
  }
</style>
