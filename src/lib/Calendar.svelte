<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import EditableField from '$lib/EditableField.svelte';
  import {
    listDatesInRange,
    listBirthdaysInRange,
    listProjectSpansInRange,
    dateRowToCalendarEvent,
    type DateEvent,
    createDateRow,
    deleteDateRow,
    updateDateRow,
    bulkArchiveDateRows,
    bulkUpdateDateRows,
    getDatePeople,
    attachPersonToDate,
    detachPersonFromDate,
    findPeopleByEmails,
    getCurrentRolesFor,
    type Role,
    searchPeople,
    createPerson,
    addPersonEmail,
    listEmailGroups,
    resolveEmailGroup,
    searchOrgs,
    searchProjects,
    personName,
    assetUrl,
    type CalendarEvent,
    type Person,
    type Organization,
    type Project,
    type DatePerson,
    placesForOrg,
    placesNear,
    placeLabel,
    createPlace,
    type PlaceSuggestion
  } from '$lib/directus';
  import { expandRecurrence, buildRrule, describeRrule } from '$lib/recurrence';
  import { getPosition } from '$lib/weather';
  import ProjectFilterTree from '$lib/admin/ProjectFilterTree.svelte';
  import CalendarToolsSheet from '$lib/CalendarToolsSheet.svelte';
  import BottomSheet from '$lib/BottomSheet.svelte';
  import EventPills from '$lib/events/EventPills.svelte';
  import AttendeeStack from '$lib/events/AttendeeStack.svelte';
  import { formatEventWhen, stripMeetingBoilerplate } from '$lib/events/eventFormat';
  import ConferenceCard from '$lib/events/ConferenceCard.svelte';
  import { parseConferencing, extractProvenance, describeParts } from '$lib/events/conferencing';
  import { setPageTools, clearPageTools } from '$lib/pageTools.svelte';
  import { onMount, onDestroy, untrack } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { get } from 'svelte/store';
  import { scope as globalScope } from '$lib/scope';

  // ─── Props ────────────────────────────────────────────────────────────────
  type Props = {
    /** Anchor month — first of the month rendered. Default: today's month. */
    initialDate?: Date;
  };
  let { initialDate = new Date() }: Props = $props();

  // ─── View state ───────────────────────────────────────────────────────────
  // Use the prop only on first render; subsequent navigation owns `cursor`.
  // eslint-disable-next-line svelte/no-svelte-internal
  const _initial = initialDate;
  // `cursor` is generic: month-anchored in Month view, week-start in Week
  // view, single-day in Day view. We normalise it whenever the view flips.
  let cursor = $state(startOfMonth(_initial));
  type ViewMode = 'month' | 'week' | 'day' | 'list';
  let view = $state<ViewMode>('month');
  let events = $state<CalendarEvent[]>([]);
  let loading = $state(false);
  let error = $state('');

  // Calendar "types" — the five sub-calendars that used to each have their
  // own landing tile. Every event classifies into exactly one (see
  // `calBucketOf`), so these read as one unified calendar you filter by
  // type. All on by default; the user can hide noisy ones.
  type CalKey = 'mine' | 'social' | 'holidays' | 'birthdays' | 'projects';
  const CAL_KEYS: CalKey[] = ['mine', 'social', 'holidays', 'birthdays', 'projects'];
  const CAL_LABELS: Record<CalKey, string> = {
    mine: 'My calendars',
    social: 'Social',
    holidays: 'Public holidays',
    birthdays: 'Birthdays',
    projects: 'Projects'
  };
  const CAL_COLORS: Record<CalKey, string> = {
    mine: '#2C8C99',      // brand teal
    social: '#6B5ADB',
    holidays: '#F87171',
    birthdays: '#C6762A',
    projects: '#22C55E'
  };
  let visibleCals = $state<Record<CalKey, boolean>>({
    mine: true,
    social: true,
    holidays: true,
    birthdays: true,
    projects: true
  });

  // ─── Advanced filters ────────────────────────────────────────────────────
  // Empty set / 'all' means "no constraint" — events pass through. This
  // matches the chip-row UX on /grants and lets URL state stay terse
  // (?projects=1,2 only appears when there's something to communicate).
  let filterPanelOpen = $state(false);
  let allProjects = $state<Project[]>([]);
  let selectedProjectIds = $state<Set<number>>(new Set());
  // Seed from the app-wide Work/Private toggle so the calendar follows the
  // global mode by default. A `?scope=` deep-link (below) overrides it on
  // load; after that, flipping the global toggle re-syncs this (see effect).
  let scopeFilter = $state<'all' | 'work' | 'private' | 'both'>(get(globalScope));
  let scopeFromUrl = $state(false);
  let kindFilter = $state<Set<string>>(new Set());
  let calendarFilter = $state<Set<string>>(new Set());
  /** Set to true once URL → state hydration has finished, so the write-back
   *  $effect doesn't immediately strip the user's deep-link params. */
  let filterReady = $state(false);
  /** Set from ?event=<datesId> on mount. Once the events for the
   *  current range have loaded, an $effect below finds the matching
   *  one and opens its detail dialog. Cleared after the first
   *  successful open so navigating around the calendar doesn't keep
   *  re-popping the same dialog. */
  let pendingOpenEventId = $state<number | null>(null);

  // Catalogue of event_type values seen in the current window — feeds
  // the Kind chip row. We could hard-code the DateEventKind union but
  // surfacing only the kinds actually present keeps the chip row tight.
  const kindOptionsInRange = $derived.by(() => {
    const set = new Set<string>();
    for (const e of events) if (e.kind) set.add(String(e.kind));
    return [...set].sort();
  });
  const calendarOptionsInRange = $derived.by(() => {
    const set = new Set<string>();
    for (const e of events) {
      const c = (e.meta?.external_calendar as string | null | undefined) || null;
      if (c) set.add(c);
    }
    return [...set].sort();
  });

  function projectIdOf(e: CalendarEvent): number | null {
    const m = e.meta as Record<string, unknown> | undefined;
    if (!m) return null;
    const a = m.project_id;
    if (typeof a === 'number') return a;
    const b = m.projectId;
    if (typeof b === 'number') return b;
    const p = m.project as { id?: number } | null | undefined;
    if (p && typeof p.id === 'number') return p.id;
    return null;
  }

  function passesAdvancedFilters(e: CalendarEvent): boolean {
    if (selectedProjectIds.size > 0) {
      const pid = projectIdOf(e);
      if (pid == null || !selectedProjectIds.has(pid)) return false;
    }
    if (scopeFilter !== 'all') {
      // 'both'-scoped events are considered to pass either personal or work
      // filter; this matches how scope is rendered elsewhere in the app.
      const s = e.scope ?? null;
      if (scopeFilter === 'work' && !(s === 'work' || s === 'both')) return false;
      if (scopeFilter === 'private' && !(s === 'private' || s === 'both')) return false;
      if (scopeFilter === 'both' && s !== 'both') return false;
    }
    if (kindFilter.size > 0 && !kindFilter.has(String(e.kind))) return false;
    if (calendarFilter.size > 0) {
      const c = (e.meta?.external_calendar as string | null | undefined) || null;
      if (!c || !calendarFilter.has(c)) return false;
    }
    return true;
  }

  const activeFilterCount = $derived(
    (selectedProjectIds.size > 0 ? 1 : 0) +
      (scopeFilter !== 'all' ? 1 : 0) +
      (kindFilter.size > 0 ? 1 : 0) +
      (calendarFilter.size > 0 ? 1 : 0) +
      (CAL_KEYS.some((k) => !visibleCals[k]) ? 1 : 0)
  );

  function clearAllFilters() {
    selectedProjectIds = new Set();
    scopeFilter = 'all';
    kindFilter = new Set();
    calendarFilter = new Set();
    visibleCals = { mine: true, social: true, holidays: true, birthdays: true, projects: true };
  }

  // ─── Mobile tools menu (contextual chrome button) ─────────────────────────
  // The chrome's per-page action button (sliders icon) opens a fullscreen
  // CalendarToolsSheet with the event search + filters. Open-state rides the
  // URL (?tools=1) — the chrome trigger lives in the layout and performs a
  // global navigation, so it works regardless of which calendar instance is
  // live (the on-load URL settle can briefly re-instantiate this component).
  // We mirror the param into local $state via an $effect (a plain $derived
  // off $page did not re-evaluate reliably here).
  let showTools = $state(false);
  $effect(() => { showTools = $page.url.searchParams.has('tools'); });
  function setToolsParam(open: boolean) {
    if (typeof window === 'undefined') return;
    const u = new URL(window.location.href);
    if (open) u.searchParams.set('tools', '1'); else u.searchParams.delete('tools');
    void goto(`${u.pathname}${u.search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }
  function closeTools() { setToolsParam(false); }

  $effect(() => {
    const badge = activeFilterCount || undefined;
    setPageTools({ icon: 'sliders', label: 'Calendar tools', onOpen: () => setToolsParam(true), badge });
  });
  onDestroy(() => clearPageTools());

  // Picking a search result: jump the calendar to that day and open it.
  function jumpToEvent(row: DateEvent) {
    const ce = dateRowToCalendarEvent(row);
    if (!ce) { closeTools(); return; }
    cursor = startOfDay(ce.start);
    view = 'day';
    persistView();
    if (navReady) syncNavUrl(true); // syncNavUrl drops ?tools, closing the sheet
    void openEvent(ce);
  }

  // URL ↔ state. On mount we read params; afterwards we write them back
  // whenever the filter state changes (without adding to history — replaceState
  // so back-button still moves the user, not a filter tweak).
  onMount(async () => {
    const sp = get(page).url.searchParams;

    // ── Restore view + period ──────────────────────────────────────
    // Priority: explicit ?view= in the URL → last-used view from
    // localStorage → the 'month' default. ?d= sets the period,
    // re-anchored to whatever view we land on.
    const urlView = sp.get('view');
    if (urlView === 'month' || urlView === 'week' || urlView === 'day' || urlView === 'list') {
      view = urlView;
    } else {
      try {
        const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
        if (saved === 'month' || saved === 'week' || saved === 'day' || saved === 'list') view = saved;
      } catch { /* ignore */ }
    }
    // Always open on today's period (anchored to whatever view we land
    // on). We deliberately don't restore a browsed date — the calendar
    // should land on "now" every time it's opened, not on whatever month
    // happened to be in the URL from a previous visit.
    cursor = anchorFor(view, new Date());

    if (sp.has('cals')) {
      // New model: ?cals= lists the visible calendar types.
      const on = new Set(sp.get('cals')!.split(',').filter(Boolean));
      visibleCals = {
        mine: on.has('mine'),
        social: on.has('social'),
        holidays: on.has('holidays'),
        birthdays: on.has('birthdays'),
        projects: on.has('projects')
      };
    } else if (sp.has('source')) {
      // Legacy deep-links from the old per-calendar tiles (?source=manual etc.).
      const allowed = new Set(sp.get('source')!.split(',').filter(Boolean));
      const manual = allowed.has('manual');
      visibleCals = {
        mine: manual || allowed.has('sync'),
        social: manual,
        holidays: manual,
        birthdays: allowed.has('birthday_derived') || allowed.has('birthday') || allowed.has('birthdays'),
        projects: allowed.has('project_derived') || allowed.has('project') || allowed.has('projects')
      };
    }
    if (sp.has('projects')) {
      selectedProjectIds = new Set(
        sp.get('projects')!.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
      );
    }
    if (sp.has('scope')) {
      const v = sp.get('scope')!;
      if (v === 'work' || v === 'private' || v === 'both') {
        scopeFilter = v;
        scopeFromUrl = true;
      }
    }
    if (sp.has('kind')) {
      kindFilter = new Set(sp.get('kind')!.split(',').filter(Boolean));
    }
    if (sp.has('cal')) {
      calendarFilter = new Set(sp.get('cal')!.split(',').filter(Boolean));
    }
    if (sp.has('event')) {
      const n = Number(sp.get('event'));
      if (Number.isFinite(n) && n > 0) pendingOpenEventId = n;
    }

    // Fetch all active projects for the tree. searchProjects('', 500) is the
    // right call — picks up every non-archived project across kinds (core,
    // university, course, cohort, etc.) sorted alphabetically.
    try {
      allProjects = await searchProjects('', 500);
    } catch {
      allProjects = [];
    }

    filterReady = true;

    // Mirror the restored view/period into the URL (replace, so we don't
    // add a history entry for simply landing on the page). From here on,
    // nav functions keep the URL in sync. navReady gates those writes
    // until this initial sync has run.
    navReady = true;
    syncNavUrl(false);
  });

  // Browser Back/Forward changes the URL but not component state — this
  // effect applies URL → state so navigating history actually moves the
  // calendar. It tracks ONLY $page.url (state writes are wrapped in
  // untrack) so a user-driven view/cursor change here doesn't fight the
  // nav functions that set state directly then push the URL.
  $effect(() => {
    const sp = $page.url.searchParams;
    const v = sp.get('view');
    untrack(() => {
      if (!navReady) return;
      if ((v === 'month' || v === 'week' || v === 'day' || v === 'list') && v !== view) {
        view = v;
        persistView();
      }
      // Note: we intentionally don't sync the period from `?d=` — the
      // calendar always opens on today and `?d=` is no longer persisted.
    });
  });

  // Desktop keyboard shortcuts (←/→, T, M/W/D/L, N). Separate from the
  // async onMount above so we can return a cleanup function.
  onMount(() => {
    window.addEventListener('keydown', onCalendarKey);
    return () => window.removeEventListener('keydown', onCalendarKey);
  });

  // Auto-scroll the timed grid so "now" is centred when Day/Week opens on
  // today. Without this the long 06:00-start timeline always lands at the
  // top and the user scrolls to find their next meeting. Re-runs whenever
  // the view or cursor changes; only acts when the active period contains
  // today and the now-line is actually rendered.
  let didScrollToNow = false;
  $effect(() => {
    // Touch reactive deps so the effect re-runs on view/cursor change.
    const v = view; const c = cursor; void c;
    if (v !== 'day' && v !== 'week') { didScrollToNow = false; return; }
    if (!isViewingToday) { didScrollToNow = false; return; }
    if (didScrollToNow) return;
    if (typeof document === 'undefined') return;
    // Defer to the next frame so the grid + now-line have rendered.
    requestAnimationFrame(() => {
      const line = document.querySelector('.cal-now-line');
      if (line) {
        line.scrollIntoView({ behavior: 'smooth', block: 'center' });
        didScrollToNow = true;
      }
    });
  });

  // Auto-open an event when the page was navigated to via
  // /calendar/grid?event=<id> (e.g. from the home "Today" card).
  // Waits for `events` to be populated, finds the matching DateEvent
  // by datesId, opens it, then clears the pending id so this only
  // fires once per navigation.
  $effect(() => {
    if (pendingOpenEventId == null || loading) return;
    const match = events.find((e) => e.datesId === pendingOpenEventId);
    if (!match) return;
    const id = pendingOpenEventId;
    pendingOpenEventId = null;
    void openEvent(match);
    // Strip the ?event= param so back-and-forth in the calendar
    // doesn't re-open the same dialog every time the route changes.
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('event') === String(id)) {
        params.delete('event');
        const qs = params.toString();
        const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', next);
      }
    }
  });

  $effect(() => {
    if (!filterReady) return;
    // Touch every reactive piece we care about so this effect re-runs.
    const params = new URLSearchParams(get(page).url.searchParams);
    const setOrDel = (k: string, v: string | null) => {
      if (v && v.length) params.set(k, v); else params.delete(k);
    };
    const calsOn = CAL_KEYS.filter((k) => visibleCals[k]);
    // Only emit ?cals when at least one type is hidden — otherwise the
    // param is noise. Drop the legacy ?source param on write.
    params.delete('source');
    setOrDel(
      'cals',
      calsOn.length < CAL_KEYS.length ? calsOn.join(',') : null
    );
    setOrDel('projects', selectedProjectIds.size ? [...selectedProjectIds].join(',') : null);
    setOrDel('scope', scopeFilter === 'all' ? null : scopeFilter);
    setOrDel('kind', kindFilter.size ? [...kindFilter].join(',') : null);
    setOrDel('cal', calendarFilter.size ? [...calendarFilter].join(',') : null);
    const qs = params.toString();
    const target = qs ? `?${qs}` : get(page).url.pathname;
    goto(target, { replaceState: true, keepFocus: true, noScroll: true });
  });

  // Follow the app-wide Work/Private toggle. The first application (when
  // filters finish hydrating) is skipped if a `?scope=` deep-link already
  // set the filter, so links keep winning on load; every later flip of the
  // global toggle mirrors straight into the calendar.
  let globalSyncArmed = false;
  $effect(() => {
    const g = $globalScope;
    untrack(() => {
      if (!filterReady) return;
      if (!globalSyncArmed) {
        globalSyncArmed = true;
        if (scopeFromUrl) return;
      }
      if (scopeFilter !== g) scopeFilter = g;
    });
  });

  // ─── Date math ────────────────────────────────────────────────────────────
  function startOfMonth(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  }
  function endOfMonth(d: Date) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
  }
  function startOfWeek(d: Date) {
    // Monday-first week, matching Iceland convention.
    const x = new Date(d);
    const dow = (x.getDay() + 6) % 7; // Mon=0..Sun=6
    x.setDate(x.getDate() - dow);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function addDays(d: Date, n: number) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function sameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function isoDay(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 6×7 grid covering the visible month plus leading/trailing days.
  const gridStart = $derived(startOfWeek(cursor));
  const gridEnd = $derived(addDays(gridStart, 42));
  const gridDays = $derived.by(() => {
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));
    return days;
  });
  const today = $derived(new Date());

  // Range covered by the currently-active view — what we ask Directus for.
  const viewRange = $derived.by<{ start: Date; end: Date }>(() => {
    if (view === 'month' || view === 'list') return { start: gridStart, end: gridEnd };
    if (view === 'week') {
      const start = startOfWeek(cursor);
      return { start, end: addDays(start, 7) };
    }
    const start = startOfDay(cursor);
    return { start, end: addDays(start, 1) };
  });
  const weekDays = $derived.by(() => {
    const s = startOfWeek(cursor);
    return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(s, i));
  });

  // ─── Loading ──────────────────────────────────────────────────────────────
  // Re-run whenever the rendered range changes.
  $effect(() => {
    void loadRange(viewRange.start, viewRange.end);
  });

  async function loadRange(start: Date, end: Date) {
    loading = true;
    error = '';
    try {
      const [rows, birthdays, projects] = await Promise.all([
        listDatesInRange(start, end),
        listBirthdaysInRange(start, end),
        listProjectSpansInRange(start, end)
      ]);
      // Expand each row (recurring or not) into the occurrences that
      // fall inside the visible window, then map them to the
      // CalendarEvent shape with a per-occurrence key so adjacent
      // years render side-by-side without remount churn.
      const stored: CalendarEvent[] = [];
      for (const row of rows) {
        for (const occ of expandRecurrence(row, start, end)) {
          const ce = dateRowToCalendarEvent({ ...row, start: occ.start, end: occ.end } as DateEvent);
          if (ce) stored.push({ ...ce, key: occ.key });
        }
      }
      events = [...stored, ...birthdays, ...projects];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  // ─── Bucketing per week (bars) and per day (timed) ────────────────────────
  // Multi-day and all-day events render as continuous *bars* that span across
  // day cells in a week row, breaking and continuing on the next row. Lane
  // assignment is greedy first-fit per week. Single-day timed events render as
  // small chips inside the day cell with their start time.

  /** A bar segment of an event within a single week row. */
  type WeekBar = {
    event: CalendarEvent;
    startDayIdx: number; // 0..6
    span: number;        // 1..7
    lane: number;        // 0..N (rendered as grid-row)
    /** Whether the bar visually continues beyond this week segment. */
    continuesLeft: boolean;
    continuesRight: boolean;
  };

  type WeekLayout = {
    weekStart: Date;
    bars: WeekBar[];
    laneCount: number;
    timedByDay: Map<string, CalendarEvent[]>;
  };

  function computeWeekLayout(weekStart: Date, allEvents: CalendarEvent[]): WeekLayout {
    const weekEnd = addDays(weekStart, 7);
    const passes = (e: CalendarEvent) => visibleCals[calBucketOf(e)] && passesAdvancedFilters(e);
    const filtered = allEvents.filter(passes);

    // Multi-day or all-day → bar.
    const barEvents = filtered.filter((e) => e.allDay || !sameDay(e.start, e.end));
    // Restrict to events touching this week.
    const inWeek = barEvents.filter((e) => e.start < weekEnd && e.end >= weekStart);
    // Sort: longer spans first so they grab lower lanes; stable on start.
    inWeek.sort((a, b) => {
      const da = (b.end.getTime() - b.start.getTime()) - (a.end.getTime() - a.start.getTime());
      if (da !== 0) return da;
      return a.start.getTime() - b.start.getTime();
    });

    const laneTails: number[] = []; // exclusive end-day-idx per lane
    const bars: WeekBar[] = [];
    for (const e of inWeek) {
      const startIdx = Math.max(0, Math.floor((startOfDay(e.start).getTime() - weekStart.getTime()) / 86400000));
      const endIdxInclusive = Math.min(6, Math.floor((startOfDay(e.end).getTime() - weekStart.getTime()) / 86400000));
      if (endIdxInclusive < 0 || startIdx > 6) continue;
      const span = endIdxInclusive - startIdx + 1;
      // Find first lane whose tail <= startIdx.
      let lane = laneTails.findIndex((t) => t <= startIdx);
      if (lane === -1) {
        lane = laneTails.length;
        laneTails.push(0);
      }
      laneTails[lane] = startIdx + span;
      bars.push({
        event: e,
        startDayIdx: startIdx,
        span,
        lane,
        continuesLeft: e.start < weekStart,
        continuesRight: e.end >= weekEnd
      });
    }

    // Timed (single-day, not all-day) events bucketed per day.
    const timedByDay = new Map<string, CalendarEvent[]>();
    for (let i = 0; i < 7; i++) timedByDay.set(isoDay(addDays(weekStart, i)), []);
    for (const e of filtered) {
      if (e.allDay || !sameDay(e.start, e.end)) continue;
      const k = isoDay(e.start);
      const arr = timedByDay.get(k);
      if (arr) arr.push(e);
    }
    for (const arr of timedByDay.values()) {
      arr.sort((a, b) => a.start.getTime() - b.start.getTime());
    }

    return { weekStart, bars, laneCount: laneTails.length, timedByDay };
  }

  function startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  const weekLayouts = $derived.by(() => {
    const out: WeekLayout[] = [];
    for (let w = 0; w < 6; w++) {
      out.push(computeWeekLayout(addDays(gridStart, w * 7), events));
    }
    return out;
  });

  function calBucketOf(e: CalendarEvent): CalKey {
    if (e.source === 'birthday_derived') return 'birthdays';
    if (e.source === 'project_derived') return 'projects';
    const kind = String(e.kind ?? '').toLowerCase();
    // Stored birthday rows (event_type=birthday) group with the derived
    // ones so "Birthdays" hides every cake, not just the auto-generated.
    if (kind === 'birthday' || kind === 'birthdays') return 'birthdays';
    if (kind === 'holiday' || kind === 'holidays') return 'holidays';
    if (kind === 'social') return 'social';
    // Manual, synced, or anything else → "My calendars".
    return 'mine';
  }

  // ─── Navigation ───────────────────────────────────────────────────────────
  // View-aware nav. Step size is one month / one week / one day depending on
  // the active view.
  function step(delta: number) {
    if (view === 'month' || view === 'list') {
      // List view paginates a month at a time — same range, same step.
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    } else if (view === 'week') {
      cursor = addDays(startOfWeek(cursor), delta * 7);
    } else {
      cursor = addDays(startOfDay(cursor), delta);
    }
    // Date steps replace the current history entry — swiping through a
    // month of days shouldn't bury the page you arrived from.
    if (navReady) syncNavUrl(false);
  }
  function goPrev() { step(-1); }
  function goNext() { step(1); }

  // ─── View + cursor persistence (URL = source of truth) ────────────────────
  // The calendar's view and visible period live in the URL (?view=&d=) so:
  //   • browser Back undoes a view switch (week→day→Back lands on week)
  //     instead of leaving the calendar entirely, and
  //   • the period is bookmarkable / shareable.
  // View switches push a history entry; date steps replace (so swiping 10
  // days doesn't bury the page you came from under 10 entries). The
  // last-used view is also mirrored to localStorage so returning to the
  // calendar with no params reopens where you left off.
  const VIEW_STORAGE_KEY = 'twin.calendar.view.v1';
  let navReady = $state(false);

  function anchorFor(v: ViewMode, d: Date): Date {
    if (v === 'month' || v === 'list') return startOfMonth(d);
    if (v === 'week') return startOfWeek(d);
    return startOfDay(d);
  }

  function syncNavUrl(push: boolean) {
    if (typeof window === 'undefined') return;
    const cur = get(page).url;
    const params = new URLSearchParams(cur.searchParams);
    params.set('view', view);
    // Don't persist the browsed period in the URL — otherwise a reload or
    // restored tab reopens the calendar on a stale month instead of today.
    params.delete('d');
    params.delete('tools'); // any view/date nav closes the tools sheet
    const qs = params.toString();
    const target = `${cur.pathname}${qs ? `?${qs}` : ''}`;
    void goto(target, { replaceState: !push, keepFocus: true, noScroll: true });
  }
  function persistView() {
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* ignore */ }
  }

  // ─── Slot time from a grid click ──────────────────────────────────────────
  // Translate a click inside a Day/Week timed column into the hour:minute it
  // landed on, rounded to the nearest 30 minutes. Used to open the add-event
  // dialog pre-filled with a timed slot instead of an all-day default.
  function slotTimeFromClick(ev: MouseEvent): { hour: number; minute: number } {
    const el = ev.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    const total = DAY_START_HOUR * 60 + (y / HOUR_PX) * 60;
    const rounded = Math.round(total / 30) * 30;
    const hour = Math.max(0, Math.min(23, Math.floor(rounded / 60)));
    const minute = rounded % 60;
    return { hour, minute };
  }

  // ─── Swipe navigation ─────────────────────────────────────────────────────
  // Horizontal swipes on the grid step prev/next. We axis-lock: a gesture only
  // counts as a swipe once horizontal travel clearly beats vertical (so the
  // page can still scroll the long Day/Week timeline). A short slide-out /
  // slide-in animation makes the step feel like content movement.
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeActive = false;
  let slideDir = $state<'' | 'left' | 'right'>(''); // drives the transition class
  const SWIPE_THRESHOLD = 56; // px of horizontal travel to commit
  function onSwipeStart(e: TouchEvent) {
    if (e.touches.length !== 1) { swipeActive = false; return; }
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeActive = true;
  }
  function onSwipeEnd(e: TouchEvent) {
    if (!swipeActive) return;
    swipeActive = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStartX;
    const dy = t.clientY - swipeStartY;
    // Axis-lock: horizontal must dominate and clear the threshold.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) {
      slideDir = 'left';  // content exits left → next period
      goNext();
    } else {
      slideDir = 'right'; // content exits right → previous period
      goPrev();
    }
    // Clear the animation flag after it plays so the next render is static.
    setTimeout(() => { slideDir = ''; }, 260);
  }

  // ─── Keyboard navigation ──────────────────────────────────────────────────
  // Desktop shortcuts. Ignored while typing in a field or when the event
  // dialog / a section editor is open, so we never hijack normal input.
  function onCalendarKey(e: KeyboardEvent) {
    if (formOpen) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); goPrev(); break;
      case 'ArrowRight': e.preventDefault(); goNext(); break;
      case 't': case 'T': e.preventDefault(); goToday(); break;
      case 'm': case 'M': e.preventDefault(); setView('month'); break;
      case 'w': case 'W': e.preventDefault(); setView('week'); break;
      case 'd': case 'D': e.preventDefault(); setView('day'); break;
      case 'l': case 'L': e.preventDefault(); setView('list'); break;
      case 'n': case 'N': e.preventDefault(); openAdd(view === 'day' ? cursor : new Date()); break;
    }
  }
  function goToday() {
    const now = new Date();
    if (view === 'month' || view === 'list') cursor = startOfMonth(now);
    else if (view === 'week') cursor = startOfWeek(now);
    else cursor = startOfDay(now);
    if (navReady) syncNavUrl(false);
  }
  // Disable / dim the Today button when the user is already looking
  // at "today" in the active view — nothing to do, and the visual
  // change gives feedback that the action just happened.
  const isViewingToday = $derived.by(() => {
    const now = new Date();
    if (view === 'month' || view === 'list') {
      return cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth();
    }
    if (view === 'week') {
      return startOfWeek(cursor).getTime() === startOfWeek(now).getTime();
    }
    return sameDay(cursor, now);
  });
  // When the user switches view, re-anchor `cursor` so the new view shows
  // a sensible "you are here" date.
  //
  // The trap we hit before: in Month view, `cursor` is the first of the
  // displayed month (always — even for the current month). Naively calling
  // `startOfWeek(cursor)` on May 1 lands on April 27, so the Week tab
  // ended up showing last April's last week instead of *this* week. Same
  // bug shrinking to Day: you'd land on the 1st, never today.
  //
  // Rule: if the displayed month/week contains today, anchor on today.
  // Otherwise (user navigated to a future or past month), keep their
  // anchor at the first of that month / week.
  function setView(next: ViewMode) {
    if (next === view) return;
    const now = new Date();
    const cursorInThisMonth =
      cursor.getFullYear() === now.getFullYear() &&
      cursor.getMonth() === now.getMonth();
    if (next === 'month' || next === 'list') {
      cursor = startOfMonth(cursor);
    } else if (next === 'week') {
      cursor = startOfWeek(cursorInThisMonth ? now : cursor);
    } else {
      cursor = startOfDay(cursorInThisMonth ? now : cursor);
    }
    view = next;
    persistView();
    // View switches PUSH a history entry, so Back returns to the
    // previous view rather than exiting the calendar.
    if (navReady) syncNavUrl(true);
  }

  // Jump to a specific day in Day view (month day-cell tap, week header
  // tap). Unlike setView it keeps the exact clicked day rather than
  // re-anchoring to today, and pushes a history entry so Back returns
  // to the view the user drilled from.
  function openDay(d: Date) {
    cursor = startOfDay(d);
    view = 'day';
    persistView();
    if (navReady) syncNavUrl(true);
  }

  // ─── Add / edit form (shared) ─────────────────────────────────────────────
  // One modal handles both creating a new event and editing an existing one.
  // mode === 'view' for derived (read-only) events.
  type FormMode = 'add' | 'edit' | 'view';
  let formOpen = $state(false);
  let formMode = $state<FormMode>('add');
  let formEvent = $state<CalendarEvent | null>(null); // present in edit/view modes
  let formAnchorDate = $state<Date | null>(null); // present in add mode
  let fTitle = $state('');
  let fKind = $state<string>('event');
  let fAllDay = $state(true);
  let fStartDate = $state(''); // YYYY-MM-DD (used in edit/multi-day add)
  let fEndDate = $state('');
  let fStartTime = $state('09:00');
  let fEndTime = $state('10:00');
  let fDescription = $state('');
  let fScope = $state<'work' | 'private' | 'both' | ''>('');
  let fLocation = $state('');
  // The structured place behind the free text, when we have one. Both are
  // written: the reference is what makes "most used" countable, the text is
  // what a calendar feed gives us and what still renders if nobody resolves
  // it. See the Places section of directus.ts.
  let fPlaceId = $state<number | null>(null);
  let placeSuggestions = $state<PlaceSuggestion[]>([]);
  // Recurrence — checkbox + frequency + interval. Stored as a tiny
  // RRULE string ("FREQ=YEARLY", "FREQ=MONTHLY;INTERVAL=2", …) and
  // expanded into occurrences by $lib/recurrence.
  let fRecurring = $state(false);
  let fFreq = $state<'YEARLY' | 'MONTHLY' | 'WEEKLY' | 'DAILY'>('WEEKLY');
  let fInterval = $state(1);
  let saving = $state(false);

  // Compact-form state: only one optional-field section expands at a
  // time. Empty means everything is collapsed to pill buttons. Reset
  // by `resetConnectionPickers` further down + on each form reopen.
  type Section = 'location' | 'project' | 'org' | 'people' | 'notes';
  let openSection = $state<Section | null>(null);
  function toggleSection(s: Section) {
    openSection = openSection === s ? null : s;
    if (openSection === 'location') void loadPlaceSuggestions();
  }

  /**
   * What to offer when someone opens the location panel.
   *
   * Org first: if this event already has KLAK on it, KLAK's places are the
   * answer far more often than anything else, and they arrive ranked by how
   * many meetings actually happened there. Only when there is no org — or it
   * has no places yet — do we fall back to "what is near me", which costs a
   * geolocation prompt and so is not worth spending otherwise.
   */
  async function loadPlaceSuggestions() {
    placeSuggestions = [];
    if (fOrgId) {
      placeSuggestions = await placesForOrg(fOrgId);
      if (placeSuggestions.length > 0) return;
    }
    try {
      const { lat, lon } = await getPosition();
      placeSuggestions = await placesNear({ lat, lon });
    } catch {
      // No permission, no fix — the free-text field still works.
    }
  }

  function pickPlace(sug: PlaceSuggestion) {
    fPlaceId = sug.place.id;
    fLocation = placeLabel(sug.place);
    closeSection();
  }

  /** Save the typed text as a real place, attached to the event's org. */
  let savingPlace = $state(false);
  async function savePlaceFromText() {
    const name = fLocation.trim();
    if (!name || savingPlace) return;
    savingPlace = true;
    try {
      const place = await createPlace({ name, orgId: fOrgId, role: 'office' });
      fPlaceId = place.id;
      await loadPlaceSuggestions();
    } finally {
      savingPlace = false;
    }
  }
  function closeSection() { openSection = null; }

  // Connection pickers — project (M2O), org (M2O), people (M2M).
  let fProjectId = $state<number | null>(null);
  let fProjectLabel = $state('');
  let fOrgId = $state<number | null>(null);
  let fOrgLabel = $state('');
  // Connected people on the form. `picture` + `focal` are kept here
  // so the stacked-avatar preview can render real photos without a
  // second round-trip; falls back to initials in the Avatar
  // component when no picture is on file.
  type FormPerson = {
    id: number;
    name: string;
    junctionId?: number;
    picture?: string | null;
    focal?: string | null;
  };
  let fPeople = $state<FormPerson[]>([]);
  // Track original people so we know what to detach on save.
  let fPeopleOriginal = $state<{ id: number; junctionId: number }[]>([]);

  // View-mode tab on the read-only dialog. Defaults to Details on
  // every open so the user always lands on the most-asked-for info.
  // The view sheet used to carry a Details/Attendees tab strip. Details was
  // usually one line ("No description.") and the tabs cost a whole row of
  // chrome to hide the attendee list — which is the only part with real work
  // in it (resolve to contacts, pick between ambiguous matches, create a
  // contact from an email). So: no tabs. Details is always shown, and the
  // attendee roster expands from the avatar stack that already sat in the
  // header. `viewTab` stays as the expansion flag other code still sets.
  type ViewTab = 'details' | 'attendees';
  let viewTab = $state<ViewTab>('details');
  const attendeesOpen = $derived(viewTab === 'attendees');

  // ── Where the peek lives ────────────────────────────────────────────
  // A calendar is a browsing surface: you compare Tuesday against Thursday
  // and open three events in a row. A centred modal makes that
  // open→read→close→open→read→close, and on a 1376px screen it dimmed the
  // grid to show a 448px card. On desktop the peek is a docked rail
  // instead — the grid keeps its clicks, and picking another event just
  // swaps the rail's contents. Phones keep the sheet; it is genuinely the
  // right shape there.
  //
  // 768px matches BottomSheet's own breakpoint so the two can't disagree
  // about which mode is current.
  let isDesktop = $state(false);
  $effect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => (isDesktop = mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  });

  // Only the read-only peek becomes a rail. Add/edit stays a modal: it is a
  // focused task with a Save button, and dimming the page is correct there.
  const railOpen = $derived(formOpen && formMode === 'view' && !!formEvent && isDesktop);
  const sheetOpen = $derived(formOpen && !railOpen);

  // Google Calendar descriptions are dial-in boilerplate: a row of
  // '-::~:~::~' separators, a Meet URL, a PIN, then a phone-number list. At
  // full height that buried the attendee roster below the fold in a peek
  // whose whole job is to fit on one screen. Clamped, with the full text one
  // tap away — and on the event record for anything longer.
  let peekDescOpen = $state(false);
  // A description is up to three different things wearing one coat: how to
  // join, how the row got here, and what somebody actually wrote. Splitting
  // them means the join details become buttons, the provenance becomes a
  // footnote, and only the real text is left to clamp.
  const peekConf = $derived(
    parseConferencing(
      formEvent?.meta?.description as string | undefined,
      formEvent?.meta?.virtual_link as string | undefined
    )
  );
  const peekProvenance = $derived(
    extractProvenance(stripMeetingBoilerplate(formEvent?.meta?.description as string | undefined))
  );
  const peekDesc = $derived(peekProvenance.rest);
  const peekDescParts = $derived(describeParts(peekDesc));
  // Thresholds track the space each surface actually has: the rail is full
  // height, the expanded phone sheet is 78vh, and the old 180 was sized for
  // a 280px compact body that no longer exists.
  const peekDescIsLong = $derived(peekDesc.length > (isDesktop ? 900 : 520));

  // ── Attendee resolution ──────────────────────────────────────────
  // When a synced event opens we look up each attendee's email
  // against Person.email. Results feed both the in-dialog display
  // (name + status pill, or "Add as contact" button for orphans)
  // and the auto-attach to Dates_Person so a calendar invitee
  // becomes a meeting attendee link the same way a hand-added
  // person would.
  type AttendeeRow = {
    name: string;
    email: string;
    status: string;
    matches: Person[];      // resolved Person rows for this email
    creating?: boolean;     // local "creating new contact" state
  };
  let attendeeRows = $state<AttendeeRow[]>([]);
  let attendeeError = $state<string>('');

  // ── Linking an attendee to a contact that already exists ────────────
  // Matching is by email, so an attendee whose contact is filed under a
  // different address resolved to zero matches and the only offer was
  // "+ Add as contact" — which makes a duplicate of somebody already in
  // the database. This is the search that was missing.
  //
  // Keyed by email (falling back to name) so only one row's search is open
  // and the rows don't need extra fields threaded through resolveAttendees.
  const attendeeKey = (r: AttendeeRow) => r.email || r.name;

  // ── Group addresses ────────────────────────────────────────────────
  // team@klak.is is not a person. Matched by email it resolved to nobody,
  // so the only offer was "+ New" — which creates a contact called "team".
  // An EmailGroup says who the address means; the row offers to attach all
  // of them instead.
  let emailGroups = $state<Map<string, import('$lib/directus').EmailGroup>>(new Map());
  let groupBusy = $state<string | null>(null);
  let groupDone = $state<string | null>(null);
  const groupFor = (r: AttendeeRow) => emailGroups.get(r.email.trim().toLowerCase()) ?? null;

  // Resolved membership per group address. Populated when a sheet containing
  // a group row opens, so the row can say how much of the group is already
  // here rather than remembering that it once attached them.
  let groupMembers = $state<Map<string, Person[]>>(new Map());

  /** How much of this group is on the event: [attached, total]. total 0 means
   *  membership hasn't resolved yet — the row shows the plain offer. */
  function groupTally(r: AttendeeRow): [number, number] {
    const members = groupMembers.get(r.email.trim().toLowerCase());
    if (!members) return [0, 0];
    const here = new Set(fPeople.map((p) => p.id));
    return [members.filter((m) => here.has(m.id)).length, members.length];
  }

  /** Resolve membership for every group address on this event, once each. */
  async function loadGroupMembers(rows: AttendeeRow[]) {
    for (const r of rows) {
      const g = groupFor(r);
      if (!g) continue;
      const key = r.email.trim().toLowerCase();
      if (groupMembers.has(key)) continue;
      try {
        const { people } = await resolveEmailGroup(g);
        groupMembers = new Map(groupMembers).set(key, people);
      } catch {
        /* leave unresolved; the row falls back to the plain offer */
      }
    }
  }

  /** Attach every member of the group behind this attendee row. */
  async function attachGroup(row: AttendeeRow) {
    const group = groupFor(row);
    if (!group || !formEvent?.datesId || groupBusy) return;
    groupBusy = attendeeKey(row);
    attendeeError = '';
    try {
      const { people } = await resolveEmailGroup(group);
      const already = new Set(fPeople.map((p) => p.id));
      let added = 0;
      for (const person of people) {
        if (already.has(person.id)) continue;
        const link = await attachPersonToDate(formEvent.datesId, person.id);
        fPeople = [...fPeople, {
          id: person.id,
          name: personName(person),
          junctionId: link.id,
          picture: person.person_picture ?? null,
          focal: person.image_focal ?? null
        }];
        fPeopleOriginal = [...fPeopleOriginal, { id: person.id, junctionId: link.id }];
        already.add(person.id);
        added += 1;
      }
      // Collapse the row to the group's people so it stops reading as
      // unresolved, and say how many were new vs already on the event.
      // Cache the membership so the tally is exact straight away, and leave
      // `matches` empty — these people are attached, not candidates to
      // disambiguate between. The row's counts derive from fPeople, which the
      // loop above just grew, so nothing needs patching onto the row.
      groupMembers = new Map(groupMembers).set(row.email.trim().toLowerCase(), people);
      groupDone = added > 0
        ? `Attached ${added} from ${group.label || group.email}`
        : `Everyone in ${group.label || group.email} was already on this event`;
    } catch (err) {
      attendeeError = err instanceof Error ? err.message : String(err);
    } finally {
      groupBusy = null;
    }
  }
  $effect(() => {
    if (!groupDone) return;
    const t = setTimeout(() => (groupDone = null), 4000);
    return () => clearTimeout(t);
  });
  let linkingKey = $state<string | null>(null);
  let linkQuery = $state('');
  let linkResults = $state<Person[]>([]);
  let linkSearching = $state(false);
  let linkTimer: ReturnType<typeof setTimeout> | null = null;

  function openLinkSearch(row: AttendeeRow) {
    linkingKey = attendeeKey(row);
    linkResults = [];
    // Seed from the name we already have — usually the right search — and
    // fall back to the email's local part, which is often "first.last".
    const seed = (row.name || row.email.split('@')[0] || '').replace(/[._]+/g, ' ').trim();
    linkQuery = seed;
    if (seed) void runLinkSearch(seed);
  }
  function closeLinkSearch() {
    linkingKey = null;
    linkQuery = '';
    linkResults = [];
    if (linkTimer) clearTimeout(linkTimer);
  }
  async function runLinkSearch(q: string) {
    linkSearching = true;
    try {
      linkResults = ((await searchPeople(q, 8)) as Person[]) ?? [];
    } catch (err) {
      attendeeError = err instanceof Error ? err.message : String(err);
      linkResults = [];
    } finally {
      linkSearching = false;
    }
  }
  function onLinkQuery(v: string) {
    linkQuery = v;
    if (linkTimer) clearTimeout(linkTimer);
    if (!v.trim()) { linkResults = []; return; }
    linkTimer = setTimeout(() => void runLinkSearch(v), 180);
  }
  /** Transient confirmation that an address was filed on a contact. */
  let emailSavedFor = $state<string | null>(null);
  $effect(() => {
    if (!emailSavedFor) return;
    const t = setTimeout(() => (emailSavedFor = null), 4000);
    return () => clearTimeout(t);
  });

  /** Attach the chosen contact, then close the search.
   *
   *  Also file the attendee's address on that contact. Linking is the moment
   *  we learn this address belongs to this person; dropping it means the next
   *  invitation to the same address resolves to nobody again, which is how
   *  the duplicates got made. addPersonEmail() no-ops on an address the
   *  person already holds, primary included. */
  async function linkExisting(row: AttendeeRow, person: Person) {
    await pickAttendeeMatch(row, person);
    const addr = row.email.trim();
    if (addr) {
      try {
        const saved = await addPersonEmail(person.id, addr, {
          label: 'other',
          source: 'calendar_attendee'
        });
        if (saved) emailSavedFor = `${addr} → ${personName(person)}`;
      } catch (err) {
        // The attach succeeded; failing to file the address is worth saying
        // but not worth undoing the link.
        attendeeError = err instanceof Error ? err.message : String(err);
      }
    }
    closeLinkSearch();
  }
  /** Cached current-role lookup so each attendee row can render the
   *  person's org without an extra fetch per render. Keyed by person
   *  id; the value is the current-role Role row (we surface only the
   *  first one — multi-employment shows the most recent). */
  let attendeeRoles = $state<Map<number, Role>>(new Map());
  /** Avoid re-resolving the same event repeatedly when the user
   *  switches between view / edit. Keyed by datesId. */
  let attendeeResolvedFor = $state<number | null>(null);

  function parseAttendees(e: CalendarEvent | null): Array<{ name?: string; email?: string; status?: string }> {
    const raw = e?.meta?.external_links_raw;
    if (!raw) return [];
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(obj?.attendees) ? obj.attendees : [];
    } catch { return []; }
  }

  async function resolveAttendees(e: CalendarEvent) {
    if (!e.datesId || attendeeResolvedFor === e.datesId) return;
    const list = parseAttendees(e);
    // Seed the rows immediately so the dialog always renders the
    // attendee block — even if email resolution fails or takes a
    // moment, the user sees the raw list (email, name, status).
    attendeeRows = list.map((a) => ({
      name: (a.name ?? '').trim(),
      email: (a.email ?? '').trim(),
      status: String(a.status ?? '').toLowerCase(),
      matches: []
    }));
    attendeeResolvedFor = e.datesId;
    if (list.length === 0) return;
    attendeeError = '';
    try {
      const emails = attendeeRows.map((r) => r.email).filter(Boolean);
      const byEmail = await findPeopleByEmails(emails);
      // Patch in the matches via an immutable replacement so the
      // reactive render sees the new state.
      attendeeRows = attendeeRows.map((row) => ({
        ...row,
        matches: byEmail.get(row.email.toLowerCase()) ?? []
      }));

      // Resolve any group addresses so their rows can state how much of the
      // group is already on the event. Not awaited: the roster should render
      // now, and each group row fills in its tally when its members land.
      void loadGroupMembers(attendeeRows);

      // Roll up the current org for every resolved person (single or
      // ambiguous). One Person_organization request keyed by person
      // id; the renderer reads from the resulting Map. Non-fatal —
      // failing here just leaves the org line empty.
      const resolvedIds = [
        ...new Set(
          attendeeRows.flatMap((r) => r.matches.map((m) => m.id))
        )
      ];
      if (resolvedIds.length > 0) {
        try {
          const byPerson = await getCurrentRolesFor(resolvedIds);
          const m = new Map<number, Role>();
          for (const [pid, roles] of byPerson) {
            if (roles.length > 0) m.set(pid, roles[0]);
          }
          attendeeRoles = m;
        } catch { /* leave the map empty */ }
      } else {
        attendeeRoles = new Map();
      }

      // Auto-attach: single-match rows become Dates_Person links if
      // they're not already attached. Multi-match rows are left alone
      // — the user picks. Zero-match rows wait for "Add as contact".
      const alreadyAttached = new Set(fPeople.map((p) => p.id));
      for (const r of attendeeRows) {
        if (r.matches.length === 1) {
          const m = r.matches[0];
          if (!alreadyAttached.has(m.id)) {
            try {
              const link = await attachPersonToDate(e.datesId, m.id);
              fPeople = [...fPeople, {
                id: m.id,
                name: personName(m),
                junctionId: link.id,
                picture: m.person_picture ?? null,
                focal: m.image_focal ?? null
              }];
              fPeopleOriginal = [...fPeopleOriginal, { id: m.id, junctionId: link.id }];
              alreadyAttached.add(m.id);
            } catch { /* non-fatal — leave the row visible so user sees the match */ }
          }
        }
      }
    } catch (err) {
      attendeeError = err instanceof Error ? err.message : String(err);
    }
  }

  async function createPersonFromAttendee(row: AttendeeRow) {
    if (!formEvent?.datesId) return;
    row.creating = true; attendeeRows = [...attendeeRows];
    try {
      // Split a "First Last" name if Apple gave us one; otherwise
      // fall back to the local-part of the email so the row reads as
      // something better than the raw address.
      const parts = (row.name || row.email.split('@')[0]).trim().split(/\s+/);
      const first = parts[0] ?? '';
      const last = parts.slice(1).join(' ') || null;
      const full = row.name || `${first}${last ? ' ' + last : ''}`;
      const created = await createPerson({
        full_name: full,
        first_name: first,
        last_name: last,
        email: row.email,
        source: 'calendar_attendee',
        status: 'published'
      } as Partial<Person>);
      const link = await attachPersonToDate(formEvent.datesId, created.id);
      fPeople = [...fPeople, {
        id: created.id,
        name: personName(created),
        junctionId: link.id,
        picture: created.person_picture ?? null,
        focal: created.image_focal ?? null
      }];
      fPeopleOriginal = [...fPeopleOriginal, { id: created.id, junctionId: link.id }];
      // Patch the row in place so the next render shows the new
      // match without a full re-resolve.
      const idx = attendeeRows.indexOf(row);
      if (idx >= 0) {
        attendeeRows[idx] = { ...row, matches: [created], creating: false };
        attendeeRows = [...attendeeRows];
      }
    } catch (err) {
      attendeeError = err instanceof Error ? err.message : String(err);
      row.creating = false; attendeeRows = [...attendeeRows];
    }
  }

  async function pickAttendeeMatch(row: AttendeeRow, person: Person) {
    if (!formEvent?.datesId) return;
    const alreadyAttached = new Set(fPeople.map((p) => p.id));
    if (alreadyAttached.has(person.id)) return;
    try {
      const link = await attachPersonToDate(formEvent.datesId, person.id);
      fPeople = [...fPeople, {
        id: person.id,
        name: personName(person),
        junctionId: link.id,
        picture: person.person_picture ?? null,
        focal: person.image_focal ?? null
      }];
      fPeopleOriginal = [...fPeopleOriginal, { id: person.id, junctionId: link.id }];
      // Collapse the candidates list to just the picked one.
      const idx = attendeeRows.indexOf(row);
      if (idx >= 0) {
        attendeeRows[idx] = { ...row, matches: [person] };
        attendeeRows = [...attendeeRows];
      }
    } catch (err) {
      attendeeError = err instanceof Error ? err.message : String(err);
    }
  }

  let projQ = $state('');
  let projResults = $state<Project[]>([]);
  let orgQ = $state('');
  let orgResults = $state<Organization[]>([]);
  let personQ = $state('');
  let personResults = $state<Person[]>([]);
  let personSearched = $state(false);
  let creatingPerson = $state(false);
  let pickerTimer: ReturnType<typeof setTimeout> | null = null;
  function debounce<F extends (...args: unknown[]) => void>(fn: F, ms = 180) {
    return (...args: Parameters<F>) => {
      if (pickerTimer) clearTimeout(pickerTimer);
      pickerTimer = setTimeout(() => fn(...args), ms);
    };
  }
  function onProjQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    projQ = v;
    debounce(async () => {
      projResults = v.trim() ? ((await searchProjects(v, 8)) as Project[]) : [];
    })();
  }
  function pickProj(p: Project | null) {
    fProjectId = p?.id ?? null;
    fProjectLabel = p?.name ?? '';
    projQ = p?.name ?? '';
    projResults = [];
  }
  function onOrgQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    orgQ = v;
    debounce(async () => {
      orgResults = v.trim() ? ((await searchOrgs(v, 8)) as Organization[]) : [];
    })();
  }
  function pickOrg(o: Organization | null) {
    fOrgId = o?.id ?? null;
    fOrgLabel = o?.name ?? '';
    orgQ = o?.name ?? '';
    orgResults = [];
  }
  function onPersonQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    personQ = v;
    personSearched = false;
    debounce(async () => {
      if (!v.trim()) {
        personResults = [];
        personSearched = false;
        return;
      }
      personResults = (await searchPeople(v, 8)) as Person[];
      personSearched = true;
    })();
  }
  function addPersonToForm(p: Person) {
    if (fPeople.some((x) => x.id === p.id)) return;
    fPeople = [
      ...fPeople,
      {
        id: p.id,
        name: personName(p),
        picture: p.person_picture ?? null,
        focal: p.image_focal ?? null
      }
    ];
    personQ = '';
    personResults = [];
    personSearched = false;
  }
  function removePersonFromForm(id: number) {
    fPeople = fPeople.filter((x) => x.id !== id);
  }
  async function createAndAddPerson() {
    const name = personQ.trim();
    if (!name) return;
    creatingPerson = true;
    error = '';
    try {
      const created = await createPerson({ full_name: name });
      addPersonToForm(created);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      creatingPerson = false;
    }
  }

  const KIND_OPTIONS = [
    { value: 'event',       label: 'Event',          color: '#2C8C99' },
    { value: 'meeting',     label: 'Meeting',        color: '#1D6BFE' },
    { value: 'family_day',  label: 'Family day',     color: '#1E9B55' },
    { value: 'travel',      label: 'Travel',         color: '#6B5ADB' },
    { value: 'holiday',     label: 'Holiday',        color: '#C6762A' },
    { value: 'reminder',    label: 'Reminder',       color: '#C93B3B' },
    { value: 'other',       label: 'Other',          color: '#5F6B7A' }
  ];

  function resetConnectionPickers() {
    fProjectId = null;
    fProjectLabel = '';
    fOrgId = null;
    fOrgLabel = '';
    fPeople = [];
    fPeopleOriginal = [];
    projQ = ''; projResults = [];
    orgQ = ''; orgResults = [];
    personQ = ''; personResults = [];
    openSection = null;
  }

  function openAdd(d: Date, atTime?: { hour: number; minute: number }) {
    formMode = 'add';
    formEvent = null;
    formAnchorDate = new Date(d);
    fTitle = '';
    fKind = 'event';
    // Tapping a specific time slot (Day/Week grid) starts a *timed*
    // event at that slot; tapping a day cell elsewhere keeps the
    // all-day default. End defaults to +1h.
    if (atTime) {
      fAllDay = false;
      const sh = atTime.hour;
      const sm = atTime.minute;
      const eh = Math.min(23, sh + 1);
      fStartTime = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
      fEndTime = `${String(eh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
    } else {
      fAllDay = true;
      fStartTime = '09:00';
      fEndTime = '10:00';
    }
    fStartDate = isoDay(d);
    fEndDate = '';
    fDescription = '';
    fScope = '';
    fLocation = '';
    fPlaceId = null;
    placeSuggestions = [];
    fRecurring = false;
    fFreq = 'WEEKLY';
    fInterval = 1;
    resetConnectionPickers();
    formOpen = true;
  }

  async function openEvent(e: CalendarEvent) {
    formEvent = e;
    formAnchorDate = null;
    // Default to view mode for *every* event — meeting details (description,
    // organizer, attendees, virtual link, recurrence summary) deserve a
    // read-friendly screen before jumping into the edit form. The Edit
    // button inside the view flips to edit mode using the already-seeded
    // field state below.
    formMode = e.datesId ? 'view' : 'view';
    if (!e.datesId) {
      // Derived rows — nothing to seed for editing.
      viewTab = 'attendees';
      peekDescOpen = false;
      closeLinkSearch();
      attendeeRows = [];
      formOpen = true;
      return;
    }
    fTitle = e.title;
    fKind = String(e.kind);
    fAllDay = e.allDay;
    fStartDate = isoDay(e.start);
    fEndDate = sameDay(e.start, e.end) ? '' : isoDay(e.end);
    fStartTime = timeOf(e.start);
    fEndTime = timeOf(e.end);
    fDescription = String(e.meta?.description ?? '');
    fScope = (e.scope ?? '') as typeof fScope;
    fLocation = String(e.meta?.location ?? '');
    fPlaceId = typeof e.meta?.location_id === 'number' ? e.meta.location_id : null;
    // Seed recurrence from the underlying Dates row's rule.
    const row = e.meta?.row as Partial<DateEvent> | undefined;
    fRecurring = !!row?.is_recurring;
    if (fRecurring && row?.recurrence_rule) {
      const fm = row.recurrence_rule.match(/FREQ=(YEARLY|MONTHLY|WEEKLY|DAILY)/i);
      fFreq = ((fm?.[1]?.toUpperCase()) as typeof fFreq) ?? 'WEEKLY';
      const im = row.recurrence_rule.match(/INTERVAL=(\d+)/i);
      fInterval = im ? parseInt(im[1], 10) : 1;
    } else {
      fFreq = 'WEEKLY';
      fInterval = 1;
    }

    // Seed connections from the expanded meta.
    resetConnectionPickers();
    const proj = e.meta?.project as Project | null | undefined;
    if (proj) {
      fProjectId = proj.id; fProjectLabel = proj.name ?? ''; projQ = proj.name ?? '';
    } else if (typeof e.meta?.project_id === 'number') {
      // Fallback when meta only carries the raw FK (e.g. right after
      // a POST whose response didn't expand the relation). The label
      // stays empty until a refresh fetches the project name.
      fProjectId = e.meta.project_id; fProjectLabel = ''; projQ = '';
    }
    const org = e.meta?.organization as Organization | null | undefined;
    if (org) {
      fOrgId = org.id; fOrgLabel = org.name ?? ''; orgQ = org.name ?? '';
    } else if (typeof e.meta?.organization_id === 'number') {
      fOrgId = e.meta.organization_id; fOrgLabel = ''; orgQ = '';
    }
    formOpen = true;

    // Load people via junction (separate request — keeps the bulk listing fast).
    try {
      const links = await getDatePeople(e.datesId);
      const seeded: FormPerson[] = [];
      const orig: { id: number; junctionId: number }[] = [];
      for (const l of links) {
        const p = l.Person_id && typeof l.Person_id === 'object' ? (l.Person_id as Person) : null;
        if (p && l.id) {
          seeded.push({
            id: p.id,
            name: personName(p),
            junctionId: l.id,
            picture: p.person_picture ?? null,
            focal: p.image_focal ?? null
          });
          orig.push({ id: p.id, junctionId: l.id });
        }
      }
      fPeople = seeded;
      fPeopleOriginal = orig;
    } catch {
      // non-fatal — leave empty
    }

    // Resolve calendar attendees → Person rows. Single matches auto-
    // attach to Dates_Person above the user's already-seeded list.
    // Reset the cache key so re-opening a different event triggers
    // a fresh resolve.
    attendeeRows = [];
    attendeeError = '';
    attendeeResolvedFor = null;
    attendeeRoles = new Map();
    // Both surfaces have room for the roster now: the desktop rail is full
    // height, and the phone sheet opens expanded rather than at the 280px
    // compact step. The toggle still collapses it on either.
    viewTab = 'attendees';
    peekDescOpen = false;
    closeLinkSearch();
    groupDone = null;
    groupMembers = new Map();
    // Cheap and cached-by-Directus; the rules are a handful of rows.
    if (emailGroups.size === 0) {
      void listEmailGroups().then((m) => (emailGroups = m)).catch(() => {});
    }
    void resolveAttendees(e);
  }

  function buildPayloadFromForm(): { startISO: string; endISO: string } {
    if (fAllDay) {
      const s = new Date(fStartDate || isoDay(formAnchorDate ?? new Date()));
      s.setHours(0, 0, 0, 0);
      const eDateStr = fEndDate || fStartDate || isoDay(formAnchorDate ?? new Date());
      const e = new Date(eDateStr);
      e.setHours(23, 59, 59, 999);
      // Guard against end-before-start (treat as single-day).
      if (e < s) e.setTime(s.getTime() + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59 * 1000);
      return { startISO: s.toISOString(), endISO: e.toISOString() };
    }
    const baseDay = new Date(fStartDate || isoDay(formAnchorDate ?? new Date()));
    const [sh, sm] = fStartTime.split(':').map(Number);
    const [eh, em] = fEndTime.split(':').map(Number);
    const s = new Date(baseDay);
    s.setHours(sh, sm, 0, 0);
    const e = new Date(baseDay);
    e.setHours(eh, em, 0, 0);
    if (e <= s) e.setDate(e.getDate() + 1); // crosses midnight
    return { startISO: s.toISOString(), endISO: e.toISOString() };
  }

  async function submitForm() {
    if (!fTitle.trim()) return;
    if (formMode === 'view') return;
    saving = true;
    error = '';
    try {
      const { startISO, endISO } = buildPayloadFromForm();
      const kindMeta = KIND_OPTIONS.find((k) => k.value === fKind);
      const patch: Record<string, unknown> = {
        title: fTitle.trim(),
        description: fDescription.trim() || null,
        event_type: fKind,
        start: startISO,
        end: endISO,
        all_day: fAllDay,
        color: kindMeta?.color || null,
        scope: fScope || null,
        location_name: fLocation.trim() || null,
        location_id: fPlaceId,
        project_id: fProjectId,
        organization: fOrgId,
        is_recurring: fRecurring,
        recurrence_rule: fRecurring ? buildRrule(fFreq, fInterval) : null
      };
      let savedId: number | null = null;
      if (formMode === 'add') {
        const created = await createDateRow({
          ...patch,
          source: 'manual',
          status: 'published'
        } as never);
        savedId = created.id;
        const ce = dateRowToCalendarEvent(created);
        if (ce) events = [...events, ce];
      } else if (formMode === 'edit' && formEvent?.datesId) {
        const updated = await updateDateRow(formEvent.datesId, patch as never);
        savedId = formEvent.datesId;
        const ce = dateRowToCalendarEvent(updated);
        if (ce) events = events.map((x) => (x.key === formEvent!.key ? ce : x));
      }
      // Reconcile the people junction: detach removed, attach new.
      if (savedId != null) {
        const currentIds = new Set(fPeople.map((p) => p.id));
        const originalIds = new Set(fPeopleOriginal.map((p) => p.id));
        // Detach those that were removed.
        for (const o of fPeopleOriginal) {
          if (!currentIds.has(o.id)) {
            try { await detachPersonFromDate(o.junctionId); } catch { /* ignore */ }
          }
        }
        // Attach new ones.
        for (const p of fPeople) {
          if (!originalIds.has(p.id)) {
            try { await attachPersonToDate(savedId, p.id); } catch { /* ignore */ }
          }
        }
      }
      formOpen = false;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function deleteFromForm() {
    if (formMode !== 'edit' || !formEvent?.datesId) return;
    if (!confirm(`Delete "${formEvent.title}"?`)) return;
    try {
      await deleteDateRow(formEvent.datesId);
      events = events.filter((x) => x.key !== formEvent!.key);
      formOpen = false;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // ─── Drag-to-move ─────────────────────────────────────────────────────────
  // Only stored events (datesId set) are draggable. Birthdays and project
  // spans live at their source — drag-editing them here would lie about the
  // source of truth.
  let draggingEvent = $state<CalendarEvent | null>(null);
  let dragOverDayKey = $state<string | null>(null);

  function onChipDragStart(e: DragEvent, ce: CalendarEvent) {
    if (!ce.datesId) {
      e.preventDefault();
      return;
    }
    draggingEvent = ce;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ce.key);
    }
  }
  function onChipDragEnd() {
    draggingEvent = null;
    dragOverDayKey = null;
  }
  function onDayDragOver(e: DragEvent, dayKey: string) {
    if (!draggingEvent) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dragOverDayKey !== dayKey) dragOverDayKey = dayKey;
  }
  function onDayDragLeave(dayKey: string) {
    if (dragOverDayKey === dayKey) dragOverDayKey = null;
  }
  async function onDayDrop(e: DragEvent, day: Date) {
    e.preventDefault();
    const moving = draggingEvent;
    draggingEvent = null;
    dragOverDayKey = null;
    if (!moving?.datesId) return;
    // Compute the delta in whole days from the original event's first day.
    const origStartDay = new Date(moving.start);
    origStartDay.setHours(0, 0, 0, 0);
    const target = new Date(day);
    target.setHours(0, 0, 0, 0);
    const deltaMs = target.getTime() - origStartDay.getTime();
    if (deltaMs === 0) return; // no-op
    const newStart = new Date(moving.start.getTime() + deltaMs);
    const newEnd = new Date(moving.end.getTime() + deltaMs);
    // Optimistic update.
    const optimistic: CalendarEvent = { ...moving, start: newStart, end: newEnd };
    const prevEvents = events;
    events = events.map((x) => (x.key === moving.key ? optimistic : x));
    try {
      await updateDateRow(moving.datesId, {
        start: newStart.toISOString(),
        end: newEnd.toISOString()
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      events = prevEvents; // roll back
    }
  }

  // ─── Formatting ───────────────────────────────────────────────────────────
  const monthLabel = $derived(
    new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(cursor)
  );
  // Title shown in the header depends on the active view.
  const viewTitle = $derived.by(() => {
    if (view === 'month' || view === 'list') return monthLabel;
    if (view === 'week') {
      const s = startOfWeek(cursor);
      const e = addDays(s, 6);
      const sameMonth = s.getMonth() === e.getMonth();
      if (sameMonth) {
        const m = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(s);
        return `${s.getDate()} – ${e.getDate()} ${m}`;
      }
      const sl = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(s);
      const el = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(e);
      return `${sl} – ${el}`;
    }
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(cursor);
  });
  const weekdayHeader = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // ─── Time-grid helpers (Week + Day views) ─────────────────────────────────
  // The vertical timeline defaults to 06:00–22:00 but expands when an event
  // in the visible day(s) falls outside that window — so an 05:30 standup or
  // a 23:00 call isn't crushed onto the boundary. One row per hour, HOUR_PX
  // tall so a half-hour reads as a fixed, scannable distance.
  const DEFAULT_START_HOUR = 6;
  const DEFAULT_END_HOUR = 22;
  const HOUR_PX = 48;

  /** Days the timed grid is currently showing — one for Day view, seven
   *  for Week. Drives the dynamic window below. */
  const gridDaysForWindow = $derived.by<Date[]>(() => {
    if (view === 'day') return [cursor];
    if (view === 'week') return weekDays;
    return [];
  });

  const DAY_START_HOUR = $derived.by(() => {
    let min = DEFAULT_START_HOUR;
    for (const d of gridDaysForWindow) {
      for (const e of eventsOnDay(d).timed) {
        const h = e.start.getHours();
        if (h < min) min = h;
      }
    }
    return Math.max(0, min);
  });
  const DAY_END_HOUR = $derived.by(() => {
    let max = DEFAULT_END_HOUR;
    for (const d of gridDaysForWindow) {
      for (const e of eventsOnDay(d).timed) {
        // Round the end up to the next whole hour so the block has room.
        const endH = e.end.getMinutes() > 0 ? e.end.getHours() + 1 : e.end.getHours();
        if (endH > max) max = endH;
      }
    }
    return Math.min(24, max);
  });
  const HOURS = $derived.by(() => {
    const out: number[] = [];
    for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) out.push(h);
    return out;
  });
  function minutesFromDayStart(d: Date) {
    return d.getHours() * 60 + d.getMinutes() - DAY_START_HOUR * 60;
  }
  /** Y position (px) of a timestamp within the day timeline. Clamped. */
  function timeY(d: Date): number {
    const m = minutesFromDayStart(d);
    return Math.max(0, (m / 60) * HOUR_PX);
  }
  /** Height (px) of a timed event between two timestamps within a single day. */
  function timeHeight(start: Date, end: Date): number {
    const a = timeY(start);
    const b = timeY(end);
    return Math.max(18, b - a);
  }
  // ─── List view: batch select state ───────────────────────────────────────
  // Only real Dates rows (events that have a datesId) are selectable —
  // birthdays and project spans are derived; "archiving" them here
  // would do nothing useful and the script-of-truth lives at the
  // source (Person.birthday / Project.start_date).
  let batchMode = $state(false);
  let batchSelected = $state<Set<number>>(new Set()); // datesId values
  let batchBusy = $state(false);
  let batchError = $state('');
  let batchEditPanel = $state<null | 'edit'>(null);
  let batchEditScope = $state<'unchanged' | 'work' | 'private' | 'both'>('unchanged');
  let batchEditKind = $state<string>('unchanged');

  function toggleBatch(id: number) {
    const next = new Set(batchSelected);
    if (next.has(id)) next.delete(id); else next.add(id);
    batchSelected = next;
  }
  function exitBatchMode() {
    batchMode = false;
    batchSelected = new Set();
    batchEditPanel = null;
    batchEditScope = 'unchanged';
    batchEditKind = 'unchanged';
    batchError = '';
  }
  function selectAllListItems() {
    const ids = new Set<number>();
    for (const g of listGroups) for (const e of g.items) if (typeof e.datesId === 'number') ids.add(e.datesId);
    batchSelected = ids;
  }

  async function doBatchArchive() {
    if (batchSelected.size === 0 || batchBusy) return;
    if (!confirm(`Archive ${batchSelected.size} event${batchSelected.size === 1 ? '' : 's'}? They'll be hidden from the calendar but not deleted.`)) return;
    batchBusy = true; batchError = '';
    try {
      await bulkArchiveDateRows([...batchSelected]);
      // Optimistically drop them from the visible list so the user
      // sees the action took effect without waiting for a refetch.
      const archived = new Set(batchSelected);
      events = events.filter((e) => !(typeof e.datesId === 'number' && archived.has(e.datesId)));
      exitBatchMode();
    } catch (e) {
      batchError = e instanceof Error ? e.message : String(e);
    } finally { batchBusy = false; }
  }
  async function doBatchEdit() {
    if (batchSelected.size === 0 || batchBusy) return;
    const patch: Partial<DateEvent> = {};
    if (batchEditScope !== 'unchanged') patch.scope = batchEditScope;
    if (batchEditKind  !== 'unchanged') patch.event_type = batchEditKind;
    if (Object.keys(patch).length === 0) { batchEditPanel = null; return; }
    batchBusy = true; batchError = '';
    try {
      await bulkUpdateDateRows([...batchSelected], patch);
      // Update in-memory so the rows reflect the new scope/kind.
      const touched = new Set(batchSelected);
      events = events.map((e) => {
        if (typeof e.datesId !== 'number' || !touched.has(e.datesId)) return e;
        return {
          ...e,
          scope: patch.scope ?? e.scope,
          kind: patch.event_type ?? e.kind
        };
      });
      exitBatchMode();
    } catch (e) {
      batchError = e instanceof Error ? e.message : String(e);
    } finally { batchBusy = false; }
  }

  // ─── List view buckets ───────────────────────────────────────────────────
  // Flat chronological list grouped by day. Same source/filter pipeline
  // as the month grid (so the user's filter chips work exactly the same).
  // Multi-day events appear under their *start* date only — duplicating
  // them per spanned day would defeat the purpose of a flat list.
  type ListGroup = { dayKey: string; date: Date; items: CalendarEvent[] };
  const listGroups = $derived.by<ListGroup[]>(() => {
    const passes = (e: CalendarEvent) => visibleCals[calBucketOf(e)] && passesAdvancedFilters(e);
    const filtered = events.filter(passes);
    // Sort by start, then all-day first within the same day so the
    // header-style birthdays/holidays surface above timed meetings.
    filtered.sort((a, b) => {
      const da = a.start.getTime();
      const db = b.start.getTime();
      if (da !== db) return da - db;
      return Number(b.allDay) - Number(a.allDay);
    });
    const m = new Map<string, ListGroup>();
    for (const e of filtered) {
      const key = isoDay(e.start);
      let g = m.get(key);
      if (!g) {
        g = { dayKey: key, date: startOfDay(e.start), items: [] };
        m.set(key, g);
      }
      g.items.push(e);
    }
    return [...m.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  });

  function eventsOnDay(day: Date): { allDay: CalendarEvent[]; timed: CalendarEvent[] } {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    const passes = (e: CalendarEvent) => visibleCals[calBucketOf(e)] && passesAdvancedFilters(e);
    const filt = events.filter(passes).filter((e) => e.start < dayEnd && e.end > dayStart);
    const allDay = filt.filter((e) => e.allDay || !sameDay(e.start, e.end));
    const timed = filt
      .filter((e) => !e.allDay && sameDay(e.start, e.end))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    return { allDay, timed };
  }

  /** Per-event lane assignment for the Day view's timed column.
   *  Greedy "first-fit": sort by start, drop each event into the
   *  lowest lane whose previous event has already ended. Then walk
   *  the events again to record the *cluster* (maximally-overlapping
   *  group it belongs to) and the total lanes that cluster needs —
   *  width is calculated per-event from that local cluster, not the
   *  whole day, so a single 16:00 meeting stretches edge-to-edge
   *  even if the 10:15 cluster has two lanes. */
  type DayLane = { event: CalendarEvent; lane: number; clusterLanes: number };
  function computeDayLanes(timed: CalendarEvent[]): DayLane[] {
    if (timed.length === 0) return [];
    const ordered = [...timed].sort((a, b) => a.start.getTime() - b.start.getTime());
    const laneEnd: number[] = []; // ms timestamp of last event's end per lane
    const assigned: { e: CalendarEvent; lane: number; idx: number }[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const e = ordered[i];
      // Find the lowest lane whose previous event ended before this
      // one starts. Equal end/start counts as non-overlapping.
      let lane = laneEnd.findIndex((end) => end <= e.start.getTime());
      if (lane === -1) { lane = laneEnd.length; laneEnd.push(0); }
      laneEnd[lane] = e.end.getTime();
      assigned.push({ e, lane, idx: i });
    }
    // Cluster pass: events overlap transitively. Compute the
    // maximum lane count across each cluster and stamp it on every
    // member so width is right for that group only.
    const clusters: number[][] = []; // indexes per cluster
    let cur: number[] = [];
    let curEnd = -Infinity;
    for (const a of assigned) {
      if (a.e.start.getTime() >= curEnd && cur.length > 0) {
        clusters.push(cur); cur = [];
      }
      cur.push(a.idx);
      curEnd = Math.max(curEnd, a.e.end.getTime());
    }
    if (cur.length) clusters.push(cur);
    const clusterLanesByIdx = new Map<number, number>();
    for (const cluster of clusters) {
      const maxLane = Math.max(...cluster.map((i) => assigned[i].lane));
      const lanes = maxLane + 1;
      for (const i of cluster) clusterLanesByIdx.set(i, lanes);
    }
    return assigned.map((a) => ({
      event: a.e,
      lane: a.lane,
      clusterLanes: clusterLanesByIdx.get(a.idx) ?? 1
    }));
  }
  const HOUR_LABEL_FMT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  function hourLabel(h: number): string {
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    return HOUR_LABEL_FMT.format(d);
  }

  // Live "now" indicator that ticks every minute when a time-grid view is active.
  let nowTick = $state(new Date());
  $effect(() => {
    if (view === 'month') return;
    const t = setInterval(() => (nowTick = new Date()), 60 * 1000);
    return () => clearInterval(t);
  });
  function nowYIfVisible(day: Date): number | null {
    if (!sameDay(nowTick, day)) return null;
    const m = nowTick.getHours() * 60 + nowTick.getMinutes();
    if (m < DAY_START_HOUR * 60 || m > DAY_END_HOUR * 60) return null;
    return ((m - DAY_START_HOUR * 60) / 60) * HOUR_PX;
  }

  function timeOf(d: Date) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function eventColor(e: CalendarEvent): string {
    // Fallback chain: own colour → linked project's colour → source bucket.
    // Lets a course's events inherit "University of Reykjavík" purple
    // automatically, without copying the swatch onto each event row.
    if (e.color) return e.color;
    const proj = e.meta?.project as Project | null | undefined;
    if (proj?.color) return proj.color;
    return CAL_COLORS[calBucketOf(e)];
  }

  // Pill-style background derived from a base hex (light tint, full text).
  function pillStyle(e: CalendarEvent): string {
    const c = eventColor(e);
    return `background-color: ${c}1f; color: ${c}; border-color: ${c}55;`;
  }
</script>

<div class="flex items-start gap-4">
  <div class="min-w-0 flex-1">
<div class="space-y-3">
  <!-- ── Header ──────────────────────────────────────────────────────────
       Two-tier layout following the conventions of every well-known
       calendar app (Google, Apple, Fantastical, Cron):

         · Row 1 — Title hierarchy: the current period reads as a real
           page H1, with "+ New event" anchored top-right as the only
           primary action.
         · Row 2 — Navigation toolbar: chevron group + Today chip on
           the left, view switcher on the right.

       This puts the highest-information element (the period label) at
       the visual top and groups every transient control on its own
       row so it doesn't fight the title for attention. ─────────────── -->
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0">
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
        {viewTitle}
        {#if loading}<span class="ml-2 align-middle font-display text-xs font-normal text-ink-400">loading…</span>{/if}
      </h1>
    </div>
    <button
      class="btn-primary"
      onclick={() => openAdd(view === 'day' ? cursor : new Date())}
      title="Add an event"
    >
      <Icon name="plus" size={14} /> New event
    </button>
  </div>

  <div class="flex flex-wrap items-center justify-between gap-2">
    <!-- Nav cluster: prev/next pair grouped in a single segmented
         control + Today chip beside it. -->
    <div class="flex items-center gap-1.5">
      <div
        class="inline-flex overflow-hidden rounded-[8px] border border-surface-border bg-surface-card"
        role="group"
        aria-label="Step"
      >
        <button
          type="button"
          class="px-2.5 py-1.5 text-ink-700 transition hover:bg-surface-hover"
          onclick={goPrev}
          aria-label={view === 'month' ? 'Previous month' : view === 'week' ? 'Previous week' : 'Previous day'}
        >
          <Icon name="chevron-left" size={14} />
        </button>
        <div class="w-px self-stretch bg-surface-border" aria-hidden="true"></div>
        <button
          type="button"
          class="px-2.5 py-1.5 text-ink-700 transition hover:bg-surface-hover"
          onclick={goNext}
          aria-label={view === 'month' ? 'Next month' : view === 'week' ? 'Next week' : 'Next day'}
        >
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-[8px] border px-2.5 py-1.5 font-display text-xs font-medium transition"
        style={isViewingToday
          ? 'border-color: var(--border-subtle); color: var(--text-tertiary); background: transparent; letter-spacing: 0.04em;'
          : 'border-color: var(--accent-electric); color: var(--accent-electric); background: transparent; letter-spacing: 0.04em;'}
        onclick={goToday}
        disabled={isViewingToday}
        title={isViewingToday ? 'Already on today' : 'Jump to today'}
        aria-label="Jump to today"
      >
        <Icon name="calendar" size={12} />
        Today
      </button>
    </div>

    <!-- View switcher: Helga segmented control. ARIA-correct radiogroup
         so screen readers announce the three options. -->
    <div
      class="inline-flex p-0.5"
      role="radiogroup"
      aria-label="Calendar view"
      style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
    >
      {#each [['month', 'Month'], ['week', 'Week'], ['day', 'Day'], ['list', 'List']] as const as [k, label]}
        <button
          type="button"
          role="radio"
          aria-checked={view === k}
          class="font-display px-3 py-1 text-xs font-medium transition"
          style={view === k
            ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: calc(var(--radius-md) - 2px); letter-spacing: 0.04em;'
            : 'background: transparent; color: var(--text-secondary); letter-spacing: 0.04em;'}
          onclick={() => setView(k as ViewMode)}
        >{label}</button>
      {/each}
    </div>
  </div>

  <!-- Toolbar row: open the filters menu (which holds the calendar-type
       toggles) + the entry points that used to live on the landing. -->
  <div class="flex flex-wrap items-center gap-1.5">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-full border border-surface-border px-2.5 py-1 text-xs font-medium text-ink-700 transition hover:bg-surface-hover"
      class:bg-surface-hover={filterPanelOpen || activeFilterCount > 0}
      onclick={() => (filterPanelOpen = !filterPanelOpen)}
      aria-expanded={filterPanelOpen}
      aria-controls="calendar-filter-panel"
    >
      <Icon name="filter" size={12} />
      Filters
      {#if activeFilterCount > 0}
        <span class="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">{activeFilterCount}</span>
      {/if}
    </button>
    {#if activeFilterCount > 0}
      <button
        type="button"
        class="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-700 hover:underline"
        onclick={clearAllFilters}
      >Clear</button>
    {/if}
    <!-- Entry points that used to live on the calendar landing page. -->
    <span class="mx-1 h-4 w-px bg-surface-divider" aria-hidden="true"></span>
    <a
      href="/calendar/import"
      class="inline-flex items-center gap-1.5 rounded-full border border-surface-border px-2.5 py-1 text-xs font-medium text-ink-700 transition hover:bg-surface-hover"
    >
      <Icon name="download" size={12} />
      Import from phone
    </a>
    <a
      href="/calendar/holidays"
      class="inline-flex items-center gap-1.5 rounded-full border border-surface-border px-2.5 py-1 text-xs font-medium text-ink-700 transition hover:bg-surface-hover"
    >
      <Icon name="flag" size={12} />
      Public holidays
    </a>
  </div>

  {#if filterPanelOpen}
    <div
      id="calendar-filter-panel"
      class="card grid gap-4 p-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <!-- Calendars: the unified grid's sub-calendars as toggle chips. -->
      <div class="min-w-0">
        <div class="mb-1.5 flex items-center justify-between">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Calendars</span>
          {#if CAL_KEYS.some((k) => !visibleCals[k])}
            <button class="text-[11px] text-ink-400 hover:text-ink-700" onclick={() => (visibleCals = { mine: true, social: true, holidays: true, birthdays: true, projects: true })}>reset</button>
          {/if}
        </div>
        <div class="flex flex-wrap gap-1">
          {#each CAL_KEYS as k (k)}
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition"
              style:background-color={visibleCals[k] ? `${CAL_COLORS[k]}1f` : 'transparent'}
              style:color={visibleCals[k] ? CAL_COLORS[k] : 'var(--ink-400, #7A8593)'}
              style:border-color={visibleCals[k] ? `${CAL_COLORS[k]}55` : 'var(--surface-border, #EEF0F3)'}
              onclick={() => (visibleCals = { ...visibleCals, [k]: !visibleCals[k] })}
              aria-pressed={visibleCals[k]}
            >
              <span class="inline-block h-2 w-2 rounded-full" style:background-color={CAL_COLORS[k]}></span>
              {CAL_LABELS[k]}
            </button>
          {/each}
        </div>
      </div>

      <!-- Projects: tree picker with parent → cascade-select. The same
           component the /orgs sidebar uses, so the behaviour is familiar. -->
      <div class="min-w-0">
        <div class="mb-1.5 flex items-center justify-between">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Projects</span>
          {#if selectedProjectIds.size > 0}
            <button class="text-[11px] text-ink-400 hover:text-ink-700" onclick={() => (selectedProjectIds = new Set())}>reset</button>
          {/if}
        </div>
        <div class="max-h-56 overflow-y-auto rounded-md border border-surface-border p-1">
          {#if allProjects.length === 0}
            <div class="px-2 py-3 text-xs text-ink-400">No projects loaded yet…</div>
          {:else}
            <ProjectFilterTree projects={allProjects} bind:selected={selectedProjectIds} />
          {/if}
        </div>
      </div>

      <!-- Scope: segmented control. -->
      <div class="min-w-0">
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

      <!-- Kind: chip multi-select of event_types present in window. -->
      <div class="min-w-0">
        <div class="mb-1.5 flex items-center justify-between">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Kind</span>
          {#if kindFilter.size > 0}
            <button class="text-[11px] text-ink-400 hover:text-ink-700" onclick={() => (kindFilter = new Set())}>reset</button>
          {/if}
        </div>
        <div class="flex flex-wrap gap-1">
          {#if kindOptionsInRange.length === 0}
            <span class="text-xs text-ink-400">—</span>
          {:else}
            {#each kindOptionsInRange as k (k)}
              {@const on = kindFilter.has(k)}
              <button
                type="button"
                class="rounded-full border px-2 py-0.5 text-[11px] capitalize transition"
                class:border-brand={on}
                class:bg-brand={false}
                style:background-color={on ? 'rgba(44,140,153,0.12)' : 'transparent'}
                style:color={on ? 'var(--brand, #2C8C99)' : 'var(--text-secondary)'}
                style:border-color={on ? 'rgba(44,140,153,0.45)' : 'var(--surface-border)'}
                aria-pressed={on}
                onclick={() => {
                  const next = new Set(kindFilter);
                  if (on) next.delete(k); else next.add(k);
                  kindFilter = next;
                }}
              >{k.replace(/_/g, ' ')}</button>
            {/each}
          {/if}
        </div>
      </div>

      <!-- External calendars (Apple/Google/etc.) — only renders if at
           least one event in the window carries an external_calendar. -->
      <div class="min-w-0">
        <div class="mb-1.5 flex items-center justify-between">
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Calendar</span>
          {#if calendarFilter.size > 0}
            <button class="text-[11px] text-ink-400 hover:text-ink-700" onclick={() => (calendarFilter = new Set())}>reset</button>
          {/if}
        </div>
        <div class="flex flex-wrap gap-1">
          {#if calendarOptionsInRange.length === 0}
            <span class="text-xs text-ink-400">Sync a calendar to filter here.</span>
          {:else}
            {#each calendarOptionsInRange as c (c)}
              {@const on = calendarFilter.has(c)}
              <button
                type="button"
                class="rounded-full border px-2 py-0.5 text-[11px] transition"
                style:background-color={on ? 'rgba(29,107,254,0.12)' : 'transparent'}
                style:color={on ? '#1D6BFE' : 'var(--text-secondary)'}
                style:border-color={on ? 'rgba(29,107,254,0.45)' : 'var(--surface-border)'}
                aria-pressed={on}
                onclick={() => {
                  const next = new Set(calendarFilter);
                  if (on) next.delete(c); else next.add(c);
                  calendarFilter = next;
                }}
              >{c}</button>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">{error}</div>
  {/if}

  <!-- Swipe surface: horizontal swipes here step prev/next (axis-locked
       so vertical scroll still works). The slide-{dir} class plays a
       short transform when a step commits so it reads as movement. -->
  <div
    class="cal-swipe {slideDir ? `cal-slide-${slideDir}` : ''}"
    ontouchstart={onSwipeStart}
    ontouchend={onSwipeEnd}
  >
  {#if view === 'month'}
  <!-- Month grid -->
  <div class="card overflow-hidden">
    <!-- Weekday header -->
    <div class="grid grid-cols-7 border-b border-surface-divider bg-surface-hover/40 text-[11px] font-medium uppercase tracking-wider text-ink-400">
      {#each weekdayHeader as w}
        <div class="px-2 py-1.5">{w}</div>
      {/each}
    </div>
    <!-- 6 week rows: each row is a relative grid containing 7 day cells +
         an absolutely-positioned "bars" overlay so multi-day events render
         as continuous segments across days. -->
    <div class="flex flex-col">
      {#each weekLayouts as wk, wIdx (wk.weekStart.toISOString())}
        {@const barsHeight = wk.laneCount * 22}
        <div
          class="relative grid grid-cols-7 {wIdx === 5 ? '' : 'border-b border-surface-divider'}"
        >
          <!-- Day cells (7 columns) -->
          {#each [0, 1, 2, 3, 4, 5, 6] as dayIdx (dayIdx)}
            {@const day = addDays(wk.weekStart, dayIdx)}
            {@const inMonth = day.getMonth() === cursor.getMonth()}
            {@const isToday = sameDay(day, today)}
            {@const dayKey = isoDay(day)}
            {@const timed = wk.timedByDay.get(dayKey) ?? []}
            <!-- Day cell — clicking empty space drills into Day view
                 for this date (was openAdd; "+ New event" in the
                 toolbar covers the create case). Chip clicks still
                 open the event-detail dialog via their own handler. -->
            <div
              role="button"
              tabindex="0"
              class="group flex min-h-[5rem] sm:min-h-[6.5rem] flex-col gap-0.5 px-1 py-1 sm:px-1.5 text-left transition hover:bg-surface-hover/60 {inMonth ? '' : 'bg-surface-hover/30 text-ink-400'} {dayIdx === 6 ? '' : 'border-r border-surface-divider'} {dragOverDayKey === dayKey ? 'ring-2 ring-brand ring-inset bg-brand/5' : ''}"
              ondragover={(e) => onDayDragOver(e, dayKey)}
              ondragleave={() => onDayDragLeave(dayKey)}
              ondrop={(e) => onDayDrop(e, day)}
              onclick={(e) => {
                if ((e.target as HTMLElement).closest('[data-event-chip]')) return;
                openDay(day);
              }}
              onkeydown={(e) => {
                if ((e.target as HTMLElement).closest('[data-event-chip]')) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openDay(day);
                }
              }}
              aria-label={`Open ${dayKey} in day view`}
            >
              <div class="flex items-center justify-between text-[11px]">
                <span
                  class="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 font-medium {isToday ? 'bg-brand text-white' : inMonth ? 'text-ink-700' : 'text-ink-400'}"
                >{day.getDate()}</span>
                {#if isToday}<span class="text-[10px] uppercase text-brand">today</span>{/if}
              </div>

              <!-- Reserve vertical space for the bar overlay so timed
                   events line up below the bars. -->
              {#if barsHeight > 0}
                <div style="height: {barsHeight}px;"></div>
              {/if}

              <!-- Timed events stacked under the bars -->
              {#each timed.slice(0, 3) as e (e.key + dayKey)}
                {@const editable = !!e.datesId}
                <!-- Title-first chip. The title gets the truncatable
                     middle slot; time sits on the right as muted
                     metadata. The colour dot anchors the left, just
                     like Apple Calendar / Google. -->
                <button
                  type="button"
                  data-event-chip
                  draggable={editable}
                  ondragstart={(ev) => onChipDragStart(ev, e)}
                  ondragend={onChipDragEnd}
                  class="flex w-full items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-left text-[10.5px] hover:bg-surface-hover {editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} {draggingEvent?.key === e.key ? 'opacity-40' : ''}"
                  title={editable ? `${timeOf(e.start)} ${e.title} — drag to move, click to edit` : `${timeOf(e.start)} ${e.title}`}
                  onclick={(ev) => { ev.stopPropagation(); openEvent(e); }}
                >
                  <span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style:background-color={eventColor(e)}></span>
                  <span class="min-w-0 flex-1 truncate font-medium text-ink-800">{e.title}</span>
                  <span class="hidden sm:inline shrink-0 tabular-nums text-[9px] text-ink-400">{timeOf(e.start)}</span>
                </button>
              {/each}
              {#if timed.length > 3}
                <span class="block text-[10px] text-ink-400">+ {timed.length - 3} more</span>
              {/if}
            </div>
          {/each}

          <!-- Bars overlay: spans across day cells. -->
          {#if wk.bars.length > 0}
            <div
              class="pointer-events-none absolute inset-x-0 grid grid-cols-7 px-1"
              style="top: 1.65rem; height: {barsHeight}px; grid-auto-rows: 22px;"
            >
              {#each wk.bars as bar (bar.event.key + wIdx)}
                {@const e = bar.event}
                {@const editable = !!e.datesId}
                <button
                  type="button"
                  data-event-chip
                  draggable={editable}
                  ondragstart={(ev) => onChipDragStart(ev, e)}
                  ondragend={onChipDragEnd}
                  class="pointer-events-auto mr-0.5 flex items-center gap-1 truncate border px-1.5 text-left text-[11px] font-medium leading-[20px] hover:brightness-95 {editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} {draggingEvent?.key === e.key ? 'opacity-40' : ''} {bar.continuesLeft ? 'rounded-l-none border-l-0 -ml-0.5' : 'rounded-l-[6px]'} {bar.continuesRight ? 'rounded-r-none border-r-0 -mr-1' : 'rounded-r-[6px]'}"
                  style="grid-column: {bar.startDayIdx + 1} / span {bar.span}; grid-row: {bar.lane + 1}; {pillStyle(e)}"
                  title={editable ? `${e.title} — drag to move, click to edit` : e.title}
                  onclick={(ev) => { ev.stopPropagation(); openEvent(e); }}
                >
                  {#if bar.continuesLeft}<span aria-hidden="true">‹</span>{/if}
                  <span class="truncate">{e.title}</span>
                  {#if bar.continuesRight}<span class="ml-auto" aria-hidden="true">›</span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
  {:else if view === 'week'}
    <!-- ─── Week view ──────────────────────────────────────────────────────
         Mon-Sun columns + a left hour gutter. All-day events sit in a
         tray above the time grid (so they don't compete with timed slots).
         Timed events render as absolutely-positioned blocks per column. -->
    <div class="card overflow-hidden">
      <!-- Day header row, aligned to the gutter + 7 columns. -->
      <div class="grid border-b border-surface-divider text-[11px]" style="grid-template-columns: 3.5rem repeat(7, minmax(0, 1fr));">
        <div class="bg-surface-hover/40"></div>
        {#each weekDays as d (d.toISOString())}
          {@const isToday = sameDay(d, today)}
          <button
            type="button"
            class="border-l border-surface-divider px-2 py-1.5 text-left transition hover:bg-surface-hover/60"
            onclick={() => openDay(d)}
            title="Open day view"
          >
            <div class="font-display uppercase" style="letter-spacing: 0.1em; color: var(--text-tertiary); font-size: 10px;">
              {new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(d)}
            </div>
            <div class="flex items-baseline gap-1.5">
              <span
                class="font-display text-base font-semibold tabular-nums {isToday ? '' : 'text-ink-700'}"
                style={isToday ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md); padding: 0 6px; letter-spacing: -0.02em;' : 'letter-spacing: -0.02em;'}
              >{d.getDate()}</span>
              <span class="text-[10px] text-ink-400">{new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(d)}</span>
            </div>
          </button>
        {/each}
      </div>

      <!-- All-day tray. Only renders when at least one all-day or
           multi-day event touches the week. The tray's height is
           capped (max-h-24 ≈ 4 rows of chips) with overflow-y-auto
           so a day full of holidays doesn't push the time grid down
           by tens of pixels. -->
      {#each [weekDays.map((d) => eventsOnDay(d).allDay)] as columns}
        {#if columns.some((c) => c.length > 0)}
          <div class="grid border-b border-surface-divider" style="grid-template-columns: 3.5rem repeat(7, minmax(0, 1fr));">
            <div class="px-2 py-1.5 text-right font-display uppercase" style="font-size: 10px; letter-spacing: 0.1em; color: var(--text-tertiary);">All day</div>
            {#each weekDays as d, i (d.toISOString())}
              <div class="border-l border-surface-divider px-1 py-1 max-h-24 overflow-y-auto space-y-1">
                {#each columns[i] as e (e.key + ':allday')}
                  <button
                    type="button"
                    data-event-chip
                    class="flex w-full items-center gap-1 truncate border px-1.5 py-0.5 text-[11px] font-medium hover:brightness-95"
                    style={`${pillStyle(e)} border-radius: var(--radius-sm);`}
                    onclick={(ev) => { ev.stopPropagation(); openEvent(e); }}
                  >
                    <span class="truncate">{e.title}</span>
                  </button>
                {/each}
              </div>
            {/each}
          </div>
        {/if}
      {/each}

      <!-- Time grid. Gutter holds hour labels; each day column carries its
           own hour-line scaffold and absolutely-positioned event blocks. -->
      <div class="relative grid" style="grid-template-columns: 3.5rem repeat(7, minmax(0, 1fr)); height: {HOURS.length * HOUR_PX}px;">
        <!-- Hour gutter -->
        <div class="relative">
          {#each HOURS as h (h)}
            <div
              class="absolute right-2 -translate-y-1/2 font-display tabular-nums"
              style="top: {(h - DAY_START_HOUR) * HOUR_PX}px; font-size: 10px; color: var(--text-tertiary); letter-spacing: 0.04em;"
            >{hourLabel(h)}</div>
          {/each}
        </div>
        <!-- Day columns -->
        {#each weekDays as d (d.toISOString())}
          {@const { timed } = eventsOnDay(d)}
          {@const colLanes = computeDayLanes(timed)}
          {@const isToday = sameDay(d, today)}
          {@const nowY = nowYIfVisible(d)}
          <div
            class="relative border-l border-surface-divider {isToday ? 'bg-brand/[0.04]' : ''}"
            onclick={(e) => {
              if ((e.target as HTMLElement).closest('[data-event-chip]')) return;
              openAdd(d, slotTimeFromClick(e));
            }}
            role="presentation"
          >
            <!-- Hour lines -->
            {#each HOURS as h, i (h)}
              {#if i > 0}
                <div class="absolute inset-x-0 border-t border-surface-divider/60" style="top: {(h - DAY_START_HOUR) * HOUR_PX}px;"></div>
              {/if}
            {/each}
            <!-- Now line -->
            {#if nowY !== null}
              <div class="cal-now-line pointer-events-none absolute inset-x-0 z-10" style="top: {nowY}px;">
                <div class="h-px" style="background: var(--accent-electric);"></div>
                <div class="absolute -top-1 left-0 h-2 w-2 rounded-full" style="background: var(--accent-electric);"></div>
              </div>
            {/if}
            <!-- Timed events — lane-assigned within the day column
                 so concurrent meetings sit side-by-side instead of
                 stacking on top of each other and clipping titles.
                 Compact <30px blocks (rare in week view since slots
                 are tight) collapse to a single title line; taller
                 ones keep the time-on-top stack. -->
            {#each colLanes as { event: e, lane, clusterLanes } (e.key)}
              {@const editable = !!e.datesId}
              {@const h = timeHeight(e.start, e.end)}
              {@const compact = h < 30}
              <button
                type="button"
                data-event-chip
                draggable={editable}
                ondragstart={(ev) => onChipDragStart(ev, e)}
                ondragend={onChipDragEnd}
                class="absolute flex flex-col items-start overflow-hidden border px-1 py-0.5 text-left text-[11px] font-medium leading-tight hover:brightness-95 {editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} {draggingEvent?.key === e.key ? 'opacity-40' : ''}"
                style={`top: ${timeY(e.start)}px; height: ${h}px; left: calc(0.25rem + (100% - 0.5rem) * ${lane / clusterLanes}); width: calc((100% - 0.5rem) * ${1 / clusterLanes} - 2px); ${pillStyle(e)} border-radius: var(--radius-sm);`}
                title={`${timeOf(e.start)}–${timeOf(e.end)} ${e.title}`}
                onclick={(ev) => { ev.stopPropagation(); openEvent(e); }}
              >
                {#if compact}
                  <span class="truncate">{e.title}</span>
                {:else}
                  <span class="tabular-nums opacity-80" style="font-size: 10px;">{timeOf(e.start)}</span>
                  <span class="truncate">{e.title}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {:else if view === 'day'}
    <!-- ─── Day view ───────────────────────────────────────────────────────
         A single-column timeline with the same gutter + hour scaffold. The
         all-day tray sits as a compact strip above the timeline. -->
    {@const { allDay, timed } = eventsOnDay(cursor)}
    {@const dayLanes = computeDayLanes(timed)}
    {@const dayIsToday = sameDay(cursor, today)}
    {@const dayNowY = nowYIfVisible(cursor)}
    <div class="card overflow-hidden">
      <!-- All-day strip -->
      {#if allDay.length > 0}
        <div class="grid border-b border-surface-divider" style="grid-template-columns: 3.5rem 1fr;">
          <div class="px-2 py-2 text-right font-display uppercase" style="font-size: 10px; letter-spacing: 0.1em; color: var(--text-tertiary);">All day</div>
          <div class="flex flex-wrap gap-1.5 border-l border-surface-divider px-2 py-2">
            {#each allDay as e (e.key + ':allday')}
              <button
                type="button"
                data-event-chip
                class="inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-medium hover:brightness-95"
                style={`${pillStyle(e)} border-radius: var(--radius-pill);`}
                onclick={(ev) => { ev.stopPropagation(); openEvent(e); }}
              >
                <span class="inline-block h-1.5 w-1.5 rounded-full" style:background-color={eventColor(e)}></span>
                <span class="truncate">{e.title}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Time grid -->
      <div class="relative grid" style="grid-template-columns: 3.5rem 1fr; height: {HOURS.length * HOUR_PX}px;">
        <div class="relative">
          {#each HOURS as h (h)}
            <div
              class="absolute right-2 -translate-y-1/2 font-display tabular-nums"
              style="top: {(h - DAY_START_HOUR) * HOUR_PX}px; font-size: 10px; color: var(--text-tertiary); letter-spacing: 0.04em;"
            >{hourLabel(h)}</div>
          {/each}
        </div>
        <div
          class="relative border-l border-surface-divider {dayIsToday ? 'bg-brand/[0.04]' : ''}"
          onclick={(e) => {
            if ((e.target as HTMLElement).closest('[data-event-chip]')) return;
            openAdd(cursor, slotTimeFromClick(e));
          }}
          role="presentation"
        >
          {#each HOURS as h, i (h)}
            {#if i > 0}
              <div class="absolute inset-x-0 border-t border-surface-divider/60" style="top: {(h - DAY_START_HOUR) * HOUR_PX}px;"></div>
            {/if}
          {/each}
          {#if dayNowY !== null}
            <div class="cal-now-line pointer-events-none absolute inset-x-0 z-10" style="top: {dayNowY}px;">
              <div class="h-px" style="background: var(--accent-electric);"></div>
              <div class="absolute -top-1 left-0 h-2 w-2 rounded-full" style="background: var(--accent-electric);"></div>
            </div>
          {/if}
          {#each dayLanes as { event: e, lane, clusterLanes } (e.key)}
            {@const editable = !!e.datesId}
            {@const h = timeHeight(e.start, e.end)}
            {@const compact = h < 40}
            {@const tall = h >= 64}
            <!-- Day-view block. Layout:
                 - left colour bar (Helga-style accent strip)
                 - title (always visible; bold) on the first line
                 - time + location only when the block has room
                 Short blocks (<40px) get a single-line layout —
                 bold title with time inlined after; the previous
                 design stacked time on top and cropped the title
                 out of view on 30-minute events.
                 Width: positioned per-lane within the event's
                 overlap cluster, so concurrent events sit side-by-
                 side instead of stacked on top of each other. -->
            <button
              type="button"
              data-event-chip
              draggable={editable}
              ondragstart={(ev) => onChipDragStart(ev, e)}
              ondragend={onChipDragEnd}
              class="absolute flex overflow-hidden border text-left hover:brightness-95 {editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} {draggingEvent?.key === e.key ? 'opacity-40' : ''}"
              style={`top: ${timeY(e.start)}px; height: ${h}px; left: calc(0.5rem + (100% - 1rem) * ${lane / clusterLanes}); width: calc((100% - 1rem) * ${1 / clusterLanes} - 2px); ${pillStyle(e)} border-radius: var(--radius-sm);`}
              title={`${timeOf(e.start)}–${timeOf(e.end)} ${e.title}${e.meta?.location ? ` · 📍 ${e.meta.location}` : ''}`}
              onclick={(ev) => { ev.stopPropagation(); openEvent(e); }}
            >
              <!-- Left accent bar. Same hue as the chip pill but
                   solid so the title beside it always has a clear
                   visual anchor — even on pale source backgrounds. -->
              <span
                class="block w-1 shrink-0"
                style:background-color={eventColor(e)}
                aria-hidden="true"
              ></span>
              {#if compact}
                <!-- Single-line compact layout for short blocks. -->
                <span class="flex min-w-0 flex-1 items-baseline gap-1.5 px-1.5 py-0.5">
                  <span class="truncate text-[13px] font-semibold leading-tight text-ink-900">{e.title}</span>
                  <span class="ml-auto shrink-0 font-display tabular-nums text-[10px] leading-tight text-ink-500">{timeOf(e.start)}</span>
                </span>
              {:else}
                <span class="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-1.5">
                  <span class="truncate text-sm font-semibold leading-tight text-ink-900">{e.title}</span>
                  <span class="flex flex-wrap items-center gap-x-2 font-display tabular-nums text-[11px] leading-tight text-ink-500">
                    <span>{timeOf(e.start)}–{timeOf(e.end)}</span>
                    {#if tall && e.meta?.location}
                      <span class="truncate text-ink-500/80">📍 {e.meta.location}</span>
                    {/if}
                  </span>
                  {#if tall && stripMeetingBoilerplate(e.meta?.description as string | undefined)}
                    {@const desc = stripMeetingBoilerplate(e.meta?.description as string | undefined).split('\n')[0]}
                    <span class="truncate text-[11px] leading-snug text-ink-500/80">{desc}</span>
                  {/if}
                </span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <!-- ─── List view ──────────────────────────────────────────────────────
         Flat chronological list of events in the visible month, grouped
         by day. Useful when the grid is too dense to scan (e.g. dozens
         of synced events per week) or when the user just wants to read
         "what's coming up". -->

    <!-- Batch toolbar — only present in the list view. Selectable rows
         are limited to real Dates rows (e.datesId set); derived events
         (birthdays, project spans) skip the checkbox column. -->
    <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-surface-border bg-surface-card px-3 py-2">
      <div class="flex items-center gap-2">
        {#if batchMode}
          <span class="text-xs text-ink-600">{batchSelected.size} selected</span>
          <button class="text-[11px] text-ink-400 hover:text-ink-700 underline-offset-2 hover:underline" onclick={selectAllListItems} disabled={batchBusy}>Select all in view</button>
          <button class="text-[11px] text-ink-400 hover:text-ink-700 underline-offset-2 hover:underline" onclick={() => (batchSelected = new Set())} disabled={batchBusy || batchSelected.size === 0}>Clear</button>
        {:else}
          <span class="text-xs text-ink-400">{listGroups.reduce((n, g) => n + g.items.length, 0)} events</span>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        {#if batchMode}
          <button
            class="inline-flex items-center gap-1 rounded-md border border-surface-border px-2 py-1 text-xs font-medium hover:bg-surface-hover"
            onclick={() => (batchEditPanel = batchEditPanel === 'edit' ? null : 'edit')}
            disabled={batchBusy || batchSelected.size === 0}
            aria-expanded={batchEditPanel === 'edit'}
          >
            <Icon name="pencil" size={12} /> Edit
          </button>
          <button
            class="inline-flex items-center gap-1 rounded-md border border-tag-sales px-2 py-1 text-xs font-medium text-tag-salesText hover:bg-tag-sales/20"
            onclick={doBatchArchive}
            disabled={batchBusy || batchSelected.size === 0}
          >
            <Icon name="x" size={12} /> Archive
          </button>
          <button class="btn-ghost text-xs" onclick={exitBatchMode} disabled={batchBusy}>Done</button>
        {:else}
          <button
            class="inline-flex items-center gap-1 rounded-md border border-surface-border px-2 py-1 text-xs font-medium hover:bg-surface-hover"
            onclick={() => (batchMode = true)}
          >
            <Icon name="check" size={12} /> Select
          </button>
        {/if}
      </div>
    </div>

    {#if batchError}
      <div class="rounded-md border border-tag-sales bg-tag-sales/20 px-3 py-2 text-xs text-tag-salesText">{batchError}</div>
    {/if}

    {#if batchMode && batchEditPanel === 'edit'}
      <div class="rounded-md border border-surface-border bg-surface-card px-3 py-2 space-y-2 text-sm">
        <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">Apply to {batchSelected.size} selected — leave fields as "unchanged" to skip</div>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="flex flex-col gap-1">
            <span class="text-[11px] text-ink-500">Scope</span>
            <select bind:value={batchEditScope} class="rounded-md border border-surface-border bg-surface-card px-2 py-1 text-sm focus:border-brand focus:outline-none">
              <option value="unchanged">— Unchanged —</option>
              <option value="work">Work</option>
              <option value="private">Private</option>
              <option value="both">Both</option>
            </select>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-[11px] text-ink-500">Kind</span>
            <select bind:value={batchEditKind} class="rounded-md border border-surface-border bg-surface-card px-2 py-1 text-sm focus:border-brand focus:outline-none">
              <option value="unchanged">— Unchanged —</option>
              <option value="event">Event</option>
              <option value="meeting">Meeting</option>
              <option value="travel">Travel</option>
              <option value="holiday">Holiday</option>
              <option value="family_day">Family day</option>
              <option value="reminder">Reminder</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>
        <div class="flex justify-end gap-2">
          <button class="btn-ghost text-xs" onclick={() => { batchEditPanel = null; batchEditScope = 'unchanged'; batchEditKind = 'unchanged'; }} disabled={batchBusy}>Cancel</button>
          <button class="btn-primary text-xs" onclick={doBatchEdit} disabled={batchBusy || (batchEditScope === 'unchanged' && batchEditKind === 'unchanged')}>
            {batchBusy ? 'Saving…' : 'Apply'}
          </button>
        </div>
      </div>
    {/if}

    <div class="card overflow-hidden">
      {#if listGroups.length === 0}
        <div class="px-4 py-8 text-center text-sm text-ink-400">
          {loading ? 'Loading events…' : 'No events match the current filters in this month.'}
        </div>
      {:else}
        <ul class="divide-y divide-surface-divider">
          {#each listGroups as g (g.dayKey)}
            {@const isTodayGroup = sameDay(g.date, today)}
            <li>
              <!-- Day header — sticky so the user can keep their place
                   while scrolling a long month. -->
              <div
                class="sticky top-0 z-[1] flex items-baseline gap-3 border-b border-surface-divider bg-surface-card/95 px-4 py-1.5 backdrop-blur"
              >
                <span
                  class="font-display tabular-nums {isTodayGroup ? 'rounded-md px-1.5' : ''} text-sm font-semibold"
                  style={isTodayGroup ? 'background: var(--accent-electric); color: var(--accent-text); letter-spacing: -0.01em;' : 'color: var(--text-primary); letter-spacing: -0.01em;'}
                >{g.date.getDate()}</span>
                <span class="font-display text-[11px] uppercase tracking-wider text-ink-400">
                  {new Intl.DateTimeFormat('en-GB', { weekday: 'long', month: 'short' }).format(g.date)}
                </span>
                {#if isTodayGroup}<span class="text-[10px] uppercase text-brand">today</span>{/if}
                <span class="ml-auto text-[11px] text-ink-400">{g.items.length} item{g.items.length === 1 ? '' : 's'}</span>
              </div>
              <ul class="divide-y divide-surface-divider/70">
                {#each g.items as e (e.key)}
                  {@const selectable = typeof e.datesId === 'number'}
                  {@const isSelected = selectable && batchSelected.has(e.datesId!)}
                  <li class="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-surface-hover {isSelected ? 'bg-brand/[0.06]' : ''}">
                    {#if batchMode}
                      <!-- Checkbox column. Derived events (no datesId)
                           render a placeholder so columns line up but
                           can't be selected. -->
                      {#if selectable}
                        <label class="flex shrink-0 cursor-pointer items-center" title="Select for batch action">
                          <input
                            type="checkbox"
                            class="accent-brand h-4 w-4"
                            checked={isSelected}
                            onchange={() => toggleBatch(e.datesId!)}
                            disabled={batchBusy}
                          />
                        </label>
                      {:else}
                        <span class="inline-block h-4 w-4 shrink-0" aria-hidden="true" title="Derived event — edit at the source"></span>
                      {/if}
                    {/if}
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onclick={() => {
                        // In batch mode, clicking the row toggles
                        // selection (if selectable) instead of opening
                        // the detail dialog — fewer pointer trips.
                        if (batchMode) {
                          if (selectable) toggleBatch(e.datesId!);
                          return;
                        }
                        openEvent(e);
                      }}
                    >
                      <span
                        class="inline-block h-2 w-2 shrink-0 rounded-full"
                        style:background-color={eventColor(e)}
                        aria-hidden="true"
                      ></span>
                      <span class="w-20 shrink-0 tabular-nums text-[11px] text-ink-500">
                        {#if e.allDay || !sameDay(e.start, e.end)}
                          All day
                        {:else}
                          {timeOf(e.start)}–{timeOf(e.end)}
                        {/if}
                      </span>
                      <span class="min-w-0 flex-1 truncate text-ink-900">{e.title}</span>
                      {#if e.meta?.location}
                        <span class="hidden sm:inline truncate text-[11px] text-ink-400 max-w-[12rem]">📍 {e.meta.location}</span>
                      {/if}
                      <span
                        class="hidden sm:inline rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider"
                        style:color={CAL_COLORS[calBucketOf(e)]}
                        style:border-color={`${CAL_COLORS[calBucketOf(e)]}55`}
                        style:background-color={`${CAL_COLORS[calBucketOf(e)]}1f`}
                      >{CAL_LABELS[calBucketOf(e)]}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
  </div>
</div>
  </div>

  <!-- ── Desktop peek rail ──────────────────────────────────────────────
       A real layout sibling, not an overlay: the grid above shrinks to
       make room rather than being covered, so nothing you need is hidden
       behind the thing you just opened. Sticky so it stays put while the
       month scrolls. -->
  {#if railOpen}
    <aside
      class="hidden w-[22rem] shrink-0 md:block lg:w-[24rem]"
      aria-label="Event details"
    >
      <div class="card sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto scroll-momentum p-4">
        <div class="mb-2 flex items-start justify-end">
          <button
            class="btn-ghost !px-2 -mr-1 -mt-1"
            onclick={() => (formOpen = false)}
            aria-label="Close event details"
          >×</button>
        </div>
        <div class="space-y-3">
          {@render peekBody()}
        </div>
      </div>
    </aside>
  {/if}
</div>

<!-- Mobile tools sheet — isolated child component (single tag, so it can't
     affect this template's structure). Opened via the chrome sliders
     button (?tools=1). -->
<CalendarToolsSheet
  open={showTools}
  onClose={closeTools}
  onPick={jumpToEvent}
  projects={allProjects}
  bind:selectedProjectIds
  bind:scopeFilter
  bind:kindFilter
  bind:calendarFilter
  bind:visibleCals
  calKeys={CAL_KEYS}
  calLabels={CAL_LABELS}
  calColors={CAL_COLORS}
  kindOptions={kindOptionsInRange}
  calendarOptions={calendarOptionsInRange}
  {activeFilterCount}
  onClear={clearAllFilters}
/>

<!-- Unified add / edit / view sheet -->
<!-- The peek body, rendered by BOTH the mobile sheet and the desktop rail.
     One definition so the two surfaces cannot drift apart. -->
{#snippet peekBody()}
  {#if formEvent}
        <!-- ─── Peek ────────────────────────────────────────────
             A summary, not a second event page. Colour dot + title,
             one time line, pills, place, faces — then the primary
             action is to open the real record. The old version put a
             hero, four metadata rows and a tab strip in a 400px-wide
             modal and still couldn't show a description. -->
        <div class="flex items-start gap-2">
          <span class="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style:background-color={eventColor(formEvent)}></span>
          <h3 class="min-w-0 flex-1 text-lg font-semibold leading-snug text-ink-900">{formEvent.title}</h3>
        </div>

        <!-- One line for when, via the same formatter the event page
             uses — same-day ranges print the day once. -->
        <p class="text-sm text-ink-600">
          {formatEventWhen(
            formEvent.start.toISOString(),
            formEvent.end?.toISOString() ?? null,
            { allDay: formEvent.allDay }
          )}
        </p>

        <EventPills
          kind={formEvent.kind}
          scope={formEvent.scope}
          calendar={CAL_LABELS[calBucketOf(formEvent)]}
        />

        {#if formEvent.meta?.location}
          <p class="flex items-start gap-1.5 text-sm text-ink-700">
            <Icon name="globe" size={14} class="mt-0.5 shrink-0 text-ink-400" />
            <span class="min-w-0">{formEvent.meta.location}</span>
          </p>
        {/if}
        <!-- Conferencing as controls. virtual_link is set on 7 of 1,490 rows;
             the other 583 joinable events only ever had their link inside the
             description, so this is the first time they get a Join button. -->
        {#if peekConf}
          <ConferenceCard conf={peekConf} compact={!isDesktop} />
        {/if}
        {#if formEvent.meta?.organizer}
          <p class="text-sm text-ink-700"><span class="text-ink-400">Organizer:</span> {formEvent.meta.organizer}</p>
        {/if}

        <!-- The faces double as the attendee-roster toggle. That roster
             is where contacts get resolved, so it must stay reachable —
             it just doesn't need a tab strip to hide behind. -->
        {#if fPeople.length > 0 || attendeeRows.length > 0}
          <div class="flex items-center gap-2">
            <AttendeeStack
              faces={fPeople.map((x) => ({ id: x.id, name: x.name, picture: x.picture, focal: x.focal }))}
              total={Math.max(fPeople.length, attendeeRows.length)}
              onclick={() => (viewTab = attendeesOpen ? 'details' : 'attendees')}
            />
            <button
              type="button"
              class="text-xs font-medium text-brand hover:underline"
              aria-expanded={attendeesOpen}
              onclick={() => (viewTab = attendeesOpen ? 'details' : 'attendees')}
            >{attendeesOpen ? 'Hide attendees' : 'Show attendees'}</button>
          </div>
        {/if}

        <!-- Details always render; there is no tab hiding them now. -->
          {#if peekDesc}
            <div class="rounded-md border border-surface-border bg-surface-hover/30 px-3 py-2 text-sm text-ink-700">
              <!-- Rendered in runs so a URL in the text is a real link
                   rather than dead characters you have to select. -->
              <div class="whitespace-pre-line break-words {peekDescIsLong && !peekDescOpen ? 'line-clamp-6' : ''}">
                {#each peekDescParts as part, i (i)}
                  {#if part.kind === 'link'}
                    <a
                      href={part.href}
                      target="_blank"
                      rel="noreferrer"
                      class="break-all text-brand hover:underline"
                    >{part.text}</a>
                  {:else}{part.text}{/if}
                {/each}
              </div>
              {#if peekDescIsLong}
                <button
                  type="button"
                  class="mt-1 text-xs font-medium text-brand hover:underline"
                  aria-expanded={peekDescOpen}
                  onclick={() => (peekDescOpen = !peekDescOpen)}
                >{peekDescOpen ? 'Show less' : 'Show more'}</button>
              {/if}
            </div>
          {:else if !formEvent.meta?.row || !(formEvent.meta.row as { is_recurring?: boolean }).is_recurring}
            <div class="text-sm text-ink-400">No description.</div>
          {/if}
          {#if formEvent.meta?.row && (formEvent.meta.row as { is_recurring?: boolean }).is_recurring}
            {@const row = formEvent.meta.row as { is_recurring?: boolean; recurrence_rule?: string | null; recurrence_end_date?: string | null }}
            <div class="rounded-md border border-surface-border bg-surface-hover/20 px-3 py-2 text-xs text-ink-600">
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium text-ink-700">Repeats</span>
                <span class="font-mono text-[10px] text-ink-400">{row.recurrence_rule}</span>
              </div>
              <div class="mt-0.5 text-ink-500">
                {describeRrule(row.recurrence_rule, formEvent.start) || 'recurring event'}
                {#if row.recurrence_end_date}
                  · ends {row.recurrence_end_date}
                {/if}
              </div>
            </div>
          {/if}
          {#if peekProvenance.notes.length > 0}
            <!-- How the row reached twin — metadata, not a description. -->
            {#each peekProvenance.notes as note (note)}
              <p class="text-[11px] leading-snug text-ink-400">{note}</p>
            {/each}
          {/if}
          {#if formEvent.meta?.external_calendar}
            <div class="text-[11px] text-ink-400">From calendar: <span class="text-ink-600">{formEvent.meta.external_calendar}</span></div>
          {/if}
          {#if formEvent.source === 'project_derived' || formEvent.source === 'birthday_derived'}
            <div class="text-[11px] italic text-ink-400">
              Read-only — derived from {formEvent.source.replace('_', ' ')}. Edit it at the source.
            </div>
          {/if}

        {#if attendeesOpen}
          {#if attendeeRows.length === 0}
            <div class="text-sm text-ink-400">No attendees recorded on this event.</div>
          {:else}
            {#if attendeeError}
              <div class="text-[11px] text-tag-salesText" title={attendeeError}>Couldn't resolve attendees to contacts — raw list shown.</div>
            {/if}
            {#if groupDone}
              <div class="text-[11px] text-tag-eventText">{groupDone}</div>
            {/if}
            {#if emailSavedFor}
              <!-- Say that the address was filed: it's the difference between
                   this link holding and the next invitation to the same
                   address landing as an unknown attendee again. -->
              <div class="text-[11px] text-tag-eventText">Saved {emailSavedFor}</div>
            {/if}
            <ul class="space-y-1 text-sm">
              {#each attendeeRows.slice(0, 20) as a (a.email || a.name)}
                {@const single = a.matches.length === 1 ? a.matches[0] : null}
                {@const ambiguous = a.matches.length > 1}
                {@const role = single ? attendeeRoles.get(single.id) : null}
                {@const orgRef = role?.organization_id}
                {@const org = orgRef && typeof orgRef === 'object' ? (orgRef as Organization) : null}
                <li class="flex flex-col gap-1 rounded-md border border-surface-border bg-surface-hover/20 px-2 py-1.5">
                  <div class="flex items-center justify-between gap-2">
                    <!-- Left: avatar (when we have a match) + identity stack. -->
                    <div class="flex min-w-0 flex-1 items-center gap-2">
                      {#if single}
                        <a href={`/people/${single.id}`} class="shrink-0" aria-label={`Open ${personName(single)}`}>
                          <Avatar
                            name={personName(single)}
                            src={single.person_picture ? (assetUrl(single.person_picture, { width: 56, height: 56, fit: 'cover' }) ?? '') : ''}
                            size={28}
                            position={single.image_focal ?? ''}
                          />
                        </a>
                      {:else}
                        <span
                          class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full {groupFor(a) ? 'bg-brand/10 text-brand' : 'bg-surface-hover text-ink-400'}"
                          aria-hidden="true"
                        >
                          <Icon name="users" size={14} />
                        </span>
                      {/if}
                      <div class="min-w-0 flex-1">
                        {#if single}
                          <a href={`/people/${single.id}`} class="block truncate font-medium text-ink-900 hover:text-brand">
                            {personName(single)}
                          </a>
                          <div class="flex flex-wrap items-center gap-x-1.5 text-[10px] text-ink-400">
                            {#if org}
                              <a href={`/orgs/${org.id}`} class="truncate text-ink-500 hover:text-brand" onclick={(e) => e.stopPropagation()}>
                                {#if role?.role}<span class="text-ink-600">{role.role}</span> · {/if}{org.name}
                              </a>
                              <span>·</span>
                            {:else if role?.role}
                              <span class="truncate text-ink-500">{role.role}</span>
                              <span>·</span>
                            {/if}
                            <span class="truncate">{a.email}</span>
                          </div>
                        {:else if ambiguous}
                          <div class="truncate text-ink-900">{a.name || a.email}</div>
                          <div class="truncate text-[10px] text-tag-salesText">{a.matches.length} matches — pick one</div>
                        {:else if groupFor(a)}
                          {@const g = groupFor(a)}
                          <div class="truncate text-ink-900">{g?.label || a.name || a.email}</div>
                          <div class="truncate text-[10px] text-ink-400">
                            group · {a.email}{groupTally(a)[1] > 0
                              ? ` · ${groupTally(a)[0]} of ${groupTally(a)[1]} on this event`
                              : ''}
                          </div>
                        {:else}
                          <div class="truncate text-ink-700">{a.name || a.email}</div>
                          {#if a.name && a.email}<div class="truncate text-[10px] text-ink-400">{a.email}</div>{/if}
                        {/if}
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                      {#if a.status}
                        <span class="rounded-full border border-surface-border bg-surface-hover px-1.5 py-0.5 text-[10px] capitalize text-ink-500">{a.status}</span>
                      {/if}
                      {#if !single && !ambiguous && a.email && groupFor(a) && groupTally(a)[1] > 0 && groupTally(a)[0] === groupTally(a)[1]}
                        <!-- Whole group already here. Derived from fPeople, so
                             this is right on a cold load too. -->
                        <span class="text-[10px] text-tag-eventText">all {groupTally(a)[1]} attached</span>
                      {:else if !single && !ambiguous && a.email && groupFor(a)}
                        <!-- A known group address. Neither "link one contact"
                             nor "create a contact" is right for an address
                             that stands for a team. -->
                        {@const g = groupFor(a)}
                        <button
                          type="button"
                          class="rounded-md border border-surface-border bg-surface-card px-2 py-0.5 text-[10px] font-medium text-brand hover:bg-surface-hover disabled:opacity-50"
                          disabled={groupBusy === attendeeKey(a)}
                          title={`Attach everyone in ${g?.label || a.email}`}
                          onclick={() => attachGroup(a)}
                        >{groupBusy === attendeeKey(a) ? 'Attaching…' : `+ Attach ${g?.label || 'group'}`}</button>
                      {:else if !single && !ambiguous && a.email}
                        <!-- Two offers, not one. Zero email matches means the
                             address is unknown, not that the person is: the
                             contact may simply be filed under another one, and
                             "+ Add as contact" alone quietly made duplicates. -->
                        <button
                          type="button"
                          class="rounded-md border border-surface-border bg-surface-card px-2 py-0.5 text-[10px] font-medium text-ink-600 hover:bg-surface-hover"
                          onclick={() => (linkingKey === attendeeKey(a) ? closeLinkSearch() : openLinkSearch(a))}
                          aria-expanded={linkingKey === attendeeKey(a)}
                          title="Attach a contact that already exists"
                        >Link…</button>
                        <button
                          type="button"
                          class="rounded-md border border-surface-border bg-surface-card px-2 py-0.5 text-[10px] font-medium text-brand hover:bg-surface-hover disabled:opacity-50"
                          onclick={() => createPersonFromAttendee(a)}
                          disabled={!!a.creating}
                          title="Create a new contact from this email and attach to the meeting"
                        >{a.creating ? 'Creating…' : '+ New'}</button>
                      {/if}
                    </div>
                  </div>
                  {#if linkingKey === attendeeKey(a)}
                    <!-- Inline rather than a nested dialog: the roster already
                         lives inside a sheet or a rail, and a third stacked
                         layer would have nowhere to go on a phone. -->
                    <div class="ml-1 mt-1 space-y-1">
                      <input
                        class="input w-full text-xs"
                        placeholder="Search contacts…"
                        value={linkQuery}
                        oninput={(e) => onLinkQuery((e.currentTarget as HTMLInputElement).value)}
                        onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeLinkSearch(); } }}
                      />
                      {#if linkSearching && linkResults.length === 0}
                        <p class="text-[10px] text-ink-400">Searching…</p>
                      {:else if linkQuery.trim() && linkResults.length === 0}
                        <p class="text-[10px] text-ink-400">
                          No contact matches "{linkQuery.trim()}" — use + New to create one.
                        </p>
                      {/if}
                      {#each linkResults as cand (cand.id)}
                        {@const already = fPeople.some((p) => p.id === cand.id)}
                        <button
                          type="button"
                          class="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-surface-hover disabled:opacity-40"
                          disabled={already}
                          onclick={() => linkExisting(a, cand)}
                        >
                          <span class="flex min-w-0 items-center gap-2">
                            <Avatar
                              name={personName(cand)}
                              src={cand.person_picture ? (assetUrl(cand.person_picture, { width: 48, height: 48, fit: 'cover' }) ?? '') : ''}
                              size={20}
                              position={cand.image_focal ?? ''}
                              lazy
                            />
                            <span class="min-w-0">
                              <span class="block truncate text-ink-700">{personName(cand)}</span>
                              {#if cand.email}<span class="block truncate text-[10px] text-ink-400">{cand.email}</span>{/if}
                            </span>
                          </span>
                          <span class="shrink-0 text-[10px] {already ? 'text-ink-400' : 'text-brand'}">
                            {already ? 'already on this event' : 'link →'}
                          </span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                  {#if ambiguous}
                    <ul class="ml-1 space-y-0.5">
                      {#each a.matches as cand (cand.id)}
                        {@const candRole = attendeeRoles.get(cand.id)}
                        {@const candOrgRef = candRole?.organization_id}
                        {@const candOrg = candOrgRef && typeof candOrgRef === 'object' ? (candOrgRef as Organization) : null}
                        <li>
                          <button
                            type="button"
                            class="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-surface-hover"
                            onclick={() => pickAttendeeMatch(a, cand)}
                          >
                            <span class="flex min-w-0 items-center gap-2">
                              <Avatar
                                name={personName(cand)}
                                src={cand.person_picture ? (assetUrl(cand.person_picture, { width: 48, height: 48, fit: 'cover' }) ?? '') : ''}
                                size={20}
                                position={cand.image_focal ?? ''}
                              />
                              <span class="min-w-0">
                                <a href={`/people/${cand.id}`} class="block truncate text-ink-700 hover:text-brand" onclick={(e) => e.stopPropagation()}>{personName(cand)}</a>
                                {#if candOrg}<span class="block truncate text-[10px] text-ink-400">{candOrg.name}</span>{/if}
                              </span>
                            </span>
                            <span class="shrink-0 text-[10px] text-brand">use this →</span>
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if attendeeRows.length > 20}
              <div class="mt-1 text-[11px] text-ink-400">+ {attendeeRows.length - 20} more</div>
            {/if}
          {/if}
        {/if}

        <!-- One primary action. Opening the record is nearly always what
             you came for, and it's the thing the old sheet buried in a
             plain "Open linked record →" text link above the tabs. -->
        <div class="flex items-center gap-2 border-t border-surface-divider pt-3">
          {#if formEvent.href}
            <a class="btn-primary flex-1 justify-center" href={formEvent.href}>
              Open event <Icon name="arrow-right" size={14} />
            </a>
          {/if}
          {#if formEvent.datesId}
            <button
              class="btn-ghost {formEvent.href ? '' : 'flex-1 justify-center'} text-brand"
              onclick={() => { formMode = 'edit'; }}
            >Edit</button>
          {/if}
          {#if !formEvent.href && !formEvent.datesId}
            <button class="btn-ghost flex-1 justify-center" onclick={() => (formOpen = false)}>Close</button>
          {/if}
        </div>
  {/if}
{/snippet}

<BottomSheet
  open={sheetOpen}
  title={formMode === 'add' ? 'New event' : formMode === 'edit' ? 'Edit event' : ''}
  expandable={formMode === 'view'}
  initialExpanded={formMode === 'view'}
  onClose={() => (formOpen = false)}
>
  {#snippet children()}
    <div class="space-y-3">
      {#if formMode === 'view'}
        {@render peekBody()}
      {:else}
        <!-- Add / Edit form (shared) -->
        {#if formMode === 'add' && formAnchorDate}
          <div class="text-xs text-ink-500">
            On {new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(formAnchorDate)}
          </div>
        {/if}

        <!-- Title as a display-font heading. Tap the pencil to edit;
             EditableField commits on Enter / blur. We feed it into
             local `fTitle` (no backend round-trip) since the form's
             own Save handles persistence at the bottom. Same UX as
             the person/org detail headers. -->
        <h1
          class="cal-title font-display text-2xl font-bold tracking-tight sm:text-3xl"
          style="letter-spacing: -0.02em;"
        >
          <EditableField
            value={fTitle || null}
            placeholder={formMode === 'add' ? 'Name this event' : 'Untitled event'}
            onSave={(v) => { fTitle = (v ?? '').trim(); }}
          />
        </h1>

        <!-- Stacked-avatar preview of currently-connected people.
             Each face links to its own /people/{id} detail page; the
             label-row at the end opens the People editor panel.
             That way the chip is both navigation *and* an entry point
             to editing. -->
        {#if fPeople.length > 0}
          <div class="cal-people-preview">
            <span class="cal-people-stack">
              {#each fPeople.slice(0, 4) as p (p.id)}
                <a
                  href={`/people/${p.id}`}
                  class="cal-people-stack-avatar"
                  title={p.name}
                  aria-label={`Open ${p.name}`}
                >
                  <Avatar
                    name={p.name}
                    src={p.picture ? (assetUrl(p.picture, { width: 56, height: 56, fit: 'cover' }) ?? '') : ''}
                    size={28}
                    position={p.focal ?? ''}
                  />
                </a>
              {/each}
              {#if fPeople.length > 4}
                <span class="cal-people-stack-more" aria-label={`${fPeople.length - 4} more`}>+{fPeople.length - 4}</span>
              {/if}
            </span>
            {#if fPeople.length === 1}
              <a
                href={`/people/${fPeople[0].id}`}
                class="cal-people-preview-label cal-people-preview-name"
              >{fPeople[0].name}</a>
            {:else}
              <button
                type="button"
                class="cal-people-preview-label cal-people-preview-summary"
                onclick={() => (openSection = openSection === 'people' ? null : 'people')}
                aria-label="Edit people"
              >{fPeople.length} people</button>
            {/if}
            <button
              type="button"
              class="cal-people-edit"
              onclick={() => (openSection = openSection === 'people' ? null : 'people')}
              aria-label="Edit people"
              title="Edit people"
            >
              <Icon name="plus" size={12} />
            </button>
          </div>
        {/if}

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="block text-xs text-ink-400 mb-1">Kind</span>
            <select class="input w-full" bind:value={fKind}>
              {#each KIND_OPTIONS as k}<option value={k.value}>{k.label}</option>{/each}
            </select>
          </label>
          <label class="block">
            <span class="block text-xs text-ink-400 mb-1">Scope</span>
            <select class="input w-full" bind:value={fScope}>
              <option value="">— any —</option>
              <option value="work">Work</option>
              <option value="private">Private</option>
              <option value="both">Both</option>
            </select>
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label class="inline-flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand" bind:checked={fAllDay} />
            All day
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand" bind:checked={fRecurring} />
            Repeats
          </label>
        </div>

        {#if fRecurring}
          <!-- Recurrence picker — same shape as the holiday create
               sheet. The pattern anchors on the event's start date. -->
          <div class="rounded-[10px] border border-surface-border bg-surface-card/50 p-3">
            <div class="mb-2 font-display text-[10px] uppercase tracking-wider text-ink-400">Recurrence pattern</div>
            <div class="grid grid-cols-2 gap-2">
              <label class="block">
                <span class="block text-xs text-ink-400 mb-1">Repeats</span>
                <select class="input w-full" bind:value={fFreq}>
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              </label>
              <label class="block">
                <span class="block text-xs text-ink-400 mb-1">Every</span>
                <div class="flex items-center gap-2">
                  <input type="number" min="1" max="99" class="input w-20" bind:value={fInterval} />
                  <span class="text-sm text-ink-500">{fFreq === 'YEARLY' ? 'year(s)' : fFreq === 'MONTHLY' ? 'month(s)' : fFreq === 'WEEKLY' ? 'week(s)' : 'day(s)'}</span>
                </div>
              </label>
            </div>
            <p class="mt-2 text-[11px] text-ink-400">Anchors on the event's start date — edit the event later to change the pattern.</p>
          </div>
        {/if}

        {#if fAllDay}
          <div class="grid grid-cols-2 gap-2">
            <label class="block">
              <span class="block text-xs text-ink-400 mb-1">Starts on</span>
              <input type="date" class="input w-full" bind:value={fStartDate} />
            </label>
            <label class="block">
              <span class="block text-xs text-ink-400 mb-1">Ends on (optional)</span>
              <input type="date" class="input w-full" bind:value={fEndDate} />
            </label>
          </div>
        {:else}
          <label class="block">
            <span class="block text-xs text-ink-400 mb-1">Date</span>
            <input type="date" class="input w-full" bind:value={fStartDate} />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="block">
              <span class="block text-xs text-ink-400 mb-1">Start</span>
              <input type="time" class="input w-full" bind:value={fStartTime} />
            </label>
            <label class="block">
              <span class="block text-xs text-ink-400 mb-1">End</span>
              <input type="time" class="input w-full" bind:value={fEndTime} />
            </label>
          </div>
        {/if}

        <!-- Compact relations + optional fields. Each section starts
             as a single pill: empty pills are dashed-outline "+ Add X"
             affordances; pills with a value show the value and a
             small × to clear. Tapping any pill expands ONE inline
             panel at a time. -->
        <div class="cal-pill-row">
          <!-- Location -->
          {#if fLocation && openSection !== 'location'}
            <span class="cal-pill cal-pill-set">
              <button type="button" class="cal-pill-main" onclick={() => toggleSection('location')}>
                <Icon name="globe" size={12} />
                <span class="cal-pill-label">{fLocation}</span>
              </button>
              <button type="button" class="cal-pill-x" aria-label="Clear location" onclick={() => { fLocation = ''; }}>×</button>
            </span>
          {:else}
            <button
              type="button"
              class="cal-pill"
              class:cal-pill-active={openSection === 'location'}
              onclick={() => toggleSection('location')}
            >
              <Icon name="globe" size={12} />
              <span>Add location</span>
            </button>
          {/if}

          <!-- Project. The name is an anchor to /projects/{id}; the
               separate × clears, and tapping the pencil-equivalent
               swap button re-opens the picker for replacement. -->
          {#if fProjectId && openSection !== 'project'}
            <span class="cal-pill cal-pill-set">
              <a class="cal-pill-main" href={`/projects/${fProjectId}`} title="Open project">
                <Icon name="sparkles" size={12} />
                <span class="cal-pill-label">{fProjectLabel || `#${fProjectId}`}</span>
              </a>
              <button type="button" class="cal-pill-x" aria-label="Replace project" title="Replace" onclick={() => toggleSection('project')}>
                <Icon name="move" size={10} />
              </button>
              <button type="button" class="cal-pill-x" aria-label="Clear project" onclick={() => pickProj(null)}>×</button>
            </span>
          {:else}
            <button
              type="button"
              class="cal-pill"
              class:cal-pill-active={openSection === 'project'}
              onclick={() => toggleSection('project')}
            >
              <Icon name="sparkles" size={12} />
              <span>Add project</span>
            </button>
          {/if}

          <!-- Org. Name → /orgs/{id}; swap to replace; × to clear. -->
          {#if fOrgId && openSection !== 'org'}
            <span class="cal-pill cal-pill-set">
              <a class="cal-pill-main" href={`/orgs/${fOrgId}`} title="Open organisation">
                <Icon name="building" size={12} />
                <span class="cal-pill-label">{fOrgLabel || `#${fOrgId}`}</span>
              </a>
              <button type="button" class="cal-pill-x" aria-label="Replace organisation" title="Replace" onclick={() => toggleSection('org')}>
                <Icon name="move" size={10} />
              </button>
              <button type="button" class="cal-pill-x" aria-label="Clear organisation" onclick={() => pickOrg(null)}>×</button>
            </span>
          {:else}
            <button
              type="button"
              class="cal-pill"
              class:cal-pill-active={openSection === 'org'}
              onclick={() => toggleSection('org')}
            >
              <Icon name="building" size={12} />
              <span>Add org</span>
            </button>
          {/if}

          <!-- People (multi). When people are already attached the
               stacked-avatar preview below the title is the richer
               affordance, so we only render the "+ Add people" pill
               in the empty state. -->
          {#if fPeople.length === 0}
            <button
              type="button"
              class="cal-pill"
              class:cal-pill-active={openSection === 'people'}
              onclick={() => toggleSection('people')}
            >
              <Icon name="users" size={12} />
              <span>Add people</span>
            </button>
          {/if}

          <!-- Notes -->
          {#if fDescription && openSection !== 'notes'}
            <span class="cal-pill cal-pill-set">
              <button type="button" class="cal-pill-main" onclick={() => toggleSection('notes')}>
                <Icon name="notebook" size={12} />
                <span class="cal-pill-label">{fDescription.length} chars</span>
              </button>
              <button type="button" class="cal-pill-x" aria-label="Clear notes" onclick={() => { fDescription = ''; }}>×</button>
            </span>
          {:else}
            <button
              type="button"
              class="cal-pill"
              class:cal-pill-active={openSection === 'notes'}
              onclick={() => toggleSection('notes')}
            >
              <Icon name="notebook" size={12} />
              <span>Add notes</span>
            </button>
          {/if}
        </div>

        <!-- Expanded panel for whichever section is open. Only one
             panel renders at a time so the modal stays compact. -->
        {#if openSection === 'location'}
          <div class="cal-section">
            <label class="block text-xs text-ink-400 mb-1">Location</label>
            <input
              type="text"
              class="input w-full"
              bind:value={fLocation}
              placeholder="e.g. Head office, Zoom, Reykjavík"
              oninput={() => { fPlaceId = null; }}
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); closeSection(); } }}
              autofocus
            />

            <!-- Suggestions, not autocomplete: these are places we already
                 know about through the org on this event or through where
                 the device is, ordered by how often meetings actually
                 happened there. Typing something else is always allowed. -->
            {#if placeSuggestions.length > 0}
              <ul class="cal-place-sug">
                {#each placeSuggestions as sug (sug.place.id)}
                  <li>
                    <button
                      type="button"
                      class="cal-place-btn"
                      class:sel={fPlaceId === sug.place.id}
                      onclick={() => pickPlace(sug)}
                    >
                      <Icon name="flag" size={13} />
                      <span class="cal-place-name">{placeLabel(sug.place)}</span>
                      <span class="cal-place-why">{sug.why}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}

            {#if fPlaceId}
              <p class="cal-place-note">Linked to a saved place — this one counts towards future suggestions.</p>
            {:else if fLocation.trim()}
              <button
                type="button"
                class="btn-ghost text-xs mt-1"
                disabled={savingPlace}
                onclick={savePlaceFromText}
              >
                {savingPlace ? 'Saving…' : `Save “${fLocation.trim()}” as a place${fOrgId ? ' for this org' : ''}`}
              </button>
            {/if}

            <div class="cal-section-done">
              <button type="button" class="btn-ghost text-xs" onclick={closeSection}>Done</button>
            </div>
          </div>
        {/if}

        {#if openSection === 'project'}
          <div class="cal-section relative">
            <label class="block text-xs text-ink-400 mb-1" for="cal-proj">Project</label>
            <input
              id="cal-proj"
              type="text"
              autocomplete="off"
              class="input w-full"
              placeholder="Search projects…"
              value={projQ}
              oninput={onProjQuery}
              autofocus
            />
            {#if projResults.length > 0}
              <ul class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
                {#each projResults as p (p.id)}
                  <li>
                    <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => { pickProj(p); closeSection(); }}>
                      <Icon name="sparkles" size={14} />
                      <span class="truncate">{p.name}</span>
                      {#if p.kind}<span class="ml-auto text-xs text-ink-400">{p.kind}</span>{/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="cal-section-done">
              <button type="button" class="btn-ghost text-xs" onclick={closeSection}>Done</button>
            </div>
          </div>
        {/if}

        {#if openSection === 'org'}
          <div class="cal-section relative">
            <label class="block text-xs text-ink-400 mb-1" for="cal-org">Organisation</label>
            <input
              id="cal-org"
              type="text"
              autocomplete="off"
              class="input w-full"
              placeholder="Search orgs…"
              value={orgQ}
              oninput={onOrgQuery}
              autofocus
            />
            {#if orgResults.length > 0}
              <ul class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
                {#each orgResults as o (o.id)}
                  <li>
                    <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => { pickOrg(o); closeSection(); }}>
                      <Icon name="building" size={14} />
                      <span class="truncate">{o.name}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="cal-section-done">
              <button type="button" class="btn-ghost text-xs" onclick={closeSection}>Done</button>
            </div>
          </div>
        {/if}

        {#if openSection === 'people'}
          <div class="cal-section relative">
            <label class="block text-xs text-ink-400 mb-1" for="cal-people">People</label>
            {#if fPeople.length > 0}
              <!-- Existing-attendee chips: name links to the person's
                   detail page; × detaches without leaving the modal. -->
              <div class="mb-1.5 flex flex-wrap gap-1.5">
                {#each fPeople as p (p.id)}
                  <span class="inline-flex items-center gap-1 rounded-full bg-brand/10 text-brand-700 px-2 py-0.5 text-xs">
                    <a href={`/people/${p.id}`} class="hover:underline" title={`Open ${p.name}`}>{p.name}</a>
                    <button type="button" class="text-ink-400 hover:text-tag-salesText" onclick={() => removePersonFromForm(p.id)} aria-label="Remove">×</button>
                  </span>
                {/each}
              </div>
            {/if}
            <input
              id="cal-people"
              type="text"
              autocomplete="off"
              class="input w-full"
              placeholder="Search people…"
              value={personQ}
              oninput={onPersonQuery}
              autofocus
            />
            {#if personResults.length > 0}
              <ul class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
                {#each personResults as p (p.id)}
                  <li>
                    <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => addPersonToForm(p)}>
                      <Icon name="users" size={14} />
                      <span class="truncate">{personName(p)}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {:else if personSearched && personQ.trim()}
              <button
                type="button"
                class="mt-1 inline-flex items-center gap-1 text-xs text-brand hover:underline disabled:opacity-60"
                onclick={createAndAddPerson}
                disabled={creatingPerson}
              >
                <Icon name="plus" size={12} />
                {creatingPerson ? 'Creating…' : `Create "${personQ.trim()}" as new person`}
              </button>
            {/if}
            <div class="cal-section-done">
              <button type="button" class="btn-ghost text-xs" onclick={closeSection}>Done</button>
            </div>
          </div>
        {/if}

        {#if openSection === 'notes'}
          <div class="cal-section">
            <label class="block text-xs text-ink-400 mb-1">Notes</label>
            <textarea class="input w-full" rows="3" bind:value={fDescription} placeholder="Anything worth remembering about this event…" autofocus></textarea>
            <div class="cal-section-done">
              <button type="button" class="btn-ghost text-xs" onclick={closeSection}>Done</button>
            </div>
          </div>
        {/if}

        <div class="flex items-center gap-2 pt-1">
          {#if formMode === 'edit'}
            <button class="btn-ghost text-tag-salesText hover:text-tag-salesText" onclick={deleteFromForm} disabled={saving}>
              Delete
            </button>
          {/if}
          <div class="flex flex-1 justify-end gap-2">
            <button class="btn-ghost" onclick={() => (formOpen = false)} disabled={saving}>Cancel</button>
            <button class="btn-primary" onclick={submitForm} disabled={saving || !fTitle.trim()}>
              {saving ? 'Saving…' : formMode === 'add' ? 'Add event' : 'Save changes'}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/snippet}
</BottomSheet>

<style>
  /* Swipe step animation. When a swipe commits, the new period's
     content plays a short slide-in from the direction of travel so
     the step reads as movement rather than an instant swap. Honours
     reduced-motion. */
  .cal-slide-left { animation: cal-in-left 240ms cubic-bezier(0.32, 0.72, 0, 1); }
  .cal-slide-right { animation: cal-in-right 240ms cubic-bezier(0.32, 0.72, 0, 1); }
  @keyframes cal-in-left {
    from { transform: translateX(24px); opacity: 0.4; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes cal-in-right {
    from { transform: translateX(-24px); opacity: 0.4; }
    to { transform: translateX(0); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cal-slide-left, .cal-slide-right { animation: none; }
  }

  /* Edit/add-event modal: compact optional-field pills. Each pill is
     either a dashed-outline "+ Add X" or a filled chip showing the
     current value + a × clear button. */
  .cal-pill-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding-top: 0.25rem;
  }
  .cal-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.7rem;
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--text-tertiary);
    background: transparent;
    border: 1px dashed var(--border-subtle);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }
  .cal-pill:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
  .cal-pill-active {
    background: var(--accent-alpha-10);
    color: var(--accent-electric);
    border-style: solid;
    border-color: var(--accent-alpha-30);
  }
  /* Pill with a value set — solid accent treatment. The "set" pill
     is a <span> wrapper (so the clear × can be a sibling <button>
     rather than nested inside the main expand <button>, which is
     invalid HTML). The inner buttons inherit the pill colour and
     have no padding/border of their own. */
  .cal-pill-set {
    display: inline-flex;
    align-items: center;
    gap: 0;
    padding: 0 0.25rem 0 0.55rem;
    background: var(--accent-alpha-10);
    color: var(--accent-electric);
    border: 1px solid var(--accent-alpha-30);
    border-radius: var(--radius-pill);
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 600;
  }
  .cal-pill-set:hover {
    background: var(--accent-alpha-30);
  }
  /* Inner "main" button or anchor inside a `cal-pill-set` wrapper.
     Borderless so the wrapper carries the pill look; the anchor
     variant inherits the same shape and underline-on-hover so it
     reads as a navigation link. */
  .cal-pill-main {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.25rem 0.3rem 0;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-decoration: none;
  }
  .cal-pill-main:hover { text-decoration: underline; text-underline-offset: 2px; }
  /* The People pill has no clear × (selection happens via per-chip
     × inside the panel), so render its main button with full pill
     padding rather than the inner-main flavour. */
  .cal-pill-main-only {
    padding: 0.3rem 0.7rem;
  }
  .cal-pill-label {
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cal-pill-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    margin-left: 0.15rem;
    background: transparent;
    border: none;
    border-radius: 9999px;
    color: currentColor;
    opacity: 0.6;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  .cal-pill-x:hover { opacity: 1; }

  /* Display-font event title. EditableField renders the value +
     pencil; the heading just wraps it so the type scale and
     letter-spacing flow through to the displayed value. */
  .cal-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    line-height: 1.1;
    min-width: 0;
  }
  .cal-title :global(.group) {
    flex: 1;
    min-width: 0;
  }

  /* Stacked-avatar preview of currently-connected people. Sits just
     below the title input. Reads like Instagram's "n people are
     attending" rather than a form field — tap to open the editor. */
  .cal-people-preview {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.5rem 0.3rem 0.3rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }
  .cal-people-preview:hover {
    background: var(--accent-alpha-10);
    border-color: var(--accent-alpha-30);
  }
  .cal-people-stack {
    display: inline-flex;
    align-items: center;
  }
  .cal-people-stack-avatar {
    display: inline-flex;
    border-radius: 9999px;
    /* White ring punches each face out of its neighbour. */
    box-shadow: 0 0 0 2px var(--bg-secondary);
    text-decoration: none;
    transition: transform var(--transition-fast);
  }
  /* Pop the hovered face slightly above its neighbours so the user
     knows it's individually clickable. */
  a.cal-people-stack-avatar:hover {
    transform: translateY(-2px);
    z-index: 1;
  }
  .cal-people-stack-avatar + .cal-people-stack-avatar { margin-left: -0.55rem; }
  .cal-people-stack-more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: -0.55rem;
    width: 28px;
    height: 28px;
    border-radius: 9999px;
    background: var(--bg-secondary);
    box-shadow: 0 0 0 2px var(--bg-secondary);
    font-family: var(--font-display);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .cal-people-preview-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: transparent;
    border: none;
    padding: 0;
    text-decoration: none;
    cursor: pointer;
  }
  a.cal-people-preview-name:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  /* Right-side pencil/plus that opens the People editor panel. */
  .cal-people-edit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-left: 0.15rem;
    border-radius: 9999px;
    background: transparent;
    border: 1px dashed var(--border-strong);
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }
  .cal-people-edit:hover {
    background: var(--accent-alpha-10);
    color: var(--accent-electric);
    border-color: var(--accent-alpha-30);
  }

  /* Expanded section panel — appears below the pill row when one
     section is open. Small tinted background so it reads as a
     subsection of the form, not a peer of the title input. */
  .cal-section {
    padding: 0.6rem 0.75rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }
  .cal-place-sug { margin-top: 0.5rem; display: flex; flex-direction: column; gap: 2px; }
  .cal-place-btn {
    display: flex; align-items: center; gap: 0.45rem; width: 100%;
    padding: 0.4rem 0.5rem; border-radius: 8px; text-align: left;
    font-size: 0.82rem; color: var(--ink-700, #333);
    cursor: pointer; transition: background-color 200ms;
  }
  .cal-place-btn:hover { background: var(--bg-secondary, #f3f3f3); }
  .cal-place-btn.sel { background: var(--bg-secondary, #f3f3f3); font-weight: 600; }
  .cal-place-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cal-place-why { flex: 0 0 auto; font-size: 0.72rem; color: var(--ink-400, #888); }
  .cal-place-note { margin-top: 0.4rem; font-size: 0.72rem; color: var(--ink-400, #888); }
  .cal-section-done {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.4rem;
  }
</style>
