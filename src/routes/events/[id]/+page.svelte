<script lang="ts">
  // Event (happening) detail.
  //
  // Built on the same shape as the person and org pages: a hero that STATES
  // the record, then cards that appear when they have something in them, with
  // an Add row for the ones that don't. Editing is a mode you enter, not the
  // page's resting state.
  //
  // It used to be a form. Every field was an input the moment you landed —
  // two datetime-locals to answer "when is this", a <select> showing the kind,
  // a Save button on a page you only wanted to read. The cover image, the one
  // thing that identifies an event at a glance, was a strip behind a tab bar.
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import AddFacetRow from '$lib/AddFacetRow.svelte';
  import {
    assetUrl,
    uploadFile,
    searchPeople,
    searchOrgs,
    searchProjects,
    formatError,
    type Person,
    type Organization,
    type Project,
    type ResolvedProjectBrand
  } from '$lib/directus';
  import EventPreview from '$lib/events/EventPreview.svelte';
  import EventPills from '$lib/events/EventPills.svelte';
  import AttendeeStack from '$lib/events/AttendeeStack.svelte';
  import { formatEventWhen, relativeEventDay } from '$lib/events/eventFormat';
  import PublishToWordPress from '$lib/events/PublishToWordPress.svelte';
  import AddToSocialEvent from '$lib/events/AddToSocialEvent.svelte';
  import type { EventPlatformLink } from '$lib/wordpress';
  import {
    updateEvent,
    deleteEvent,
    addEventPerson,
    removeEventPerson,
    addEventOrg,
    removeEventOrg,
    unlinkEventDate,
    importDateAttendees,
    eventPersonName,
    eventOrgName,
    EVENT_KIND_LABEL,
    EVENT_STATUS_LABEL,
    EVENT_PERSON_ROLES,
    EVENT_ORG_ROLES,
    type EventRecord,
    type EventPerson,
    type EventOrg,
    type EventPhoto,
    type EventDateLink
  } from '$lib/events/data';
  import EventPhotoSuggestions from '$lib/events/EventPhotoSuggestions.svelte';
  import ItemPhotos from '$lib/photos/ItemPhotos.svelte';

  let {
    data
  }: {
    data: {
      event: EventRecord;
      people: EventPerson[];
      orgs: EventOrg[];
      photos: EventPhoto[];
      dates: EventDateLink[];
      brand: ResolvedProjectBrand | null;
      links: EventPlatformLink[];
    };
  } = $props();

  const ev = data.event;
  let name = $state(ev.name ?? '');
  let kind = $state(ev.kind ?? 'other');
  let status = $state(ev.status ?? 'planning');
  let start = $state(ev.start ? ev.start.slice(0, 16) : '');
  let endVal = $state(ev.end ? ev.end.slice(0, 16) : '');
  let location = $state(ev.location_name ?? '');
  let summary = $state(ev.summary ?? '');
  let coverId = $state<string | null>(ev.cover ?? null);
  let projectId = $state<number | null>(
    typeof ev.project_id === 'object' ? (ev.project_id?.id ?? null) : (ev.project_id ?? null)
  );
  let projectName = $state<string | null>(
    typeof ev.project_id === 'object' ? (ev.project_id?.name ?? null) : null
  );

  let people = $state<EventPerson[]>([...data.people]);
  let orgs = $state<EventOrg[]>([...data.orgs]);
  let dates = $state<EventDateLink[]>([...data.dates]);
  let photosReloadKey = $state(0);
  let photoCount = $state<number | null>(null);

  // ── View vs edit ───────────────────────────────────────────────────
  // Same contract as the person/org pages: the pencil reveals every field,
  // including the empty ones, plus destructive actions.
  let editing = $state(false);
  let openFacets = $state<Record<string, boolean>>({});
  const openFacet = (k: string) => (openFacets = { ...openFacets, [k]: true });

  // ── Platform links ─────────────────────────────────────────────────
  let links = $state<EventPlatformLink[]>([...(data.links ?? [])]);
  const linkFor = (platform: string) => links.find((l) => l.platform === platform && l.url) ?? null;
  const fbLink = $derived(linkFor('facebook_event'));
  const liLink = $derived(linkFor('linkedin_event'));
  function onLinkChange(platform: string, link: EventPlatformLink | null) {
    const rest = links.filter((l) => l.platform !== platform);
    links = link ? [...rest, link] : rest;
  }

  const showPeople = $derived(!!openFacets.people || people.length > 0 || editing);
  const showOrgs = $derived(!!openFacets.orgs || orgs.length > 0 || editing);
  const showDates = $derived(!!openFacets.dates || dates.length > 0 || editing);
  const showPhotos = $derived(!!openFacets.photos || (photoCount ?? 0) > 0);
  // Distribution is worth showing whenever this event exists anywhere public,
  // or while editing — pushing to klak.is is an edit-shaped act.
  const showDistribution = $derived(!!openFacets.distribution || links.some((l) => !!l.url) || editing);

  let dirty = $state(false);
  let saving = $state(false);
  let savedFlash = $state(false);
  let errorMsg = $state<string | null>(null);
  const mark = () => (dirty = true);

  // ── Platform preview ───────────────────────────────────────────────
  // Was a tab strip welded under the cover, which made the whole page read
  // as a publishing tool. It's an occasional "how will this look" check, so
  // it lives inside Distribution and starts closed.
  type PreviewPlatform = 'facebook' | 'linkedin' | 'klakis';
  let previewPlatform = $state<PreviewPlatform | null>(null);
  const PREVIEW_PLATFORMS: Array<[PreviewPlatform, string]> = [
    ['facebook', 'Facebook'],
    ['linkedin', 'LinkedIn'],
    ['klakis', 'Website']
  ];

  const previewStart = $derived(start ? new Date(start).toISOString() : null);
  const previewEnd = $derived(endVal ? new Date(endVal).toISOString() : null);
  const coverUrlPreview = $derived(coverId ? assetUrl(coverId, { width: 1200 }) : null);
  const brandAccent = $derived(data.brand?.primary ?? data.brand?.colors?.[0]?.hex ?? null);
  const brandLogoUrl = $derived(
    data.brand?.logoId ? assetUrl(data.brand.logoId, { width: 96, height: 96, fit: 'contain' }) : null
  );

  // ── Hero read-outs ─────────────────────────────────────────────────
  // Built from the live edit state, not the loaded record, so the hero
  // tracks what you just typed instead of going stale until reload.
  const whenLine = $derived(formatEventWhen(previewStart, previewEnd));
  const relativeLine = $derived(relativeEventDay(previewStart));
  const mapsUrl = $derived(
    location.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.trim())}` : null
  );
  const faces = $derived(
    people.map((r) => ({
      id: r.id,
      name: eventPersonName(r),
      picture: typeof r.person_id === 'object' ? (r.person_id?.person_picture ?? null) : null,
      focal: typeof r.person_id === 'object' ? (r.person_id?.image_focal ?? null) : null
    }))
  );

  // Imported klak.is descriptions are full press releases — the BBQ event's
  // is 1,214 characters of bilingual copy split by a '///' marker. Unclamped
  // it pushed the pills, time and faces off the top of the hero, so the hero
  // stopped summarising anything.
  let summaryExpanded = $state(false);
  const summaryIsLong = $derived(summary.trim().length > 360);

  function jumpTo(facet: string, anchor: string) {
    openFacet(facet);
    setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function save() {
    saving = true;
    errorMsg = null;
    try {
      await updateEvent(ev.id, {
        name,
        kind,
        status,
        start: start ? new Date(start).toISOString() : null,
        end: endVal ? new Date(endVal).toISOString() : null,
        location_name: location || null,
        summary: summary || null,
        cover: coverId,
        project_id: projectId
      });
      dirty = false;
      savedFlash = true;
      setTimeout(() => (savedFlash = false), 1500);
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      saving = false;
    }
  }

  async function removeEvent() {
    if (!confirm(`Delete "${name}"? This removes the event and its links (photos files stay in the library).`)) return;
    try {
      await deleteEvent(ev.id);
      await goto('/events');
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  // ── Cover ─────────────────────────────────────────────────────────
  let coverEl: HTMLInputElement | undefined = $state();
  let busy = $state(false);
  async function uploadCover(file: File) {
    busy = true;
    try {
      coverId = await uploadFile(file, { title: `${name || 'event'} — cover` });
      await updateEvent(ev.id, { cover: coverId });
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      busy = false;
    }
  }

  // ── Project picker ─────────────────────────────────────────────────
  let projQuery = $state('');
  let projResults = $state<Project[]>([]);
  let projTimer: ReturnType<typeof setTimeout> | null = null;
  function onProjQuery(v: string) {
    projQuery = v;
    if (projTimer) clearTimeout(projTimer);
    if (!v.trim()) { projResults = []; return; }
    projTimer = setTimeout(async () => {
      try { projResults = (await searchProjects(v, 8)) as Project[]; } catch { projResults = []; }
    }, 180);
  }
  async function pickProject(p: Project | null) {
    projectId = p?.id ?? null;
    projectName = p?.name ?? null;
    projQuery = '';
    projResults = [];
    mark();
  }

  // ── People + org adders ────────────────────────────────────────────
  let personQuery = $state('');
  let personResults = $state<Person[]>([]);
  let personRole = $state('attendee');
  let personTimer: ReturnType<typeof setTimeout> | null = null;
  function onPersonQuery(v: string) {
    personQuery = v;
    if (personTimer) clearTimeout(personTimer);
    if (!v.trim()) { personResults = []; return; }
    personTimer = setTimeout(async () => {
      try { personResults = (await searchPeople(v, 8)) as Person[]; } catch { personResults = []; }
    }, 180);
  }
  async function addPerson(p: Person) {
    try {
      const row = await addEventPerson(ev.id, p.id, personRole.trim() || 'attendee');
      row.person_id = p;
      people = [...people, row];
      personQuery = '';
      personResults = [];
    } catch (e) {
      errorMsg = formatError(e);
    }
  }
  async function dropPerson(row: EventPerson) {
    try { await removeEventPerson(row.id); people = people.filter((x) => x.id !== row.id); }
    catch (e) { errorMsg = formatError(e); }
  }

  let orgQuery = $state('');
  let orgResults = $state<Organization[]>([]);
  let orgRole = $state('sponsor');
  let orgTimer: ReturnType<typeof setTimeout> | null = null;
  function onOrgQuery(v: string) {
    orgQuery = v;
    if (orgTimer) clearTimeout(orgTimer);
    if (!v.trim()) { orgResults = []; return; }
    orgTimer = setTimeout(async () => {
      try { orgResults = (await searchOrgs(v, 8)) as Organization[]; } catch { orgResults = []; }
    }, 180);
  }
  async function addOrg(o: Organization) {
    try {
      const row = await addEventOrg(ev.id, o.id, orgRole.trim() || 'partner');
      row.organization_id = o;
      orgs = [...orgs, row];
      orgQuery = '';
      orgResults = [];
    } catch (e) {
      errorMsg = formatError(e);
    }
  }
  async function dropOrg(row: EventOrg) {
    try { await removeEventOrg(row.id); orgs = orgs.filter((x) => x.id !== row.id); }
    catch (e) { errorMsg = formatError(e); }
  }

  function byRole<T extends { role?: string | null }>(rows: T[]): Array<[string, T[]]> {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const k = r.role?.trim() || 'other';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()];
  }
  const peopleByRole = $derived(byRole(people));
  const orgsByRole = $derived(byRole(orgs));

  // ── Calendar date link ─────────────────────────────────────────────
  let importing = $state<number | null>(null);
  async function importAttendees(link: EventDateLink) {
    const did = typeof link.dates_id === 'object' ? link.dates_id?.id : link.dates_id;
    if (did == null) return;
    importing = link.id;
    errorMsg = null;
    try {
      const added = await importDateAttendees(ev.id, did);
      if (added > 0) {
        const { listEventPeople } = await import('$lib/events/data');
        people = await listEventPeople(ev.id);
      }
      errorMsg = added > 0 ? null : 'No new attendees to import from that date.';
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      importing = null;
    }
  }
  async function dropDate(row: EventDateLink) {
    try { await unlinkEventDate(row.id); dates = dates.filter((x) => x.id !== row.id); }
    catch (e) { errorMsg = formatError(e); }
  }

  const fmtDateTime = (iso?: string | null) =>
    iso ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '';
</script>

<svelte:head><title>{name || 'Event'} · Events</title></svelte:head>

<section class="mx-auto max-w-3xl space-y-5 pb-16">
  <a href="/events" class="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700">
    <Icon name="chevron-left" size={12} /> Events
  </a>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-3 text-sm" style="color: #C0392B;">{errorMsg}</div>
  {/if}

  <!-- ── Hero ───────────────────────────────────────────────────────
       Cover as the identity, then title, pills, one time line, one
       place line, and the faces. Everything here is a statement; the
       pencil is the only control. -->
  <div class="card relative overflow-hidden">
    <div class="relative">
      {#if coverId}
        <img
          src={assetUrl(coverId, { width: 1200, height: 400, fit: 'cover' })}
          alt=""
          class="h-36 w-full object-cover sm:h-48"
          fetchpriority="high"
          decoding="async"
        />
      {:else if editing}
        <div class="h-20 w-full" style="background: var(--bg-tertiary);"></div>
      {/if}
      <!-- The cover control only appears in edit mode. On a page you're
           reading, "Change cover" floating over the artwork is noise. -->
      {#if editing}
        <button
          class="btn-ghost absolute bottom-2 right-2 !px-2 text-xs"
          style="background: rgba(0,0,0,0.4); color: #fff;"
          disabled={busy}
          onclick={() => coverEl?.click()}
        >{busy ? 'Uploading…' : coverId ? 'Change cover' : '+ Cover'}</button>
        <input type="file" accept="image/*" class="hidden" bind:this={coverEl}
          onchange={(e) => { const f=(e.currentTarget as HTMLInputElement).files?.[0]; if(f) uploadCover(f); (e.currentTarget as HTMLInputElement).value=''; }} />
      {/if}
    </div>

    <div class="relative p-4 sm:p-5">
      <button
        type="button"
        class="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-400 hover:bg-surface-hover hover:text-ink-900 {editing ? 'bg-brand text-white hover:bg-brand hover:text-white' : ''}"
        aria-pressed={editing}
        aria-label={editing ? 'Done editing' : 'Edit event'}
        title={editing ? 'Done — hide empty fields and admin actions' : 'Edit — show every field + admin actions'}
        onclick={() => (editing = !editing)}
      >
        <Icon name={editing ? 'check' : 'pencil'} size={16} />
      </button>

      {#if !editing}
        <div class="pr-10">
          <h1 class="font-display text-xl font-bold leading-tight text-ink-900" style="letter-spacing:-0.02em;">
            {name || '(untitled event)'}
          </h1>
          <div class="mt-2">
            <EventPills {kind} {status} {projectName} {projectId} />
          </div>

          <!-- One time line. The old page made you read two datetime
               inputs and notice the dates matched. -->
          {#if whenLine}
            <p class="mt-2.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-600">
              <span class="inline-flex items-center gap-1.5">
                <Icon name="clock" size={14} class="shrink-0 text-ink-400" />
                {whenLine}
              </span>
              {#if relativeLine}
                <span class="text-ink-300">·</span>
                <span class="text-ink-400">{relativeLine}</span>
              {/if}
            </p>
          {/if}

          {#if location.trim()}
            <p class="mt-1 flex items-center gap-1.5 text-sm text-ink-600">
              <Icon name="globe" size={14} class="shrink-0 text-ink-400" />
              {#if mapsUrl}
                <a href={mapsUrl} target="_blank" rel="noreferrer" class="hover:text-brand">{location}</a>
              {:else}{location}{/if}
            </p>
          {/if}

          <!-- Counts double as navigation, the same way the org header's
               grant summary jumps to its card. -->
          {#if people.length > 0 || orgs.length > 0 || (photoCount ?? 0) > 0}
            <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
              {#if people.length > 0}
                <button type="button" class="hover:text-brand" onclick={() => jumpTo('people', 'event-people')}>
                  {people.length} {people.length === 1 ? 'person' : 'people'}
                </button>
              {/if}
              {#if orgs.length > 0}
                {#if people.length > 0}<span class="text-ink-300">·</span>{/if}
                <button type="button" class="hover:text-brand" onclick={() => jumpTo('orgs', 'event-orgs')}>
                  {orgs.length} {orgs.length === 1 ? 'org' : 'orgs'}
                </button>
              {/if}
              {#if (photoCount ?? 0) > 0}
                {#if people.length > 0 || orgs.length > 0}<span class="text-ink-300">·</span>{/if}
                <button type="button" class="hover:text-brand" onclick={() => jumpTo('photos', 'event-photos')}>
                  {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
                </button>
              {/if}
            </p>
          {/if}

          {#if summary.trim()}
            <p
              class="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-700 {summaryIsLong && !summaryExpanded ? 'line-clamp-5' : ''}"
            >{summary}</p>
            {#if summaryIsLong}
              <button
                type="button"
                class="mt-1 text-xs font-medium text-brand hover:underline"
                aria-expanded={summaryExpanded}
                onclick={() => (summaryExpanded = !summaryExpanded)}
              >{summaryExpanded ? 'Show less' : 'Show more'}</button>
            {/if}
          {/if}

          {#if faces.length > 0}
            <div class="mt-3">
              <AttendeeStack {faces} onclick={() => jumpTo('people', 'event-people')} />
            </div>
          {/if}
        </div>
      {:else}
        <!-- ── Edit mode ────────────────────────────────────────────
             The old always-on form, now behind the pencil. -->
        <div class="space-y-3 pr-10">
          <input class="input w-full font-display text-xl font-bold" style="letter-spacing:-0.02em;" placeholder="Event name" bind:value={name} oninput={mark} />
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="text-xs text-ink-500">Kind
              <select class="input mt-0.5 w-full text-sm" bind:value={kind} onchange={mark}>
                {#each Object.entries(EVENT_KIND_LABEL) as [v, l] (v)}<option value={v}>{l}</option>{/each}
              </select>
            </label>
            <label class="text-xs text-ink-500">Status
              <select class="input mt-0.5 w-full text-sm" bind:value={status} onchange={mark}>
                {#each ['idea','planning','upcoming','past','archived'] as s (s)}<option value={s}>{EVENT_STATUS_LABEL[s]}</option>{/each}
              </select>
            </label>
            <label class="text-xs text-ink-500">Starts<input type="datetime-local" class="input mt-0.5 w-full text-sm" bind:value={start} onchange={mark} /></label>
            <label class="text-xs text-ink-500">Ends<input type="datetime-local" class="input mt-0.5 w-full text-sm" bind:value={endVal} onchange={mark} /></label>
            <label class="text-xs text-ink-500 sm:col-span-2">Location
              <input class="input mt-0.5 w-full text-sm" placeholder="Venue or address" bind:value={location} oninput={mark} />
            </label>
          </div>

          <div>
            <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Project</div>
            {#if projectId}
              <span class="inline-flex items-center gap-1.5 rounded-full border border-surface-border px-2 py-0.5 text-[11px] text-ink-700">
                {projectName ?? `#${projectId}`}
                <button class="cursor-pointer text-ink-300 hover:text-ink-700" title="Unlink" onclick={() => pickProject(null)}><Icon name="x" size={10} /></button>
              </span>
            {:else}
              <div class="relative">
                <input class="input w-full text-sm" placeholder="Link a project…" value={projQuery} oninput={(e) => onProjQuery((e.currentTarget as HTMLInputElement).value)} />
                {#if projResults.length > 0}
                  <div class="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-surface-border bg-surface-card shadow-lg">
                    {#each projResults as p (p.id)}
                      <button class="block w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-surface-hover" onclick={() => pickProject(p)}>{p.name}</button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>

          <label class="block text-xs text-ink-500">Description
            <textarea class="input mt-0.5 w-full text-sm" rows="4" placeholder="What happened / what it's about…" bind:value={summary} oninput={mark}></textarea>
          </label>

          <div class="flex items-center justify-between gap-2">
            <button class="text-xs text-ink-300 hover:text-tag-salesText" onclick={removeEvent}>Delete event</button>
            <button class="btn-primary" disabled={saving || !dirty} onclick={save}>
              {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : dirty ? 'Save' : 'Saved'}
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Brand context, inherited from the project. Read-only, so it's a
       single line rather than a card with a title. -->
  {#if data.brand && (data.brand.colors.length > 0 || data.brand.logoId)}
    <div class="flex items-center gap-3 rounded-[14px] border border-surface-border bg-surface-card px-4 py-2.5">
      {#if data.brand.logoId}<img src={assetUrl(data.brand.logoId, { width: 64, height: 64, fit: 'contain' })} alt="" class="h-7 w-7 rounded object-contain" loading="lazy" />{/if}
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Brand</span>
      <span class="flex flex-wrap gap-1">
        {#each data.brand.colors as c (c.hex)}
          <span class="h-5 w-5 rounded-full border border-surface-border" style="background: {c.hex};" title={c.label ?? c.hex}></span>
        {/each}
      </span>
    </div>
  {/if}

  <!-- ── People ─────────────────────────────────────────────────── -->
  <div id="event-people" class="scroll-mt-20" hidden={!showPeople}>
    <div class="card p-4 space-y-3">
      <div class="card-title">
        <Icon name="users" size={16} /> People
        {#if people.length > 0}<span class="font-normal text-ink-300">{people.length}</span>{/if}
      </div>
      {#each peopleByRole as [role, rows] (role)}
        <div>
          <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">{role}</div>
          <div class="flex flex-wrap gap-1.5">
            {#each rows as r (r.id)}
              <span class="inline-flex items-center gap-1.5 rounded-full border border-surface-border py-0.5 pl-1 pr-2 text-[11px] text-ink-700">
                {#if typeof r.person_id === 'object' && r.person_id?.person_picture}
                  <img src={assetUrl(r.person_id.person_picture, { width: 40, height: 40, fit: 'cover' })} alt="" class="h-5 w-5 rounded-full object-cover" loading="lazy" />
                {/if}
                {#if typeof r.person_id === 'object' && r.person_id?.id}
                  <a href={`/people/${r.person_id.id}`} class="hover:text-brand">{eventPersonName(r)}</a>
                {:else}
                  {eventPersonName(r)}
                {/if}
                {#if editing}
                  <button class="cursor-pointer text-ink-300 hover:text-ink-700" aria-label={`Remove ${eventPersonName(r)}`} onclick={() => dropPerson(r)}><Icon name="x" size={10} /></button>
                {/if}
              </span>
            {/each}
          </div>
        </div>
      {/each}
      {#if editing}
        <div class="flex gap-2">
          <input class="input w-24 shrink-0 text-xs" placeholder="role" bind:value={personRole} list="person-roles" />
          <datalist id="person-roles">{#each EVENT_PERSON_ROLES as r (r)}<option value={r}></option>{/each}</datalist>
          <div class="relative flex-1">
            <input class="input w-full text-sm" placeholder="Add a person…" value={personQuery} oninput={(e) => onPersonQuery((e.currentTarget as HTMLInputElement).value)} />
            {#if personResults.length > 0}
              <div class="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-surface-border bg-surface-card shadow-lg">
                {#each personResults as p (p.id)}
                  <button class="block w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-surface-hover" onclick={() => addPerson(p)}>{p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ')}</button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {:else if people.length === 0}
        <p class="text-xs text-ink-400">Nobody attached yet — use the pencil to add people.</p>
      {/if}
    </div>
  </div>

  <!-- ── Organizations ──────────────────────────────────────────── -->
  <div id="event-orgs" class="scroll-mt-20" hidden={!showOrgs}>
    <div class="card p-4 space-y-3">
      <div class="card-title">
        <Icon name="building" size={16} /> Organizations &amp; teams
        {#if orgs.length > 0}<span class="font-normal text-ink-300">{orgs.length}</span>{/if}
      </div>
      {#each orgsByRole as [role, rows] (role)}
        <div>
          <div class="mb-1 font-display text-[10px] uppercase tracking-wider text-ink-400">{role}</div>
          <div class="flex flex-wrap gap-1.5">
            {#each rows as r (r.id)}
              <span class="inline-flex items-center gap-1.5 rounded-full border border-surface-border py-0.5 pl-1 pr-2 text-[11px] text-ink-700">
                {#if typeof r.organization_id === 'object' && r.organization_id?.logo}
                  <img src={assetUrl(r.organization_id.logo, { width: 40, height: 40, fit: 'contain' })} alt="" class="h-5 w-5 rounded object-contain" loading="lazy" />
                {/if}
                {#if typeof r.organization_id === 'object' && r.organization_id?.id}
                  <a href={`/orgs/${r.organization_id.id}`} class="hover:text-brand">{eventOrgName(r)}</a>
                {:else}
                  {eventOrgName(r)}
                {/if}
                {#if editing}
                  <button class="cursor-pointer text-ink-300 hover:text-ink-700" aria-label={`Remove ${eventOrgName(r)}`} onclick={() => dropOrg(r)}><Icon name="x" size={10} /></button>
                {/if}
              </span>
            {/each}
          </div>
        </div>
      {/each}
      {#if editing}
        <div class="flex gap-2">
          <input class="input w-24 shrink-0 text-xs" placeholder="role" bind:value={orgRole} list="org-roles" />
          <datalist id="org-roles">{#each EVENT_ORG_ROLES as r (r)}<option value={r}></option>{/each}</datalist>
          <div class="relative flex-1">
            <input class="input w-full text-sm" placeholder="Add an organization…" value={orgQuery} oninput={(e) => onOrgQuery((e.currentTarget as HTMLInputElement).value)} />
            {#if orgResults.length > 0}
              <div class="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-surface-border bg-surface-card shadow-lg">
                {#each orgResults as o (o.id)}
                  <button class="block w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-surface-hover" onclick={() => addOrg(o)}>{o.name}</button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {:else if orgs.length === 0}
        <p class="text-xs text-ink-400">No organizations attached yet — use the pencil to add them.</p>
      {/if}
    </div>
  </div>

  <!-- ── Distribution ───────────────────────────────────────────────
       klak.is + Facebook + LinkedIn were three separate cards, two of
       which said nothing most of the time. One card, one status row
       each, and the platform previews tucked behind a toggle. -->
  <div id="event-distribution" class="scroll-mt-20" hidden={!showDistribution}>
    <div class="card p-4 space-y-3">
      <div class="card-title"><Icon name="bolt" size={16} /> Distribution</div>

      <PublishToWordPress
        bare
        eventId={ev.id}
        event={{ id: ev.id, name, start, end: endVal, location_name: location, summary, cover: coverId }}
        sourceUrl={ev.source_url}
        onChange={(l) => onLinkChange('wordpress', l)}
      />

      <div class="flex flex-wrap items-center gap-2 border-t border-surface-divider pt-3">
        <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Also on</span>
        <AddToSocialEvent platform="facebook_event" eventId={ev.id} event={{ name, start: previewStart, end: previewEnd, location_name: location, summary }} sourceUrl={ev.source_url} link={fbLink} onChange={onLinkChange} />
        <AddToSocialEvent platform="linkedin_event" eventId={ev.id} event={{ name, start: previewStart, end: previewEnd, location_name: location, summary }} sourceUrl={ev.source_url} link={liLink} onChange={onLinkChange} />
      </div>

      <div class="border-t border-surface-divider pt-3">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="mr-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Preview</span>
          {#each PREVIEW_PLATFORMS as [p, label] (p)}
            <button
              type="button"
              class="chip-radio {previewPlatform === p ? 'is-selected' : ''}"
              aria-pressed={previewPlatform === p}
              onclick={() => (previewPlatform = previewPlatform === p ? null : p)}
            >{label}</button>
          {/each}
        </div>
        {#if previewPlatform}
          <div class="mt-3 rounded-[10px] bg-surface-hover/30 p-3">
            <EventPreview
              platform={previewPlatform}
              name={name || '(untitled event)'}
              start={previewStart}
              end={previewEnd}
              location={location}
              summary={summary}
              coverUrl={coverUrlPreview}
              hostName={projectName}
              hostAvatarUrl={brandLogoUrl}
              attendeeCount={people.length}
              accent={brandAccent}
            />
            <p class="mt-2 text-center text-[11px] text-ink-400">
              Approximate — reflects unsaved edits. Actual rendering varies by platform.
            </p>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- ── Calendar dates ─────────────────────────────────────────── -->
  <div id="event-dates" class="scroll-mt-20" hidden={!showDates}>
    <div class="card p-4 space-y-3">
      <div class="card-title">
        <Icon name="calendar" size={16} /> Calendar dates
        {#if dates.length > 0}<span class="font-normal text-ink-300">{dates.length}</span>{/if}
      </div>
      {#if dates.length === 0}
        <p class="text-xs text-ink-400">Link the calendar entry that was this event, then import its attendees.</p>
      {/if}
      {#each dates as d (d.id)}
        {@const de = typeof d.dates_id === 'object' ? d.dates_id : null}
        <div class="flex items-center gap-2 rounded-md border border-surface-border px-3 py-2">
          <Icon name="calendar" size={14} class="shrink-0 text-ink-400" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm text-ink-900">{de?.title ?? `Date #${typeof d.dates_id === 'number' ? d.dates_id : ''}`}</span>
            {#if de?.start}<span class="text-[11px] text-ink-500">{fmtDateTime(de.start)}</span>{/if}
          </span>
          <button class="btn-ghost !px-2 text-[11px]" disabled={importing !== null} onclick={() => importAttendees(d)}>
            {importing === d.id ? 'Importing…' : 'Import attendees'}
          </button>
          {#if editing}
            <button class="cursor-pointer text-ink-300 hover:text-ink-700" title="Unlink" onclick={() => dropDate(d)}><Icon name="x" size={12} /></button>
          {/if}
        </div>
      {/each}
      <a href="/calendar/grid" class="text-[11px] text-ink-400 hover:text-ink-700">Open the calendar to find a date →</a>
    </div>
  </div>

  <!-- ── Photos ─────────────────────────────────────────────────────
       Always mounted so it can report its count to the hero; the
       wrapper hides it when there's nothing and nobody asked. -->
  <div id="event-photos" class="scroll-mt-20" hidden={!showPhotos}>
    <div class="card p-4 space-y-3">
      <div class="card-title">
        <Icon name="image" size={16} /> Photos
        {#if (photoCount ?? 0) > 0}<span class="font-normal text-ink-300">{photoCount}</span>{/if}
      </div>
      {#key photosReloadKey}
        <ItemPhotos collection="event" itemId={ev.id} onCount={(n) => (photoCount = n)} />
      {/key}
    </div>
  </div>

  <AddFacetRow
    facets={[
      { key: 'people', label: 'People', hidden: !showPeople },
      { key: 'orgs', label: 'Organizations', hidden: !showOrgs },
      { key: 'distribution', label: 'Distribution', hidden: !showDistribution },
      { key: 'dates', label: 'Calendar date', hidden: !showDates },
      { key: 'photos', label: 'Photos', hidden: !showPhotos }
    ]}
    onopen={openFacet}
  />

  <!-- Suggested photos by timestamp. Self-hides without a start date. -->
  <EventPhotoSuggestions
    eventId={ev.id}
    start={ev.start ?? null}
    end={ev.end ?? null}
    onAdded={() => (photosReloadKey += 1)}
  />
</section>
