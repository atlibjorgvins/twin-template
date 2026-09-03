<script lang="ts">
  // The friendly version of the event modal, for someone standing at a wall
  // tablet rather than sitting at a laptop.
  //
  // What changed from the calendar's modal, and why:
  //   - No grid behind it. The month view answers "where does this sit in my
  //     month"; from the wall the question is just what/when/who.
  //   - "Every 2 weeks · Sunday", never FREQ=WEEKLY;INTERVAL=2. The raw RRULE
  //     is developer output that leaked into a family screen.
  //   - No Edit. Editing a recurring event from a hallway tablet is a way to
  //     break your calendar by accident; this view reads.
  //   - Everything is a big target and the people are faces, because names at
  //     arm's length are harder than pictures.
  import Avatar from '$lib/Avatar.svelte';
  import Icon from '$lib/Icon.svelte';
  import { describeRrule } from '$lib/recurrence';
  import { kioskHref } from '$lib/kiosk.svelte';
  import { personName, avatarSrc, type Person, type Organization, type Project } from '$lib/directus';
  import EventMap from '$lib/EventMap.svelte';
  import { geocode, type LatLon } from '$lib/geo';
  import LeaveNudge from '$lib/LeaveNudge.svelte';
  import { onMount } from 'svelte';
  import type { KioskEventData } from './+page';

  let { data }: { data: KioskEventData } = $props();
  const e = $derived(data.event);

  // getDateRow returns the recurring ANCHOR — for "Pabbatími, every 2 weeks"
  // that is the row's original date in May, not the occurrence someone just
  // tapped. The display knows which occurrence it rendered and passes it as
  // ?on=, so use that and carry the anchor's duration across; otherwise the
  // wall would send you to an event and then show you the wrong day.
  const anchorStart = $derived(e.start ? new Date(e.start) : null);
  const anchorEnd = $derived(e.end ? new Date(e.end) : null);
  const start = $derived(data.on ? new Date(data.on) : anchorStart);
  const end = $derived.by(() => {
    if (!data.on) return anchorEnd;
    if (!anchorStart || !anchorEnd || !start) return null;
    return new Date(start.getTime() + (anchorEnd.getTime() - anchorStart.getTime()));
  });

  const dayFmt = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
  const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

  /** "Today", "Tomorrow", else the weekday — a wall screen is read in the
   *  present tense, so relative beats absolute for the near days. */
  const dayLabel = $derived.by(() => {
    if (!start) return '';
    const now = new Date();
    const days = Math.round(
      (new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() -
        new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
        86_400_000
    );
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    return dayFmt.format(start);
  });

  const timeLabel = $derived.by(() => {
    if (!start) return '';
    if (e.all_day) {
      // A single all-day event and a multi-day span read very differently.
      if (end && end.toDateString() !== start.toDateString()) {
        return `All day · until ${dayFmt.format(end)}`;
      }
      return 'All day';
    }
    return end && end.getTime() !== start.getTime()
      ? `${timeFmt.format(start)} – ${timeFmt.format(end)}`
      : timeFmt.format(start);
  });

  const repeats = $derived(
    e.is_recurring ? describeRrule(e.recurrence_rule, start ?? undefined) : ''
  );

  const place = $derived(
    [e.location_name, e.location_address, e.location].find((v) => v && String(v).trim()) ?? ''
  );

  /** Relations come back as an id or an expanded object depending on the
   *  query; the page should not have to care which. */
  const rel = (v: unknown): { id: number; name: string } | null => {
    if (!v || typeof v !== 'object') return null;
    const o = v as { id?: number; name?: string };
    return typeof o.id === 'number' ? { id: o.id, name: o.name ?? `#${o.id}` } : null;
  };
  const project = $derived(rel(e.project_id as Project | number | null));
  const org = $derived(rel(e.organization as Organization | number | null));

  // ── Where ────────────────────────────────────────────────────────────────
  // The "leave by" logic lives in LeaveNudge, shared with the display and
  // Today; this page only needs the coordinates for the map.
  let coords = $state<LatLon | null>(null);

  onMount(() => {
    void (async () => {
      if (!place) return;
      coords = await geocode(place);
    })();
  });

  const people = $derived(
    data.people
      .map((dp) => dp.Person_id)
      .filter((p): p is Person => !!p && typeof p === 'object')
  );
</script>

<svelte:head><title>{e.title || 'Event'} · twin</title></svelte:head>

<article class="kev">
  <div class="kev-head">
    {#if e.color}<span class="kev-dot" style="background:{e.color}"></span>{/if}
    <h1 class="kev-title">{e.title || 'Untitled event'}</h1>
  </div>

  <div class="kev-when">
    <span class="kev-day">{dayLabel}</span>
    <span class="kev-time">{timeLabel}</span>
  </div>

  {#if repeats}
    <div class="kev-row">
      <Icon name="clock" size={22} />
      <span>{repeats}</span>
    </div>
  {/if}

  {#if place}
    <div class="kev-row">
      <Icon name="flag" size={22} />
      <span>{place}</span>
    </div>

    <div class="kev-nudge-slot"><LeaveNudge event={e} /></div>

    {#if coords}
      <div class="kev-map">
        <EventMap at={coords} label={place} />
      </div>
    {/if}
  {/if}

  {#if e.is_virtual && e.virtual_link}
    <div class="kev-row">
      <Icon name="globe" size={22} />
      <a class="kev-link" href={e.virtual_link} target="_blank" rel="noreferrer">Join online</a>
    </div>
  {/if}

  {#if e.description}
    <p class="kev-desc">{e.description}</p>
  {/if}

  {#if people.length > 0}
    <section class="kev-section">
      <h2 class="kev-label">Who</h2>
      <div class="kev-people">
        {#each people as p (p.id)}
          <a class="kev-person" href={kioskHref(`/people/${p.id}`)}>
            <Avatar src={avatarSrc(p.person_picture, p.image_focal, 128)} name={personName(p)} size={64} />
            <span class="kev-person-name">{personName(p)}</span>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  {#if project || org}
    <section class="kev-section">
      <h2 class="kev-label">Part of</h2>
      <div class="kev-chips">
        {#if project}
          <a class="kev-chip" href={kioskHref(`/projects/${project.id}`)}>{project.name}</a>
        {/if}
        {#if org}
          <a class="kev-chip" href={kioskHref(`/orgs/${org.id}`)}>{org.name}</a>
        {/if}
      </div>
    </section>
  {/if}

  <a class="kev-full" href={`/calendar/grid?event=${e.id}`}>Open in calendar</a>
</article>

<style>
  .kev {
    max-width: 900px;
    margin: 0 auto;
    padding: clamp(16px, 3vw, 40px) 0;
  }
  .kev-head { display: flex; align-items: center; gap: 0.75rem; }
  .kev-dot { width: 16px; height: 16px; border-radius: 999px; flex: 0 0 auto; }
  .kev-title {
    font-size: clamp(30px, 5vw, 56px);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: var(--ink-900, #111);
  }
  .kev-when {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 1rem;
    margin-top: 0.6rem;
  }
  .kev-day { font-size: clamp(20px, 2.8vw, 32px); font-weight: 600; color: var(--brand, #2f7d7d); }
  .kev-time { font-size: clamp(18px, 2.4vw, 28px); color: var(--ink-600, #555); }
  .kev-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin-top: 1rem;
    font-size: clamp(16px, 2vw, 22px);
    color: var(--ink-700, #333);
  }
  .kev-map { margin-top: 1rem; }
  .kev-travel {
    margin-top: 0.6rem;
    font-size: clamp(15px, 1.8vw, 20px);
    color: var(--ink-500, #666);
  }
  .kev-nudge-slot:empty { display: none; }
  .kev-nudge-slot { margin-top: 0.9rem; }
  .kev-link { color: var(--brand, #2f7d7d); text-decoration: underline; }
  .kev-desc {
    margin-top: 1.25rem;
    font-size: clamp(16px, 1.9vw, 21px);
    line-height: 1.5;
    color: var(--ink-700, #333);
    white-space: pre-wrap;
  }
  .kev-section { margin-top: 2rem; }
  .kev-label {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ink-400, #888);
    margin-bottom: 0.75rem;
  }
  .kev-people { display: flex; flex-wrap: wrap; gap: 1.25rem; }
  .kev-person {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    width: 96px;
    text-align: center;
    text-decoration: none;
  }
  .kev-person-name {
    font-size: 14px;
    line-height: 1.2;
    color: var(--ink-700, #333);
  }
  .kev-chips { display: flex; flex-wrap: wrap; gap: 0.6rem; }
  .kev-chip {
    /* 52px like the kiosk bar buttons — same hand, same target size. */
    display: inline-flex;
    align-items: center;
    min-height: 52px;
    padding: 0 1.1rem;
    border-radius: 12px;
    border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--bg-secondary, #f6f6f6);
    font-size: 1.05rem;
    color: var(--ink-900, #111);
    text-decoration: none;
  }
  .kev-full {
    display: inline-block;
    margin-top: 2.5rem;
    font-size: 15px;
    color: var(--ink-400, #888);
  }
</style>
