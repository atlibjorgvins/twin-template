<script lang="ts">
  // Brand book index: pick a brand, open its book.
  //
  // Lists only owners with a brand of their OWN. Inheritance means almost
  // every project resolves to some palette, so including inherited ones
  // would turn "pick a brand" into "pick any project" — and picking KLAK's
  // palette from under a cohort's name is exactly the confusion the brand
  // book exists to remove.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import { assetUrl } from '$lib/directus';
  import { listBrandOwners, brandBookHref, type BrandOwnerSummary } from '$lib/brand';

  let all = $state<BrandOwnerSummary[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');
  let open = $state(false);
  let active = $state(0);
  let inputEl = $state<HTMLInputElement | undefined>();

  onMount(async () => {
    try {
      all = await listBrandOwners();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  });

  // ── Filter ──────────────────────────────────────────────────────────
  // "All" is the default because with orgs and projects mixed, the useful
  // question is usually "what brands exist", not "what kind of record holds
  // them". The kind chips are for when you already know.
  type Kind = 'all' | 'organization' | 'project';
  let kind = $state<Kind>('all');

  const KINDS: Array<{ value: Kind; label: string }> = [
    { value: 'all', label: 'All brands' },
    { value: 'organization', label: 'Organisations' },
    { value: 'project', label: 'Projects' }
  ];

  const counts = $derived({
    all: all.length,
    organization: all.filter((o) => o.kind === 'organization').length,
    project: all.filter((o) => o.kind === 'project').length
  });

  const filtered = $derived(kind === 'all' ? all : all.filter((o) => o.kind === kind));

  // ── Nesting ─────────────────────────────────────────────────────────
  // Branded projects form a real tree: seven of KLAK's sit under it, and
  // "Startup Landið 2025/2026" under theirs. Flat, that reads as thirteen
  // unrelated brands; nested, it reads as three families — which is what
  // they are.
  //
  // A row is a root when its parent is not itself in the filtered set. That
  // keeps every brand visible under any filter instead of orphaning children
  // whose parent was filtered out.
  // Recursive, not two-level: "Hringiða 2026" sits under "Hringiða", which
  // sits under KLAK. A flat parent→children pass silently DROPPED that
  // grandchild — twelve cards for thirteen brands — so depth is walked
  // properly and every brand is reachable.
  type Node = { owner: BrandOwnerSummary; children: Node[] };

  const tree = $derived.by<Node[]>(() => {
    const byKey = new Map(filtered.map((o) => [`${o.kind}-${o.id}`, o]));
    const childrenOf = new Map<string, BrandOwnerSummary[]>();
    const roots: BrandOwnerSummary[] = [];

    for (const o of filtered) {
      const parentKey = o.parentId != null ? `${o.kind}-${o.parentId}` : null;
      // A row is a root when its parent is not itself in the filtered set —
      // so filtering to Projects never orphans a child whose parent is an org.
      if (parentKey && byKey.has(parentKey)) {
        const arr = childrenOf.get(parentKey) ?? [];
        arr.push(o);
        childrenOf.set(parentKey, arr);
      } else {
        roots.push(o);
      }
    }

    const seen = new Set<string>();
    const build = (o: BrandOwnerSummary): Node => {
      const key = `${o.kind}-${o.id}`;
      // A parent cycle would otherwise recurse until the tab dies.
      if (seen.has(key)) return { owner: o, children: [] };
      seen.add(key);
      const kids = (childrenOf.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      return { owner: o, children: kids.map(build) };
    };
    return roots.map(build);
  });

  const matches = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? filtered.filter((o) => o.name.toLowerCase().includes(needle))
      : filtered;
    return rows.slice(0, 40);
  });

  function pick(o: BrandOwnerSummary) {
    void goto(brandBookHref(o.kind, o.id));
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); open = true; active = Math.min(active + 1, matches.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = matches[active]; if (o) pick(o); }
    else if (e.key === 'Escape') { open = false; }
  }
</script>

<svelte:head><title>Brand book · twin</title></svelte:head>

<section class="space-y-5">
  <header>
    <h1 class="font-display text-2xl font-bold tracking-tight text-ink-900">Brand book</h1>
    <p class="mt-1 text-sm text-ink-500">
      Logos, colours, type and the rules that go with them — for any organisation
      or project that has a brand of its own.
    </p>
  </header>

  <div class="card p-4">
    <label class="block">
      <span class="mb-1 block text-xs text-ink-400">Pick a brand</span>
      <div class="relative">
        <input
          bind:this={inputEl}
          type="text"
          class="input w-full"
          placeholder={loading ? 'Loading brands…' : 'Type to search…'}
          bind:value={q}
          oninput={() => { open = true; active = 0; }}
          onfocus={() => (open = true)}
          onkeydown={onKey}
          autocomplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="brand-options"
        />
        {#if open && matches.length > 0}
          <ul
            id="brand-options"
            class="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card"
          >
            {#each matches as o, i (`${o.kind}-${o.id}`)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-hover {i === active ? 'bg-surface-hover' : ''}"
                  onclick={() => pick(o)}
                  onmouseenter={() => (active = i)}
                >
                  {#if o.logoId}
                    <img
                      src={assetUrl(o.logoId, { width: 64, height: 64, fit: 'contain' })}
                      alt=""
                      class="h-6 w-6 shrink-0 rounded object-contain"
                      style="background: var(--bg-tertiary);"
                    />
                  {:else if o.primary}
                    <span class="h-6 w-6 shrink-0 rounded" style="background: {o.primary};"></span>
                  {:else}
                    <span class="h-6 w-6 shrink-0 rounded bg-surface-hover"></span>
                  {/if}
                  <span class="min-w-0 flex-1 truncate text-sm text-ink-900">{o.name}</span>
                  <span class="shrink-0 text-[10px] uppercase tracking-wider text-ink-300">
                    {o.kind === 'organization' ? 'org' : 'project'}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </label>

    {#if error}
      <p class="mt-2 text-xs" style="color: #C0392B;">{error}</p>
    {:else if !loading && all.length === 0}
      <p class="mt-2 text-xs text-ink-400">
        Nothing has a brand yet. Set a logo or a colour on an organisation or
        project and it will appear here.
      </p>
    {/if}
  </div>

  {#if !loading && all.length > 0}
    <!-- Kind filter. Counts on the chips so an empty result is obviously a
         filter and not a bug — "Organisations 0" says the migration has not
         run yet, where a blank grid would just look broken. -->
    <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter brands by kind">
      {#each KINDS as k (k.value)}
        <button
          type="button"
          role="radio"
          aria-checked={kind === k.value}
          class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition
            {kind === k.value
              ? 'border-brand bg-brand text-white'
              : 'border-surface-border bg-surface-card text-ink-700 hover:bg-surface-hover'}"
          onclick={() => { kind = k.value; active = 0; }}
        >
          {k.label}
          <span class={kind === k.value ? 'opacity-70' : 'text-ink-300'}>{counts[k.value]}</span>
        </button>
      {/each}
    </div>

    {#if tree.length === 0}
      <p class="text-sm text-ink-400">
        No {kind === 'organization' ? 'organisations' : 'projects'} have a brand of their own yet.
      </p>
    {:else}
      <!-- Families, not a flat wall. A parent's cohorts sit under it in a
           smaller grid, so thirteen brands read as the three groups they
           actually are. -->
      <div class="space-y-5">
        {#each tree as node (`${node.owner.kind}-${node.owner.id}`)}
          {@render family(node, 0)}
        {/each}
      </div>
    {/if}
  {/if}

<!-- Recursive: a family can be three deep (KLAK → Hringiða → Hringiða 2026)
     and every level has to render.

     Leaves and branches are laid out differently on purpose. Leaf children
     tile into a grid, but a child that has children of its own needs the
     full width for its own sub-block — nesting a family inside a narrow
     grid column truncated "Hringiða 2026" to "H…". -->
{#snippet family(node: Node, depth: number)}
  {@const leaves = node.children.filter((c) => c.children.length === 0)}
  {@const branches = node.children.filter((c) => c.children.length > 0)}
  <div>
    {#if depth === 0}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {@render brandCard(node.owner, false)}
      </div>
    {:else}
      <div class="max-w-[190px]">{@render brandCard(node.owner, true)}</div>
    {/if}

    {#if node.children.length > 0}
      <div class="mt-2 border-l-2 border-surface-divider pl-3 sm:pl-4">
        <div class="mb-1.5 text-[10px] uppercase tracking-wider text-ink-300">
          Under {node.owner.name} · {node.children.length}
        </div>
        {#if leaves.length > 0}
          <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {#each leaves as c (`${c.owner.kind}-${c.owner.id}`)}
              {@render brandCard(c.owner, true)}
            {/each}
          </div>
        {/if}
        {#each branches as c (`${c.owner.kind}-${c.owner.id}`)}
          <div class="mt-3">{@render family(c, depth + 1)}</div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet brandCard(o: BrandOwnerSummary, small: boolean)}
  <a
    href={brandBookHref(o.kind, o.id)}
    class="card group flex flex-col gap-2 transition hover:shadow-card {small ? 'p-2' : 'p-3'}"
  >
    <div
      class="flex items-center justify-center rounded-[10px] border border-surface-border p-2 {small ? 'h-12' : 'h-20'}"
      style="background: {o.primary ?? 'var(--bg-tertiary)'};"
    >
      {#if o.logoId}
        <img src={assetUrl(o.logoId, { width: 200, fit: 'contain' })} alt="" class="max-h-full max-w-full object-contain" />
      {:else}
        <Icon name="sparkles" size={small ? 14 : 18} />
      {/if}
    </div>
    <div class="min-w-0">
      <div class="truncate font-medium text-ink-900 {small ? 'text-xs' : 'text-sm'}">{o.name}</div>
      {#if !small}
        <div class="text-[10px] uppercase tracking-wider text-ink-300">
          {o.kind === 'organization' ? 'organisation' : 'project'}
        </div>
      {/if}
    </div>
  </a>
{/snippet}

</section>
