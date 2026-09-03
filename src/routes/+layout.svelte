<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import KioskHeader from '$lib/KioskHeader.svelte';
  import { isKiosk, syncKioskFromUrl } from '$lib/kiosk.svelte';
  import Icon from '$lib/Icon.svelte';
  import ScopeToggle from '$lib/ScopeToggle.svelte';
  import { scope, surfaceInScope, scopeLocked, type SurfaceScope } from '$lib/scope';
  import { featureOn, authEnabled, INSTANCE_LABEL, type FeatureKey } from '$lib/instance';
  import { activeVault } from '$lib/data/repo/vaults';
  import { initDesktop } from '$lib/desktop';

  // ── Sidebar width (desktop rail) ─────────────────────────────────────
  // Icon rail by default; `twin.sidebarWide` remembers a per-device
  // preference for the labeled 220px variant. Pure CSS width — no reload.
  const SIDEBAR_KEY = 'twin.sidebarWide';
  let sidebarWide = $state(
    (() => {
      try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(SIDEBAR_KEY) === '1';
      } catch {
        return false;
      }
    })()
  );
  function toggleSidebar() {
    sidebarWide = !sidebarWide;
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarWide ? '1' : '0');
    } catch {
      /* private mode — the session keeps the choice */
    }
  }
  import { pageTools } from '$lib/pageTools.svelte';
  import CommandPalette from '$lib/CommandPalette.svelte';
  import QuickActions from '$lib/QuickActions.svelte';
  import BottomSheet from '$lib/BottomSheet.svelte';
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { applyTheme, watchSystemTheme } from '$lib/theme.svelte';
  import { openSheet as openQuickAction } from '$lib/quickActionsStore.svelte';
  import type { IconName } from '$lib/icon-types';
  import { NAV_TABS, type Tab } from '$lib/nav';
  import { personName, syncOfflineMirror, probeConnection } from '$lib/directus';
  import OfflineBanner from '$lib/OfflineBanner.svelte';
  import ConnectionStatus from '$lib/ConnectionStatus.svelte';
  import { refreshConnectionMeta, connection } from '$lib/offline';
  import { refreshPending, flushQueue, pendingCount } from '$lib/writeQueue';
  import { get } from 'svelte/store';
  let { children } = $props();

  // Bound from <CommandPalette bind:this> so the header button can open it
  // imperatively. Cmd+K still works globally — this is the touch-friendly
  // entry point.
  let palette = $state<CommandPalette | null>(null);

  // Theme: the app.html boot script applies the saved mode synchronously
  // (no flash). After hydration we re-apply so `theme.effective` is in
  // sync with the DOM, and we subscribe to OS appearance flips so
  // 'auto' tracks them live.
  onMount(() => {
    applyTheme();
    watchSystemTheme();
    // Desktop shell only (no-op in browsers): register the global spotlight
    // shortcut and listen for navigate events from the overlay window.
    void initDesktop();
    // Offline redundancy (Layer A): surface the last mirror state, probe
    // the host so the status indicator is accurate immediately, then
    // refresh the People/Org mirror in the background. All fire-and-forget.
    refreshConnectionMeta();

    // On a confirmed connection: flush queued writes FIRST (so the mirror
    // re-sync below reflects them), then refresh the People/Org mirror.
    const onReconnect = async () => {
      const online = await probeConnection();
      if (!online) return;
      if (get(pendingCount) > 0) await flushQueue();
      await syncOfflineMirror({ force: get(pendingCount) === 0 ? false : true });
    };
    // Load queued offline writes into the store BEFORE the first reconnect
    // check. These used to fire in parallel, so onReconnect() could read
    // pendingCount === 0 while refreshPending() was still resolving — a queued
    // edit then sat unsent until the next 'online' event or navigation. The
    // window listener and heartbeat below reuse onReconnect once the store is
    // already populated, so only this first call needed the ordering.
    void refreshPending().then(onReconnect);

    // Detect reconnection: re-probe when the OS reports the network came
    // back, and poll on a slow heartbeat while we believe we're offline
    // (the OS 'online' event won't fire for a Tailscale host that simply
    // came back up).
    window.addEventListener('online', onReconnect);
    const beat = setInterval(() => {
      if (get(connection).offline) onReconnect();
    }, 20000);
    return () => {
      window.removeEventListener('online', onReconnect);
      clearInterval(beat);
    };
  });

  // Fullscreen mobile menu. Hamburger in the header opens this.
  // The bottom nav only carries 4 destinations + the FAB; everything
  // else (People, Orgs, Projects, Capture, Timer, Settings) is here,
  // plus the Scope toggle (moved out of the toolbar — it was eating
  // pixels that mattered more for the page title).
  let menuOpen = $state(false);
  // Esc closes the menu, matching every other dialog in the app.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen) menuOpen = false;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Lock the page behind the menu. The menu is a fixed overlay, but a
  // fixed element doesn't stop the page underneath from scrolling — touch
  // scrolls just bubble to the scroll container. The document scrolls on
  // <html> (not <body>) here, so pin both while the menu is open; the
  // cleanup restores them on close/unmount.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const value = menuOpen ? 'hidden' : '';
    document.documentElement.style.overflow = value;
    document.body.style.overflow = value;
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  });

  // `scope` opts a destination into a single mode; omit = shown in both.
  // The active Work/Private toggle hides the ones that don't match (All
  // shows everything). Deep-links still resolve — only the nav filters.
  // `feature` opts a destination into a module this build may not have —
  // omit and it is core. Unlike `scope` (a per-device preference) this one is
  // decided at build time and the route itself is closed too, in +layout.ts.
  // The destinations live in $lib/nav as data, checked against the plugin
  // registry by a test. Rendering, scope + feature filtering stay here.
  const tabs = NAV_TABS;

  // Hamburger menu rows — `tabs` for the main destinations, then a
  // small "Tools" and "Settings" group at the bottom. Tools is a
  // landing that gathers standalone utilities (countdown timer,
  // schedule timer) so they don't crowd the top of the menu.
  const menuItems: Tab[] = [
    ...tabs,
    { href: '/tools', label: 'Tools', icon: 'sliders' },
    { href: '/settings', label: 'Settings', icon: 'settings' }
  ];

  // Menu layout: a horizontal "quick access" carousel of the most-used
  // destinations, then the rest segmented into labelled groups. Quick
  // items + every group's hrefs together cover all of menuItems exactly
  // once. Tweak the arrays to re-curate.
  const byHref = new Map(menuItems.map((i) => [i.href, i] as const));
  const QUICK_HREFS = ['/', '/capture', '/people', '/projects', '/calendar'];
  // All nav surfaces filter by the active Work/Private toggle (reactive).
  const inScope = (t: Tab | undefined) =>
    !!t && surfaceInScope($scope, t.scope) && (!t.feature || featureOn(t.feature));
  const quickItems = $derived(
    QUICK_HREFS.map((h) => byHref.get(h)).filter(inScope) as Tab[]
  );
  const menuGroupsRaw: { label: string; hrefs: string[] }[] = [
    { label: 'Records', hrefs: ['/orgs', '/events', '/grants'] },
    { label: 'Analysis', hrefs: ['/insights', '/marketing'] },
    // Tasks lives here rather than in QUICK_HREFS to keep the quick carousel
    // at five. The invariant above still holds: every menuItems href appears
    // in quickItems or exactly one group.
    { label: 'Activity', hrefs: ['/tasks', '/notes', '/interactions'] },
    { label: 'Library', hrefs: ['/photos'] },
    { label: 'System', hrefs: ['/tools', '/settings'] }
  ];
  // Drop hidden hrefs, then drop any group left empty.
  const menuGroups = $derived(
    menuGroupsRaw
      .map((g) => ({ label: g.label, hrefs: g.hrefs.filter((h) => inScope(byHref.get(h))) }))
      .filter((g) => g.hrefs.length > 0)
  );

  // Curated subset for the mobile bottom-tab bar — the most-used views.
  // The 5-column grid reads: Today / Marketing / [+ FAB] / People / Calendar.
  // Centre slot is the FAB; Notes is reachable via the FAB menu and the
  // hamburger menu.
  //
  // FOUR slots, because the grid is five columns and the middle one is the
  // FAB. So this list is ORDERED and over-long on purpose: the first four
  // entries in scope win. Marketing is work-only, so Notes backfills the
  // fourth slot in Private mode rather than leaving the grid lopsided.
  // Mirrors QUICK_HREFS above — map over an array, don't filter `tabs`,
  // so the reading order is declared here instead of inherited from an
  // unrelated list.
  const MOBILE_HREFS = ['/', '/marketing', '/people', '/calendar', '/notes'];
  const MOBILE_LABEL: Record<string, string> = {};
  const mobileTabs = $derived(
    MOBILE_HREFS.map((h) => byHref.get(h))
      .filter(inScope)
      .slice(0, 4) as Tab[]
  );
  // Desktop icon rail — same scope filter.
  const visibleTabs = $derived(tabs.filter(inScope));
  // We want the FAB visually in the middle column. Split the curated
  // tabs into "left side" and "right side" so the template can render
  // them around the centred FAB.
  const mobileLeft = $derived(mobileTabs.slice(0, 2));
  const mobileRight = $derived(mobileTabs.slice(2));

  // Pretty-print the breadcrumb. For exact tab matches (e.g. /orgs) we use
  // the tab label. For detail routes (e.g. /orgs/2) we pull the entity name
  // out of $page.data — the load functions for those routes already return
  // `org`, `person`, or `project` — so we never need each page to wire
  // anything up. Falls back to the parent tab label while the page loads.
  const crumbTitle = $derived.by(() => {
    const p = $page.url.pathname;
    const exact = tabs.find((t) => t.href === p);
    if (exact) return exact.label;

    const d = ($page.data ?? {}) as Record<string, unknown>;

    // Detail-page name lookups, ordered by likelihood.
    const org = d.org as { name?: string | null } | undefined;
    if (org?.name) return org.name;

    const person = d.person as Parameters<typeof personName>[0] | undefined;
    if (person) return personName(person);

    const project = d.project as { name?: string | null } | undefined;
    if (project?.name) return project.name;

    const ev = d.event as { name?: string | null; title?: string | null } | undefined;
    if (ev?.name || ev?.title) return ev.name || ev.title!;

    const note = d.note as { title?: string | null } | undefined;
    if (note?.title) return note.title;

    // While the page is loading or for unknown routes, show the parent
    // section's label rather than the raw URL fragment.
    const parent = tabs.find((t) => t.href !== '/' && p.startsWith(t.href + '/'));
    if (parent) return parent.label;

    return p.replace(/^\//, '') || 'Home';
  });

  function isActive(href: string) {
    return $page.url.pathname === href;
  }

  // Chrome-free routes. /display is an always-on wall tablet: no header, no
  // bottom nav, no sidebar — nobody navigates from it, and 56px of nav on a
  // screen read from across the room is 56px of wasted glass.
  const isDisplay = $derived($page.url.pathname === '/display');

  // The calendar is the one page that earns more than a reading measure.
  // Its desktop peek docks as a rail beside the grid, and capping the pair
  // at 1024px would spend the rail's width out of the grid's — the grid fell
  // from 1024 to 624px on a 1440px screen. Padding stays; only the cap goes,
  // so the rail comes out of the margin instead.
  const isWideRoute = $derived($page.url.pathname.startsWith('/calendar'));

  // Kiosk mode: arrived here from the wall display. Same reasoning as
  // /display — the normal chrome assumes a phone in your hand — but these
  // pages DO need a way out, so the kiosk bar replaces it rather than
  // leaving nothing.
  $effect(() => syncKioskFromUrl($page.url));
  const kiosk = $derived(isKiosk() && !isDisplay);
  // /spotlight is the desktop shell's overlay window — a floating search box.
  // Any chrome would be another app's chrome bleeding into a system overlay.
  const isSpotlight = $derived($page.url.pathname === '/spotlight');
  const bareChrome = $derived(isDisplay || kiosk || isSpotlight);

  // ── Mobile pull-to-search ─────────────────────────────────────────────
  // Drag down from the top of the page to open the command palette —
  // the touch equivalent of ⌘K. Engages only when scrollY === 0 and the
  // touch didn't start on an editable element, so normal scrolling and
  // form interactions are untouched.
  const PULL_THRESHOLD = 80;   // release past this → open palette
  const PULL_MAX = 120;        // clamp so the indicator doesn't fly off
  let pullY = $state(0);
  let pullActive = $state(false);
  let startY = 0;

  // ── Mobile edge-swipe → open the menu ─────────────────────────────────
  // A rightward swipe starting near the left edge opens the hamburger
  // menu (mobile only). Coexists with pull-to-search: whichever axis the
  // finger commits to first wins.
  const EDGE_ZONE = 32; // left-edge start zone (px)
  const SWIPE_OPEN = 64; // rightward distance to open
  const SWIPE_CLOSE = 56; // leftward distance to close an open menu
  let edgeStartX = 0;
  let edgeSwipe = false;
  let closeSwipe = false; // candidate left-swipe while the menu is open
  const isMobile = () => window.innerWidth < 768;

  function isEditable(el: EventTarget | null): boolean {
    const t = el as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) {
      edgeSwipe = false;
      closeSwipe = false;
      pullActive = false;
      return;
    }
    const x = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    edgeStartX = x;
    // Edge-swipe candidate: near the left edge, mobile, menu closed.
    edgeSwipe = !menuOpen && isMobile() && x <= EDGE_ZONE && !isEditable(e.target);
    // Close-swipe candidate: a leftward drag anywhere while the menu is open.
    closeSwipe = menuOpen && isMobile() && !isEditable(e.target);
    // Pull-to-search candidate: at the top, not on a form control, not in the menu.
    pullActive = !menuOpen && window.scrollY === 0 && !isEditable(e.target);
    pullY = 0;
  }

  function onTouchMove(e: TouchEvent) {
    const touch = e.touches[0];

    // Close-swipe → dismiss the open menu. Commit only on a clearly
    // leftward move so the nav list can still scroll vertically.
    if (closeSwipe) {
      const dx = touch.clientX - edgeStartX;
      const dy = touch.clientY - startY;
      if (dx < -10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (e.cancelable) e.preventDefault();
        if (dx <= -SWIPE_CLOSE) {
          menuOpen = false;
          closeSwipe = false;
        }
        return;
      }
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        closeSwipe = false; // vertical intent — let the menu scroll
      }
    }

    // Edge-swipe → open menu. Commit only once the move is clearly
    // horizontal-right, so it never steals a vertical scroll.
    if (edgeSwipe) {
      const dx = touch.clientX - edgeStartX;
      const dy = touch.clientY - startY;
      if (dx > 10 && dx > Math.abs(dy) * 1.5) {
        pullActive = false; // horizontal won — don't also pull
        if (e.cancelable) e.preventDefault();
        if (dx >= SWIPE_OPEN) {
          menuOpen = true;
          edgeSwipe = false;
        }
        return;
      }
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        edgeSwipe = false; // vertical intent — let the page scroll
      }
    }

    if (!pullActive) return;
    const dy = touch.clientY - startY;
    if (dy <= 0) {
      // Finger moved up — bail out, let the page scroll normally.
      pullActive = false;
      pullY = 0;
      return;
    }
    // Resist past the threshold so it feels rubbery rather than linear.
    const resisted = dy < PULL_THRESHOLD ? dy : PULL_THRESHOLD + (dy - PULL_THRESHOLD) * 0.4;
    pullY = Math.min(resisted, PULL_MAX);
    // Suppress browser pull-to-refresh + the page sliding with the finger.
    if (e.cancelable) e.preventDefault();
  }

  function onTouchEnd() {
    edgeSwipe = false;
    closeSwipe = false;
    if (!pullActive) return;
    const triggered = pullY >= PULL_THRESHOLD;
    pullActive = false;
    pullY = 0;
    if (triggered) palette?.openPalette();
  }
</script>

<svelte:window
  ontouchstart={onTouchStart}
  ontouchmove={onTouchMove}
  ontouchend={onTouchEnd}
  ontouchcancel={onTouchEnd}
/>

<OfflineBanner />

<div class="flex min-h-screen">
  <!-- Desktop: left icon rail -->
  {#if !bareChrome}
  <aside
    class="hidden md:flex print:!hidden sticky top-0 h-screen shrink-0 flex-col justify-between self-start overflow-hidden border-r border-surface-border bg-surface-card py-4 {sidebarWide ? 'px-3' : 'items-center'}"
    style={`width: ${sidebarWide ? '220px' : '72px'}; transition: width 200ms cubic-bezier(0.23, 1, 0.32, 1);`}
  >
    <div class="flex w-full flex-col gap-3 {sidebarWide ? '' : 'items-center'}">
      {#if sidebarWide}
        <!-- The brand wordmark earns the top slot when there is room for it,
             centered on the rail. Dark theme renders it mono-white (app.css
             .sidebar-wordmark) — the navy original would vanish on black. -->
        <a href="/" class="flex h-10 items-center justify-center" title="Hub" aria-label="Hub">
          <img src="/logo/wordmark.svg" alt="twin" class="sidebar-wordmark h-6 w-auto" />
        </a>
      {:else}
        <!-- Collapsed: the square brand mark, same slot, same size as a
             nav icon tile. -->
        <a href="/" class="flex h-10 w-10 items-center justify-center" title="Hub" aria-label="Hub">
          <img src="/logo/mark.svg" alt="twin" class="sidebar-wordmark h-9 w-9" />
        </a>
      {/if}
      <div class="mx-2 h-px bg-surface-divider {sidebarWide ? '' : 'w-8'}"></div>
      {#each visibleTabs as tab}
        <a
          href={tab.href}
          class="nav-icon {sidebarWide ? 'nav-row' : ''} {isActive(tab.href) ? 'nav-icon-active' : ''}"
          title={tab.label}
          aria-label={tab.label}
        >
          <Icon name={tab.icon} size={18} />
          {#if sidebarWide}<span class="nav-label">{tab.label}</span>{/if}
        </a>
      {/each}
    </div>
    <div class="flex w-full flex-col gap-3 {sidebarWide ? '' : 'items-center'}">
      {#if !authEnabled()}
        <!-- The active vault — which world of data this window is in. Click
             to switch or join another (device-owned connections only; a
             managed session-mode instance IS its vault). -->
        <a
          href="/settings/vaults"
          class="nav-icon {sidebarWide ? 'nav-row' : ''} {isActive('/settings/vaults') ? 'nav-icon-active' : ''}"
          title={`Vault: ${activeVault().name}`}
          aria-label={`Vault: ${activeVault().name}`}
        >
          <Icon name={activeVault().kind === 'workspace' ? 'building' : 'lock'} size={18} />
          {#if sidebarWide}<span class="nav-label">{activeVault().name}</span>{/if}
        </a>
      {/if}
      <a
        href="/tools"
        class="nav-icon {sidebarWide ? 'nav-row' : ''} {isActive('/tools') ? 'nav-icon-active' : ''}"
        title="Tools"
        aria-label="Tools"
      >
        <Icon name="sliders" size={18} />
        {#if sidebarWide}<span class="nav-label">Tools</span>{/if}
      </a>
      <a
        href="/settings"
        class="nav-icon {sidebarWide ? 'nav-row' : ''} {isActive('/settings') ? 'nav-icon-active' : ''}"
        title="Settings"
        aria-label="Settings"
      >
        <Icon name="settings" size={18} />
        {#if sidebarWide}<span class="nav-label">Settings</span>{/if}
      </a>
      <!-- The expand/collapse affordance — deliberately quiet: a low-contrast
           chevron that only asserts itself on hover. -->
      <button
        type="button"
        class="nav-icon sidebar-toggle {sidebarWide ? 'nav-row' : ''}"
        title={sidebarWide ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={sidebarWide ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={sidebarWide}
        onclick={toggleSidebar}
      >
        <Icon name={sidebarWide ? 'chevron-left' : 'chevron-right'} size={16} />
        {#if sidebarWide}<span class="nav-label">Collapse</span>{/if}
      </button>
    </div>
  </aside>
  {/if}

  <div class="flex min-h-screen min-w-0 flex-1 flex-col">
    <!-- Top bar with breadcrumb. pt-safe respects the iPhone notch /
         Dynamic Island; the header's effective height grows automatically
         when the device has a top inset. -->
    {#if kiosk}
      <KioskHeader />
    {/if}

    {#if !bareChrome}
    <header
      class="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-surface-border bg-surface-page px-4 pt-safe md:px-6 print:!hidden"
      style="height: calc(3.5rem + env(safe-area-inset-top));"
    >
      <!-- Mobile menu (hamburger) — entry to People, Orgs, Projects,
           Capture, Timer, Settings. On sub-routes (detail pages) we
           also render a back button beside it; relying on system gestures
           alone is unreliable in standalone PWAs. -->
      <button
        class="btn-ghost !px-2 md:hidden"
        aria-label="Open menu"
        onclick={() => (menuOpen = true)}
      >
        <Icon name="menu" size={20} />
      </button>
      {#if $page.url.pathname.split('/').filter(Boolean).length >= 2}
        <button
          class="btn-ghost !px-2 md:hidden"
          aria-label="Back"
          onclick={() => history.back()}
        >
          <Icon name="chevron-left" size={20} />
        </button>
      {/if}
      <button
        class="btn-ghost !px-2 hidden md:inline-flex"
        aria-label="Back"
        onclick={() => history.back()}
      >
        <Icon name="chevron-left" size={18} />
      </button>
      <!-- Use clamp() so the crumb title scales down on narrow
           viewports rather than truncating to "Herm…". Icelandic
           names + the ScopeToggle compete for space; shrinking
           the title is friendlier than ellipsis. -->
      <nav class="flex min-w-0 flex-1 items-center gap-2 text-ink-500">
        <span
          class="font-display truncate text-ink-900"
          style="letter-spacing: -0.02em; font-weight: 600; font-size: clamp(0.875rem, 3.6vw, 1rem);"
          title={crumbTitle}
        >{crumbTitle}</span>
      </nav>
      <div class="ml-2 flex shrink-0 items-center gap-3">
        <!-- ScopeToggle lives in the fullscreen menu on mobile (the
             pill was eating a chunk of the toolbar for a control
             that's used infrequently). On desktop the toolbar has
             room so it stays inline here. -->
        <!-- Which twin this is. Two instances open in two tabs, both grey
             and both called twin, is how a private note gets written into
             the workplace database. Only the non-default build says so. -->
        {#if INSTANCE_LABEL}
          <span
            class="hidden shrink-0 rounded-full border border-surface-border px-2 py-0.5 font-display text-[10px] uppercase tracking-wider text-ink-500 sm:inline-block"
            title="This twin talks to the {INSTANCE_LABEL} database"
          >{INSTANCE_LABEL}</span>
        {/if}
        {#if !scopeLocked()}
          <div class="hidden md:inline-flex"><ScopeToggle /></div>
        {/if}
        <ConnectionStatus />
        <button
          class="nav-icon"
          title="Search (⌘K)"
          aria-label="Open command palette"
          onclick={() => palette?.openPalette()}
        >
          <Icon name="search" size={18} />
        </button>
        <!-- Trailing action: a page can register a contextual "tools"
             button (filters / page search) via the pageTools store.
             When none is registered the slot is simply empty — the old
             notifications bell was a non-functional placeholder, so we
             don't render dead chrome. -->
        {#if $pageTools}
          <button
            class="nav-icon relative md:hidden"
            title={$pageTools.label}
            aria-label={$pageTools.label}
            onclick={() => $pageTools?.onOpen()}
          >
            <Icon name={$pageTools.icon} size={18} />
            {#if $pageTools.badge}
              <span class="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand px-1 text-[9px] font-semibold text-white">{$pageTools.badge}</span>
            {/if}
          </button>
        {/if}
      </div>
    </header>
    {/if}

    <!-- Page content. min-w-0 is critical: without it, flex defaults a
         flex item's min-width to its min-content, which lets a long word,
         a wide image, or a non-wrapping row inside push <main> beyond
         the viewport — and by extension the sticky header and bottom
         nav, which then truncate awkwardly. -->
    <main class="min-w-0 flex-1 {isDisplay ? '' : 'px-4 py-5 md:px-8 md:py-8'}">
      <!-- max-w-5xl centres every normal page at a readable measure. The wall
           display is the exception: it is sized for the whole panel, so the
           cap would letterbox it to 1024px on a wider tablet. -->
      <div class={isDisplay || isWideRoute ? 'w-full' : 'mx-auto w-full max-w-5xl'}>
        {@render children()}
      </div>
    </main>

    <!-- Mobile bottom tab bar. 5-column grid:
            Today / Marketing / [+ FAB] / People / Calendar
         The center slot is a raised circular button that opens the
         QuickActions menu sheet (same highlights as the dashboard
         row). Notes is reachable via the FAB menu and the hamburger. -->
    {#if !bareChrome}
    <nav
      class="sticky bottom-0 z-20 grid grid-cols-5 border-t border-surface-border bg-surface-page pb-safe md:hidden print:!hidden"
    >
      {#each mobileLeft as tab (tab.href)}
        <a
          href={tab.href}
          class="flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 font-display text-[10px] uppercase leading-tight {isActive(tab.href)
            ? 'text-ink-900'
            : 'text-ink-400'}"
          style="touch-action: manipulation; letter-spacing: 0.1em;"
        >
          <span
            class="flex h-7 w-7 items-center justify-center"
            style={isActive(tab.href)
              ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md);'
              : ''}
          >
            <Icon name={tab.icon} size={18} />
          </span>
          <span class="truncate max-w-full">{MOBILE_LABEL[tab.href] ?? tab.label}</span>
        </a>
      {/each}

      <!-- Center FAB column. The button is raised above the nav line
           with a negative top margin so it pokes up like Instagram /
           TikTok's "+" buttons. Tap opens the QuickActions menu sheet. -->
      <div class="flex min-h-[56px] items-center justify-center">
        <button
          type="button"
          class="quick-action-fab"
          aria-label="Quick actions"
          onclick={() => openQuickAction('menu')}
        >
          <Icon name="plus" size={22} />
        </button>
      </div>

      {#each mobileRight as tab (tab.href)}
        <a
          href={tab.href}
          class="flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 font-display text-[10px] uppercase leading-tight {isActive(tab.href)
            ? 'text-ink-900'
            : 'text-ink-400'}"
          style="touch-action: manipulation; letter-spacing: 0.1em;"
        >
          <span
            class="flex h-7 w-7 items-center justify-center"
            style={isActive(tab.href)
              ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md);'
              : ''}
          >
            <Icon name={tab.icon} size={18} />
          </span>
          <span class="truncate max-w-full">{MOBILE_LABEL[tab.href] ?? tab.label}</span>
        </a>
      {/each}
    </nav>
    {/if}
  </div>
</div>

<!-- All quick-action sheets (capture, log, event, person, org, +
     the FAB menu) live here so they overlay every route. They read
     their open/close state from the shared `quickActions.svelte.ts`
     module. -->
<QuickActions />

<!-- Mobile navigation menu — opened by the hamburger in the header.
     Lists every destination plus Settings. Rows highlight the active
     route via the accent treatment used elsewhere; tapping a row
     navigates and closes the sheet via SvelteKit's link handler. -->
<!-- Fullscreen mobile menu. Replaces the previous bottom-sheet
     menu (which was capped at 85vh and competed with the nav bar
     at the bottom). The ScopeToggle moved out of the chrome
     toolbar and lives at the top of this menu instead — it's
     used infrequently enough that hiding it behind the menu
     button is the better trade for toolbar real estate. -->
{#if menuOpen}
  <div
    class="fixed inset-0 z-50 flex flex-col bg-surface-card md:hidden"
    role="dialog"
    aria-modal="true"
    aria-label="Menu"
    transition:fly={{ x: -360, duration: 260, easing: cubicOut }}
  >
    <!-- Top bar: close + title on the left, Scope toggle on the right.
         The toggle rides the header line instead of taking its own row —
         it's the only stateful control here, so it earns the headline
         spot while saving a full row of vertical space. -->
    <header
      class="flex items-center justify-between gap-3 border-b border-surface-divider px-4"
      style="padding-top: max(env(safe-area-inset-top), 0.75rem); padding-bottom: 0.75rem;"
    >
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="btn-ghost !px-2"
          aria-label="Close menu"
          onclick={() => (menuOpen = false)}
        >
          <Icon name="x" size={20} />
        </button>
        <span class="font-display text-sm font-semibold text-ink-900" style="letter-spacing: -0.01em;">Menu</span>
      </div>
      {#if scopeLocked()}
        {#if INSTANCE_LABEL}
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">{INSTANCE_LABEL}</span>
        {/if}
      {:else}
        <ScopeToggle />
      {/if}
    </header>

    <!-- Quick access — most-used destinations in an equal-column grid
         spanning the full menu width. -->
    <div class="border-b border-surface-divider px-4 py-3">
      <div class="mb-2 font-display text-[10px] uppercase tracking-wider text-ink-400">Quick access</div>
      <div class="grid gap-2" style={`grid-template-columns: repeat(${quickItems.length}, minmax(0, 1fr));`}>
        {#each quickItems as item (item.href)}
          {@const active = isActive(item.href)}
          <a
            href={item.href}
            class="group flex flex-col items-center gap-1.5 py-1 text-center transition active:opacity-70"
            onclick={() => (menuOpen = false)}
          >
            <span
              class="flex h-12 w-12 items-center justify-center rounded-full transition {active
                ? ''
                : 'bg-surface-hover text-brand group-hover:bg-surface-divider'}"
              style={active ? 'background: var(--accent-electric); color: var(--accent-text);' : ''}
            >
              <Icon name={item.icon} size={22} />
            </span>
            <span class="font-display text-[10px] uppercase tracking-wider {active ? 'text-ink-900' : 'text-ink-500'}">{item.label}</span>
          </a>
        {/each}
      </div>
    </div>

    <!-- Everything else, segmented into groups. -->
    <nav class="flex-1 space-y-4 overflow-y-auto px-2 py-3">
      {#each menuGroups as group (group.label)}
        <div>
          <div class="px-3 pb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">{group.label}</div>
          <ul class="space-y-0.5">
            {#each group.hrefs as href (href)}
              {@const item = byHref.get(href)}
              {#if item}
                {@const active = isActive(item.href)}
                <li>
                  <a
                    href={item.href}
                    class="flex items-center gap-3 px-3 py-3 text-base hover:bg-surface-hover"
                    style="border-radius: var(--radius-md); min-height: 48px;"
                    onclick={() => (menuOpen = false)}
                  >
                    <span
                      class="flex h-10 w-10 shrink-0 items-center justify-center"
                      style={active
                        ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md);'
                        : 'background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);'}
                    >
                      <Icon name={item.icon} size={18} />
                    </span>
                    <span class="font-medium {active ? 'text-ink-900' : 'text-ink-700'}">{item.label}</span>
                    {#if active}
                      <span class="ml-auto text-[10px] uppercase tracking-wider" style="color: var(--accent-electric);">current</span>
                    {/if}
                  </a>
                </li>
              {/if}
            {/each}
          </ul>
        </div>
      {/each}
    </nav>
  </div>
{/if}

<!-- Pull-to-search indicator. Shown only while the user is dragging from
     the top on mobile. Pinned to the viewport top so it slides into view
     under the notch/status bar. Hidden on desktop where ⌘K does the job. -->
{#if pullActive && pullY > 0}
  <div
    class="pointer-events-none fixed left-1/2 top-0 z-40 -translate-x-1/2 md:hidden"
    style="transform: translate(-50%, calc({pullY}px - 100%)); opacity: {Math.min(pullY / PULL_THRESHOLD, 1)};"
    aria-hidden="true"
  >
    <div
      class="mt-2 flex items-center gap-2 rounded-full border border-surface-border bg-surface-card px-4 py-2 text-sm text-ink-700 shadow-card"
    >
      <Icon name="search" size={16} />
      <span>{pullY >= PULL_THRESHOLD ? 'Release to search' : 'Pull to search'}</span>
    </div>
  </div>
{/if}

<!-- Global command palette. Mounted once at the root so ⌘K and "/" work
     from anywhere in the app, and the header search button has a single
     instance to call into. The palette is invisible until openPalette() is
     called, so it has zero cost on first paint. -->
<CommandPalette bind:this={palette} />

<style>
  /* Mobile bottom-nav FAB — raised circle in the centre column. The
     negative top margin lifts the circle above the nav baseline so it
     pokes up the way Instagram/TikTok's centre buttons do; a slightly
     larger box-shadow gives it lift over the page beneath. */
  .quick-action-fab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    margin-top: -22px; /* lifts above the nav line */
    border-radius: 9999px;
    border: 2px solid var(--bg-surface-page, var(--bg-primary));
    background: var(--accent-electric);
    color: var(--accent-text);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
    cursor: pointer;
    transition: transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1), background var(--transition-fast);
    -webkit-tap-highlight-color: transparent;
  }
  .quick-action-fab:hover { background: var(--accent-electric-hover); }
  .quick-action-fab:active { transform: scale(0.94); }
</style>
