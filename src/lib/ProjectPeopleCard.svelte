<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import {
    addPersonToProject,
    updateProjectPerson,
    removeProjectPerson,
    searchPeople,
    createPerson,
    getProjectInheritedPeople,
    personName,
    assetUrl,
    listProjectRoles,
    isCurrentMember,
    getProjectTeams,
    INHERITED_PAGE,
    type Person,
    type Project,
    type ProjectPerson,
    type ProjectRole
  } from '$lib/directus';

  let {
    people = $bindable([] as ProjectPerson[]),
    inherited = $bindable([] as ProjectPerson[]),
    inheritedTotal = 0,
    children = [] as Project[],
    projectId
  }: {
    people: ProjectPerson[];
    inherited?: ProjectPerson[];
    inheritedTotal?: number;
    children?: Project[];
    projectId: number;
  } = $props();

  function personOf(r: ProjectPerson): Person | null {
    return r.person_id && typeof r.person_id === 'object' ? (r.person_id as Person) : null;
  }
  /** Inherited rows are system-managed roll-ups from descendant subprojects
   *  — shown read-only (their role/tenure live on the direct membership). */
  function inheritedVia(r: ProjectPerson): string {
    const s = r.inherited_from_project_id;
    return s && typeof s === 'object' ? ((s as { name?: string | null }).name ?? 'sub-project') : 'sub-project';
  }

  // ── Teams ───────────────────────────────────────────────────────────
  // Which of this project's orgs each person belongs to. One extra pair of
  // reads for the whole card, keyed by person id — not a query per row.
  let teams = $state(new Map<number, { id: number; name: string }>());
  function teamOf(personId: number) {
    return teams.get(personId) ?? null;
  }

  /** Visible role text. Falls back to the stored key when the catalogue no
   *  longer lists it, so an archived role still reads as itself. */
  function roleLabel(link: ProjectPerson): string {
    const k = link.role_in_project;
    if (!k) return 'add role';
    return roleCatalogue.find((r) => r.key === k)?.label ?? k;
  }
  /** Ids we've already asked about, so paging in more inherited people costs
   *  one request for the new ids instead of re-fetching every row.
   *
   *  Deliberately NOT $state. Nothing renders from it, and as reactive state
   *  the `.add()` below would invalidate the very effect whose `.has()` reads
   *  it — self-triggering. It terminates today only because the second pass
   *  finds every id already present and bails; a plain Set removes the trap
   *  instead of relying on that. */
  const teamAsked = new Set<number>();
  $effect(() => {
    const ids = [...people, ...inherited]
      .map((r) => personOf(r)?.id)
      .filter((v): v is number => typeof v === 'number' && !teamAsked.has(v));
    if (ids.length === 0) return;
    for (const id of ids) teamAsked.add(id);
    void (async () => {
      const found = await getProjectTeams(projectId, ids);
      if (found.size === 0) return;
      // New Map so the $state assignment is seen — mutating in place is not
      // tracked for Map contents here.
      const next = new Map(teams);
      for (const [k, v] of found) next.set(k, v);
      teams = next;
    })();
  });

  // `people` is the direct memberships only; inherited roll-ups arrive
  // pre-paginated via `inherited` (+ total), loaded more on demand.
  const current = $derived(people.filter(isCurrentMember));
  const former = $derived(people.filter((p) => !isCurrentMember(p)));
  const hasMoreInherited = $derived(inherited.length < inheritedTotal);
  let loadingMore = $state(false);
  async function loadMoreInherited() {
    if (loadingMore || !hasMoreInherited) return;
    loadingMore = true;
    try {
      const next = await getProjectInheritedPeople(projectId, { limit: INHERITED_PAGE, offset: inherited.length });
      inherited = [...inherited, ...next];
    } finally {
      loadingMore = false;
    }
  }

  async function save(linkId: number, patch: Partial<ProjectPerson>) {
    const updated = await updateProjectPerson(linkId, patch);
    people = people.map((r) =>
      r.id === linkId ? { ...r, ...updated, person_id: r.person_id, project_id: r.project_id } : r
    );
  }

  const today = () => new Date().toISOString().slice(0, 10);

  /** Flip a member current ↔ former. Going former stamps a left-date
   *  (today) when none is set; coming back clears it. */
  function setCurrent(link: ProjectPerson, makeCurrent: boolean) {
    save(link.id, makeCurrent
      ? { is_current: true, end_date: null }
      : { is_current: false, end_date: link.end_date ?? today() });
  }

  async function remove(linkId: number) {
    const row = people.find((p) => p.id === linkId);
    const who = row ? personName(personOf(row)!) : 'this person';
    if (!confirm(`Remove ${who} from this project?`)) return;
    await removeProjectPerson(linkId);
    people = people.filter((p) => p.id !== linkId);
  }

  // Catalogue lookups — filtered by what's allowed for People.
  let roleCatalogue = $state<ProjectRole[]>([]);
  $effect(() => {
    void (async () => {
      try {
        const all = await listProjectRoles();
        roleCatalogue = all.filter((r) => r.applies_to === 'person' || r.applies_to === 'both' || !r.applies_to);
      } catch { /* ignore — picker just falls back to plain input */ }
    })();
  });

  // Add flow
  let adding = $state(false);
  let query = $state('');
  let results = $state<Person[]>([]);
  let picked = $state<Person | null>(null);
  let roleInProject = $state('');
  let searched = $state(false);
  let creatingPerson = $state(false);
  let creating = $state(false);
  let createError = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  function openAdd() {
    adding = true; query = ''; results = []; picked = null;
    roleInProject = ''; createError = ''; searched = false;
  }

  function onQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    query = v;
    picked = null;
    searched = false;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!v.trim()) { results = []; return; }
      try { results = (await searchPeople(v, 8)) as Person[]; searched = true; }
      catch (e) { createError = e instanceof Error ? e.message : String(e); }
    }, 180);
  }

  function pick(p: Person) { picked = p; query = personName(p); results = []; }

  async function createAndPick() {
    const name = query.trim();
    if (!name) return;
    creatingPerson = true;
    try {
      const created = await createPerson({ full_name: name });
      pick(created);
      await submit();
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      creatingPerson = false;
    }
  }

  async function submit() {
    if (!picked) { createError = 'Pick a person'; return; }
    creating = true;
    createError = '';
    try {
      const created = await addPersonToProject({
        project_id: projectId,
        person_id: picked.id,
        role_in_project: roleInProject.trim() || null,
        is_current: true
      });
      people = [{ ...(created as ProjectPerson), person_id: picked }, ...people];
      adding = false;
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }
</script>

{#snippet personRow(link: ProjectPerson)}
  {@const p = personOf(link)}
  {#if p}
    <li class="px-4 py-2.5 hover:bg-surface-hover">
      <div class="flex items-center gap-3">
        <a href={`/people/${p.id}`} class="flex items-center gap-3 min-w-0 flex-1 hover:text-brand">
          <Avatar name={personName(p)} src={assetUrl(p.person_picture, { width: 64, height: 64, fit: 'cover' })} size={36} />
          <div class="min-w-0">
            <div class="truncate font-medium text-ink-900">{personName(p)}</div>
            {#if p.email}<div class="truncate text-xs text-ink-400 hidden sm:block">{p.email}</div>{/if}
          </div>
        </a>
        <button class="text-ink-300 hover:text-tag-salesText shrink-0" title="Remove" onclick={() => remove(link.id)}>
          <Icon name="x" size={14} />
        </button>
      </div>

      <!-- Tenure controls: status toggle + active dates. -->
      <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-12 text-[11px] text-ink-400">
        {#if isCurrentMember(link)}
          <button
            type="button"
            class="ppl-chip cursor-pointer"
            style="background: rgba(34,160,90,0.14); color: #1B8A4B;"
            title="Mark as former member"
            onclick={() => setCurrent(link, false)}
          >current</button>
        {:else}
          <button
            type="button"
            class="ppl-chip cursor-pointer"
            style="background: var(--bg-tertiary); color: var(--text-secondary);"
            title="Mark as current member"
            onclick={() => setCurrent(link, true)}
          >former</button>
        {/if}
        <!-- No joined/left pickers here on purpose. A person's tenure belongs to
             their role AT AN ORG (Person_organization), not to each project that
             org touches — restating it per project asks the same question 3362
             times and answers it inconsistently. Nothing was lost removing them:
             0 of 3362 rows had either date set, and the create default was a
             straight copy of the project's own start_date. `is_current` stays,
             because leaving a project while staying at the org is real and 20
             rows record it. -->

        <!-- Their team: which of THIS project's orgs they belong to. Reads as a
             chip, not a link-blue line, so the row stays one calm band — but it
             is a real link, because "who else is on Kristján's team" is the next
             question and the org page answers it. -->
        {#if teamOf(p.id)}
          {@const t = teamOf(p.id)!}
          <a href={`/orgs/${t.id}`} class="ppl-chip ppl-chip-team" title="Team on this project — open {t.name}">
            <Icon name="building" size={11} />
            <span class="max-w-[11rem] truncate">{t.name}</span>
          </a>
        {/if}

        <!-- One role control for every width. It used to be two selects — a
             w-40 form field on desktop and a duplicate below on mobile — which
             is what made "participant" read as a stray input box wedged between
             chips. Styled as a chip that happens to be a <select>. -->
        <span class="ppl-chip ppl-chip-role" class:ppl-chip-empty={!link.role_in_project}>
          <span class="ppl-role-label">{roleLabel(link)}</span>
          <!-- Inline caret: the icon set has no chevron-down, and FamilyCard's
               chip-select already sets this precedent. -->
          <svg class="ppl-caret" viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          <!-- The real control, invisible and stretched over the chip. app.css
               forces every <select> to 16px !important under 768px so iOS won't
               zoom on focus — a guard worth keeping. That makes a *visible*
               11px select impossible on mobile, so the text you see is the span
               above and this keeps the native platform picker. -->
          <select
            class="ppl-select"
            value={link.role_in_project ?? ''}
            onchange={(e) => save(link.id, { role_in_project: (e.currentTarget as HTMLSelectElement).value || null })}
            aria-label="Role in project"
            title="Role in project"
          >
            <option value="">add role</option>
            {#each roleCatalogue as r (r.id)}
              <option value={r.key}>{r.label}</option>
            {/each}
            {#if link.role_in_project && !roleCatalogue.some((r) => r.key === link.role_in_project)}
              <option value={link.role_in_project}>{link.role_in_project} (archived)</option>
            {/if}
          </select>
        </span>
      </div>
    </li>
  {/if}
{/snippet}

{#snippet inheritedRow(link: ProjectPerson)}
  {@const p = personOf(link)}
  {#if p}
    <li class="px-4 py-2.5 hover:bg-surface-hover">
      <a href={`/people/${p.id}`} class="flex items-center gap-3 hover:text-brand">
        <Avatar name={personName(p)} src={assetUrl(p.person_picture, { width: 64, height: 64, fit: 'cover' })} size={36} />
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium text-ink-900">{personName(p)}</div>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
            <span class="inline-flex items-center gap-1.5">
              <Icon name="sparkles" size={12} />
              <span class="truncate">via {inheritedVia(link)}</span>
            </span>
            <!-- Same team readout as a direct row. These rows are read-only, so
                 it stays plain text — a nested <a> inside the row link would be
                 invalid markup and would swallow the row's own navigation. -->
            {#if teamOf(p.id)}
              <span class="ppl-chip ppl-chip-team ppl-chip-static">
                <Icon name="building" size={11} />
                <span class="max-w-[11rem] truncate">{teamOf(p.id)!.name}</span>
              </span>
            {/if}
          </div>
        </div>
        <Icon name="chevron-right" size={14} class="shrink-0 text-ink-300" />
      </a>
    </li>
  {/if}
{/snippet}

<div class="card">
  <div class="card-header">
    <span class="card-title"><Icon name="users" size={16} /> People <span class="text-ink-300 font-normal">{people.length + inheritedTotal}</span></span>
    <button
      class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
      onclick={openAdd}
    ><Icon name="plus" size={14} /> Add person</button>
  </div>

  {#if adding}
    <div class="mx-4 mb-3 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3 space-y-3">
      <div class="text-xs font-medium text-ink-700">Add person to project</div>
      <div class="relative">
        <label class="block text-xs text-ink-400 mb-1" for="pp-person">Person</label>
        <input id="pp-person" type="text" autocomplete="off" class="input w-full"
               placeholder="Search people…" value={query} oninput={onQuery} />
        {#if results.length > 0}
          <ul class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
            {#each results as p (p.id)}
              <li>
                <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => pick(p)}>
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
          <button type="button" class="mt-1 inline-flex items-center gap-1 text-xs text-brand hover:underline disabled:opacity-60"
                  onclick={createAndPick} disabled={creatingPerson}>
            <Icon name="plus" size={12} />
            {creatingPerson ? 'Creating…' : `Create "${query.trim()}" as new person`}
          </button>
        {/if}
      </div>
      <label class="block">
        <span class="block text-xs text-ink-400 mb-1">Role in project (optional)</span>
        <select class="input w-full" bind:value={roleInProject}>
          <option value="">— pick a role —</option>
          {#each roleCatalogue as r (r.id)}
            <option value={r.key}>{r.label}</option>
          {/each}
        </select>
        <p class="mt-1 text-[10px] text-ink-400">
          Manage the catalogue in
          <a href="/settings/project-roles" class="text-brand hover:underline">Settings → Project roles</a>.
        </p>
      </label>
      {#if createError}<div class="text-xs text-tag-salesText">{createError}</div>{/if}
      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost" onclick={() => (adding = false)} disabled={creating}>Cancel</button>
        <button class="btn-primary" onclick={submit} disabled={creating || !picked}>
          {creating ? 'Adding…' : 'Add person'}
        </button>
      </div>
    </div>
  {/if}

  {#if people.length === 0 && inheritedTotal === 0 && !adding}
    <div class="px-4 pb-4 text-sm text-ink-400">
      No people linked yet. Add teachers, students, partners, advisors…
    </div>
  {/if}

  {#if current.length > 0}
    <ul class="divide-y divide-surface-divider">
      {#each current as link (link.id)}{@render personRow(link)}{/each}
    </ul>
  {/if}

  {#if former.length > 0}
    <div class="border-t border-surface-divider px-4 pt-3 pb-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      Former members <span class="font-normal text-ink-300">{former.length}</span>
    </div>
    <ul class="divide-y divide-surface-divider opacity-80">
      {#each former as link (link.id)}{@render personRow(link)}{/each}
    </ul>
  {/if}

  {#if inheritedTotal > 0}
    <!-- Sub-projects the roll-ups come from, listed above the members so
         the source cohorts read first. Only shown when children exist. -->
    {#if children.length > 0}
      <div class="border-t border-surface-divider px-4 pt-3 pb-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        Sub-projects <span class="font-normal text-ink-300">{children.length}</span>
      </div>
      <ul class="divide-y divide-surface-divider">
        {#each children as c (c.id)}
          <li>
            <a href={`/projects/${c.id}`} class="flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-hover">
              <Icon name="sparkles" size={14} class="shrink-0 text-ink-300" />
              <span class="truncate text-ink-800">{c.name ?? `Project ${c.id}`}</span>
              <Icon name="chevron-right" size={14} class="ml-auto shrink-0 text-ink-300" />
            </a>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="border-t border-surface-divider px-4 pt-3 pb-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      From sub-projects <span class="font-normal text-ink-300">{inheritedTotal}</span>
    </div>
    <ul class="divide-y divide-surface-divider">
      {#each inherited as link (link.id)}{@render inheritedRow(link)}{/each}
    </ul>
    {#if hasMoreInherited}
      <div class="px-4 py-2">
        <button
          type="button"
          class="w-full rounded-[10px] border border-surface-border bg-surface-card py-2 text-xs font-medium text-ink-600 hover:bg-surface-hover disabled:opacity-60"
          onclick={loadMoreInherited}
          disabled={loadingMore}
        >{loadingMore ? 'Loading…' : `Show ${Math.min(INHERITED_PAGE, inheritedTotal - inherited.length)} more of ${inheritedTotal}`}</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  /* One chip shape for the whole meta row, so status / team / role read as
     siblings. Before this the role was a full `.input` form control sitting
     between two pills — the thing that made "participant" look pasted in. */
  .ppl-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.6;
    max-width: 100%;
    text-decoration: none;
    border: 1px solid transparent;
  }

  /* Team: quiet by default, brand-tinted on hover so it reads as reachable
     without competing with the person's name for attention. */
  .ppl-chip-team {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }
  a.ppl-chip-team:hover {
    background: color-mix(in srgb, var(--brand, #2f7d7d) 12%, transparent);
    border-color: color-mix(in srgb, var(--brand, #2f7d7d) 30%, transparent);
    color: var(--brand, #2f7d7d);
  }
  .ppl-chip-static {
    cursor: default;
  }

  /* Role: a chip that IS a select. The native control keeps the platform
     picker (correct on iOS) while losing the input-box chrome. */
  .ppl-chip-role {
    position: relative;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    padding-right: 0.35rem;
    cursor: pointer;
  }
  .ppl-chip-role:hover {
    border-color: var(--border-subtle);
  }
  .ppl-chip-role:focus-within {
    border-color: var(--brand, #2f7d7d);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand, #2f7d7d) 22%, transparent);
  }
  /* Unset role is dimmer and italic — "add role" is an invitation, not a value. */
  .ppl-chip-empty {
    background: transparent;
    border-color: var(--border-subtle);
    border-style: dashed;
  }
  .ppl-chip-empty .ppl-role-label {
    font-style: italic;
    opacity: 0.75;
  }

  .ppl-role-label {
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Invisible, not display:none — it must stay focusable, keyboard-operable and
     hit-testable. Sized to the chip so the whole chip is the tap target. */
  .ppl-select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    appearance: none;
    -webkit-appearance: none;
    border: 0;
    margin: 0;
    padding: 0;
    background: none;
    cursor: pointer;
  }
  /* Focus shows on the chip via :focus-within, so suppress the inner ring. */
  .ppl-select:focus,
  .ppl-select:focus-visible {
    outline: none;
  }
  .ppl-caret {
    flex-shrink: 0;
    opacity: 0.55;
    pointer-events: none;
  }
</style>
