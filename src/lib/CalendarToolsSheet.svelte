<script lang="ts">
  // Fullscreen mobile "Calendar tools" sheet: an event-only search
  // (autocomplete with visual results) + the advanced filters. Kept as
  // its own component so it's fully isolated from the (large) Calendar
  // template — mounted there as a single tag.
  import Icon from '$lib/Icon.svelte';
  import ProjectFilterTree from '$lib/admin/ProjectFilterTree.svelte';
  import { searchEvents, type DateEvent, type Project } from '$lib/directus';

  type Props = {
    open: boolean;
    onClose: () => void;
    /** Picking a search result hands the row back so the calendar can
     *  jump to it and open the detail dialog. */
    onPick: (row: DateEvent) => void;
    // Filter state — bound back to the calendar.
    projects: Project[];
    selectedProjectIds: Set<number>;
    scopeFilter: 'all' | 'work' | 'private' | 'both';
    kindFilter: Set<string>;
    calendarFilter: Set<string>;
    /** Calendar-type visibility (the unified grid's sub-calendars). */
    visibleCals: Record<string, boolean>;
    calKeys: string[];
    calLabels: Record<string, string>;
    calColors: Record<string, string>;
    kindOptions: string[];
    calendarOptions: string[];
    activeFilterCount: number;
    onClear: () => void;
  };
  let {
    open,
    onClose,
    onPick,
    projects,
    selectedProjectIds = $bindable(),
    scopeFilter = $bindable(),
    kindFilter = $bindable(),
    calendarFilter = $bindable(),
    visibleCals = $bindable(),
    calKeys,
    calLabels,
    calColors,
    kindOptions,
    calendarOptions,
    activeFilterCount,
    onClear
  }: Props = $props();

  // ── Event search ────────────────────────────────────────────────
  let q = $state('');
  let results = $state<DateEvent[]>([]);
  let searching = $state(false);
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  function onQuery(v: string) {
    q = v;
    if (timer) clearTimeout(timer);
    const query = v.trim();
    if (!query) { results = []; searching = false; return; }
    searching = true;
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const hits = await searchEvents(query, 12);
        if (my === seq) results = hits;
      } catch {
        if (my === seq) results = [];
      } finally {
        if (my === seq) searching = false;
      }
    }, 200);
  }
  function pick(row: DateEvent) {
    q = ''; results = [];
    onPick(row);
  }

  // Esc closes.
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  function toggleNum(set: Set<number>, v: number): Set<number> {
    const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n;
  }
  function toggleStr(set: Set<string>, v: string): Set<string> {
    const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n;
  }
</script>

<svelte:window onkeydown={open ? onKey : undefined} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex flex-col bg-surface-card md:hidden"
    role="dialog"
    aria-modal="true"
    aria-label="Calendar tools"
  >
    <header
      class="flex items-center justify-between gap-3 border-b border-surface-divider px-4"
      style="padding-top: max(env(safe-area-inset-top), 0.75rem); padding-bottom: 0.75rem;"
    >
      <!-- Title leads; the close X sits on the RIGHT so it lands under
           the same thumb/pointer that tapped the tools button in the
           top-right of the chrome — no cross-screen reach to dismiss. -->
      <span class="font-display text-sm font-semibold text-ink-900" style="letter-spacing: -0.01em;">Calendar tools</span>
      <div class="flex items-center gap-2">
        {#if activeFilterCount > 0}
          <button class="text-[11px] text-ink-400 hover:text-ink-700" onclick={onClear}>Clear filters</button>
        {/if}
        <button type="button" class="btn-ghost !px-2" aria-label="Close tools" onclick={onClose}>
          <Icon name="x" size={20} />
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto px-4 py-4 space-y-5">
      <!-- Event search -->
      <div>
        <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Search events</div>
        <div class="relative">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300">
            <Icon name="search" size={16} />
          </span>
          <input
            type="search"
            inputmode="search"
            placeholder="Title, place, anything…"
            value={q}
            oninput={(e) => onQuery((e.currentTarget as HTMLInputElement).value)}
            class="input w-full pl-9"
          />
        </div>

        {#if q.trim()}
          <div class="mt-2">
            {#if searching && results.length === 0}
              <div class="px-1 py-3 text-xs text-ink-400">Searching…</div>
            {:else if results.length === 0}
              <div class="px-1 py-3 text-xs text-ink-400">No events match “{q.trim()}”. Try a different word.</div>
            {:else}
              <ul class="space-y-1">
                {#each results as r (r.id)}
                  {@const proj = r.project_id && typeof r.project_id === 'object' ? (r.project_id as Project) : null}
                  {@const start = r.start ? new Date(r.start) : null}
                  <li>
                    <button
                      type="button"
                      class="flex w-full items-start gap-3 rounded-md border border-surface-border bg-surface-hover/20 px-3 py-2 text-left hover:bg-surface-hover"
                      onclick={() => pick(r)}
                    >
                      <span class="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style:background-color={r.color || proj?.color || '#2C8C99'}></span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate font-medium text-ink-900">{r.title ?? '(untitled)'}</span>
                        <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-500">
                          {#if start}
                            <span class="tabular-nums">
                              {new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(start)}
                              {#if !r.all_day}· {new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(start)}{/if}
                            </span>
                          {/if}
                          {#if proj}<span>·</span><span class="truncate max-w-[10rem]">{proj.name}</span>{/if}
                          {#if r.location_name}<span>·</span><span class="truncate max-w-[10rem]">📍 {r.location_name}</span>{/if}
                        </span>
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Filters -->
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Filters</span>
          {#if activeFilterCount > 0}
            <span class="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white">{activeFilterCount} active</span>
          {/if}
        </div>

        <!-- Calendars: the unified grid's sub-calendars as toggle chips. -->
        <div>
          <div class="mb-1.5 flex items-center justify-between">
            <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Calendars</span>
            {#if calKeys.some((k) => !visibleCals[k])}
              <button class="text-[11px] text-ink-400 hover:text-ink-700" onclick={() => { for (const k of calKeys) visibleCals[k] = true; }}>reset</button>
            {/if}
          </div>
          <div class="flex flex-wrap gap-1">
            {#each calKeys as k (k)}
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition"
                style:background-color={visibleCals[k] ? `${calColors[k]}1f` : 'transparent'}
                style:color={visibleCals[k] ? calColors[k] : 'var(--text-secondary)'}
                style:border-color={visibleCals[k] ? `${calColors[k]}55` : 'var(--surface-border)'}
                aria-pressed={visibleCals[k]}
                onclick={() => (visibleCals = { ...visibleCals, [k]: !visibleCals[k] })}
              >
                <span class="inline-block h-2 w-2 rounded-full" style:background-color={calColors[k]}></span>
                {calLabels[k]}
              </button>
            {/each}
          </div>
        </div>

        <!-- Projects -->
        <div>
          <div class="mb-1.5 flex items-center justify-between">
            <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Projects</span>
            {#if selectedProjectIds.size > 0}
              <button class="text-[11px] text-ink-400 hover:text-ink-700" onclick={() => (selectedProjectIds = new Set())}>reset</button>
            {/if}
          </div>
          <div class="max-h-56 overflow-y-auto rounded-md border border-surface-border p-1">
            {#if projects.length === 0}
              <div class="px-2 py-3 text-xs text-ink-400">No projects loaded yet…</div>
            {:else}
              <ProjectFilterTree {projects} bind:selected={selectedProjectIds} />
            {/if}
          </div>
        </div>

        <!-- Scope -->
        <div>
          <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Scope</div>
          <div
            class="inline-flex w-full p-0.5"
            role="radiogroup"
            aria-label="Scope filter"
            style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
          >
            {#each [['all', 'All'], ['work', 'Work'], ['private', 'Private'], ['both', 'Both']] as const as [k, label]}
              <button
                type="button"
                role="radio"
                aria-checked={scopeFilter === k}
                class="font-display flex-1 px-2 py-1 text-[11px] font-medium transition"
                style={scopeFilter === k
                  ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: calc(var(--radius-md) - 2px); letter-spacing: 0.04em;'
                  : 'background: transparent; color: var(--text-secondary); letter-spacing: 0.04em;'}
                onclick={() => (scopeFilter = k)}
              >{label}</button>
            {/each}
          </div>
        </div>

        <!-- Kind -->
        {#if kindOptions.length > 0}
          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Kind</span>
              {#if kindFilter.size > 0}
                <button class="text-[11px] text-ink-400 hover:text-ink-700" onclick={() => (kindFilter = new Set())}>reset</button>
              {/if}
            </div>
            <div class="flex flex-wrap gap-1">
              {#each kindOptions as k (k)}
                {@const on = kindFilter.has(k)}
                <button
                  type="button"
                  class="rounded-full border px-2 py-0.5 text-[11px] capitalize transition"
                  style:background-color={on ? 'rgba(44,140,153,0.12)' : 'transparent'}
                  style:color={on ? 'var(--brand, #2C8C99)' : 'var(--text-secondary)'}
                  style:border-color={on ? 'rgba(44,140,153,0.45)' : 'var(--surface-border)'}
                  aria-pressed={on}
                  onclick={() => (kindFilter = toggleStr(kindFilter, k))}
                >{k.replace(/_/g, ' ')}</button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Calendar source -->
        {#if calendarOptions.length > 0}
          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Calendar</span>
              {#if calendarFilter.size > 0}
                <button class="text-[11px] text-ink-400 hover:text-ink-700" onclick={() => (calendarFilter = new Set())}>reset</button>
              {/if}
            </div>
            <div class="flex flex-wrap gap-1">
              {#each calendarOptions as c (c)}
                {@const on = calendarFilter.has(c)}
                <button
                  type="button"
                  class="rounded-full border px-2 py-0.5 text-[11px] transition"
                  style:background-color={on ? 'rgba(29,107,254,0.12)' : 'transparent'}
                  style:color={on ? '#1D6BFE' : 'var(--text-secondary)'}
                  style:border-color={on ? 'rgba(29,107,254,0.45)' : 'var(--surface-border)'}
                  aria-pressed={on}
                  onclick={() => (calendarFilter = toggleStr(calendarFilter, c))}
                >{c}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <footer
      class="border-t border-surface-divider px-4 py-3"
      style="padding-bottom: max(env(safe-area-inset-bottom), 0.75rem);"
    >
      <button class="btn-primary w-full" onclick={onClose}>Done</button>
    </footer>
  </div>
{/if}
