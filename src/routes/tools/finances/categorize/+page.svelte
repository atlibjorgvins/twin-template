<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import {
    formatISK,
    FINANCE_CATEGORIES,
    bulkUpdateFinanceTxns,
    createFinanceRule,
    applyRulesToTxns,
    formatError,
    type FinanceTxn,
    type FinanceRule
  } from '$lib/directus';
  import type { CategorizeData } from './+page';

  let { data }: { data: CategorizeData } = $props();
  let uncategorized = $state<FinanceTxn[]>(data.uncategorized);
  let rules = $state<FinanceRule[]>(data.rules);
  let error = $state('');
  let busy = $state(false);
  let done = $state(0); // count tagged this session

  const merchantOf = (t: FinanceTxn) => (t.description || '—').split(',')[0].trim() || '—';

  // Group uncategorized by merchant, biggest spend first.
  type Group = { merchant: string; count: number; total: number; ids: number[]; choice: string };
  let choices = $state<Record<string, string>>({});
  const groups = $derived.by<Group[]>(() => {
    const m = new Map<string, { count: number; total: number; ids: number[] }>();
    for (const t of uncategorized) {
      const k = merchantOf(t);
      const g = m.get(k) ?? { count: 0, total: 0, ids: [] };
      g.count++; g.total += Math.abs(t.amount || 0); g.ids.push(t.id); m.set(k, g);
    }
    return [...m.entries()]
      .map(([merchant, g]) => ({ merchant, ...g, choice: choices[merchant] ?? '' }))
      .sort((a, b) => b.total - a.total);
  });

  async function apply(g: Group, alsoRule: boolean) {
    const cat = choices[g.merchant];
    if (!cat || busy) return;
    busy = true; error = '';
    try {
      await bulkUpdateFinanceTxns(g.ids, { category: cat });
      if (alsoRule) {
        const r = await createFinanceRule({ match_text: g.merchant, category: cat, sort: rules.length });
        rules = [...rules, r];
      }
      const idset = new Set(g.ids);
      uncategorized = uncategorized.filter((t) => !idset.has(t.id));
      done += g.count;
      delete choices[g.merchant];
    } catch (e) { error = formatError(e); } finally { busy = false; }
  }

  async function reapplyRules() {
    if (busy || rules.length === 0) return;
    busy = true; error = '';
    try {
      const n = await applyRulesToTxns(uncategorized, rules);
      if (n > 0) {
        // Drop the ones a rule matched from the list.
        uncategorized = uncategorized.filter((t) => !applyMatch(t));
        done += n;
      }
    } catch (e) { error = formatError(e); } finally { busy = false; }
  }
  // local mirror of the rule matcher for pruning the list after reapply
  function applyMatch(t: FinanceTxn): boolean {
    const d = (t.description || '').toLowerCase();
    return rules.some((r) => { const m = (r.match_text || '').trim().toLowerCase(); return m && d.includes(m); });
  }

  const remaining = $derived(uncategorized.length);
</script>

<svelte:head><title>Categorize · Finances</title></svelte:head>

<section class="mx-auto max-w-2xl space-y-5">
  <header class="flex items-center gap-3">
    <a href="/tools/finances" class="btn-ghost !px-2" aria-label="Back"><Icon name="chevron-left" size={20} /></a>
    <div class="min-w-0 flex-1">
      <div class="hero-eyebrow">Finances</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing:-0.03em;">Categorize</h1>
    </div>
    {#if rules.length}
      <button class="btn-ghost text-sm shrink-0" onclick={reapplyRules} disabled={busy}><Icon name="filter" size={14} /> Re-apply rules</button>
    {/if}
  </header>

  {#if error}<div class="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>{/if}

  <div class="flex items-center justify-between text-sm text-ink-500">
    <span><span class="font-semibold text-ink-900">{remaining}</span> uncategorized {remaining === 1 ? 'transaction' : 'transactions'}, {groups.length} merchants</span>
    {#if done > 0}<span class="text-[color:var(--state-success)]">✓ {done} tagged</span>{/if}
  </div>

  {#if remaining === 0}
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card px-4 py-10 text-center text-sm text-ink-500">
      🎉 Everything's categorized. Nice.
    </div>
  {:else}
    <ul class="space-y-2">
      {#each groups as g (g.merchant)}
        <li class="card flex flex-wrap items-center gap-2 p-3">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-ink-900">{g.merchant}</div>
            <div class="text-xs text-ink-400">{g.count}× · {formatISK(g.total)}</div>
          </div>
          <select class="input max-w-[150px]" bind:value={choices[g.merchant]}>
            <option value="">Category…</option>
            {#each FINANCE_CATEGORIES as c}<option value={c.value}>{c.label}</option>{/each}
          </select>
          <button class="btn-ghost text-xs" disabled={busy || !choices[g.merchant]} title="Set category on these only" onclick={() => apply(g, false)}>Set</button>
          <button class="btn-primary text-xs" disabled={busy || !choices[g.merchant]} title="Set + create a rule so future imports auto-tag this merchant" onclick={() => apply(g, true)}>Set + rule</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>
