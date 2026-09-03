<script lang="ts">
  // Grants awarded to a single org. Renders inside the Overview tab
  // of the org detail page. Each row links to the grant programme
  // detail page where the full payout schedule can be managed.
  import Icon from '$lib/Icon.svelte';
  import { formatGrantAmount, type GrantAward } from '$lib/directus';

  let { awards }: { awards: GrantAward[] } = $props();

  const totals = $derived.by(() => {
    const m = new Map<string, number>();
    for (const a of awards) {
      const cur = a.currency ?? 'ISK';
      const n = typeof a.total_amount === 'number' ? a.total_amount : Number(a.total_amount ?? 0);
      if (Number.isFinite(n)) m.set(cur, (m.get(cur) ?? 0) + n);
    }
    return [...m.entries()].map(([cur, n]) => formatGrantAmount(n, cur));
  });
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title">
      <Icon name="gift" size={16} /> Grants
      <span class="text-ink-300 font-normal">{awards.length}</span>
    </span>
    {#if totals.length > 0}
      <span class="text-xs text-ink-400">{totals.join(' · ')}</span>
    {/if}
  </div>
  {#if awards.length === 0}
    <div class="px-4 pb-4 text-sm text-ink-400">
      No grants recorded for this org yet. Record one from
      <a href="/grants" class="text-brand hover:underline">Grants</a>.
    </div>
  {:else}
    <ul class="divide-y divide-surface-divider">
      {#each awards as a (a.id)}
        {@const grant = a.grant_id && typeof a.grant_id === 'object' ? a.grant_id : null}
        {@const year = a.fund_year ?? a.awarded_year ?? null}
        {@const projectTitle = a.award_name ?? null}
        <li>
          <a href={grant ? `/grants/${grant.id}` : '/grants'} class="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-hover">
            {#if grant?.color}
              <span class="inline-block h-2 w-2 shrink-0 rounded-full" style:background-color={grant.color} aria-hidden="true"></span>
            {/if}
            <div class="min-w-0 flex-1">
              <!-- Project title first if we have one — that's what
                   the user actually wants to recognise. Programme
                   name + year sit in the supporting line. -->
              <div class="truncate font-medium text-ink-900">{projectTitle ?? grant?.name ?? '(unknown grant)'}</div>
              <div class="truncate text-xs text-ink-400">
                {year ?? '—'}{grant && projectTitle ? ` · ${grant.name}` : ''}{a.stage ? ` · ${a.stage}` : ''}{a.region_acronym ? ` · ${a.region_acronym}` : ''}
              </div>
            </div>
            <!-- Amount is the headline number — visible on every
                 breakpoint. The status pill was always "awarded" on
                 imported rows; carry it only when it's something
                 non-default (active / completed / rejected). -->
            <span class="tabular-nums text-ink-900 shrink-0">{formatGrantAmount(a.total_amount, a.currency)}</span>
            {#if a.award_status && a.award_status !== 'awarded'}
              <span class="hidden sm:inline rounded-full border border-surface-border bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-600">{a.award_status}</span>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
