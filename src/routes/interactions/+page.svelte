<script lang="ts">
  import {
    searchActivities,
    searchPeople,
    searchTags,
    personName,
    assetUrl,
    activityKindOf,
    formatError,
    type Activity,
    type ActivityKind,
    type Person,
    type Tag
  } from '$lib/directus';
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import { scope } from '$lib/scope';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let activities = $state<Activity[]>(data.activities);
  const kinds = $derived(data.kinds);
  let loading = $state(false);
  let error = $state('');

  // ─── Filter state ───────────────────────────────────────────────────────
  let q = $state('');
  let selectedKindKeys = $state<string[]>([]);
  let selectedPerson = $state<Person | null>(null);
  let selectedTags = $state<Tag[]>([]);
  let from = $state('');
  let to = $state('');

  // Person picker
  let personPickerOpen = $state(false);
  let personQ = $state('');
  let personResults = $state<Person[]>([]);
  let personTimer: ReturnType<typeof setTimeout> | null = null;
  function onPersonQuery(e: Event) {
    personQ = (e.currentTarget as HTMLInputElement).value;
    if (personTimer) clearTimeout(personTimer);
    personTimer = setTimeout(async () => {
      if (!personQ.trim()) { personResults = []; return; }
      try { personResults = (await searchPeople(personQ, 6)) as Person[]; } catch { personResults = []; }
    }, 180);
  }

  // Tag picker
  let tagPickerOpen = $state(false);
  let tagQ = $state('');
  let tagResults = $state<Tag[]>([]);
  let tagTimer: ReturnType<typeof setTimeout> | null = null;
  function queueTagSearch(v: string) {
    if (tagTimer) clearTimeout(tagTimer);
    tagTimer = setTimeout(async () => {
      try { tagResults = await searchTags(v, 12); } catch { tagResults = []; }
    }, 150);
  }
  function openTagPicker() {
    tagPickerOpen = true;
    tagQ = '';
    queueTagSearch('');
  }

  function toggleKind(key: string) {
    selectedKindKeys = selectedKindKeys.includes(key)
      ? selectedKindKeys.filter((k) => k !== key)
      : [...selectedKindKeys, key];
  }
  function pickPerson(p: Person | null) {
    selectedPerson = p;
    personPickerOpen = false;
    personQ = '';
    personResults = [];
  }
  function pickTag(t: Tag) {
    selectedTags = selectedTags.some((x) => x.id === t.id)
      ? selectedTags.filter((x) => x.id !== t.id)
      : [...selectedTags, t];
    tagQ = '';
    queueTagSearch('');
  }
  function removeTag(id: number) {
    selectedTags = selectedTags.filter((x) => x.id !== id);
  }
  function clearFilters() {
    q = '';
    selectedKindKeys = [];
    selectedPerson = null;
    selectedTags = [];
    from = '';
    to = '';
  }

  // ─── Live filter ────────────────────────────────────────────────────────
  let refetchTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const _q = q;
    const _kinds = selectedKindKeys;
    const _person = selectedPerson?.id ?? undefined;
    const _tagIds = selectedTags.map((t) => t.id);
    const _from = from;
    const _to = to;
    const _scope = $scope;
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(async () => {
      loading = true;
      error = '';
      try {
        activities = await searchActivities({
          q: _q,
          kindKeys: _kinds,
          personId: _person,
          tagIds: _tagIds,
          from: _from || undefined,
          to: _to || undefined,
          scope: _scope,
          limit: 200
        });
      } catch (e) {
        error = formatError(e);
      } finally {
        loading = false;
      }
    }, 200);
  });

  // ─── Format helpers ─────────────────────────────────────────────────────
  function fmtRelative(iso?: string | null): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const mins = Math.round((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }
  function orgOf(a: Activity) {
    return a.organization_id && typeof a.organization_id === 'object' ? a.organization_id : null;
  }
  function projOf(a: Activity) {
    return a.project_id && typeof a.project_id === 'object' ? a.project_id : null;
  }
</script>

<svelte:head>
  <title>Interactions · Hub</title>
</svelte:head>

<section class="space-y-4">
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <div class="hero-eyebrow">Interactions</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
        Everything that happened
        {#if !loading}
          <span class="ml-2 text-sm font-normal text-ink-400">{activities.length}</span>
        {/if}
      </h1>
      <p class="mt-1 text-sm text-ink-500">
        Coffees, meetings, ran-into's — anything you logged on a person, org, or project.
      </p>
    </div>
  </header>

  <!-- Search -->
  <div class="relative">
    <Icon name="search" size={16} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
    <input
      bind:value={q}
      type="text"
      placeholder="Search titles, summaries, locations…"
      class="w-full rounded-[12px] border border-surface-border bg-surface-card py-2.5 pl-9 pr-3 text-base focus:border-brand focus:outline-none sm:text-sm"
    />
  </div>

  <!-- Kind chips. We render the catalogue order (`sort`) so the most
       common kinds appear first. -->
  <div class="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1">
    {#each kinds as k (k.id)}
      {@const active = selectedKindKeys.includes(k.key)}
      <button
        type="button"
        class="inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1 text-xs font-medium transition"
        style={active
          ? `border: 1px solid ${k.color || 'var(--accent-electric)'}; background: ${(k.color || 'var(--accent-electric)')}1a; color: ${k.color || 'var(--accent-electric)'}; border-radius: var(--radius-pill);`
          : 'border: 1px solid var(--border-subtle); background: var(--bg-secondary); color: var(--text-secondary); border-radius: var(--radius-pill);'}
        onclick={() => toggleKind(k.key)}
      >
        {#if k.icon}<Icon name={k.icon as never} size={12} />{:else if k.emoji}<span aria-hidden="true">{k.emoji}</span>{/if}
        {k.label}
      </button>
    {/each}
  </div>

  <!-- Person / tag / date filters -->
  <div class="flex flex-wrap items-center gap-2 text-xs">
    {#if selectedPerson}
      <span
        class="inline-flex items-center gap-1.5 px-2 py-1"
        style="background: var(--accent-alpha-10); color: var(--accent-electric); border: 1px solid var(--accent-alpha-30); border-radius: var(--radius-pill);"
      >
        <Avatar
          name={personName(selectedPerson)}
          src={assetUrl(selectedPerson.person_picture, { width: 48, height: 48, fit: 'cover' }) ?? ''}
          size={18}
        />
        <span class="font-medium">{personName(selectedPerson)}</span>
        <button class="ml-0.5 text-ink-400 hover:text-ink-700" onclick={() => pickPerson(null)} aria-label="Clear person">
          <Icon name="plus" size={10} class="rotate-45" />
        </button>
      </span>
    {:else if !personPickerOpen}
      <button
        type="button"
        class="inline-flex items-center gap-1 px-2 py-1"
        style="border: 1px dashed var(--border-subtle); border-radius: var(--radius-pill); color: var(--text-tertiary);"
        onclick={() => (personPickerOpen = true)}
      ><Icon name="users" size={12} /> Filter by person</button>
    {/if}
    {#each selectedTags as t (t.id)}
      <span
        class="inline-flex items-center gap-1 px-2 py-1 font-medium"
        style="background: var(--accent-alpha-10); color: var(--accent-electric); border: 1px solid var(--accent-alpha-30); border-radius: var(--radius-pill);"
      >
        # {t.name}
        <button class="rounded-full p-0.5 text-ink-400 hover:text-ink-700" onclick={() => removeTag(t.id)} aria-label={`Remove ${t.name}`}>
          <Icon name="plus" size={10} class="rotate-45" />
        </button>
      </span>
    {/each}
    {#if !tagPickerOpen}
      <button
        type="button"
        class="inline-flex items-center gap-1 px-2 py-1"
        style="border: 1px dashed var(--border-subtle); border-radius: var(--radius-pill); color: var(--text-tertiary);"
        onclick={openTagPicker}
      ><Icon name="tag" size={12} /> Filter by tag</button>
    {/if}
    <label class="inline-flex items-center gap-1.5">
      <span class="text-ink-500">From</span>
      <input type="date" bind:value={from} class="rounded-md border border-surface-border bg-surface-card px-2 py-1 text-xs focus:border-brand focus:outline-none" />
    </label>
    <label class="inline-flex items-center gap-1.5">
      <span class="text-ink-500">To</span>
      <input type="date" bind:value={to} class="rounded-md border border-surface-border bg-surface-card px-2 py-1 text-xs focus:border-brand focus:outline-none" />
    </label>
    {#if q || selectedKindKeys.length || selectedPerson || selectedTags.length || from || to}
      <button class="btn-ghost text-xs" onclick={clearFilters}>Clear filters</button>
    {/if}
  </div>

  <!-- Person picker popover -->
  {#if personPickerOpen && !selectedPerson}
    <div class="p-2" style="background: var(--bg-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
      <div class="relative">
        <Icon name="search" size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          type="text"
          value={personQ}
          oninput={onPersonQuery}
          placeholder="Search people…"
          class="w-full pl-7 pr-2 py-1.5 text-sm focus:outline-none"
          style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: var(--text-primary);"
          onkeydown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              if (personQ) { personQ = ''; personResults = []; }
              else { personPickerOpen = false; }
            }
          }}
        />
      </div>
      {#if personResults.length > 0}
        <ul class="mt-1 max-h-56 overflow-auto">
          {#each personResults as p (p.id)}
            <li>
              <button
                class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
                style="border-radius: var(--radius-sm);"
                onclick={() => pickPerson(p)}
              >
                <Avatar name={personName(p)} src={assetUrl(p.person_picture, { width: 48, height: 48, fit: 'cover' }) ?? ''} size={20} />
                <span class="truncate">{personName(p)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <!-- Tag picker popover -->
  {#if tagPickerOpen}
    <div class="p-2" style="background: var(--bg-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
      <div class="relative">
        <Icon name="search" size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          type="text"
          bind:value={tagQ}
          oninput={() => queueTagSearch(tagQ)}
          placeholder="Search tags…"
          class="w-full pl-7 pr-2 py-1.5 text-sm focus:outline-none"
          style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: var(--text-primary);"
          onkeydown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              if (tagQ) { tagQ = ''; queueTagSearch(''); }
              else { tagPickerOpen = false; }
            }
          }}
        />
      </div>
      {#if tagResults.length > 0}
        <ul class="mt-1 max-h-72 overflow-y-auto">
          {#each tagResults as t (t.id)}
            {@const picked = selectedTags.some((x) => x.id === t.id)}
            <li>
              <button
                class="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
                style="border-radius: var(--radius-sm);"
                onclick={() => pickTag(t)}
              >
                <span class="truncate"># {t.name}</span>
                <span class="text-xs" style={picked ? 'color: var(--accent-electric);' : 'color: var(--text-tertiary);'}>
                  {picked ? 'selected ✓' : '+'}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if tagQ.trim()}
        <div class="px-2 py-2 text-xs text-ink-500">No matches.</div>
      {/if}
      <div class="flex justify-end pt-2">
        <button class="btn-ghost text-xs" onclick={() => (tagPickerOpen = false)}>Done</button>
      </div>
    </div>
  {/if}

  {#if error}
    <div
      class="px-3 py-2 text-xs"
      style="background: var(--bg-tertiary); color: var(--state-danger); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
    >{error}</div>
  {/if}

  <!-- Results -->
  {#if loading && activities.length === 0}
    <div class="text-sm text-ink-500">Loading…</div>
  {:else if activities.length === 0}
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card px-4 py-10 text-center text-sm text-ink-500">
      No interactions match. Try clearing filters, or log one on a person / org / project page.
    </div>
  {:else}
    <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
      {#each activities as a (a.id)}
        {@const kind = activityKindOf(a)}
        {@const org = orgOf(a)}
        {@const proj = projOf(a)}
        {@const isMajor = a.significance === 'major'}
        <li class="flex items-start gap-3 px-4 py-3">
          <span
            class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full {isMajor && !kind?.color ? 'bg-brand text-white' : !kind?.color ? 'bg-surface-hover text-ink-500' : ''}"
            style={kind?.color ? `background: ${kind.color}22; color: ${kind.color};` : ''}
            title={kind?.label ?? (a.kind as string | undefined) ?? 'Activity'}
          >
            <Icon name={(kind?.icon as never) || 'bolt'} size={14} />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <a
                href={`/interactions/${a.id}`}
                class="font-medium text-ink-900 truncate hover:text-brand"
              >{a.title || (kind?.label ?? 'Activity')}</a>
              {#if isMajor}
                <span class="inline-flex items-center px-2 py-0.5 text-[10px] font-medium" style="background: var(--accent-alpha-10); color: var(--accent-electric); border-radius: var(--radius-pill);">major</span>
              {/if}
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
              <span>{fmtRelative(a.occurred_at)}</span>
              {#if a.location}
                <span class="text-ink-300">·</span>
                <span>📍 {a.location}</span>
              {/if}
              {#if org}
                <span class="text-ink-300">·</span>
                <a href={`/orgs/${org.id}`} class="inline-flex items-center gap-1 hover:text-brand"><Icon name="building" size={11} />{org.name}</a>
              {/if}
              {#if proj}
                <span class="text-ink-300">·</span>
                <a href={`/projects/${proj.id}`} class="inline-flex items-center gap-1 hover:text-brand"><Icon name="sparkles" size={11} />{proj.name}</a>
              {/if}
            </div>
            {#if a.summary}
              <div class="mt-1 line-clamp-2 text-xs text-ink-600">{a.summary}</div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
