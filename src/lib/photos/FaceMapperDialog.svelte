<script lang="ts">
  // Detailed face mapper — for when you know the face and the relation
  // but not the name. The cluster's photos sit on top; below, filter by
  // organization or project to surface the people linked to it, then
  // pick the match. Full-screen, same shell as the photo lightbox.
  import Icon from '$lib/Icon.svelte';
  import {
    assetThumbUrl,
    personThumbUrl,
    searchImmichAssets,
    type ImmichAsset,
    type ImmichPerson
  } from '$lib/immich';
  import {
    assetUrl,
    getOrgPeople,
    getProjectPeople,
    personName,
    searchOrgs,
    searchProjects,
    type Organization,
    type Person,
    type Project
  } from '$lib/directus';

  let {
    cluster,
    onClose,
    onMap
  }: {
    cluster: ImmichPerson;
    onClose: () => void;
    /** Parent persists the mapping + refreshes; we just hand over the
     *  chosen Person. Resolve so we can close on success. */
    onMap: (person: Person) => void | Promise<void>;
  } = $props();

  // ── Face photos on top ──────────────────────────────────────────
  let faces = $state<ImmichAsset[]>([]);
  $effect(() => {
    const id = cluster.id;
    searchImmichAssets({ personIds: [id], page: 1, size: 12 })
      .then((r) => {
        if (cluster.id === id) faces = r.items;
      })
      .catch(() => {});
  });

  // ── Relation filter ─────────────────────────────────────────────
  let mode = $state<'org' | 'project'>('org');
  let query = $state('');
  let entities = $state<Array<{ id: number; name: string }>>([]);
  let searching = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  // The picked org/project + its people.
  let picked = $state<{ id: number; name: string } | null>(null);
  type Candidate = { person: Person; role: string | null };
  let candidates = $state<Candidate[]>([]);
  let peopleLoading = $state(false);
  let mappingId = $state<number | null>(null);
  let error = $state<string | null>(null);

  function switchMode(m: 'org' | 'project') {
    mode = m;
    query = '';
    entities = [];
    picked = null;
    candidates = [];
  }

  function onQueryInput() {
    if (searchTimer) clearTimeout(searchTimer);
    const q = query.trim();
    if (q.length < 2) {
      entities = [];
      return;
    }
    searchTimer = setTimeout(async () => {
      searching = true;
      error = null;
      try {
        if (mode === 'org') {
          const rows = await searchOrgs(q, 12);
          entities = rows.map((o: Organization) => ({ id: o.id, name: o.name ?? `#${o.id}` }));
        } else {
          const rows = await searchProjects(q, 12);
          entities = rows.map((p: Project) => ({ id: p.id, name: p.name ?? `#${p.id}` }));
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        searching = false;
      }
    }, 250);
  }

  async function pickEntity(e: { id: number; name: string }) {
    picked = e;
    entities = [];
    query = '';
    candidates = [];
    peopleLoading = true;
    error = null;
    try {
      if (mode === 'org') {
        const rows = await getOrgPeople(e.id);
        candidates = rows
          .map((r) => ({
            person: (typeof r.person_id === 'object' ? r.person_id : null) as Person | null,
            role: r.role ?? null
          }))
          .filter((c): c is Candidate => !!c.person);
      } else {
        const rows = await getProjectPeople(e.id);
        candidates = rows
          .map((r) => ({
            person: (typeof r.person_id === 'object' ? r.person_id : null) as Person | null,
            role: r.role_in_project ?? null
          }))
          .filter((c): c is Candidate => !!c.person);
      }
      // De-dupe (a person can hold more than one role) keeping the first.
      const seen = new Set<number>();
      candidates = candidates.filter((c) =>
        seen.has(c.person.id) ? false : (seen.add(c.person.id), true)
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      peopleLoading = false;
    }
  }

  async function choose(c: Candidate) {
    mappingId = c.person.id;
    error = null;
    try {
      await onMap(c.person);
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      mappingId = null;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label="Map this face">
  <!-- Header -->
  <div class="flex items-center justify-between gap-3 p-3 text-white/80">
    <div class="min-w-0 text-xs">
      <div class="font-medium text-white">Who is this?</div>
      <div>Find them by an organization or project they belong to.</div>
    </div>
    <button
      type="button"
      class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-white/10"
      onclick={onClose}
      aria-label="Close"
    >
      <Icon name="x" size={18} />
    </button>
  </div>

  <!-- Face photos -->
  <div class="flex shrink-0 items-center gap-2 overflow-x-auto px-3 pb-3">
    <img
      src={personThumbUrl(cluster.id)}
      alt=""
      class="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-white/30"
    />
    {#each faces as a (a.id)}
      <img
        src={assetThumbUrl(a.id)}
        alt=""
        loading="lazy"
        class="h-20 w-20 shrink-0 rounded-[8px] object-cover ring-1 ring-white/10"
      />
    {/each}
  </div>

  <!-- Relation picker -->
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-surface-card/95 p-4">
    <div class="inline-flex w-fit rounded-[8px] border border-surface-border p-0.5 text-xs" role="tablist" aria-label="Filter by">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'org'}
        class="cursor-pointer rounded-[6px] px-3 py-1.5 font-medium transition-colors {mode === 'org' ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-700'}"
        onclick={() => switchMode('org')}
      >By organization</button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'project'}
        class="cursor-pointer rounded-[6px] px-3 py-1.5 font-medium transition-colors {mode === 'project' ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-700'}"
        onclick={() => switchMode('project')}
      >By project</button>
    </div>

    {#if error}
      <div class="rounded-[8px] border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
    {/if}

    {#if !picked}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="search"
        class="input w-full text-sm"
        placeholder={mode === 'org' ? 'Search organizations…' : 'Search projects…'}
        bind:value={query}
        oninput={onQueryInput}
        autofocus
      />
      {#if searching}
        <div class="text-xs text-ink-400">Searching…</div>
      {:else if entities.length > 0}
        <ul class="divide-y divide-surface-divider rounded-[10px] border border-surface-border bg-surface-card">
          {#each entities as e (e.id)}
            <li>
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
                onclick={() => pickEntity(e)}
              >
                <Icon name={mode === 'org' ? 'building' : 'sparkles'} size={14} class="shrink-0 text-ink-400" />
                <span class="truncate">{e.name}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if query.trim().length >= 2}
        <div class="text-xs text-ink-400">No matches.</div>
      {:else}
        <div class="text-xs text-ink-400">
          Type the name of {mode === 'org' ? 'an organization' : 'a project'} this person is connected to.
        </div>
      {/if}
    {:else}
      <!-- Picked entity → its people -->
      <div class="flex items-center gap-2 text-sm">
        <span class="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
          <Icon name={mode === 'org' ? 'building' : 'sparkles'} size={12} />
          {picked.name}
        </span>
        <button type="button" class="btn-ghost text-xs" onclick={() => { picked = null; candidates = []; }}>change</button>
      </div>

      {#if peopleLoading}
        <div class="text-xs text-ink-400">Loading people…</div>
      {:else if candidates.length === 0}
        <div class="text-xs text-ink-400">No people linked to {picked.name}.</div>
      {:else}
        <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {#each candidates as c (c.person.id)}
            <li>
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border border-surface-border bg-surface-card px-3 py-2 text-left transition hover:bg-surface-hover disabled:opacity-50"
                disabled={mappingId !== null}
                onclick={() => choose(c)}
              >
                {#if c.person.person_picture}
                  <img src={assetUrl(c.person.person_picture, { width: 80, height: 80, fit: 'cover' })} alt="" class="h-10 w-10 shrink-0 rounded-full object-cover" />
                {:else}
                  <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-hover text-ink-300">
                    <Icon name="users" size={16} />
                  </span>
                {/if}
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-ink-900">{personName(c.person)}</span>
                  {#if c.role}<span class="block truncate text-xs text-ink-400">{c.role}</span>{/if}
                </span>
                {#if mappingId === c.person.id}
                  <span class="ml-auto text-xs text-ink-400">Mapping…</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>
