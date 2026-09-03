<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import {
    listActivities,
    createActivity,
    updateActivity,
    deleteActivity,
    attachPersonToActivity,
    detachPersonFromActivity,
    getActivityPeople,
    listActivityKinds,
    activityKindOf,
    searchPeople,
    searchOrgs,
    searchProjects,
    personName,
    assetUrl,
    ACTIVITY_KINDS,
    ACTIVITY_KIND_ICON,
    type Activity,
    type ActivityKind,
    type ActivityPerson,
    type Person,
    type Organization,
    type Project
  } from '$lib/directus';
  import type { IconName } from '$lib/icon-types';

  type Context =
    | { kind: 'person'; personId: number; personName?: string }
    | { kind: 'organization'; orgId: number }
    | { kind: 'project'; projectId: number };

  // `openTrigger` lets an external button (e.g. an Actions menu in the
  // page hero) request that this card's "Log activity" form opens. Each
  // increment of the counter triggers one open. Implementation: parent
  // owns a `let openSig = $state(0)`, increments it, this card's effect
  // observes the change and calls openAdd().
  let { context, openTrigger = 0, onCount }: { context: Context; openTrigger?: number; onCount?: (n: number) => void } = $props();
  let lastTrigger = openTrigger;
  $effect(() => {
    if (openTrigger !== lastTrigger) {
      lastTrigger = openTrigger;
      openAdd();
    }
  });

  // ─── State ──────────────────────────────────────────────────────────────
  let activities = $state<Activity[]>([]);
  let loading = $state(true);

  // Report upward so a page can fold this card away when the record has no
  // activity at all. Re-runs after every log, so the first entry reveals it.
  $effect(() => { if (!loading) onCount?.(activities.length); });
  let kindFilter = $state<string>(''); // '' = all
  let peopleByActivity = $state<Record<number, ActivityPerson[]>>({});
  let expandedId = $state<number | null>(null);
  let error = $state('');

  // Dynamic catalogue from the ActivityKind collection. Loaded once per
  // mount; the rest of the rendering reads through `kindByKey` so a
  // missing entry just falls back to the legacy ACTIVITY_KINDS list.
  let kinds = $state<ActivityKind[]>([]);
  const kindByKey = $derived.by(() => {
    const m: Record<string, ActivityKind> = {};
    for (const k of kinds) m[k.key] = k;
    return m;
  });
  $effect(() => { void loadKinds(); });
  async function loadKinds() {
    try { kinds = await listActivityKinds(); } catch { /* keep fallback */ }
  }
  // Filter-chip source: prefer the dynamic catalogue when available.
  const filterSource = $derived(
    kinds.length > 0
      ? kinds.map((kk) => ({ value: kk.key, label: kk.label, emoji: kk.emoji ?? '' }))
      : ACTIVITY_KINDS.map((kk) => ({ value: kk.value, label: kk.label, emoji: '' }))
  );

  // ─── Add form state ─────────────────────────────────────────────────────
  let adding = $state(false);
  let creating = $state(false);
  let newTitle = $state('');
  let newKind = $state<string>('meeting');
  let newSig = $state<string>('normal');
  let newWhen = $state('');
  let newSummary = $state('');
  let newLocation = $state('');

  // Linkable other-side context (when context is "person", we let user attach an org+project; etc.)
  let newOrgId = $state<number | null>(null);
  let newOrgLabel = $state('');
  let newProjectId = $state<number | null>(null);
  let newProjectLabel = $state('');
  let newPeople = $state<{ id: number; name: string; role?: string }[]>([]);

  // pickers
  let orgQuery = $state('');
  let orgResults = $state<Organization[]>([]);
  let projectQuery = $state('');
  let projectResults = $state<Project[]>([]);
  let personQuery = $state('');
  let personResults = $state<Person[]>([]);
  let qTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Derived ────────────────────────────────────────────────────────────
  const counts = $derived.by(() => {
    const m: Record<string, number> = {};
    for (const a of activities) {
      const k = (a.kind ?? 'other') as string;
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  });
  const filtered = $derived(
    kindFilter ? activities.filter((a) => a.kind === kindFilter) : activities
  );

  // ─── Load ───────────────────────────────────────────────────────────────
  async function load() {
    loading = true;
    try {
      const filter =
        context.kind === 'person'
          ? { personId: context.personId }
          : context.kind === 'organization'
            ? { orgId: context.orgId }
            : { projectId: context.projectId };
      activities = await listActivities(filter);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void load();
  });

  // ─── Add flow ───────────────────────────────────────────────────────────
  function openAdd() {
    adding = true;
    creating = false;
    newTitle = '';
    newKind = 'meeting';
    newSig = 'normal';
    newWhen = new Date().toISOString().slice(0, 16);
    newSummary = '';
    newLocation = '';
    newOrgId = context.kind === 'organization' ? context.orgId : null;
    newOrgLabel = '';
    newProjectId = context.kind === 'project' ? context.projectId : null;
    newProjectLabel = '';
    newPeople =
      context.kind === 'person'
        ? [{ id: context.personId, name: context.personName ?? 'this person' }]
        : [];
    orgQuery = '';
    orgResults = [];
    projectQuery = '';
    projectResults = [];
    personQuery = '';
    personResults = [];
    error = '';
  }

  function debounce<F extends (...args: unknown[]) => void>(fn: F, ms = 180) {
    return (...args: Parameters<F>) => {
      if (qTimer) clearTimeout(qTimer);
      qTimer = setTimeout(() => fn(...args), ms);
    };
  }

  function onOrgQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    orgQuery = v;
    debounce(async () => {
      orgResults = v.trim() ? ((await searchOrgs(v, 8)) as Organization[]) : [];
    })();
  }
  function pickOrg(o: Organization | null) {
    newOrgId = o?.id ?? null;
    newOrgLabel = o?.name ?? '';
    orgQuery = o?.name ?? '';
    orgResults = [];
  }

  function onProjectQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    projectQuery = v;
    debounce(async () => {
      projectResults = v.trim() ? ((await searchProjects(v, 8)) as Project[]) : [];
    })();
  }
  function pickProject(p: Project | null) {
    newProjectId = p?.id ?? null;
    newProjectLabel = p?.name ?? '';
    projectQuery = p?.name ?? '';
    projectResults = [];
  }

  function onPersonQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    personQuery = v;
    debounce(async () => {
      personResults = v.trim() ? ((await searchPeople(v, 8)) as Person[]) : [];
    })();
  }
  function addPerson(p: Person) {
    if (newPeople.some((x) => x.id === p.id)) return;
    newPeople = [...newPeople, { id: p.id, name: personName(p) }];
    personQuery = '';
    personResults = [];
  }
  function removePerson(id: number) {
    if (context.kind === 'person' && id === context.personId) return;
    newPeople = newPeople.filter((x) => x.id !== id);
  }

  async function submitNew() {
    if (!newTitle.trim()) {
      error = 'Title required';
      return;
    }
    if (!newWhen) {
      error = 'When required';
      return;
    }
    creating = true;
    error = '';
    try {
      // Resolve the picked kind to its row (when the dynamic catalogue is
      // loaded) so we can persist both the legacy `kind` string AND the
      // new `kind_id` FK for the transition release.
      const kindRow = kindByKey[newKind] ?? null;
      const created = await createActivity({
        title: newTitle.trim(),
        kind: newKind,
        kind_id: kindRow ? kindRow.id : null,
        significance: newSig,
        occurred_at: new Date(newWhen).toISOString(),
        summary: newSummary.trim() || null,
        location: newLocation.trim() || null,
        organization_id: newOrgId,
        project_id: newProjectId
      });
      // Attach people
      for (const p of newPeople) {
        await attachPersonToActivity(created.id, p.id, p.role ?? null);
      }
      adding = false;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }

  // ─── Inline edit / delete / expand ──────────────────────────────────────
  async function toggleExpand(a: Activity) {
    if (expandedId === a.id) {
      expandedId = null;
      return;
    }
    expandedId = a.id;
    if (!peopleByActivity[a.id]) {
      peopleByActivity = {
        ...peopleByActivity,
        [a.id]: await getActivityPeople(a.id)
      };
    }
  }

  async function bumpSignificance(a: Activity) {
    const next = a.significance === 'major' ? 'normal' : a.significance === 'normal' ? 'minor' : 'major';
    const updated = await updateActivity(a.id, { significance: next });
    activities = activities.map((x) => (x.id === a.id ? { ...x, ...updated } : x));
  }

  async function removeActivity(a: Activity) {
    if (!confirm(`Delete "${a.title}"?`)) return;
    await deleteActivity(a.id);
    activities = activities.filter((x) => x.id !== a.id);
  }

  async function detachPerson(activityId: number, junctionId: number) {
    await detachPersonFromActivity(junctionId);
    peopleByActivity = {
      ...peopleByActivity,
      [activityId]: (peopleByActivity[activityId] ?? []).filter((x) => x.id !== junctionId)
    };
  }

  // ─── Formatting ─────────────────────────────────────────────────────────
  function fmtDate(d?: string | null) {
    if (!d) return '';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(d));
    } catch {
      return d;
    }
  }
  /** Best-known display string for a kind — prefer the dynamic row's
   *  label, fall back to the legacy enum, finally the raw key. */
  function kindLabel(k?: string | null) {
    if (!k) return 'Activity';
    return (
      kindByKey[k]?.label ??
      ACTIVITY_KINDS.find((x) => x.value === k)?.label ??
      k
    );
  }
  function kindIcon(k?: string | null): IconName {
    const ic = (k && kindByKey[k]?.icon) || ACTIVITY_KIND_ICON[k ?? 'other'] || 'tag';
    return ic as IconName;
  }
  /** Emoji glyph for a kind, or empty string when none registered. */
  function kindEmoji(k?: string | null): string {
    return (k && kindByKey[k]?.emoji) || '';
  }
  /** Resolved colour for a kind. Falls back to the accent token. */
  function kindColor(k?: string | null): string {
    return (k && kindByKey[k]?.color) || '';
  }
  /** Hydrated kind row from an Activity (`kind_id` expansion) or the catalogue. */
  function activityKind(a: Activity): ActivityKind | null {
    return activityKindOf(a) ?? (a.kind ? (kindByKey[a.kind as string] ?? null) : null);
  }

  function orgOf(a: Activity): Organization | null {
    return a.organization_id && typeof a.organization_id === 'object'
      ? (a.organization_id as Organization)
      : null;
  }
  function projOf(a: Activity): Project | null {
    return a.project_id && typeof a.project_id === 'object' ? (a.project_id as Project) : null;
  }
  function personOf(ap: ActivityPerson): Person | null {
    return ap.person_id && typeof ap.person_id === 'object' ? (ap.person_id as Person) : null;
  }
</script>

<div class="card">
  <div class="card-header flex-wrap gap-2">
    <span class="card-title">
      <Icon name="calendar" size={16} /> Activities
      <span class="text-ink-300 font-normal">{activities.length}</span>
    </span>
    <button
      class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
      onclick={openAdd}
    >
      <Icon name="plus" size={14} /> Log
    </button>
  </div>

  <!-- Filter chips -->
  {#if activities.length > 0}
    <div class="flex flex-wrap gap-1.5 px-4 pb-2 text-xs">
      <button
        class="rounded-full px-2.5 py-1 {kindFilter === ''
          ? 'bg-brand text-white'
          : 'bg-surface-hover text-ink-600 hover:bg-surface-divider'}"
        onclick={() => (kindFilter = '')}
      >
        All <span class="opacity-70">{activities.length}</span>
      </button>
      {#each filterSource as k}
        {#if counts[k.value]}
          <button
            class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 {kindFilter === k.value
              ? 'bg-brand text-white'
              : 'bg-surface-hover text-ink-600 hover:bg-surface-divider'}"
            onclick={() => (kindFilter = kindFilter === k.value ? '' : k.value)}
          >
            <Icon name={kindIcon(k.value)} size={12} />
            {k.label}
            <span class="opacity-70">{counts[k.value]}</span>
          </button>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Add form -->
  {#if adding}
    <div
      class="mx-4 mb-3 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3 space-y-3"
      onkeydown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); adding = false; }
      }}
      role="presentation"
      tabindex="-1"
    >
      <div class="text-xs font-medium text-ink-700">Log a new activity</div>

      <label class="block">
        <span class="block text-xs text-ink-400 mb-1">Title</span>
        <input
          type="text"
          class="input w-full"
          placeholder='e.g. "Mentored Gulleggið team"'
          bind:value={newTitle}
        />
      </label>

      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Kind</span>
          <select class="input w-full" bind:value={newKind}>
            {#if kinds.length > 0}
              {#each kinds as k (k.id)}
                <option value={k.key}>{k.emoji ? `${k.emoji} ` : ''}{k.label}</option>
              {/each}
            {:else}
              {#each ACTIVITY_KINDS as k}
                <option value={k.value}>{k.label}</option>
              {/each}
            {/if}
          </select>
        </label>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Significance</span>
          <select class="input w-full" bind:value={newSig}>
            <option value="minor">Minor</option>
            <option value="normal">Normal</option>
            <option value="major">Major</option>
          </select>
        </label>
        <label class="block col-span-2">
          <span class="block text-xs text-ink-400 mb-1">When</span>
          <input type="datetime-local" class="input w-full" bind:value={newWhen} />
        </label>
        <label class="block col-span-2">
          <span class="block text-xs text-ink-400 mb-1">Location (optional)</span>
          <input type="text" class="input w-full" bind:value={newLocation} />
        </label>
      </div>

      <!-- Org picker (hidden when context = org) -->
      {#if context.kind !== 'organization'}
        <div class="relative">
          <label class="block text-xs text-ink-400 mb-1" for="act-org">Organization</label>
          <input
            id="act-org"
            type="text"
            autocomplete="off"
            class="input w-full"
            placeholder="Search orgs…"
            value={orgQuery}
            oninput={onOrgQuery}
          />
          {#if orgResults.length > 0}
            <ul
              class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card"
            >
              {#each orgResults as o (o.id)}
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
                    onclick={() => pickOrg(o)}
                  >
                    <Icon name="building" size={14} />
                    <span class="truncate">{o.name}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if newOrgId}
            <div class="mt-1 text-xs text-ink-500">
              Linked: <span class="font-medium text-ink-900">{newOrgLabel || `#${newOrgId}`}</span>
              <button class="ml-2 text-ink-400 hover:text-ink-700" onclick={() => pickOrg(null)}>
                clear
              </button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Project picker (hidden when context = project) -->
      {#if context.kind !== 'project'}
        <div class="relative">
          <label class="block text-xs text-ink-400 mb-1" for="act-proj">Project</label>
          <input
            id="act-proj"
            type="text"
            autocomplete="off"
            class="input w-full"
            placeholder="Search projects…"
            value={projectQuery}
            oninput={onProjectQuery}
          />
          {#if projectResults.length > 0}
            <ul
              class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card"
            >
              {#each projectResults as p (p.id)}
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
                    onclick={() => pickProject(p)}
                  >
                    <Icon name="sparkles" size={14} />
                    <span class="truncate">{p.name}</span>
                    {#if p.kind}<span class="ml-auto text-xs text-ink-400">{p.kind}</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if newProjectId}
            <div class="mt-1 text-xs text-ink-500">
              Linked: <span class="font-medium text-ink-900">{newProjectLabel || `#${newProjectId}`}</span>
              <button class="ml-2 text-ink-400 hover:text-ink-700" onclick={() => pickProject(null)}>
                clear
              </button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- People (always shown; pre-seeded with current person if context=person) -->
      <div class="relative">
        <label class="block text-xs text-ink-400 mb-1" for="act-people">People</label>
        {#if newPeople.length > 0}
          <div class="mb-1.5 flex flex-wrap gap-1.5">
            {#each newPeople as p (p.id)}
              <span
                class="inline-flex items-center gap-1 rounded-full bg-brand/10 text-brand-700 px-2 py-0.5 text-xs"
              >
                {p.name}
                {#if !(context.kind === 'person' && p.id === context.personId)}
                  <button
                    type="button"
                    class="text-ink-400 hover:text-tag-salesText"
                    onclick={() => removePerson(p.id)}
                    aria-label="Remove"
                  >×</button>
                {/if}
              </span>
            {/each}
          </div>
        {/if}
        <input
          id="act-people"
          type="text"
          autocomplete="off"
          class="input w-full"
          placeholder="Add another person…"
          value={personQuery}
          oninput={onPersonQuery}
        />
        {#if personResults.length > 0}
          <ul
            class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card"
          >
            {#each personResults as p (p.id)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
                  onclick={() => addPerson(p)}
                >
                  <Icon name="users" size={14} />
                  <span class="truncate">{personName(p)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <label class="block">
        <span class="block text-xs text-ink-400 mb-1">Summary</span>
        <textarea
          class="input w-full"
          rows="3"
          placeholder="What happened? What's the follow-up?"
          bind:value={newSummary}
        ></textarea>
      </label>

      {#if error}
        <div class="text-xs text-tag-salesText">{error}</div>
      {/if}

      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost" onclick={() => (adding = false)} disabled={creating}>Cancel</button>
        <button class="btn-primary" onclick={submitNew} disabled={creating || !newTitle.trim()}>
          {creating ? 'Saving…' : 'Log activity'}
        </button>
      </div>
    </div>
  {/if}

  <!-- List -->
  {#if loading}
    <div class="px-4 pb-4 text-sm text-ink-400">Loading…</div>
  {:else if activities.length === 0 && !adding}
    <div class="px-4 pb-4 text-sm text-ink-400">
      No activities logged yet. Capture meetings, calls, and major moments to build a real record.
    </div>
  {:else}
    <ul class="space-y-2 px-4 pb-4">
      {#each filtered as a (a.id)}
        {@const org = orgOf(a)}
        {@const proj = projOf(a)}
        {@const isMajor = a.significance === 'major'}
        {@const expanded = expandedId === a.id}
        {@const color = kindColor(a.kind as string | null | undefined)}
        <li
          class="rounded-[10px] border bg-surface-card p-3 {isMajor
            ? 'border-brand/50 ring-1 ring-brand/20'
            : 'border-surface-divider'}"
        >
          <div class="flex items-start gap-3">
            <span
              class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full {isMajor && !color
                ? 'bg-brand text-white'
                : !color ? 'bg-surface-hover text-ink-500' : ''}"
              style={color ? `background: ${color}22; color: ${color};` : ''}
              title={kindLabel(a.kind)}
            >
              <Icon name={kindIcon(a.kind)} size={14} />
            </span>
            <button
              type="button"
              class="min-w-0 flex-1 text-left"
              onclick={() => toggleExpand(a)}
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-ink-900 truncate">{a.title}</span>
                <TagPill tone={isMajor ? 'online' : 'neutral'}>{kindLabel(a.kind)}</TagPill>
                {#if isMajor}<TagPill tone="sales">major</TagPill>{/if}
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
                <span>{fmtDate(a.occurred_at)}</span>
                {#if a.location}
                  <span class="text-ink-300">·</span>
                  <span>{a.location}</span>
                {/if}
                {#if org && context.kind !== 'organization'}
                  <span class="text-ink-300">·</span>
                  <a href={`/orgs/${org.id}`} class="hover:text-brand inline-flex items-center gap-1" onclick={(e) => e.stopPropagation()}>
                    <Icon name="building" size={11} />{org.name}
                  </a>
                {/if}
                {#if proj && context.kind !== 'project'}
                  <span class="text-ink-300">·</span>
                  <a href={`/projects/${proj.id}`} class="hover:text-brand inline-flex items-center gap-1" onclick={(e) => e.stopPropagation()}>
                    <Icon name="sparkles" size={11} />{proj.name}
                  </a>
                {/if}
              </div>
              {#if a.summary && !expanded}
                <div class="mt-1 line-clamp-2 text-xs text-ink-600">{a.summary}</div>
              {/if}
            </button>
            <div class="flex shrink-0 items-center gap-1">
              <button
                class="rounded p-1 text-ink-400 hover:bg-surface-hover hover:text-brand"
                onclick={() => bumpSignificance(a)}
                title="Cycle significance"
                aria-label="Cycle significance"
              >
                <Icon name="bolt" size={14} />
              </button>
              <button
                class="rounded p-1 text-ink-400 hover:bg-surface-hover hover:text-tag-salesText"
                onclick={() => removeActivity(a)}
                title="Delete"
                aria-label="Delete"
              >×</button>
            </div>
          </div>

          {#if expanded}
            <div class="mt-2 border-t border-surface-divider pt-2 space-y-2">
              {#if a.summary}
                <div class="text-sm text-ink-700 whitespace-pre-wrap">{a.summary}</div>
              {/if}
              {#if peopleByActivity[a.id]?.length}
                <div>
                  <div class="text-xs text-ink-400 mb-1">People</div>
                  <ul class="flex flex-wrap gap-2">
                    {#each peopleByActivity[a.id] as ap (ap.id)}
                      {@const p = personOf(ap)}
                      {#if p}
                        <li
                          class="inline-flex items-center gap-1.5 rounded-full border border-surface-divider bg-surface-hover/60 pl-1 pr-2 py-0.5 text-xs"
                        >
                          <Avatar
                            name={personName(p)}
                            src={assetUrl(p.person_picture, { width: 36, height: 36, fit: 'cover' })}
                            size={18}
                            position={p.image_focal ?? ''}
                          />
                          <a href={`/people/${p.id}`} class="hover:text-brand truncate">{personName(p)}</a>
                          {#if ap.role}<span class="text-ink-400">· {ap.role}</span>{/if}
                          {#if !(context.kind === 'person' && p.id === context.personId)}
                            <button
                              class="text-ink-400 hover:text-tag-salesText"
                              onclick={() => detachPerson(a.id, ap.id)}
                              aria-label="Remove"
                            >×</button>
                          {/if}
                        </li>
                      {/if}
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
