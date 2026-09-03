<script lang="ts">
  // Detail page for a single GrantAward. Lists every column the
  // import captures from Rannís plus the resolved relations (programme,
  // applicant org, contact person/org, domain/subdomain).
  //
  // When the import couldn't auto-link the applicant or contact, the
  // raw label is shown with a Link button — clicking opens a small
  // autocomplete that picks an existing org/person.
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import EditableField from '$lib/EditableField.svelte';
  import {
    updateGrantAward,
    removeGrantAward,
    searchOrgs,
    searchPeople,
    avatarSrc,
    formatGrantAmount,
    regionLabel,
    REGION_CHOICES,
    personName,
    type GrantAward,
    type Organization,
    type Person,
    type Grant,
    type Domain,
    type Subdomain
  } from '$lib/directus';
  import { goto } from '$app/navigation';

  let { data }: { data: { award: GrantAward } } = $props();
  let award = $state<GrantAward>(data.award);
  $effect(() => { award = data.award; });

  const org = $derived(award.organization_id && typeof award.organization_id === 'object' ? (award.organization_id as Organization) : null);
  const grant = $derived(award.grant_id && typeof award.grant_id === 'object' ? (award.grant_id as Grant) : null);
  const dom = $derived(award.domain_id && typeof award.domain_id === 'object' ? (award.domain_id as Domain) : null);
  const sub = $derived(award.subdomain_id && typeof award.subdomain_id === 'object' ? (award.subdomain_id as Subdomain) : null);
  const contactPerson = $derived(award.contact_person_id && typeof award.contact_person_id === 'object' ? (award.contact_person_id as Person) : null);
  const contactOrg = $derived(award.contact_org_id && typeof award.contact_org_id === 'object' ? (award.contact_org_id as Organization) : null);

  async function save<K extends keyof GrantAward>(field: K, value: GrantAward[K] | null) {
    const patched = await updateGrantAward(award.id, { [field]: value } as Partial<GrantAward>);
    // Patch returns the bare row — keep the expanded relations we
    // already have so the page doesn't lose nested labels on every save.
    award = { ...award, ...patched };
  }

  // ── Applicant link picker ───────────────────────────────────────
  // When applicant_label is set but organization_id is null (the
  // import couldn't find a matching org), this is the affordance the
  // user uses to fix it without leaving the page.
  let linkApplicantOpen = $state(false);
  let applicantQuery = $state('');
  let applicantResults = $state<Organization[]>([]);
  let applicantTimer: ReturnType<typeof setTimeout> | null = null;
  function onApplicantQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    applicantQuery = v;
    if (applicantTimer) clearTimeout(applicantTimer);
    applicantTimer = setTimeout(async () => {
      if (!v.trim()) { applicantResults = []; return; }
      try { applicantResults = await searchOrgs(v, 8); } catch { applicantResults = []; }
    }, 180);
  }
  async function pickApplicant(o: Organization) {
    const patched = await updateGrantAward(award.id, { organization_id: o.id } as unknown as Partial<GrantAward>);
    award = { ...award, ...patched, organization_id: o };
    linkApplicantOpen = false;
    applicantQuery = ''; applicantResults = [];
  }

  // ── Contact link picker (person OR org) ─────────────────────────
  let linkContactOpen = $state(false);
  let contactKind = $state<'person' | 'org'>('person');
  let contactQuery = $state('');
  let contactResults = $state<Array<Person | Organization>>([]);
  let contactTimer: ReturnType<typeof setTimeout> | null = null;
  function onContactQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    contactQuery = v;
    if (contactTimer) clearTimeout(contactTimer);
    contactTimer = setTimeout(async () => {
      if (!v.trim()) { contactResults = []; return; }
      try {
        contactResults = contactKind === 'person'
          ? await searchPeople(v, 8) as Person[]
          : await searchOrgs(v, 8);
      } catch { contactResults = []; }
    }, 180);
  }
  async function pickContact(item: Person | Organization) {
    if (contactKind === 'person') {
      const patched = await updateGrantAward(award.id, { contact_person_id: item.id, contact_org_id: null } as unknown as Partial<GrantAward>);
      award = { ...award, ...patched, contact_person_id: item as Person, contact_org_id: null };
    } else {
      const patched = await updateGrantAward(award.id, { contact_org_id: item.id, contact_person_id: null } as unknown as Partial<GrantAward>);
      award = { ...award, ...patched, contact_org_id: item as Organization, contact_person_id: null };
    }
    linkContactOpen = false;
    contactQuery = ''; contactResults = [];
  }

  // ── Archive ─────────────────────────────────────────────────────
  async function archive() {
    if (!confirm('Archive this award?')) return;
    await removeGrantAward(award.id);
    goto('/grants');
  }

  const contactDisplayName = $derived(
    contactPerson ? personName(contactPerson) :
    contactOrg ? (contactOrg.name ?? null) :
    award.contact_label ?? null
  );
</script>

<svelte:head>
  <title>{award.award_name ?? 'Award'} · {grant?.name ?? 'Grant'}</title>
</svelte:head>

<section class="space-y-4">
  <!-- Hero -->
  <div class="card p-4 sm:p-5">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <!-- Programme tag — small, above the title, so the title
             gets the visual weight. -->
        {#if grant}
          <a href={`/grants/${grant.id}`} class="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-400 hover:text-brand">
            {#if grant.color}<span class="inline-block h-2 w-2 rounded-full" style:background-color={grant.color}></span>{/if}
            <span class="font-display font-medium">{grant.name}</span>
          </a>
        {/if}
        <h1 class="mt-1 font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.02em;">
          <EditableField
            value={award.award_name ?? null}
            placeholder="Heiti verkefnis"
            onSave={(v) => save('award_name', (v ?? '').trim() || null)}
          />
        </h1>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
          <span class="tabular-nums">{award.fund_year ?? award.awarded_year ?? '—'}</span>
          {#if award.region_acronym}
            <span class="rounded-full border border-surface-border px-2 py-0.5 text-[11px]" title={regionLabel(award.region_acronym) ?? ''}>{award.region_acronym}</span>
          {/if}
          {#if award.external_id}
            <span class="font-mono text-[11px] text-ink-400">{award.external_id}</span>
          {/if}
        </div>
      </div>
      <!-- Headline amount — right-aligned, big. -->
      <div class="text-right">
        <div class="font-display tabular-nums text-2xl font-bold text-ink-900 sm:text-3xl" style="letter-spacing: -0.02em;">
          {formatGrantAmount(award.total_amount, award.currency)}
        </div>
        <div class="mt-1 text-[10px] uppercase tracking-wider text-ink-400">Úthlutun</div>
      </div>
    </div>
  </div>

  <div class="grid gap-4 lg:grid-cols-3">
    <!-- Main column: applicant, description, contact -->
    <div class="space-y-4 lg:col-span-2">
      <!-- Applicant -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="building" size={16} /> Umsækjandi</span>
        </div>
        <div class="px-4 py-3">
          {#if org}
            <a href={`/orgs/${org.id}`} class="flex items-center gap-3 rounded-md p-2 hover:bg-surface-hover">
              <Avatar name={org.name ?? '?'} src={avatarSrc(org.logo, org.image_focal, 80)} size={40} />
              <div class="min-w-0">
                <div class="truncate font-medium text-ink-900">{org.name}</div>
                <div class="truncate text-xs text-ink-400">
                  {[org.industry, org.region].filter(Boolean).join(' · ') || 'Tap to open'}
                </div>
              </div>
              <Icon name="chevron-right" size={14} class="ml-auto text-ink-300" />
            </a>
            {#if award.applicant_label && award.applicant_label !== org.name}
              <div class="mt-1 px-2 text-[11px] text-ink-400">Original label: {award.applicant_label}</div>
            {/if}
          {:else}
            <div class="rounded-md border border-dashed border-tag-sales bg-tag-sales/10 p-3">
              <div class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate font-medium text-ink-900">{award.applicant_label ?? '(no applicant)'}</div>
                  <div class="text-[11px] text-tag-salesText">Not linked to an org yet.</div>
                </div>
                <button
                  type="button"
                  class="btn-primary !py-1 !px-3 text-xs"
                  onclick={() => { linkApplicantOpen = !linkApplicantOpen; if (!applicantQuery && award.applicant_label) { applicantQuery = award.applicant_label; void onApplicantQuery({ currentTarget: { value: award.applicant_label } } as unknown as Event); } }}
                >Link to org</button>
              </div>
              {#if linkApplicantOpen}
                <div class="mt-3 space-y-2">
                  <input
                    type="search"
                    placeholder="Search organisations…"
                    value={applicantQuery}
                    oninput={onApplicantQuery}
                    autofocus
                    class="w-full rounded-md border border-surface-border bg-surface-card px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                  />
                  {#if applicantResults.length}
                    <ul class="max-h-64 overflow-y-auto rounded-md border border-surface-border bg-surface-card">
                      {#each applicantResults as o (o.id)}
                        <li>
                          <button
                            type="button"
                            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
                            onclick={() => pickApplicant(o)}
                          >
                            <Avatar name={o.name ?? '?'} src={avatarSrc(o.logo, o.image_focal, 48)} size={22} />
                            <span class="flex-1 truncate text-ink-900">{o.name}</span>
                            {#if o.industry}<span class="text-[11px] text-ink-400">{o.industry}</span>{/if}
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {:else if applicantQuery.trim()}
                    <div class="text-xs text-ink-400">
                      No match. <a href={`/orgs?new=${encodeURIComponent(applicantQuery)}`} class="text-brand hover:underline">Create "{applicantQuery}"</a> first, then come back.
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Description (project abstract) -->
      {#if award.description}
        <div class="card">
          <div class="card-header"><span class="card-title"><Icon name="book-open" size={16} /> Lýsing verkefnis</span></div>
          <div class="whitespace-pre-line px-4 py-3 text-sm leading-relaxed text-ink-700">{award.description}</div>
        </div>
      {/if}

      <!-- Contact (Verkefnisstjóri) -->
      <div class="card">
        <div class="card-header"><span class="card-title"><Icon name="users" size={16} /> Verkefnisstjóri</span></div>
        <div class="px-4 py-3">
          {#if contactPerson}
            <a href={`/people/${contactPerson.id}`} class="flex items-center gap-3 rounded-md p-2 hover:bg-surface-hover">
              <Avatar name={personName(contactPerson)} size={32} />
              <div class="min-w-0">
                <div class="truncate font-medium text-ink-900">{personName(contactPerson)}</div>
                {#if contactPerson.email}<div class="truncate text-xs text-ink-400">{contactPerson.email}</div>{/if}
              </div>
              <Icon name="chevron-right" size={14} class="ml-auto text-ink-300" />
            </a>
          {:else if contactOrg}
            <a href={`/orgs/${contactOrg.id}`} class="flex items-center gap-3 rounded-md p-2 hover:bg-surface-hover">
              <Avatar name={contactOrg.name ?? '?'} src={avatarSrc(contactOrg.logo, contactOrg.image_focal, 80)} size={32} />
              <div class="min-w-0">
                <div class="truncate font-medium text-ink-900">{contactOrg.name}</div>
                <div class="text-xs text-ink-400">Organisation contact</div>
              </div>
              <Icon name="chevron-right" size={14} class="ml-auto text-ink-300" />
            </a>
          {:else if award.contact_label}
            <div class="rounded-md border border-dashed border-tag-sales bg-tag-sales/10 p-3">
              <div class="flex items-center justify-between gap-2">
                <div class="min-w-0">
                  <div class="truncate font-medium text-ink-900">{award.contact_label}</div>
                  <div class="text-[11px] text-tag-salesText">Not linked yet.</div>
                </div>
                <button
                  type="button"
                  class="btn-primary !py-1 !px-3 text-xs"
                  onclick={() => { linkContactOpen = !linkContactOpen; if (!contactQuery && award.contact_label) { contactQuery = award.contact_label; void onContactQuery({ currentTarget: { value: award.contact_label } } as unknown as Event); } }}
                >Link…</button>
              </div>
              {#if linkContactOpen}
                <div class="mt-3 space-y-2">
                  <!-- Toggle person vs org. Defaults to person —
                       Verkefnisstjóri is usually a human. -->
                  <div
                    class="inline-flex p-0.5"
                    role="radiogroup"
                    aria-label="Contact kind"
                    style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
                  >
                    {#each [['person', 'Person'], ['org', 'Organisation']] as const as [k, label]}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={contactKind === k}
                        class="font-display px-3 py-1 text-xs font-medium transition"
                        style={contactKind === k
                          ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: calc(var(--radius-md) - 2px);'
                          : 'background: transparent; color: var(--text-secondary);'}
                        onclick={() => { contactKind = k; contactResults = []; }}
                      >{label}</button>
                    {/each}
                  </div>
                  <input
                    type="search"
                    placeholder={contactKind === 'person' ? 'Search people…' : 'Search organisations…'}
                    value={contactQuery}
                    oninput={onContactQuery}
                    autofocus
                    class="w-full rounded-md border border-surface-border bg-surface-card px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                  />
                  {#if contactResults.length}
                    <ul class="max-h-64 overflow-y-auto rounded-md border border-surface-border bg-surface-card">
                      {#each contactResults as item (item.id)}
                        <li>
                          <button
                            type="button"
                            class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
                            onclick={() => pickContact(item)}
                          >
                            {#if contactKind === 'person'}
                              <Avatar name={personName(item as Person)} size={22} />
                              <span class="flex-1 truncate text-ink-900">{personName(item as Person)}</span>
                              {#if (item as Person).email}<span class="text-[11px] text-ink-400">{(item as Person).email}</span>{/if}
                            {:else}
                              <Avatar name={(item as Organization).name ?? '?'} src={avatarSrc((item as Organization).logo, (item as Organization).image_focal, 48)} size={22} />
                              <span class="flex-1 truncate text-ink-900">{(item as Organization).name}</span>
                            {/if}
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {:else if contactQuery.trim()}
                    <div class="text-xs text-ink-400">No match found.</div>
                  {/if}
                </div>
              {/if}
            </div>
          {:else}
            <div class="text-sm text-ink-400">No contact recorded.</div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Side column: metadata -->
    <div class="space-y-4">
      <div class="card">
        <div class="card-header"><span class="card-title"><Icon name="tag" size={16} /> Flokkun</span></div>
        <dl class="divide-y divide-surface-divider px-4 text-sm">
          <div class="flex items-center justify-between gap-3 py-2">
            <dt class="text-ink-400">Yfirflokkur</dt>
            <dd class="text-right text-ink-700">{dom?.name ?? '—'}</dd>
          </div>
          <div class="flex items-start justify-between gap-3 py-2">
            <dt class="text-ink-400 shrink-0">Undirflokkur</dt>
            <dd class="text-right text-ink-700">{sub?.name ?? '—'}</dd>
          </div>
          <div class="flex items-center justify-between gap-3 py-2">
            <dt class="text-ink-400">Landshluti</dt>
            <dd class="text-right">
              <EditableField
                value={award.region_acronym}
                type="select"
                options={REGION_CHOICES.map((r) => ({ label: `${r.label} (${r.value})`, value: r.value }))}
                placeholder="—"
                onSave={(v) => save('region_acronym', (v as string | null) ?? null)}
              />
            </dd>
          </div>
        </dl>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title"><Icon name="calendar" size={16} /> Ár</span></div>
        <dl class="divide-y divide-surface-divider px-4 text-sm">
          <div class="flex items-center justify-between gap-3 py-2">
            <dt class="text-ink-400">Úthlutunarár</dt>
            <dd class="tabular-nums text-ink-700">{award.fund_year ?? '—'}</dd>
          </div>
          <div class="flex items-center justify-between gap-3 py-2">
            <dt class="text-ink-400">Bókunarár</dt>
            <dd class="tabular-nums text-ink-700">{award.booking_year ?? '—'}</dd>
          </div>
          {#if award.duration_years}
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-ink-400">Lengd</dt>
              <dd class="tabular-nums text-ink-700">{award.duration_years} ár</dd>
            </div>
          {/if}
        </dl>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title"><Icon name="bolt" size={16} /> Staða</span></div>
        <dl class="divide-y divide-surface-divider px-4 text-sm">
          <div class="flex items-center justify-between gap-3 py-2">
            <dt class="text-ink-400">Staða</dt>
            <dd class="text-right">
              <EditableField
                value={award.award_status}
                type="select"
                options={[
                  { label: 'Awarded', value: 'awarded' },
                  { label: 'Active', value: 'active' },
                  { label: 'Completed', value: 'completed' },
                  { label: 'Cancelled', value: 'cancelled' },
                  { label: 'Rejected', value: 'rejected' }
                ]}
                onSave={(v) => save('award_status', (v as string | null) ?? null)}
              />
            </dd>
          </div>
          {#if award.stage}
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-ink-400">Áfangi</dt>
              <dd class="text-ink-700">{award.stage}</dd>
            </div>
          {/if}
          {#if award.external_source}
            <div class="flex items-center justify-between gap-3 py-2">
              <dt class="text-ink-400">Uppruni</dt>
              <dd class="text-ink-700 capitalize">{award.external_source}</dd>
            </div>
          {/if}
        </dl>
      </div>

      <div class="flex items-center justify-end gap-2">
        {#if award.status !== 'archived'}
          <button type="button" class="text-xs text-tag-salesText hover:underline" onclick={archive}>
            Archive award
          </button>
        {/if}
      </div>
    </div>
  </div>
</section>
