<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import {
    formatISK,
    financeCategoryColor,
    financeExBreakdown,
    createFinanceSettlement,
    deleteFinanceSettlement,
    formatError,
    type FinanceTxn,
    type FinanceSettlement
  } from '$lib/directus';
  import type { SplitData } from './+page';

  let { data }: { data: SplitData } = $props();
  let sharedTxns = $state<FinanceTxn[]>(data.sharedTxns);
  let settlements = $state<FinanceSettlement[]>(data.settlements);
  let error = $state('');

  // Categories the user has unchecked — excluded from the headline numbers.
  let excluded = $state<Set<string>>(new Set());
  let expanded = $state<Set<string>>(new Set());
  function catKey(t: FinanceTxn) { return t.category || '__uncat__'; }
  function toggleExcluded(key: string) {
    const s = new Set(excluded);
    if (s.has(key)) s.delete(key); else s.add(key);
    excluded = s;
  }
  function toggleExpand(key: string) {
    const s = new Set(expanded);
    if (s.has(key)) s.delete(key); else s.add(key);
    expanded = s;
  }
  function catTxns(key: string): FinanceTxn[] {
    return sharedTxns
      .filter((t) => catKey(t) === key)
      .sort((a, b) => (a.txn_date ?? '') < (b.txn_date ?? '') ? 1 : -1);
  }

  // `full` lists every category (for the checkboxes); `b` (the headline
  // numbers) reflects only the included categories.
  const full = $derived(financeExBreakdown(sharedTxns, settlements));
  const included = $derived(sharedTxns.filter((t) => !excluded.has(catKey(t))));
  const b = $derived(financeExBreakdown(included, settlements));
  const maxCat = $derived(Math.max(1, ...full.byCat.map((c) => c.shared)));

  const pad = (n: number) => String(n).padStart(2, '0');
  function fmtDate(s?: string | null) {
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
  }

  // Settlements
  let sDate = $state(`${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`);
  let sAmount = $state('');
  let sDir = $state<'ex_to_me' | 'me_to_ex'>('ex_to_me');
  let sNotes = $state('');
  async function addSettlement() {
    const amt = Number(sAmount);
    if (!amt || !sDate) return;
    try {
      const s = await createFinanceSettlement({ settle_date: sDate, amount: Math.abs(amt), direction: sDir, notes: sNotes.trim() || null });
      settlements = [s, ...settlements];
      sAmount = ''; sNotes = '';
    } catch (e) { error = formatError(e); }
  }
  async function removeSettlement(id: number) {
    try { await deleteFinanceSettlement(id); settlements = settlements.filter((x) => x.id !== id); } catch (e) { error = formatError(e); }
  }
</script>

<svelte:head><title>Ex split · Finances</title></svelte:head>

<section class="space-y-5">
  <header class="flex items-center gap-3">
    <a href="/tools/finances" class="btn-ghost !px-2" aria-label="Back to finances"><Icon name="chevron-left" size={20} /></a>
    <div>
      <div class="hero-eyebrow">Finances</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing:-0.03em;">Ex vs me split</h1>
    </div>
  </header>

  {#if error}
    <div class="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
  {/if}

  <!-- The balance -->
  <div class="card p-5 text-center" style={`border-color:${b.net >= 0 ? 'var(--state-success)' : 'var(--state-danger)'};`}>
    <div class="muted-label">{b.net >= 0 ? 'Ex owes you' : 'You owe ex'}</div>
    <div class="mt-1 font-display text-4xl font-bold" style={`color:${b.net >= 0 ? 'var(--state-success)' : 'var(--state-danger)'};`}>{formatISK(Math.abs(b.net))}</div>
    <div class="mt-1 text-xs text-ink-400">across {b.sharedCount} shared {b.sharedCount === 1 ? 'item' : 'items'} · {formatISK(b.sharedTotal)} total</div>
  </div>

  <!-- How it breaks down -->
  <div class="grid gap-3 sm:grid-cols-2">
    <div class="card p-4">
      <div class="muted-label">You fronted</div>
      <div class="mt-1 font-display text-xl font-bold text-ink-900">{formatISK(b.youFronted)}</div>
      <div class="mt-1 text-xs text-ink-500">Ex's share → owes you <span class="font-semibold text-[color:var(--state-success)]">{formatISK(b.exOwesYou)}</span></div>
    </div>
    <div class="card p-4">
      <div class="muted-label">Ex fronted</div>
      <div class="mt-1 font-display text-xl font-bold text-ink-900">{formatISK(b.exFronted)}</div>
      <div class="mt-1 text-xs text-ink-500">Your share → you owe <span class="font-semibold text-[color:var(--state-danger)]">{formatISK(b.youOweEx)}</span></div>
    </div>
    <div class="card p-4">
      <div class="muted-label">Settled so far</div>
      <div class="mt-1 text-sm">Ex paid you <span class="font-semibold tabular-nums">{formatISK(b.settleExToMe)}</span></div>
      <div class="text-sm">You paid ex <span class="font-semibold tabular-nums">{formatISK(b.settleMeToEx)}</span></div>
    </div>
    <div class="card p-4">
      <div class="muted-label">Net (after settlements)</div>
      <div class="mt-1 font-display text-xl font-bold" style={`color:${b.net >= 0 ? 'var(--state-success)' : 'var(--state-danger)'};`}>{formatISK(b.net)}</div>
      <div class="mt-1 text-xs text-ink-400">{b.net >= 0 ? 'in your favour' : 'you owe'}</div>
    </div>
  </div>

  <!-- Shared spend by category -->
  {#if full.byCat.length}
    <div class="card p-4">
      <div class="mb-3 flex items-center justify-between">
        <span class="card-title"><Icon name="layers" size={16} /> Shared spend by category</span>
        {#if excluded.size > 0}
          <button class="text-[11px] text-brand hover:underline" onclick={() => (excluded = new Set())}>Reset ({excluded.size} hidden)</button>
        {/if}
      </div>
      <ul class="space-y-2.5">
        {#each full.byCat as c (c.key)}
          {@const off = excluded.has(c.key)}
          {@const color = financeCategoryColor(c.key === '__uncat__' ? null : c.key)}
          <li>
            <div class="flex items-center gap-2 text-sm" class:opacity-40={off}>
              <input type="checkbox" class="accent-brand shrink-0" checked={!off} onchange={() => toggleExcluded(c.key)} aria-label={`Include ${c.label}`} />
              <button class="flex min-w-0 flex-1 items-center justify-between gap-2 text-left" onclick={() => toggleExpand(c.key)} title="Show transactions">
                <span class="inline-flex min-w-0 items-center gap-2">
                  <Icon name="chevron-right" size={12} class={expanded.has(c.key) ? 'rotate-90 text-ink-300' : 'text-ink-300'} />
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full" style={`background:${color};`}></span>
                  <span class="truncate">{c.label}</span> <span class="shrink-0 text-xs text-ink-400">· {c.count}</span>
                </span>
                <span class="shrink-0 tabular-nums text-ink-700">{formatISK(c.shared)} <span class="text-ink-400">· ex {formatISK(c.exShare)}</span></span>
              </button>
            </div>
            <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover" class:opacity-40={off}>
              <div class="h-full rounded-full" style={`width:${Math.max(2, (c.shared / maxCat) * 100)}%; background:${color};`}></div>
            </div>
            {#if expanded.has(c.key)}
              <ul class="mt-2 divide-y divide-surface-divider rounded-[10px] border border-surface-border bg-surface-card">
                {#each catTxns(c.key) as t (t.id)}
                  <li class="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span class="w-16 shrink-0 text-ink-400 tabular-nums">{fmtDate(t.txn_date)}</span>
                    <span class="min-w-0 flex-1 truncate text-ink-900">{t.description || '—'}</span>
                    <span class="shrink-0 text-ink-400">{t.paid_by === 'ex' ? 'ex paid' : 'you paid'} · {t.share_ex_pct ?? 50}%</span>
                    <span class="w-20 shrink-0 text-right font-medium tabular-nums" style={`color:${(t.amount ?? 0) < 0 ? 'var(--state-danger)' : 'var(--state-success)'};`}>{formatISK(t.amount)}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
      {#if excluded.size > 0}
        <p class="mt-3 text-[11px] text-ink-400">Headline numbers above exclude the unchecked categories.</p>
      {/if}
    </div>
  {:else}
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card px-4 py-8 text-center text-sm text-ink-500">
      No shared expenses yet. Mark transactions as shared (the people icon) on the finances page to build the split.
    </div>
  {/if}

  <!-- Settlements -->
  <div class="card space-y-3 p-4">
    <div class="card-title"><Icon name="wallet" size={16} /> Settlements</div>
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <input type="date" class="input" bind:value={sDate} />
      <input type="number" class="input" placeholder="Amount (ISK)" bind:value={sAmount} />
      <select class="input" bind:value={sDir}>
        <option value="ex_to_me">Ex paid me</option>
        <option value="me_to_ex">I paid ex</option>
      </select>
      <input type="text" class="input" placeholder="Note" bind:value={sNotes} />
    </div>
    <div class="flex justify-end"><button class="btn-primary" onclick={addSettlement} disabled={!Number(sAmount)}>Add settlement</button></div>
    {#if settlements.length}
      <ul class="divide-y divide-surface-divider text-sm">
        {#each settlements as s (s.id)}
          <li class="flex items-center justify-between py-1.5">
            <span>{fmtDate(s.settle_date)} · <span class={s.direction === 'ex_to_me' ? 'text-[color:var(--state-success)]' : 'text-[color:var(--state-danger)]'}>{s.direction === 'ex_to_me' ? 'Ex → me' : 'Me → ex'}</span> · {formatISK(s.amount)}{#if s.notes} · <span class="text-ink-400">{s.notes}</span>{/if}</span>
            <button class="nav-icon" aria-label="Delete settlement" onclick={() => removeSettlement(s.id)}><Icon name="x" size={14} /></button>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="text-sm text-ink-400">No settlements logged yet.</div>
    {/if}
  </div>
</section>
