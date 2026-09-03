<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import EditableField from '$lib/EditableField.svelte';
  import {
    updateRole,
    createRole,
    deleteRole,
    listRoleTitles,
    searchPeople,
    createPerson,
    personName,
    assetUrl,
    formatError,
    type Person,
    type Role
  } from '$lib/directus';
  import { onMount } from 'svelte';

  let {
    roles = $bindable([] as Role[]),
    orgId
  }: { roles: Role[]; orgId: number } = $props();

  function personOf(r: Role): Person | null {
    return r.person_id && typeof r.person_id === 'object' ? (r.person_id as Person) : null;
  }

  // One card per PERSON, with every role they hold at this org listed
  // under it — so "Co-founder" and "CEO" are separate rows (matchable in
  // search) instead of one mashed title, and a second role doesn't render
  // as a duplicate person.
  type PersonGroup = { person: Person; rows: Role[] };
  const groups = $derived.by<PersonGroup[]>(() => {
    const m = new Map<number, PersonGroup>();
    for (const r of roles) {
      const p = personOf(r);
      if (!p) continue;
      const g = m.get(p.id) ?? { person: p, rows: [] };
      g.rows.push(r);
      m.set(p.id, g);
    }
    // Current-first inside each person; keep the roles array's order between people.
    for (const g of m.values()) {
      g.rows.sort((a, b) => Number(!!b.is_current) - Number(!!a.is_current));
    }
    return [...m.values()];
  });

  // Former staff fold away behind a toggle. On an org with a decade of history
  // the people who left outnumber the ones who are there, and the question the
  // card exists to answer — "who works here" — gets buried under leavers.
  //
  // `!!is_current` treats a null as former, which is safe here: every one of
  // the 1599 Person_organization rows has an explicit true/false, so there is
  // no null case to misclassify. (Project_people is the opposite — see
  // isCurrentMember — because those rows predate the tenure fields.)
  const isCurrentGroup = (g: PersonGroup) => g.rows.some((r) => !!r.is_current);
  const currentGroups = $derived(groups.filter(isCurrentGroup));
  const formerGroups = $derived(groups.filter((g) => !isCurrentGroup(g)));
  let showFormer = $state(false);

  // Shared title vocabulary — datalist so "CEO" is spelled the same
  // everywhere and title searches match across people.
  let titleOptions = $state<string[]>([]);
  onMount(async () => {
    try { titleOptions = await listRoleTitles(); } catch { /* suggestions only */ }
  });

  /** Add another role row for a person already at this org. */
  let addingRoleFor = $state<number | null>(null);
  async function addRoleFor(p: Person) {
    if (addingRoleFor) return;
    addingRoleFor = p.id;
    createError = '';
    try {
      const created = await createRole({
        person_id: p.id,
        organization_id: orgId,
        is_current: true
      } as Partial<Role> & { person_id: number; organization_id: number });
      roles = [...roles, { ...(created as Role), person_id: p }];
      expanded = { ...expanded, [(created as Role).id]: true }; // open for title entry
    } catch (e) {
      createError = formatError(e);
    } finally {
      addingRoleFor = null;
    }
  }

  let deletingId = $state<number | null>(null);
  async function removeRole(r: Role) {
    const p = personOf(r);
    if (!confirm(`Remove this ${r.role || 'untitled'} role${p ? ` for ${personName(p)}` : ''}? The person stays — only this role row is deleted.`)) return;
    deletingId = r.id;
    createError = '';
    try {
      await deleteRole(r.id);
      roles = roles.filter((x) => x.id !== r.id);
    } catch (e) {
      createError = formatError(e);
    } finally {
      deletingId = null;
    }
  }

  async function save(roleId: number, patch: Partial<Role>) {
    const updated = await updateRole(roleId, patch);
    roles = roles.map((r) =>
      r.id === roleId
        ? { ...r, ...updated, person_id: r.person_id, organization_id: r.organization_id }
        : r
    );
  }

  // --- Add person flow ---
  // One-click add: picking from search creates the role immediately with
  // sensible defaults (is_current: true, no title/dates/email). The form
  // stays open so multiple people can be added quickly. Title/dates/email
  // get filled inline on the role row that appears below.
  let adding = $state(false);
  let personQuery = $state('');
  let personResults = $state<Person[]>([]);
  let createError = $state('');
  let searched = $state(false);
  let creatingPerson = $state(false);
  let creating = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEl = $state<HTMLInputElement | null>(null);

  function openAdd() {
    adding = true;
    personQuery = '';
    personResults = [];
    searched = false;
    createError = '';
    queueMicrotask(() => inputEl?.focus());
  }

  function cancelAdd() {
    adding = false;
  }

  function onPersonQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    personQuery = v;
    searched = false;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!v.trim()) { personResults = []; searched = false; return; }
      try {
        personResults = (await searchPeople(v, 8)) as Person[];
        searched = true;
      } catch (e) { createError = formatError(e); }
    }, 180);
  }

  /** Existing-person path: pick → role created immediately, input clears. */
  async function pickPerson(p: Person) {
    creating = true;
    createError = '';
    try {
      const created = await createRole({
        person_id: p.id,
        organization_id: orgId,
        is_current: true
      } as Partial<Role> & { person_id: number; organization_id: number });
      roles = [{ ...(created as Role), person_id: p }, ...roles];
      // Clear and refocus for the next add — like the Tags picker.
      personQuery = '';
      personResults = [];
      searched = false;
      inputEl?.focus();
    } catch (e) {
      createError = formatError(e);
    } finally {
      creating = false;
    }
  }

  /** No-match path: create the Person row, then attach via pickPerson. */
  async function createAndPickPerson() {
    const name = personQuery.trim();
    if (!name) return;
    creatingPerson = true;
    createError = '';
    try {
      const created = await createPerson({ full_name: name });
      await pickPerson(created);
    } catch (e) {
      createError = formatError(e);
    } finally {
      creatingPerson = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!adding) return;
    if (e.key === 'Escape') cancelAdd();
    if (e.key === 'Enter') {
      e.preventDefault();
      // Enter behaviour mirrors TagsCard: pick the only suggestion if there's
      // exactly one, otherwise offer to create.
      if (personResults.length === 1) pickPerson(personResults[0]);
      else if (searched && personQuery.trim()) createAndPickPerson();
    }
  }

  function fmtYear(d?: string | null) {
    if (!d) return '';
    try { return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(d)); }
    catch { return d; }
  }

  // Per-role expansion: collapsed = show only populated fields; expanded =
  // show every field as an editable row (including empties).
  let expanded = $state<Record<number, boolean>>({});
  function toggleExpand(id: number) {
    expanded = { ...expanded, [id]: !expanded[id] };
  }
  function hasVal(v: unknown): boolean {
    return v != null && String(v).trim() !== '';
  }
</script>

<div class="card">
  <div class="card-header">
    <!-- The count is of people who are actually here. Former staff are counted
         on their own toggle below, not folded into a number that reads as
         headcount. -->
    <!-- Current headcount, plus a former tail when there is one. Without the
         tail an org whose staff have all left reads "People 0" while holding
         six of them behind the toggle — which looks like an empty card and
         nearly got it hidden. Mirrors RolesCard's "1 · 1 former". -->
    <span class="card-title">
      <Icon name="users" size={16} /> People
      <span class="text-ink-300 font-normal">{currentGroups.length}</span>
      {#if formerGroups.length > 0}
        <span class="text-ink-300 font-normal">· {formerGroups.length} former</span>
      {/if}
    </span>
    <button
      class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
      aria-label="Add person"
      onclick={openAdd}
    ><Icon name="plus" size={14} /> Add person</button>
  </div>

  {#if adding}
    <div class="mx-4 mb-3 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3 space-y-2">
      <div class="text-xs font-medium text-ink-700">Add a person to this organization</div>
      <div class="relative">
        <input
          bind:this={inputEl}
          id="org-person"
          type="text"
          autocomplete="off"
          class="input w-full"
          placeholder="Type a name, click to add. Done to close."
          value={personQuery}
          oninput={onPersonQuery}
          onkeydown={onKey}
          disabled={creating || creatingPerson}
        />
        {#if personResults.length > 0}
          <ul class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
            {#each personResults as p (p.id)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover disabled:opacity-50"
                  onclick={() => pickPerson(p)}
                  disabled={creating || creatingPerson}
                >
                  <Avatar name={personName(p)} src={assetUrl(p.person_picture, { width: 40, height: 40, fit: 'cover' })} size={24} position={p.image_focal ?? ''} lazy />
                  <span class="truncate">{personName(p)}</span>
                  {#if p.email}<span class="ml-auto text-xs text-ink-400 truncate">{p.email}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {:else if searched && personQuery.trim() && !creating}
          <button
            type="button"
            class="mt-1 inline-flex items-center gap-1 text-xs text-brand hover:underline disabled:opacity-60"
            onclick={createAndPickPerson}
            disabled={creatingPerson}
          >
            <Icon name="plus" size={12} />
            {creatingPerson ? 'Creating…' : `Create "${personQuery.trim()}" as new person`}
          </button>
        {/if}
      </div>

      <div class="text-[11px] leading-snug text-ink-400">
        Picks add immediately as a current role with no title — fill title, dates and work email inline on the row below.
      </div>

      {#if createError}
        <div class="text-xs text-tag-salesText">{createError}</div>
      {/if}

      <div class="flex items-center justify-end">
        <button class="btn-ghost" onclick={cancelAdd} disabled={creating || creatingPerson}>
          {creating ? 'Adding…' : 'Done'}
        </button>
      </div>
    </div>
  {/if}

  {#if roles.length === 0 && !adding}
    <div class="px-4 pb-4 text-sm text-ink-400">
      No people linked yet. Add one to capture who works here, their title, and dates.
    </div>
  {/if}

  <!-- The editable detail panel for one role. A snippet because it is now
       reached two ways: inline under a person with a single role (99% of
       them), and inside the nested list for the rare person holding several. -->
  {#snippet roleDetail(role: Role)}
          <dl class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div class="flex items-center justify-between gap-2 sm:col-span-2">
              <dt class="text-ink-400">Current role</dt>
              <dd class="min-w-0 flex-1 text-right">
                <label class="inline-flex cursor-pointer select-none items-center gap-2 text-ink-700">
                  <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand"
                    checked={!!role.is_current}
                    onchange={(e) => save(role.id, { is_current: (e.currentTarget as HTMLInputElement).checked })}
                  />
                  <span class="text-xs">{role.is_current ? 'Currently active' : 'Former role'}</span>
                </label>
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2 sm:col-span-2">
              <dt class="text-ink-400">Title</dt>
              <dd class="min-w-0 flex-1"><EditableField value={role.role} placeholder="Add title" suggestions={titleOptions} onSave={(v) => save(role.id, { role: v })} /></dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-400">Start</dt>
              <dd class="min-w-0 flex-1"><EditableField value={role.start_date} type="date" onSave={(v) => save(role.id, { start_date: v })} /></dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-400">End</dt>
              <dd class="min-w-0 flex-1"><EditableField value={role.end_date} type="date" onSave={(v) => save(role.id, { end_date: v })} /></dd>
            </div>
            <div class="flex items-center justify-between gap-2 sm:col-span-2">
              <dt class="text-ink-400">Work email</dt>
              <dd class="min-w-0 flex-1"><EditableField value={role.work_email} type="email" onSave={(v) => save(role.id, { work_email: v })} /></dd>
            </div>
            <div class="flex items-center justify-between gap-2 sm:col-span-2">
              <dt class="text-ink-400">Work phone</dt>
              <dd class="min-w-0 flex-1"><EditableField value={role.work_phone} type="phone" onSave={(v) => save(role.id, { work_phone: v })} /></dd>
            </div>
          </dl>
  {/snippet}

  <!-- One person. Rendered from a snippet so the current list and the
       collapsed former list share one implementation instead of drifting.

       Shape follows the data: 1580 of 1589 person@org pairs hold exactly ONE
       role, so that case gets a single line — name, title, actions — and the
       nested person→roles structure appears only for the nine that need it.
       Before this, every person cost a header AND a role block, printing the
       title and the current badge twice each: 116px and 22 badges for 11
       people on /orgs/2.

       No status badge on the person at all. `current` was on 95% of rows, so
       badging them marked nothing. `former` turned out no better: it fires on
       0 of 1499 groups in the current list (a person is only there if a role
       of theirs is current, and no group mixes the two), and on every single
       row of the former list, where six identical pills stacked up on Dark
       Music Days. The collapsed section's own label says "former", struck-out
       titles say it again, and these rows render muted — three signals without
       a badge repeating it per row. The per-ROLE badge survives in the nested
       multi-role block below, which is the one place statuses genuinely
       differ within one person. -->
  {#snippet personRow(g: PersonGroup, muted = false)}
    {@const p = g.person}
    {@const single = g.rows.length === 1 ? g.rows[0] : null}
    <li class="rounded-[10px] border border-surface-divider bg-surface-hover/40 px-3 py-2" class:opacity-70={muted}>
      <div class="flex items-center justify-between gap-3">
        <a href={`/people/${p.id}`} class="flex min-w-0 items-center gap-2 hover:text-brand">
          <Avatar name={personName(p)} src={assetUrl(p.person_picture, { width: 64, height: 64, fit: 'cover' })} position={p.image_focal ?? ''} lazy />
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium text-ink-900">{personName(p)}</span>
            </div>
            <!-- The title sits under the name rather than in a block of its
                 own. An empty title renders nothing: `role` is unset on 68% of
                 rows, and "Untitled role" nine times over was the loudest text
                 on the card. -->
            {#if single}
              {#if hasVal(single.role) || hasVal(single.start_date) || hasVal(single.end_date)}
                <div class="mt-0.5 flex items-center gap-2 text-xs text-ink-400">
                  {#if hasVal(single.role)}<span class="truncate" class:line-through={!single.is_current}>{single.role}</span>{/if}
                  {#if hasVal(single.start_date) || hasVal(single.end_date)}
                    <span class="hidden shrink-0 sm:inline tabular-nums">
                      {fmtYear(single.start_date) || '—'} – {fmtYear(single.end_date) || (single.is_current ? 'present' : '—')}
                    </span>
                  {/if}
                </div>
              {/if}
            {:else}
              <div class="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-400">
                {#each g.rows as r (r.id)}
                  {#if hasVal(r.role)}<span class:line-through={!r.is_current}>{r.role}</span>{/if}
                {/each}
              </div>
            {/if}
          </div>
        </a>
        <div class="flex shrink-0 items-center gap-2">
          {#if single}
            {@const anyDetail = hasVal(single.role) || hasVal(single.start_date) || hasVal(single.end_date) || hasVal(single.work_email) || hasVal(single.work_phone)}
            <button
              type="button"
              class="text-xs text-ink-400 hover:text-ink-700"
              onclick={() => toggleExpand(single.id)}
              aria-expanded={!!expanded[single.id]}
            >{expanded[single.id] ? 'Done' : anyDetail ? 'Edit' : 'Add details'}</button>
            {#if expanded[single.id]}
              <button
                type="button"
                class="text-xs text-tag-salesText hover:opacity-80"
                onclick={() => removeRole(single)}
                disabled={deletingId === single.id}
                title="Delete this role row"
              >{deletingId === single.id ? '…' : 'Delete'}</button>
            {/if}
          {/if}
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1 text-xs text-ink-400 hover:text-ink-700"
            onclick={() => addRoleFor(p)}
            disabled={addingRoleFor === p.id}
            title="Add another role for this person (e.g. Co-founder AND CEO)"
          >
            <Icon name="plus" size={12} /> {addingRoleFor === p.id ? 'Adding…' : 'Add role'}
          </button>
        </div>
      </div>

      {#if single}
        {#if expanded[single.id]}
          {@render roleDetail(single)}
        {/if}
      {:else}
        <!-- Two or more roles at this org: keep the nested block, which is
             what it was designed for. -->
        <ul class="mt-2 space-y-2">
          {#each g.rows as role (role.id)}
            {@const isOpen = !!expanded[role.id]}
            {@const anyDetail = hasVal(role.role) || hasVal(role.start_date) || hasVal(role.end_date) || hasVal(role.work_email) || hasVal(role.work_phone)}
            <li class="rounded-[8px] border border-surface-divider bg-surface-card/60 px-3 py-2">
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2 text-sm">
                  <span class="truncate font-medium text-ink-800">{role.role || 'Untitled role'}</span>
                  {#if !role.is_current}<TagPill tone="neutral">former</TagPill>{/if}
                  {#if hasVal(role.start_date) || hasVal(role.end_date)}
                    <span class="hidden sm:inline text-xs text-ink-400">
                      {fmtYear(role.start_date) || '—'} – {fmtYear(role.end_date) || (role.is_current ? 'present' : '—')}
                    </span>
                  {/if}
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    class="text-xs text-ink-400 hover:text-ink-700"
                    onclick={() => toggleExpand(role.id)}
                    aria-expanded={isOpen}
                  >{isOpen ? 'Done' : anyDetail ? 'Edit' : 'Add details'}</button>
                  {#if isOpen}
                    <button
                      type="button"
                      class="text-xs text-tag-salesText hover:opacity-80"
                      onclick={() => removeRole(role)}
                      disabled={deletingId === role.id}
                      title="Delete this role row"
                    >{deletingId === role.id ? '…' : 'Delete'}</button>
                  {/if}
                </div>
              </div>
              {#if isOpen}{@render roleDetail(role)}{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </li>
  {/snippet}

  <ul class="space-y-3 px-4 pb-4">
    {#each currentGroups as g (g.person.id)}{@render personRow(g)}{/each}
  </ul>

  {#if currentGroups.length === 0 && formerGroups.length > 0}
    <div class="px-4 pb-2 text-sm text-ink-400">Nobody currently here — everyone linked has left.</div>
  {/if}

  {#if formerGroups.length > 0}
    <div class="px-4 pb-4">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 text-xs font-medium text-ink-400 hover:text-ink-700"
        aria-expanded={showFormer}
        onclick={() => (showFormer = !showFormer)}
      >
        <Icon name={showFormer ? "chevron-left" : "chevron-right"} size={12} />
        {showFormer ? "Hide" : "Show"} {formerGroups.length} former
        {formerGroups.length === 1 ? "person" : "people"}
      </button>
      {#if showFormer}
        <ul class="mt-3 space-y-3">
          {#each formerGroups as g (g.person.id)}{@render personRow(g, true)}{/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
