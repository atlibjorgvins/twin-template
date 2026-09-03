<script lang="ts">
  // Mirror of ProjectPeopleCard for the Project_organization junction.
  // Project.owner_org_id remains the project's primary owner (single
  // pick, set from the details card); this list is for everyone else
  // involved — partners, sponsors, clients, hosts, venues, etc.
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import EditableField from '$lib/EditableField.svelte';
  import {
    addOrgToProject,
    updateProjectOrganization,
    removeProjectOrganization,
    searchOrgs,
    createOrg,
    getProjectInheritedOrganizations,
    avatarSrc,
    listProjectRoles,
    orgDisplayName,
    INHERITED_PAGE,
    type Organization,
    type Project,
    type ProjectOrganization,
    type ProjectRole
  } from '$lib/directus';

  let {
    orgs = $bindable([] as ProjectOrganization[]),
    inherited = $bindable([] as ProjectOrganization[]),
    inheritedTotal = 0,
    children = [] as Project[],
    projectId
  }: {
    orgs: ProjectOrganization[];
    inherited?: ProjectOrganization[];
    inheritedTotal?: number;
    children?: Project[];
    projectId: number;
  } = $props();

  function orgOf(r: ProjectOrganization): Organization | null {
    return r.organization_id && typeof r.organization_id === 'object'
      ? (r.organization_id as Organization)
      : null;
  }
  /** Inherited rows are system-managed roll-ups from descendant subprojects
   *  — shown read-only. */
  function inheritedVia(r: ProjectOrganization): string {
    const s = r.inherited_from_project_id;
    return s && typeof s === 'object' ? ((s as { name?: string | null }).name ?? 'sub-project') : 'sub-project';
  }
  const hasMoreInherited = $derived(inherited.length < inheritedTotal);
  let loadingMore = $state(false);
  async function loadMoreInherited() {
    if (loadingMore || !hasMoreInherited) return;
    loadingMore = true;
    try {
      const next = await getProjectInheritedOrganizations(projectId, { limit: INHERITED_PAGE, offset: inherited.length });
      inherited = [...inherited, ...next];
    } finally {
      loadingMore = false;
    }
  }

  async function save(linkId: number, patch: Partial<ProjectOrganization>) {
    const updated = await updateProjectOrganization(linkId, patch);
    orgs = orgs.map((r) =>
      r.id === linkId ? { ...r, ...updated, organization_id: r.organization_id, project_id: r.project_id } : r
    );
  }

  async function remove(linkId: number) {
    const row = orgs.find((o) => o.id === linkId);
    const who = row?.organization_id && typeof row.organization_id === 'object' ? row.organization_id.name : 'this org';
    if (!confirm(`Remove ${who} from this project?`)) return;
    await removeProjectOrganization(linkId);
    orgs = orgs.filter((o) => o.id !== linkId);
  }

  // Catalogue lookup — restrict to roles applicable to organisations.
  let roleCatalogue = $state<ProjectRole[]>([]);
  $effect(() => {
    void (async () => {
      try {
        const all = await listProjectRoles();
        roleCatalogue = all.filter((r) => r.applies_to === 'org' || r.applies_to === 'both' || !r.applies_to);
      } catch { /* ignore */ }
    })();
  });

  // Add flow
  let adding = $state(false);
  let query = $state('');
  let results = $state<Organization[]>([]);
  let picked = $state<Organization | null>(null);
  let roleInProject = $state('');
  let searched = $state(false);
  let creatingOrg = $state(false);
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
      try { results = (await searchOrgs(v, 8)) as Organization[]; searched = true; }
      catch (e) { createError = e instanceof Error ? e.message : String(e); }
    }, 180);
  }

  function pick(o: Organization) { picked = o; query = o.name ?? ''; results = []; }

  async function createAndPick() {
    const name = query.trim();
    if (!name) return;
    creatingOrg = true;
    try {
      const created = await createOrg({ name } as Partial<Organization>);
      pick(created as Organization);
      await submit();
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      creatingOrg = false;
    }
  }

  async function submit() {
    if (!picked) { createError = 'Pick an organisation'; return; }
    creating = true;
    createError = '';
    try {
      const created = await addOrgToProject({
        project_id: projectId,
        organization_id: picked.id,
        role_in_project: roleInProject.trim() || null
      });
      orgs = [{ ...(created as ProjectOrganization), organization_id: picked }, ...orgs];
      adding = false;
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title"><Icon name="building" size={16} /> Organisations <span class="text-ink-300 font-normal">{orgs.length + inheritedTotal}</span></span>
    <button
      class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
      onclick={openAdd}
    ><Icon name="plus" size={14} /> Add org</button>
  </div>

  {#if adding}
    <div class="mx-4 mb-3 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3 space-y-3">
      <div class="text-xs font-medium text-ink-700">Add organisation to project</div>
      <div class="relative">
        <label class="block text-xs text-ink-400 mb-1" for="po-org">Organisation</label>
        <input id="po-org" type="text" autocomplete="off" class="input w-full"
               placeholder="Search organisations…" value={query} oninput={onQuery} />
        {#if results.length > 0}
          <ul class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
            {#each results as o (o.id)}
              <li>
                <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => pick(o)}>
                  <Avatar name={o.name ?? '?'} src={avatarSrc(o.logo, o.image_focal, 40)} size={24} />
                  <span class="truncate">{o.name}</span>
                  {#if o.industry}<span class="ml-auto text-xs text-ink-400 truncate">{o.industry}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if picked}
          <div class="mt-1 text-xs text-ink-500">Picked: <span class="font-medium text-ink-900">{picked.name}</span></div>
        {:else if searched && results.length === 0 && query.trim()}
          <button type="button" class="mt-1 inline-flex items-center gap-1 text-xs text-brand hover:underline disabled:opacity-60"
                  onclick={createAndPick} disabled={creatingOrg}>
            <Icon name="plus" size={12} />
            {creatingOrg ? 'Creating…' : `Create "${query.trim()}" as new org`}
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
          {creating ? 'Adding…' : 'Add org'}
        </button>
      </div>
    </div>
  {/if}

  {#if orgs.length === 0 && inheritedTotal === 0 && !adding}
    <div class="px-4 pb-4 text-sm text-ink-400">
      No organisations linked yet. Add partners, sponsors, clients, hosts…
    </div>
  {/if}

  <ul class="divide-y divide-surface-divider">
    {#each orgs as link (link.id)}
      {@const o = orgOf(link)}
      {#if o}
        <li class="px-4 py-2.5 hover:bg-surface-hover">
          <div class="flex items-center gap-3">
            <a href={`/orgs/${o.id}`} class="flex items-center gap-3 min-w-0 flex-1 hover:text-brand">
              <Avatar name={o.name ?? '?'} src={avatarSrc(o.logo, o.image_focal, 80)} size={36} />
              <div class="min-w-0">
                <div class="truncate font-medium text-ink-900" title={orgDisplayName(o)}>{orgDisplayName(o)}</div>
                {#if o.industry}<div class="truncate text-xs text-ink-400 hidden sm:block">{o.industry}</div>{/if}
              </div>
            </a>
            <div class="hidden sm:block w-40 shrink-0 text-right">
              <select
                class="input !py-1 !text-xs"
                value={link.role_in_project ?? ''}
                onchange={(e) => save(link.id, { role_in_project: (e.currentTarget as HTMLSelectElement).value || null })}
                title="Role in project"
              >
                <option value="">— role —</option>
                {#each roleCatalogue as r (r.id)}
                  <option value={r.key}>{r.label}</option>
                {/each}
                {#if link.role_in_project && !roleCatalogue.some((r) => r.key === link.role_in_project)}
                  <option value={link.role_in_project}>{link.role_in_project} (archived)</option>
                {/if}
              </select>
            </div>
            <button class="text-ink-300 hover:text-tag-salesText shrink-0" title="Remove" onclick={() => remove(link.id)}>
              <Icon name="tag" size={14} />
            </button>
          </div>
          <div class="mt-1 pl-12 sm:hidden">
            <select
                class="input !py-1 !text-xs"
                value={link.role_in_project ?? ''}
                onchange={(e) => save(link.id, { role_in_project: (e.currentTarget as HTMLSelectElement).value || null })}
                title="Role in project"
              >
                <option value="">— role —</option>
                {#each roleCatalogue as r (r.id)}
                  <option value={r.key}>{r.label}</option>
                {/each}
                {#if link.role_in_project && !roleCatalogue.some((r) => r.key === link.role_in_project)}
                  <option value={link.role_in_project}>{link.role_in_project} (archived)</option>
                {/if}
              </select>
          </div>
        </li>
      {/if}
    {/each}
  </ul>

  {#if inheritedTotal > 0}
    <!-- Source sub-projects listed above the rolled-up orgs. -->
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
      {#each inherited as link (link.id)}
        {@const o = orgOf(link)}
        {#if o}
          <li class="px-4 py-2.5 hover:bg-surface-hover">
            <a href={`/orgs/${o.id}`} class="flex items-center gap-3 hover:text-brand">
              <Avatar name={o.name ?? '?'} src={avatarSrc(o.logo, o.image_focal, 80)} size={36} />
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium text-ink-900" title={orgDisplayName(o)}>{orgDisplayName(o)}</div>
                <div class="mt-0.5 flex items-center gap-1.5 text-xs text-ink-400">
                  <Icon name="sparkles" size={12} />
                  <span class="truncate">via {inheritedVia(link)}</span>
                </div>
              </div>
              <Icon name="chevron-right" size={14} class="shrink-0 text-ink-300" />
            </a>
          </li>
        {/if}
      {/each}
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
