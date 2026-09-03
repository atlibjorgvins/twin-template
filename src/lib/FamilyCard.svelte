<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import FamilyTree from '$lib/FamilyTree.svelte';
  import {
    searchPeople,
    createPerson,
    createFamilyRelation,
    removeFamilyRelation,
    updateFamilyRelation,
    updatePerson,
    sexFromRelation,
    personName,
    assetUrl,
    FAMILY_OPTIONS,
    FAMILY_LABEL,
    formatError,
    type FamilyEdge,
    type Person
  } from '$lib/directus';

  let {
    edges = $bindable([] as FamilyEdge[]),
    personId,
    viewer,
    openTrigger = 0
  }: { edges: FamilyEdge[]; personId: number; viewer: Person; openTrigger?: number } = $props();

  // Parent increments openTrigger to ask the card to pop the add form
  // open on mount or from elsewhere on the page (e.g. an Actions menu).
  $effect(() => {
    if (openTrigger > 0) adding = true;
  });

  // List ↔ Tree view toggle, persisted per-device.
  type View = 'list' | 'tree';
  function lsView(): View {
    if (typeof localStorage === 'undefined') return 'tree';
    const v = localStorage.getItem('twin.family.view');
    // Default to the tree visualisation — the list is still one tap
    // away from the segmented control in the card header.
    return v === 'list' ? 'list' : 'tree';
  }
  let view = $state<View>(lsView());

  // Row expansion: in compact mode rows show name + a small relation chip.
  // Tapping a row expands it to reveal the relation dropdown + remove
  // button. Only one row expands at a time so the list never explodes
  // vertically on mobile. Derived edges (read-only) never expand.
  let expandedKey = $state<string | null>(null);
  function rowKey(e: FamilyEdge): string {
    return e.derivedVia ? `derived:${e.other.id}:${e.relation}` : `direct:${e.id}`;
  }
  function toggleRow(e: FamilyEdge) {
    if (e.derivedVia) return; // read-only
    const k = rowKey(e);
    expandedKey = expandedKey === k ? null : k;
  }
  $effect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('twin.family.view', view);
  });

  // --- Add relation flow ---
  let adding = $state(false);
  let query = $state('');
  let results = $state<Person[]>([]);
  let picked = $state<Person | null>(null);
  let relation = $state<string>('father');
  let notes = $state('');
  let creating = $state(false);
  let createError = $state('');
  let searched = $state(false);
  let creatingPerson = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  function openAdd() {
    adding = true;
    query = '';
    results = [];
    picked = null;
    relation = 'father';
    notes = '';
    createError = '';
  }

  function errMsg(e: unknown): string {
    if (!e) return 'Unknown error';
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    if (typeof e === 'object') {
      const anyE = e as { errors?: Array<{ message?: string }>; message?: string };
      if (anyE.errors?.length) return anyE.errors.map((x) => x.message ?? '').filter(Boolean).join('; ') || JSON.stringify(e);
      if (anyE.message) return anyE.message;
      try { return JSON.stringify(e); } catch { return String(e); }
    }
    return String(e);
  }

  function cancelAdd() {
    adding = false;
  }

  function onQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    query = v;
    picked = null;
    searched = false;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!v.trim()) { results = []; searched = false; return; }
      try {
        const rows = (await searchPeople(v, 8)) as Person[];
        results = rows.filter((p) => p.id !== personId);
        searched = true;
      } catch (e) { createError = errMsg(e); }
    }, 180);
  }

  async function createAndPick() {
    const name = query.trim();
    if (!name) return;
    creatingPerson = true;
    createError = '';
    try {
      const created = await createPerson({ full_name: name });
      pick(created);
    } catch (e) {
      createError = errMsg(e);
    } finally {
      creatingPerson = false;
    }
  }

  function pick(p: Person) {
    picked = p;
    query = personName(p);
    results = [];
  }

  async function submit() {
    if (!picked) { createError = 'Pick a person'; return; }
    creating = true;
    createError = '';
    try {
      // Row stored from viewed person's POV: relative_id IS the <relation> of person_id.
      const created = await createFamilyRelation({
        person_id: personId,
        relative_id: picked.id,
        relation,
        notes: notes.trim() || null
      });

      // Gender enrichment: a sex-specific relation implies the OTHER person's
      // sex (father → male, daughter → female, etc). Persist that on the
      // person record so the inverse side of this edge — and any other
      // family graph that touches them — reads as a specific relation via
      // the sex-aware inverse, not the lossy generic ('parent' / 'child').
      const inferredSex = sexFromRelation(relation);
      if (inferredSex && picked.gender !== inferredSex) {
        try {
          await updatePerson(picked.id, { gender: inferredSex } as Partial<Person>);
          picked.gender = inferredSex;
        } catch (err) {
          // Surface the failure — was previously swallowed which made gender
          // backfill look broken when it was just rejected by the server.
          console.warn('[family] gender backfill failed:', err);
          createError = `Relation saved, but couldn't set ${personName(picked)}'s gender: ${formatError(err)}`;
        }
      }

      edges = [
        ...edges,
        {
          id: created?.id ?? Date.now(), // server id when available, else local placeholder
          other: { ...picked, gender: inferredSex ?? picked.gender },
          relation,
          since: null,
          notes: notes.trim() || null,
          status: 'published',
          direct: true
        }
      ];
      adding = false;
    } catch (e) {
      createError = errMsg(e);
    } finally {
      creating = false;
    }
  }

  async function remove(edge: FamilyEdge) {
    if (!confirm(`Remove ${personName(edge.other)} (${FAMILY_LABEL[edge.relation] ?? edge.relation}) from family?`)) return;
    try {
      await removeFamilyRelation(edge.id);
      edges = edges.filter((e) => e.id !== edge.id);
    } catch (e) {
      createError = errMsg(e);
    }
  }

  /**
   * Inline-edit the relation label on an existing edge.
   *
   * For DIRECT edges: just patch the row's relation. The relation describes
   * the OTHER person — so if the picked relation is sex-specific (e.g.
   * 'son'), we also back-fill the OTHER person's `gender`. That gender
   * makes the inverse view (read on the other person's page) specific via
   * the sex-aware inverse — `son` of a `male` parent reads as `father`,
   * not the lossy `parent`.
   *
   * For INVERSE edges: we flip the row so it becomes direct from this
   * viewer's POV (this preserves the user's specific choice) and also write
   * the inferred sex to the OTHER person. The OTHER person's view of this
   * edge then computes via sex-aware inverse using the *viewer's* gender —
   * which the user can fill in on their own profile to make both sides
   * fully specific.
   */
  async function setRelation(edge: FamilyEdge, fromViewer: string) {
    if (!fromViewer || fromViewer === edge.relation) return;
    try {
      if (edge.direct) {
        await updateFamilyRelation(edge.id, { relation: fromViewer });
      } else {
        await updateFamilyRelation(edge.id, {
          person_id: personId,
          relative_id: edge.other.id,
          relation: fromViewer
        } as never);
      }

      // Sex-aware enrichment: if the relation implies a specific sex for the
      // other person, persist it on Person.gender. Improves the relation's
      // visibility on every other family graph that touches them.
      const inferredSex = sexFromRelation(fromViewer);
      if (inferredSex && edge.other.gender !== inferredSex) {
        try {
          await updatePerson(edge.other.id, { gender: inferredSex } as Partial<Person>);
          edge.other.gender = inferredSex;
        } catch (err) {
          console.warn('[family] gender backfill failed:', err);
          createError = `Relation updated, but couldn't set ${personName(edge.other)}'s gender: ${formatError(err)}`;
        }
      }

      edges = edges.map((e) =>
        e.id === edge.id ? { ...e, relation: fromViewer, direct: true, other: { ...e.other, gender: inferredSex ?? e.other.gender } } : e
      );
    } catch (e) {
      createError = formatError(e);
    }
  }

  // Group edges by top-level relation for display.
  const grouped = $derived.by(() => {
    const order = [
      'parent', 'father', 'mother', 'stepfather', 'stepmother',
      'child', 'son', 'daughter', 'stepchild',
      'sibling', 'brother', 'sister',
      'spouse', 'partner', 'ex_partner',
      'grandparent', 'grandfather', 'grandmother',
      'grandchild', 'grandson', 'granddaughter',
      'uncle_or_aunt', 'uncle', 'aunt',
      'nephew_or_niece', 'nephew', 'niece',
      'cousin',
      'father_in_law', 'mother_in_law', 'parent_in_law',
      'brother_in_law', 'sister_in_law', 'sibling_in_law',
      'son_in_law', 'daughter_in_law', 'child_in_law',
      'stepparent', 'in_law',
      'godparent', 'godchild',
      'other'
    ];
    const sorted = [...edges].sort((a, b) => {
      const ia = order.indexOf(a.relation); const ib = order.indexOf(b.relation);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    return sorted;
  });
</script>

<div class="card">
  <div class="card-header flex-wrap gap-2">
    <span class="card-title"><Icon name="users" size={16} /> Family <span class="text-ink-300 font-normal">{edges.length}</span></span>
    <div class="flex items-center gap-2">
      <div class="inline-flex rounded-[10px] border border-surface-border bg-surface-card p-0.5 text-[11px]" role="tablist" aria-label="View">
        <button
          class="rounded-md px-2 py-0.5 {view === 'list' ? 'bg-surface-hover text-ink-900' : 'text-ink-400'}"
          onclick={() => (view = 'list')}
          aria-selected={view === 'list'} role="tab"
        >List</button>
        <button
          class="rounded-md px-2 py-0.5 {view === 'tree' ? 'bg-surface-hover text-ink-900' : 'text-ink-400'}"
          onclick={() => (view = 'tree')}
          aria-selected={view === 'tree'} role="tab"
        >Tree</button>
      </div>
      <button
        class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
        aria-label="Add family relation"
        onclick={openAdd}
      ><Icon name="plus" size={14} /> Add</button>
    </div>
  </div>

  {#if adding}
    <!-- Esc anywhere inside the add panel cancels. The `role="presentation"` /
         tabindex="-1" combo lets us catch the key without the panel acting
         as a focus stop. -->
    <div
      class="mx-4 mb-3 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3 space-y-3"
      onkeydown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); adding = false; }
      }}
      role="presentation"
      tabindex="-1"
    >
      <div class="text-xs font-medium text-ink-700">Add family relation</div>

      <div>
        <label class="block text-xs text-ink-400 mb-1" for="rel-kind">This person is my…</label>
        <select id="rel-kind" class="input w-full" bind:value={relation}>
          {#each FAMILY_OPTIONS as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <div class="relative">
        <label class="block text-xs text-ink-400 mb-1" for="rel-person">Person</label>
        <input
          id="rel-person"
          type="text"
          autocomplete="off"
          class="input w-full"
          placeholder="Search people…"
          value={query}
          oninput={onQuery}
        />
        {#if results.length > 0}
          <ul class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
            {#each results as p (p.id)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
                  onclick={() => pick(p)}
                >
                  <Avatar name={personName(p)} src={assetUrl(p.person_picture, { width: 40, height: 40, fit: 'cover' })} size={24} />
                  <span class="truncate">{personName(p)}</span>
                  {#if p.email}<span class="ml-auto text-xs text-ink-400 truncate">{p.email}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if picked}
          <div class="mt-1 text-xs text-ink-500">Picked: <span class="font-medium text-ink-900">{personName(picked)}</span></div>
        {:else if searched && results.length === 0 && query.trim()}
          <button
            type="button"
            class="mt-1 inline-flex items-center gap-1 text-xs text-brand hover:underline disabled:opacity-60"
            onclick={createAndPick}
            disabled={creatingPerson}
          >
            <Icon name="plus" size={12} />
            {creatingPerson ? 'Creating…' : `Create "${query.trim()}" as new person`}
          </button>
        {/if}
      </div>

      <label class="block">
        <span class="block text-xs text-ink-400 mb-1">Notes (optional)</span>
        <input type="text" class="input w-full" bind:value={notes} placeholder="e.g. stepdad since 2008" />
      </label>

      {#if createError}
        <div class="text-xs text-tag-salesText">{createError}</div>
      {/if}

      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost" onclick={cancelAdd} disabled={creating}>Cancel</button>
        <button class="btn-primary" onclick={submit} disabled={creating || !picked}>
          {creating ? 'Adding…' : 'Add relation'}
        </button>
      </div>
    </div>
  {/if}

  {#if edges.length === 0 && !adding}
    <div class="px-4 pb-4 text-sm text-ink-400">
      No family relations yet. Add parents, siblings, children, spouse, etc.
    </div>
  {/if}

  {#if view === 'tree'}
    <FamilyTree {viewer} edges={grouped} />
  {:else}
  <ul class="divide-y divide-surface-divider">
    {#each grouped as edge, i (edge.derivedVia ? `derived:${edge.other.id}:${edge.relation}` : `direct:${edge.id}`)}
      {@const rk = rowKey(edge)}
      {@const isExpanded = expandedKey === rk}
      {@const editable = !edge.derivedVia}
      <li class="hover:bg-surface-hover {edge.derivedVia ? 'bg-surface-hover/30' : ''}">
        <!-- Compact row. Single line: avatar, name (+ optional via/note),
             relation chip on the right. Tapping anywhere outside the name
             link toggles the row's edit panel. The chip is a button so it
             reads as the affordance for editing. -->
        <div class="flex items-center gap-3 px-4 py-2.5">
          <a
            href={`/people/${edge.other.id}`}
            class="flex items-center gap-3 min-w-0 flex-1 hover:text-brand"
            onclick={(ev) => ev.stopPropagation()}
          >
            <Avatar name={personName(edge.other)} src={assetUrl(edge.other.person_picture, { width: 64, height: 64, fit: 'cover' })} size={36} />
            <div class="min-w-0">
              <div class="truncate font-medium text-ink-900">{personName(edge.other)}</div>
              {#if edge.derivedVia}
                <div class="truncate text-xs text-ink-400">
                  via {edge.derivedVia.name}
                  <span class="text-ink-300">({FAMILY_LABEL[edge.derivedVia.relation] ?? edge.derivedVia.relation})</span>
                </div>
              {:else if edge.notes}
                <div class="truncate text-xs text-ink-400">{edge.notes}</div>
              {:else if edge.since}
                <div class="truncate text-xs text-ink-400">since {edge.since}</div>
              {/if}
            </div>
          </a>
          {#if editable}
            <button
              type="button"
              class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium"
              style="border-radius: var(--radius-pill); background: var(--accent-alpha-10); color: var(--accent-electric); border: 1px solid var(--accent-alpha-30);"
              aria-expanded={isExpanded}
              aria-controls={`fam-edit-${rk}`}
              title={isExpanded ? 'Close editor' : 'Edit relation'}
              onclick={() => toggleRow(edge)}
            >
              <span class="truncate max-w-[8rem]">{FAMILY_LABEL[edge.relation] ?? edge.relation}</span>
              <svg
                viewBox="0 0 24 24"
                width="10"
                height="10"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                style="transition: transform var(--transition-fast); transform: rotate({isExpanded ? 180 : 0}deg);"
                aria-hidden="true"
              ><path d="m6 9 6 6 6-6"/></svg>
            </button>
          {:else}
            <TagPill tone="neutral">
              {FAMILY_LABEL[edge.relation] ?? edge.relation}
            </TagPill>
          {/if}
        </div>

        <!-- Edit panel — only renders when the row is expanded. Houses the
             dropdown to change the relation + remove button. -->
        {#if editable && isExpanded}
          <div
            id={`fam-edit-${rk}`}
            class="px-4 pb-3 pt-1 sm:pl-[3.75rem]"
            style="border-top: 1px dashed var(--border-subtle);"
          >
            <div class="flex flex-wrap items-center gap-2 pt-2">
              <label class="relative inline-flex flex-1 min-w-[10rem]">
                <select
                  class="rel-select appearance-none w-full rounded-lg border bg-surface-hover px-2.5 py-1.5 pr-7 text-sm font-medium text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
                  style="border-color: var(--border-subtle);"
                  aria-label="Change relation"
                  value={edge.relation}
                  onchange={(ev) => setRelation(edge, (ev.currentTarget as HTMLSelectElement).value)}
                >
                  {#each FAMILY_OPTIONS as opt}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                  {#if !FAMILY_OPTIONS.some((o) => o.value === edge.relation)}
                    <option value={edge.relation}>{FAMILY_LABEL[edge.relation] ?? edge.relation}</option>
                  {/if}
                </select>
                <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </span>
              </label>
              <button
                class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium"
                style="border-radius: var(--radius-md); color: var(--state-danger); border: 1px solid var(--border-subtle);"
                aria-label="Remove relation"
                title="Remove this relation"
                onclick={() => { remove(edge); expandedKey = null; }}
              ><Icon name="tag" size={14} /> Remove</button>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  {/if}
</div>
