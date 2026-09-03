<script lang="ts">
  // Clockify: connect, map projects, and see what is still owed.
  //
  // The unpushed count is the important thing on this page. twin owns the
  // clock and pushes finished stretches, so the one real failure mode is
  // Clockify quietly missing hours. A number you can look at — and a button
  // that retries — is what turns that from silent into ordinary.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import { repo } from '$lib/data/repo';
  import {
    clockifyConfigured,
    clockifyMe,
    clockifyProjects,
    type ClockifyProject
  } from '$lib/clockify';
  import { unpushedSessions, pushAllPending, type FocusSession } from '$lib/focusSession';
  import { targetOf } from '$lib/clockifySessions';
  import {
    indexById,
    nearestMapped,
    inheritorsOf,
    coveredCount,
    redundantMappings,
    fallbackMapping,
    resolveForPush
  } from '$lib/clockifyTree';

  type TwinProject = {
    id: number;
    name: string | null;
    parent_id: number | null;
    clockify_project_id: string | null;
    clockify_fallback: boolean | null;
  };

  let connected = $state(false);
  let who = $state<string | null>(null);
  let workspaceId = $state<string | null>(null);
  let cProjects = $state<ClockifyProject[]>([]);
  let tProjects = $state<TwinProject[]>([]);
  let pending = $state<FocusSession[]>([]);
  // Loaded only to count what would fail without a catch-all — most tasks
  // carry no project, and Clockify refuses an entry without one.
  let tasks = $state<Array<{ id: number; project_id: number | null }>>([]);
  let loading = $state(true);
  let busy = $state(false);
  let note = $state('');
  let error = $state('');
  let q = $state('');

  const mapped = $derived(tProjects.filter((p) => p.clockify_project_id).length);
  const byId = $derived(indexById(tProjects));
  // Two mappings can cover five projects. Reporting only what was clicked
  // understates the coverage badly and invites re-mapping what is already done.
  const covered = $derived(coveredCount(tProjects));
  const cName = $derived(new Map(cProjects.map((c) => [c.id, c.name])));

  /** What this project resolves to, and whether it got there by inheritance. */
  const effective = (p: TwinProject) => nearestMapped(p.id, byId);
  const inheritCount = (p: TwinProject) =>
    p.clockify_project_id ? inheritorsOf(p.id, tProjects).length : 0;

  const redundant = $derived(redundantMappings(tProjects));
  const fallback = $derived(fallbackMapping(tProjects));
  const fallbackProject = $derived(tProjects.find((p) => p.clockify_fallback) ?? null);
  /** Sessions that would be refused outright without a catch-all. */
  const strays = $derived(
    tasks.filter((t) => !nearestMapped(t.project_id ?? null, byId)).length
  );

  /** Exactly one project may be the catch-all, so setting a new one clears the old. */
  async function setFallback(id: number | null) {
    const prev = tProjects.filter((p) => p.clockify_fallback && p.id !== id);
    try {
      for (const p of prev) {
        await repo.update('Project', p.id, { clockify_fallback: false });
        p.clockify_fallback = false;
      }
      if (id != null) {
        await repo.update('Project', id, { clockify_fallback: true });
        const row = tProjects.find((p) => p.id === id);
        if (row) row.clockify_fallback = true;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  /** Drop the child mappings that only repeat what the parent already says.
   *  Coverage is unchanged by construction — see clockifyTree.test.ts. */
  async function clearRedundant() {
    if (redundant.length === 0) return;
    busy = true;
    note = '';
    const ids = redundant.map((p) => p.id);
    try {
      for (const id of ids) {
        await repo.update('Project', id, { clockify_project_id: null });
        const row = tProjects.find((p) => p.id === id);
        if (row) row.clockify_project_id = null;
      }
      note = `Cleared ${ids.length} redundant mapping${ids.length === 1 ? '' : 's'}. Coverage unchanged.`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const shown = $derived(
    q.trim()
      ? tProjects.filter((p) => (p.name ?? '').toLowerCase().includes(q.trim().toLowerCase()))
      : tProjects.filter((p) => p.clockify_project_id)
  );

  onMount(() => void load());

  async function load() {
    loading = true;
    error = '';
    try {
      tProjects = await repo.list<TwinProject>('Project', {
        fields: ['id', 'name', 'parent_id', 'clockify_project_id', 'clockify_fallback'],
        sort: ['name']
      });
      tasks = await repo.list<{ id: number; project_id: number | null }>('focus_task', {
        fields: ['id', 'project_id']
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    // The backlog is worth showing even when the Flow is missing — those
    // sessions are exactly what will be sent once it exists.
    pending = await unpushedSessions().catch(() => []);

    connected = clockifyConfigured();
    if (connected) {
      try {
        const me = await clockifyMe();
        who = `${me.name} <${me.email}>`;
        workspaceId = me.activeWorkspace;
        cProjects = await clockifyProjects(me.activeWorkspace);
      } catch (e) {
        connected = false;
        error = e instanceof Error ? e.message : String(e);
      }
    }
    loading = false;
  }

  async function setMapping(p: TwinProject, clockifyId: string) {
    const value = clockifyId || null;
    p.clockify_project_id = value;
    try {
      await repo.update('Project', p.id, { clockify_project_id: value });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function retryAll() {
    if (!workspaceId) return;
    busy = true;
    note = '';
    try {
      const r = await pushAllPending({
        workspaceId,
        // One resolver, shared with Tools → Time, so the list and the push can
        // never disagree about where a stretch is going.
        projectIdFor: async (s) => targetOf(s, tProjects)?.clockifyId ?? null
      });
      note = `Pushed ${r.pushed}, failed ${r.failed}, skipped ${r.skipped}.`;
      pending = await unpushedSessions().catch(() => []);
    } finally {
      busy = false;
    }
  }

  const hhmm = (s: number) => `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
</script>

<svelte:head><title>Clockify · Settings</title></svelte:head>

<section class="space-y-4">
  <header class="flex items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-semibold text-ink-900">Clockify</h1>
      <p class="text-sm text-ink-500">
        twin keeps the clock; finished stretches are pushed to Clockify as time entries.
      </p>
    </div>
    <a href="/settings" class="btn-ghost shrink-0"><Icon name="chevron-left" size={14} /> Settings</a>
  </header>

  {#if error}<p class="card p-3 text-sm text-tag-salesText">{error}</p>{/if}

  {#if !connected}
    <div class="card p-4 text-sm text-ink-600">
      <p class="font-medium text-ink-900">Not reaching Clockify.</p>
      <p class="mt-1">
        Calls go through the <strong>“Clockify API proxy”</strong> Flow in Directus, which holds the
        API key. The key must never reach the browser: twin is a static app, so anything in the
        bundle is public, and Clockify is on the open internet.
      </p>
      <ol class="mt-2 list-decimal space-y-1 pl-5 text-xs">
        <li>Directus → Settings → Flows → <strong>Clockify API proxy</strong> — check it is active.</li>
        <li>
          Open each request step and confirm the <code>X-Api-Key</code> header holds a current key
          (Clockify → Profile settings → API issues them).
        </li>
        <li>
          A <code>403</code> of HTML rather than JSON is CloudFront, not Clockify — it means the
          request itself was malformed, most often a GET sent with a body.
        </li>
      </ol>
      <p class="mt-2 text-xs text-ink-500">
        Sessions are still being recorded meanwhile — {pending.length} waiting. Nothing is lost; they
        push once this is connected.
      </p>
    </div>
  {:else}
    <div class="card p-4 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <Icon name="check" size={14} />
        <span class="text-ink-900">Connected</span>
        {#if who}<span class="text-ink-500">{who}</span>{/if}
        <span class="ml-auto text-xs text-ink-400">{cProjects.length} Clockify projects</span>
      </div>
    </div>
  {/if}

  <!-- The backlog. This is the number that makes "push after the fact" safe. -->
  <div class="card p-4">
    <div class="flex flex-wrap items-center gap-2">
      <span class="card-title"><Icon name="clock" size={16} /> Waiting to push</span>
      <span class="text-sm font-semibold text-ink-900">{pending.length}</span>
      {#if pending.length > 0}
        <span class="text-xs text-ink-400">
          {hhmm(pending.reduce((n, s) => n + (s.seconds ?? 0), 0))} of tracked time
        </span>
      {/if}
      <button class="btn-primary ml-auto" disabled={busy || !connected || pending.length === 0} onclick={retryAll}>
        {busy ? 'Pushing…' : 'Push now'}
      </button>
    </div>
    {#if note}<p class="mt-2 text-xs text-ink-500">{note}</p>{/if}
    {#if pending.some((s) => s.push_status === 'failed')}
      <ul class="mt-2 space-y-1">
        {#each pending.filter((s) => s.push_status === 'failed').slice(0, 5) as s (s.id)}
          <li class="text-xs text-tag-salesText">
            {s.description} — {s.push_error?.slice(0, 120)}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- The catch-all. This workspace has forceProjects on, so an entry without
       a project is refused outright — and most tasks carry no project. Without
       this, those hours never leave twin. -->
  <div class="card p-4">
    <div class="flex flex-wrap items-center gap-2">
      <span class="card-title"><Icon name="sparkles" size={16} /> Unassigned work</span>
      {#if strays > 0}
        <span class="text-xs text-ink-400">{strays} of {tasks.length} tasks resolve nowhere</span>
      {/if}
    </div>
    <p class="mt-1 text-xs text-ink-400">
      Clockify refuses an entry without a project. Work that maps nowhere goes here instead of
      failing — pick the twin project whose mapping should catch it.
    </p>
    <select
      class="input mt-2 w-full"
      value={fallbackProject?.id ?? ''}
      onchange={(e) => setFallback(Number((e.currentTarget as HTMLSelectElement).value) || null)}
      disabled={!connected}
    >
      <option value="">— none, unassigned work will fail to push —</option>
      {#each tProjects.filter((p) => nearestMapped(p.id, byId)) as p (p.id)}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>
    {#if fallback}
      <p class="mt-1 text-xs text-ink-500">
        Goes to <strong>{cName.get(fallback.clockifyId) ?? fallback.clockifyId}</strong> in Clockify.
      </p>
    {:else if strays > 0}
      <p class="mt-1 text-xs text-tag-salesText">
        Nothing set — those {strays} tasks will fail on push and wait in the queue above.
      </p>
    {/if}
  </div>

  <!-- Project mapping. Explicit, because twin has 112 projects to Clockify's
       27 and Clockify holds both "DAFNA" and "dafna" as separate projects. -->
  <div class="card">
    <div class="card-header">
      <span class="card-title"><Icon name="sparkles" size={16} /> Project mapping
        <span class="font-normal text-ink-300">
          {mapped} mapped · {covered} of {tProjects.length} projects covered
        </span>
      </span>
    </div>
    <div class="px-4 pb-3">
      <input class="input" bind:value={q} placeholder="Search twin projects to map…" />
      <p class="mt-1 text-xs text-ink-400">
        Mappings are inherited: map a parent and every project under it follows, until one of them
        sets its own. Showing the projects that carry a mapping; search to find any other. Time on a
        project with nothing mapped above it is still recorded here, but Clockify refuses an entry
        without a project — those sessions wait in the queue above until something is mapped.
      </p>
      {#if redundant.length > 0}
        <!-- Left from mapping by hand before inheritance existed. Not urgent,
             but each one quietly pins its subtree against a later re-point. -->
        <div class="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface-hover p-2">
          <span class="text-xs text-ink-600">
            {redundant.length} project{redundant.length === 1 ? '' : 's'} map to what they would
            inherit anyway.
          </span>
          <button class="btn-ghost ml-auto text-xs" disabled={busy} onclick={clearRedundant}>
            {busy ? 'Clearing…' : 'Clear them'}
          </button>
        </div>
      {/if}
    </div>
    {#if loading}
      <p class="px-4 pb-4 text-sm text-ink-400">Loading…</p>
    {:else}
      <ul class="divide-y divide-surface-divider">
        {#each shown.slice(0, 40) as p (p.id)}
          {@const eff = effective(p)}
          {@const n = inheritCount(p)}
          <!-- Stacked on narrow: side by side, the select takes so much width
               that Icelandic project names truncate to "Gulleggi…". -->
          <li class="flex flex-col gap-1 px-4 py-2 sm:flex-row sm:items-center sm:gap-2">
            <span class="min-w-0 flex-1">
              <span class="block text-sm text-ink-900">{p.name}</span>
              {#if eff?.inherited}
                <!-- Why this project works without a select of its own. -->
                <span class="block truncate text-xs text-ink-400">
                  inherits {cName.get(eff.clockifyId) ?? eff.clockifyId} from
                  {byId.get(eff.viaId)?.name ?? `#${eff.viaId}`}
                </span>
              {:else if n > 0}
                <span class="block text-xs text-ink-400">
                  {n} project{n === 1 ? '' : 's'} under this inherit it
                </span>
              {/if}
            </span>
            <select
              class="input w-full sm:!w-auto sm:max-w-[55%]"
              value={p.clockify_project_id ?? ''}
              onchange={(e) => setMapping(p, (e.currentTarget as HTMLSelectElement).value)}
              disabled={!connected}
            >
              <option value="">{eff?.inherited ? '— inherited —' : '— not mapped —'}</option>
              {#each cProjects as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
            </select>
          </li>
        {/each}
        {#if shown.length === 0}
          <li class="px-4 py-3 text-sm text-ink-400">
            {q.trim() ? 'No twin project matches that.' : 'Nothing mapped yet — search for a project above.'}
          </li>
        {/if}
      </ul>
    {/if}
  </div>
</section>
