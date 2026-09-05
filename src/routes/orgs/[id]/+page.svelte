<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import EditableField from '$lib/EditableField.svelte';
  import PeopleAtOrgCard from '$lib/PeopleAtOrgCard.svelte';
  import RecordHistory from '$lib/RecordHistory.svelte';
  import OrgProjectsCard from '$lib/OrgProjectsCard.svelte';
  import BrandCard from '$lib/admin/BrandCard.svelte';
  import NewsCoverage from '$lib/news/NewsCoverage.svelte';
  import OrgGrantsCard from '$lib/OrgGrantsCard.svelte';
  import ReceiptExpensesCard from '$lib/ReceiptExpensesCard.svelte';
  import TagsCard from '$lib/TagsCard.svelte';
  import OrgSocialCard from '$lib/OrgSocialCard.svelte';
  import { socialIcon, socialLabel, socialDisplay, type OrgSocial } from '$lib/orgSocial';
  import ActivityCard from '$lib/ActivityCard.svelte';
  import QuickLogChips from '$lib/QuickLogChips.svelte';
  import RelatedNotes from '$lib/RelatedNotes.svelte';
  import OrgPhotos from '$lib/OrgPhotos.svelte';
  import AddFacetRow from '$lib/AddFacetRow.svelte';
  import ItemPhotos from '$lib/photos/ItemPhotos.svelte';
  import LinkedEvents from '$lib/LinkedEvents.svelte';
  import EventsCard from '$lib/events/EventsCard.svelte';
  import AvatarUpload from '$lib/AvatarUpload.svelte';
  import EnrichOrgDialog from '$lib/EnrichOrgDialog.svelte';
  import MergeOrgDialog from '$lib/MergeOrgDialog.svelte';
  import RebrandOrgDialog from '$lib/RebrandOrgDialog.svelte';
  import { goto } from '$app/navigation';
  import { formatCompactMoney } from '$lib/insights/metrics';
  import { formatGrantAmount, personName, assetUrl, updateOrg, setOrgStatus, orgSizeLabel, ORG_SIZE_OPTIONS, ORG_INDUSTRY_OPTIONS, ORG_LIFECYCLE_OPTIONS, ALL_REGION_CHOICES, industryLabel, orgLifecycleLabel, orgLifecycleColor, directusAdminUrl, type Organization, type Person, type Role, type OrganizationTag, type OrgProject, type GrantAward } from '$lib/directus';
  import { repo } from '$lib/data/repo';

  let { data }: { data: { org: Organization; roles: Role[]; projects: OrgProject[]; tags: OrganizationTag[]; previousIdentities: Array<Pick<Organization, 'id' | 'name' | 'lifecycle_status' | 'logo' | 'image_focal'>>; grantAwards: GrantAward[] } } = $props();
  let org = $state<Organization>(data.org);
  let roles = $state<Role[]>(data.roles);
  let projects = $state<OrgProject[]>(data.projects);
  let orgTagLinks = $state<OrganizationTag[]>(data.tags);
  let previousIdentities = $state<typeof data.previousIdentities>(data.previousIdentities ?? []);
  let grantAwards = $state<GrantAward[]>(data.grantAwards ?? []);
  $effect(() => {
    org = data.org;
    roles = data.roles;
    projects = data.projects;
    orgTagLinks = data.tags;
    previousIdentities = data.previousIdentities ?? [];
    grantAwards = data.grantAwards ?? [];
  });

  // Numeric org fields — coerce string inputs to integers before sending.
  const NUMERIC_FIELDS: ReadonlySet<string> = new Set([
    'employee_count', 'founded_year', 'annual_revenue_isk'
  ]);
  let conflictWith = $state<{ id: number; name: string; field: string; value: string } | null>(null);

  async function save(field: keyof Organization, value: string | null) {
    let payload: string | number | null = value;
    if (NUMERIC_FIELDS.has(field as string)) {
      if (value == null || String(value).trim() === '') payload = null;
      else {
        const n = Number(String(value).replace(/[^0-9.-]/g, ''));
        payload = Number.isFinite(n) ? n : null;
      }
    }
    try {
      const patched = await updateOrg(org.id, { [field]: payload } as Partial<Organization>);
      org = { ...org, ...patched };
      conflictWith = null;
    } catch (e) {
      // If the unique constraint blocked us, find the row that already owns
      // this value and surface a banner with a link so the user can decide
      // (merge, archive, or pick a different value). Only kicks in for
      // RECORD_NOT_UNIQUE — other errors keep the existing inline message.
      const errs = (e as { errors?: Array<{ extensions?: { code?: string; field?: string; value?: string } }> })?.errors;
      const ext = errs?.[0]?.extensions;
      if (ext?.code === 'RECORD_NOT_UNIQUE' && ext.field && ext.value != null) {
        try {
          const found = await repo.list<{ id: number; name: string }>('organization', {
            where: { field: ext.field, op: 'eq', value: ext.value },
            fields: ['id', 'name'],
            limit: 1
          });
          if (found.length > 0 && found[0].id !== org.id) {
            conflictWith = {
              id: found[0].id,
              name: found[0].name ?? `org #${found[0].id}`,
              field: ext.field,
              value: String(ext.value)
            };
          }
        } catch {
          /* fall through to rethrow */
        }
      }
      throw e; // re-throw so EditableField shows its inline error too
    }
  }

  // Fed by OrgSocialCard so the header glyphs and the card never disagree, and
  // so adding a profile lights up its icon without a reload.
  let socials = $state<OrgSocial[]>([]);

  let archiving = $state(false);
  let publishing = $state(false);
  let enriching = $state(false);
  let togglingActive = $state(false);
  let merging = $state(false);
  let rebranding = $state(false);
  let editing = $state(false);

  // ── Facet visibility ────────────────────────────────────────────────
  // Same treatment as the person page: a card earns its place by having
  // rows. Measured across 4,186 live orgs: tags 1%, socials 6%, photos 5%,
  // grants 28% — on a typical org four boxes stacked up announcing nothing
  // (Dark Music Days: no grants, no receipts, no photos, no library). Absent
  // facets collapse into one Add row; cards stay mounted (hidden attribute)
  // so the self-loading ones can run and report their counts.
  let receiptCount = $state<number | null>(null);
  let orgPhotoCount = $state<number | null>(null);
  let libraryCount = $state<number | null>(null);
  let openFacets = $state<Record<string, boolean>>({});
  const showTags = $derived(!!openFacets.tags || orgTagLinks.length > 0);
  // Socials also surface while editing: their editor lives inside the card.
  // Socials are already in the header as a glyph row, so this card is an
  // EDITOR, not a second display. It appears while editing, or when asked
  // for via the Add row — which is only offered when there are none yet.
  const showSocials = $derived(!!openFacets.socials || editing);
  // orgSizeLabel() renders the exact employee count when there is one and
  // falls back to the bucket, so the header pill already conveys the org's
  // size in whichever form exists. Both size rows key off this, and so does
  // the Size & enrichment wrapper — otherwise an org whose only facts are
  // size and org type gets a card with no rows in it.
  const sizeInHeader = $derived(orgSizeLabel(org) !== null);

  const showGrants = $derived(!!openFacets.grants || grantAwards.length > 0);

  // Header grant summary. Totals are kept per currency and never summed
  // across them — an org with an ISK grant and a EUR grant has two totals,
  // not one meaningless number. Mirrors OrgGrantsCard's own arithmetic.
  const grantTotals = $derived.by(() => {
    const m = new Map<string, number>();
    for (const a of grantAwards) {
      const cur = a.currency ?? 'ISK';
      const n = typeof a.total_amount === 'number' ? a.total_amount : Number(a.total_amount ?? 0);
      if (Number.isFinite(n)) m.set(cur, (m.get(cur) ?? 0) + n);
    }
    return {
      // "2bn ISK" for the header line — 1,978,169,626 is nine digits of
      // precision nobody reads at a glance.
      compact: [...m.entries()].map(([cur, n]) => formatCompactMoney(n, cur)),
      // …with the exact figure on hover, and in the card one click below.
      exact: [...m.entries()].map(([cur, n]) => formatGrantAmount(n, cur))
    };
  });

  // The card lives inside the Overview tab, so a plain #grants anchor breaks
  // whenever the People tab is open — the target isn't in the DOM. Switch
  // tabs first, then scroll once the card has rendered.
  function jumpToGrants() {
    openFacets.grants = true;
    tab.value = 'overview';
    setTimeout(() => document.getElementById('grants')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
  const showReceipts = $derived(!!openFacets.receipts || (receiptCount ?? 0) > 0);
  const showOrgPhotos = $derived(!!openFacets.photos || (orgPhotoCount ?? 0) > 0);
  const showLibrary = $derived(!!openFacets.library || (libraryCount ?? 0) > 0);
  let activityOpenTrigger = $state(0);
  // Mobile quick-action row's "More" tile expands an inline panel.
  let mobileActionsOpen = $state(false);

  // Row counts as "empty" when null/undefined or blank string.
  function hasValue(v: unknown): boolean {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    return true;
  }

  // Composed postal address (view mode) and Google Maps deep link.
  const addressLines = $derived(
    [
      org.address_line1,
      org.address_line2,
      [org.postal_code, org.city].filter(Boolean).join(' '),
      [org.state_province, org.country].filter(Boolean).join(', ')
    ].filter((l) => !!l && l.trim())
  );
  const hasAnyLocation = $derived(
    hasValue(org.address_line1) || hasValue(org.address_line2) ||
    hasValue(org.postal_code) || hasValue(org.city) ||
    hasValue(org.state_province) || hasValue(org.country)
  );
  const mapsQuery = $derived(
    [
      org.name,
      org.address_line1,
      org.address_line2,
      org.postal_code,
      org.city,
      org.state_province,
      org.country
    ]
      .filter((v) => !!v && String(v).trim())
      .join(', ')
  );
  const mapsHref = $derived(
    mapsQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
      : null
  );
  const isArchived = $derived(org.status === 'archived');
  const isDraft = $derived(org.status === 'draft');
  const isInactive = $derived(org.is_active === false);

  // Group role rows by person — one person can hold several roles
  // (Co-founder AND CEO) without appearing as duplicate entries or
  // inflating the People count.
  const peopleGroups = $derived.by(() => {
    const m = new Map<number, { person: Person; rows: Role[] }>();
    for (const r of roles) {
      const p = typeof r.person_id === 'object' && r.person_id ? (r.person_id as Person) : null;
      if (!p) continue;
      const g = m.get(p.id) ?? { person: p, rows: [] };
      g.rows.push(r);
      m.set(p.id, g);
    }
    for (const g of m.values()) g.rows.sort((a, b) => Number(!!b.is_current) - Number(!!a.is_current));
    return [...m.values()];
  });
  const peopleCount = $derived(peopleGroups.length);
  // People and Activities were left unconditional on the theory that they are
  // the identity of an org page. On a defunct org with neither, "People 0" and
  // "Activities 0" are the same empty announcement the rest of this row
  // removes. Both keep their add path: the People tab stays in the tab bar
  // whatever its count, and QuickLogChips sits above Activities regardless.
  let activityCount = $state<number | null>(null);
  const showPeople = $derived(!!openFacets.people || peopleCount > 0);
  const showActivities = $derived(!!openFacets.activities || (activityCount ?? 0) > 0);

  async function publishNow() {
    publishing = true;
    try {
      const updated = await setOrgStatus(org.id, 'published');
      org = { ...org, ...updated };
    } finally {
      publishing = false;
    }
  }
  async function toggleActive() {
    togglingActive = true;
    try {
      const next = !isInactive ? false : true; // currently active → mark inactive, and vice versa
      const patch = await updateOrg(org.id, { is_active: next });
      org = { ...org, ...patch };
    } finally {
      togglingActive = false;
    }
  }

  async function toggleArchive() {
    const msg = isArchived
      ? `Restore ${org.name ?? 'this organization'} from the archive?`
      : `Archive ${org.name ?? 'this organization'}? It will be hidden from lists but not deleted, and its role links stay intact.`;
    if (!confirm(msg)) return;
    archiving = true;
    try {
      const next = isArchived ? 'published' : 'archived';
      const updated = await setOrgStatus(org.id, next);
      org = { ...org, ...updated };
      if (!isArchived) goto('/orgs');
    } finally {
      archiving = false;
    }
  }

  function personOf(r: Role): Person | null {
    return r.person_id && typeof r.person_id === 'object' ? (r.person_id as Person) : null;
  }

  const current = $derived(roles.filter((r) => r.is_current));
  const past = $derived(roles.filter((r) => !r.is_current));

  function fmtYear(d?: string | null) {
    if (!d) return '';
    try { return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(new Date(d)); }
    catch { return d; }
  }

  function fmtDate(s?: string | null) {
    if (!s) return '—';
    try { return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(s)); }
    catch { return s; }
  }

  const tab = $state({ value: 'overview' as 'overview' | 'people' });

  function scopeTone(s?: string | null): 'online' | 'chat' | 'neutral' {
    if (s === 'work') return 'online';
    if (s === 'private') return 'chat';
    return 'neutral';
  }
</script>

<section class="space-y-6">
  {#if conflictWith}
    <div class="rounded-card border border-tag-chat bg-tag-chat/40 px-4 py-3 text-sm text-tag-chatText">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon name="building" size={16} />
        <span>
          The {conflictWith.field} <code class="font-medium">{conflictWith.value}</code> is already on
          <a href={`/orgs/${conflictWith.id}`} class="font-semibold underline">{conflictWith.name}</a>.
          Open it to merge, or pick a different value here.
        </span>
        <button class="ml-auto text-xs underline" onclick={() => (conflictWith = null)}>dismiss</button>
      </div>
    </div>
  {/if}

  {#if org.successor_id}
    {@const succ = typeof org.successor_id === 'object' ? org.successor_id : null}
    {@const isRebrand = org.lifecycle_status === 'rebranded'}
    <div class="rounded-card border border-surface-border bg-surface-hover px-4 py-3 text-sm text-ink-700">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon name={isRebrand ? 'move' : 'building'} size={16} />
        <span>
          {isRebrand ? 'Rebranded as' : 'This row was merged into'}
          {#if succ?.id}
            <a href={`/orgs/${succ.id}`} class="font-semibold text-brand hover:underline">{succ.name ?? `org #${succ.id}`}</a>
          {:else}
            <a href={`/orgs/${org.successor_id}`} class="font-semibold text-brand hover:underline">org #{org.successor_id}</a>
          {/if}
          {isRebrand ? '— historical relations stay on this row.' : 'and is kept here for history only.'}
        </span>
      </div>
    </div>
  {/if}

  <!-- Hero -->
  <div class="card relative p-4 sm:p-6">
    <!-- Floating pencil — icon-only Edit toggle pinned to the
         top-right of the hero. Reveals empty fields, admin actions
         (Publish/Merge/Active/Archive/Directus). -->
    <button
      type="button"
      class="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-400 hover:bg-surface-hover hover:text-ink-900 {editing ? 'bg-brand text-white hover:bg-brand hover:text-white' : ''}"
      aria-pressed={editing}
      aria-label={editing ? 'Done editing' : 'Edit organization'}
      title={editing ? 'Done — hide empty fields and admin actions' : 'Edit — show every field + admin actions'}
      onclick={() => (editing = !editing)}
    >
      <Icon name={editing ? 'check' : 'pencil'} size={16} />
    </button>
    <div class="flex flex-row items-start gap-3 sm:gap-5 sm:items-center">
      <div class="shrink-0">
        <AvatarUpload
          name={org.name ?? '?'}
          photoOwner={{ collection: 'organization', id: org.id }}
          src={assetUrl(org.logo, { width: 320, height: 320, fit: 'inside' })}
          rawSrc={assetUrl(org.logo)}
          size={160}
          focal={org.image_focal}
          fileId={org.logo}
          website={org.website ?? ''}
          title="Click to upload a logo"
          onUploaded={async (fileId) => {
            const patched = await updateOrg(org.id, { logo: fileId } as Partial<Organization>);
            org = { ...org, ...patched };
          }}
          onFocalChange={async (f) => {
            const patched = await updateOrg(org.id, { image_focal: f } as Partial<Organization>);
            org = { ...org, ...patched };
          }}
        />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="flex min-w-0 items-center gap-2 font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
            <EditableField
              value={org.name ?? null}
              placeholder="Add name"
              onSave={(v) => save('name', v)}
            />
          </h1>
          {#if org.industry}<TagPill tone="online">{industryLabel(org.industry)}</TagPill>{/if}
          {#if orgSizeLabel(org)}<TagPill tone="neutral">{orgSizeLabel(org)}</TagPill>{/if}
          {#if org.org_type}<TagPill tone="neutral">{org.org_type}</TagPill>{/if}
          {#if org.scope === 'work' || org.scope === 'both'}
            <TagPill tone="online">Work</TagPill>
          {/if}
          {#if org.scope === 'private' || org.scope === 'both'}
            <TagPill tone="chat">Private</TagPill>
          {/if}
          {#if isDraft}<TagPill tone="sales">draft</TagPill>{/if}
          {#if isArchived}<TagPill tone="neutral">archived</TagPill>{/if}
          {#if org.is_active === false}<TagPill tone="neutral">inactive</TagPill>{/if}
          <!-- Lifecycle pill — only renders when set. Tinted with the
               status's own colour so "Dissolved" reads at a glance. -->
          {#if org.lifecycle_status}
            {@const lcColor = orgLifecycleColor(org.lifecycle_status)}
            <span
              class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
              style={lcColor ? `background:${lcColor}22; color:${lcColor}; border:1px solid ${lcColor}55;` : ''}
              title="Lifecycle status"
            >{orgLifecycleLabel(org.lifecycle_status)}</span>
          {/if}
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
          {#if org.legal_name}
            <span class="text-ink-400">Legal: {org.legal_name}</span>
          {/if}
          {#if org.previous_names}
            <span class="text-ink-300">·</span>
            <span class="text-ink-400" title={org.previous_names}>formerly {org.previous_names}</span>
          {/if}
          {#if grantAwards.length > 0}
            <span class="text-ink-300">·</span>
            <button
              type="button"
              class="inline-flex items-center gap-1 hover:text-brand"
              onclick={jumpToGrants}
              title={`${grantAwards.length} grant${grantAwards.length === 1 ? '' : 's'}${grantTotals.exact.length ? ` · ${grantTotals.exact.join(' · ')}` : ''} — jump to grants`}
            >
              <Icon name="gift" size={13} class="shrink-0" />
              <span>{grantAwards.length} grant{grantAwards.length === 1 ? '' : 's'}</span>
              {#if grantTotals.compact.length > 0}
                <span class="text-ink-400">· {grantTotals.compact.join(' · ')}</span>
              {/if}
            </button>
          {/if}
          {#if current.length > 0}
            <span class="text-ink-300">·</span>
            <a href="#people" class="hover:text-brand">{current.length} current {current.length === 1 ? 'person' : 'people'}</a>
          {/if}
          {#if past.length > 0}
            <span class="text-ink-300">·</span>
            <span class="text-ink-400">{past.length} former</span>
          {/if}
        </div>
        <!-- Admin actions — only surfaced in Edit mode. Day-to-day
             actions (Call/Email/Website/More) live in the quick-action
             tile row below the hero card. -->
        {#if editing}
          <div class="mt-4 flex flex-wrap items-center gap-2">
            {#if isDraft}
              <button class="btn-primary" onclick={publishNow} disabled={publishing} title="Publish this organization">
                <Icon name="sparkles" size={16} /> {publishing ? 'Publishing…' : 'Publish'}
              </button>
            {/if}
            <button
              class="btn-ghost"
              onclick={toggleActive}
              disabled={togglingActive}
              title={isInactive ? 'Mark this organization as still operating' : 'Mark this organization as no longer operating (kept in DB, hidden from default list)'}
            >
              <Icon name="tag" size={16} />
              {togglingActive ? '…' : isInactive ? 'Mark active' : 'Mark inactive'}
            </button>
            <button
              class="btn-ghost"
              onclick={() => (merging = true)}
              title="Merge this org's history into another row, then archive this one."
            >
              <Icon name="building" size={16} />
              Merge
            </button>
            <button
              class="btn-ghost"
              onclick={() => (rebranding = true)}
              title="Mark this org as rebranded into another. History stays on this row; future activity goes to the new identity."
            >
              <Icon name="move" size={16} />
              Rebrand
            </button>
            <button
              class="btn-ghost"
              onclick={() => (enriching = true)}
              title="Pull fresh details from public sources"
            >
              <Icon name="sparkles" size={16} />
              Enrich
            </button>
            <button
              class="btn-ghost {isArchived ? '' : 'text-tag-salesText hover:text-tag-salesText'}"
              onclick={toggleArchive}
              disabled={archiving}
              title={isArchived ? 'Restore from archive' : 'Archive this organization'}
            >
              <Icon name="tag" size={16} />
              {archiving ? '…' : isArchived ? 'Unarchive' : 'Archive'}
            </button>
            <a
              class="btn-ghost"
              href={directusAdminUrl('organization', org.id)}
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
    <!-- Social footer — minimal monochrome glyphs for the platforms
         that are actually set, right-aligned to sit with the pencil
         edit affordance. -->
    {#if socials.length > 0}
      <div class="mt-4 flex flex-wrap items-center justify-end gap-4 border-t border-surface-divider pt-3">
        {#each socials.map((r) => ({
          label: socialLabel(r.platform),
          icon: socialIcon(r.platform),
          title: `${socialLabel(r.platform)} · ${socialDisplay(r)}`,
          href: r.url,
          key: r.id
        })).filter((s) => !!s.href) as s (s.key)}
          <a
            href={s.href}
            target="_blank"
            rel="noreferrer"
            class="text-ink-500 hover:text-brand"
            title={s.title}
            aria-label={`Open ${s.label}`}
          >
            <Icon name={s.icon} size={18} />
          </a>
        {/each}
      </div>
    {/if}
  </div>

  <!-- iOS-contacts-style quick-action row (mobile only). Tile 4
       "Actions" expands an inline panel with the long-tail shortcuts. -->
  <div class="md:hidden">
    <div class="grid grid-cols-4 gap-2">
      {#each [
        { label: 'Call',    icon: 'phone' as const, href: org.phone   ? `tel:${org.phone}` : null,    target: undefined },
        { label: 'Email',   icon: 'mail'  as const, href: org.email   ? `mailto:${org.email}` : null, target: undefined },
        { label: 'Website', icon: 'globe' as const, href: org.website ?? null,                         target: '_blank' as const }
      ] as a (a.label)}
        {#if a.href}
          <a
            href={a.href}
            target={a.target}
            rel={a.target === '_blank' ? 'noreferrer' : undefined}
            class="flex flex-col items-center justify-center gap-1 rounded-[12px] border border-surface-border bg-surface-card px-2 py-3 text-xs font-medium text-brand hover:bg-surface-hover"
          >
            <Icon name={a.icon} size={20} />
            <span>{a.label}</span>
          </a>
        {:else}
          <div
            class="flex flex-col items-center justify-center gap-1 rounded-[12px] border border-surface-border bg-surface-card px-2 py-3 text-xs font-medium text-ink-300 opacity-60"
            aria-disabled="true"
            title={`No ${a.label.toLowerCase()} on file`}
          >
            <Icon name={a.icon} size={20} />
            <span>{a.label}</span>
          </div>
        {/if}
      {/each}
      <button
        type="button"
        class="flex flex-col items-center justify-center gap-1 rounded-[12px] border border-surface-border bg-surface-card px-2 py-3 text-xs font-medium text-brand hover:bg-surface-hover {mobileActionsOpen ? 'ring-2 ring-brand' : ''}"
        aria-expanded={mobileActionsOpen}
        aria-controls="org-mobile-actions-panel"
        onclick={() => (mobileActionsOpen = !mobileActionsOpen)}
      >
        <Icon name={mobileActionsOpen ? 'x' : 'sparkles'} size={20} />
        <span>{mobileActionsOpen ? 'Close' : 'Actions'}</span>
      </button>
    </div>
    {#if mobileActionsOpen}
      <ul id="org-mobile-actions-panel" class="mt-2 overflow-hidden rounded-[12px] border border-surface-border bg-surface-card text-sm">
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover"
            onclick={() => { activityOpenTrigger++; mobileActionsOpen = false; }}
          >
            <Icon name="calendar" size={16} /> Log conversation
          </button>
        </li>
        {#if socials.find((r) => r.platform === 'linkedin')?.url}
          <li class="border-t border-surface-divider">
            <a
              href={socials.find((r) => r.platform === 'linkedin')?.url}
              target="_blank"
              rel="noreferrer"
              class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover"
              onclick={() => (mobileActionsOpen = false)}
            >
              <Icon name="globe" size={16} /> Open LinkedIn
            </a>
          </li>
        {/if}
        {#if mapsHref}
          <li class="border-t border-surface-divider">
            <a
              href={mapsHref}
              target="_blank"
              rel="noreferrer"
              class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover"
              onclick={() => (mobileActionsOpen = false)}
            >
              <Icon name="globe" size={16} /> Open in Google Maps
            </a>
          </li>
        {/if}
        <li class="border-t border-surface-divider">
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover"
            onclick={() => { enriching = true; mobileActionsOpen = false; }}
          >
            <Icon name="sparkles" size={16} /> Enrich from web
          </button>
        </li>
      </ul>
    {/if}
  </div>

  <div class="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
    <!-- LEFT details -->
    <div class="min-w-0 space-y-5">
      <!-- About / description. Renders in view mode when set; always
           in Edit mode so the user has a place to write. Same shape as
           the Summary card on /projects/[id]. -->
      {#if editing || hasValue(org.description) || hasValue(org.description_en)}
        <div class="card p-4 space-y-3">
          <div class="card-title"><Icon name="tag" size={16} /> About</div>
          {#if editing || hasValue(org.description)}
            <div>
              <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Íslenska</div>
              <EditableField value={org.description} placeholder="Hvað gerir þetta fyrirtæki?" onSave={(v) => save('description', v)} />
            </div>
          {/if}
          {#if editing || hasValue(org.description_en)}
            <div>
              <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">English</div>
              <EditableField value={org.description_en} placeholder="What does this organisation do?" onSave={(v) => save('description_en', v)} />
            </div>
          {/if}
        </div>
      {/if}

      <!-- Organization details — empty rows collapse in view mode. -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="building" size={16} /> Organization details</span>
        </div>
        <dl class="divide-y divide-surface-divider px-4 pb-3 text-sm">
          <!-- Edit-only: the header already shows this as Legal: …. Repeating
               it in view mode makes the reader check whether the two agree. -->
          {#if editing}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Legal name</dt>
              <dd class="min-w-0 flex-1"><EditableField value={org.legal_name} onSave={(v) => save('legal_name', v)} /></dd>
            </div>
          {/if}
          <!-- Edit-only: the header already shows this as formerly …. Repeating
               it in view mode makes the reader check whether the two agree. -->
          {#if editing}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Previous names</dt>
              <dd class="min-w-0 flex-1"><EditableField value={org.previous_names} placeholder="e.g. Borgun hf., Salt Pay" onSave={(v) => save('previous_names', v)} /></dd>
            </div>
          {/if}
          <!-- Edit-only: the header already shows this as an industry pill. Repeating
               it in view mode makes the reader check whether the two agree. -->
          {#if editing}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Industry</dt>
              <dd class="min-w-0 flex-1"><EditableField
                value={org.industry}
                type="select"
                options={[...ORG_INDUSTRY_OPTIONS]}
                placeholder="Pick an industry"
                onSave={(v) => save('industry', v)}
              /></dd>
            </div>
          {/if}
          <!-- Region (Landshluti) — the Icelandic region the org operates
               in. Pulled from the Rannís feed for orgs that received
               grants; manually settable otherwise. -->
          {#if editing || hasValue(org.region)}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Region</dt>
              <dd class="min-w-0 flex-1"><EditableField
                value={org.region}
                type="select"
                options={ALL_REGION_CHOICES.map((r) => ({
                  label: `${r.label} (${r.value})`,
                  value: r.value,
                  group: r.group
                }))}
                placeholder="Pick a region"
                onSave={(v) => save('region', v)}
              /></dd>
            </div>
          {/if}
          <!-- Website / Email / Phone are duplicated by the mobile
               quick-action row above. Hide on mobile in view mode;
               show on every breakpoint in Edit mode. -->
          {#if editing || hasValue(org.website)}
            <div class="{editing ? 'flex' : 'hidden md:flex'} flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Website</dt>
              <dd class="min-w-0 flex-1"><EditableField value={org.website} type="url" onSave={(v) => save('website', v)} /></dd>
            </div>
          {/if}
          {#if editing || hasValue(org.email)}
            <div class="{editing ? 'flex' : 'hidden md:flex'} flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Email</dt>
              <dd class="min-w-0 flex-1"><EditableField value={org.email} type="email" onSave={(v) => save('email', v)} /></dd>
            </div>
          {/if}
          {#if editing || hasValue(org.phone)}
            <div class="{editing ? 'flex' : 'hidden md:flex'} flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Phone</dt>
              <dd class="min-w-0 flex-1"><EditableField value={org.phone} type="phone" onSave={(v) => save('phone', v)} /></dd>
            </div>
          {/if}
          <!-- Lifecycle status — richer than is_active. Visible in view
               mode when set; always editable in Edit mode. -->
          <!-- Edit-only: the header already shows this as a coloured lifecycle pill. Repeating
               it in view mode makes the reader check whether the two agree. -->
          {#if editing}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Lifecycle</dt>
              <dd>
                <EditableField
                  value={org.lifecycle_status ?? null}
                  type="select"
                  options={[
                    { label: '—', value: '' },
                    ...ORG_LIFECYCLE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))
                  ]}
                  onSave={(v) => save('lifecycle_status', v || null)}
                />
              </dd>
            </div>
          {/if}
          <!-- Scope is administrative — only in Edit mode. -->
          {#if editing}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Scope</dt>
              <dd>
                <EditableField
                  value={org.scope ?? null}
                  type="select"
                  options={[
                    { label: 'Work', value: 'work' },
                    { label: 'Private', value: 'private' },
                    { label: 'Both', value: 'both' }
                  ]}
                  onSave={(v) => save('scope', v)}
                />
              </dd>
            </div>
          {/if}
          <!-- Status is owned by the hero pills + Edit-mode admin actions. -->
        </dl>
      </div>

      <!-- Location — postal slip in view mode, envelope-grouped grid in Edit. -->
      {#if editing || hasAnyLocation}
        <div class="card">
          <div class="card-header">
            <span class="card-title"><Icon name="globe" size={16} /> Location</span>
            {#if !editing && mapsHref}
              <a
                href={mapsHref}
                target="_blank"
                rel="noreferrer"
                class="text-xs font-medium text-brand hover:underline"
                title="Open this address in Google Maps"
              >
                Maps →
              </a>
            {/if}
          </div>

          {#if editing}
            <div class="px-4 pb-3 space-y-2 text-sm">
              <div>
                <div class="text-xs text-ink-400 mb-0.5">Street</div>
                <EditableField value={org.address_line1} placeholder="Street address" onSave={(v) => save('address_line1', v)} />
              </div>
              <div>
                <div class="text-xs text-ink-400 mb-0.5">Line 2 <span class="text-ink-300">(optional)</span></div>
                <EditableField value={org.address_line2} placeholder="Suite, floor, …" onSave={(v) => save('address_line2', v)} />
              </div>
              <div class="grid grid-cols-[5rem_1fr] gap-2">
                <div>
                  <div class="text-xs text-ink-400 mb-0.5">Postal</div>
                  <EditableField value={org.postal_code} onSave={(v) => save('postal_code', v)} />
                </div>
                <div>
                  <div class="text-xs text-ink-400 mb-0.5">City</div>
                  <EditableField value={org.city} onSave={(v) => save('city', v)} />
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <div class="text-xs text-ink-400 mb-0.5">State / region</div>
                  <EditableField value={org.state_province} onSave={(v) => save('state_province', v)} />
                </div>
                <div>
                  <div class="text-xs text-ink-400 mb-0.5">Country</div>
                  <EditableField value={org.country} onSave={(v) => save('country', v)} />
                </div>
              </div>
            </div>
          {:else}
            <div class="px-4 pb-4 text-sm">
              {#if addressLines.length > 0}
                <address class="not-italic leading-relaxed text-ink-900">
                  {#each addressLines as line (line)}
                    <div>{line}</div>
                  {/each}
                </address>
              {:else}
                <div class="text-ink-300">No address on file</div>
              {/if}
              {#if mapsHref}
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noreferrer"
                  class="mt-3 inline-flex items-center gap-2 rounded-[10px] border border-surface-border bg-surface-card px-3 py-2 text-sm font-medium text-brand hover:bg-surface-hover md:hidden"
                >
                  <Icon name="globe" size={16} /> Open in Google Maps
                </a>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Size & enrichment — collapses entirely in view mode if no
           fields are filled. -->
      {#if editing || (!sizeInHeader && hasValue(org.size_bucket)) || hasValue(org.employee_count_source) || hasValue(org.employee_count_as_of) || hasValue(org.founded_year) || hasValue(org.kennitala) || hasValue(org.revenue_band_isk)}
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="users" size={16} /> Size & enrichment</span>
          {#if org.last_enriched_at}
            <span class="text-xs text-ink-300">enriched {new Date(org.last_enriched_at).toLocaleDateString()}</span>
          {/if}
        </div>
        <dl class="divide-y divide-surface-divider px-4 pb-3 text-sm">
          <!-- Hidden in view mode once the header pill states the size. -->
          {#if editing || (!sizeInHeader && hasValue(org.size_bucket))}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Size band</dt>
              <dd>
                <EditableField
                  value={org.size_bucket ?? null}
                  type="select"
                  options={ORG_SIZE_OPTIONS}
                  onSave={(v) => save('size_bucket', v)}
                />
              </dd>
            </div>
          {/if}
          <!-- Edit-only: when this is set the header pill IS this number
               ("1,200 employees"), so view mode would show it twice. -->
          {#if editing}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Employees (exact)</dt>
              <dd class="min-w-0 flex-1"><EditableField value={org.employee_count != null ? String(org.employee_count) : null} placeholder="e.g. 42" onSave={(v) => save('employee_count', v)} /></dd>
            </div>
          {/if}
          {#if editing || hasValue(org.employee_count_source)}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Source</dt>
              <dd>
                <EditableField
                  value={org.employee_count_source ?? null}
                  type="select"
                  options={[
                    { label: 'Manual', value: 'manual' },
                    { label: 'LinkedIn', value: 'linkedin' },
                    { label: 'ja.is', value: 'ja_is' },
                    { label: 'RSK', value: 'rsk' },
                    { label: 'Crunchbase', value: 'crunchbase' },
                    { label: 'Wikidata', value: 'wikidata' },
                    { label: 'Website', value: 'website' }
                  ]}
                  onSave={(v) => save('employee_count_source', v)}
                />
              </dd>
            </div>
          {/if}
          {#if editing || hasValue(org.employee_count_as_of)}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Counted on</dt>
              <dd class="min-w-0 flex-1"><EditableField value={org.employee_count_as_of} type="date" onSave={(v) => save('employee_count_as_of', v)} /></dd>
            </div>
          {/if}
          <!-- Edit-only: the header already shows this as a pill. -->
          {#if editing}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Org type</dt>
              <dd>
                <EditableField
                  value={org.org_type ?? null}
                  type="select"
                  options={[
                    { label: 'Private company', value: 'private' },
                    { label: 'Public company', value: 'public' },
                    { label: 'Nonprofit', value: 'nonprofit' },
                    { label: 'Government', value: 'government' },
                    { label: 'University', value: 'university' },
                    { label: 'School', value: 'school' },
                    { label: 'Association', value: 'association' },
                    { label: 'Other', value: 'other' }
                  ]}
                  onSave={(v) => save('org_type', v)}
                />
              </dd>
            </div>
          {/if}
          {#if editing || hasValue(org.founded_year)}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Founded</dt>
              <dd class="min-w-0 flex-1"><EditableField value={org.founded_year != null ? String(org.founded_year) : null} placeholder="YYYY" onSave={(v) => save('founded_year', v)} /></dd>
            </div>
          {/if}
          {#if editing || hasValue(org.kennitala)}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Kennitala</dt>
              <dd class="min-w-0 flex-1"><EditableField
                value={org.kennitala}
                placeholder="10 digits"
                href={(v) => `https://www.skatturinn.is/fyrirtaekjaskra/leit/kennitala/${v.replace(/[-\s]/g, '')}`}
                onSave={(v) => save('kennitala', v)}
              /></dd>
            </div>
          {/if}
          {#if editing || hasValue(org.revenue_band_isk)}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Revenue band</dt>
              <dd>
                <EditableField
                  value={org.revenue_band_isk ?? null}
                  type="select"
                  options={[
                    { label: '< 100m ISK', value: '<100m' },
                    { label: '100m – 1b ISK', value: '100m-1b' },
                    { label: '1b – 10b ISK', value: '1b-10b' },
                    { label: '10b+ ISK', value: '10b+' }
                  ]}
                  onSave={(v) => save('revenue_band_isk', v)}
                />
              </dd>
            </div>
          {/if}
        </dl>
      </div>
      {/if}
    </div>

    <!-- RIGHT tabs -->
    <div class="min-w-0 space-y-5">
      <div class="card">
        <div class="flex items-center gap-2 border-b border-surface-divider px-4">
          <button
            class="relative flex items-center gap-2 px-2 py-3 text-sm font-medium transition {tab.value === 'overview' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
            onclick={() => (tab.value = 'overview')}
          >
            <Icon name="sparkles" size={14} /> Overview
            {#if tab.value === 'overview'}<span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>{/if}
          </button>
          <button
            class="relative flex items-center gap-2 px-2 py-3 text-sm font-medium transition {tab.value === 'people' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
            onclick={() => (tab.value = 'people')}
          >
            <Icon name="users" size={14} /> People <span class="text-ink-300">{peopleCount}</span>
            {#if tab.value === 'people'}<span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>{/if}
          </button>
        </div>

        {#if tab.value === 'overview'}
          <div class="space-y-5 p-4" id="people">
            <!-- Brand. Same component the project page uses — organizations
                 carry the same brand fields now, so a company's brand lives
                 where the company does instead of on a project that borrows
                 it. Renders nothing when no brand is set anywhere up the
                 parent_organization chain. -->
            {#key org.id}
              <BrandCard project={org} kind="organization" />
            {/key}

            <!-- Press coverage, when frettir is running and switched on. This
                 mounts the SEAM, not the card: nothing from the news stack
                 enters the CRM bundle unless the feature is enabled. -->
            <NewsCoverage entityType="organization" entityId={org.id} />

            <div hidden={!showTags}>
              <TagsCard target="organization" targetId={org.id} bind:links={orgTagLinks} />
            </div>
            <div hidden={!showSocials}>
              <OrgSocialCard orgId={org.id} {editing} onRows={(r) => (socials = r)} />
            </div>

            <div hidden={!showPeople}>
              <PeopleAtOrgCard bind:roles orgId={org.id} />
            </div>

            <OrgProjectsCard {projects} />

            <!-- Grants received via the Grants subsystem. This card used to
                 render always, on the theory that "no grants yet" is itself
                 information for funder-tracking. With 28% of orgs funded,
                 that theory cost an empty box on the other 72% — the Add row
                 below still names Grants, which carries the same signal in
                 one chip. -->
            <div id="grants" class="scroll-mt-20" hidden={!showGrants}>
              <OrgGrantsCard awards={grantAwards} />
            </div>

            <!-- Receipts whose merchant resolved to this org — what we have
                 actually spent here. -->
            <div hidden={!showReceipts}>
              <ReceiptExpensesCard orgId={org.id} onCount={(n) => (receiptCount = n)} />
            </div>

            <div hidden={!showOrgPhotos}>
              <OrgPhotos orgId={org.id} orgName={org.name ?? ''} onCount={(n) => (orgPhotoCount = n)} />
            </div>

            <!-- NAS photos tagged to this org via photo_link — distinct
                 from OrgPhotos (uploaded gallery in Directus): these
                 live in Immich and only their ids are stored. -->
            <div class="card" hidden={!showLibrary}>
              <div class="card-header">
                <span class="card-title"><Icon name="image" size={16} /> Photo library</span>
              </div>
              <div class="p-4">
                <ItemPhotos collection="organization" itemId={org.id} onCount={(n) => (libraryCount = n)} />
              </div>
            </div>

            <AddFacetRow
              facets={[
                { key: 'tags', label: 'Tags', hidden: !showTags },
                { key: 'socials', label: 'Social profiles', hidden: !showSocials && socials.length === 0 },
                { key: 'grants', label: 'Grants', hidden: !showGrants },
                { key: 'receipts', label: 'Expenses', hidden: !showReceipts },
                { key: 'photos', label: 'Photos', hidden: !showOrgPhotos },
                { key: 'library', label: 'Photo library', hidden: !showLibrary },
                { key: 'people', label: 'People', hidden: !showPeople },
                { key: 'activities', label: 'Activity', hidden: !showActivities }
              ]}
              onopen={(k) => (openFacets = { ...openFacets, [k]: true })}
            />

            <!-- Previous identities card. Renders only when at least
                 one row's successor_id points here — i.e. this org
                 is the survivor of a rebrand / merge. Linked rows
                 keep their own histories, so users can drill back
                 into them to see what was done under the old name. -->
            {#if previousIdentities.length > 0}
              <div class="card">
                <div class="card-header">
                  <span class="card-title">
                    <Icon name="move" size={16} /> Previous identities
                    <span class="text-ink-300 font-normal">{previousIdentities.length}</span>
                  </span>
                </div>
                <ul class="divide-y divide-surface-divider">
                  {#each previousIdentities as prev (prev.id)}
                    <li>
                      <a href={`/orgs/${prev.id}`} class="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover">
                        <Avatar name={prev.name ?? '?'} src={assetUrl(prev.logo, { width: 64, height: 64, fit: 'cover' })} size={28} lazy />
                        <div class="min-w-0 flex-1">
                          <div class="truncate font-medium text-ink-900">{prev.name ?? `Org ${prev.id}`}</div>
                          <div class="text-xs text-ink-400">
                            {#if prev.lifecycle_status === 'rebranded'}Rebranded into here — history kept on the old row.
                            {:else if prev.lifecycle_status === 'merged'}Merged into here — relations were folded over.
                            {:else}Linked as a previous identity.{/if}
                          </div>
                        </div>
                        <Icon name="chevron-right" size={12} class="text-ink-300" />
                      </a>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}

            <QuickLogChips context={{ kind: 'organization', orgId: org.id }} />

            <div hidden={!showActivities}>
              <ActivityCard
                context={{ kind: 'organization', orgId: org.id }}
                openTrigger={activityOpenTrigger}
                onCount={(n) => (activityCount = n)}
              />
            </div>

            <RelatedNotes collection="organization" itemId={org.id} />

            <LinkedEvents kind="org" id={org.id} />

            {#key org.id}
              <EventsCard entity="org" id={org.id} />
            {/key}

            <div class="grid grid-cols-2 gap-4 text-sm">
              <div class="rounded-[10px] border border-surface-divider p-3">
                <div class="text-ink-400 text-xs">Status</div>
                <div class="mt-1 font-medium">{org.status ?? '—'}</div>
              </div>
              <div class="rounded-[10px] border border-surface-divider p-3">
                <div class="text-ink-400 text-xs">Location</div>
                <div class="mt-1 font-medium">{[org.city, org.country].filter(Boolean).join(', ') || '—'}</div>
              </div>
            </div>

            <!-- Who changed this record (managed vaults with history on). -->
            <RecordHistory table="organization" rowId={org.id} />
          </div>
        {:else}
          <div class="p-4">
            <ul class="divide-y divide-surface-divider">
              {#each peopleGroups as g (g.person.id)}
                {@const p = g.person}
                {@const primary = g.rows[0]}
                {@const anyCurrent = g.rows.some((r) => !!r.is_current)}
                {#if p && primary}
                  <li>
                    <a href={`/people/${p.id}`} class="flex items-center gap-3 py-3 hover:bg-surface-hover">
                      <Avatar name={personName(p)} src={assetUrl(p.person_picture, { width: 80, height: 80, fit: 'cover' })} lazy />
                      <div class="min-w-0 flex-1">
                        <div class="font-medium text-ink-900 truncate">{personName(p)}</div>
                        <div class="text-xs text-ink-400 truncate">
                          {g.rows.map((r) => r.role).filter(Boolean).join(' · ') || '—'}
                          · {fmtYear(primary.start_date)} – {fmtYear(primary.end_date) || (anyCurrent ? 'present' : '—')}
                        </div>
                      </div>
                      {#if anyCurrent}<TagPill tone="nutrition">current</TagPill>{:else}<TagPill tone="neutral">former</TagPill>{/if}
                    </a>
                  </li>
                {/if}
              {:else}
                <li class="py-6 text-center text-sm text-ink-400">No people linked to this organization yet.</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <EnrichOrgDialog
    {org}
    bind:open={enriching}
    onClose={() => (enriching = false)}
    onUpdated={(patch) => (org = { ...org, ...patch })}
  />
  <MergeOrgDialog
    source={org}
    bind:open={merging}
    onClose={() => (merging = false)}
  />
  <RebrandOrgDialog
    source={org}
    bind:open={rebranding}
    onClose={() => (rebranding = false)}
  />
</section>
