<script lang="ts">
  // Confirmed press coverage for one record.
  //
  // This component is only ever reached through a dynamic import() — see
  // NewsCoverage.svelte. Importing it statically from an org page would pull
  // the news client and its queries into the CRM bundle, paid on every org
  // page view whether or not frettir is running. That is the one way this
  // feature could quietly make twin heavier, so the seam is deliberate.
  //
  // Renders NOTHING when there is no confirmed coverage, and nothing when the
  // service is unreachable — an empty card on every org would be worse than
  // the feature's absence. `mention` does not exist until frettir phase 2, so
  // on a phase-1 instance this is simply invisible.
  import Icon from '$lib/Icon.svelte';
  import { coverageFor, type NewsMention } from '$lib/news/data';

  let {
    entityType,
    entityId,
    limit = 5
  }: {
    entityType: 'organization' | 'project' | 'person';
    entityId: number;
    limit?: number;
  } = $props();

  let rows = $state<NewsMention[]>([]);
  let loaded = $state(false);

  $effect(() => {
    void coverageFor(entityType, entityId, limit)
      .then((r) => (rows = r))
      .catch(() => (rows = []))
      .finally(() => (loaded = true));
  });

  function fmtDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  }
</script>

{#if loaded && rows.length > 0}
  <div class="card">
    <div class="card-header">
      <span class="card-title"><Icon name="notebook" size={16} /> In the news
        <span class="font-normal text-ink-300">{rows.length}</span>
      </span>
      <a href="/news" class="text-xs text-ink-400 hover:text-ink-700">All news</a>
    </div>
    <ul class="space-y-1.5 px-4 pb-4">
      {#each rows as m (m.id)}
        {@const a = m.article}
        <li class="rounded-[10px] border border-surface-divider bg-surface-hover/40 px-3 py-2">
          <a href={a?.url ?? '#'} target="_blank" rel="noreferrer"
             class="text-[13px] font-medium text-ink-900 hover:underline">{a?.title || 'Untitled'}</a>
          <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
            {#if a?.source?.outlet}<span class="uppercase tracking-wide">{a.source.outlet}</span>{/if}
            <span>{fmtDate(a?.published_at)}</span>
            {#if m.matched_text}<span>· matched “{m.matched_text}”</span>{/if}
          </div>
        </li>
      {/each}
    </ul>
  </div>
{/if}
