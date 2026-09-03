<script lang="ts">
  // Reverse-lookup "Events" card for project / person / org detail
  // pages. Self-contained: fetches on mount for the given entity, so
  // host pages just drop in one tag. Renders nothing while empty
  // unless `showEmpty` — keeps detail pages quiet when there are none.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import { assetUrl } from '$lib/directus';
  import {
    listEventsForProject,
    listEventsForPerson,
    listEventsForOrg,
    EVENT_KIND_LABEL,
    EVENT_STATUS_LABEL,
    eventTimeStatus,
    type LinkedEvent
  } from '$lib/events/data';

  type Props = {
    entity: 'project' | 'person' | 'org';
    id: number;
    /** Show the card with an empty hint even when there are no events. */
    showEmpty?: boolean;
  };
  let { entity, id, showEmpty = false }: Props = $props();

  let events = $state<LinkedEvent[]>([]);
  let loaded = $state(false);

  onMount(async () => {
    try {
      events =
        entity === 'project'
          ? await listEventsForProject(id)
          : entity === 'person'
            ? await listEventsForPerson(id)
            : await listEventsForOrg(id);
    } catch {
      events = [];
    } finally {
      loaded = true;
    }
  });

  const STATUS_STYLE: Record<string, string> = {
    idea: 'background: var(--bg-tertiary); color: var(--text-secondary);',
    planning: 'background: rgba(214,158,46,0.16); color: #B57A12;',
    upcoming: 'background: rgba(29,107,254,0.12); color: #1D6BFE;',
    past: 'background: rgba(34,160,90,0.14); color: #1B8A4B;'
  };
  const fmt = (iso?: string | null) =>
    iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : null;
</script>

{#if loaded && (events.length > 0 || showEmpty)}
  <div class="card p-4 space-y-2">
    <div class="card-title"><Icon name="flag" size={16} /> Events</div>
    {#if events.length === 0}
      <p class="text-xs text-ink-400">Not connected to any events yet.</p>
    {:else}
      <ul class="divide-y divide-surface-divider">
        {#each events as e (e.id)}
          <li>
            <a href={`/events/${e.id}`} class="flex items-center gap-3 py-2 transition hover:bg-surface-hover">
              {#if e.cover}
                <img src={assetUrl(e.cover, { width: 96, height: 96, fit: 'cover' })} alt="" class="h-9 w-9 shrink-0 rounded object-cover" />
              {:else}
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded text-ink-300" style="background: var(--bg-tertiary);"><Icon name="flag" size={14} /></span>
              {/if}
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-sm font-medium text-ink-900">{e.name}</span>
                  <!-- Derived, not the stored `status`. That field is not
                       maintained when a date passes — two July events were
                       still badged "Upcoming" in August. eventTimeStatus lets
                       idea/planning/archived win and reads the rest off the
                       dates, matching what LinkedEvents has always done. -->
                  {#if eventTimeStatus(e) && eventTimeStatus(e) !== 'archived'}
                    {@const shown = eventTimeStatus(e)}
                    <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={STATUS_STYLE[shown] ?? STATUS_STYLE.idea}>{EVENT_STATUS_LABEL[shown] ?? shown}</span>
                  {/if}
                </span>
                <span class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-500">
                  <span>{EVENT_KIND_LABEL[e.kind ?? 'other'] ?? e.kind}</span>
                  {#if fmt(e.start)}<span>·</span><span class="tabular-nums">{fmt(e.start)}</span>{/if}
                  {#if e.roles && e.roles.length > 0}<span>·</span><span class="capitalize">{e.roles.join(', ')}</span>{/if}
                </span>
              </span>
              <Icon name="chevron-right" size={14} class="shrink-0 text-ink-300" />
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
