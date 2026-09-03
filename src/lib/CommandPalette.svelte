<script lang="ts">
  /**
   * Global command palette. Mounted once in `+layout.svelte`.
   *
   * Triggers:
   *   - ⌘K / Ctrl+K from anywhere (the standard everyone has trained for)
   *   - `/` from anywhere unless an input is focused (GitHub idiom)
   *   - Imperative open via `commandPalette.open()` — exposed for the header
   *     button so mobile/touch users can reach it without a keyboard
   *
   * The palette searches across People, Organizations, Projects, and Notes in
   * parallel, deduped/grouped by collection, with a small set of quick
   * actions ("New note", "Today", etc.) at the top when the query is empty.
   */
  import { goto } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { fade, fly, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import {
    searchPeople,
    searchOrgs,
    searchProjects,
    resolveProjectMarks,
    searchNotes,
    createPerson,
    createOrg,
    personName,
    assetUrl,
    type Person,
    type Organization,
    type Project,
    type Note,
  } from '$lib/directus';
  import type { IconName } from '$lib/icon-types';

  type Result =
    | { kind: 'person'; id: number; title: string; subtitle?: string; avatar?: string | null; focal?: string | null }
    | { kind: 'org'; id: number; title: string; subtitle?: string; logo?: string | null; focal?: string | null }
    | { kind: 'project'; id: number; title: string; subtitle?: string; mark?: string | null }
    | { kind: 'note'; id: number; title: string; subtitle?: string }
    | { kind: 'action'; id: string; title: string; subtitle?: string; icon: IconName; href: string }
    | { kind: 'create'; target: 'person' | 'org'; name: string; title: string; subtitle?: string };

  // ─── Open / close state ─────────────────────────────────────────────────
  let open = $state(false);

  // Lock the page behind the overlay so it can't scroll while the palette
  // is open (a fixed overlay alone doesn't stop the scroll container). The
  // document scrolls on <html> here, so pin both <html> and <body>;
  // restore on close/unmount. Mirrors the menu's scroll-lock in +layout.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const value = open ? 'hidden' : '';
    document.documentElement.style.overflow = value;
    document.body.style.overflow = value;
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  });
  let q = $state('');
  let activeIndex = $state(0);
  // We bind two refs — one per breakpoint branch — because both inputs
  // exist in the DOM at once and visibility is controlled by CSS
  // (`md:hidden` / `hidden md:flex`). Binding a single ref means the
  // hidden element wins, and `.focus()` on `display: none` is a no-op.
  let mobileInputEl = $state<HTMLInputElement | null>(null);
  let desktopInputEl = $state<HTMLInputElement | null>(null);
  function visibleInput(): HTMLInputElement | null {
    // offsetParent is null when an element (or any ancestor) is
    // display:none, which is precisely how the two branches hide.
    if (mobileInputEl && mobileInputEl.offsetParent !== null) return mobileInputEl;
    if (desktopInputEl && desktopInputEl.offsetParent !== null) return desktopInputEl;
    return mobileInputEl ?? desktopInputEl;
  }
  let listEl = $state<HTMLUListElement | null>(null);

  // The four most useful "do something" rows, surfaced when the query is
  // empty. Keep this list short — a palette that opens onto twenty options
  // forces the user to scan instead of just typing.
  const QUICK_ACTIONS: Result[] = [
    { kind: 'action', id: 'new-note', title: 'New note', subtitle: 'Open the capture page', icon: 'bolt', href: '/capture' },
    { kind: 'action', id: 'today', title: 'Today', subtitle: 'Dashboard for the day', icon: 'home', href: '/' },
    { kind: 'action', id: 'people', title: 'Browse people', icon: 'users', href: '/people' },
    { kind: 'action', id: 'orgs', title: 'Browse organizations', icon: 'building', href: '/orgs' },
    { kind: 'action', id: 'projects', title: 'Browse projects', icon: 'sparkles', href: '/projects' },
    { kind: 'action', id: 'notes', title: 'Browse notes', icon: 'notebook', href: '/notes' },
    { kind: 'action', id: 'events', title: 'Calendar', icon: 'calendar', href: '/calendar' },
  ];

  // ─── Search ─────────────────────────────────────────────────────────────
  let people = $state<Result[]>([]);
  let orgs = $state<Result[]>([]);
  let projects = $state<Result[]>([]);
  let notes = $state<Result[]>([]);
  let loading = $state(false);
  let error = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Debounced fan-out: 4 collections in parallel. The limits are intentionally
  // small because the palette favours "did I find it?" over "show me everything"
  // — anyone wanting a full list opens the dedicated index page.
  $effect(() => {
    const term = q.trim();
    if (searchTimer) clearTimeout(searchTimer);
    if (!term) {
      people = []; orgs = []; projects = []; notes = []; loading = false; error = '';
      return;
    }
    loading = true;
    searchTimer = setTimeout(async () => {
      try {
        const [pp, oo, pj, nn] = await Promise.all([
          searchPeople(term, 6) as Promise<Person[]>,
          searchOrgs(term, 6) as Promise<Organization[]>,
          searchProjects(term, 6) as Promise<Project[]>,
          searchNotes({ q: term, limit: 6 }),
        ]);
        people = pp.map((p): Result => ({
          kind: 'person',
          id: p.id,
          title: personName(p),
          subtitle: p.email ?? undefined,
          avatar: p.person_picture ?? null,
          focal: p.image_focal ?? null,
        }));
        orgs = oo.map((o): Result => ({
          kind: 'org',
          id: o.id,
          title: o.name ?? '(no name)',
          subtitle: [o.industry, o.website].filter(Boolean).join(' · ') || undefined,
          logo: o.logo ?? null,
          focal: o.image_focal ?? null,
        }));
        const projMarks = await resolveProjectMarks(pj.map((p) => p.id)).catch(() => new Map<number, string | null>());
        projects = pj.map((p): Result => ({
          kind: 'project',
          id: p.id,
          title: p.name ?? '(no name)',
          subtitle: p.summary ?? p.kind ?? undefined,
          mark: projMarks.get(p.id) ?? null,
        }));
        notes = nn.map((n): Result => ({
          kind: 'note',
          id: n.id,
          title: n.title || '(untitled note)',
          subtitle: n.note_type ?? undefined,
        }));
        error = '';
        activeIndex = 0; // reset selection so Enter hits the top match
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        loading = false;
      }
    }, 160);
  });

  // ─── Flat ordered list for keyboard nav ─────────────────────────────────
  // Order matters: people first (most-used), then orgs, projects, notes,
  // actions last when there's a query (they become noise during search).
  // Create-from-query rows: turn whatever's typed into a new person/org in
  // one click. Only when there's a query.
  let creating = $state(false);
  const createRows = $derived.by<Result[]>(() => {
    const name = q.trim();
    if (!name) return [];
    return [
      { kind: 'create', target: 'person', name, title: `Add “${name}” as a person`, subtitle: 'New contact' },
      { kind: 'create', target: 'org', name, title: `Add “${name}” as an organization`, subtitle: 'New organization' }
    ];
  });

  const flat = $derived.by(() => {
    if (!q.trim()) return QUICK_ACTIONS;
    return [...people, ...orgs, ...projects, ...notes, ...createRows, ...QUICK_ACTIONS];
  });

  // Group results for rendering; a flat list with section headers reads
  // faster than separate cards.
  const grouped = $derived.by(() => {
    if (!q.trim()) return [{ label: 'Quick actions', items: QUICK_ACTIONS }];
    const sections: { label: string; items: Result[] }[] = [];
    if (people.length) sections.push({ label: 'People', items: people });
    if (orgs.length) sections.push({ label: 'Organizations', items: orgs });
    if (projects.length) sections.push({ label: 'Projects', items: projects });
    if (notes.length) sections.push({ label: 'Notes', items: notes });
    if (createRows.length) sections.push({ label: 'Create', items: createRows });
    sections.push({ label: 'Quick actions', items: QUICK_ACTIONS });
    return sections;
  });

  // ─── Open / close logic ─────────────────────────────────────────────────
  export async function openPalette() {
    open = true;
    q = '';
    activeIndex = 0;
    // Wait for Svelte to render the dialog before reaching for the input
    // — `queueMicrotask` here fires before the DOM is updated so the
    // `bind:this` ref is still null and focus silently fails. Without
    // focus inside the dialog the `onkeydown` Esc handler can't fire
    // either, which is why hitting Esc felt broken.
    await tick();
    const el = visibleInput();
    el?.focus();
    el?.select?.();
  }
  function close() {
    open = false;
    q = '';
  }

  // Keyboard handling. The activation chord is global, so it lives on window.
  // We deliberately allow ⌘K to fire even when an input is focused — that's
  // the whole point of a palette.
  function onWindowKey(e: KeyboardEvent) {
    const isPaletteChord = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
    if (isPaletteChord) {
      e.preventDefault();
      open ? close() : openPalette();
      return;
    }
    // Belt-and-braces: Esc closes the palette even if focus drifted out
    // of the dialog (e.g. a click on a non-focusable area).
    if (open && e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (open) return; // the rest only matters when palette is closed
    // GitHub-style "/" shortcut. Suppress when typing in form fields.
    if (e.key === '/') {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      openPalette();
    }
  }

  // ─── Within-palette key handling ────────────────────────────────────────
  function onPaletteKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, flat.length - 1);
      scrollActiveIntoView();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      scrollActiveIntoView();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = flat[activeIndex];
      if (r) pick(r);
    }
  }

  function scrollActiveIntoView() {
    queueMicrotask(() => {
      const el = listEl?.querySelector<HTMLLIElement>(`[data-idx="${activeIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  async function pick(r: Result) {
    if (r.kind === 'create') {
      if (creating) return;
      creating = true;
      error = '';
      try {
        const name = r.name.trim();
        if (r.target === 'person') {
          const p = await createPerson({ full_name: name });
          close();
          goto(`/people/${p.id}`);
        } else {
          const o = await createOrg({ name });
          close();
          goto(`/orgs/${o.id}`);
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        creating = false;
      }
      return;
    }
    const href = hrefOf(r);
    close();
    goto(href);
  }

  function hrefOf(r: Result): string {
    switch (r.kind) {
      case 'person': return `/people/${r.id}`;
      case 'org': return `/orgs/${r.id}`;
      case 'project': return `/projects/${r.id}`;
      case 'note': return `/notes/${r.id}`;
      case 'action': return r.href;
      case 'create': return '';
    }
  }

  // Helper for icon per kind — paints the row's leading slot.
  function kindIcon(k: Result['kind']): IconName {
    switch (k) {
      case 'person': return 'users';
      case 'org': return 'building';
      case 'project': return 'sparkles';
      case 'note': return 'notebook';
      case 'action': return 'bolt';
      case 'create': return 'plus';
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  });

  // Compute the global flat-index for a row inside a section so keyboard
  // nav highlight matches click-target. This is O(n) but n is tiny.
  function flatIndexOf(r: Result): number {
    return flat.indexOf(r);
  }
</script>

{#if open}
  {@const resultCount = people.length + orgs.length + projects.length + notes.length}

  <!-- ───────── Mobile: iOS Spotlight-style fullscreen sheet ───────── -->
  <div
    class="fixed inset-0 z-50 flex flex-col bg-surface-card md:hidden"
    role="dialog"
    aria-modal="true"
    aria-label="Search"
    tabindex="-1"
    onkeydown={onPaletteKey}
    transition:fly={{ y: -12, duration: 200, easing: cubicOut, opacity: 0 }}
  >
    <!-- Search header. pt-safe respects the notch; the pill is the focal
         affordance, with a textual Cancel on the right (iOS Spotlight). -->
    <div class="flex items-center gap-2 px-3 pt-safe-plus-2 pb-2">
      <div class="flex h-11 flex-1 items-center gap-2.5 rounded-[12px] bg-surface-hover px-3">
        <Icon name="search" size={18} class="shrink-0 text-ink-400" />
        <input
          bind:this={mobileInputEl}
          type="search"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck={false}
          enterkeyhint="search"
          placeholder="Search"
          class="w-full border-0 bg-transparent p-0 text-[17px] leading-none text-ink-900 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 placeholder:text-ink-400 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
          bind:value={q}
        />
        {#if q}
          <button
            type="button"
            aria-label="Clear search"
            class="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-300 active:bg-surface-border"
            onclick={() => { q = ''; visibleInput()?.focus(); }}
          >
            <Icon name="x" size={14} />
          </button>
        {/if}
      </div>
      <button
        type="button"
        class="min-h-[44px] shrink-0 px-2 text-[17px] font-medium text-brand active:opacity-60"
        onclick={close}
      >
        Cancel
      </button>
    </div>

    {#if error}
      <div class="mx-3 mb-2 rounded-[10px] bg-tag-sales/30 px-3 py-2 text-[13px] text-tag-salesText">
        {error}
      </div>
    {/if}

    <!-- Results list. overscroll-contain stops body bounce; pb-safe pads
         home indicator. The list takes the rest of the viewport so the
         keyboard sits beneath it cleanly. -->
    <ul
      bind:this={listEl}
      class="flex-1 overflow-y-auto overscroll-contain pb-safe"
    >
      {#if loading && resultCount === 0}
        <!-- iOS-style skeleton rows so the UI never freezes -->
        {#each [0, 1, 2] as i (i)}
          <li class="flex items-center gap-3 px-4 py-3">
            <div class="h-9 w-9 shrink-0 animate-pulse rounded-[10px] bg-surface-hover"></div>
            <div class="flex-1 space-y-2">
              <div class="h-3.5 w-2/5 animate-pulse rounded-full bg-surface-hover"></div>
              <div class="h-2.5 w-1/4 animate-pulse rounded-full bg-surface-hover/70"></div>
            </div>
          </li>
        {/each}
      {:else}
        {#each grouped as section, sIdx (section.label + sIdx)}
          {#if section.items.length > 0}
            <li class="px-4 pb-1 pt-5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-300">
              {section.label}
            </li>
            {#each section.items as r (r.kind + ':' + ('id' in r ? r.id : 'target' in r ? r.target : ''))}
              {@const idx = flatIndexOf(r)}
              {@const active = idx === activeIndex}
              <li data-idx={idx}>
                <button
                  type="button"
                  class="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 {active ? 'bg-brand/[0.08]' : 'active:bg-surface-hover'}"
                  onclick={() => pick(r)}
                  onmousemove={() => (activeIndex = idx)}
                >
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] {r.kind === 'person' || (r.kind === 'org' && r.logo) || (r.kind === 'project' && r.mark) ? '' : 'bg-surface-hover text-ink-500'}">
                    {#if r.kind === 'person'}
                      <Avatar name={r.title} src={assetUrl(r.avatar, { width: 56, height: 56, fit: 'cover' })} size={36} position={r.focal ?? ''} />
                    {:else if r.kind === 'org' && r.logo}
                      <Avatar name={r.title} src={assetUrl(r.logo, { width: 56, height: 56, fit: 'cover' })} size={36} position={r.focal ?? ''} />
                    {:else if r.kind === 'project' && r.mark}
                      <Avatar name={r.title} src={assetUrl(r.mark, { width: 56, height: 56, fit: 'contain' })} size={36} position="contain" />
                    {:else if r.kind === 'action'}
                      <Icon name={r.icon} size={16} />
                    {:else if r.kind === 'create'}
                      <Icon name={r.target === 'org' ? 'building' : 'users'} size={16} />
                    {:else}
                      <Icon name={kindIcon(r.kind)} size={16} />
                    {/if}
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-[17px] leading-tight text-ink-900">{r.title}</div>
                    {#if 'subtitle' in r && r.subtitle}
                      <div class="mt-0.5 truncate text-[13px] leading-tight text-ink-400">{r.subtitle}</div>
                    {/if}
                  </div>
                  <Icon name="chevron-right" size={14} class="shrink-0 text-ink-200" />
                </button>
              </li>
            {/each}
          {/if}
        {/each}

        {#if q.trim() && !loading && resultCount === 0}
          <li class="flex flex-col items-center px-8 pt-20 text-center">
            <div class="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-surface-hover">
              <Icon name="search" size={24} class="text-ink-300" />
            </div>
            <div class="text-[17px] font-medium text-ink-700">No results</div>
            <div class="mt-1 text-[14px] text-ink-400">
              Nothing matched "{q.trim()}". Try a different name or keyword.
            </div>
          </li>
        {/if}
      {/if}
    </ul>
  </div>

  <!-- ───────── Desktop: refined Apple-style card modal ───────── -->
  <button
    type="button"
    class="fixed inset-0 z-40 hidden bg-ink-900/30 backdrop-blur-md md:block"
    aria-label="Close search"
    onclick={close}
    tabindex="-1"
    transition:fade={{ duration: 150 }}
  ></button>

  <div
    class="fixed left-1/2 top-[14vh] z-50 hidden w-[min(92vw,680px)] -translate-x-1/2 md:block"
    role="dialog"
    aria-modal="true"
    aria-label="Command palette"
    tabindex="-1"
    transition:scale={{ duration: 180, easing: cubicOut, start: 0.96, opacity: 0 }}
  >
    <div
      class="overflow-hidden rounded-[16px] border border-surface-border/60 bg-surface-card shadow-[0_24px_64px_-12px_rgba(15,23,42,0.25)]"
      onkeydown={onPaletteKey}
      role="presentation"
    >
      <div class="flex items-center gap-3 border-b border-surface-divider/70 px-4 py-3.5">
        <Icon name="search" size={18} class="shrink-0 text-ink-400" />
        <input
          bind:this={desktopInputEl}
          type="text"
          autocomplete="off"
          spellcheck={false}
          placeholder="Jump to person, org, project, note…"
          class="w-full border-0 bg-transparent p-0 text-[15px] leading-tight text-ink-900 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 placeholder:text-ink-300"
          bind:value={q}
        />
        <kbd class="shrink-0 rounded-md border border-surface-border bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-400">esc</kbd>
      </div>

      {#if error}
        <div class="border-b border-surface-divider bg-tag-sales/30 px-4 py-2 text-[12px] text-tag-salesText">
          {error}
        </div>
      {/if}

      <ul class="max-h-[min(60vh,520px)] overflow-y-auto py-1.5">
        {#if loading && resultCount === 0}
          {#each [0, 1, 2] as i (i)}
            <li class="flex items-center gap-3 px-3 py-2">
              <div class="h-7 w-7 shrink-0 animate-pulse rounded-[8px] bg-surface-hover"></div>
              <div class="flex-1 space-y-1.5">
                <div class="h-3 w-1/3 animate-pulse rounded-full bg-surface-hover"></div>
                <div class="h-2.5 w-1/5 animate-pulse rounded-full bg-surface-hover/70"></div>
              </div>
            </li>
          {/each}
        {:else}
          {#each grouped as section, sIdx (section.label + sIdx)}
            {#if section.items.length > 0}
              <li class="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                {section.label}
              </li>
              {#each section.items as r (r.kind + ':' + ('id' in r ? r.id : 'target' in r ? r.target : ''))}
                {@const idx = flatIndexOf(r)}
                {@const active = idx === activeIndex}
                <li data-idx={idx}>
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-150 {active ? 'bg-brand/[0.08]' : 'hover:bg-surface-hover'}"
                    onclick={() => pick(r)}
                    onmousemove={() => (activeIndex = idx)}
                  >
                    <span class="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[8px] {r.kind === 'person' || (r.kind === 'org' && r.logo) || (r.kind === 'project' && r.mark) ? '' : 'bg-surface-hover text-ink-500'}">
                      {#if r.kind === 'person'}
                        <Avatar name={r.title} src={assetUrl(r.avatar, { width: 40, height: 40, fit: 'cover' })} size={28} position={r.focal ?? ''} />
                      {:else if r.kind === 'org' && r.logo}
                        <Avatar name={r.title} src={assetUrl(r.logo, { width: 40, height: 40, fit: 'cover' })} size={28} position={r.focal ?? ''} />
                      {:else if r.kind === 'project' && r.mark}
                        <Avatar name={r.title} src={assetUrl(r.mark, { width: 40, height: 40, fit: 'contain' })} size={28} position="contain" />
                      {:else if r.kind === 'action'}
                        <Icon name={r.icon} size={14} />
                      {:else if r.kind === 'create'}
                        <Icon name={r.target === 'org' ? 'building' : 'users'} size={14} />
                      {:else}
                        <Icon name={kindIcon(r.kind)} size={14} />
                      {/if}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-[14px] font-medium text-ink-900">{r.title}</div>
                      {#if 'subtitle' in r && r.subtitle}
                        <div class="truncate text-[12px] text-ink-400">{r.subtitle}</div>
                      {/if}
                    </div>
                    {#if active}
                      <kbd class="shrink-0 rounded border border-surface-border px-1.5 py-0.5 text-[10px] font-medium text-ink-400">↵</kbd>
                    {/if}
                  </button>
                </li>
              {/each}
            {/if}
          {/each}

          {#if q.trim() && !loading && resultCount === 0}
            <li class="flex flex-col items-center px-6 py-10 text-center">
              <div class="mb-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-surface-hover">
                <Icon name="search" size={18} class="text-ink-300" />
              </div>
              <div class="text-[14px] font-medium text-ink-700">No results</div>
              <div class="mt-0.5 text-[12px] text-ink-400">Nothing matched "{q.trim()}".</div>
            </li>
          {/if}
        {/if}
      </ul>

      <div class="flex items-center justify-between border-t border-surface-divider/70 bg-surface-hover/40 px-3 py-2 text-[11px] text-ink-400">
        <div class="flex items-center gap-3">
          <span><kbd class="rounded border border-surface-border px-1 py-0.5">↑↓</kbd> navigate</span>
          <span><kbd class="rounded border border-surface-border px-1 py-0.5">↵</kbd> open</span>
          <span><kbd class="rounded border border-surface-border px-1 py-0.5">esc</kbd> close</span>
        </div>
        {#if loading}
          <span>searching…</span>
        {:else}
          <span>{q.trim() ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'}` : 'press ⌘K anytime'}</span>
        {/if}
      </div>
    </div>
  </div>
{/if}
