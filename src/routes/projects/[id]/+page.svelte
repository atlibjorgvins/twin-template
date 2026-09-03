<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import AvatarUpload from '$lib/AvatarUpload.svelte';
  import BrandCard from '$lib/admin/BrandCard.svelte';
  import EventsCard from '$lib/events/EventsCard.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import EditableField from '$lib/EditableField.svelte';
  import ItemPhotos from '$lib/photos/ItemPhotos.svelte';
  import ProjectPeopleCard from '$lib/ProjectPeopleCard.svelte';
  import BudgetCard from '$lib/marketing/BudgetCard.svelte';
  import type { MarketingBundle } from '$lib/marketing/metrics';
  import ProjectOrgsCard from '$lib/ProjectOrgsCard.svelte';
  import SponsorsCard from '$lib/SponsorsCard.svelte';
  import ActivityCard from '$lib/ActivityCard.svelte';
  import QuickLogChips from '$lib/QuickLogChips.svelte';
  import RelatedNotes from '$lib/RelatedNotes.svelte';
  import LinkedEvents from '$lib/LinkedEvents.svelte';
  import LinksCard from '$lib/LinksCard.svelte';
  import { goto } from '$app/navigation';
  import {
    updateProject,
    setProjectStatus,
    searchOrgs,
    searchProjects,
    createProject,
    directusAdminUrl,
    assetUrl,
    resolveProjectBrand,
    PROJECT_COLORS,
    type Organization,
    type Project,
    type ProjectPerson,
    listProjectRoles,
    type ProjectRole,
    type ProjectOrganization,
    type GrantAward
  } from '$lib/directus';
  import ProjectGrantsCard from '$lib/ProjectGrantsCard.svelte';
  import ReceiptExpensesCard from '$lib/ReceiptExpensesCard.svelte';

  let { data }: { data: { project: Project; people: ProjectPerson[]; organisations: ProjectOrganization[]; ancestors: Project[]; children: Project[]; memberOrgIds: number[]; awards: GrantAward[]; peopleInherited: ProjectPerson[]; peopleInheritedTotal: number; orgsInherited: ProjectOrganization[]; orgsInheritedTotal: number; spend: MarketingBundle | null } } = $props();
  let project = $state<Project>(data.project);
  let people = $state<ProjectPerson[]>(data.people);
  let organisations = $state<ProjectOrganization[]>(data.organisations ?? []);
  let peopleInherited = $state<ProjectPerson[]>(data.peopleInherited ?? []);
  let peopleInheritedTotal = $state<number>(data.peopleInheritedTotal ?? 0);
  let orgsInherited = $state<ProjectOrganization[]>(data.orgsInherited ?? []);
  let orgsInheritedTotal = $state<number>(data.orgsInheritedTotal ?? 0);

  // The role catalogue, for the Sponsors card: it needs each role's tier and
  // wording template, not just the key stored on the link. Loaded here rather
  // than inside the card so both org cards read the same list. listProjectRoles
  // caches, so this is not a request per card.
  let orgRoles = $state<ProjectRole[]>([]);
  $effect(() => {
    void (async () => {
      try {
        const all = await listProjectRoles();
        orgRoles = all.filter((r) => r.applies_to === 'org' || r.applies_to === 'both' || !r.applies_to);
      } catch {
        // No catalogue ⇒ the Sponsors card shows its own empty state.
      }
    })();
  });
  let ancestors = $state<Project[]>(data.ancestors ?? []);
  let children = $state<Project[]>(data.children ?? []);
  let awards = $state<GrantAward[]>(data.awards ?? []);
  $effect(() => {
    project = data.project;
    people = data.people;
    organisations = data.organisations ?? [];
    peopleInherited = data.peopleInherited ?? [];
    peopleInheritedTotal = data.peopleInheritedTotal ?? 0;
    orgsInherited = data.orgsInherited ?? [];
    orgsInheritedTotal = data.orgsInheritedTotal ?? 0;
    ancestors = data.ancestors ?? [];
    children = data.children ?? [];
    awards = data.awards ?? [];
  });
  /** Sponsors attached to THIS project, not rolled up from a sub-project.
   *  `organisations` is already direct-only (getProjectDirectOrganizations
   *  filters inherited_from_project_id), so this is the sponsor subset of it —
   *  an inherited sponsor belongs to the project that signed it, and crediting
   *  it here would claim support this project was not given. */
  const directSponsors = $derived.by(() => {
    if (orgRoles.length === 0) return [] as ProjectOrganization[];
    const sponsorKeys = new Set(orgRoles.filter((r) => r.is_sponsor).map((r) => r.key));
    return organisations.filter((l) => l.role_in_project && sponsorKeys.has(l.role_in_project));
  });

  // Total membership counts (direct + rolled-up) for tab visibility + labels.
  const peopleTotal = $derived(people.length + peopleInheritedTotal);
  const orgsTotal = $derived(organisations.length + orgsInheritedTotal);

  // Scope hint shown above the grants list — makes the
  // "Hringiða parent rolls up everything; Hringiða 2026 doesn't"
  // mental model obvious without the user having to read code.
  /**
   * Personal projects hide Grants and Organizations.
   *
   * Both are work apparatus: a grant is money from an institution and an
   * org link is a company relationship. On "redo the kitchen" they are
   * empty cards asking to be filled in forever. `scope` already exists and
   * every project has it, so this needs no new field — only 'private'
   * hides, because 'both' is by definition partly work.
   */
  const isPersonal = $derived(project.scope === 'private');

  // Switching a project to private while sitting on its Orgs tab would
  // otherwise strand the user on a tab whose button just disappeared.
  $effect(() => {
    if (isPersonal && tab.value === 'organisations') tab.value = 'overview';
  });

  const grantsScopeLabel = $derived(
    children.length > 0
      ? `Rolled up from member orgs across this project and ${children.length} sub-project${children.length === 1 ? '' : 's'}.`
      : null
  );

  const owner = $derived(
    project.owner_org_id && typeof project.owner_org_id === 'object'
      ? (project.owner_org_id as Organization)
      : null
  );
  const parent = $derived(
    project.parent_id && typeof project.parent_id === 'object'
      ? (project.parent_id as Project)
      : null
  );
  // The root of the chain is the first ancestor (top-most). If there
  // are no ancestors, the project itself is at the top.
  const rootProject = $derived<Project | null>(ancestors[0] ?? null);
  // Inherit colour from the nearest ancestor that has one, so a
  // course inherits its University's accent without re-entry.
  const inheritedColor = $derived<string | null>(
    ancestors.slice().reverse().find((a) => !!a.color)?.color ?? null
  );
  // Effective colour for the hero stripe — own first, then inherited.
  const effectiveColor = $derived<string | null>(project.color ?? inheritedColor);

  // Brand "main background" resolved up the parent chain — backdrop for
  // the hero logo so wordmarks sit on their intended surface.
  let brandBgMain = $state<string | null>(null);
  $effect(() => {
    const id = project.id;
    void (async () => {
      try {
        const rb = await resolveProjectBrand(id);
        if (project.id === id) brandBgMain = rb.bgLight;
      } catch {
        brandBgMain = null;
      }
    })();
  });

  async function save(field: keyof Project, value: string | null) {
    const patched = await updateProject(project.id, { [field]: value } as Partial<Project>);
    // updateProject returns relations as bare ids; keep our expanded
    // owner_org_id / parent_id objects so their names don't vanish.
    project = { ...project, ...patched, owner_org_id: project.owner_org_id, parent_id: project.parent_id };
  }

  function hasValue(v: unknown): boolean {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    return true;
  }

  // Owner org picker
  let editingOwner = $state(false);
  let ownerQuery = $state('');
  let ownerResults = $state<Organization[]>([]);
  let ownerTimer: ReturnType<typeof setTimeout> | null = null;

  function onOwnerQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    ownerQuery = v;
    if (ownerTimer) clearTimeout(ownerTimer);
    ownerTimer = setTimeout(async () => {
      if (!v.trim()) { ownerResults = []; return; }
      ownerResults = (await searchOrgs(v, 8)) as Organization[];
    }, 180);
  }

  async function pickOwner(o: Organization | null) {
    const patched = await updateProject(project.id, { owner_org_id: o ? o.id : null } as unknown as Partial<Project>);
    project = { ...project, ...patched, owner_org_id: o ?? null, parent_id: project.parent_id };
    editingOwner = false;
    ownerQuery = '';
    ownerResults = [];
  }

  // Parent project picker. Same UX shape as the owner-org picker so
  // the muscle memory carries over. Filters out the current project +
  // its descendants client-side to prevent obvious cycles.
  let editingParent = $state(false);
  let parentQuery = $state('');
  let parentResults = $state<Project[]>([]);
  let parentTimer: ReturnType<typeof setTimeout> | null = null;
  const descendantIds = $derived(new Set(children.map((c) => c.id)));

  function onParentQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    parentQuery = v;
    if (parentTimer) clearTimeout(parentTimer);
    parentTimer = setTimeout(async () => {
      if (!v.trim()) { parentResults = []; return; }
      const hits = await searchProjects(v, 8);
      parentResults = hits.filter((p) => p.id !== project.id && !descendantIds.has(p.id));
    }, 180);
  }

  async function pickParent(p: Project | null) {
    const patched = await updateProject(project.id, { parent_id: p ? p.id : null } as unknown as Partial<Project>);
    project = { ...project, ...patched, owner_org_id: project.owner_org_id, parent_id: p ?? null };
    // Re-fetch ancestors so the breadcrumb stays correct without a full reload.
    if (p) ancestors = [...(p && typeof p === 'object' ? [p] : [])];
    else ancestors = [];
    editingParent = false;
    parentQuery = '';
    parentResults = [];
  }

  let archiving = $state(false);
  let publishing = $state(false);
  let editing = $state(false);
  // Counter the parent increments to ask ActivityCard to open its add form.
  let activityOpenTrigger = $state(0);
  // Mobile quick-action row's "More" tile expands an inline panel.
  let mobileActionsOpen = $state(false);

  const isArchived = $derived(project.status === 'archived');
  const isDraft = $derived(project.status === 'draft');

  async function publishNow() {
    publishing = true;
    try {
      const updated = await setProjectStatus(project.id, 'published');
      project = { ...project, ...updated, owner_org_id: project.owner_org_id, parent_id: project.parent_id };
    } finally { publishing = false; }
  }
  async function toggleArchive() {
    const msg = isArchived ? `Restore ${project.name ?? 'this project'}?` : `Archive ${project.name ?? 'this project'}?`;
    if (!confirm(msg)) return;
    archiving = true;
    try {
      const next = isArchived ? 'published' : 'archived';
      const updated = await setProjectStatus(project.id, next);
      project = { ...project, ...updated, owner_org_id: project.owner_org_id, parent_id: project.parent_id };
      if (!isArchived) goto('/projects');
    } finally { archiving = false; }
  }

  // Tabs in the right column, mirroring /people/[id] and /orgs/[id].
  const tab = $state({ value: 'overview' as 'overview' | 'people' | 'organisations' | 'activity' });
  let activityFilter = $state<'all' | 'activities' | 'notes' | 'events'>('all');
  const ACTIVITY_FILTERS: { value: 'all' | 'activities' | 'notes' | 'events'; label: string; icon: 'sparkles' | 'bolt' | 'notebook' | 'calendar' }[] = [
    { value: 'all',        label: 'All',         icon: 'sparkles' },
    { value: 'activities', label: 'Interactions', icon: 'bolt' },
    { value: 'notes',      label: 'Notes',       icon: 'notebook' },
    { value: 'events',     label: 'Events',      icon: 'calendar' }
  ];

  function fmtDateRange(start?: string | null, end?: string | null): string {
    const fmt = (d: string) => {
      try {
        return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d));
      } catch { return d; }
    };
    if (start && end) return `${fmt(start)} – ${fmt(end)}`;
    if (start) return `From ${fmt(start)}`;
    if (end) return `Until ${fmt(end)}`;
    return '';
  }

  // Sub-projects newest-start-first (nulls last) for the parent view.
  const sortedChildren = $derived(
    [...children].sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''))
  );
  // ── Add a sub-project from here ──────────────────────────────────────
  // Same draft-name rule as the projects list: parent name plus the first
  // free counter, starting at #2 because the parent is the first of its
  // line. Children with unrelated names ("Startup Tourism 2016") don't move
  // the counter; only an exact collision does.
  let addingChild = $state(false);
  let childName = $state('');
  let childBusy = $state(false);
  let childError = $state('');

  function startAddChild() {
    const base = (project.name ?? 'Project').trim();
    const taken = new Set(children.map((c) => (c.name ?? '').trim()));
    let n = 2;
    while (taken.has(`${base} #${n}`)) n++;
    childName = `${base} #${n}`;
    childError = '';
    addingChild = true;
  }

  async function submitChild() {
    const name = childName.trim();
    if (!name || childBusy) return;
    childBusy = true;
    childError = '';
    try {
      // Kind and scope are inherited, not defaulted: a cohort of a
      // "hraðall" is rarely a plain "project", and a child of a private
      // project is private.
      const created = await createProject({
        name,
        kind: project.kind ?? 'project',
        scope: project.scope ?? 'work',
        parent_id: project.id
      });
      // Stay put and show it in the list — adding several cohorts in a row
      // is the common case, and navigating away after each one fights that.
      children = [...children, created];
      addingChild = false;
    } catch (e) {
      childError = e instanceof Error ? e.message : String(e);
    } finally {
      childBusy = false;
    }
  }

  /** Compact year range for a sub-project row (e.g. "2021" or "2020–2021"). */
  function projectYears(c: Project): string {
    const y = (d?: string | null) => (d ? String(new Date(d).getFullYear()) : null);
    const a = y(c.start_date), b = y(c.end_date);
    if (a && b) return a === b ? a : `${a}–${b}`;
    if (a) return `${a}–`;
    if (b) return `–${b}`;
    return '';
  }
</script>

<section class="space-y-6">
  <!-- Hero. When the project (or an ancestor) has an accent colour,
       render a 4px left stripe so the row is instantly identifiable
       across the app — same as a Things 3 list dot. -->
  <!-- No overflow-hidden here: the colour stripe is an *inset* shadow (never
       overflows), and clipping would cut off the hero AvatarUpload's dropdown
       menu — same layout as the org hero. -->
  <div
    class="card relative p-4 sm:p-6"
    style={effectiveColor ? `box-shadow: inset 4px 0 0 ${effectiveColor};` : ''}
  >
    <!-- Floating pencil — icon-only Edit toggle pinned to the
         top-right of the hero. Reveals empty fields and admin actions
         (Publish/Archive/Directus). -->
    <button
      type="button"
      class="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-400 hover:bg-surface-hover hover:text-ink-900 {editing ? 'bg-brand text-white hover:bg-brand hover:text-white' : ''}"
      aria-pressed={editing}
      aria-label={editing ? 'Done editing' : 'Edit project'}
      title={editing ? 'Done — hide empty fields and admin actions' : 'Edit — show every field + admin actions'}
      onclick={() => (editing = !editing)}
    >
      <Icon name={editing ? 'check' : 'pencil'} size={16} />
    </button>

    <div class="flex flex-row items-start gap-3 sm:gap-4">
      <!-- Brand logo in front of the name, mirroring the org hero. -->
      <div class="shrink-0">
        <AvatarUpload
          name={project.name ?? '?'}
          photoOwner={{ collection: 'Project', id: project.id }}
          src={assetUrl(project.brand_logo, { width: 224, height: 224, fit: 'inside' })}
          rawSrc={assetUrl(project.brand_logo)}
          size={96}
          fileId={project.brand_logo}
          focal="contain"
          bgColor={brandBgMain ?? ''}
          title="Click to upload a logo"
          onUploaded={async (fileId) => {
            const patched = await updateProject(project.id, { brand_logo: fileId } as Partial<Project>);
            project = { ...project, ...patched, owner_org_id: project.owner_org_id, parent_id: project.parent_id };
          }}
        />
      </div>
      <div class="min-w-0 flex-1 pr-12">
        <!-- Hierarchy breadcrumb. Renders only when the project has
             ancestors — i.e. it's not a top-level row. Each crumb is a
             link so the user can jump straight to a parent. -->
        {#if ancestors.length > 0}
          <nav class="mb-1 flex flex-wrap items-center gap-1 text-xs text-ink-400" aria-label="Project hierarchy">
            {#each ancestors as a, i (a.id)}
              <a href={`/projects/${a.id}`} class="hover:text-brand">{a.name ?? `Project ${a.id}`}</a>
              <Icon name="chevron-right" size={10} class="text-ink-300" />
              {#if i === ancestors.length - 1}{/if}
            {/each}
            <span class="font-display text-[10px] uppercase tracking-wider text-ink-300">Here</span>
          </nav>
        {/if}
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="flex min-w-0 items-center gap-2 font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
            <EditableField value={project.name ?? null} placeholder="Project name" onSave={(v) => save('name', v)} />
          </h1>
          {#if project.kind}<TagPill tone="online">{project.kind}</TagPill>{/if}
          {#if isDraft}<TagPill tone="sales">draft</TagPill>{/if}
          {#if isArchived}<TagPill tone="neutral">archived</TagPill>{/if}
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
          {#if owner}
            <Icon name="building" size={14} />
            <a href={`/orgs/${owner.id}`} class="hover:text-brand">{owner.name}</a>
          {:else}
            <span class="text-ink-300">No owner org yet</span>
          {/if}
          {#if peopleTotal > 0}
            <span class="text-ink-300">·</span>
            <span>{peopleTotal} {peopleTotal === 1 ? 'person' : 'people'}</span>
          {/if}
          {#if fmtDateRange(project.start_date, project.end_date)}
            <span class="text-ink-300">·</span>
            <span>{fmtDateRange(project.start_date, project.end_date)}</span>
          {/if}
          <!-- The BI view of this project and everything under it. Work-scoped
               only, matching the Orgs/Grants tabs: a personal project has no
               cohort to analyse. -->
          {#if !isPersonal}
            <span class="text-ink-300">·</span>
            <a
              href={`/insights?project=${project.id}`}
              class="inline-flex items-center gap-1 hover:text-brand"
              title="Open the insights dashboard for this project and its cohorts"
            >
              <Icon name="chart-bar" size={14} /> Insights
            </a>
          {/if}
        </div>

        <!-- Admin actions — only surfaced in Edit mode. Day-to-day
             actions (Log / People / Notes / More) live in the
             quick-action tile row below the hero card. -->
        {#if editing}
          <div class="mt-4 flex flex-wrap items-center gap-2">
            {#if isDraft}
              <button class="btn-primary" onclick={publishNow} disabled={publishing} title="Publish this project">
                <Icon name="sparkles" size={16} /> {publishing ? 'Publishing…' : 'Publish'}
              </button>
            {/if}
            <button
              class="btn-ghost {isArchived ? '' : 'text-tag-salesText hover:text-tag-salesText'}"
              onclick={toggleArchive}
              disabled={archiving}
              title={isArchived ? 'Restore from archive' : 'Archive this project'}
            >
              <Icon name="tag" size={16} />
              {archiving ? '…' : isArchived ? 'Unarchive' : 'Archive'}
            </button>
            <a
              class="btn-ghost"
              href={directusAdminUrl('Project', project.id)}
              target="_blank"
              rel="noreferrer"
              title="Open this record in Directus admin"
            >
              <Icon name="settings" size={16} />
              Directus
            </a>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Mobile quick-action tile row. Project-relevant 4: Log activity,
       Owner (jump to org), Notes (scroll), Actions (extras). -->
  <div class="md:hidden">
    <div class="grid grid-cols-4 gap-2">
      <button
        type="button"
        class="flex flex-col items-center justify-center gap-1 rounded-[12px] border border-surface-border bg-surface-card px-2 py-3 text-xs font-medium text-brand hover:bg-surface-hover"
        onclick={() => { tab.value = 'activity'; activityOpenTrigger++; }}
      >
        <Icon name="bolt" size={20} />
        <span>Log</span>
      </button>
      {#if owner}
        <a
          href={`/orgs/${owner.id}`}
          class="flex flex-col items-center justify-center gap-1 rounded-[12px] border border-surface-border bg-surface-card px-2 py-3 text-xs font-medium text-brand hover:bg-surface-hover"
        >
          <Icon name="building" size={20} />
          <span>Owner</span>
        </a>
      {:else}
        <div
          class="flex flex-col items-center justify-center gap-1 rounded-[12px] border border-surface-border bg-surface-card px-2 py-3 text-xs font-medium text-ink-300 opacity-60"
          aria-disabled="true"
          title="No owner org set"
        >
          <Icon name="building" size={20} />
          <span>Owner</span>
        </div>
      {/if}
      <button
        type="button"
        class="flex flex-col items-center justify-center gap-1 rounded-[12px] border border-surface-border bg-surface-card px-2 py-3 text-xs font-medium text-brand hover:bg-surface-hover"
        onclick={() => { tab.value = 'activity'; activityFilter = 'notes'; }}
      >
        <Icon name="notebook" size={20} />
        <span>Notes</span>
      </button>
      <button
        type="button"
        class="flex flex-col items-center justify-center gap-1 rounded-[12px] border border-surface-border bg-surface-card px-2 py-3 text-xs font-medium text-brand hover:bg-surface-hover {mobileActionsOpen ? 'ring-2 ring-brand' : ''}"
        aria-expanded={mobileActionsOpen}
        aria-controls="project-mobile-actions-panel"
        onclick={() => (mobileActionsOpen = !mobileActionsOpen)}
      >
        <Icon name={mobileActionsOpen ? 'x' : 'sparkles'} size={20} />
        <span>{mobileActionsOpen ? 'Close' : 'Actions'}</span>
      </button>
    </div>
    {#if mobileActionsOpen}
      <ul id="project-mobile-actions-panel" class="mt-2 overflow-hidden rounded-[12px] border border-surface-border bg-surface-card text-sm">
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover"
            onclick={() => { tab.value = 'activity'; activityFilter = 'events'; mobileActionsOpen = false; }}
          >
            <Icon name="calendar" size={16} /> View events
          </button>
        </li>
        {#if isDraft}
          <li class="border-t border-surface-divider">
            <button
              type="button"
              class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover"
              onclick={() => { publishNow(); mobileActionsOpen = false; }}
              disabled={publishing}
            >
              <Icon name="sparkles" size={16} /> Publish project
            </button>
          </li>
        {/if}
        <li class="border-t border-surface-divider">
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover {isArchived ? '' : 'text-tag-salesText'}"
            onclick={() => { toggleArchive(); mobileActionsOpen = false; }}
            disabled={archiving}
          >
            <Icon name="tag" size={16} /> {isArchived ? 'Unarchive project' : 'Archive project'}
          </button>
        </li>
        <li class="border-t border-surface-divider">
          <a
            class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover"
            href={directusAdminUrl('Project', project.id)}
            target="_blank"
            rel="noreferrer"
            onclick={() => (mobileActionsOpen = false)}
          >
            <Icon name="settings" size={16} /> Open in Directus
          </a>
        </li>
      </ul>
    {/if}
  </div>

  <div class="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
    <!-- LEFT details -->
    <div class="min-w-0 space-y-5">
      <!-- Details card is edit-mode furniture: in view mode the hero
           already carries owner, parent (breadcrumb), kind and dates. -->
      {#if editing}
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="sparkles" size={16} /> Project details</span>
        </div>
        <dl class="divide-y divide-surface-divider px-4 pb-3 text-sm">
          <!-- Owner org always editable inline — it's the most common
               project edit. -->
          <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:py-1.5">
            <dt class="text-ink-400 sm:mt-1">Owner org</dt>
            <dd class="min-w-0 sm:text-right">
              {#if editingOwner}
                <input type="text" autocomplete="off" class="input w-full sm:w-52 text-sm"
                       placeholder="Search orgs…" value={ownerQuery} oninput={onOwnerQuery} />
                {#if ownerResults.length > 0}
                  <ul class="mt-1 max-h-56 w-full sm:w-52 overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card text-left">
                    {#each ownerResults as o (o.id)}
                      <li>
                        <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => pickOwner(o)}>
                          <Icon name="building" size={14} />
                          <span class="truncate">{o.name}</span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
                <div class="mt-1 flex gap-2 sm:justify-end text-xs">
                  <button class="text-ink-400 hover:text-ink-700" onclick={() => pickOwner(null)}>Clear</button>
                  <button class="text-ink-400 hover:text-ink-700" onclick={() => (editingOwner = false)}>Cancel</button>
                </div>
              {:else}
                <button class="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ink-900 hover:bg-surface-hover sm:text-right" onclick={() => (editingOwner = true)}>
                  {#if owner}
                    {owner.name}
                  {:else}
                    <span class="text-ink-300">Set owner</span>
                  {/if}
                </button>
              {/if}
            </dd>
          </div>
          <!-- Parent project — anchors this row in the hierarchy.
               Always editable inline, like Owner org. -->
          <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:py-1.5">
            <dt class="text-ink-400 sm:mt-1">Parent project</dt>
            <dd class="min-w-0 sm:text-right">
              {#if editingParent}
                <input type="text" autocomplete="off" class="input w-full sm:w-52 text-sm"
                       placeholder="Search projects…" value={parentQuery} oninput={onParentQuery} />
                {#if parentResults.length > 0}
                  <ul class="mt-1 max-h-56 w-full sm:w-52 overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card text-left">
                    {#each parentResults as p (p.id)}
                      <li>
                        <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => pickParent(p)}>
                          <Icon name="sparkles" size={14} />
                          <span class="truncate">{p.name ?? `Project ${p.id}`}</span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
                <div class="mt-1 flex gap-2 sm:justify-end text-xs">
                  <button class="text-ink-400 hover:text-ink-700" onclick={() => pickParent(null)}>Clear</button>
                  <button class="text-ink-400 hover:text-ink-700" onclick={() => (editingParent = false)}>Cancel</button>
                </div>
              {:else}
                <button class="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ink-900 hover:bg-surface-hover sm:text-right" onclick={() => (editingParent = true)}>
                  {#if parent}
                    {parent.name ?? `Project ${parent.id}`}
                  {:else}
                    <span class="text-ink-300">Top-level — no parent</span>
                  {/if}
                </button>
              {/if}
            </dd>
          </div>
          {#if editing || hasValue(project.kind)}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Kind</dt>
              <dd>
                <EditableField value={project.kind ?? null} type="select"
                  options={[
                    { label: 'Project', value: 'project' },
                    { label: 'Course', value: 'course' },
                    { label: 'Program', value: 'program' },
                    { label: 'Campaign', value: 'campaign' },
                    { label: 'Theme', value: 'theme' },
                    { label: 'Hraðall', value: 'hraðall' },
                    { label: 'Hugmyndahraðhlaup', value: 'hugmyndahraðhlaup' },
                    { label: 'Other', value: 'other' }
                  ]}
                  onSave={(v) => save('kind', v)} />
              </dd>
            </div>
          {/if}
          <!-- Colour swatch picker.
               View mode: show only the current swatch (or "inherited"
               hint, or "—" when nothing is set). Keeps the details
               card quiet.
               Edit mode: show the full PROJECT_COLORS palette so the
               user can change it. Stays on-palette in both modes. -->
          {#if editing || project.color || inheritedColor}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Colour</dt>
              <dd class="flex flex-wrap items-center gap-1.5 sm:justify-end">
                {#if editing}
                  {#each PROJECT_COLORS as c (c.value)}
                    {@const isActive = project.color === c.value}
                    <button
                      type="button"
                      class="h-5 w-5 rounded-full transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand {isActive ? 'ring-2 ring-offset-1' : ''}"
                      style="background:{c.value}; {isActive ? 'box-shadow: 0 0 0 2px var(--surface-card), 0 0 0 4px ' + c.value + ';' : ''}"
                      title={c.label}
                      aria-label={`Pick ${c.label}`}
                      aria-pressed={isActive}
                      onclick={() => save('color', c.value)}
                    ></button>
                  {/each}
                  {#if project.color}
                    <button
                      type="button"
                      class="ml-1 text-xs text-ink-400 hover:text-ink-700"
                      onclick={() => save('color', null)}
                      title="Clear colour"
                    >Clear</button>
                  {:else if inheritedColor}
                    <span class="ml-1 inline-flex items-center gap-1 text-xs text-ink-400">
                      <span class="h-2 w-2 rounded-full opacity-60" style="background:{inheritedColor};"></span>
                      inherited
                    </span>
                  {/if}
                {:else}
                  <!-- View mode: one swatch + label. -->
                  {#if project.color}
                    {@const swatch = PROJECT_COLORS.find((c) => c.value === project.color)}
                    <span class="inline-flex items-center gap-1.5 text-ink-700">
                      <span class="h-3 w-3 rounded-full" style="background:{project.color};" aria-hidden="true"></span>
                      <span>{swatch?.label ?? project.color}</span>
                    </span>
                  {:else if inheritedColor}
                    {@const swatch = PROJECT_COLORS.find((c) => c.value === inheritedColor)}
                    <span class="inline-flex items-center gap-1.5 text-ink-500">
                      <span class="h-3 w-3 rounded-full opacity-60" style="background:{inheritedColor};" aria-hidden="true"></span>
                      <span>{swatch?.label ?? inheritedColor} <span class="text-ink-300">(inherited)</span></span>
                    </span>
                  {/if}
                {/if}
              </dd>
            </div>
          {/if}
          {#if editing || hasValue(project.start_date)}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Start</dt>
              <dd class="min-w-0 flex-1"><EditableField value={project.start_date} type="date" onSave={(v) => save('start_date', v)} /></dd>
            </div>
          {/if}
          {#if editing || hasValue(project.end_date)}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">End</dt>
              <dd class="min-w-0 flex-1"><EditableField value={project.end_date} type="date" onSave={(v) => save('end_date', v)} /></dd>
            </div>
          {/if}
          <!-- Scope is administrative — only show in Edit mode. -->
          {#if editing}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Scope</dt>
              <dd>
                <EditableField value={project.scope ?? null} type="select"
                  options={[
                    { label: 'Work', value: 'work' },
                    { label: 'Private', value: 'private' },
                    { label: 'Both', value: 'both' }
                  ]}
                  onSave={(v) => save('scope', v)} />
              </dd>
            </div>
          {/if}
          <!-- Status owned by hero pills + Edit-mode admin actions. -->
        </dl>
      </div>
      {/if}

      <!-- Summary — view mode shows only filled languages, and hides the
           card entirely while empty; edit mode surfaces the prompts. -->
      {#if editing || hasValue(project.summary) || hasValue(project.summary_en)}
        <div class="card p-4 space-y-3">
          <div class="card-title"><Icon name="tag" size={16} /> Summary</div>
          {#if editing || hasValue(project.summary)}
            <div>
              <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Íslenska</div>
              <EditableField value={project.summary} placeholder="Um hvað snýst þetta verkefni?" onSave={(v) => save('summary', v)} />
            </div>
          {/if}
          {#if editing || hasValue(project.summary_en)}
            <div>
              <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">English</div>
              <EditableField value={project.summary_en} placeholder="What is this project about?" onSave={(v) => save('summary_en', v)} />
            </div>
          {/if}
        </div>
      {/if}

      <!-- Sponsors — only when this project has one of its own, or while
           editing so you can add the first. Sits in the main column rather
           than inside the Orgs tab: a sponsor credit is something you read at
           a glance, not something you go digging for. -->
      {#if directSponsors.length > 0 || editing}
        <SponsorsCard bind:links={organisations} roles={orgRoles} projectId={project.id} />
      {/if}

      <!-- Brand SNAPSHOT, not an editor. Tapping the strip expands the
           read-only sheet; the pencil goes to the brand book, which is the
           only place a brand is edited. This used to unfold a second full
           editor here, which meant two places to look for why a colour
           changed — and this one had no room for the lockup grid. -->
      {#key project.id}
        <BrandCard {project} kind="project" />
      {/key}

      <!-- Events connected to this project (reverse lookup). -->
      {#key project.id}
        <EventsCard entity="project" id={project.id} />
      {/key}

      <!-- Links & dynamic info — shared drives, briefs, reference URLs. -->
      {#key project.id}
        <LinksCard collection="Project" itemId={project.id} />
      {/key}
    </div>

    <!-- RIGHT: tabs. People / Organisations only render when at
         least one entry exists — empty-state cards stay in Overview
         so the user has a single entry point to add the first one. -->
    <div class="min-w-0 space-y-5">
      <div class="card">
        <div class="flex items-center gap-2 border-b border-surface-divider px-4 overflow-x-auto">
          <button
            class="relative flex shrink-0 items-center gap-2 px-2 py-3 text-sm font-medium transition {tab.value === 'overview' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
            onclick={() => (tab.value = 'overview')}
          >
            <Icon name="sparkles" size={14} /> Overview
            {#if tab.value === 'overview'}
              <span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>
            {/if}
          </button>
          {#if peopleTotal > 0}
            <button
              class="relative flex shrink-0 items-center gap-2 px-2 py-3 text-sm font-medium transition {tab.value === 'people' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
              onclick={() => (tab.value = 'people')}
            >
              <Icon name="users" size={14} /> People <span class="text-ink-300">{peopleTotal}</span>
              {#if tab.value === 'people'}
                <span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>
              {/if}
            </button>
          {/if}
          {#if orgsTotal > 0 && !isPersonal}
            <button
              class="relative flex shrink-0 items-center gap-2 px-2 py-3 text-sm font-medium transition {tab.value === 'organisations' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
              onclick={() => (tab.value = 'organisations')}
            >
              <Icon name="building" size={14} /> Orgs <span class="text-ink-300">{orgsTotal}</span>
              {#if tab.value === 'organisations'}
                <span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>
              {/if}
            </button>
          {/if}
          <button
            class="relative flex shrink-0 items-center gap-2 px-2 py-3 text-sm font-medium transition {tab.value === 'activity' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
            onclick={() => (tab.value = 'activity')}
          >
            <Icon name="calendar" size={14} /> Activity
            {#if tab.value === 'activity'}
              <span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>
            {/if}
          </button>
        </div>

        {#if tab.value === 'overview'}
          <div class="space-y-5 p-4">
            <!-- Budget & spend. Scoped to this project and its cohorts; the
                 drills and the envelope editor live elsewhere so there is one
                 of each. -->
            {#if data.spend}
              <BudgetCard bundle={data.spend} projectId={project.id} projectName={project.name ?? 'this project'} />
            {/if}
            <!-- Empty-state entry points only — once at least one
                 person / org is attached, the card moves to its own
                 tab and the Overview drops the duplicate. -->
            {#if peopleTotal === 0}
              <ProjectPeopleCard bind:people bind:inherited={peopleInherited} inheritedTotal={peopleInheritedTotal} {children} projectId={project.id} />
            {/if}
            {#if orgsTotal === 0 && !isPersonal}
              <ProjectOrgsCard bind:orgs={organisations} bind:inherited={orgsInherited} inheritedTotal={orgsInheritedTotal} {children} projectId={project.id} />
            {/if}

            <!-- Sub-projects card. Always mounted now that "Add" lives in
                 its header — a project with no children is exactly the one
                 that needs the button most. -->
            <div class="card">
              <div class="card-header">
                <span class="card-title">
                  <Icon name="sparkles" size={16} />
                  Sub-projects
                  <span class="text-ink-300 font-normal">{children.length}</span>
                </span>
                {#if !addingChild}
                  <button
                    class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
                    onclick={startAddChild}
                  ><Icon name="plus" size={14} /> Add</button>
                {/if}
              </div>

              {#if addingChild}
                <div class="border-b border-surface-divider p-4 space-y-2">
                  <label class="block">
                    <span class="mb-1 block text-xs text-ink-400">Name *</span>
                    <!-- svelte-ignore a11y_autofocus -->
                    <input
                      type="text"
                      class="input w-full"
                      bind:value={childName}
                      autofocus
                      onkeydown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void submitChild(); }
                        if (e.key === 'Escape') addingChild = false;
                      }}
                    />
                  </label>
                  <p class="text-xs text-ink-400">
                    Inherits <span class="font-medium">{project.kind ?? 'project'}</span>
                    and <span class="font-medium">{project.scope ?? 'work'}</span> from this project.
                  </p>
                  {#if childError}<div class="text-xs text-tag-salesText">{childError}</div>{/if}
                  <div class="flex justify-end gap-2">
                    <button class="btn-ghost text-xs" onclick={() => (addingChild = false)} disabled={childBusy}>Cancel</button>
                    <button class="btn-primary text-xs" onclick={submitChild} disabled={childBusy || !childName.trim()}>
                      {childBusy ? 'Creating…' : 'Create'}
                    </button>
                  </div>
                </div>
              {/if}

              {#if children.length === 0 && !addingChild}
                <p class="p-4 text-sm text-ink-400">
                  No sub-projects yet. Add one to split this into cohorts or years.
                </p>
              {:else}
                <ul class="divide-y divide-surface-divider">
                  {#each sortedChildren as c (c.id)}
                    <li>
                      <a
                        href={`/projects/${c.id}`}
                        class="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover"
                      >
                        <Icon name="chevron-right" size={12} class="shrink-0 text-ink-300" />
                        <div class="min-w-0 flex-1">
                          <div class="truncate font-medium text-ink-900">{c.name ?? `Project ${c.id}`}</div>
                          {#if c.summary || c.kind}
                            <div class="truncate text-xs text-ink-500">
                              {[c.kind, c.summary].filter(Boolean).join(' · ')}
                            </div>
                          {/if}
                        </div>
                        {#if projectYears(c)}<span class="shrink-0 text-xs tabular-nums text-ink-400">{projectYears(c)}</span>{/if}
                        {#if c.status === 'draft'}<TagPill tone="sales">draft</TagPill>{/if}
                        {#if c.status === 'archived'}<TagPill tone="neutral">archived</TagPill>{/if}
                      </a>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>

            <!-- Grants roll-up. Mounts on every project (the card
                 handles the empty state) so the same Overview tab
                 stays predictable; scopeLabel only renders when the
                 roll-up is genuinely cross-cohort. -->
            {#if !isPersonal}
              <ProjectGrantsCard awards={awards} scopeLabel={grantsScopeLabel} />
            {/if}

            <!-- Receipts tagged to this project. Grants are money in, this
                 is money out — same tab, so the pair reads together. -->
            <ReceiptExpensesCard projectId={project.id} />

            <!-- NAS photos tagged to this project via photo_link —
                 event coverage, cohort sessions. Ids only; the photos
                 stay in Immich. -->
            <div class="card">
              <div class="card-header">
                <span class="card-title"><Icon name="image" size={16} /> Photo library</span>
              </div>
              <div class="p-4">
                <ItemPhotos collection="Project" itemId={project.id} />
              </div>
            </div>
          </div>
        {:else if tab.value === 'people'}
          <div class="p-4">
            <ProjectPeopleCard bind:people bind:inherited={peopleInherited} inheritedTotal={peopleInheritedTotal} {children} projectId={project.id} />
          </div>
        {:else if tab.value === 'organisations'}
          <div class="p-4">
            <ProjectOrgsCard bind:orgs={organisations} bind:inherited={orgsInherited} inheritedTotal={orgsInheritedTotal} {children} projectId={project.id} />
          </div>
        {:else}
          <!-- Activity = three time-based streams: interactions, notes,
               events. Same filter-chip pattern as /people/[id]. -->
          <div class="space-y-4 p-4">
            {#if activityFilter === 'all' || activityFilter === 'activities'}
              <QuickLogChips context={{ kind: 'project', projectId: project.id }} />
            {/if}

            <div
              class="flex flex-wrap items-center gap-1.5"
              role="radiogroup"
              aria-label="Activity filter"
            >
              {#each ACTIVITY_FILTERS as f (f.value)}
                {@const selected = activityFilter === f.value}
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  class="chip-radio"
                  class:is-selected={selected}
                  onclick={() => (activityFilter = f.value)}
                >
                  <Icon name={f.icon} size={12} />
                  {f.label}
                </button>
              {/each}
            </div>

            {#if activityFilter === 'all' || activityFilter === 'activities'}
              <ActivityCard
                context={{ kind: 'project', projectId: project.id }}
                openTrigger={activityOpenTrigger}
              />
            {/if}
            {#if activityFilter === 'all' || activityFilter === 'notes'}
              <RelatedNotes collection="Project" itemId={project.id} />
            {/if}
            {#if activityFilter === 'all' || activityFilter === 'events'}
              <LinkedEvents kind="project" id={project.id} />
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</section>
