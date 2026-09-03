<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import AvatarUpload from '$lib/AvatarUpload.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import { goto } from '$app/navigation';
  import { personName, assetUrl, updatePerson, updateRole, setPersonStatus, directusAdminUrl, uploadFile, photoPersonsForPerson, type Organization, type Person, type Role, type FamilyEdge, type ProjectPerson, type PersonTag } from '$lib/directus';
  import { fetchAssetFile, firstMappedAsset, immichAvailable, type ImmichAsset } from '$lib/immich';
  import EditableField from '$lib/EditableField.svelte';
  import RolesCard from '$lib/RolesCard.svelte';
  import FamilyCard from '$lib/FamilyCard.svelte';
  import { featureOn } from '$lib/instance';
  import PersonProjectsCard from '$lib/PersonProjectsCard.svelte';
  import EducationCard from '$lib/EducationCard.svelte';
  import AddFacetRow from '$lib/AddFacetRow.svelte';
  import PersonEmails from '$lib/PersonEmails.svelte';
  import LanguagesCard from '$lib/LanguagesCard.svelte';
  import TagsCard from '$lib/TagsCard.svelte';
  import OrgSocialCard from '$lib/OrgSocialCard.svelte';
  import { socialIcon, socialLabel, socialDisplay, type OrgSocial } from '$lib/orgSocial';
  import ActivityCard from '$lib/ActivityCard.svelte';
  import QuickLogChips from '$lib/QuickLogChips.svelte';
  import RelatedNotes from '$lib/RelatedNotes.svelte';
  import LinkedEvents from '$lib/LinkedEvents.svelte';
  import EventsCard from '$lib/events/EventsCard.svelte';
  import PersonPhotos from '$lib/photos/PersonPhotos.svelte';

  let { data }: { data: { person: Person; roles: Role[]; family: FamilyEdge[]; projects: ProjectPerson[]; tags: PersonTag[] } } = $props();
  let person = $state<Person>(data.person);
  let roles = $state<Role[]>(data.roles);
  let family = $state<FamilyEdge[]>(data.family);
  let projects = $state<ProjectPerson[]>(data.projects);
  let personTagLinks = $state<PersonTag[]>(data.tags);

  // ── Facet visibility ────────────────────────────────────────────────
  // A card earns its place by having rows. Education and Languages have zero
  // rows database-wide and Tags covers 17% of people, yet each rendered a
  // permanent "No X recorded" box on every one of 1,560 person pages. Absent
  // facets now collapse into one Add row; opening a chip mounts the card's
  // own empty state with its add flow. Cards stay MOUNTED (hidden attribute)
  // because Education/Languages load their own rows and must run to report.
  let educationCount = $state<number | null>(null);
  let languagesCount = $state<number | null>(null);
  let openFacets = $state<Record<string, boolean>>({});
  const showTags = $derived(!!openFacets.tags || personTagLinks.length > 0);
  const showEducation = $derived(!!openFacets.education || (educationCount ?? 0) > 0);
  const showLanguages = $derived(!!openFacets.languages || (languagesCount ?? 0) > 0);
  // Resync local state when SvelteKit reloads the route (e.g. navigating from
  // /people/8 to /people/217 via a link on this page). Without this, $state
  // captures only the initial `data` and the URL changes but the view stays.
  $effect(() => {
    person = data.person;
    roles = data.roles;
    family = data.family;
    projects = data.projects;
    personTagLinks = data.tags;
  });

  // ── Profile picture from the photo library ──────────────────────
  // Adopt an Immich library photo as the avatar: import it into
  // Directus (so it behaves like any other avatar — transforms, focal
  // point, Studio, lists) and set person_picture.
  async function setAvatarFromAsset(asset: ImmichAsset) {
    const file = await fetchAssetFile(asset.id, personName(person));
    const fileId = await uploadFile(file, { title: `${personName(person)} — photo library` });
    const patched = await updatePerson(
      person.id,
      { person_picture: fileId, image_focal: null } as Partial<Person>
    );
    person = { ...person, ...patched };
  }

  // If a person has no picture but their face is mapped, fall back to
  // the first mapped library photo — once per person, only on this
  // detail page (never bulk lists). Plain guard so it re-arms when the
  // route navigates to another person.
  let autoAvatarTriedId = -1;
  $effect(() => {
    const p = person;
    if (p.person_picture || autoAvatarTriedId === p.id) return;
    autoAvatarTriedId = p.id;
    void (async () => {
      try {
        const clusterIds = (await photoPersonsForPerson(p.id)).map((m) => m.id);
        if (clusterIds.length === 0 || !(await immichAvailable())) return;
        const asset = await firstMappedAsset(clusterIds);
        if (asset && person.id === p.id && !person.person_picture) {
          await setAvatarFromAsset(asset);
        }
      } catch {
        // best-effort — a missing avatar just stays as initials
      }
    })();
  });

  const primaryRole = $derived(
    roles.find((r) => r.is_current) ?? roles[0] ?? null
  );
  // Hide the entire Location card in view mode when no location fields are
  // filled — saves an awkward header-only card on most contacts.
  const hasAnyLocation = $derived(
    hasValue(person.city) ||
    hasValue(person.state_province) ||
    hasValue(person.postal_code) ||
    hasValue(person.country) ||
    hasValue(person.address_line1) ||
    hasValue(person.address_line2)
  );
  const primaryOrg = $derived(
    primaryRole && primaryRole.organization_id && typeof primaryRole.organization_id === 'object'
      ? (primaryRole.organization_id as Organization)
      : null
  );

  async function save(field: keyof Person, value: string | null) {
    const patched = await updatePerson(person.id, { [field]: value } as Partial<Person>);
    // Optimistic merge — keep the fetched expanded relations (org) intact.
    person = { ...person, ...patched, organization: person.organization };
  }

  let archiving = $state(false);
  let publishing = $state(false);
  // When true, every field is rendered (so the user can fill blanks). When
  // false, empty rows collapse so the view is a clean snapshot of what's
  // actually known. Also gates admin actions (publish/archive/Directus).
  // Fed by the shared social card — the same component the org page uses,
  // pointed at person_social instead.
  let socials = $state<OrgSocial[]>([]);
  let editing = $state(false);

  // A row counts as "empty" when its value is null/undefined or a blank
  // string. Dates and numbers come through as plain values too.
  function hasValue(v: unknown): boolean {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    return true;
  }
  // Counter the parent increments to ask ActivityCard to open its add form.
  let activityOpenTrigger = $state(0);
  // Mobile quick-action row's "More" tile expands an inline panel.
  let mobileActionsOpen = $state(false);
  // Bootstrapping the first family relation. When the user clicks an
  // "Add family" affordance we flip the page into the Family tab and
  // bump the FamilyCard's openTrigger to expand its add form. The tab
  // button is also rendered when this is set, so the user has a
  // visible surface to fall back to / cancel into.
  let familyAddTrigger = $state(0);
  function openAddFamily() {
    tab.value = 'family';
    familyAddTrigger++;
    mobileActionsOpen = false;
  }
  const isArchived = $derived(person.status === 'archived');
  const isDraft = $derived(person.status === 'draft');

  async function publishNow() {
    publishing = true;
    try {
      const updated = await setPersonStatus(person.id, 'published');
      person = { ...person, ...updated, organization: person.organization };
    } finally {
      publishing = false;
    }
  }
  async function toggleArchive() {
    const msg = isArchived
      ? `Restore ${personName(person)} from the archive?`
      : `Archive ${personName(person)}? They'll be hidden from lists but not deleted.`;
    if (!confirm(msg)) return;
    archiving = true;
    try {
      const next = isArchived ? 'published' : 'archived';
      const updated = await setPersonStatus(person.id, next);
      person = { ...person, ...updated, organization: person.organization };
      if (!isArchived) goto('/people');
    } finally {
      archiving = false;
    }
  }

  const tab = $state({ value: 'overview' as 'overview' | 'family' | 'activity' | 'photos' });

  // Activity tab sub-filter. The tab aggregates three streams —
  // interactions logged via ActivityCard, notes linked via the M2A
  // junction, and calendar events with this person attached.
  // 'all' stacks them; the others show only that stream.
  let activityFilter = $state<'all' | 'activities' | 'notes' | 'events'>('all');
  const ACTIVITY_FILTERS: { value: 'all' | 'activities' | 'notes' | 'events'; label: string; icon: 'sparkles' | 'bolt' | 'notebook' | 'calendar' }[] = [
    { value: 'all',        label: 'All',         icon: 'sparkles' },
    { value: 'activities', label: 'Interactions', icon: 'bolt' },
    { value: 'notes',      label: 'Notes',       icon: 'notebook' },
    { value: 'events',     label: 'Events',      icon: 'calendar' }
  ];
  let contactMode = $state<'personal' | 'work'>('personal');
  // With Company and Title now edit-only (the header and the Roles card
  // already state them), the Work tab has nothing left to show in view mode
  // unless there is a work email or phone. Don't offer a tab onto a blank
  // panel — and if we're already standing on it, step back to Personal.
  const hasWorkContact = $derived(
    hasValue(primaryRole?.work_email) || hasValue(primaryRole?.work_phone)
  );
  const workTabAvailable = $derived(!!primaryRole && (editing || hasWorkContact));
  $effect(() => {
    if (contactMode === 'work' && !workTabAvailable) contactMode = 'personal';
  });

  async function saveRole(field: keyof Role, value: string | null) {
    if (!primaryRole) return;
    const updated = await updateRole(primaryRole.id, { [field]: value } as Partial<Role>);
    roles = roles.map((r) =>
      r.id === primaryRole!.id
        ? { ...r, ...updated, organization_id: r.organization_id, reporting_to: r.reporting_to }
        : r
    );
  }

  const name = $derived(personName(person));

  // Avatar size scales with the viewport. The component takes a fixed
  // pixel size so we can't drive it from Tailwind classes; instead we
  // listen to a media query and re-render. On a 360–400px viewport the
  // old 160px avatar ate ~45% of the row and crushed Icelandic names
  // into "Hermann Björn…" — shrinking the avatar to 96px gives the
  // name column ~80px more breathing room.
  let avatarSize = $state(160);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 640px)');
    const apply = () => { avatarSize = mq.matches ? 160 : 96; };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  });
  const picture = $derived(
    assetUrl(person.person_picture, { width: 320, height: 320, fit: 'inside' })
  );
  const tags = $derived.by(() => {
    const raw = person.tags;
    if (!raw) return [] as string[];
    if (Array.isArray(raw)) return raw.filter(Boolean) as string[];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed.filter(Boolean) as string[];
        } catch {/* fall through */}
      }
      return trimmed.split(',').map((t) => t.trim()).filter(Boolean);
    }
    return [];
  });

  const addressLines = $derived(
    [
      person.address_line1,
      person.address_line2,
      [person.postal_code, person.city].filter(Boolean).join(' '),
      [person.state_province, person.country].filter(Boolean).join(', ')
    ].filter((l) => !!l && l.trim())
  );
  // Maps query — strip blanks, join with commas. Works as a Google
  // Maps search URL on web; iOS picks the Maps app via the universal
  // link if Google Maps is installed.
  const mapsQuery = $derived(
    [
      person.address_line1,
      person.address_line2,
      person.postal_code,
      person.city,
      person.state_province,
      person.country
    ]
      .filter((v) => !!v && String(v).trim())
      .join(', ')
  );
  const mapsHref = $derived(
    mapsQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
      : null
  );

  function fmtDate(s?: string | null) {
    if (!s) return '—';
    try {
      return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(s));
    } catch {
      return s;
    }
  }

  const tagTones = ['sales', 'nutrition', 'garden', 'chat', 'health', 'online'] as const;
  function tone(i: number) {
    return tagTones[i % tagTones.length];
  }
</script>

<section class="space-y-6">
  <!-- Header card -->
  <div class="card relative p-4 sm:p-6">
    <!-- Floating pencil — icon-only Edit toggle pinned to the
         top-right of the hero. Pops the contact card open into Edit
         mode where the admin actions (Publish/Archive/Directus) and
         empty rows are revealed. -->
    <button
      type="button"
      class="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-400 hover:bg-surface-hover hover:text-ink-900 {editing ? 'bg-brand text-white hover:bg-brand hover:text-white' : ''}"
      aria-pressed={editing}
      aria-label={editing ? 'Done editing' : 'Edit contact'}
      title={editing ? 'Done — hide empty fields and admin actions' : 'Edit — show every field + admin actions'}
      onclick={() => (editing = !editing)}
    >
      <Icon name={editing ? 'check' : 'pencil'} size={16} />
    </button>
    <!-- Side-by-side hero: avatar stays left of the name on every screen
         size — gives a compact contact-card feel on mobile and saves a full
         avatar's worth of vertical space versus the old stacked layout. -->
    <div class="flex flex-row items-start gap-3 sm:gap-5 sm:items-center">
      <div class="shrink-0">
        <AvatarUpload
          name={name}
          personId={person.id}
          src={picture}
          rawSrc={assetUrl(person.person_picture)}
          size={avatarSize}
          focal={person.image_focal}
          fileId={person.person_picture}
          title="Click to upload a picture"
          onUploaded={async (fileId) => {
            const patched = await updatePerson(person.id, { person_picture: fileId } as Partial<Person>);
            person = { ...person, ...patched };
          }}
          onFocalChange={async (f) => {
            const patched = await updatePerson(person.id, { image_focal: f } as Partial<Person>);
            person = { ...person, ...patched };
          }}
        />
      </div>
      <div class="flex-1 min-w-0">
        <!-- Title gets its own row, full width of the column so long
             Icelandic names can wrap to 2 lines instead of truncating
             to "Hermann Björn…". clamp() scales the font down on
             narrow viewports so 17+ character names still fit before
             the wrap kicks in.
             EditableField defaults to right-aligned at sm+ (it's
             designed for form rows where label/value pairs line up
             on a column edge). In this hero context we force left
             alignment via arbitrary-variant overrides so the title
             reads naturally next to the avatar. -->
        <h1
          class="group font-display font-bold leading-tight hero-name"
          style="letter-spacing: -0.03em; font-size: clamp(1.375rem, 5.5vw, 1.875rem); overflow-wrap: anywhere;"
        >
          <EditableField
            wrap
            value={person.full_name?.trim() ? person.full_name : (name === '(no name)' ? null : name)}
            placeholder="Add name"
            onSave={(v) => save('full_name', v)}
          />
        </h1>
        <!-- Nickname + gender + tag chips on their own row beneath
             the title. Was inline with the H1 before, which fought
             the title for horizontal space on mobile. -->
        {#if person.nickname || person.gender || person.type || isDraft || isArchived}
          <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {#if person.nickname}
              <span
                class="text-sm font-normal text-ink-400"
                title={`Goes by "${person.nickname}"`}
              >“{person.nickname}”</span>
            {/if}
            {#if person.gender}
              {@const g = person.gender.toLowerCase()}
              <span
                class="text-base text-ink-300"
                title={`Gender: ${person.gender}`}
                aria-label={`Gender: ${person.gender}`}
              >{g === 'male' ? '♂' : g === 'female' ? '♀' : '⚧'}</span>
            {/if}
            {#if person.type}<TagPill tone="online">{person.type}</TagPill>{/if}
            {#if isDraft}<TagPill tone="sales">draft</TagPill>{/if}
            {#if isArchived}<TagPill tone="neutral">archived</TagPill>{/if}
          </div>
        {/if}
        {#if primaryRole}
          <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
            {#if primaryRole.role}
              <span class="text-ink-700 font-medium">{primaryRole.role}</span>
              <span class="text-ink-300">·</span>
            {/if}
            {#if primaryOrg}
              <!-- min-w-0 + truncate so a long org name (very common with
                   Icelandic legal-form suffixes) gets ellipsis instead of
                   overflowing the parent flex container. -->
              <a
                href={`/orgs/${primaryOrg.id}`}
                class="inline-flex min-w-0 max-w-full items-center gap-1 truncate hover:text-brand"
                title={primaryOrg.name ?? ''}
              >
                <Icon name="building" size={14} class="shrink-0" />
                <span class="truncate">{primaryOrg.name}</span>
              </a>
            {/if}
            {#if roles.length > 1}
              <span class="text-ink-300">·</span>
              <!-- Switch to Overview (where RolesCard lives) and scroll it
                   into view. Plain anchors break here because the target
                   element doesn't exist while the Activity tab is open. -->
              <button
                type="button"
                class="text-brand hover:underline"
                onclick={() => {
                  tab.value = 'overview';
                  setTimeout(() => document.getElementById('roles')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                }}
              >+{roles.length - 1} more role{roles.length - 1 === 1 ? '' : 's'}</button>
            {/if}
          </div>
        {/if}
        <!-- Admin actions — only surfaced in Edit mode. The day-to-day
             actions (Call/Email/Website/More) live in the quick-action
             tile row below the hero card. -->
        {#if editing}
          <div class="mt-4 flex flex-wrap items-center gap-2">
            {#if isDraft}
              <button class="btn-primary" onclick={publishNow} disabled={publishing} title="Publish this contact">
                <Icon name="sparkles" size={16} /> {publishing ? 'Publishing…' : 'Publish'}
              </button>
            {/if}
            {#if family.length === 0}
              <button
                class="btn-ghost"
                onclick={openAddFamily}
                title="Open the Family tab and start an add flow"
              >
                <Icon name="users" size={16} />
                Add family
              </button>
            {/if}
            <button
              class="btn-ghost {isArchived ? '' : 'text-tag-salesText hover:text-tag-salesText'}"
              onclick={toggleArchive}
              disabled={archiving}
              title={isArchived ? 'Restore from archive' : 'Archive this contact'}
            >
              <Icon name="tag" size={16} />
              {archiving ? '…' : isArchived ? 'Unarchive' : 'Archive'}
            </button>
            <a
              class="btn-ghost"
              href={directusAdminUrl('Person', person.id)}
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
         that are actually set. Right-aligned so it sits with the
         pencil edit affordance, not against the avatar. -->
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

  <!-- iOS-contacts-style quick-action row (mobile only). Each tile is
       icon-over-label, dimmed when the underlying value is missing.
       The fourth tile, "More", opens an inline panel with extras
       (Log conversation, LinkedIn, etc). Hidden on lg+ where the side
       panels cover the same affordances with more room to spare. -->
  <div class="md:hidden">
    <div class="grid grid-cols-4 gap-2">
      {#each [
        { label: 'Call',    icon: 'phone' as const, href: person.phone ? `tel:${person.phone}` : null,    target: undefined },
        { label: 'Email',   icon: 'mail'  as const, href: person.email ? `mailto:${person.email}` : null, target: undefined },
        { label: 'Website', icon: 'globe' as const, href: person.website ?? null,                          target: '_blank' as const }
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
        aria-controls="mobile-actions-panel"
        onclick={() => (mobileActionsOpen = !mobileActionsOpen)}
      >
        <Icon name={mobileActionsOpen ? 'x' : 'sparkles'} size={20} />
        <span>{mobileActionsOpen ? 'Close' : 'Actions'}</span>
      </button>
    </div>
    {#if mobileActionsOpen}
      <ul id="mobile-actions-panel" class="mt-2 overflow-hidden rounded-[12px] border border-surface-border bg-surface-card text-sm">
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover"
            onclick={() => { activityOpenTrigger++; mobileActionsOpen = false; }}
          >
            <Icon name="calendar" size={16} /> Log conversation
          </button>
        </li>
        <li class="border-t border-surface-divider">
          <button
            type="button"
            class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover"
            onclick={openAddFamily}
          >
            <Icon name="users" size={16} /> Add family relation
          </button>
        </li>
        {#if person.Linkedin}
          <li class="border-t border-surface-divider">
            <a
              href={person.Linkedin}
              target="_blank"
              rel="noreferrer"
              class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover"
              onclick={() => (mobileActionsOpen = false)}
            >
              <Icon name="globe" size={16} /> Open LinkedIn
            </a>
          </li>
        {/if}
        {#if person.Facebook}
          <li class="border-t border-surface-divider">
            <a
              href={person.Facebook}
              target="_blank"
              rel="noreferrer"
              class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-ink-700 hover:bg-surface-hover"
              onclick={() => (mobileActionsOpen = false)}
            >
              <Icon name="globe" size={16} /> Open Facebook
            </a>
          </li>
        {/if}
      </ul>
    {/if}
  </div>

  <!-- Body: left details / right main -->
  <div class="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
    <!-- LEFT: stacked detail cards -->
    <div class="min-w-0 space-y-5">
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <Icon name={contactMode === 'work' ? 'building' : 'users'} size={16} />
            Contact details
            {#if contactMode === 'work' && primaryOrg}
              <span class="text-ink-300 font-normal">· {primaryOrg.name}</span>
            {/if}
          </span>
          <!-- Segmented Personal/Work toggle — mirrors the calendar's
               view-switcher pattern. Disabled if no primary role exists
               (work fields would be empty anyway). -->
          <div
            class="inline-flex rounded-[8px] border border-surface-border bg-surface-card p-0.5 text-xs"
            role="tablist"
            aria-label="Contact mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={contactMode === 'personal'}
              class="rounded-[6px] px-2 py-1 font-medium transition-colors {contactMode === 'personal' ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-700'}"
              onclick={() => (contactMode = 'personal')}
            >Personal</button>
            <button
              type="button"
              role="tab"
              aria-selected={contactMode === 'work'}
              disabled={!workTabAvailable}
              class="rounded-[6px] px-2 py-1 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed {contactMode === 'work' ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-700'}"
              onclick={() => (contactMode = 'work')}
            >Work</button>
          </div>
        </div>
        <dl class="divide-y divide-surface-divider px-4 pb-3 text-sm">
          {#if contactMode === 'work'}
            <!-- Edit-only: the primary org is in the header AND listed in
                 full by the Roles card, so view mode showed it three times. -->
            {#if editing}
              <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
                <dt class="text-ink-400">Company</dt>
                <dd>
                  {#if primaryOrg}
                    <a class="text-brand hover:underline" href={`/orgs/${primaryOrg.id}`}>{primaryOrg.name}</a>
                  {:else}
                    <span class="text-ink-300">—</span>
                  {/if}
                </dd>
              </div>
            {/if}
            <!-- Edit-only for the same reason as Company above. -->
            {#if editing}
              <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
                <dt class="text-ink-400">Title</dt>
                <dd class="min-w-0 flex-1"><EditableField value={primaryRole?.role ?? null} placeholder="Add title" onSave={(v) => saveRole('role', v)} /></dd>
              </div>
            {/if}
            {#if editing || hasValue(primaryRole?.work_email)}
              <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
                <dt class="text-ink-400">Work email</dt>
                <dd class="min-w-0 flex-1"><EditableField value={primaryRole?.work_email ?? null} type="email" onSave={(v) => saveRole('work_email', v)} /></dd>
              </div>
            {/if}
            {#if editing || hasValue(primaryRole?.work_phone)}
              <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
                <dt class="text-ink-400">Work phone</dt>
                <dd class="min-w-0 flex-1"><EditableField value={primaryRole?.work_phone ?? null} type="phone" onSave={(v) => saveRole('work_phone', v)} /></dd>
              </div>
            {/if}
          {:else}
            <!-- Email / Phone / Website are duplicated by the mobile
                 quick-action row above. Hide them on mobile in view
                 mode (the buttons handle the action); show on mobile
                 only when Edit is on so the user can change the value. -->
            <!-- Edit-only: the header already shows the nickname in quotes. -->
            {#if editing}
              <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
                <dt class="text-ink-400" title="Short label for what this person actually goes by">Nickname</dt>
                <dd class="min-w-0 flex-1"><EditableField value={person.nickname} placeholder='e.g. "Dóri"' onSave={(v) => save('nickname', v)} /></dd>
              </div>
            {/if}
            {#if editing || hasValue(person.email)}
              <div class="{editing ? 'flex' : 'hidden md:flex'} flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
                <dt class="text-ink-400">Email</dt>
                <dd class="min-w-0 flex-1"><EditableField value={person.email} type="email" onSave={(v) => save('email', v)} /></dd>
              </div>
            {/if}
            <!-- Additional addresses, from Person_email. A person used to be
                 able to hold exactly two (this field plus one role's
                 work_email), which is why attendees on a third address
                 resolved to nobody and got created as duplicates. -->
            <PersonEmails personId={person.id} {editing} />
            {#if editing || hasValue(person.phone)}
              <div class="{editing ? 'flex' : 'hidden md:flex'} flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
                <dt class="text-ink-400">Phone</dt>
                <dd class="min-w-0 flex-1"><EditableField value={person.phone} type="phone" onSave={(v) => save('phone', v)} /></dd>
              </div>
            {/if}
            {#if editing || hasValue(person.phone_secondary)}
              <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
                <dt class="text-ink-400">Phone (alt)</dt>
                <dd class="min-w-0 flex-1"><EditableField value={person.phone_secondary} type="phone" onSave={(v) => save('phone_secondary', v)} /></dd>
              </div>
            {/if}
            {#if editing || hasValue(person.website)}
              <div class="{editing ? 'flex' : 'hidden md:flex'} flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
                <dt class="text-ink-400">Website</dt>
                <dd class="min-w-0 flex-1"><EditableField value={person.website} type="url" onSave={(v) => save('website', v)} /></dd>
              </div>
            {/if}
            <!-- Gender is shown as a minimal glyph next to the name in
                 the hero; this row only appears in Edit mode so the
                 user can change the value. -->
            {#if editing}
              <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
                <dt class="text-ink-400">Gender</dt>
                <dd>
                  <EditableField
                    value={person.gender}
                    type="select"
                    options={[
                      { label: 'Male', value: 'male' },
                      { label: 'Female', value: 'female' },
                      { label: 'Other', value: 'other' }
                    ]}
                    onSave={(v) => save('gender', v)}
                  />
                </dd>
              </div>
            {/if}
            {#if editing || hasValue(person.birthday)}
              <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
                <dt class="text-ink-400">Birthday</dt>
                <dd class="min-w-0 flex-1"><EditableField value={person.birthday} type="date" onSave={(v) => save('birthday', v)} /></dd>
              </div>
            {/if}
          {/if}
          <!-- Scope is administrative — only show it in Edit mode. -->
          {#if editing}
            <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
              <dt class="text-ink-400">Scope</dt>
              <dd>
                <EditableField
                  value={person.scope ?? null}
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
        </dl>
      </div>

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
          <!-- Edit mode: lay out the form like a real address slip so it
               feels half the length of a six-row list.
               street → optional second line → postal + city → state + country -->
          <div class="px-4 pb-3 space-y-2 text-sm">
            <div>
              <div class="text-xs text-ink-400 mb-0.5">Street</div>
              <EditableField value={person.address_line1} placeholder="Street address" onSave={(v) => save('address_line1', v)} />
            </div>
            <div>
              <div class="text-xs text-ink-400 mb-0.5">Line 2 <span class="text-ink-300">(optional)</span></div>
              <EditableField value={person.address_line2} placeholder="Apt, suite, building" onSave={(v) => save('address_line2', v)} />
            </div>
            <div class="grid grid-cols-[5rem_1fr] gap-2">
              <div>
                <div class="text-xs text-ink-400 mb-0.5">Postal</div>
                <EditableField value={person.postal_code} onSave={(v) => save('postal_code', v)} />
              </div>
              <div>
                <div class="text-xs text-ink-400 mb-0.5">City</div>
                <EditableField value={person.city} onSave={(v) => save('city', v)} />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <div class="text-xs text-ink-400 mb-0.5">State / Province</div>
                <EditableField value={person.state_province} onSave={(v) => save('state_province', v)} />
              </div>
              <div>
                <div class="text-xs text-ink-400 mb-0.5">Country</div>
                <EditableField value={person.country} onSave={(v) => save('country', v)} />
              </div>
            </div>
          </div>
        {:else}
          <!-- View mode: postal-card style address block + a primary
               "Open in Google Maps" CTA on mobile (also visible on
               desktop as the secondary Maps→ link in the header). -->
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

      <!-- Online profiles — only shown in Edit mode now. The social
           footer at the bottom of the hero card is the source of truth
           for viewing/opening profiles. -->
      <!-- The same card the org page uses, pointed at person_social. Two
           hard-coded fields became any network, and the header glyphs above
           read the same rows. -->
      <!-- Same as the org page: the header carries the social glyphs, so
           this card is the editor rather than a second display of them. -->
      {#if editing || socials.length === 0}
        <OrgSocialCard orgId={person.id} target="Person" {editing} onRows={(r) => (socials = r)} />
      {/if}

      <!-- Tags are owned by `<TagsCard>` inside the Overview tab now.
           The old left-column tag-chip card read from a legacy CSV
           `person.tags` column — kept as backfill source only. -->
    </div>

    <!-- RIGHT: tabs + conversations/activity -->
    <div class="min-w-0 space-y-5">
      <div class="card">
        <div class="flex items-center gap-2 border-b border-surface-divider px-4">
          <button
            class="relative flex items-center gap-2 px-2 py-3 text-sm font-medium transition {tab.value === 'overview' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
            onclick={() => (tab.value = 'overview')}
          >
            <Icon name="sparkles" size={14} /> Overview
            {#if tab.value === 'overview'}
              <span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>
            {/if}
          </button>
          {#if featureOn('family') && (family.length > 0 || familyAddTrigger > 0)}
            <button
              class="relative flex items-center gap-2 px-2 py-3 text-sm font-medium transition {tab.value === 'family' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
              onclick={() => (tab.value = 'family')}
            >
              <Icon name="users" size={14} /> Family {#if family.length > 0}<span class="text-ink-300">{family.length}</span>{/if}
              {#if tab.value === 'family'}
                <span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>
              {/if}
            </button>
          {/if}
          <button
            class="relative flex items-center gap-2 px-2 py-3 text-sm font-medium transition {tab.value === 'activity' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
            onclick={() => (tab.value = 'activity')}
          >
            <Icon name="calendar" size={14} /> Activity
            {#if tab.value === 'activity'}
              <span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>
            {/if}
          </button>
          <button
            class="relative flex items-center gap-2 px-2 py-3 text-sm font-medium transition {tab.value === 'photos' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-700'}"
            onclick={() => (tab.value = 'photos')}
          >
            <Icon name="image" size={14} /> Photos
            {#if tab.value === 'photos'}
              <span class="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand"></span>
            {/if}
          </button>
        </div>

        {#if tab.value === 'overview'}
          <!-- Overview = the *who they are* facets (tags, roles, project
               links). Family gets its own tab when edges exist; otherwise
               FamilyCard stays here so the empty-state CTA is reachable.
               Everything time-based lives in Activity. -->
          <div class="space-y-5 p-4">
            <div hidden={!showTags}>
              <TagsCard target="person" targetId={person.id} bind:links={personTagLinks} />
            </div>

            <div id="roles">
              <RolesCard bind:roles personId={person.id} />
            </div>

            <PersonProjectsCard links={projects} />

            <div hidden={!showEducation}>
              <EducationCard personId={person.id} onCount={(n) => (educationCount = n)} />
            </div>

            <div hidden={!showLanguages}>
              <LanguagesCard personId={person.id} onCount={(n) => (languagesCount = n)} />
            </div>

            <AddFacetRow
              facets={[
                { key: 'tags', label: 'Tags', hidden: !showTags },
                { key: 'education', label: 'Education', hidden: !showEducation },
                { key: 'languages', label: 'Languages', hidden: !showLanguages }
              ]}
              onopen={(k) => (openFacets = { ...openFacets, [k]: true })}
            />

            <!-- Bookkeeping, not biography — a line, not a card. -->
            <p class="text-xs text-ink-400">
              Created {fmtDate(person.date_created)} · Updated {fmtDate(person.date_updated)}
            </p>
          </div>
        {:else if tab.value === 'family'}
          <div class="p-4">
            <FamilyCard bind:edges={family} personId={person.id} viewer={person} openTrigger={familyAddTrigger} />
          </div>
        {:else if tab.value === 'photos'}
          <!-- Photos of this person from the NAS library, via the
               Immich face-cluster mapping. Self-loading component —
               works (or degrades) independently of the rest of the page. -->
          <div class="p-4">
            <PersonPhotos personId={person.id} onSetAvatar={setAvatarFromAsset} />
          </div>
        {:else}
          <!-- Activity = three time-based streams. Filter chips at the
               top toggle between All / Interactions / Notes / Events.
               QuickLogChips only renders for All / Interactions — it's
               an Activity-creation affordance and would mislead users
               when filtered to Notes or Events. -->
          <div class="space-y-4 p-4">
            {#if activityFilter === 'all' || activityFilter === 'activities'}
              <QuickLogChips context={{ kind: 'person', personId: person.id }} />
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
                context={{ kind: 'person', personId: person.id, personName: personName(person) }}
                openTrigger={activityOpenTrigger}
              />
            {/if}
            {#if activityFilter === 'all' || activityFilter === 'notes'}
              <RelatedNotes collection="Person" itemId={person.id} />
            {/if}
            {#if activityFilter === 'all' || activityFilter === 'events'}
              <LinkedEvents kind="person" id={person.id} />
              {#key person.id}
                <EventsCard entity="person" id={person.id} />
              {/key}
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Record metadata — low-priority Source/Type/Language. Sits at the
       very bottom of the page so it doesn't compete with the Contact
       details / Location / Activity content above. Collapsed by default. -->
  <details class="card group">
    <summary class="card-header cursor-pointer list-none">
      <span class="card-title"><Icon name="settings" size={16} /> Record metadata</span>
      <Icon name="chevron-right" size={14} class="text-ink-300 transition-transform group-open:rotate-90" />
    </summary>
    <dl class="divide-y divide-surface-divider px-4 pb-3 text-sm">
      <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
        <dt class="text-ink-400">Source</dt>
        <dd class="min-w-0 flex-1"><EditableField value={person.source} onSave={(v) => save('source', v)} /></dd>
      </div>
      <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
        <dt class="text-ink-400">Type</dt>
        <dd class="min-w-0 flex-1"><EditableField value={person.type} onSave={(v) => save('type', v)} /></dd>
      </div>
      <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
        <dt class="text-ink-400">Language</dt>
        <dd class="min-w-0 flex-1"><EditableField value={person.preferred_language} onSave={(v) => save('preferred_language', v)} /></dd>
      </div>
    </dl>
  </details>
</section>

<style>
  /* The hero H1 wraps an EditableField, which defaults to
     sm:text-right + sm:justify-end so its value column lines up on
     the right edge of form rows elsewhere. In the hero that reads
     as a misaligned title floating away from the avatar. Force
     every descendant back to left-aligned regardless of breakpoint. */
  :global(.hero-name) :global(*) { text-align: left !important; }
  :global(.hero-name) :global(.group) { justify-content: flex-start !important; }
</style>
