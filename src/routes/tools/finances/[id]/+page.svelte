<script lang="ts">
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import {
    formatISK,
    FINANCE_CATEGORIES,
    financeCategoryColor,
    financeCategoryLabel,
    updateFinanceTxn,
    deleteFinanceTxn,
    deleteRecurringGroup,
    formatError,
    type FinanceTxn
  } from '$lib/directus';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let t = $state<FinanceTxn>(data.txn);
  let error = $state('');
  let savedAt = $state<string | null>(null);

  async function save(patch: Partial<FinanceTxn>) {
    error = '';
    const prev = { ...t };
    t = { ...t, ...patch };
    try {
      await updateFinanceTxn(t.id, patch);
      savedAt = new Date().toLocaleTimeString();
    } catch (e) {
      t = prev; // roll back
      error = formatError(e);
    }
  }
  function saveNum(field: keyof FinanceTxn, raw: string) {
    const n = Number(raw);
    if (!Number.isNaN(n)) save({ [field]: n } as Partial<FinanceTxn>);
  }

  let deleting = $state(false);
  async function remove() {
    if (!confirm(`Delete "${t.description || 'transaction'}"?`)) return;
    if (t.recurring_group && confirm('Part of a recurring series — delete the whole series? (Cancel = just this one)')) {
      deleting = true;
      try { await deleteRecurringGroup(t.recurring_group); goto('/tools/finances'); } catch (e) { error = formatError(e); deleting = false; }
      return;
    }
    deleting = true;
    try { await deleteFinanceTxn(t.id); goto('/tools/finances'); } catch (e) { error = formatError(e); deleting = false; }
  }

  function fmtLong(s?: string | null) {
    if (!s) return '—';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  }
  const isExpense = $derived((t.amount ?? 0) < 0);
</script>

<svelte:head><title>{t.description || 'Transaction'} · Finances</title></svelte:head>

<section class="mx-auto max-w-2xl space-y-5">
  <header class="flex items-center gap-3">
    <a href="/tools/finances" class="btn-ghost !px-2" aria-label="Back"><Icon name="chevron-left" size={20} /></a>
    <div class="min-w-0 flex-1">
      <div class="hero-eyebrow">Transaction</div>
      <h1 class="font-display truncate text-2xl font-bold" style="letter-spacing:-0.02em;">{t.description || '—'}</h1>
    </div>
    <button class="btn-ghost text-tag-salesText shrink-0" onclick={remove} disabled={deleting}><Icon name="trash" size={16} /> {deleting ? '…' : 'Delete'}</button>
  </header>

  {#if error}<div class="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>{/if}

  <!-- Amount + when -->
  <div class="card p-5 text-center">
    <div class="font-display text-4xl font-bold tabular-nums" style={`color:${isExpense ? 'var(--state-danger)' : 'var(--state-success)'};`}>{formatISK(t.amount)}</div>
    <div class="mt-1 text-sm text-ink-500">{fmtLong(t.txn_date)}</div>
    <span class="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={`background:${financeCategoryColor(t.category)}1a; color:${financeCategoryColor(t.category)};`}>
      {financeCategoryLabel(t.category)}
    </span>
  </div>

  <!-- Editable fields -->
  <div class="card divide-y divide-surface-divider">
    <label class="flex items-center justify-between gap-3 px-4 py-3">
      <span class="text-sm text-ink-500">Description</span>
      <input class="input max-w-[60%]" value={t.description ?? ''} onchange={(e) => save({ description: (e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label class="flex items-center justify-between gap-3 px-4 py-3">
      <span class="text-sm text-ink-500">Amount (ISK)</span>
      <input type="number" class="input max-w-[40%] text-right" value={t.amount ?? 0} onchange={(e) => saveNum('amount', (e.currentTarget as HTMLInputElement).value)} />
    </label>
    <label class="flex items-center justify-between gap-3 px-4 py-3">
      <span class="text-sm text-ink-500">Date</span>
      <input type="date" class="input max-w-[55%]" value={t.txn_date ?? ''} onchange={(e) => save({ txn_date: (e.currentTarget as HTMLInputElement).value })} />
    </label>
    <label class="flex items-center justify-between gap-3 px-4 py-3">
      <span class="text-sm text-ink-500">Category</span>
      <select class="input max-w-[55%]" value={t.category ?? ''} onchange={(e) => save({ category: (e.currentTarget as HTMLSelectElement).value || null })}>
        <option value="">Uncategorized</option>
        {#each FINANCE_CATEGORIES as c}<option value={c.value}>{c.label}</option>{/each}
      </select>
    </label>
    <div class="flex items-center justify-between gap-3 px-4 py-3">
      <span class="text-sm text-ink-500">Shared with ex</span>
      <button class="nav-icon" class:nav-icon-active={t.shared} aria-label="Toggle shared" onclick={() => save({ shared: !t.shared })}><Icon name="users" size={16} /></button>
    </div>
    {#if t.shared}
      <div class="flex flex-wrap items-center gap-2 px-4 py-3 text-sm text-ink-600">
        <span>Paid by</span>
        <select class="rounded-md border border-surface-border bg-surface-card px-1.5 py-1 text-xs" value={t.paid_by ?? 'me'} onchange={(e) => save({ paid_by: (e.currentTarget as HTMLSelectElement).value })}>
          <option value="me">Me</option><option value="ex">Ex</option>
        </select>
        <span>· Ex's share</span>
        <input type="number" min="0" max="100" class="w-16 rounded-md border border-surface-border bg-surface-card px-1.5 py-1 text-xs" value={t.share_ex_pct ?? 50} onchange={(e) => saveNum('share_ex_pct', (e.currentTarget as HTMLInputElement).value)} />
        <span>%</span>
      </div>
    {/if}
    <label class="flex flex-col gap-1 px-4 py-3">
      <span class="text-sm text-ink-500">Notes</span>
      <textarea class="input" rows="2" value={t.notes ?? ''} onchange={(e) => save({ notes: (e.currentTarget as HTMLTextAreaElement).value || null })}></textarea>
    </label>
  </div>

  <!-- Read-only meta -->
  <div class="card px-4 py-3 text-sm">
    <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
      <dt class="text-ink-400">Account</dt><dd class="text-right">{t.account || '—'}</dd>
      <dt class="text-ink-400">Payment type</dt><dd class="text-right">{t.detail || '—'}</dd>
      {#if t.counterparty_kt}<dt class="text-ink-400">Kennitala</dt><dd class="text-right tabular-nums">{t.counterparty_kt}</dd>{/if}
      <dt class="text-ink-400">Balance after</dt><dd class="text-right tabular-nums">{t.balance != null ? formatISK(t.balance) : '—'}</dd>
      <dt class="text-ink-400">Source</dt><dd class="text-right capitalize">{t.source || '—'}{#if t.recurring_group} · recurring{/if}</dd>
    </dl>
  </div>

  {#if savedAt}<p class="text-right text-xs text-ink-400">Saved {savedAt}</p>{/if}
</section>
