<script lang="ts">
  // Import a single calendar event from the phone. An Apple Shortcut
  // (or any tool) opens this page with the chosen event's details in the
  // URL query string; we pre-fill a review form and, on Save, write a
  // normal `Dates` row via the same createDateRow the calendar uses.
  //
  // Expected query params (all optional except title + start):
  //   title, start, end, allday (1/true), location, notes,
  //   uid  → external_id (dedup key), cal → external_calendar, url
  //
  // Dates are parsed leniently: ISO 8601 (e.g. 2026-06-26T12:00:00+00:00)
  // or a date-only YYYY-MM-DD for all-day events.
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import { createDateRow, findDateByExternalId, formatError, type DateEvent } from '$lib/directus';

  const KINDS = [
    { value: 'event',      label: 'Event',      color: '#2C8C99' },
    { value: 'meeting',    label: 'Meeting',    color: '#1D6BFE' },
    { value: 'family_day', label: 'Family day', color: '#1E9B55' },
    { value: 'travel',     label: 'Travel',     color: '#6B5ADB' },
    { value: 'holiday',    label: 'Holiday',    color: '#C6762A' },
    { value: 'reminder',   label: 'Reminder',   color: '#C93B3B' },
    { value: 'other',      label: 'Other',      color: '#5F6B7A' }
  ];
  const SCOPES = [
    { value: 'both',    label: 'Both' },
    { value: 'work',    label: 'Work' },
    { value: 'private', label: 'Private' }
  ];

  // Form state.
  let fTitle = $state('');
  let fAllDay = $state(false);
  let fStartDateTime = $state(''); // datetime-local, when !allDay
  let fEndDateTime = $state('');
  let fStartDate = $state(''); // date, when allDay
  let fEndDate = $state('');
  let fLocation = $state('');
  let fDescription = $state('');
  let fScope = $state('both');
  let fKind = $state('event');
  let fUrl = $state('');
  // One attendee per line, "Name <email>" / email / name.
  let fAttendees = $state('');
  let externalId = $state('');
  let externalCalendar = $state('');
  let organizer = $state('');

  let ready = $state(false);
  let missingParams = $state(false);
  let duplicate = $state<DateEvent | null>(null);
  let saving = $state(false);
  let error = $state('');
  let savedId = $state<number | null>(null);

  const pad = (n: number) => String(n).padStart(2, '0');
  const toLocalInput = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const toLocalDate = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Lenient date parse — date-only strings are read in local time so an
  // all-day event doesn't drift a day across the UTC boundary.
  function parseDate(s: string | null): Date | null {
    if (!s) return null;
    const t = s.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      const [y, m, d] = t.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Parse the attendees textarea into the shape the calendar's attendee
  // panel reads ({ name, email }). Accepts one per line (or comma/semicolon
  // separated): "Name <email>", "Name (email)", a bare email, or a name.
  function parseAttendees(raw: string): Array<{ name?: string; email?: string }> {
    return raw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const m = entry.match(/^(.*?)[<(]\s*([^>)\s]+@[^>)\s]+)\s*[>)]\s*$/);
        if (m) return { name: m[1].trim() || undefined, email: m[2].trim() };
        if (/^[^\s@]+@[^\s@]+$/.test(entry)) return { email: entry };
        return { name: entry };
      });
  }

  onMount(async () => {
    const sp = $page.url.searchParams;
    const title = (sp.get('title') ?? '').trim();
    const start = parseDate(sp.get('start'));
    const allDayRaw = (sp.get('allday') ?? sp.get('all_day') ?? '').toLowerCase();
    fAllDay = allDayRaw === '1' || allDayRaw === 'true' || allDayRaw === 'yes';

    if (!title || !start) {
      missingParams = true;
      ready = true;
      return;
    }

    fTitle = title;
    const end = parseDate(sp.get('end')) ?? new Date(start.getTime() + (fAllDay ? 0 : 60 * 60 * 1000));
    fStartDateTime = toLocalInput(start);
    fEndDateTime = toLocalInput(end);
    fStartDate = toLocalDate(start);
    fEndDate = toLocalDate(end);
    fLocation = (sp.get('location') ?? '').trim();
    fDescription = (sp.get('notes') ?? sp.get('description') ?? '').trim();
    fUrl = (sp.get('url') ?? '').trim();
    // Attendees arrive newline-encoded from the Shortcut; normalise commas
    // and semicolons to one-per-line for the textarea.
    fAttendees = (sp.get('attendees') ?? '')
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n');
    organizer = (sp.get('organizer') ?? '').trim();
    externalId = (sp.get('uid') ?? '').trim();
    externalCalendar = (sp.get('cal') ?? sp.get('calendar') ?? '').trim();

    // Dedup: warn (but still allow) if this UID was imported before.
    if (externalId) {
      try {
        duplicate = await findDateByExternalId(externalId);
      } catch {
        /* non-fatal — proceed without the dedup hint */
      }
    }
    ready = true;
  });

  function buildISO(): { startISO: string; endISO: string } | null {
    if (fAllDay) {
      if (!fStartDate) return null;
      const s = new Date(`${fStartDate}T00:00:00`);
      s.setHours(0, 0, 0, 0);
      const e = new Date(`${fEndDate || fStartDate}T00:00:00`);
      e.setHours(23, 59, 59, 999);
      if (e < s) e.setTime(s.getTime() + (24 * 60 * 60 - 1) * 1000);
      return { startISO: s.toISOString(), endISO: e.toISOString() };
    }
    if (!fStartDateTime) return null;
    const s = new Date(fStartDateTime);
    let e = fEndDateTime ? new Date(fEndDateTime) : new Date(s.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(s.getTime())) return null;
    if (Number.isNaN(e.getTime()) || e <= s) e = new Date(s.getTime() + 60 * 60 * 1000);
    return { startISO: s.toISOString(), endISO: e.toISOString() };
  }

  async function save() {
    if (!fTitle.trim()) return;
    const iso = buildISO();
    if (!iso) {
      error = 'Please set a valid start date/time.';
      return;
    }
    saving = true;
    error = '';
    try {
      const kind = KINDS.find((k) => k.value === fKind);
      const url = fUrl.trim();
      const attendees = parseAttendees(fAttendees);
      const created = await createDateRow({
        title: fTitle.trim(),
        description: fDescription.trim() || null,
        event_type: fKind,
        start: iso.startISO,
        end: iso.endISO,
        all_day: fAllDay,
        color: kind?.color ?? null,
        scope: (fScope as DateEvent['scope']) || null,
        location_name: fLocation.trim() || null,
        // A URL becomes the event's virtual link (matches synced events).
        virtual_link: url || null,
        is_virtual: !!url,
        organizer: organizer || null,
        // Stash attendees where the calendar's attendee panel reads them —
        // it resolves emails to People and auto-links them via Dates_Person.
        external_links: attendees.length ? { attendees } : null,
        source: 'apple',
        source_ref: externalId || null,
        external_id: externalId || null,
        external_calendar: externalCalendar || null,
        status: 'published'
      } as never);
      savedId = created.id;
    } catch (e) {
      error = formatError(e);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Import event · Hub</title></svelte:head>

<section class="mx-auto max-w-xl space-y-5 py-2">
  <header class="flex items-center gap-2">
    <span class="inline-flex h-8 w-8 items-center justify-center rounded-full" style="background: var(--accent-electric); color: var(--accent-text);">
      <Icon name="calendar" size={16} />
    </span>
    <h1 class="font-display text-xl font-bold text-ink-900" style="letter-spacing: -0.02em;">Import event</h1>
  </header>

  {#if !ready}
    <div class="text-sm text-ink-500">Loading…</div>
  {:else if savedId}
    <!-- Success -->
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-5 text-center">
      <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full" style="background: color-mix(in srgb, var(--state-success) 18%, transparent); color: var(--state-success);">
        <Icon name="check" size={24} />
      </div>
      <div class="text-base font-semibold text-ink-900">Added to your calendar</div>
      <div class="mt-1 text-sm text-ink-500">“{fTitle}” is now in twin.</div>
      <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <a class="btn-primary justify-center" href={`/calendar/grid?event=${savedId}`}>Open in calendar</a>
        <a class="btn-ghost justify-center" href="/calendar">Done</a>
      </div>
    </div>
  {:else if missingParams}
    <!-- No event data — show setup help -->
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card p-5 text-sm text-ink-600">
      <p class="font-medium text-ink-900">No event to import.</p>
      <p class="mt-1">
        Open this page from the “Add to twin” Apple Shortcut (it fills in the event
        details), or append them to the URL yourself:
      </p>
      <code class="mt-2 block overflow-x-auto rounded-md bg-surface-hover px-2 py-1.5 text-[11px] text-ink-700">/calendar/import?title=Lunch&amp;start=2026-06-26T12:00&amp;end=2026-06-26T13:00&amp;location=Mokka</code>
    </div>
  {:else}
    {#if duplicate}
      <div class="flex items-start gap-2 rounded-[12px] border px-3 py-2 text-sm" style="border-color: var(--accent-alpha-30); background: var(--accent-alpha-10); color: var(--text-secondary);">
        <Icon name="bell" size={16} />
        <div>
          Looks like this event was imported before.
          <a class="font-medium text-brand hover:underline" href={`/calendar/grid?event=${duplicate.id}`}>Open the existing one</a>, or import again below.
        </div>
      </div>
    {/if}

    <div class="space-y-4 rounded-[14px] border border-surface-border bg-surface-card p-4">
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-ink-500">Title</span>
        <input bind:value={fTitle} type="text" class="input" placeholder="Event title" />
      </label>

      <label class="inline-flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" bind:checked={fAllDay} class="accent-brand" />
        All-day
      </label>

      {#if fAllDay}
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-ink-500">Start</span>
            <input bind:value={fStartDate} type="date" class="input" />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-ink-500">End</span>
            <input bind:value={fEndDate} type="date" class="input" />
          </label>
        </div>
      {:else}
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-ink-500">Starts</span>
            <input bind:value={fStartDateTime} type="datetime-local" class="input" />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-ink-500">Ends</span>
            <input bind:value={fEndDateTime} type="datetime-local" class="input" />
          </label>
        </div>
      {/if}

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-ink-500">Kind</span>
          <select bind:value={fKind} class="input">
            {#each KINDS as k}<option value={k.value}>{k.label}</option>{/each}
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-ink-500">Scope</span>
          <select bind:value={fScope} class="input">
            {#each SCOPES as s}<option value={s.value}>{s.label}</option>{/each}
          </select>
        </label>
      </div>

      <label class="block">
        <span class="mb-1 block text-xs font-medium text-ink-500">Location</span>
        <input bind:value={fLocation} type="text" class="input" placeholder="Optional" />
      </label>

      <label class="block">
        <span class="mb-1 block text-xs font-medium text-ink-500">Link</span>
        <input bind:value={fUrl} type="url" inputmode="url" class="input" placeholder="Video call or event URL (optional)" />
      </label>

      <label class="block">
        <span class="mb-1 block text-xs font-medium text-ink-500">Attendees</span>
        <textarea bind:value={fAttendees} rows="3" class="input" placeholder="One per line — “Name &lt;email&gt;” or just a name"></textarea>
        <span class="mt-1 block text-[11px] text-ink-400">Emails are matched to your People automatically.</span>
      </label>

      <label class="block">
        <span class="mb-1 block text-xs font-medium text-ink-500">Notes</span>
        <textarea bind:value={fDescription} rows="3" class="input" placeholder="Optional"></textarea>
      </label>

      {#if externalCalendar}
        <p class="text-xs text-ink-400">From “{externalCalendar}”.</p>
      {/if}

      {#if error}
        <div class="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      {/if}

      <div class="flex items-center justify-end gap-2 pt-1">
        <a class="btn-ghost" href="/calendar">Cancel</a>
        <button class="btn-primary" onclick={save} disabled={saving || !fTitle.trim()}>
          {saving ? 'Adding…' : duplicate ? 'Import anyway' : 'Add to calendar'}
        </button>
      </div>
    </div>
  {/if}
</section>
