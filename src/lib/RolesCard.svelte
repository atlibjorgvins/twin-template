<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import EditableField from '$lib/EditableField.svelte';
  import { updateRole, createRole, searchOrgs, createOrg, avatarSrc, listRoleTitles, formatError, type Organization, type Role } from '$lib/directus';
  import { onMount } from 'svelte';

  // Shared title vocabulary — same datalist as the org People card, so
  // "CEO" is spelled identically from either side and searches match.
  let titleOptions = $state<string[]>([]);
  onMount(async () => {
    try { titleOptions = await listRoleTitles(); } catch { /* suggestions only */ }
  });

  let {
    roles = $bindable([] as Role[]),
    personId
  }: { roles: Role[]; personId: number } = $props();

  async function save(roleId: number, patch: Partial<Role>) {
    const updated = await updateRole(roleId, patch);
    roles = roles.map((r) => (r.id === roleId ? { ...r, ...updated, organization_id: r.organization_id, reporting_to: r.reporting_to } : r));
  }

  // --- Add role flow ---
  // One-click add: picking an org from search creates the role immediately
  // with sensible defaults (is_current: true, no title/dates/email). Form
  // stays open so multiple roles can be added quickly. Title/dates/email get
  // filled inline on the role row.
  let adding = $state(false);
  let orgQuery = $state('');
  let orgResults = $state<Organization[]>([]);
  let creating = $state(false);
  let createError = $state('');
  let searched = $state(false);
  let creatingOrg = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let inputEl = $state<HTMLInputElement | null>(null);

  function openAdd() {
    adding = true;
    orgQuery = '';
    orgResults = [];
    searched = false;
    createError = '';
    queueMicrotask(() => inputEl?.focus());
  }

  function cancelAdd() {
    adding = false;
  }

  function onOrgQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    orgQuery = v;
    searched = false;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!v.trim()) { orgResults = []; searched = false; return; }
      try {
        orgResults = (await searchOrgs(v, 8)) as Organization[];
        searched = true;
      } catch (e) { createError = formatError(e); }
    }, 180);
  }

  /** Existing-org path: pick → role created immediately. */
  async function pickOrg(o: Organization) {
    creating = true;
    createError = '';
    try {
      const created = await createRole({
        person_id: personId,
        organization_id: o.id,
        is_current: true
      } as Partial<Role> & { person_id: number; organization_id: number });
      roles = [{ ...(created as Role), organization_id: o }, ...roles];
      orgQuery = '';
      orgResults = [];
      searched = false;
      inputEl?.focus();
    } catch (e) {
      createError = formatError(e);
    } finally {
      creating = false;
    }
  }

  async function createAndPickOrg() {
    const name = orgQuery.trim();
    if (!name) return;
    creatingOrg = true;
    createError = '';
    try {
      const created = await createOrg({ name });
      await pickOrg(created);
    } catch (e) {
      createError = formatError(e);
    } finally {
      creatingOrg = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!adding) return;
    if (e.key === 'Escape') cancelAdd();
    if (e.key === 'Enter') {
      e.preventDefault();
      if (orgResults.length === 1) pickOrg(orgResults[0]);
      else if (searched && orgQuery.trim()) createAndPickOrg();
    }
  }

  function org(r: Role): Organization | null {
    return r.organization_id && typeof r.organization_id === 'object' ? (r.organization_id as Organization) : null;
  }

  const employmentOpts = [
    { label: 'Full-time', value: 'full_time' },
    { label: 'Part-time', value: 'part_time' },
    { label: 'Contractor', value: 'contractor' },
    { label: 'Volunteer', value: 'volunteer' },
    { label: 'Advisor', value: 'advisor' },
    { label: 'Board', value: 'board' },
    { label: 'Founder', value: 'founder' },
    { label: 'Teacher', value: 'teacher' },
    { label: 'Student', value: 'student' },
    { label: 'Member', value: 'member' }
  ];

  const seniorityOpts = [
    { label: 'Intern', value: 'intern' },
    { label: 'Junior', value: 'junior' },
    { label: 'Mid', value: 'mid' },
    { label: 'Senior', value: 'senior' },
    { label: 'Lead', value: 'lead' },
    { label: 'Manager', value: 'manager' },
    { label: 'Director', value: 'director' },
    { label: 'VP', value: 'vp' },
    { label: 'C-Level', value: 'c_level' },
    { label: 'Founder', value: 'founder' }
  ];

  const currentRoles = $derived(roles.filter((r) => r.is_current));
  const formerRoles = $derived(roles.filter((r) => !r.is_current));
  let showFormer = $state(false);

  function fmtYear(d?: string | null) {
    if (!d) return '';
    try { return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(d)); }
    catch { return d; }
  }

  // Per-row expansion: collapsed shows only populated fields; expanded shows
  // every field for editing.
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
    <span class="card-title">
      <Icon name="building" size={16} /> Roles
      <span class="text-ink-300 font-normal">{currentRoles.length}</span>
      {#if formerRoles.length > 0}
        <span class="text-ink-300 font-normal">· {formerRoles.length} former</span>
      {/if}
    </span>
    <button
      class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
      aria-label="Add role"
      onclick={openAdd}
    ><Icon name="plus" size={14} /> Add role</button>
  </div>

  {#if adding}
    <div class="mx-4 mb-3 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3 space-y-2">
      <div class="text-xs font-medium text-ink-700">Add a role</div>
      <div class="relative">
        <input
          bind:this={inputEl}
          id="role-org"
          type="text"
          autocomplete="off"
          class="input w-full"
          placeholder="Type an org, click to add. Done to close."
          value={orgQuery}
          oninput={onOrgQuery}
          onkeydown={onKey}
          disabled={creating || creatingOrg}
        />
        {#if orgResults.length > 0}
          <ul class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
            {#each orgResults as o (o.id)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover disabled:opacity-50"
                  onclick={() => pickOrg(o)}
                  disabled={creating || creatingOrg}
                >
                  {#if o.logo}
                    <Avatar name={o.name ?? ''} src={avatarSrc(o.logo, o.image_focal, 32)} size={20} position={o.image_focal ?? ''} lazy />
                  {:else}
                    <Icon name="building" size={14} />
                  {/if}
                  <span class="truncate">{o.name}</span>
                  {#if o.industry}<span class="ml-auto text-xs text-ink-400 truncate">{o.industry}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {:else if searched && orgQuery.trim() && !creating}
          <button
            type="button"
            class="mt-1 inline-flex items-center gap-1 text-xs text-brand hover:underline disabled:opacity-60"
            onclick={createAndPickOrg}
            disabled={creatingOrg}
          >
            <Icon name="plus" size={12} />
            {creatingOrg ? 'Creating…' : `Create "${orgQuery.trim()}" as new organization`}
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
        <button class="btn-ghost" onclick={cancelAdd} disabled={creating || creatingOrg}>
          {creating ? 'Adding…' : 'Done'}
        </button>
      </div>
    </div>
  {/if}

  {#if roles.length === 0 && !adding}
    <div class="px-4 pb-4 text-sm text-ink-400">
      No roles yet. Add one to capture where this person works, their title, and dates.
    </div>
  {/if}

  {#snippet roleItem(role: Role)}
    {@const o = org(role)}
    {@const isOpen = !!expanded[role.id]}
    {@const anyDetail = hasVal(role.role) || hasVal(role.department) || hasVal(role.seniority) || hasVal(role.employment_type) || hasVal(role.location) || hasVal(role.start_date) || hasVal(role.end_date) || hasVal(role.work_email) || hasVal(role.work_phone)}
    <li class="rounded-[10px] border border-surface-divider bg-surface-hover/40 p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            {#if o?.logo}
              <Avatar name={o?.name ?? ''} src={avatarSrc(o.logo, o.image_focal, 64)} size={32} position={o?.image_focal ?? ''} lazy />
            {:else}
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-card text-ink-500" title={o?.name ?? ''}>
                <Icon name="building" size={16} />
              </span>
            {/if}
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                {#if o}
                  <a href={`/orgs/${o.id}`} class="truncate font-medium text-ink-900 hover:text-brand hover:underline">{o.name ?? 'Unknown org'}</a>
                {:else}
                  <span class="truncate font-medium text-ink-900">Unknown org</span>
                {/if}
                {#if role.is_current}
                  <TagPill tone="nutrition">current</TagPill>
                {:else}
                  <TagPill tone="neutral">former</TagPill>
                {/if}
              </div>
              {#if hasVal(role.start_date) || hasVal(role.end_date)}
                <div class="text-xs text-ink-400 mt-0.5">
                  {fmtYear(role.start_date) || '—'} – {fmtYear(role.end_date) || (role.is_current ? 'present' : '—')}
                </div>
              {/if}
            </div>
          </div>
          <button
            type="button"
            class="shrink-0 text-xs text-ink-400 hover:text-ink-700"
            onclick={() => toggleExpand(role.id)}
            aria-expanded={isOpen}
          >
            {isOpen ? 'Done' : anyDetail ? 'Edit' : 'Add details'}
          </button>
        </div>

        {#if isOpen || anyDetail}
          <dl class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {#if isOpen}
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
            {/if}
            {#if isOpen || hasVal(role.role)}
              <div class="flex items-center justify-between gap-2 sm:col-span-2">
                <dt class="text-ink-400">Title</dt>
                <dd class="min-w-0 flex-1"><EditableField value={role.role} placeholder="Add title" suggestions={titleOptions} onSave={(v) => save(role.id, { role: v })} /></dd>
              </div>
            {/if}
            {#if isOpen || hasVal(role.department)}
              <div class="flex items-center justify-between gap-2">
                <dt class="text-ink-400">Department</dt>
                <dd class="min-w-0 flex-1"><EditableField value={role.department} onSave={(v) => save(role.id, { department: v })} /></dd>
              </div>
            {/if}
            {#if isOpen || hasVal(role.seniority)}
              <div class="flex items-center justify-between gap-2">
                <dt class="text-ink-400">Seniority</dt>
                <dd>
                  <EditableField value={role.seniority} type="select" options={seniorityOpts} onSave={(v) => save(role.id, { seniority: v })} />
                </dd>
              </div>
            {/if}
            {#if isOpen || hasVal(role.employment_type)}
              <div class="flex items-center justify-between gap-2">
                <dt class="text-ink-400">Type</dt>
                <dd>
                  <EditableField value={role.employment_type} type="select" options={employmentOpts} onSave={(v) => save(role.id, { employment_type: v })} />
                </dd>
              </div>
            {/if}
            {#if isOpen || hasVal(role.location)}
              <div class="flex items-center justify-between gap-2">
                <dt class="text-ink-400">Location</dt>
                <dd class="min-w-0 flex-1"><EditableField value={role.location} onSave={(v) => save(role.id, { location: v })} /></dd>
              </div>
            {/if}
            {#if isOpen || hasVal(role.start_date)}
              <div class="flex items-center justify-between gap-2">
                <dt class="text-ink-400">Start</dt>
                <dd class="min-w-0 flex-1"><EditableField value={role.start_date} type="date" onSave={(v) => save(role.id, { start_date: v })} /></dd>
              </div>
            {/if}
            {#if isOpen || hasVal(role.end_date)}
              <div class="flex items-center justify-between gap-2">
                <dt class="text-ink-400">End</dt>
                <dd class="min-w-0 flex-1"><EditableField value={role.end_date} type="date" onSave={(v) => save(role.id, { end_date: v })} /></dd>
              </div>
            {/if}
            {#if isOpen || hasVal(role.work_email)}
              <div class="flex items-center justify-between gap-2 sm:col-span-2">
                <dt class="text-ink-400">Work email</dt>
                <dd class="min-w-0 flex-1"><EditableField value={role.work_email} type="email" onSave={(v) => save(role.id, { work_email: v })} /></dd>
              </div>
            {/if}
            {#if isOpen || hasVal(role.work_phone)}
              <div class="flex items-center justify-between gap-2 sm:col-span-2">
                <dt class="text-ink-400">Work phone</dt>
                <dd class="min-w-0 flex-1"><EditableField value={role.work_phone} type="phone" onSave={(v) => save(role.id, { work_phone: v })} /></dd>
              </div>
            {/if}
          </dl>
        {/if}
    </li>
  {/snippet}

  <ul class="space-y-3 px-4 pb-4">
    {#each currentRoles as role (role.id)}
      {@render roleItem(role)}
    {/each}

    {#if formerRoles.length > 0}
      <li>
        <button
          type="button"
          class="w-full rounded-[10px] border border-dashed border-surface-border px-3 py-2 text-xs font-medium text-ink-500 hover:bg-surface-hover"
          onclick={() => (showFormer = !showFormer)}
        >
          {showFormer ? 'Hide' : 'Show'} {formerRoles.length} former role{formerRoles.length === 1 ? '' : 's'}
        </button>
      </li>

      {#if showFormer}
        {#each formerRoles as role (role.id)}
          {@render roleItem(role)}
        {/each}
      {/if}
    {/if}
  </ul>
</div>
