<script lang="ts">
  // Reverse view of the Calendar/event surface. Mounts on Person /
  // Organisation / Project detail pages and lists upcoming + recent
  // events linked to that record. Same row shape as the dashboard
  // agenda so the visual language stays consistent.
  //
  // `kind` decides which Directus helper we use to fetch the rows;
  // `id` is the entity's primary key.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import {
    listDatesForPerson,
    listDatesForOrg,
    listDatesForProject,
    formatError,
    type DateEvent
  } from '$lib/directus';
  import { expandRecurrence } from '$lib/recurrence';
  import { isPastEvent, eventEnd } from '$lib/events/data';

  type Props = {
    kind: 'person' | 'org' | 'project';
    id: number;
  };
  let { kind, id }: Props = $props();

  let events = $state<DateEvent[]>([]);

  // Resolve an event dot's colour with the same fallback chain the
  // Calendar uses: own → linked project → accent. Keeps the visual
  // language consistent between the grid and these embedded lists.
  function dotColor(e: DateEvent): string {
    if (e.color) return e.color;
    const proj = e.project_id;
    if (proj && typeof proj === 'object' && proj.color) return proj.color as string;
    return 'var(--accent-electric)';
  }
  let loading = $state(true);
  let error = $state('');

  async function refresh() {
    loading = true;
    error = '';
    try {
      let rows: DateEvent[];
      if (kind === 'person') rows = await listDatesForPerson(id);
      else if (kind === 'org') rows = await listDatesForOrg(id);
      else rows = await listDatesForProject(id);
      // Materialise the next year's worth of occurrences for any
      // recurring rows so "yearly Bun Day" appears in Upcoming
      // instead of being stuck at its anchor year.
      const today = new Date();
      const horizon = new Date(today.getTime() + 365 * 86_400_000);
      const out: DateEvent[] = [];
      for (const r of rows) {
        if (r.is_recurring) {
          for (const occ of expandRecurrence(r, new Date(today.getTime() - 365 * 86_400_000), horizon)) {
            out.push({ ...r, start: occ.start, end: occ.end });
          }
        } else {
          out.push(r);
        }
      }
      events = out;
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }

  onMount(refresh);
  // Re-fetch when the entity id changes (route nav from one person
  // detail to another would otherwise keep stale events).
  $effect(() => {
    void id;
    void kind;
    void refresh();
  });

  // ── Buckets ────────────────────────────────────────────────────────────
  const now = $derived(new Date());
  // isPastEvent is the shared implementation this logic became — the badge in
  // EventsCard and the events-list filter now read the same function, so the
  // three surfaces cannot disagree about whether something has happened.
  const upcoming = $derived(
    events
      .filter((e) => !isPastEvent(e, now) && !!eventEnd(e))
      .sort(
        (a, b) =>
          (a.start ? new Date(a.start).getTime() : 0) -
          (b.start ? new Date(b.start).getTime() : 0)
      )
  );
  const past = $derived(
    events
      .filter((e) => isPastEvent(e, now))
      .sort(
        (a, b) =>
          (b.start ? new Date(b.start).getTime() : 0) -
          (a.start ? new Date(a.start).getTime() : 0)
      )
      .slice(0, 8)
  );

  // ── Format helpers ─────────────────────────────────────────────────────
  function fmtWhen(e: DateEvent): string {
    if (!e.start) return '';
    const d = new Date(e.start);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((day.getTime() - startOfToday.getTime()) / 86400000);
    let dateLabel: string;
    if (days === 0) dateLabel = 'Today';
    else if (days === 1) dateLabel = 'Tomorrow';
    else if (days === -1) dateLabel = 'Yesterday';
    else if (days > 1 && days < 7) {
      dateLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(d);
    } else {
      dateLabel = new Intl.DateTimeFormat('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
        ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' })
      }).format(d);
    }
    if (e.all_day) return dateLabel;
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(d);
    return `${dateLabel} · ${time}`;
  }
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title">
      <Icon name="calendar" size={16} /> Calendar
      {#if events.length > 0}
        <span class="text-ink-300 font-normal">{events.length}</span>
      {/if}
    </span>
    <a class="text-xs font-medium text-brand hover:underline" href="/calendar">Calendars</a>
  </div>

  {#if error}
    <div
      class="mx-4 mb-3 px-3 py-1.5 text-xs"
      style="background: var(--bg-tertiary); color: var(--state-danger); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
    >{error}</div>
  {/if}

  {#if loading}
    <div class="px-4 pb-4 text-sm text-ink-400">Loading…</div>
  {:else if events.length === 0}
    <div class="px-4 pb-4 text-sm text-ink-400">
      No events linked yet. Open any event and add this {kind} to its connections.
    </div>
  {:else}
    {#if upcoming.length > 0}
      <div class="px-4 pt-1 pb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Upcoming</div>
      <ul class="divide-y divide-surface-divider">
        {#each upcoming as e (`${e.id}:${e.start ?? ''}`)}
          <li>
            <a
              href={`/calendar/grid?event=${e.id}`}
              class="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover"
            >
              <span
                class="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full"
                style:background-color={dotColor(e)}
                aria-hidden="true"
              ></span>
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium text-ink-900">{e.title || '(untitled event)'}</div>
                <div class="text-xs text-ink-500">{fmtWhen(e)}{e.location_name ? ` · 📍 ${e.location_name}` : ''}</div>
              </div>
              <Icon name="chevron-right" size={12} class="shrink-0 text-ink-300" />
            </a>
          </li>
        {/each}
      </ul>
    {/if}

    {#if past.length > 0}
      <div class="px-4 pt-3 pb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Past</div>
      <ul class="divide-y divide-surface-divider opacity-80">
        {#each past as e (`${e.id}:${e.start ?? ''}`)}
          <li>
            <a
              href={`/calendar/grid?event=${e.id}`}
              class="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover"
            >
              <span
                class="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full"
                style:background-color={dotColor(e)}
                aria-hidden="true"
              ></span>
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium text-ink-700">{e.title || '(untitled event)'}</div>
                <div class="text-xs text-ink-500">{fmtWhen(e)}{e.location_name ? ` · 📍 ${e.location_name}` : ''}</div>
              </div>
              <Icon name="chevron-right" size={12} class="shrink-0 text-ink-300" />
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
