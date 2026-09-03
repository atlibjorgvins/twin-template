<script lang="ts">
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import EditableField from '$lib/EditableField.svelte';
  import {
    updateActivity,
    deleteActivity,
    activityKindOf,
    personName,
    assetUrl,
    formatError,
    searchPeople,
    searchOrgs,
    attachPersonToActivity,
    detachPersonFromActivity,
    attachOrgToActivity,
    detachOrgFromActivity,
    type Activity,
    type ActivityPerson,
    type ActivityOrg,
    type Organization,
    type Project,
    type Person
  } from '$lib/directus';
  import type { IconName } from '$lib/icon-types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let activity = $state<Activity>(data.activity);
  let people = $state<ActivityPerson[]>(data.people);
  let orgs = $state<ActivityOrg[]>(data.orgs);
  $effect(() => {
    activity = data.activity;
    people = data.people;
    orgs = data.orgs;
  });

  // ── Attach / detach people (Activity_Person junction) ──────────────────
  let personQ = $state('');
  let personResults = $state<Person[]>([]);
  let personTimer: ReturnType<typeof setTimeout> | null = null;
  let linkBusy = $state(false);
  function onPersonQuery(v: string) {
    personQ = v;
    if (personTimer) clearTimeout(personTimer);
    personTimer = setTimeout(async () => {
      if (!v.trim()) { personResults = []; return; }
      try { personResults = (await searchPeople(v, 6)) as Person[]; } catch { personResults = []; }
    }, 150);
  }
  async function addPerson(p: Person) {
    if (people.some((ap) => personOf(ap)?.id === p.id)) { personQ = ''; personResults = []; return; }
    linkBusy = true;
    try {
      const j = await attachPersonToActivity(activity.id, p.id);
      people = [...people, { ...j, person_id: p } as ActivityPerson];
      personQ = ''; personResults = [];
    } catch (e) { alert(formatError(e)); } finally { linkBusy = false; }
  }
  async function removePerson(ap: ActivityPerson) {
    try { await detachPersonFromActivity(ap.id); people = people.filter((x) => x.id !== ap.id); }
    catch (e) { alert(formatError(e)); }
  }

  // ── Attach / detach organizations (Activity_organization junction) ─────
  let orgQ = $state('');
  let orgResults = $state<Organization[]>([]);
  let orgTimer: ReturnType<typeof setTimeout> | null = null;
  function orgOf(ao: ActivityOrg): Organization | null {
    return ao.organization_id && typeof ao.organization_id === 'object' ? (ao.organization_id as Organization) : null;
  }
  function onOrgQuery(v: string) {
    orgQ = v;
    if (orgTimer) clearTimeout(orgTimer);
    orgTimer = setTimeout(async () => {
      if (!v.trim()) { orgResults = []; return; }
      try { orgResults = (await searchOrgs(v, 6)) as Organization[]; } catch { orgResults = []; }
    }, 150);
  }
  async function addOrg(o: Organization) {
    if (orgs.some((ao) => orgOf(ao)?.id === o.id)) { orgQ = ''; orgResults = []; return; }
    linkBusy = true;
    try {
      const j = await attachOrgToActivity(activity.id, o.id);
      orgs = [...orgs, { ...j, organization_id: o } as ActivityOrg];
      orgQ = ''; orgResults = [];
    } catch (e) { alert(formatError(e)); } finally { linkBusy = false; }
  }
  async function removeOrg(ao: ActivityOrg) {
    try { await detachOrgFromActivity(ao.id); orgs = orgs.filter((x) => x.id !== ao.id); }
    catch (e) { alert(formatError(e)); }
  }
  // Unified list: the legacy single org (organization_id, ao=null, not
  // removable here) followed by junction-linked orgs (removable).
  const displayOrgs = $derived.by<Array<{ org: Organization; ao: ActivityOrg | null }>>(() => {
    const rows: Array<{ org: Organization; ao: ActivityOrg | null }> = [];
    const seen = new Set<number>();
    if (org) { rows.push({ org, ao: null }); seen.add(org.id); }
    for (const ao of orgs) {
      const o = orgOf(ao);
      if (o && !seen.has(o.id)) { rows.push({ org: o, ao }); seen.add(o.id); }
    }
    return rows;
  });

  const kind = $derived(activityKindOf(activity));
  const org = $derived(
    activity.organization_id && typeof activity.organization_id === 'object'
      ? (activity.organization_id as Organization)
      : null
  );
  const project = $derived(
    activity.project_id && typeof activity.project_id === 'object'
      ? (activity.project_id as Project)
      : null
  );

  async function save(field: keyof Activity, value: string | null) {
    try {
      const patched = await updateActivity(activity.id, { [field]: value } as Partial<Activity>);
      // Optimistic merge — keep expanded relations (kind/org/project) intact.
      activity = {
        ...activity,
        ...patched,
        kind_id: activity.kind_id,
        organization_id: activity.organization_id,
        project_id: activity.project_id
      };
    } catch (e) {
      // EditableField handles its own visible error if save throws;
      // we just need to re-raise so it rolls back the optimistic state.
      throw new Error(formatError(e));
    }
  }

  // ── Significance cycling ───────────────────────────────────────────────
  const SIG_ORDER: ('minor' | 'normal' | 'major')[] = ['minor', 'normal', 'major'];
  async function bumpSignificance() {
    const cur = (activity.significance ?? 'normal') as 'minor' | 'normal' | 'major';
    const next = SIG_ORDER[(SIG_ORDER.indexOf(cur) + 1) % SIG_ORDER.length];
    await save('significance', next);
  }

  let deleting = $state(false);
  async function remove() {
    if (deleting) return;
    if (!confirm(`Delete "${activity.title}"?`)) return;
    deleting = true;
    try {
      await deleteActivity(activity.id);
      goto('/interactions');
    } catch (e) {
      alert(formatError(e));
    } finally {
      deleting = false;
    }
  }

  // ── Format helpers ─────────────────────────────────────────────────────
  function fmtWhen(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
  }
  function fmtDate(iso?: string | null): string {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
    } catch { return iso; }
  }
  function personOf(ap: ActivityPerson): Person | null {
    return ap.person_id && typeof ap.person_id === 'object' ? (ap.person_id as Person) : null;
  }

  const isMajor = $derived(activity.significance === 'major');
</script>

<svelte:head>
  <title>{activity.title || 'Interaction'} · Hub</title>
</svelte:head>

<section class="space-y-5">
  <!-- Hero card. Kind chip + editable title + significance + when. -->
  <div class="card p-4 sm:p-6">
    <div class="flex items-start gap-3 sm:gap-4">
      <!-- Kind badge -->
      <span
        class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12"
        style={kind?.color ? `background: ${kind.color}22; color: ${kind.color};` : 'background: var(--bg-tertiary); color: var(--text-secondary);'}
        title={kind?.label ?? (activity.kind as string | null | undefined) ?? 'Activity'}
      >
        <Icon name={(kind?.icon as IconName | undefined) ?? 'bolt'} size={20} />
      </span>
      <div class="min-w-0 flex-1">
        <div class="hero-eyebrow">
          {kind?.label ?? activity.kind ?? 'Activity'}
          {#if activity.scope}· {activity.scope}{/if}
        </div>
        <h1 class="font-display mt-1 text-2xl font-bold tracking-tight sm:text-3xl" style="letter-spacing: -0.02em;">
          <EditableField
            value={activity.title ?? null}
            placeholder="Title"
            onSave={(v) => save('title', v)}
          />
        </h1>
        <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
          <span>{fmtWhen(activity.occurred_at)}</span>
          {#if activity.location}
            <span class="text-ink-300">·</span>
            <span>📍 {activity.location}</span>
          {/if}
          <button
            class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
            style={isMajor
              ? 'background: var(--accent-alpha-10); color: var(--accent-electric); border-color: var(--accent-alpha-30);'
              : 'background: var(--bg-tertiary); color: var(--text-secondary); border-color: var(--border-subtle);'}
            onclick={bumpSignificance}
            title="Cycle significance"
          >
            <Icon name="bolt" size={12} />
            {activity.significance ?? 'normal'}
          </button>
        </div>
      </div>
      <div class="flex flex-col gap-1.5 shrink-0">
        <button
          class="btn-ghost text-tag-salesText"
          onclick={remove}
          disabled={deleting}
          title="Delete this interaction"
        >
          <Icon name="x" size={16} /> {deleting ? '…' : 'Delete'}
        </button>
      </div>
    </div>
  </div>

  <!-- Body: people / org / project / summary / location -->
  <div class="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
    <div class="min-w-0 space-y-5">
      <!-- Summary. Multi-line, blur-to-save. EditableField doesn't yet
           support textarea so this is a plain bound <textarea>. -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="notebook" size={16} /> Notes</span>
        </div>
        <div class="px-4 pb-4 text-sm">
          <textarea
            class="input w-full resize-y"
            rows="4"
            placeholder="Add a quick summary, what was said, follow-ups…"
            value={activity.summary ?? ''}
            onblur={(e) => {
              const v = (e.currentTarget as HTMLTextAreaElement).value.trim();
              if (v !== (activity.summary ?? '')) void save('summary', v || null);
            }}
          ></textarea>
        </div>
      </div>

      <!-- Location row (editable). Some kinds skip it; keep it here so
           users can fill it in retroactively. -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="globe" size={16} /> Where</span>
        </div>
        <dl class="divide-y divide-surface-divider px-4 pb-3 text-sm">
          <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
            <dt class="text-ink-400">Location</dt>
            <dd class="min-w-0 flex-1">
              <EditableField
                value={activity.location ?? null}
                placeholder="Add a location"
                onSave={(v) => save('location', v)}
              />
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <div class="min-w-0 space-y-5">
      <!-- People (multiple, via Activity_Person) -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="users" size={16} /> People</span>
          {#if people.length}<span class="text-xs text-ink-400">{people.length}</span>{/if}
        </div>
        {#if people.length > 0}
          <ul class="divide-y divide-surface-divider">
            {#each people as ap (ap.id)}
              {@const p = personOf(ap)}
              {#if p}
                <li class="flex items-center gap-1 pr-2">
                  <a
                    href={`/people/${p.id}`}
                    class="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 hover:bg-surface-hover"
                  >
                    <Avatar
                      name={personName(p)}
                      src={assetUrl(p.person_picture, { width: 64, height: 64, fit: 'cover' }) ?? ''}
                      size={32}
                    />
                    <div class="min-w-0 flex-1">
                      <div class="truncate font-medium text-ink-900">{personName(p)}</div>
                      {#if ap.role}<div class="text-xs text-ink-400">{ap.role}</div>{/if}
                    </div>
                  </a>
                  <button class="nav-icon shrink-0" title="Remove" aria-label={`Remove ${personName(p)}`} onclick={() => removePerson(ap)}>
                    <Icon name="x" size={14} />
                  </button>
                </li>
              {/if}
            {/each}
          </ul>
        {/if}
        <div class="relative px-4 py-3">
          <input
            class="input"
            placeholder="Add a person…"
            value={personQ}
            oninput={(e) => onPersonQuery((e.currentTarget as HTMLInputElement).value)}
            disabled={linkBusy}
          />
          {#if personResults.length > 0}
            <ul class="absolute left-4 right-4 z-20 mt-1 max-h-56 overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
              {#each personResults as r (r.id)}
                <li>
                  <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => addPerson(r)}>
                    <Avatar name={personName(r)} src={assetUrl(r.person_picture, { width: 48, height: 48, fit: 'cover' }) ?? ''} size={22} />
                    <span class="truncate">{personName(r)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>

      <!-- Organizations (multiple, via Activity_organization) -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="building" size={16} /> Organizations</span>
          {#if displayOrgs.length}<span class="text-xs text-ink-400">{displayOrgs.length}</span>{/if}
        </div>
        {#if displayOrgs.length > 0}
          <ul class="divide-y divide-surface-divider">
            {#each displayOrgs as row (row.org.id)}
              <li class="flex items-center gap-1 pr-2">
                <a href={`/orgs/${row.org.id}`} class="min-w-0 flex-1 px-4 py-2.5 hover:bg-surface-hover">
                  <span class="truncate font-medium text-ink-900">{row.org.name}</span>
                </a>
                {#if row.ao}
                  <button class="nav-icon shrink-0" title="Remove" aria-label={`Remove ${row.org.name}`} onclick={() => removeOrg(row.ao!)}>
                    <Icon name="x" size={14} />
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        <div class="relative px-4 py-3">
          <input
            class="input"
            placeholder="Add an organization…"
            value={orgQ}
            oninput={(e) => onOrgQuery((e.currentTarget as HTMLInputElement).value)}
            disabled={linkBusy}
          />
          {#if orgResults.length > 0}
            <ul class="absolute left-4 right-4 z-20 mt-1 max-h-56 overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
              {#each orgResults as r (r.id)}
                <li>
                  <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => addOrg(r)}>
                    <Icon name="building" size={14} /><span class="truncate">{r.name}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>

      <!-- Project (read-only, if linked) -->
      {#if project}
        <div class="card">
          <div class="card-header">
            <span class="card-title"><Icon name="bolt" size={16} /> Project</span>
          </div>
          <div class="px-4 pb-4 text-sm">
            <a class="text-brand hover:underline" href={`/projects/${project.id}`}>{project.name}</a>
          </div>
        </div>
      {/if}

      <!-- Meta -->
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div class="rounded-[10px] border border-surface-divider p-3">
          <div class="text-ink-400 text-xs">Created</div>
          <div class="mt-1 font-medium">{fmtDate(activity.date_created)}</div>
        </div>
        <div class="rounded-[10px] border border-surface-divider p-3">
          <div class="text-ink-400 text-xs">Last updated</div>
          <div class="mt-1 font-medium">{fmtDate(activity.date_updated)}</div>
        </div>
      </div>
    </div>
  </div>
</section>
