<script lang="ts">
  // Roll-up of grant awards across the orgs linked to this project +
  // every descendant project. On a parent like Hringiða this surfaces
  // every cohort org's grants; on a specific cohort (Hringiða 2026)
  // it's scoped to that cohort only. The actual table (column picker,
  // filter drawer, sort, mobile rows) is shared with /grants/[id]
  // via AwardsTable.
  import Icon from '$lib/Icon.svelte';
  import AwardsTable from '$lib/AwardsTable.svelte';
  import { formatGrantAmount, type GrantAward, type Organization } from '$lib/directus';

  let { awards, scopeLabel = null }: { awards: GrantAward[]; scopeLabel?: string | null } = $props();

  /** Totals per currency, for the card header. */
  const totals = $derived.by(() => {
    const m = new Map<string, number>();
    for (const a of awards) {
      const cur = a.currency ?? 'ISK';
      const n = typeof a.total_amount === 'number' ? a.total_amount : Number(a.total_amount ?? 0);
      if (Number.isFinite(n)) m.set(cur, (m.get(cur) ?? 0) + n);
    }
    return [...m.entries()].map(([cur, n]) => formatGrantAmount(n, cur));
  });

  /** Distinct org count — useful context when the count of awards is
   *  much higher than the count of recipient orgs (most cohorts have
   *  a few orgs that won multiple grants each). */
  const distinctOrgCount = $derived.by(() => {
    const s = new Set<number>();
    for (const a of awards) {
      const o = a.organization_id && typeof a.organization_id === 'object' ? a.organization_id as Organization : null;
      if (o?.id) s.add(o.id);
    }
    return s.size;
  });
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title">
      <Icon name="gift" size={16} /> Grants
      <span class="text-ink-300 font-normal">{awards.length}</span>
      {#if distinctOrgCount > 0}
        <span class="text-[11px] font-normal text-ink-400">· {distinctOrgCount} org{distinctOrgCount === 1 ? '' : 's'}</span>
      {/if}
    </span>
    {#if totals.length > 0}
      <span class="text-xs text-ink-400 tabular-nums">{totals.join(' · ')}</span>
    {/if}
  </div>

  {#if scopeLabel}
    <div class="px-4 pt-1 text-[11px] text-ink-400">{scopeLabel}</div>
  {/if}

  {#if awards.length === 0}
    <div class="px-4 py-3 text-sm text-ink-400">
      No grants on file for any member org{scopeLabel ? ' in this scope' : ''} yet.
    </div>
  {:else}
    <!-- Show the Programme column (Tegund styrks) since a project's
         roll-up usually spans multiple programmes. URL prefix "g_"
         keeps the filter params from colliding with anything else on
         /projects/[id]. Default columns favour the project context —
         programme + applicant + year + amount. -->
    <AwardsTable
      awards={awards}
      storageKey="twin.projects.grants.columns.v1"
      urlPrefix="g_"
      showProgramme={true}
      defaultCols={['award_name', 'applicant', 'programme', 'fund_year', 'amount']}
      emptyMessage="No awards in this scope."
    />
  {/if}
</div>
