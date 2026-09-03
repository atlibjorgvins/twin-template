<script lang="ts">
  // Habits on the Today page — the one-tap logging surface.
  //
  //   check habits  → tap the row to tick / untick.
  //   count habits  → tap the row to add one step (pushups 20, water 1);
  //                   the "123" button adds a specific amount for odd sets;
  //                   a − button undoes one step once the day has progress.
  //
  // Writes go straight to habit_entry via setHabitValue (upsert on
  // habit_id + entry_date) with optimistic local state, so the row
  // responds instantly and reverts if the save fails.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';
  import { scope, matchesScope } from '$lib/scope';
  import {
    listHabits,
    listHabitEntries,
    setHabitValue,
    createHabit,
    habitDayKey,
    habitTargetOf,
    habitStepOf,
    habitStreaks,
    formatError,
    type Habit,
    type HabitEntry
  } from '$lib/directus';

  const today = habitDayKey();
  /** 60 days back is plenty for a streak read on the Today card. */
  const windowStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 60);
    return habitDayKey(d);
  })();

  let habits = $state<Habit[]>([]);
  let entries = $state<HabitEntry[]>([]);
  let loaded = $state(false);
  let error = $state('');
  let busy = $state<Set<number>>(new Set());

  const idOf = (v: number | Habit | null | undefined): number | null =>
    v == null ? null : typeof v === 'object' ? (v.id ?? null) : v;

  /** habitId → day → value, from the loaded entry window. */
  const byHabit = $derived.by(() => {
    const m = new Map<number, Map<string, number>>();
    for (const e of entries) {
      const hid = idOf(e.habit_id);
      if (hid == null || !e.entry_date) continue;
      (m.get(hid) ?? m.set(hid, new Map()).get(hid)!).set(e.entry_date, e.value ?? 0);
    }
    return m;
  });

  const visible = $derived(habits.filter((h) => matchesScope($scope, h.scope)));

  function valueOf(h: Habit): number {
    return byHabit.get(h.id)?.get(today) ?? 0;
  }
  function streakOf(h: Habit): number {
    return habitStreaks(byHabit.get(h.id) ?? new Map(), today).current;
  }
  function isCount(h: Habit): boolean {
    return (h.kind ?? 'check') === 'count';
  }
  function doneOf(h: Habit): boolean {
    return valueOf(h) >= habitTargetOf(h);
  }

  onMount(async () => {
    try {
      const [hs, es] = await Promise.all([listHabits(), listHabitEntries(windowStart, today)]);
      habits = hs;
      entries = es;
    } catch (e) {
      error = formatError(e);
    } finally {
      loaded = true;
    }
  });

  /** Optimistic write — patch local state, save, revert on failure. */
  async function bump(h: Habit, delta: number) {
    const prev = valueOf(h);
    const next = Math.max(0, prev + delta);
    if (next === prev) return;
    setLocal(h.id, next);
    busy = new Set(busy).add(h.id);
    try {
      // Pass the target so the day's row snapshots it — history stays
      // answerable if the target changes later.
      await setHabitValue(h.id, today, next, habitTargetOf(h));
    } catch (e) {
      setLocal(h.id, prev);
      error = formatError(e);
    } finally {
      const b = new Set(busy);
      b.delete(h.id);
      busy = b;
    }
  }
  function setLocal(habitId: number, value: number) {
    const i = entries.findIndex((e) => idOf(e.habit_id) === habitId && e.entry_date === today);
    if (i >= 0) {
      entries = entries.map((e, idx) => (idx === i ? { ...e, value } : e));
    } else {
      entries = [...entries, { id: -habitId, habit_id: habitId, entry_date: today, value } as HabitEntry];
    }
  }

  function onRowTap(h: Habit) {
    if (isCount(h)) bump(h, habitStepOf(h));
    else bump(h, doneOf(h) ? -1 : 1);
  }

  // ── Bulk entry ──────────────────────────────────────────────────
  // Odd amounts (17 pushups) that don't divide into the step. Always
  // ADDS to today's total — never replaces it.
  let bulkFor = $state<number | null>(null);
  let bulkAmount = $state('');
  let bulkEl = $state<HTMLInputElement | undefined>();

  function openBulk(h: Habit) {
    bulkFor = h.id;
    bulkAmount = '';
    queueMicrotask(() => bulkEl?.focus());
  }
  async function commitBulk(h: Habit) {
    // Clear state BEFORE awaiting: Enter closes the input, which can also
    // fire blur — both call this, and a second run must be a no-op rather
    // than adding the amount twice.
    const raw = bulkAmount;
    bulkAmount = '';
    bulkFor = null;
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n === 0) return;
    await bump(h, n);
  }

  // ── Add flow ────────────────────────────────────────────────────
  // Curated glyphs from the existing catalogue — no new icons needed.
  const GLYPHS: IconName[] = ['biceps', 'bolt', 'footprints', 'coffee', 'wine', 'utensils', 'book-open', 'clock', 'sparkles', 'check'];
  let adding = $state(false);
  let newName = $state('');
  let newKind = $state<'check' | 'count'>('check');
  let newTarget = $state('');
  let newUnit = $state('');
  let newStep = $state('');
  let newIcon = $state<IconName>('check');
  let creating = $state(false);

  function openAdd() {
    adding = true;
    newName = ''; newKind = 'check'; newTarget = ''; newUnit = ''; newStep = ''; newIcon = 'check';
    error = '';
  }
  async function submitHabit() {
    const name = newName.trim();
    if (!name) { error = 'Give the habit a name.'; return; }
    creating = true;
    error = '';
    try {
      const created = await createHabit({
        name,
        kind: newKind,
        target: newKind === 'count' ? Math.max(1, Number(newTarget) || 1) : null,
        step: newKind === 'count' ? Math.max(1, Number(newStep) || 1) : null,
        unit: newKind === 'count' ? (newUnit.trim() || null) : null,
        icon: newIcon,
        sort: habits.length
      });
      habits = [...habits, created];
      adding = false;
    } catch (e) {
      error = formatError(e);
    } finally {
      creating = false;
    }
  }
</script>

<!-- Renders once loaded even with no habits — the empty state carries the
     only entry point for creating the first one. -->
{#if loaded}
  <div class="card">
    <div class="card-header">
      <span class="card-title"><Icon name="check" size={16} /> Habits
        {#if visible.length > 0}
          <span class="text-ink-300 font-normal">{visible.filter(doneOf).length}/{visible.length}</span>
        {/if}
      </span>
      <button
        class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
        onclick={openAdd}
      ><Icon name="plus" size={14} /> Add habit</button>
    </div>

    {#if error}
      <p class="px-4 pb-2 text-xs" style="color: #C0392B;">{error}</p>
    {/if}

    {#if adding}
      <div class="mx-4 mb-3 space-y-3 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3">
        <input class="input w-full text-sm" placeholder="Pushups, Glass of water…" bind:value={newName}
               onkeydown={(e) => { if (e.key === 'Enter') submitHabit(); }} />
        <div class="flex items-center gap-1 rounded-full border border-surface-border p-0.5 w-fit" role="radiogroup" aria-label="Habit type">
          {#each [['check', 'Check'], ['count', 'Count']] as [v, label] (v)}
            <button
              type="button" role="radio" aria-checked={newKind === v}
              class="cursor-pointer rounded-full px-3 py-0.5 text-[11px] font-medium transition {newKind === v ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-900'}"
              onclick={() => (newKind = v as 'check' | 'count')}
            >{label}</button>
          {/each}
        </div>
        {#if newKind === 'count'}
          <div class="flex gap-2">
            <input class="input w-24 text-sm" type="number" min="1" placeholder="Target" bind:value={newTarget} />
            <input class="input flex-1 text-sm" placeholder="Unit (reps, glasses…)" bind:value={newUnit} />
          </div>
          <label class="block">
            <span class="mb-1 block text-[10px] text-ink-400">Each tap adds</span>
            <input class="input w-24 text-sm" type="number" min="1" placeholder="1" bind:value={newStep} />
          </label>
        {/if}
        <div class="flex flex-wrap gap-1.5">
          {#each GLYPHS as g (g)}
            <button
              type="button"
              class="grid h-8 w-8 cursor-pointer place-items-center rounded-md border transition {newIcon === g ? 'border-brand text-brand' : 'border-surface-border text-ink-400 hover:text-ink-700'}"
              title={g}
              aria-label="Icon {g}"
              aria-pressed={newIcon === g}
              onclick={() => (newIcon = g)}
            ><Icon name={g} size={15} /></button>
          {/each}
        </div>
        <div class="flex items-center justify-end gap-2">
          <button class="btn-ghost" onclick={() => (adding = false)} disabled={creating}>Cancel</button>
          <button class="btn-primary" onclick={submitHabit} disabled={creating || !newName.trim()}>
            {creating ? 'Adding…' : 'Add habit'}
          </button>
        </div>
      </div>
    {/if}

    {#if visible.length === 0 && !adding}
      <div class="px-4 pb-4 text-sm text-ink-400">
        No habits yet. Add pushups, a glass of water, anything you want to keep daily.
      </div>
    {:else}
      <ul class="divide-y divide-surface-divider">
        {#each visible as h (h.id)}
          {@const v = valueOf(h)}
          {@const target = habitTargetOf(h)}
          {@const done = v >= target}
          {@const streak = streakOf(h)}
          {@const step = habitStepOf(h)}
          {@const pct = Math.min(100, Math.round((v / target) * 100))}
          <li class="relative">
            <!-- Progress fill sits behind the row content. -->
            {#if isCount(h) && v > 0}
              <div
                class="pointer-events-none absolute inset-y-0 left-0 transition-all"
                style="width: {pct}%; background: {h.color ?? 'var(--accent-electric)'}; opacity: 0.10;"
                aria-hidden="true"
              ></div>
            {/if}
            <div class="relative flex items-center gap-3 px-4 py-2.5">
              <button
                type="button"
                class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                title={isCount(h) ? `Add ${step}${h.unit ? ` ${h.unit}` : ''} — ${v}/${target}` : done ? 'Tap to untick' : 'Tap to tick'}
                aria-label={isCount(h)
                  ? `${h.name}: ${v} of ${target}. Add ${step}`
                  : `${h.name}: ${done ? 'done' : 'not done'}. Toggle`}
                disabled={busy.has(h.id)}
                onclick={() => onRowTap(h)}
              >
                <span
                  class="grid h-8 w-8 shrink-0 place-items-center rounded-full transition"
                  style={done
                    ? `background: ${h.color ?? 'var(--accent-electric)'}; color: #fff;`
                    : 'background: var(--bg-tertiary); color: var(--text-secondary);'}
                >
                  <Icon name={done ? 'check' : ((h.icon as IconName) ?? 'check')} size={15} />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium {done ? 'text-ink-500 line-through' : 'text-ink-900'}">{h.name}</span>
                  {#if isCount(h)}
                    <span class="mt-0.5 block text-xs text-ink-400 tabular-nums">
                      {v}/{target}{h.unit ? ` ${h.unit}` : ''}{step > 1 ? ` · +${step} per tap` : ''}
                    </span>
                  {/if}
                </span>
              </button>

              {#if isCount(h) && bulkFor === h.id}
                <!-- Bulk entry: adds the typed amount to today's total. -->
                <input
                  bind:this={bulkEl}
                  type="number"
                  inputmode="numeric"
                  class="input w-20 shrink-0 !py-1 text-sm tabular-nums"
                  placeholder="+{h.unit ?? 'amount'}"
                  aria-label="Amount to add to {h.name}"
                  bind:value={bulkAmount}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') commitBulk(h);
                    else if (e.key === 'Escape') bulkFor = null;
                  }}
                  onblur={() => commitBulk(h)}
                />
              {:else}
                {#if streak >= 2}
                  <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                        style="background: var(--bg-tertiary); color: var(--text-secondary);"
                        title="{streak}-day streak">{streak}d</span>
                {/if}
                {#if isCount(h)}
                  <button
                    type="button"
                    class="shrink-0 cursor-pointer rounded-full px-1.5 py-1 text-[11px] font-semibold text-ink-400 transition hover:bg-surface-hover hover:text-ink-700"
                    title="Add a specific amount"
                    aria-label="Add a specific amount to {h.name}"
                    disabled={busy.has(h.id)}
                    onclick={() => openBulk(h)}
                  >123</button>
                {/if}
              {/if}
              {#if v > 0}
                <button
                  type="button"
                  class="shrink-0 cursor-pointer rounded-full p-1 text-ink-300 transition hover:bg-surface-hover hover:text-ink-700"
                  title={isCount(h) ? `Undo ${step}` : 'Undo'}
                  aria-label="Subtract {step} from {h.name}"
                  disabled={busy.has(h.id)}
                  onclick={() => bump(h, -step)}
                ><Icon name="x" size={12} /></button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
