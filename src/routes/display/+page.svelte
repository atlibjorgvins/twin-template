<script lang="ts">
  // Always-on tablet display — see +page.ts for why this is not the Today page.
  //
  // Three things a wall screen needs that a phone page does not:
  //   1. It refreshes itself. Nobody pulls to refresh a tablet on a shelf.
  //   2. It keeps the screen awake, so the thing is actually always on.
  //   3. It is legible from across a room, which means far bigger type and
  //      far less on screen than a hand-held view.
  import { onMount, tick } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import WeatherGlyph from '$lib/WeatherGlyph.svelte';
  import PhotoFrame from '$lib/PhotoFrame.svelte';
  import LeaveNudge from '$lib/LeaveNudge.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import { page } from '$app/stores';
  import {
    listImmichAlbums,
    getImmichAlbum,
    getAssetFull,
    type ImmichAsset,
    type ImmichAssetFull
  } from '$lib/immich';
  import { loadWeather, labelOf, dayName, type Weather } from '$lib/weather';
  import type { DateEvent } from '$lib/directus';
  import { kioskHref } from '$lib/kiosk.svelte';
  import { searchPeople, personName, avatarSrc, type Person } from '$lib/directus';
  import type { DisplayData } from './+page';

  let { data }: { data: DisplayData } = $props();

  // ── Clock ────────────────────────────────────────────────────────────────
  // Ticks every 10s rather than every second: the display shows minutes, and
  // a per-second timer on a screen that runs for weeks is wasted wakeups.
  let now = $state(new Date());

  // ── Weather ──────────────────────────────────────────────────────────────
  let weather = $state<Weather | null>(null);
  let weatherFailed = $state(false);

  async function refreshWeather() {
    try {
      weather = (await loadWeather()).weather;
      weatherFailed = false;
    } catch {
      // Keep the last good reading on screen rather than blanking the panel;
      // a stale temperature beats an empty hole in the wall.
      weatherFailed = true;
    }
  }

  // ── Photos ───────────────────────────────────────────────────────────────
  // Bound to an Immich album BY NAME. The source changes about never, so a
  // picker in the UI was solving a problem nobody has — and a name means the
  // tablet needs no configuration at all: make an album called Framer, drop
  // photos in from any device, and the wall picks them up. `?album=<id>`
  // still overrides for a one-off.
  const FRAME_ALBUM = 'Framer';
  const ALBUM_KEY = 'twin.display.album';

  let albumName = $state('');
  let photos = $state<ImmichAsset[]>([]);
  let photosFailed = $state(false);

  /** 'dashboard' | 'photos' — tap the frame or swipe right. */
  let view = $state<'dashboard' | 'photos'>('dashboard');

  /** The photo currently on screen, reported by whichever frame is showing. */
  let currentAsset = $state<ImmichAsset | null>(null);
  let meta = $state<ImmichAssetFull | null>(null);
  let metaOpen = $state(false);

  let thumbEl = $state<HTMLButtonElement | null>(null);
  let fullEl = $state<HTMLDivElement | null>(null);
  /** Where the fullscreen layer should grow FROM, so opening reads as the
   *  thumbnail expanding rather than a new screen appearing. */
  let originStyle = $state('');
  let opening = $state(false);

  async function openPhotos() {
    const r = thumbEl?.getBoundingClientRect();
    if (r) {
      // Park the full-viewport layer on the thumbnail's rect, then release
      // it — so the photo grows out of the corner instead of appearing.
      // Transform and opacity only: animating width/height would relayout
      // every frame and stutter on a tablet.
      const sx = r.width / window.innerWidth;
      const sy = r.height / window.innerHeight;
      originStyle = `transform: translate(${r.left}px, ${r.top}px) scale(${sx}, ${sy}); opacity: 0.4;`;
    }
    opening = true;
    view = 'photos';

    // tick() waits for the element to exist, then reading offsetWidth forces
    // the browser to commit that start position before we clear it — which
    // is what makes the transition run.
    //
    // This used to be a double requestAnimationFrame and it did NOT work:
    // measured 700ms after opening, the layer was still 143x108 with the
    // origin transform applied, because rAF gets throttled and the reset
    // never fired. A stuck thumbnail-sized "fullscreen" is a bad failure on
    // a wall tablet, so the release is deterministic now.
    await tick();
    void fullEl?.offsetWidth;
    originStyle = '';
    opening = false;
  }

  function closePhotos() {
    metaOpen = false;
    view = 'dashboard';
  }

  /** Tap the photo to reveal what it is; tap again to hide it. */
  async function toggleMeta() {
    metaOpen = !metaOpen;
    if (metaOpen && currentAsset && meta?.id !== currentAsset.id) {
      try {
        meta = await getAssetFull(currentAsset.id);
        const names = (meta.people ?? []).map((p) => p.name).filter(Boolean);
        if (names.length) void resolveFaces(names);
      } catch {
        meta = null;
      }
    }
  }

  /**
   * Where an event goes when tapped. NOT the calendar grid: that answers
   * "where does this sit in my month" behind a compact modal, which is the
   * wrong question and the wrong target size from across a room. The kiosk
   * route shows the one event, big.
   */
  const eventHref = (e: DateEvent) =>
    kioskHref(`/kiosk/event/${e.id}?on=${encodeURIComponent(String(e.start ?? ''))}`);

  /**
   * Immich knows a face's NAME; twin knows people by id. Resolve the two when
   * the metadata opens so a name can be tapped through to the person's card,
   * and fall back to plain text when there is no confident single match —
   * sending someone to the wrong person's page is worse than not linking.
   */
  let faceLinks = $state<Record<string, number>>({});

  async function resolveFaces(names: string[]) {
    for (const name of names) {
      if (name in faceLinks) continue;
      try {
        const hits = (await searchPeople(name, 3)) as Person[];
        const exact = hits.filter(
          (p) => personName(p).trim().toLowerCase() === name.trim().toLowerCase()
        );
        if (exact.length === 1) faceLinks = { ...faceLinks, [name]: exact[0].id };
      } catch {
        /* leave it as plain text */
      }
    }
  }

  const metaPlace = $derived.by(() => {
    const e = meta?.exifInfo;
    if (!e) return '';
    return [e.city, e.state, e.country].filter(Boolean).join(', ');
  });

  const metaWhen = $derived.by(() => {
    const iso = meta?.localDateTime || meta?.fileCreatedAt || currentAsset?.fileCreatedAt;
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      }).format(new Date(iso));
    } catch {
      return '';
    }
  });

  async function loadPhotos(id: string) {
    const album = await getImmichAlbum(id);
    albumName = album.albumName;
    // Videos have no still to show and would just blank the frame.
    photos = (album.assets ?? []).filter((a) => a.type === 'IMAGE');
  }

  /**
   * Find the album once, then remember its id so later loads skip listing
   * every album. The id is only a cache — the name stays the source of
   * truth, so renaming or rebuilding the album in Immich still resolves.
   */
  async function resolveAlbum(override: string | null) {
    try {
      if (override) {
        await loadPhotos(override);
        try { localStorage.setItem(ALBUM_KEY, override); } catch { /* ignore */ }
        return;
      }
      let cached: string | null = null;
      try { cached = localStorage.getItem(ALBUM_KEY); } catch { /* ignore */ }
      if (cached) {
        try {
          await loadPhotos(cached);
          return;
        } catch {
          // Album deleted or id stale — fall through to a fresh lookup
          // rather than leaving the frame permanently empty.
        }
      }
      const all = await listImmichAlbums();
      const match = all.find(
        (a) => a.albumName.trim().toLowerCase() === FRAME_ALBUM.toLowerCase()
      );
      if (!match) {
        photosFailed = true;
        return;
      }
      try { localStorage.setItem(ALBUM_KEY, match.id); } catch { /* ignore */ }
      await loadPhotos(match.id);
      photosFailed = false;
    } catch {
      photosFailed = true;
      photos = [];
    }
  }

  let lastSync = $state<Date | null>(null);
  let syncFailed = $state(false);

  async function refreshData() {
    try {
      await invalidateAll();
      lastSync = new Date();
      syncFailed = false;
    } catch {
      syncFailed = true;
    }
  }

  onMount(() => {
    void refreshWeather();
    lastSync = new Date();

    // ?album= is a one-off override; otherwise the Framer album by name.
    void resolveAlbum($page.url.searchParams.get('album'));

    // Swipe right for photos, left to come back. Keyboard too — it is how
    // this gets tested, and a tablet with a keyboard case is a real thing.
    let x0 = 0;
    let y0 = 0;
    const onStart = (e: TouchEvent) => {
      x0 = e.changedTouches[0].clientX;
      y0 = e.changedTouches[0].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      // Horizontal intent only: a mostly-vertical drag is a scroll, not a
      // swipe, and treating it as one makes the screen feel twitchy.
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      view = dx > 0 ? 'photos' : 'dashboard';
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') view = 'photos';
      else if (e.key === 'ArrowLeft' || e.key === 'Escape') view = 'dashboard';
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('keydown', onKey);

    const clock = setInterval(() => (now = new Date()), 10_000);
    const dataTimer = setInterval(refreshData, 5 * 60_000);
    const weatherTimer = setInterval(refreshWeather, 15 * 60_000);

    // Keep the panel lit. The lock is dropped by the browser whenever the tab
    // is hidden (screen off, app switched), so it has to be re-acquired on
    // visibilitychange or the display goes dark after the first sleep.
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await (navigator as Navigator & {
          wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> };
        }).wakeLock?.request('screen') ?? null;
      } catch {
        // Unsupported browser, or refused because the page is not visible.
        // Not fatal — the tablet's own display settings still apply.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(clock);
      clearInterval(dataTimer);
      clearInterval(weatherTimer);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('keydown', onKey);
      void lock?.release().catch(() => {});
    };
  });

  // ── Formatting ───────────────────────────────────────────────────────────
  const hhmm = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(d);

  const timeOf = (e: DateEvent) =>
    e.all_day ? 'All day' : hhmm(new Date(e.start ?? 0));

  const clock = $derived(hhmm(now));
  const dateLine = $derived(
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }).format(now)
  );

  /** Events still ahead today — a wall display should not dwell on what has
   *  already happened. All-day rows stay all day. */
  const remainingToday = $derived(
    data.eventsToday.filter((e) => e.all_day || new Date(e.end ?? e.start ?? 0) >= now)
  );

  /** The single next thing, today or later — the headline of the whole screen. */
  const nextUp = $derived(
    data.upcoming.find((e) => new Date(e.end ?? e.start ?? 0) >= now) ?? null
  );

  /** How far away `nextUp` is, in words. */
  const nextUpWhen = $derived.by(() => {
    if (!nextUp) return '';
    const start = new Date(nextUp.start ?? 0);
    const mins = Math.round((start.getTime() - now.getTime()) / 60_000);
    if (nextUp.all_day) {
      const days = Math.round((start.getTime() - now.getTime()) / 86_400_000);
      return days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
    }
    if (mins <= 0) return 'Now';
    if (mins < 60) return `In ${mins} min`;
    const hrs = Math.floor(mins / 60);
    const sameDay = start.toDateString() === now.toDateString();
    if (sameDay) return `In ${hrs} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
    const days = Math.round((start.getTime() - now.getTime()) / 86_400_000);
    return days <= 1 ? `Tomorrow ${hhmm(start)}` : `${dayLabel(start)} ${hhmm(start)}`;
  });

  const dayLabel = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(d);

  /** Everything after today, grouped by day, capped so the panel never
   *  overflows into a scroll nobody will perform. */
  const laterDays = $derived.by(() => {
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const groups = new Map<string, { label: string; items: DateEvent[] }>();
    for (const e of data.upcoming) {
      const d = new Date(e.start ?? 0);
      if (d < startOfTomorrow) continue;
      const key = d.toDateString();
      if (!groups.has(key)) groups.set(key, { label: dayLabel(d), items: [] });
      groups.get(key)!.items.push(e);
    }
    return [...groups.values()].slice(0, 4).map((g) => ({ ...g, items: g.items.slice(0, 3) }));
  });
</script>

<svelte:head>
  <title>Display · twin</title>
  <!-- A wall tablet should never dim the UI chrome behind a notch. -->
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="display-root">
  <!-- LEFT: time, date, weather -->
  <section class="flex min-w-0 flex-col justify-between">
    <div>
      <div class="clock tabular-nums">{clock}</div>
      <div class="dateline">{dateLine}</div>
    </div>

    {#if weather}
      <div class="mt-6">
        <div class="flex items-baseline gap-4">
          <span class="temp tabular-nums">{weather.temp}°</span>
          <span class="cond">{labelOf(weather.code)}</span>
        </div>
        <div class="submeta">
          Feels {weather.feels}° · {weather.wind} m/s
          {#if weather.precip > 0}· {weather.precip} mm{/if}
          {#if weatherFailed}· <span class="text-amber-600">stale</span>{/if}
        </div>

        <div class="mt-5 flex gap-5">
          {#each weather.days.slice(0, 5) as d, i (d.date)}
            <div class="text-center">
              <div class="text-[13px] uppercase tracking-wide text-ink-400">{dayName(d.date, i)}</div>
              <div class="my-1 flex justify-center text-ink-600">
                <WeatherGlyph code={d.code} size={26} />
              </div>
              <div class="text-[15px] tabular-nums text-ink-900">{d.max}°</div>
              <div class="text-[13px] tabular-nums text-ink-400">{d.min}°</div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <div class="submeta mt-6">
      {#if syncFailed}
        <span class="text-amber-600">Offline — showing last known</span>
      {:else if lastSync}
        Updated {hhmm(lastSync)}
      {/if}
    </div>
  </section>

  <!-- RIGHT: next up, today, later -->
  <section class="flex min-w-0 flex-col gap-6">
    <div>
      <h2 class="section-label">Next up</h2>
      {#if nextUp}
        <a class="next-title" href={eventHref(nextUp)}>{nextUp.title || 'Untitled'}</a>
        <div class="next-nudge"><LeaveNudge event={nextUp} /></div>
        <div class="next-when">
          {nextUpWhen}
          {#if !nextUp.all_day}· {timeOf(nextUp)}{/if}
          {#if nextUp.location_name || nextUp.location}
            · {nextUp.location_name || nextUp.location}
          {/if}
        </div>
      {:else}
        <div class="next-title text-ink-400">Nothing scheduled</div>
      {/if}
    </div>

    {#if data.birthdaysToday.length > 0}
      <div class="birthday-band">
        {#each data.birthdaysToday as b (b.key)}
          {@const meta = (b.meta as Record<string, unknown> | undefined) ?? {}}
          <a class="flex items-center gap-3 hover:underline" href={kioskHref(String(b.href ?? `/people/${(b.meta as Record<string, unknown>)?.personId ?? ''}`))}>
            <Avatar
              src={avatarSrc(meta.personPicture as string | null, meta.imageFocal as string | null, 96)}
              name={String(b.title ?? '').replace('🎂 ', '')}
              size={40}
            />
            <div>
              <div class="text-[19px] font-medium text-ink-900">
                {String(b.title ?? '').replace('🎂 ', '')}
              </div>
              <div class="text-[14px] text-ink-500">
                {typeof meta.age === 'number' ? `turns ${meta.age} today` : 'birthday today'}
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}

    <div class="min-h-0 flex-1">
      <h2 class="section-label">Today</h2>
      {#if remainingToday.length === 0}
        <p class="text-[18px] text-ink-400">Nothing left on the calendar.</p>
      {:else}
        <ul class="space-y-2.5">
          {#each remainingToday.slice(0, 5) as e (e.id + String(e.start))}
            <li>
              <a class="agenda-row" href={eventHref(e)}>
                <span class="w-[86px] shrink-0 text-[19px] tabular-nums text-ink-500">{timeOf(e)}</span>
                <span class="min-w-0 flex-1 truncate text-[21px] text-ink-900">{e.title || 'Untitled'}</span>
                <LeaveNudge event={e} variant="compact" />
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if laterDays.length > 0}
      <div>
        <h2 class="section-label">Later</h2>
        <div class="grid grid-cols-2 gap-x-8 gap-y-3">
          {#each laterDays as g (g.label)}
            <div class="min-w-0">
              <div class="text-[14px] uppercase tracking-wide text-ink-400">{g.label}</div>
              {#each g.items as e (e.id + String(e.start))}
                <a class="block truncate text-[17px] text-ink-700 hover:underline" href={eventHref(e)}>
                  {e.title || 'Untitled'}
                </a>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </section>

  <!-- Thumbnail lives in the top-right corner, over the grid rather than in
       a column: it is a glance, not a row of the agenda. Faded so it reads as
       a detail and never competes with Next up for attention. -->
  <button
    class="photo-slot"
    bind:this={thumbEl}
    onclick={openPhotos}
    title={albumName ? `${albumName} — open photo frame` : 'Open photo frame'}
    aria-label="Open the fullscreen photo frame"
  >
    {#if photos.length > 0}
      <PhotoFrame
        assets={photos}
        intervalMs={60_000}
        size="thumbnail"
        onAsset={(a) => (currentAsset = a)}
      />
    {:else}
      <span class="photo-empty">{photosFailed ? `No “${FRAME_ALBUM}”` : '…'}</span>
    {/if}
  </button>
</div>

<!-- Swipe-right view: the photo IS the screen, with just enough clock to be
     useful. Rendered over the dashboard rather than routed to, so coming back
     is instant and the data behind it keeps refreshing. -->
{#if view === 'photos'}
  <div class="photo-full" class:opening bind:this={fullEl} style={originStyle}>
    <!-- The photo itself is the tap target: tap to learn what it is. -->
    <button class="photo-hit" onclick={toggleMeta} aria-label="Show photo details"></button>
    <PhotoFrame
      assets={photos}
      intervalMs={30_000}
      size="preview"
      onAsset={(a) => (currentAsset = a)}
    />

    <div class="photo-clock" class:dimmed={metaOpen}>
      <div class="pc-time tabular-nums">{clock}</div>
      <div class="pc-date">{dateLine}</div>
    </div>

    <!-- Appears with the metadata, and exits the whole view rather than just
         dismissing the panel — on a wall tablet the way out has to be
         obvious, not a second guess. -->
    {#if metaOpen}
      <button class="photo-close" onclick={closePhotos} aria-label="Close photo frame">×</button>
    {/if}

    <div class="photo-meta" class:open={metaOpen}>
      <div class="pm-when">{metaWhen}</div>
      {#if metaPlace}<div class="pm-line">{metaPlace}</div>{/if}
      {#if meta?.people?.length}
        <div class="pm-line">
          {#each meta.people.filter((p) => p.name).slice(0, 6) as face, i (face.id)}
            {#if i > 0}<span class="pm-dot"> · </span>{/if}
            {#if faceLinks[face.name]}
              <a class="pm-person" href={kioskHref(`/people/${faceLinks[face.name]}`)}>{face.name}</a>
            {:else}
              <span>{face.name}</span>
            {/if}
          {/each}
        </div>
      {/if}
      {#if meta?.exifInfo?.make || meta?.exifInfo?.model}
        <div class="pm-sub">{[meta.exifInfo.make, meta.exifInfo.model].filter(Boolean).join(' ')}</div>
      {/if}
      {#if albumName}<div class="pm-sub">{albumName}</div>{/if}
    </div>

    {#if photos.length === 0}
      <div class="photo-full-empty">
        {photosFailed ? `No “${FRAME_ALBUM}” album in Immich` : 'Loading photos…'}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Sized for a wall tablet read from across a room, not a phone in a hand.
     Everything scales with viewport width so the same page works on a 10"
     kitchen tablet and a larger panel without a second layout. */
  .display-root {
    position: relative;
    display: grid;
    /* min-width:0 on the tracks so a long title or a wide clock wraps
       instead of pushing the other column off the panel. */
    grid-template-columns: minmax(0, 40%) minmax(0, 1fr);
    gap: clamp(24px, 4vw, 64px);
    min-height: 100vh;
    min-height: 100dvh;
    padding: clamp(24px, 4vw, 56px);
    background: var(--bg-primary, #fff);
  }
  .clock {
    /* 10vw keeps "13:51" inside the 40% column at every tablet width; 13vw
       overflowed into the agenda column at 1280. */
    font-size: clamp(56px, 10vw, 150px);
    font-weight: 700;
    line-height: 0.95;
    letter-spacing: -0.04em;
    color: var(--ink-900, #111);
  }
  .dateline {
    font-size: clamp(18px, 2.4vw, 32px);
    color: var(--ink-500, #666);
    margin-top: 0.35em;
  }
  .temp { font-size: clamp(40px, 6vw, 80px); font-weight: 600; line-height: 1; }
  .cond { font-size: clamp(16px, 2vw, 26px); color: var(--ink-500, #666); }
  .submeta { font-size: clamp(13px, 1.3vw, 17px); color: var(--ink-400, #888); margin-top: 0.4em; }
  .section-label {
    font-size: clamp(12px, 1.2vw, 15px);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ink-400, #888);
    margin-bottom: 0.5em;
  }
  .next-title {
    font-size: clamp(30px, 4.4vw, 60px);
    font-weight: 650;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: var(--ink-900, #111);
  }
  .next-nudge:not(:empty) { margin-top: 0.5rem; }
  .next-when { font-size: clamp(17px, 2vw, 26px); color: var(--brand, #2f7d7d); margin-top: 0.3em; }
  .birthday-band {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    padding: 0.85rem 1rem;
    border-radius: 14px;
    background: var(--bg-secondary, #f6f6f6);
  }

  .photo-slot {
    position: absolute;
    top: clamp(20px, 3.2vw, 48px);
    right: clamp(20px, 3.2vw, 48px);
    width: clamp(120px, 14vw, 190px);
    aspect-ratio: 4 / 3;
    border: 0;
    padding: 0;
    border-radius: 14px;
    overflow: hidden;
    cursor: pointer;
    background: var(--bg-secondary, #f2f2f2);
    /* Faded: a detail in the corner, not a second headline. It lifts to full
       strength on interaction so a deliberate tap feels answered. */
    opacity: 0.62;
    transition: opacity 240ms ease, transform 240ms ease;
  }
  .photo-slot:hover,
  .photo-slot:focus-visible {
    opacity: 1;
    transform: scale(1.02);
  }
  .photo-empty {
    display: grid;
    place-items: center;
    height: 100%;
    font-size: clamp(11px, 1.1vw, 14px);
    color: var(--ink-400, #888);
  }

  .photo-full {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #000;
    transform-origin: 0 0;
    /* Grows out of the thumbnail: the inline style parks it on the corner
       rect, and clearing that on the next frame lets it expand. Transform
       and opacity only — animating width/height would relayout every frame
       and stutter on a tablet. */
    transition: transform 520ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 320ms ease;
  }
  .photo-full.opening {
    transition: none;
  }
  .photo-hit {
    position: absolute;
    inset: 0;
    z-index: 2;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }
  .photo-clock {
    position: absolute;
    right: clamp(20px, 3vw, 44px);
    bottom: clamp(20px, 3vw, 44px);
    z-index: 3;
    text-align: right;
    color: #fff;
    /* The photo behind can be any brightness, so the clock carries its own
       contrast rather than trusting the image. */
    text-shadow: 0 2px 14px rgba(0, 0, 0, 0.65);
    transition: opacity 300ms ease;
  }
  .photo-clock.dimmed { opacity: 0.35; }
  .pc-time { font-size: clamp(34px, 5vw, 68px); font-weight: 600; line-height: 1; }
  .pc-date { font-size: clamp(13px, 1.5vw, 19px); opacity: 0.85; margin-top: 0.25em; }

  .photo-close {
    position: absolute;
    top: clamp(16px, 2.5vw, 32px);
    right: clamp(16px, 2.5vw, 32px);
    z-index: 4;
    width: clamp(44px, 5vw, 60px);
    height: clamp(44px, 5vw, 60px);
    border-radius: 999px;
    border: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(6px);
    color: #fff;
    font-size: clamp(24px, 3vw, 34px);
    line-height: 1;
    cursor: pointer;
    animation: fade-in 220ms ease both;
  }

  .photo-meta {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 3;
    padding: clamp(24px, 4vw, 56px);
    padding-top: clamp(60px, 9vw, 130px);
    color: #fff;
    /* Gradient rather than a solid panel: the photo stays the subject. */
    background: linear-gradient(to top, rgba(0, 0, 0, 0.82), rgba(0, 0, 0, 0));
    transform: translateY(100%);
    opacity: 0;
    pointer-events: none;
    transition: transform 380ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 300ms ease;
  }
  .photo-meta.open {
    transform: translateY(0);
    opacity: 1;
  }
  .agenda-row {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    border-radius: 8px;
    /* A wall tablet gets tapped, not hovered — the row needs to be a target
       in its own right, not just underlined text. */
    padding: 0.15rem 0.35rem;
    margin-left: -0.35rem;
  }
  .agenda-row:hover { background: var(--bg-secondary, #f4f4f4); }
  .next-title { display: block; text-decoration: none; }
  .next-title:hover { text-decoration: underline; }
  .pm-person { color: #fff; text-decoration: underline; text-underline-offset: 3px; }
  .pm-dot { opacity: 0.6; }
  .pm-when { font-size: clamp(20px, 2.6vw, 34px); font-weight: 600; }
  .pm-line { font-size: clamp(14px, 1.7vw, 22px); opacity: 0.9; margin-top: 0.25em; }
  .pm-sub { font-size: clamp(12px, 1.3vw, 16px); opacity: 0.6; margin-top: 0.35em; }

  .photo-full-empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #fff;
    font-size: clamp(15px, 2vw, 22px);
  }

  @keyframes fade-in {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }

  /* Portrait tablets: stack rather than squeeze two columns into nothing. */
  @media (max-aspect-ratio: 1/1) {
    .display-root { grid-template-columns: 1fr; }
    /* Landscape spreads the left column top-to-bottom so the sync line sits
       at the foot of the panel. Stacked, that same rule strands it in the
       middle of the page between the weather and Next up. */
    .display-root > :global(section:first-child) {
      justify-content: flex-start;
      gap: 1.75rem;
    }
  }
</style>
