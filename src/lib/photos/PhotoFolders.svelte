<script lang="ts">
  // Virtual folder browser — an "old-school folders" view over the photo
  // library, built entirely from existing data (no real folders):
  //   project tree (parent_id) → child projects + the project's events
  //   → photos tagged to that project / event.
  // Breadcrumb to climb back up. The navigator's star filter is carried
  // through to every photo grid.
  import { listProjectsForTree } from '$lib/directus';
  import { listEventsForProject, listEventProjectMap, type LinkedEvent } from '$lib/events/data';
  import { listPhotoLinks, type PhotoLinkRow } from '$lib/photos/explore';
  import { assetThumbUrl, type ImmichAsset } from '$lib/immich';
  import PhotoGrid from '$lib/photos/PhotoGrid.svelte';
  import Icon from '$lib/Icon.svelte';

  let { minRating = 0, ratedIds = new Set<string>() }: { minRating?: number; ratedIds?: Set<string> } = $props();

  type Proj = {
    id: number;
    name: string | null;
    parent_id?: { id: number } | number | null;
    color?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  };
  type Crumb = { type: 'project' | 'event'; id: number; name: string };
  type TypeFilter = 'all' | 'projects' | 'events';

  let loading = $state(true);
  let error = $state<string | null>(null);
  let projects = $state<Proj[]>([]);
  let childrenOf = $state<Record<number | 'root', Proj[]>>({ root: [] });
  // Every photo tag link (Project/event only) — folders aggregate from this.
  let links = $state<PhotoLinkRow[]>([]);

  let path = $state<Crumb[]>([]);
  let typeFilter = $state<TypeFilter>('all');
  // event id → owning project id, so event photos roll up into project folders.
  let eventProjectOf = $state<Record<number, number>>({});
  let eventsCache = $state<Record<number, LinkedEvent[]>>({});
  let shown = $state(120);

  const cur = $derived(path.length ? path[path.length - 1] : null);
  const subProjects = $derived(
    !cur
      ? (childrenOf.root ?? [])
      : cur.type === 'project'
        ? (childrenOf[cur.id] ?? []).filter((p) => p.id !== cur.id) // guard self-parent
        : []
  );
  const subEvents = $derived(cur?.type === 'project' ? (eventsCache[cur.id] ?? []) : []);
  // Type filter chips only matter when the level mixes both kinds.
  const shownProjects = $derived(typeFilter === 'events' ? [] : subProjects);
  const shownEvents = $derived(typeFilter === 'projects' ? [] : subEvents);
  const curPhotos = $derived.by(() =>
    cur
      ? assetIdsIn(cur.type === 'project' ? 'Project' : 'event', cur.id).map(
          (i) => ({ id: i, type: 'IMAGE', originalFileName: '', fileCreatedAt: '' }) as ImmichAsset
        )
      : []
  );
  const filteredPhotos = $derived(minRating > 0 ? curPhotos.filter((a) => ratedIds.has(a.id)) : curPhotos);
  const shownPhotos = $derived(filteredPhotos.slice(0, shown));

  function pid(p: Proj): number | null {
    const v = p.parent_id;
    return v && typeof v === 'object' ? v.id : ((v as number | null) ?? null);
  }

  // ── Subtree aggregation ────────────────────────────────────────────────
  // A project folder shows everything under it: photos tagged to the
  // project itself, its child projects (recursively), and their events.
  // Events are leaves. All computed client-side from `links`.
  function descProjectIds(rootId: number): Set<number> {
    const seen = new Set<number>();
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const c of childrenOf[id] ?? []) stack.push(c.id);
    }
    return seen;
  }
  /** Links inside a folder's subtree, own-entity links first, then newest first. */
  function linksIn(type: 'Project' | 'event', id: number): PhotoLinkRow[] {
    if (type === 'event')
      return links.filter((l) => l.collection === 'event' && l.item_id === id).sort((a, b) => b.id - a.id);
    const projIds = descProjectIds(id);
    return links
      .filter(
        (l) =>
          (l.collection === 'Project' && projIds.has(l.item_id)) ||
          (l.collection === 'event' && projIds.has(eventProjectOf[l.item_id]))
      )
      .sort((a, b) => {
        const aOwn = a.collection === 'Project' && a.item_id === id ? 1 : 0;
        const bOwn = b.collection === 'Project' && b.item_id === id ? 1 : 0;
        return bOwn - aOwn || b.id - a.id;
      });
  }
  /** Unique asset ids in a folder (subtree-wide for projects). */
  function assetIdsIn(type: 'Project' | 'event', id: number): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const l of linksIn(type, id)) {
      if (seen.has(l.asset_id)) continue;
      seen.add(l.asset_id);
      out.push(l.asset_id);
    }
    return out;
  }
  function countOf(type: 'Project' | 'event', id: number): number {
    return assetIdsIn(type, id).length;
  }
  function coverOf(type: 'Project' | 'event', id: number): string | null {
    const s = linksIn(type, id)[0]?.asset_id;
    return s ? assetThumbUrl(s) : null;
  }
  /** Year (from start/end date) for the meta line — skipped when the
   *  name already carries it ("Startup SuperNova 2024"). */
  function yearFor(name: string | null | undefined, ...dates: Array<string | null | undefined>): string | null {
    const d = dates.find(Boolean);
    if (!d) return null;
    const y = String(new Date(d as string).getFullYear());
    if (y === 'NaN' || name?.includes(y)) return null;
    return y;
  }

  $effect(() => void load());
  let loaded = false;
  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const [tree, allLinks, epMap] = await Promise.all([
        listProjectsForTree(),
        listPhotoLinks(),
        listEventProjectMap()
      ]);
      eventProjectOf = epMap;
      projects = tree as Proj[];
      const by: Record<number | 'root', Proj[]> = { root: [] };
      for (const p of tree as Proj[]) {
        const k = pid(p) ?? 'root';
        (by[k] ??= []).push(p);
      }
      childrenOf = by;
      links = allLinks.filter((l) => l.collection === 'Project' || l.collection === 'event');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function openProject(p: Proj) {
    path = [...path, { type: 'project', id: p.id, name: p.name ?? `#${p.id}` }];
    shown = 120;
    if (!eventsCache[p.id]) {
      try {
        eventsCache = { ...eventsCache, [p.id]: await listEventsForProject(p.id) };
      } catch { /* leave empty */ }
    }
  }
  function openEvent(e: LinkedEvent) {
    path = [...path, { type: 'event', id: e.id, name: e.name ?? `#${e.id}` }];
    shown = 120;
  }
  function crumbTo(i: number) {
    path = path.slice(0, i + 1); // i = -1 → root
    shown = 120;
  }

  // Re-pull links after a tag/rate change — everything else derives.
  async function refresh() {
    try {
      const all = await listPhotoLinks();
      links = all.filter((l) => l.collection === 'Project' || l.collection === 'event');
    } catch { /* ignore */ }
  }
</script>

<div class="card">
  <!-- Breadcrumb -->
  <div class="card-header flex-wrap gap-y-1">
    <div class="flex flex-wrap items-center gap-1 text-sm">
      <button type="button" class="inline-flex items-center gap-1 font-medium {cur ? 'text-brand hover:underline' : 'text-ink-900'}" onclick={() => crumbTo(-1)}>
        <Icon name="layers" size={15} /> Folders
      </button>
      {#each path as c, i (c.type + c.id)}
        <Icon name="chevron-right" size={13} class="text-ink-300" />
        <button type="button" class="min-w-0 break-words text-left font-medium {i === path.length - 1 ? 'text-ink-900' : 'text-brand hover:underline'}" onclick={() => crumbTo(i)}>{c.name}</button>
      {/each}
    </div>
  </div>

  {#if loading}
    <div class="p-6 text-sm text-ink-400">Loading folders…</div>
  {:else if error}
    <div class="m-4 rounded-[10px] border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
  {:else}
    <div class="space-y-4 p-4">
      <!-- Sub-folders -->
      {#if subProjects.length || subEvents.length}
        {#if subProjects.length && subEvents.length}
          <div class="flex flex-wrap items-center gap-1.5">
            {#each [{ v: 'all', label: 'All' }, { v: 'projects', label: `Projects · ${subProjects.length}` }, { v: 'events', label: `Events · ${subEvents.length}` }] as f (f.v)}
              <button
                type="button"
                class="rounded-full border px-2.5 py-1 text-xs font-medium transition {typeFilter === f.v
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-surface-border bg-surface-card text-ink-500 hover:bg-surface-hover'}"
                onclick={() => (typeFilter = f.v as TypeFilter)}
              >{f.label}</button>
            {/each}
          </div>
        {/if}
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {#each shownProjects as p (p.id)}
            {@const n = countOf('Project', p.id)}
            {@const y = yearFor(p.name, p.start_date, p.end_date)}
            <button type="button" class="group flex items-start gap-2 rounded-[10px] border border-surface-border bg-surface-card p-2 text-left transition hover:bg-surface-hover" title={p.name} onclick={() => openProject(p)}>
              <span class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px]" style="background: var(--bg-tertiary);">
                {#if coverOf('Project', p.id)}<img src={coverOf('Project', p.id)} alt="" class="h-full w-full object-cover" loading="lazy" />{:else}<Icon name="sparkles" size={16} class="text-ink-400" />{/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="line-clamp-2 break-words text-sm font-medium leading-snug text-ink-900">{p.name}</span>
                <span class="block text-[11px] text-ink-400">Project{y ? ` · ${y}` : ''}{n ? ` · ${n} photo${n === 1 ? '' : 's'}` : ''}</span>
              </span>
              <Icon name="chevron-right" size={14} class="mt-1 shrink-0 text-ink-300" />
            </button>
          {/each}
          {#each shownEvents as e (e.id)}
            {@const n = countOf('event', e.id)}
            {@const y = yearFor(e.name, e.start)}
            <button type="button" class="group flex items-start gap-2 rounded-[10px] border border-surface-border bg-surface-card p-2 text-left transition hover:bg-surface-hover" title={e.name} onclick={() => openEvent(e)}>
              <span class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px]" style="background: var(--bg-tertiary);">
                {#if coverOf('event', e.id)}<img src={coverOf('event', e.id)} alt="" class="h-full w-full object-cover" loading="lazy" />{:else}<Icon name="flag" size={16} class="text-ink-400" />{/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="line-clamp-2 break-words text-sm font-medium leading-snug text-ink-900">{e.name}</span>
                <span class="block text-[11px] text-ink-400">Event{y ? ` · ${y}` : ''}{n ? ` · ${n} photo${n === 1 ? '' : 's'}` : ''}</span>
              </span>
              <Icon name="chevron-right" size={14} class="mt-1 shrink-0 text-ink-300" />
            </button>
          {/each}
        </div>
        {#if shownProjects.length === 0 && shownEvents.length === 0}
          <p class="text-sm text-ink-400">Nothing matches this type filter here.</p>
        {/if}
      {/if}

      <!-- Photos at this level -->
      {#if cur}
        <div>
          <div class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            Photos in {cur.name}
            {#if filteredPhotos.length}<span class="text-ink-300">· {filteredPhotos.length}{minRating > 0 ? ` (${minRating}★+)` : ''}</span>{/if}
          </div>
          {#if curPhotos.length === 0}
            <p class="text-sm text-ink-400">No photos in this folder{cur.type === 'project' ? ' or its sub-folders' : ''} yet.</p>
          {:else if filteredPhotos.length === 0}
            <p class="text-sm text-ink-400">None of these are rated {minRating}★ or higher.</p>
          {:else}
            <PhotoGrid
              assets={shownPhotos}
              total={filteredPhotos.length}
              onMore={shown < filteredPhotos.length ? () => (shown += 120) : null}
              taggable
              onTagsChanged={refresh}
            />
          {/if}
        </div>
      {:else if subProjects.length === 0}
        <p class="text-sm text-ink-400">No projects yet.</p>
      {/if}
    </div>
  {/if}
</div>
