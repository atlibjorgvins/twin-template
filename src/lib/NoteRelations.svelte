<script lang="ts">
  // Inline picker + chip list for a note's M2A `related_to` junctions.
  // Drops in below the body editor on /notes/[id]. Each chip resolves
  // the entity's real name (and avatar / logo where applicable) so the
  // user sees "Atli Björgvinsson", not "Person #8". Clicking the body
  // of a chip navigates to the entity's detail page.
  import {
    addNoteRelation, getNoteRelations, hydrateNoteRelations, removeNoteRelation,
    searchRelatedCandidates, personName, assetUrl, formatError,
    type NoteRelation, type RelatedCandidate, type RelatedCollection,
  } from '$lib/directus';
  import Avatar from '$lib/Avatar.svelte';
  import Icon from '$lib/Icon.svelte';

  type Props = { noteId: number };
  let { noteId }: Props = $props();

  let relations = $state<NoteRelation[]>([]);
  let loading = $state(true);
  let q = $state('');
  let candidates = $state<RelatedCandidate[]>([]);
  let searching = $state(false);
  let pickerOpen = $state(false);
  let error = $state('');

  async function refresh() {
    loading = true;
    try {
      const raw = await getNoteRelations(noteId);
      relations = await hydrateNoteRelations(raw);
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => { void refresh(); });

  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    clearTimeout(timer);
    const query = q;
    if (!query.trim()) {
      candidates = [];
      return;
    }
    timer = setTimeout(async () => {
      searching = true;
      try {
        candidates = await searchRelatedCandidates(query, 6);
      } catch (e) {
        error = formatError(e);
      } finally {
        searching = false;
      }
    }, 200);
  });

  // Hide candidates already attached so the user doesn't double-add.
  const attached = $derived(
    new Set(relations.map((r) => `${r.collection}:${r.item}`)),
  );

  async function add(c: RelatedCandidate) {
    try {
      const newRel = await addNoteRelation(noteId, c.collection, c.id);
      // Refresh to get the hydrated entity (cheaper than a second
      // round-trip just for the one we added).
      relations = await hydrateNoteRelations([...relations, newRel]);
      q = '';
      candidates = [];
      pickerOpen = false;
    } catch (e) {
      error = formatError(e);
    }
  }

  async function remove(rel: NoteRelation) {
    try {
      await removeNoteRelation(rel.id);
      relations = relations.filter((r) => r.id !== rel.id);
    } catch (e) {
      error = formatError(e);
    }
  }

  // Helga-aligned chip palette: a soft accent tint for People, neutral
  // surface for everything else. Kind is shown as a small icon, not a
  // big "Org" / "Project" word, so the entity name leads.
  function chipIcon(c: RelatedCollection) {
    if (c === 'Person')       return 'users';
    if (c === 'organization') return 'building';
    if (c === 'Project')      return 'sparkles';
    return 'calendar';
  }

  function chipHref(c: RelatedCollection, item: string) {
    if (c === 'Person')       return `/people/${item}`;
    if (c === 'organization') return `/orgs/${item}`;
    if (c === 'Project')      return `/projects/${item}`;
    if (c === 'Dates')        return `/calendar/grid?event=${item}`;
    return undefined;
  }

  type ResolvedChip = {
    label: string;
    href?: string;
    avatarName?: string;
    avatarSrc?: string;
    sublabel?: string;
  };
  function resolveChip(r: NoteRelation): ResolvedChip {
    const href = chipHref(r.collection, r.item);
    if (r.entity?.type === 'Person') {
      const p = r.entity.data;
      return {
        label: personName(p) || `Person #${r.item}`,
        href,
        avatarName: personName(p),
        avatarSrc: assetUrl(p.person_picture, { width: 64, height: 64, fit: 'cover' }) ?? undefined,
      };
    }
    if (r.entity?.type === 'organization') {
      const o = r.entity.data;
      return {
        label: o.name || o.legal_name || `Org #${r.item}`,
        href,
        avatarName: o.name ?? '?',
        avatarSrc: assetUrl(o.logo, { width: 64, height: 64, fit: 'cover' }) ?? undefined,
      };
    }
    if (r.entity?.type === 'Project') {
      return { label: r.entity.data.name || `Project #${r.item}`, href };
    }
    if (r.entity?.type === 'Dates') {
      return {
        label: r.entity.data.title || `Event #${r.item}`,
        href,
        sublabel: r.entity.data.start ? new Date(r.entity.data.start).toLocaleDateString() : undefined,
      };
    }
    // Fallback for un-hydrated rows (entity was deleted at source).
    return { label: `${r.collection} #${r.item}`, href };
  }
</script>

<div class="space-y-2">
  <div class="flex items-center justify-between">
    <h2 class="card-title">
      <Icon name="tag" size={16} /> Related
    </h2>
    <button
      class="btn-ghost inline-flex items-center gap-1 text-sm"
      onclick={() => (pickerOpen = !pickerOpen)}
    >
      <Icon name="plus" size={14} />
      Add
    </button>
  </div>

  {#if error}
    <div
      class="px-3 py-1.5 text-xs"
      style="background: var(--bg-tertiary); color: var(--state-danger); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
    >{error}</div>
  {/if}

  {#if loading}
    <div class="text-xs text-ink-500">Loading…</div>
  {:else if relations.length === 0 && !pickerOpen}
    <div class="text-xs text-ink-500">No connections yet. Hit Add to link a person, org, project, or event.</div>
  {/if}

  <!-- Existing relation chips -->
  {#if relations.length > 0}
    <ul class="flex flex-wrap gap-1.5">
      {#each relations as rel (rel.id)}
        {@const chip = resolveChip(rel)}
        <li
          class="inline-flex items-center gap-1.5 px-2 py-1 text-xs"
          style="background: var(--bg-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-pill);"
        >
          {#if rel.collection === 'Person' || rel.collection === 'organization'}
            <span class="inline-flex shrink-0">
              <Avatar name={chip.avatarName ?? '?'} src={chip.avatarSrc ?? ''} size={20} />
            </span>
          {:else}
            <Icon name={chipIcon(rel.collection)} size={12} class="text-ink-400" />
          {/if}
          {#if chip.href}
            <a
              class="font-medium truncate max-w-[14rem] hover:underline"
              style="color: var(--text-primary);"
              href={chip.href}
              title={chip.label}
            >{chip.label}</a>
          {:else}
            <span class="font-medium truncate max-w-[14rem]" style="color: var(--text-primary);">{chip.label}</span>
          {/if}
          {#if chip.sublabel}
            <span class="text-ink-400">· {chip.sublabel}</span>
          {/if}
          <button
            class="ml-0.5 rounded-full p-0.5 text-ink-400 hover:bg-surface-hover hover:text-ink-700"
            aria-label="Remove relation"
            onclick={() => remove(rel)}
          >
            <Icon name="plus" size={10} class="rotate-45" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Inline picker -->
  {#if pickerOpen}
    <div
      class="p-2"
      style="background: var(--bg-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
    >
      <div class="relative">
        <Icon name="search" size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          type="text"
          bind:value={q}
          placeholder="Search people, orgs, projects, events…"
          class="w-full pl-7 pr-2 py-1.5 text-sm focus:outline-none"
          style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: var(--text-primary);"
          onkeydown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              // Esc clears the query if there is one, otherwise closes
              // the picker entirely. Two-stage Esc matches the macOS /
              // VSCode convention so the user can refine without
              // accidentally collapsing the panel.
              if (q) { q = ''; candidates = []; }
              else { pickerOpen = false; }
            }
          }}
        />
      </div>
      {#if searching}
        <div class="px-2 py-2 text-xs text-ink-500">Searching…</div>
      {:else if q.trim() && candidates.length === 0}
        <div class="px-2 py-2 text-xs text-ink-500">No matches.</div>
      {:else if candidates.length > 0}
        <ul class="mt-1 max-h-72 overflow-y-auto">
          {#each candidates as c}
            {@const isAttached = attached.has(`${c.collection}:${c.id}`)}
            <li>
              <button
                class="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-hover disabled:opacity-50"
                style="border-radius: var(--radius-sm);"
                disabled={isAttached}
                onclick={() => add(c)}
              >
                <span class="flex min-w-0 items-center gap-2">
                  <Icon name={chipIcon(c.collection)} size={12} class="text-ink-400" />
                  <span class="truncate">{c.label}</span>
                  {#if c.sublabel}
                    <span class="truncate text-xs text-ink-400">· {c.sublabel}</span>
                  {/if}
                </span>
                <span class="text-xs text-ink-400">
                  {isAttached ? 'added' : '+'}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
