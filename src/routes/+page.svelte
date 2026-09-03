<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import LeaveNudge from '$lib/LeaveNudge.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import {
    ACTIVITY_KIND_ICON,
    ACTIVITY_KINDS,
    assetUrl,
    type Activity,
    type CalendarEvent,
    type DateEvent,
    type Note,
    type Organization,
    type Project,
  } from '$lib/directus';
  import type { IconName } from '$lib/icon-types';
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { scope, matchesScope } from '$lib/scope';
  import { featureOn } from '$lib/instance';
  import HighlightsRow from '$lib/HighlightsRow.svelte';
  import FocusCard from '$lib/FocusCard.svelte';
  import WeatherWidget from '$lib/WeatherWidget.svelte';
  import HabitsCard from '$lib/HabitsCard.svelte';
  import { profile } from '$lib/profile.svelte';
  import FoodTodayCard from '$lib/food/FoodTodayCard.svelte';
  import {
    activeHighlights,
    quickActions,
    openSheet
  } from '$lib/quickActionsStore.svelte';

  let { data }: {
    data: {
      asOf: string;
      birthdaysToday: CalendarEvent[];
      birthdaysWeek: CalendarEvent[];
      eventsToday: DateEvent[];
      upcoming: DateEvent[];
      followUps: Note[];
      recent: Activity[];
    };
  } = $props();

  // Highlight shortcuts (mobile + desktop). The shared
  // `quickActions.svelte.ts` module owns the sheet state and the
  // catalogue so the dashboard row and the mobile bottom-nav FAB
  // share a single source of truth. `QuickActions.svelte` mounted in
  // the layout renders every sheet — this page just triggers them.
  const activeSheet = $derived(quickActions.sheet);

  // Habits is a circle in the same row, but it toggles the inline card
  // below rather than opening a sheet — so it stays out of the shared
  // HIGHLIGHTS catalogue (which also feeds the mobile FAB menu, where an
  // inline-card toggle would have nothing to show). Open state persists so
  // logging a habit and coming back to Today doesn't collapse it.
  const HABITS_KEY = 'twin:today:habitsOpen';
  let habitsOpen = $state(false);
  onMount(() => {
    try {
      habitsOpen = localStorage.getItem(HABITS_KEY) === '1';
    } catch { /* private mode — default closed */ }
  });
  function toggleHabits() {
    habitsOpen = !habitsOpen;
    try {
      localStorage.setItem(HABITS_KEY, habitsOpen ? '1' : '0');
    } catch { /* ignore */ }
  }
  const rowItems = [
    ...(featureOn('habits') ? [{ key: 'habits', label: 'Habits', icon: 'check' as IconName }] : []),
    ...activeHighlights(featureOn)
  ];
  function onRowActivate(key: string) {
    if (key === 'habits') toggleHabits();
    else openSheet(key);
  }
  // "Recent activity" used to show optimistic rows from the local log
  // path; that lived on the dashboard. With the sheets lifted into the
  // layout, the dashboard reloads via `invalidateAll()` after a log,
  // and `data.recent` is the only source.
  // Everything on the dashboard honours the global Work/Private toggle.
  // Filtering the already-loaded lists reactively (rather than refetching)
  // means flipping the toggle updates the dashboard instantly. Un-tagged
  // rows count as work — same rule as the rest of the app.
  const eventsToday = $derived(data.eventsToday.filter((e) => matchesScope($scope, e.scope)));
  const upcoming = $derived((data.upcoming ?? []).filter((e) => matchesScope($scope, e.scope)));

  /**
   * The rest of the week, grouped by day — the wall display's "Later" panel,
   * brought to the page you actually work from.
   *
   * Capped at five days and four events each: past that it stops being a
   * glance and becomes a second calendar, and the calendar is one tap away.
   * The count of what was dropped is shown rather than silently truncated.
   */
  const laterDays = $derived.by(() => {
    const groups = new Map<string, { key: string; label: string; items: DateEvent[] }>();
    for (const e of upcoming) {
      const d = new Date(e.start ?? 0);
      if (Number.isNaN(d.getTime())) continue;
      const key = d.toDateString();
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }).format(d),
          items: []
        });
      }
      groups.get(key)!.items.push(e);
    }
    return [...groups.values()].slice(0, 5).map((g) => ({
      ...g,
      shown: g.items.slice(0, 4),
      more: Math.max(0, g.items.length - 4)
    }));
  });
  const followUps = $derived(data.followUps.filter((n) => matchesScope($scope, n.scope)));
  const birthdaysToday = $derived(data.birthdaysToday.filter((b) => matchesScope($scope, b.scope)));
  const birthdaysWeek = $derived(data.birthdaysWeek.filter((b) => matchesScope($scope, b.scope)));
  const visibleRecent = $derived(
    data.recent.filter((a) => matchesScope($scope, a.scope)).slice(0, 5)
  );

  // ── Formatting helpers ──────────────────────────────────────────────────
  // Today vs Tomorrow vs explicit date — the kind of thing a daily dashboard
  // earns by humanizing the moment. For follow-ups we want the user to feel
  // urgency on overdue items, so we render "overdue" in red below.
  const today = $derived(new Date(data.asOf));

  function fmtDay(d?: string | null): string {
    if (!d) return '';
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return d ?? '';
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = Math.round((target.getTime() - todayStart.getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 1 && diff < 7) return new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(date);
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date);
  }

  function isOverdue(d?: string | null): boolean {
    if (!d) return false;
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return false;
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return target < todayStart;
  }

  function fmtTime(d?: string | null): string {
    if (!d) return '';
    try {
      return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(d));
    } catch {
      return '';
    }
  }

  function fmtRelative(d?: string | null): string {
    if (!d) return '';
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return '';
    const mins = Math.round((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date);
  }

  // Activity rendering helpers — match the per-entity ActivityCard idioms so
  // the home view feels consistent with the detail pages.
  function activityKindLabel(k?: string | null): string {
    return ACTIVITY_KINDS.find((x) => x.value === k)?.label ?? k ?? 'Activity';
  }
  function activityKindIcon(k?: string | null): IconName {
    return (ACTIVITY_KIND_ICON[k ?? 'other'] ?? 'tag') as IconName;
  }
  function orgOf(a: Activity): Organization | null {
    return a.organization_id && typeof a.organization_id === 'object' ? (a.organization_id as Organization) : null;
  }
  function projOf(a: Activity): Project | null {
    return a.project_id && typeof a.project_id === 'object' ? (a.project_id as Project) : null;
  }

  // Derived counts for the section headlines — the eye locks onto a single
  // big number much faster than a paragraph. Empty sections collapse with a
  // friendly empty state instead of being hidden, which I find motivating.
  const totalToday = $derived(
    birthdaysToday.length + eventsToday.length + followUps.length
  );

  // Hero greeting. Time-of-day is the kind of detail that costs nothing and
  // makes the app feel less robotic. The name comes from the device profile
  // (set in /welcome or Settings → Appearance); first name only — a greeting
  // that recites your full legal name reads like a summons.
  const firstName = $derived(profile.name.split(/\s+/)[0] ?? '');
  const greeting = $derived.by(() => {
    const h = new Date().getHours();
    if (h < 5) return 'Late night';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 22) return 'Good evening';
    return 'Late night';
  });
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
</script>

<svelte:head>
  <title>Today · Hub</title>
</svelte:head>

<section class="space-y-6">
  <!-- Hero: Helga display typography — eyebrow date, massive greeting,
       quiet counter underneath. Anchors the page typographically. -->
  <header class="relative pt-2 pb-4 sm:pt-4 sm:pb-6">
    <!-- Weather chip floats top-right of the greeting; its dropdown opens
         over the page content. -->
    <div class="absolute right-0 top-2 sm:top-4">
      <WeatherWidget />
    </div>
    <div class="hero-eyebrow">{dateLabel}</div>
    <h1 class="hero-display mt-2">
      {#if firstName}
        {greeting},<br /><span style="color: var(--accent-electric);">{firstName}.</span>
      {:else}
        {greeting}<span style="color: var(--accent-electric);">.</span>
      {/if}
    </h1>
    {#if totalToday > 0}
      <p class="mt-4 text-sm text-ink-500">
        <span class="font-display font-medium tabular-nums" style="color: var(--text-primary);">{totalToday}</span>
        {totalToday === 1 ? 'thing' : 'things'} on your plate today.
      </p>
    {:else}
      <p class="mt-4 text-sm text-ink-500">Nothing pressing today. Capture something to get going.</p>
    {/if}
  </header>

  <!-- Highlight circles. Always visible. Reads catalogue + active
       sheet id from the shared `quickActions.svelte.ts` store — the
       layout's `QuickActions` component renders all the sheets, and
       the mobile bottom-nav FAB opens the same menu. -->
  <!-- Habits leads the row: it toggles the card below instead of opening a
       sheet, so `active` reflects the local open state for that key. -->
  <HighlightsRow
    items={rowItems}
    active={habitsOpen ? 'habits' : activeSheet}
    onActivate={onRowActivate}
  />

  <!-- Actively working on — active focus task + timer, or the next in queue. -->
  {#if featureOn('focus')}
    <FocusCard />
  {/if}

  <!-- Office lunch, if any is ordered. Renders nothing when there's nothing
       today and nothing coming, so it costs no space on ordinary days. -->
  {#if featureOn('food')}
    <FoodTodayCard />
  {/if}

  <!-- Daily habits — collapsed by default; the Habits circle expands it. -->
  {#if habitsOpen && featureOn('habits')}
    <div transition:slide={{ duration: 200 }}>
      <HabitsCard />
    </div>
  {/if}

  <div class="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
    <!-- LEFT: agenda — birthdays, events, follow-ups -->
    <div class="min-w-0 space-y-5">
      <!-- Birthdays today (collapses entirely when empty so non-birthday days
           don't waste real estate). -->
      {#if birthdaysToday.length > 0}
        <div class="card">
          <div class="card-header">
            <span class="card-title"><Icon name="sparkles" size={16} /> Birthdays today
              <span class="text-ink-300 font-normal">{birthdaysToday.length}</span>
            </span>
          </div>
          <ul class="divide-y divide-surface-divider">
            {#each birthdaysToday as b (b.key)}
              {@const meta = (b.meta as Record<string, unknown> | undefined) ?? {}}
              {@const personId = meta.personId as number | undefined}
              {@const age = meta.age as number | undefined}
              {@const displayName = (meta.personName as string | undefined) ?? b.title.replace(/^🎂\s*/, '')}
              {@const picture = meta.personPicture as string | null | undefined}
              <li>
                <a
                  href={b.href ?? (personId ? `/people/${personId}` : '/people')}
                  class="flex min-h-[60px] items-center gap-3 px-4 py-3 hover:bg-surface-hover"
                >
                  <!-- Person avatar + small 🎂 corner badge so the row reads
                       as "this person, who happens to have a birthday today". -->
                  <span class="relative shrink-0">
                    <Avatar
                      name={displayName}
                      src={picture ? (assetUrl(picture, { width: 80, height: 80, fit: 'cover' }) ?? '') : ''}
                      size={36}
                      position={(meta.imageFocal as string | null | undefined) ?? ''}
                    />
                    <span
                      class="pointer-events-none absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center text-[10px]"
                      style="background: var(--bg-secondary); border-radius: 9999px; box-shadow: 0 0 0 2px var(--bg-secondary);"
                      aria-hidden="true"
                    >🎂</span>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-medium text-ink-900">{displayName}</div>
                    {#if age && age > 0}
                      <div class="text-xs text-ink-400">turns {age} today</div>
                    {/if}
                  </div>
                  <Icon name="chevron-right" size={14} class="text-ink-300" />
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Today's events -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="calendar" size={16} /> Today
            <span class="text-ink-300 font-normal">{eventsToday.length}</span>
          </span>
          {#if featureOn('calendar')}
            <a class="text-xs font-medium text-brand hover:underline" href="/calendar">Calendar</a>
          {/if}
        </div>
        {#if eventsToday.length === 0}
          <div class="px-4 pb-4 text-sm text-ink-400">No events scheduled. Enjoy the open day.</div>
        {:else}
          <ul class="divide-y divide-surface-divider">
            {#each eventsToday as e (e.id)}
              <!-- Whole row is a link to the calendar with the event
                   pre-opened (?event=<id>). The Calendar component
                   reads the param on mount, finds the matching
                   DateEvent in its current range, and opens the
                   detail dialog. -->
              <li>
                <a
                  href={`/calendar/grid?event=${e.id}`}
                  class="flex items-start gap-3 px-4 py-3 hover:bg-surface-hover"
                >
                  <span
                    class="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                    style:background-color={e.color ?? '#2C8C99'}
                    aria-hidden="true"
                  ></span>
                  <div class="min-w-0 flex-1">
                    <div class="font-medium text-ink-900">{e.title}</div>
                    <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
                      {#if e.all_day}
                        <span>All day</span>
                      {:else}
                        <span class="tabular-nums">{fmtTime(e.start)}{e.end ? ` – ${fmtTime(e.end)}` : ''}</span>
                      {/if}
                      {#if e.location_name}
                        <span class="text-ink-300">·</span>
                        <span>📍 {e.location_name}</span>
                      {/if}
                    </div>
                  </div>
                  <LeaveNudge event={e} variant="compact" />
                </a>
              </li>
            {/each}
          </ul>
        {/if}

        <!-- The rest of the week, in the same card as Today rather than a
             separate one: "what is coming" is one question, and splitting it
             across two headed cards made the second easy to miss. Denser than
             the rows above on purpose — today is the thing you act on, the
             week is the thing you plan around. -->
        {#if laterDays.length > 0}
          <div class="border-t border-surface-divider px-4 py-3">
            <div class="mb-2 font-display text-[10px] uppercase tracking-wider text-ink-400">
              Later this week
            </div>
            <div class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {#each laterDays as g (g.key)}
                <div class="min-w-0">
                  <div class="text-[11px] font-medium uppercase tracking-wide text-ink-400">{g.label}</div>
                  <ul class="mt-1 space-y-0.5">
                    {#each g.shown as e (e.id + String(e.start))}
                      <li>
                        <a
                          href={`/calendar/grid?event=${e.id}`}
                          class="flex items-baseline gap-2 rounded px-1 py-0.5 -mx-1 hover:bg-surface-hover"
                        >
                          <span class="shrink-0 tabular-nums text-[11px] text-ink-400">
                            {e.all_day ? '—' : fmtTime(e.start)}
                          </span>
                          <span class="min-w-0 flex-1 truncate text-[13px] text-ink-700">{e.title || 'Untitled'}</span>
                        </a>
                      </li>
                    {/each}
                    {#if g.more > 0}
                      <li class="px-1 text-[11px] text-ink-400">+{g.more} more</li>
                    {/if}
                  </ul>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- Follow-ups due — note rows where follow_up_date <= today. Overdue
           items get a red dot + label so the eye snaps to them first. -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="bell" size={16} /> Follow-ups
            <span class="text-ink-300 font-normal">{followUps.length}</span>
          </span>
          {#if featureOn('notes')}
            <a class="text-xs font-medium text-brand hover:underline" href="/notes">Notes</a>
          {/if}
        </div>
        {#if followUps.length === 0}
          <div class="px-4 pb-4 text-sm text-ink-400">Nothing due. Set a follow-up date on a note to see it here.</div>
        {:else}
          <ul class="divide-y divide-surface-divider">
            {#each followUps as n (n.id)}
              {@const overdue = isOverdue(n.follow_up_date)}
              <li>
                <a
                  href={`/notes/${n.id}`}
                  class="flex min-h-[60px] items-start gap-3 px-4 py-3 hover:bg-surface-hover"
                >
                  <span
                    class="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full {overdue ? 'bg-tag-salesText' : 'bg-brand'}"
                    aria-hidden="true"
                  ></span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-medium text-ink-900">{n.title || '(untitled note)'}</div>
                    <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span class={overdue ? 'text-tag-salesText font-medium' : 'text-ink-500'}>
                        {overdue ? 'Overdue · ' : ''}{fmtDay(n.follow_up_date)}
                      </span>
                      {#if n.note_type}
                        <span class="text-ink-300">·</span>
                        <span class="text-ink-500">{n.note_type}</span>
                      {/if}
                      {#if n.is_pinned}
                        <span class="text-ink-300">·</span>
                        <TagPill tone="sales">pinned</TagPill>
                      {/if}
                    </div>
                  </div>
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    <!-- RIGHT: recent activity + this week + jump links -->
    <div class="min-w-0 space-y-5">
      <!-- Recent activity feed -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="sparkles" size={16} /> Recent activity</span>
          {#if featureOn('interactions')}
            <a class="text-xs font-medium text-brand hover:underline" href="/interactions">See all →</a>
          {/if}
        </div>
        {#if visibleRecent.length === 0}
          <div class="px-4 pb-4 text-sm text-ink-400">No activities logged yet. Log meetings, calls, and major moments on a person/org/project page.</div>
        {:else}
          <ul class="space-y-1 px-2 pb-3">
            {#each visibleRecent as a (a.id)}
              {@const o = orgOf(a)}
              {@const p = projOf(a)}
              {@const major = a.significance === 'major'}
              <li>
                <div class="rounded-[10px] px-3 py-1.5 hover:bg-surface-hover">
                  <!-- One line per activity, not three. This was a 6px avatar
                       circle, a title line and a metadata line of org + project
                       links — a whole screen for five rows, above a week of
                       calendar you could not see. The org/project are a title
                       attribute now: they are context for a row you recognise,
                       not the reason you are reading it. /interactions is where
                       you go when they matter. -->
                  <div class="flex items-baseline gap-2">
                    <span class="shrink-0 text-ink-400" title={activityKindLabel(a.kind)}>
                      <Icon name={activityKindIcon(a.kind)} size={12} />
                    </span>
                    <span class="min-w-0 flex-1 truncate text-[13px] text-ink-900" title={[o?.name, p?.name].filter(Boolean).join(' · ')}>
                      {a.title}
                    </span>
                    {#if major}<TagPill tone="sales">major</TagPill>{/if}
                    <span class="shrink-0 text-[11px] tabular-nums text-ink-400">{fmtRelative(a.occurred_at)}</span>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Coming this week (birthdays only — events live in the calendar) -->
      {#if birthdaysWeek.length > 0}
        <div class="card">
          <div class="card-header">
            <span class="card-title"><Icon name="users" size={16} /> Coming this week
              <span class="text-ink-300 font-normal">{birthdaysWeek.length}</span>
            </span>
          </div>
          <ul class="divide-y divide-surface-divider">
            {#each birthdaysWeek as b (b.key)}
              {@const meta = (b.meta as Record<string, unknown> | undefined) ?? {}}
              {@const personId = meta.personId as number | undefined}
              {@const displayName = (meta.personName as string | undefined) ?? b.title.replace(/^🎂\s*/, '')}
              {@const picture = meta.personPicture as string | null | undefined}
              <li>
                <a
                  href={b.href ?? (personId ? `/people/${personId}` : '/people')}
                  class="flex min-h-[52px] items-center gap-3 px-4 py-2.5 hover:bg-surface-hover"
                >
                  <span class="relative shrink-0">
                    <Avatar
                      name={displayName}
                      src={picture ? (assetUrl(picture, { width: 64, height: 64, fit: 'cover' }) ?? '') : ''}
                      size={28}
                      position={(meta.imageFocal as string | null | undefined) ?? ''}
                    />
                    <span
                      class="pointer-events-none absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center text-[9px]"
                      style="background: var(--bg-secondary); border-radius: 9999px; box-shadow: 0 0 0 2px var(--bg-secondary);"
                      aria-hidden="true"
                    >🎂</span>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium text-ink-900">{displayName}</div>
                  </div>
                  <span class="shrink-0 text-xs text-ink-400">{fmtDay(b.start.toISOString())}</span>
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Quick links to the rest of the app — the bottom nav already covers
           them on mobile, but the visual shortcuts here are useful on desktop
           where the nav is a thin icon rail without labels. -->
      <div class="card p-4">
        <div class="card-title mb-3"><Icon name="bolt" size={16} /> Jump to</div>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <a href="/people" class="flex items-center gap-2 rounded-[10px] border border-surface-border px-3 py-2 hover:bg-surface-hover">
            <Icon name="users" size={14} /> People
          </a>
          <a href="/orgs" class="flex items-center gap-2 rounded-[10px] border border-surface-border px-3 py-2 hover:bg-surface-hover">
            <Icon name="building" size={14} /> Orgs
          </a>
          {#if featureOn('notes')}
            <a href="/notes" class="flex items-center gap-2 rounded-[10px] border border-surface-border px-3 py-2 hover:bg-surface-hover">
              <Icon name="notebook" size={14} /> Notes
            </a>
          {/if}
          {#if featureOn('projects')}
            <a href="/projects" class="flex items-center gap-2 rounded-[10px] border border-surface-border px-3 py-2 hover:bg-surface-hover">
              <Icon name="sparkles" size={14} /> Projects
            </a>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Quick-action sheets live in `QuickActions.svelte` (mounted by
       `+layout.svelte`) so they overlay every route, not just `/`. -->
</section>
