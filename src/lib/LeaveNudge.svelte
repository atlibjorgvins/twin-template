<script lang="ts">
  // "You should get going" — the one implementation, used by the kiosk event
  // view, the wall display's Next up, and the Today agenda.
  //
  // Renders NOTHING unless there is something worth saying, so a host can
  // drop it in unconditionally: no place, no coordinates, no route, too far
  // out, or already started all collapse to empty.
  import { onMount } from 'svelte';
  import {
    geocode,
    travelTime,
    formatDuration,
    type Travel
  } from '$lib/geo';
  import { getPosition } from '$lib/weather';
  import type { DateEvent } from '$lib/directus';

  let {
    event,
    /** 'full' spells it out; 'compact' is a chip for a dense list. */
    variant = 'full'
  }: { event: DateEvent; variant?: 'full' | 'compact' } = $props();

  /** Routing anything further out than this tells nobody anything, and
   *  spends someone else's free API to do it. */
  const LOOKAHEAD_MS = 12 * 60 * 60_000;
  /** Getting coats on and out of the door, on top of travel. */
  const BUFFER_MIN = 10;

  let travel = $state<Travel | null>(null);
  let now = $state(new Date());

  const start = $derived(event.start ? new Date(event.start) : null);
  const place = $derived(
    [event.location_name, event.location_address, event.location]
      .find((v) => v && String(v).trim()) ?? ''
  );

  onMount(() => {
    const t = setInterval(() => (now = new Date()), 30_000);
    void (async () => {
      if (!place || !start) return;
      const ms = start.getTime() - Date.now();
      // All-day events have no meaningful "leave by": the start is midnight.
      if (event.all_day || ms <= 0 || ms > LOOKAHEAD_MS) return;
      const to = await geocode(place);
      if (!to) return;
      const from = await getPosition();
      travel = await travelTime({ lat: from.lat, lon: from.lon }, to);
    })();
    return () => clearInterval(t);
  });

  const leaveMins = $derived.by(() => {
    if (!start || !travel) return null;
    const leaveBy = start.getTime() - travel.seconds * 1000 - BUFFER_MIN * 60_000;
    return Math.round((leaveBy - now.getTime()) / 60_000);
  });

  /**
   * Only speak when it is actionable. Hours ahead it is noise; after the
   * start it is wrong. A screen that nags about everything gets ignored for
   * the one time it matters.
   */
  const nudge = $derived.by(() => {
    if (leaveMins === null || !start || now >= start) return null;
    if (leaveMins <= 0) return { urgent: true, text: 'Leave now' };
    if (leaveMins <= 30) {
      return {
        urgent: false,
        text: variant === 'compact' ? `Leave in ${leaveMins} min` : `You should get going in ${leaveMins} min`
      };
    }
    return null;
  });
</script>

{#if nudge}
  <span class="nudge" class:urgent={nudge.urgent} class:compact={variant === 'compact'}>
    {nudge.text}
    {#if variant === 'full' && travel}
      <span class="sub">{formatDuration(travel.seconds)} away</span>
    {/if}
  </span>
{/if}

<style>
  .nudge {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.7rem 1rem;
    border-radius: 12px;
    background: #fdf3e3;
    color: #8a5a12;
    font-size: clamp(15px, 1.9vw, 22px);
    font-weight: 600;
  }
  /* "Leave now" earns red; "in 20 min" does not. */
  .nudge.urgent { background: #fdecea; color: #a3271c; }
  .nudge.compact {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.78em;
    font-weight: 600;
  }
  .sub { font-size: 0.72em; font-weight: 400; opacity: 0.85; }
</style>
