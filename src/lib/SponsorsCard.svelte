<script lang="ts">
  // Who backed this project, grouped by tier, with the words you actually use.
  //
  // Sponsors are not a separate collection — they are Project_organization
  // links whose role is flagged is_sponsor. That keeps one list of everyone
  // involved (cohort members, hosts, advisory board, owners, sponsors) instead
  // of two that can disagree about the same organisation.
  //
  // The credit line is the point. "Með stuðningi frá Grósku" declines the name,
  // so the Icelandic template uses {org_dative} and the declined form lives on
  // the organisation — see sponsorPhrase().
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import {
    sponsorPhrase,
    assetUrl,
    formatError,
    searchOrgs,
    addOrgToProject,
    updateProjectOrganization,
    removeProjectOrganization,
    SPONSOR_TIER_ORDER,
    SPONSOR_TIER_LABEL,
    type ProjectOrganization,
    type ProjectRole,
    type Organization,
    type SponsorTier
  } from '$lib/directus';

  let {
    links = $bindable([] as ProjectOrganization[]),
    roles = [] as ProjectRole[],
    projectId,
    /** Which language's credit line to show. Icelandic first — it is the one
     *  with the grammar problem, so it is the one worth checking. */
    lang = $bindable('is' as 'is' | 'en')
  }: {
    links?: ProjectOrganization[];
    roles?: ProjectRole[];
    projectId: number;
    lang?: 'is' | 'en';
  } = $props();

  let error = $state('');
  let editing = $state<number | null>(null);
  let busy = $state(false);

  const roleByKey = $derived(new Map(roles.map((r) => [r.key, r])));
  const sponsorRoles = $derived(roles.filter((r) => r.is_sponsor));

  function orgOf(l: ProjectOrganization): Organization | null {
    return l.organization_id && typeof l.organization_id === 'object'
      ? (l.organization_id as Organization)
      : null;
  }
  function roleOf(l: ProjectOrganization): ProjectRole | null {
    return l.role_in_project ? (roleByKey.get(l.role_in_project) ?? null) : null;
  }

  /** Only links whose role is a sponsor role. A project's cohort members and
   *  hosts stay in the Organizations card where they belong. */
  const sponsors = $derived(links.filter((l) => roleOf(l)?.is_sponsor));

  /** Grouped by tier, gold → silver → bronze → untiered, and alphabetical
   *  inside a tier: within one level there is no ranking to imply. */
  const grouped = $derived.by(() => {
    const buckets = new Map<string, ProjectOrganization[]>();
    for (const l of sponsors) {
      const key = roleOf(l)?.tier ?? '_none';
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(l);
    }
    const order = [...buckets.keys()].sort(
      (a, b) => (SPONSOR_TIER_ORDER[a] ?? 90) - (SPONSOR_TIER_ORDER[b] ?? 90)
    );
    return order.map((tier) => ({
      tier,
      // Untiered bucket is just "Other" — it holds whatever is not a
      // gold/silver/bronze level, which may be support, a venue or an
      // advisory seat, so the heading must not claim it is support.
      label: tier === '_none' ? 'Other' : SPONSOR_TIER_LABEL[tier as SponsorTier],
      rows: buckets.get(tier)!.sort((a, b) =>
        (orgOf(a)?.name ?? '').localeCompare(orgOf(b)?.name ?? '', 'is')
      )
    }));
  });

  /** One block of text to hand to a designer or paste into a deck. Built from
   *  the same resolver the rows show, so what you copy is what you saw. */
  const creditBlock = $derived.by(() =>
    grouped
      .map((g) => {
        const lines = g.rows
          .map((l) => sponsorPhrase(l, roleOf(l), lang) ?? orgOf(l)?.name ?? '')
          .filter(Boolean);
        return lines.length ? `${g.label}\n${lines.map((s) => `  ${s}`).join('\n')}` : '';
      })
      .filter(Boolean)
      .join('\n\n')
  );

  let copied = $state(false);
  async function copyCredits() {
    try {
      await navigator.clipboard.writeText(creditBlock);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch (e) {
      error = formatError(e);
    }
  }

  async function save(l: ProjectOrganization, patch: Partial<ProjectOrganization>) {
    busy = true;
    error = '';
    try {
      await updateProjectOrganization(l.id, patch);
      links = links.map((x) => (x.id === l.id ? { ...x, ...patch } : x));
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = false;
    }
  }

  async function remove(l: ProjectOrganization) {
    const name = orgOf(l)?.name ?? 'this organisation';
    if (!confirm(`Remove ${name} as a sponsor of this project?`)) return;
    busy = true;
    try {
      await removeProjectOrganization(l.id);
      links = links.filter((x) => x.id !== l.id);
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = false;
    }
  }

  /**
   * Change which sponsor role a link has — the way you move Huawei from gold
   * to silver, or move a credit out of Other into a named level.
   *
   * Only sponsor roles are offered. Demoting a link to a non-sponsor role from
   * here would make it vanish from this card with no explanation; the
   * Organisations card owns the full role list for that.
   */
  async function setRole(l: ProjectOrganization, key: string) {
    if (!key || key === l.role_in_project) return;
    await save(l, { role_in_project: key });
  }

  // ── Adding a sponsor ──────────────────────────────────────────────────
  // Inline rather than handing off to the Organisations card: picking "add an
  // org" and then remembering to set a sponsor role is two steps and one thing
  // to forget. Here the role is part of adding.
  let adding = $state(false);
  let q = $state('');
  let results = $state<Organization[]>([]);
  let picked = $state<Organization | null>(null);
  let newRole = $state('');
  let searching = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  function openAdd() {
    adding = true;
    q = '';
    results = [];
    picked = null;
    // Default to the first sponsor role so the common case is one less choice.
    newRole = sponsorRoles[0]?.key ?? '';
  }

  function onQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    q = v;
    picked = null;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const term = v.trim();
      if (!term) { results = []; return; }
      searching = true;
      try {
        results = (await searchOrgs(term, 8)) as Organization[];
      } catch (e) {
        error = formatError(e);
      } finally {
        searching = false;
      }
    }, 180);
  }

  /** Already a sponsor here? Adding the same org twice would credit it twice. */
  function alreadyLinked(orgId: number): boolean {
    return links.some((l) => {
      const o = orgOf(l);
      return o?.id === orgId;
    });
  }

  async function submitAdd() {
    if (!picked || !newRole || busy) return;
    busy = true;
    error = '';
    try {
      const created = await addOrgToProject({
        project_id: projectId,
        organization_id: picked.id,
        role_in_project: newRole
      });
      // Keep the expanded org on the row: addOrgToProject returns relations as
      // bare ids, and the card needs the name, logo and dative to render a
      // credit line at all.
      links = [...links, { ...(created as ProjectOrganization), organization_id: picked }];
      adding = false;
      q = '';
      picked = null;
      results = [];
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="card p-4">
  <header class="mb-2 flex flex-wrap items-center gap-2">
    <span class="text-sm font-medium text-ink-900">Sponsors</span>
    {#if sponsors.length > 0}<span class="sp-n">{sponsors.length}</span>{/if}

    <!-- Language toggle sits here rather than in settings: the whole reason
         this card exists is the wording, and the wording differs per language. -->
    <div class="sp-lang" role="group" aria-label="Credit language">
      <button type="button" class:on={lang === 'is'} onclick={() => (lang = 'is')}>ÍS</button>
      <button type="button" class:on={lang === 'en'} onclick={() => (lang = 'en')}>EN</button>
    </div>

    {#if sponsors.length > 0}
      <button class="btn-ghost sp-copy text-xs" onclick={copyCredits}>
        <Icon name="check" size={12} />
        {copied ? 'Copied' : 'Copy credits'}
      </button>
    {/if}
    <button class="btn-ghost ml-auto text-xs" onclick={openAdd} disabled={sponsorRoles.length === 0}>
      <Icon name="plus" size={12} /> Add sponsor
    </button>
  </header>

  {#if error}<p class="sp-err">{error}</p>{/if}

  {#if adding}
    <div class="sp-add">
      <label class="sp-add-search">
        <Icon name="search" size={13} />
        <input
          type="text"
          placeholder="Search organisations…"
          value={q}
          oninput={onQuery}
          aria-label="Search organisations to add as a sponsor"
        />
      </label>

      {#if picked}
        <div class="sp-add-picked">
          <Avatar name={picked.name ?? `#${picked.id}`} src={assetUrl(picked.logo, { width: 40, height: 40, fit: 'contain' })} size={22} />
          <span class="sp-add-name">{picked.name}</span>
          <button class="sp-add-clear" onclick={() => { picked = null; q = ''; }} aria-label="Choose a different organisation">
            <Icon name="x" size={11} />
          </button>
        </div>
      {:else if q.trim() && results.length > 0}
        <ul class="sp-add-results">
          {#each results as o (o.id)}
            <li>
              <button
                type="button"
                onclick={() => { picked = o; results = []; }}
                disabled={alreadyLinked(o.id)}
                title={alreadyLinked(o.id) ? 'Already on this project' : ''}
              >
                <Avatar name={o.name ?? `#${o.id}`} src={assetUrl(o.logo, { width: 40, height: 40, fit: 'contain' })} size={20} />
                <span>{o.name}</span>
                {#if alreadyLinked(o.id)}<span class="sp-add-dupe">already added</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {:else if q.trim() && !searching}
        <p class="sp-hint">Nothing matched “{q.trim()}”. Organisations are created under Orgs.</p>
      {/if}

      <div class="sp-add-foot">
        <label class="sp-add-role">
          <span>Level</span>
          <select bind:value={newRole}>
            {#each sponsorRoles as r (r.key)}
              <option value={r.key}>{r.label}</option>
            {/each}
          </select>
        </label>
        <button class="btn-primary" onclick={submitAdd} disabled={!picked || !newRole || busy}>
          <Icon name="check" size={13} /> {busy ? 'Adding…' : 'Add'}
        </button>
        <button class="btn-ghost text-xs" onclick={() => (adding = false)} disabled={busy}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if sponsors.length === 0}
    <p class="text-xs text-ink-400">
      No sponsors yet. Add an organisation to this project and give it a sponsor
      role — {#if sponsorRoles.length > 0}{sponsorRoles.map((r) => r.label).join(', ')}{:else}none are set up yet; run
      <code>scripts/add-sponsor-roles.sh</code>{/if}.
    </p>
  {:else}
    {#each grouped as group (group.tier)}
      <section class="sp-group">
        <div class="sp-group-head">
          <span class="sp-tier sp-tier-{group.tier}">{group.label}</span>
          <span class="sp-group-n">{group.rows.length}</span>
        </div>

        <ul>
          {#each group.rows as l (l.id)}
            {@const org = orgOf(l)}
            {@const role = roleOf(l)}
            {@const phrase = sponsorPhrase(l, role, lang)}
            {#if org}
              <li class="sp-row">
                <a href={`/orgs/${org.id}`} class="sp-org">
                  <Avatar
                    name={org.name ?? `#${org.id}`}
                    src={assetUrl(org.logo, { width: 48, height: 48, fit: 'contain' })}
                    size={26}
                  />
                  <span class="sp-org-name">{org.name}</span>
                </a>

                <div class="sp-mid">
                  {#if phrase}
                    <span class="sp-phrase">{phrase}</span>
                  {:else}
                    <!-- A role with no template is not a defect; it just has no
                         house wording. Say which role, so it is obvious where
                         to add one. -->
                    <span class="sp-nophrase" title="This role has no {lang === 'is' ? 'Icelandic' : 'English'} wording set">
                      {role?.label ?? l.role_in_project} — no wording set
                    </span>
                  {/if}
                  {#if lang === 'is' && role?.phrase_is?.includes('{org_dative}') && !org.name_dative_is}
                    <!-- The template needs a declined form and this org has
                         none, so the sentence currently reads with the plain
                         name — grammatically wrong Icelandic. Flag it where it
                         can be fixed instead of shipping it silently. -->
                    <a class="sp-warn" href={`/orgs/${org.id}`} title="Add the Icelandic dative on {org.name} so this reads correctly">
                      needs dative
                    </a>
                  {/if}
                </div>

                <!-- Change the level in place.
                     The visible text is a span and the <select> is invisible on
                     top of it. app.css forces every select to 16px !important
                     under 768px so iOS will not zoom on focus — a guard worth
                     keeping — which made a 10px pill impossible: it rendered at
                     16px and clipped "Bronze sponsor" at 120px. Same technique
                     as the role chip in ProjectPeopleCard, for the same reason. -->
                <span class="sp-rolepick" class:sp-busy={busy}>
                  <span class="sp-role-label">{role?.label ?? l.role_in_project}</span>
                  <svg class="sp-caret" viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                  <select
                    class="sp-roleselect"
                    value={l.role_in_project ?? ''}
                    disabled={busy}
                    aria-label="Sponsor level for {org.name}"
                    onchange={(e) => setRole(l, (e.currentTarget as HTMLSelectElement).value)}
                  >
                    {#each sponsorRoles as r (r.key)}
                      <option value={r.key}>{r.label}</option>
                    {/each}
                    {#if l.role_in_project && !sponsorRoles.some((r) => r.key === l.role_in_project)}
                      <!-- Keeps an archived or renamed role visible instead of
                           silently showing the first option as if it were set. -->
                      <option value={l.role_in_project}>{l.role_in_project} (archived)</option>
                    {/if}
                  </select>
                </span>

                <button
                  class="sp-edit"
                  title="Override the wording for this project"
                  aria-label="Override wording for {org.name}"
                  onclick={() => (editing = editing === l.id ? null : l.id)}
                >
                  <Icon name="pencil" size={12} />
                </button>
                <button class="sp-x" title="Remove" aria-label="Remove {org.name}" onclick={() => remove(l)} disabled={busy}>
                  <Icon name="x" size={12} />
                </button>
              </li>

              {#if editing === l.id}
                <li class="sp-editrow">
                  <label>
                    <span>Icelandic wording for this project</span>
                    <input
                      type="text"
                      value={l.phrase_is ?? ''}
                      placeholder={role?.phrase_is ? sponsorPhrase({ ...l, phrase_is: null }, role, 'is') ?? '' : 'Full sentence'}
                      onchange={(e) => {
                        const v = (e.currentTarget as HTMLInputElement).value.trim() || null;
                        if (v !== (l.phrase_is ?? null)) save(l, { phrase_is: v });
                      }}
                    />
                  </label>
                  <label>
                    <span>English wording for this project</span>
                    <input
                      type="text"
                      value={l.phrase_en ?? ''}
                      placeholder={role?.phrase_en ? sponsorPhrase({ ...l, phrase_en: null }, role, 'en') ?? '' : 'Full sentence'}
                      onchange={(e) => {
                        const v = (e.currentTarget as HTMLInputElement).value.trim() || null;
                        if (v !== (l.phrase_en ?? null)) save(l, { phrase_en: v });
                      }}
                    />
                  </label>
                  <p class="sp-hint">
                    Leave empty to use the role’s template. The placeholder shows
                    what the template produces.
                  </p>
                </li>
              {/if}
            {/if}
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

<style>
  .sp-n {
    border-radius: 999px; padding: 0 0.4rem; font-size: 10px;
    background: var(--bg-tertiary); color: var(--text-secondary);
  }
  .sp-lang { display: inline-flex; gap: 1px; border-radius: 999px; overflow: hidden; background: var(--bg-tertiary); }
  .sp-lang button {
    font-size: 9.5px; font-weight: 600; letter-spacing: 0.04em;
    padding: 0.12rem 0.4rem; color: var(--text-secondary);
    background: none; border: 0; cursor: pointer;
  }
  .sp-lang button.on { background: var(--brand, #2f7d7d); color: #fff; }
  .sp-copy { white-space: nowrap; }
  .sp-err { font-size: 11px; color: #B3332F; margin-bottom: 0.4rem; }

  .sp-group { margin-top: 0.6rem; }
  .sp-group-head { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem; }
  .sp-tier {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
    border-radius: 999px; padding: 0.1rem 0.45rem;
    background: var(--bg-tertiary); color: var(--text-secondary);
  }
  /* Metal tints, kept muted — a gold pill loud enough to read as a warning
     would fight the rest of the page. */
  .sp-tier-gold { background: rgba(200,162,39,0.18); color: #8A6D10; }
  .sp-tier-silver { background: rgba(154,163,173,0.22); color: #5C6672; }
  .sp-tier-bronze { background: rgba(169,114,46,0.18); color: #7D5019; }
  .sp-group-n { font-size: 10px; color: var(--text-secondary); }

  .sp-row {
    display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
    padding: 0.35rem 0; border-top: 1px solid var(--border-subtle);
  }
  .sp-org { display: inline-flex; align-items: center; gap: 0.4rem; min-width: 0; }
  .sp-org-name { font-size: 12.5px; font-weight: 500; color: var(--text-primary); }
  .sp-org:hover .sp-org-name { color: var(--brand, #2f7d7d); }
  .sp-mid { display: flex; align-items: center; gap: 0.35rem; flex: 1; min-width: 0; flex-wrap: wrap; }
  .sp-phrase { font-size: 11.5px; color: var(--text-secondary); font-style: italic; }
  .sp-nophrase { font-size: 11px; color: var(--text-secondary); opacity: 0.7; }
  .sp-warn {
    font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    border-radius: 999px; padding: 0.05rem 0.35rem;
    background: rgba(198,118,42,0.18); color: #8C5215;
  }
  .sp-edit, .sp-x {
    display: inline-flex; padding: 0.15rem; border-radius: 6px;
    color: var(--text-secondary); background: none; border: 0; cursor: pointer;
  }
  .sp-edit:hover { color: var(--brand, #2f7d7d); background: var(--bg-tertiary); }
  .sp-x:hover { color: #B3332F; background: var(--bg-tertiary); }

  .sp-editrow { padding: 0.4rem 0 0.6rem; display: grid; gap: 0.4rem; }
  .sp-editrow label { display: flex; flex-direction: column; gap: 0.15rem; }
  .sp-editrow span {
    font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--text-secondary);
  }
  .sp-editrow input {
    font-size: 12px; padding: 0.3rem 0.45rem; border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-tertiary); color: var(--text-primary);
  }
  .sp-hint { font-size: 10px; color: var(--text-secondary); }

  /* Visually hidden label — the select needs a name for screen readers without
     putting a redundant word on every row. */
  .sp-sr {
    position: absolute; width: 1px; height: 1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
  }
  /* Quiet by default — the credit line is what you read, this is what you
     occasionally change. */
  .sp-rolepick {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    flex-shrink: 0;
    border-radius: 999px;
    padding: 0.08rem 0.4rem;
    font-size: 10px;
    line-height: 1.6;
    color: var(--text-secondary);
    background: transparent;
    border: 1px dashed var(--border-subtle);
    cursor: pointer;
  }
  .sp-rolepick:hover { border-style: solid; color: var(--text-primary); }
  .sp-rolepick:focus-within {
    border-style: solid;
    border-color: var(--brand, #2f7d7d);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand, #2f7d7d) 20%, transparent);
  }
  .sp-busy { opacity: 0.5; }
  .sp-role-label { white-space: nowrap; }
  .sp-caret { flex-shrink: 0; opacity: 0.55; pointer-events: none; }
  /* Invisible, not display:none — it must stay focusable and hit-testable. */
  .sp-roleselect {
    position: absolute; inset: 0; width: 100%; height: 100%;
    opacity: 0; appearance: none; -webkit-appearance: none;
    border: 0; margin: 0; padding: 0; background: none; cursor: pointer;
  }
  .sp-roleselect:focus, .sp-roleselect:focus-visible { outline: none; }

  .sp-add {
    display: flex; flex-direction: column; gap: 0.45rem;
    border-radius: 10px; padding: 0.6rem;
    margin-bottom: 0.5rem;
    background: var(--bg-tertiary);
  }
  .sp-add-search {
    display: flex; align-items: center; gap: 0.35rem;
    border-radius: 999px; padding: 0.25rem 0.6rem;
    background: var(--bg-primary); color: var(--text-secondary);
  }
  .sp-add-search input {
    flex: 1; min-width: 0; font-size: 12.5px;
    background: none; border: 0; outline: none; color: var(--text-primary);
  }
  .sp-add-results { display: flex; flex-direction: column; max-height: 13rem; overflow-y: auto; }
  .sp-add-results button {
    display: flex; align-items: center; gap: 0.4rem; width: 100%;
    padding: 0.3rem 0.35rem; border-radius: 8px; font-size: 12.5px;
    text-align: left; background: none; border: 0; cursor: pointer;
    color: var(--text-primary);
  }
  .sp-add-results button:hover:not(:disabled) { background: var(--bg-primary); }
  .sp-add-results button:disabled { opacity: 0.5; cursor: default; }
  .sp-add-dupe { margin-left: auto; font-size: 9.5px; color: var(--text-secondary); }
  .sp-add-picked {
    display: flex; align-items: center; gap: 0.4rem;
    border-radius: 8px; padding: 0.25rem 0.4rem; background: var(--bg-primary);
  }
  .sp-add-name { font-size: 12.5px; font-weight: 500; color: var(--text-primary); }
  .sp-add-clear {
    margin-left: auto; display: inline-flex; padding: 0.1rem; border-radius: 6px;
    color: var(--text-secondary); background: none; border: 0; cursor: pointer;
  }
  .sp-add-clear:hover { color: #B3332F; }
  .sp-add-foot { display: flex; align-items: flex-end; gap: 0.4rem; }
  .sp-add-role { display: flex; flex-direction: column; gap: 0.15rem; }
  .sp-add-role span {
    font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--text-secondary);
  }
  .sp-add-role select {
    font-size: 12px; padding: 0.28rem 0.4rem; border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-primary); color: var(--text-primary);
  }
</style>
