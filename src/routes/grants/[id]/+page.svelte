<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import EditableField from '$lib/EditableField.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import {
    updateGrant,
    createGrantAward,
    removeGrantAward,
    searchOrgs,
    searchProjects,
    avatarSrc,
    formatGrantAmount,
    grantCategoryLabel,
    GRANT_CATEGORY_OPTIONS,
    GRANT_RECURRENCE_OPTIONS,
    GRANT_CURRENCY_OPTIONS,
    formatError,
    type Grant,
    type GrantAward,
    type Organization,
    type Project
  } from '$lib/directus';
  import AwardsTable from '$lib/AwardsTable.svelte';

  let { data }: { data: { grant: Grant; awards: GrantAward[] } } = $props();
  let grant = $state<Grant>(data.grant);
  let awards = $state<GrantAward[]>(data.awards);
  $effect(() => { grant = data.grant; awards = data.awards; });


  async function save(field: keyof Grant, value: string | null) {
    const patched = await updateGrant(grant.id, { [field]: value } as Partial<Grant>);
    grant = { ...grant, ...patched, funder_org_id: grant.funder_org_id };
  }

  // Funder org picker (Edit mode). Picks an org, sets funder_org_id;
  // doesn't touch funder_label so historical free-text values stay
  // for the rare row that wasn't backfilled.
  let editingFunder = $state(false);
  let funderEditQuery = $state('');
  let funderEditResults = $state<Organization[]>([]);
  let funderEditTimer: ReturnType<typeof setTimeout> | null = null;
  function onFunderEditQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    funderEditQuery = v;
    if (funderEditTimer) clearTimeout(funderEditTimer);
    funderEditTimer = setTimeout(async () => {
      if (!v.trim()) { funderEditResults = []; return; }
      try { funderEditResults = (await searchOrgs(v, 8)) as Organization[]; } catch { funderEditResults = []; }
    }, 180);
  }
  async function pickFunderEdit(o: Organization | null) {
    const patched = await updateGrant(grant.id, { funder_org_id: o ? o.id : null } as unknown as Partial<Grant>);
    grant = { ...grant, ...patched, funder_org_id: o ?? null };
    editingFunder = false;
    funderEditQuery = '';
    funderEditResults = [];
  }

  function hasValue(v: unknown): boolean {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    return true;
  }
  let editing = $state(false);

  // ── New award flow ────────────────────────────────────────────────────
  let addingAward = $state(false);
  let orgQuery = $state('');
  let orgResults = $state<Organization[]>([]);
  let orgTimer: ReturnType<typeof setTimeout> | null = null;
  let pickedOrg = $state<Organization | null>(null);
  let projectQuery = $state('');
  let projectResults = $state<Project[]>([]);
  let projectTimer: ReturnType<typeof setTimeout> | null = null;
  let pickedProject = $state<Project | null>(null);
  let newAwardYear = $state<number | ''>(new Date().getFullYear());
  let newAwardTotal = $state<number | ''>('');
  let newAwardCurrency = $state<string>(grant.currency ?? 'ISK');
  let newAwardDuration = $state<number | ''>(grant.typical_duration_years ?? '');
  let newAwardStage = $state('');
  let newAwardName = $state('');
  let creatingAward = $state(false);
  let awardError = $state('');

  function onOrgQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    orgQuery = v; pickedOrg = null;
    if (orgTimer) clearTimeout(orgTimer);
    orgTimer = setTimeout(async () => {
      if (!v.trim()) { orgResults = []; return; }
      try { orgResults = (await searchOrgs(v, 8)) as Organization[]; } catch { orgResults = []; }
    }, 180);
  }
  function pickOrg(o: Organization) { pickedOrg = o; orgQuery = o.name ?? ''; orgResults = []; }
  function onProjectQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    projectQuery = v; pickedProject = null;
    if (projectTimer) clearTimeout(projectTimer);
    projectTimer = setTimeout(async () => {
      if (!v.trim()) { projectResults = []; return; }
      try { projectResults = (await searchProjects(v, 8)) as Project[]; } catch { projectResults = []; }
    }, 180);
  }
  function pickProject(p: Project) { pickedProject = p; projectQuery = p.name ?? ''; projectResults = []; }

  async function submitAward() {
    if (!pickedOrg) { awardError = 'Pick a recipient organisation'; return; }
    creatingAward = true; awardError = '';
    try {
      const created = await createGrantAward({
        grant_id: grant.id,
        organization_id: pickedOrg.id,
        project_id: pickedProject?.id ?? null,
        awarded_year: typeof newAwardYear === 'number' ? newAwardYear : (newAwardYear ? Number(newAwardYear) : null),
        total_amount: typeof newAwardTotal === 'number' ? newAwardTotal : (newAwardTotal ? Number(newAwardTotal) : null),
        currency: newAwardCurrency || grant.currency || 'ISK',
        duration_years: typeof newAwardDuration === 'number' ? newAwardDuration : (newAwardDuration ? Number(newAwardDuration) : null),
        stage: newAwardStage.trim() || null,
        award_name: newAwardName.trim() || null
      });
      // Echo the picked org so the row immediately renders with the
      // expanded name + logo without a refetch.
      awards = [{ ...created, organization_id: pickedOrg, project_id: pickedProject ?? null, grant_id: grant }, ...awards];
      addingAward = false;
      pickedOrg = null; pickedProject = null;
      orgQuery = ''; projectQuery = '';
      newAwardYear = new Date().getFullYear(); newAwardTotal = ''; newAwardCurrency = grant.currency ?? 'ISK';
      newAwardDuration = grant.typical_duration_years ?? ''; newAwardStage = ''; newAwardName = '';
    } catch (e) { awardError = formatError(e); } finally { creatingAward = false; }
  }

  async function archiveAward(awardId: number) {
    if (!confirm('Archive this award? You can restore from the row\'s status later.')) return;
    await removeGrantAward(awardId);
    awards = awards.filter((a) => a.id !== awardId);
  }

  // Sum total awarded by this programme across all rows.
  const totalAwarded = $derived.by(() => {
    const byCurrency = new Map<string, number>();
    for (const a of awards) {
      const cur = a.currency ?? 'ISK';
      const n = typeof a.total_amount === 'number' ? a.total_amount : Number(a.total_amount ?? 0);
      if (!Number.isFinite(n)) continue;
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + n);
    }
    return [...byCurrency.entries()].map(([cur, n]) => formatGrantAmount(n, cur));
  });
</script>

<svelte:head><title>{grant.name} · Grants · Hub</title></svelte:head>

<section class="space-y-6">
  <!-- Hero -->
  <div class="card relative p-4 sm:p-6"
       style={grant.color ? `box-shadow: inset 4px 0 0 ${grant.color};` : ''}>
    <button
      type="button"
      class="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-400 hover:bg-surface-hover hover:text-ink-900 {editing ? 'bg-brand text-white hover:bg-brand hover:text-white' : ''}"
      aria-label={editing ? 'Done editing' : 'Edit grant'}
      onclick={() => (editing = !editing)}
    >
      <Icon name={editing ? 'check' : 'pencil'} size={16} />
    </button>
    <div class="pr-12">
      <h1 class="flex min-w-0 items-center gap-2 font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
        <EditableField value={grant.name} onSave={(v) => save('name', v)} />
        {#if grant.short_name && grant.short_name !== grant.name}
          <span class="text-base text-ink-400">({grant.short_name})</span>
        {/if}
      </h1>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
        {#if grant.funder_org_id && typeof grant.funder_org_id === 'object'}
          <a href={`/orgs/${grant.funder_org_id.id}`} class="inline-flex items-center gap-1 hover:text-brand">
            <Icon name="building" size={12} />
            <span>{grant.funder_org_id.name}</span>
          </a>
        {:else if grant.funder_label}
          <span>{grant.funder_label}</span>
        {/if}
        {#if grant.category}<span class="text-ink-300">·</span><span>{grantCategoryLabel(grant.category)}</span>{/if}
        {#if grant.is_recurring}<span class="text-ink-300">·</span><span class="inline-flex items-center gap-1"><Icon name="clock" size={12} /> {grant.recurrence ?? 'recurring'}</span>{/if}
        {#if grant.typical_duration_years}<span class="text-ink-300">·</span><span>{grant.typical_duration_years} {grant.typical_duration_years === 1 ? 'year' : 'years'} typical</span>{/if}
      </div>
      {#if grant.summary}
        <p class="mt-3 max-w-3xl text-sm text-ink-700">{grant.summary}</p>
      {/if}
      {#if grant.website}
        <a class="mt-3 inline-flex items-center gap-1 text-xs text-brand hover:underline" href={grant.website} target="_blank" rel="noreferrer">
          <Icon name="globe" size={12} /> {grant.website.replace(/^https?:\/\//, '')}
        </a>
      {/if}
    </div>
  </div>

  <!-- Programme details (Edit-mode rich form) -->
  {#if editing}
    <div class="card">
      <div class="card-header"><span class="card-title"><Icon name="sparkles" size={16} /> Programme details</span></div>
      <dl class="divide-y divide-surface-divider px-4 pb-3 text-sm">
        <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
          <dt class="text-ink-400">Short name</dt>
          <dd class="min-w-0 flex-1"><EditableField value={grant.short_name ?? null} onSave={(v) => save('short_name', v)} /></dd>
        </div>
        <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:py-1.5">
          <dt class="text-ink-400 sm:mt-1">Funder</dt>
          <dd class="min-w-0 sm:text-right">
            {#if editingFunder}
              <input
                type="text"
                autocomplete="off"
                class="input w-full sm:w-64 text-sm"
                placeholder="Search organisations…"
                value={funderEditQuery}
                oninput={onFunderEditQuery}
              />
              {#if funderEditResults.length > 0}
                <ul class="mt-1 max-h-48 w-full sm:w-64 overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card text-left">
                  {#each funderEditResults as o (o.id)}
                    <li>
                      <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => pickFunderEdit(o)}>
                        <Icon name="building" size={12} />
                        <span class="truncate">{o.name}</span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
              <div class="mt-1 flex gap-2 sm:justify-end text-xs">
                <button class="text-ink-400 hover:text-ink-700" onclick={() => pickFunderEdit(null)}>Clear</button>
                <button class="text-ink-400 hover:text-ink-700" onclick={() => (editingFunder = false)}>Cancel</button>
              </div>
            {:else}
              <button class="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ink-900 hover:bg-surface-hover sm:text-right" onclick={() => (editingFunder = true)}>
                {#if grant.funder_org_id && typeof grant.funder_org_id === 'object'}
                  {grant.funder_org_id.name}
                {:else}
                  <span class="text-ink-300">Pick funder org</span>
                {/if}
              </button>
            {/if}
          </dd>
        </div>
        <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
          <dt class="text-ink-400">Category</dt>
          <dd>
            <EditableField value={grant.category ?? null} type="select"
              options={GRANT_CATEGORY_OPTIONS.map((c) => ({ label: c.label, value: c.value }))}
              onSave={(v) => save('category', v)} />
          </dd>
        </div>
        <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
          <dt class="text-ink-400">Currency</dt>
          <dd>
            <EditableField value={grant.currency ?? null} type="select"
              options={[...GRANT_CURRENCY_OPTIONS].map((c) => ({ label: c, value: c }))}
              onSave={(v) => save('currency', v)} />
          </dd>
        </div>
        <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
          <dt class="text-ink-400">Recurrence</dt>
          <dd>
            <EditableField value={grant.recurrence ?? null} type="select"
              options={[{ label: '—', value: '' }, ...GRANT_RECURRENCE_OPTIONS.map((r) => ({ label: r.label, value: r.value }))]}
              onSave={(v) => save('recurrence', v || null)} />
          </dd>
        </div>
        <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
          <dt class="text-ink-400">Website</dt>
          <dd class="min-w-0 flex-1"><EditableField value={grant.website ?? null} type="url" onSave={(v) => save('website', v)} /></dd>
        </div>
        <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:py-1.5">
          <dt class="text-ink-400 sm:mt-1">Summary</dt>
          <dd class="min-w-0 flex-1"><EditableField value={grant.summary ?? null} onSave={(v) => save('summary', v)} /></dd>
        </div>
      </dl>
    </div>
  {/if}

  <!-- Awards card -->
  <div class="card">
    <div class="card-header">
      <span class="card-title">
        <Icon name="gift" size={16} /> Awards <span class="text-ink-300 font-normal">{awards.length}</span>
        {#if totalAwarded.length > 0}<span class="text-xs text-ink-400">· {totalAwarded.join(' · ')}</span>{/if}
      </span>
      <button
        class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
        onclick={() => (addingAward = !addingAward)}
      ><Icon name="plus" size={14} /> {addingAward ? 'Cancel' : 'Record award'}</button>
    </div>

    {#if addingAward}
      <div class="mx-4 mb-3 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3 space-y-3 text-sm">
        <div class="text-xs font-medium text-ink-700">Record a new award</div>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Recipient organisation *</span>
          <input type="text" class="input w-full" placeholder="Search organisations…" value={orgQuery} oninput={onOrgQuery} />
          {#if orgResults.length > 0}
            <ul class="mt-1 max-h-48 overflow-auto rounded-[10px] border border-surface-border bg-surface-card">
              {#each orgResults as o (o.id)}
                <li>
                  <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover" onclick={() => pickOrg(o)}>
                    <Avatar name={o.name ?? '?'} src={avatarSrc(o.logo, o.image_focal, 40)} size={20} />
                    <span class="truncate">{o.name}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          {#if pickedOrg}<div class="mt-1 text-xs text-ink-500">Picked: <span class="font-medium text-ink-900">{pickedOrg.name}</span></div>{/if}
        </label>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="block">
            <span class="block text-xs text-ink-400 mb-1">Year awarded</span>
            <input type="number" min="2000" max="2100" class="input w-full" bind:value={newAwardYear} />
          </label>
          <label class="block">
            <span class="block text-xs text-ink-400 mb-1">Total amount</span>
            <div class="flex gap-2">
              <input type="number" min="0" step="any" class="input flex-1" bind:value={newAwardTotal} placeholder="e.g. 25000000" />
              <select class="input !w-auto" bind:value={newAwardCurrency}>
                {#each GRANT_CURRENCY_OPTIONS as c (c)}<option value={c}>{c}</option>{/each}
              </select>
            </div>
          </label>
          <label class="block">
            <span class="block text-xs text-ink-400 mb-1">Duration (years)</span>
            <input type="number" min="1" max="10" class="input w-full" bind:value={newAwardDuration} placeholder="e.g. 2" />
          </label>
          <label class="block">
            <span class="block text-xs text-ink-400 mb-1">Stage / phase</span>
            <input type="text" class="input w-full" bind:value={newAwardStage} placeholder="e.g. Vöxtur" />
          </label>
          <label class="block sm:col-span-2">
            <span class="block text-xs text-ink-400 mb-1">Linked project (optional)</span>
            <input type="text" class="input w-full" placeholder="Search projects…" value={projectQuery} oninput={onProjectQuery} />
            {#if projectResults.length > 0}
              <ul class="mt-1 max-h-40 overflow-auto rounded-[10px] border border-surface-border bg-surface-card">
                {#each projectResults as p (p.id)}
                  <li>
                    <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover" onclick={() => pickProject(p)}>
                      <Icon name="sparkles" size={12} />
                      <span class="truncate">{p.name}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            {#if pickedProject}<div class="mt-1 text-xs text-ink-500">Linked: <span class="font-medium text-ink-900">{pickedProject.name}</span></div>{/if}
          </label>
          <label class="block sm:col-span-2">
            <span class="block text-xs text-ink-400 mb-1">Award name (optional)</span>
            <input type="text" class="input w-full" bind:value={newAwardName} placeholder="Working title for the award" />
          </label>
        </div>
        {#if awardError}<div class="text-xs text-tag-salesText">{awardError}</div>{/if}
        <div class="flex justify-end gap-2">
          <button class="btn-ghost" onclick={() => (addingAward = false)} disabled={creatingAward}>Cancel</button>
          <button class="btn-primary" onclick={submitAward} disabled={creatingAward || !pickedOrg}>
            {creatingAward ? 'Saving…' : 'Record award'}
          </button>
        </div>
      </div>
    {/if}

    <!-- Awards table — shared with /projects/[id] via AwardsTable.
         Programme column hidden here since every award belongs to this
         one programme. URL prefix is empty so the filter params stay
         the canonical ones (?q=&year=&region=&…). -->
    <AwardsTable
      awards={awards}
      storageKey="twin.grants.detail.columns.v1"
      urlPrefix=""
      showProgramme={false}
      archiveable={true}
      onArchive={archiveAward}
      emptyMessage='No awards recorded yet. Tap "Record award" above to add the first one.'
    />
  </div>
</section>
