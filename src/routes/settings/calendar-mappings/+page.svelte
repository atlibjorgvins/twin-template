<script lang="ts">
  // Settings → Calendar → Project mapping.
  //
  // For every source calendar that's surfaced events into Dates we
  // show one row. Each row has:
  //   - the calendar name (e.g. "you@work.example") + event count
  //   - a Project picker (autocomplete) for the default project
  //   - a Scope select (work / private / both / unset)
  //   - a Delete to clear the mapping
  //
  // A Backfill button at the bottom walks every mapping and writes
  // its project_id onto every Dates row whose project_id is still
  // null. Hand-set links are never clobbered.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import {
    listCalendarMappings,
    listExternalCalendars,
    createCalendarMapping,
    updateCalendarMapping,
    deleteCalendarMapping,
    backfillCalendarMappings,
    searchProjects,
    type CalendarMapping,
    type Project
  } from '$lib/directus';

  let mappings = $state<CalendarMapping[]>([]);
  let calendars = $state<Array<{ name: string; count: number }>>([]);
  let loading = $state(true);
  let error = $state('');
  let backfilling = $state(false);
  let backfillSummary = $state<Array<{ external_calendar: string; updated: number }> | null>(null);

  async function refresh() {
    loading = true; error = '';
    try {
      const [m, c] = await Promise.all([listCalendarMappings(), listExternalCalendars()]);
      mappings = m;
      calendars = c;
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { loading = false; }
  }
  onMount(refresh);

  /** Look up by external_calendar string — null if no mapping yet. */
  function mappingFor(name: string): CalendarMapping | null {
    return mappings.find((m) => m.external_calendar === name) ?? null;
  }

  // ── Project picker (per-row autocomplete) ──────────────────────
  // Keyed by the calendar name so each row owns its own input
  // state without leaking through to siblings.
  let projectQueries = $state<Record<string, string>>({});
  let projectResults = $state<Record<string, Project[]>>({});
  let projectTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  function onProjectQuery(name: string, e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    projectQueries[name] = v;
    if (projectTimers[name]) clearTimeout(projectTimers[name]);
    projectTimers[name] = setTimeout(async () => {
      if (!v.trim()) { projectResults[name] = []; return; }
      try { projectResults[name] = (await searchProjects(v, 8)) as Project[]; }
      catch { projectResults[name] = []; }
    }, 180);
  }
  async function pickProject(name: string, p: Project | null) {
    const existing = mappingFor(name);
    try {
      if (existing) {
        const patched = await updateCalendarMapping(existing.id, { project_id: p ? p.id : null } as Partial<CalendarMapping>);
        mappings = mappings.map((m) => (m.id === existing.id ? { ...patched, project_id: p ?? null } : m));
      } else if (p) {
        const created = await createCalendarMapping({ external_calendar: name, project_id: p.id });
        mappings = [...mappings, { ...created, project_id: p }];
      }
      projectQueries[name] = '';
      projectResults[name] = [];
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  async function setScope(name: string, scope: string) {
    const existing = mappingFor(name);
    try {
      if (existing) {
        await updateCalendarMapping(existing.id, { scope: (scope || null) as never });
        mappings = mappings.map((m) => (m.id === existing.id ? { ...m, scope: scope || null } : m));
      } else if (scope) {
        const created = await createCalendarMapping({ external_calendar: name, scope: scope as never });
        mappings = [...mappings, created];
      }
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }
  async function clearMapping(name: string) {
    const existing = mappingFor(name);
    if (!existing) return;
    if (!confirm(`Clear mapping for ${name}? Existing events stay attached; only future ingests stop auto-linking.`)) return;
    try {
      await deleteCalendarMapping(existing.id);
      mappings = mappings.filter((m) => m.id !== existing.id);
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }

  async function runBackfill() {
    if (backfilling) return;
    if (!confirm('Apply every mapping to existing events? Only rows without a project set get touched — hand-linked events are never clobbered.')) return;
    backfilling = true; error = ''; backfillSummary = null;
    try {
      const res = await backfillCalendarMappings();
      backfillSummary = res.filter((r) => r.updated > 0);
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { backfilling = false; }
  }
</script>

<svelte:head><title>Calendar → Project · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Calendar → Project"
    subtitle="Each source calendar can default to a project. Future-ingested events from that calendar auto-attach; existing events can be re-linked with one click below."
  />

  {#if error}
    <p class="rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-sm text-tag-salesText">{error}</p>
  {/if}

  <div class="card overflow-hidden">
    {#if loading}
      <div class="px-4 py-6 text-sm text-ink-400">Loading…</div>
    {:else if calendars.length === 0}
      <div class="px-4 py-6 text-sm text-ink-400">
        No source calendars on file yet. Run <code class="font-mono text-[11px]">scripts/ingest-apple-calendar.mjs</code> first.
      </div>
    {:else}
      <div class="hidden sm:grid grid-cols-[1.6fr_2fr_8rem_2rem] gap-3 border-b border-surface-divider px-4 py-2 text-[10px] uppercase tracking-wider text-ink-400">
        <span>Calendar</span><span>Default project</span><span>Scope</span><span></span>
      </div>
      <ul class="divide-y divide-surface-divider">
        {#each calendars as c (c.name)}
          {@const map = mappingFor(c.name)}
          {@const proj = map?.project_id && typeof map.project_id === 'object' ? (map.project_id as Project) : null}
          <li class="grid grid-cols-1 sm:grid-cols-[1.6fr_2fr_8rem_2rem] items-center gap-3 px-4 py-3">
            <!-- Calendar name + count -->
            <div class="min-w-0">
              <div class="truncate font-medium text-ink-900">{c.name}</div>
              <div class="text-[11px] text-ink-400 tabular-nums">{c.count} event{c.count === 1 ? '' : 's'}</div>
            </div>
            <!-- Default project: pill if set, autocomplete otherwise. -->
            <div class="min-w-0">
              {#if proj}
                <span class="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-hover px-2 py-0.5 text-sm">
                  {#if proj.color}<span class="inline-block h-2 w-2 rounded-full" style:background-color={proj.color}></span>{/if}
                  <a href={`/projects/${proj.id}`} class="hover:text-brand">{proj.name}</a>
                  <button class="text-ink-400 hover:text-tag-salesText" aria-label="Clear project" onclick={() => pickProject(c.name, null)}>×</button>
                </span>
              {:else}
                <div class="relative">
                  <input
                    type="search"
                    placeholder="Search projects…"
                    value={projectQueries[c.name] ?? ''}
                    oninput={(e) => onProjectQuery(c.name, e)}
                    class="w-full rounded-md border border-surface-border bg-surface-card px-2 py-1 text-sm focus:border-brand focus:outline-none"
                  />
                  {#if (projectResults[c.name]?.length ?? 0) > 0}
                    <ul class="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-surface-border bg-surface-card shadow-card">
                      {#each projectResults[c.name] as p (p.id)}
                        <li>
                          <button
                            type="button"
                            class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
                            onclick={() => pickProject(c.name, p)}
                          >
                            {#if p.color}<span class="inline-block h-2 w-2 rounded-full" style:background-color={p.color}></span>{/if}
                            <span class="truncate text-ink-900">{p.name}</span>
                            {#if p.kind}<span class="ml-auto text-[10px] text-ink-400">{p.kind}</span>{/if}
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}
            </div>
            <!-- Scope select -->
            <div>
              <select
                class="w-full rounded-md border border-surface-border bg-surface-card px-2 py-1 text-sm focus:border-brand focus:outline-none"
                value={map?.scope ?? ''}
                onchange={(e) => setScope(c.name, (e.currentTarget as HTMLSelectElement).value)}
              >
                <option value="">—</option>
                <option value="work">Work</option>
                <option value="private">Private</option>
                <option value="both">Both</option>
              </select>
            </div>
            <!-- Clear -->
            <div class="text-right">
              {#if map}
                <button class="text-ink-300 hover:text-tag-salesText" aria-label="Remove mapping" onclick={() => clearMapping(c.name)}>
                  <Icon name="x" size={16} />
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="card flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="text-sm text-ink-600">
      <strong class="text-ink-900">Backfill existing events.</strong>
      Walks every Dates row and applies the matching mapping's project — but only when the event has no project set, so hand-linked events stay put.
    </div>
    <button class="btn-primary shrink-0" onclick={runBackfill} disabled={backfilling || mappings.length === 0}>
      {backfilling ? 'Backfilling…' : 'Apply mappings to existing events'}
    </button>
  </div>

  {#if backfillSummary}
    <div class="card px-4 py-3 text-sm">
      {#if backfillSummary.length === 0}
        <div class="text-ink-400">Nothing to update — every mappable event already has a project set.</div>
      {:else}
        <div class="mb-1 font-medium text-ink-900">Updated {backfillSummary.reduce((n, r) => n + r.updated, 0)} event{backfillSummary.reduce((n, r) => n + r.updated, 0) === 1 ? '' : 's'}:</div>
        <ul class="text-ink-600">
          {#each backfillSummary as r (r.external_calendar)}
            <li class="tabular-nums">{r.updated} · {r.external_calendar}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>
