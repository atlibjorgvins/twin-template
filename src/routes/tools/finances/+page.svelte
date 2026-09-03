<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import {
    formatISK,
    FINANCE_CATEGORIES,
    financeCategoryColor,
    financeCategoryLabel,
    listFinanceTxns,
    listFinanceAccounts,
    updateFinanceTxn,
    bulkUpdateFinanceTxns,
    deleteFinanceTxn,
    createFinanceTxn,
    importFinanceTxns,
    deleteRecurringGroup,
    listFinanceRules,
    createFinanceRule,
    deleteFinanceRule,
    applyFinanceRules,
    createFinanceSettlement,
    deleteFinanceSettlement,
    financeExBalance,
    formatError,
    type FinanceTxn,
    type FinanceSettlement,
    type FinanceRule
  } from '$lib/directus';
  import { parseLandsbankinn } from '$lib/finance/import';
  import * as XLSX from 'xlsx';
  import type { FinanceData } from './+page';

  let { data }: { data: FinanceData } = $props();

  let txns = $state<FinanceTxn[]>(data.txns);
  let sharedTxns = $state<FinanceTxn[]>(data.sharedTxns);
  let settlements = $state<FinanceSettlement[]>(data.settlements);
  let rules = $state<FinanceRule[]>(data.rules);
  let accounts = $state<string[]>(data.accounts);

  // ── Filters ──────────────────────────────────────────────────────────
  let from = $state(data.from);
  let to = $state(data.to);
  let category = $state('');
  let q = $state('');
  let sharedOnly = $state(false);
  let account = $state('');
  let loading = $state(false);
  let error = $state('');

  let sortBy = $state<'date' | 'amount_desc' | 'amount_asc'>('date');

  // Drill-through: /tools/finances?cat=groceries or ?q=merchant
  onMount(() => {
    const c = $page.url.searchParams.get('cat');
    if (c) category = c;
    const query = $page.url.searchParams.get('q');
    if (query) q = query;
  });

  let first = true;
  let refetchTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const f = from, t = to, c = category, query = q, s = sharedOnly, a = account, so = sortBy;
    if (first) { first = false; return; }
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(async () => {
      loading = true; error = '';
      try {
        const uncategorized = c === '__uncat__';
        txns = await listFinanceTxns({ from: f, to: t, category: uncategorized ? null : (c || null), uncategorized, q: query, sharedOnly: s, account: a || null, sort: so, limit: 3000 });
      } catch (e) { error = formatError(e); } finally { loading = false; }
    }, 250);
  });

  const balance = $derived(financeExBalance(sharedTxns, settlements));
  const income = $derived(txns.filter((t) => (t.amount ?? 0) > 0).reduce((s, t) => s + (t.amount || 0), 0));
  const expense = $derived(txns.filter((t) => (t.amount ?? 0) < 0).reduce((s, t) => s + (t.amount || 0), 0));

  // ── Group by category ────────────────────────────────────────────────
  let groupBy = $state(false);
  let collapsed = $state<Set<string>>(new Set());
  function toggleCat(key: string) {
    const s = new Set(collapsed);
    if (s.has(key)) s.delete(key); else s.add(key);
    collapsed = s;
  }
  type Group = { key: string; label: string; color: string; total: number; count: number; items: FinanceTxn[] };
  const grouped = $derived.by<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const t of txns) {
      const key = t.category || '__uncat__';
      let g = map.get(key);
      if (!g) {
        g = { key, label: key === '__uncat__' ? 'Uncategorized' : financeCategoryLabel(t.category), color: financeCategoryColor(t.category), total: 0, count: 0, items: [] };
        map.set(key, g);
      }
      g.total += t.amount || 0; g.count++; g.items.push(t);
    }
    return [...map.values()].sort((a, b) => a.total - b.total); // biggest spend first
  });

  // ── Export the filtered transactions to .xlsx ────────────────────────
  function exportXlsx() {
    if (txns.length === 0) return;
    const rows = txns.map((t) => ({
      Date: t.txn_date ?? '',
      Description: t.description ?? '',
      Detail: t.detail ?? '',
      Category: t.category ? financeCategoryLabel(t.category) : '',
      Amount: t.amount ?? 0,
      Account: t.account ?? '',
      Shared: t.shared ? 'Yes' : '',
      'Paid by': t.shared ? (t.paid_by === 'ex' ? 'Ex' : 'Me') : '',
      'Ex %': t.shared ? (t.share_ex_pct ?? 50) : '',
      Balance: t.balance ?? ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    XLSX.writeFile(wb, `finances-${from}_to_${to}.xlsx`);
  }

  function fmtDate(s?: string | null) {
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(d);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function rid(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

  // Keep a txn patched in both the display list and the shared-balance list.
  function patchLocal(id: number, patch: Partial<FinanceTxn>) {
    txns = txns.map((t) => (t.id === id ? { ...t, ...patch } : t));
    sharedTxns = sharedTxns.map((t) => (t.id === id ? { ...t, ...patch } : t));
  }
  async function refreshShared() {
    try { sharedTxns = await listFinanceTxns({ sharedOnly: true, limit: 5000 }); } catch { /* keep */ }
  }
  async function reloadList() {
    const uncategorized = category === '__uncat__';
    try { txns = await listFinanceTxns({ from, to, category: uncategorized ? null : (category || null), uncategorized, q, sharedOnly, account: account || null, sort: sortBy, limit: 3000 }); } catch { /* keep */ }
  }

  // ── Import ───────────────────────────────────────────────────────────
  let importing = $state(false);
  let importMsg = $state('');
  let fileEl: HTMLInputElement | null = $state(null);
  async function onFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    importing = true; importMsg = ''; error = '';
    try {
      const parsed = await parseLandsbankinn(await f.arrayBuffer());
      if (parsed.rowCount === 0) { importMsg = 'No transactions found in that file.'; return; }
      const rows = parsed.rows.map((r) => ({ ...r, category: applyFinanceRules(r.description, rules) }));
      const res = await importFinanceTxns(rows);
      importMsg = `Imported ${res.imported} new · skipped ${res.skipped} already there — account ${parsed.account || '?'} (${parsed.rowCount} rows in file).`;
      await reloadList();
      await refreshShared();
      accounts = await listFinanceAccounts().catch(() => accounts);
    } catch (err) {
      error = formatError(err);
    } finally {
      importing = false;
      if (fileEl) fileEl.value = '';
    }
  }

  // ── Per-row edits ──────────────────────────────────────────────────────
  async function setCategory(t: FinanceTxn, cat: string) {
    patchLocal(t.id, { category: cat || null });
    try { await updateFinanceTxn(t.id, { category: cat || null }); } catch (e) { error = formatError(e); }
  }
  async function toggleShared(t: FinanceTxn) {
    const shared = !t.shared;
    patchLocal(t.id, { shared });
    if (shared && !sharedTxns.some((x) => x.id === t.id)) sharedTxns = [...sharedTxns, { ...t, shared }];
    try { await updateFinanceTxn(t.id, { shared }); await refreshShared(); } catch (e) { error = formatError(e); }
  }
  async function setSplit(t: FinanceTxn, patch: Partial<FinanceTxn>) {
    patchLocal(t.id, patch);
    try { await updateFinanceTxn(t.id, patch); await refreshShared(); } catch (e) { error = formatError(e); }
  }
  async function removeTxn(t: FinanceTxn) {
    if (!confirm(`Delete "${t.description || 'transaction'}"?`)) return;
    if (t.recurring_group && confirm('This is part of a recurring series. Delete the whole series? (Cancel = just this one)')) {
      try { await deleteRecurringGroup(t.recurring_group); await reloadList(); await refreshShared(); } catch (e) { error = formatError(e); }
      return;
    }
    try {
      await deleteFinanceTxn(t.id);
      txns = txns.filter((x) => x.id !== t.id);
      sharedTxns = sharedTxns.filter((x) => x.id !== t.id);
    } catch (e) { error = formatError(e); }
  }

  // Make a categorization rule from a transaction's merchant text.
  async function makeRule(t: FinanceTxn) {
    const base = (t.description || '').split(',')[0].trim();
    const match = prompt('Auto-categorize transactions whose text contains:', base);
    if (!match || !match.trim()) return;
    const cat = t.category || prompt('Category value (e.g. groceries):') || '';
    if (!cat) return;
    try {
      const r = await createFinanceRule({ match_text: match.trim(), category: cat, sort: rules.length });
      rules = [...rules, r];
    } catch (e) { error = formatError(e); }
  }
  async function removeRule(id: number) {
    try { await deleteFinanceRule(id); rules = rules.filter((r) => r.id !== id); } catch (e) { error = formatError(e); }
  }

  // ── Bulk select / edit ──────────────────────────────────────────────────
  let selected = $state<Set<number>>(new Set());
  let bulkPaidBy = $state<'me' | 'ex'>('me');
  let bulkPct = $state(50);
  let bulkBusy = $state(false);
  const allSelected = $derived(txns.length > 0 && txns.every((t) => selected.has(t.id)));
  function toggleSel(id: number) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    selected = s;
  }
  function toggleAll() {
    selected = allSelected ? new Set() : new Set(txns.map((t) => t.id));
  }
  function clearSel() { selected = new Set(); }
  async function bulkApply(patch: Partial<FinanceTxn>, touchesShared = false) {
    const ids = [...selected];
    if (ids.length === 0) return;
    bulkBusy = true; error = '';
    try {
      await bulkUpdateFinanceTxns(ids, patch);
      const idset = new Set(ids);
      txns = txns.map((t) => (idset.has(t.id) ? { ...t, ...patch } : t));
      sharedTxns = sharedTxns.map((t) => (idset.has(t.id) ? { ...t, ...patch } : t));
      if (touchesShared) await refreshShared();
    } catch (e) { error = formatError(e); } finally { bulkBusy = false; }
  }
  const bulkSetCategory = (c: string) => bulkApply({ category: c || null });
  const bulkMarkShared = () => bulkApply({ shared: true, paid_by: bulkPaidBy, share_ex_pct: Number(bulkPct) }, true);
  const bulkUnshare = () => bulkApply({ shared: false }, true);

  // ── Settlements ────────────────────────────────────────────────────────
  let showSettle = $state(false);
  let sDate = $state(isoOf(new Date()));
  let sAmount = $state('');
  let sDir = $state<'ex_to_me' | 'me_to_ex'>('ex_to_me');
  let sNotes = $state('');
  async function addSettlement() {
    const amt = Number(sAmount);
    if (!amt || !sDate) return;
    try {
      const s = await createFinanceSettlement({ settle_date: sDate, amount: Math.abs(amt), direction: sDir, notes: sNotes.trim() || null });
      settlements = [s, ...settlements];
      sAmount = ''; sNotes = ''; showSettle = false;
    } catch (e) { error = formatError(e); }
  }
  async function removeSettlement(id: number) {
    try { await deleteFinanceSettlement(id); settlements = settlements.filter((x) => x.id !== id); } catch (e) { error = formatError(e); }
  }

  // ── Manual add (single + recurring) ──────────────────────────────────────
  let showAdd = $state(false);
  let addMode = $state<'single' | 'recurring'>('single');
  // single
  let mDate = $state(isoOf(new Date()));
  let mAmount = $state('');
  let mDesc = $state('');
  let mCat = $state('');
  let mShared = $state(false);
  let mExpense = $state(true); // sign helper
  async function addSingle() {
    const raw = Number(mAmount);
    if (!raw || !mDate || !mDesc.trim()) return;
    const amount = mExpense ? -Math.abs(raw) : Math.abs(raw);
    try {
      const t = await createFinanceTxn({
        txn_date: mDate, amount, description: mDesc.trim(), category: mCat || null,
        account: account || null, source: 'manual', dedup_key: rid('manual'),
        shared: mShared, paid_by: 'me', share_ex_pct: 50
      });
      txns = [t, ...txns];
      if (mShared) sharedTxns = [t, ...sharedTxns];
      mAmount = ''; mDesc = ''; showAdd = false;
    } catch (e) { error = formatError(e); }
  }
  // recurring
  let rAmount = $state('');
  let rDesc = $state('');
  let rCat = $state('');
  let rShared = $state(false);
  let rExpense = $state(true);
  let rFreq = $state<'monthly' | 'weekly'>('monthly');
  let rDay = $state(1);
  let rFrom = $state(`${data.year}-01-01`);
  let rTo = $state(`${data.year}-12-31`);
  const recurringDates = $derived.by<string[]>(() => {
    const out: string[] = [];
    if (!rFrom || !rTo) return out;
    const start = new Date(rFrom), end = new Date(rTo);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;
    if (rFreq === 'weekly') {
      const d = new Date(start);
      while (d <= end && out.length < 400) { out.push(isoOf(d)); d.setDate(d.getDate() + 7); }
    } else {
      const day = Math.min(Math.max(Number(rDay) || 1, 1), 28);
      let d = new Date(start.getFullYear(), start.getMonth(), day);
      if (d < start) d = new Date(start.getFullYear(), start.getMonth() + 1, day);
      while (d <= end && out.length < 400) { out.push(isoOf(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, day); }
    }
    return out;
  });
  let creatingSeries = $state(false);
  async function addRecurring() {
    const raw = Number(rAmount);
    const dates = recurringDates;
    if (!raw || !rDesc.trim() || dates.length === 0) return;
    const amount = rExpense ? -Math.abs(raw) : Math.abs(raw);
    const group = rid('rec');
    creatingSeries = true;
    try {
      for (const d of dates) {
        await createFinanceTxn({
          txn_date: d, amount, description: rDesc.trim(), category: rCat || null,
          account: account || null, source: 'recurring', dedup_key: rid('rec'),
          recurring_group: group, shared: rShared, paid_by: 'me', share_ex_pct: 50
        });
      }
      await reloadList();
      if (rShared) await refreshShared();
      rAmount = ''; rDesc = ''; showAdd = false;
    } catch (e) { error = formatError(e); } finally { creatingSeries = false; }
  }
</script>

<svelte:head><title>Personal finances · Hub</title></svelte:head>

<section class="space-y-5">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <div class="hero-eyebrow">Tools</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing:-0.03em;">Personal finances</h1>
    </div>
    <div class="flex items-center gap-2">
      <a class="btn-ghost" href="/tools/receipts"><Icon name="receipt" size={16} /> Receipts</a>
      <a class="btn-ghost" href="/tools/finances/categorize"><Icon name="filter" size={16} /> Categorize</a>
      <a class="btn-ghost" href="/tools/finances/insights"><Icon name="layers" size={16} /> Insights</a>
      <label class="btn-primary cursor-pointer">
        <Icon name="download" size={16} /> {importing ? 'Importing…' : 'Import statement'}
        <input bind:this={fileEl} type="file" accept=".xlsx,.xls" class="hidden" onchange={onFile} disabled={importing} />
      </label>
    </div>
  </header>

  {#if importMsg}
    <div class="rounded-[10px] border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-700">{importMsg}</div>
  {/if}
  {#if error}
    <div class="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
  {/if}

  <!-- Summary + ex balance -->
  <div class="grid gap-3 sm:grid-cols-3">
    <div class="card p-4">
      <div class="muted-label">Income · {data.year}</div>
      <div class="mt-1 font-display text-xl font-bold text-[color:var(--state-success)]">{formatISK(income)}</div>
    </div>
    <div class="card p-4">
      <div class="muted-label">Expense · {data.year}</div>
      <div class="mt-1 font-display text-xl font-bold text-[color:var(--state-danger)]">{formatISK(expense)}</div>
    </div>
    <div class="card p-4" style={`border-color:${balance >= 0 ? 'var(--state-success)' : 'var(--state-danger)'};`}>
      <div class="flex items-center justify-between gap-2">
        <div class="muted-label">{balance >= 0 ? 'Ex owes you' : 'You owe ex'}</div>
        <div class="flex items-center gap-2">
          <button class="text-[11px] text-brand hover:underline" onclick={() => (showSettle = !showSettle)}>Settle</button>
          <a class="text-[11px] text-brand hover:underline" href="/tools/finances/split">Dashboard →</a>
        </div>
      </div>
      <div class="mt-1 font-display text-xl font-bold" style={`color:${balance >= 0 ? 'var(--state-success)' : 'var(--state-danger)'};`}>
        {formatISK(Math.abs(balance))}
      </div>
    </div>
  </div>

  {#if showSettle}
    <div class="card space-y-3 p-4">
      <div class="card-title">Log a settlement</div>
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
          {#each settlements.slice(0, 6) as s (s.id)}
            <li class="flex items-center justify-between py-1.5">
              <span>{fmtDate(s.settle_date)} · {s.direction === 'ex_to_me' ? 'Ex → me' : 'Me → ex'} · {formatISK(s.amount)}{#if s.notes} · <span class="text-ink-400">{s.notes}</span>{/if}</span>
              <button class="nav-icon" aria-label="Delete settlement" onclick={() => removeSettlement(s.id)}><Icon name="x" size={14} /></button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <!-- Filters -->
  <div class="flex flex-wrap items-center gap-2">
    <input type="date" class="input max-w-[150px]" bind:value={from} title="From" />
    <span class="text-ink-400">–</span>
    <input type="date" class="input max-w-[150px]" bind:value={to} title="To" />
    <select class="input max-w-[160px]" bind:value={category}>
      <option value="">All categories</option>
      <option value="__uncat__">Uncategorized only</option>
      {#each FINANCE_CATEGORIES as c}<option value={c.value}>{c.label}</option>{/each}
    </select>
    <select class="input max-w-[170px]" bind:value={sortBy} title="Sort order">
      <option value="date">Newest first</option>
      <option value="amount_desc">Amount: high → low</option>
      <option value="amount_asc">Amount: low → high</option>
    </select>
    {#if accounts.length > 1}
      <select class="input max-w-[170px]" bind:value={account}>
        <option value="">All accounts</option>
        {#each accounts as a}<option value={a}>{a}</option>{/each}
      </select>
    {/if}
    <input type="text" class="input max-w-[200px] flex-1" placeholder="Search text…" bind:value={q} />
    <label class="inline-flex items-center gap-1.5 text-sm text-ink-600"><input type="checkbox" class="accent-brand" bind:checked={sharedOnly} /> Shared w/ ex</label>
    <button class="btn-ghost text-sm" onclick={() => (showAdd = !showAdd)}><Icon name="plus" size={14} /> Add entry</button>
  </div>

  <!-- Manual add panel -->
  {#if showAdd}
    <div class="card space-y-3 p-4">
      <div class="flex gap-2">
        <button class="chip-radio" class:is-selected={addMode === 'single'} onclick={() => (addMode = 'single')}>Single</button>
        <button class="chip-radio" class:is-selected={addMode === 'recurring'} onclick={() => (addMode = 'recurring')}>Recurring</button>
      </div>
      {#if addMode === 'single'}
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input type="date" class="input" bind:value={mDate} />
          <input type="number" class="input" placeholder="Amount (ISK)" bind:value={mAmount} />
          <select class="input" bind:value={mExpense}><option value={true}>Expense</option><option value={false}>Income</option></select>
          <select class="input" bind:value={mCat}><option value="">Category…</option>{#each FINANCE_CATEGORIES as c}<option value={c.value}>{c.label}</option>{/each}</select>
        </div>
        <input type="text" class="input" placeholder="Description" bind:value={mDesc} />
        <div class="flex items-center justify-between">
          <label class="inline-flex items-center gap-1.5 text-sm text-ink-600"><input type="checkbox" class="accent-brand" bind:checked={mShared} /> Shared with ex</label>
          <button class="btn-primary" onclick={addSingle} disabled={!Number(mAmount) || !mDesc.trim()}>Add</button>
        </div>
      {:else}
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input type="number" class="input" placeholder="Amount (ISK)" bind:value={rAmount} />
          <select class="input" bind:value={rExpense}><option value={true}>Expense</option><option value={false}>Income</option></select>
          <select class="input" bind:value={rFreq}><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select>
          {#if rFreq === 'monthly'}<input type="number" min="1" max="28" class="input" placeholder="Day" bind:value={rDay} />{:else}<span></span>{/if}
        </div>
        <input type="text" class="input" placeholder="Description (e.g. Rent, Electricity)" bind:value={rDesc} />
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input type="date" class="input" bind:value={rFrom} title="From" />
          <input type="date" class="input" bind:value={rTo} title="To" />
          <select class="input" bind:value={rCat}><option value="">Category…</option>{#each FINANCE_CATEGORIES as c}<option value={c.value}>{c.label}</option>{/each}</select>
          <label class="inline-flex items-center gap-1.5 text-sm text-ink-600"><input type="checkbox" class="accent-brand" bind:checked={rShared} /> Shared</label>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm text-ink-500">{recurringDates.length} entries will be created</span>
          <button class="btn-primary" onclick={addRecurring} disabled={creatingSeries || !Number(rAmount) || !rDesc.trim() || recurringDates.length === 0}>
            {creatingSeries ? 'Creating…' : `Create ${recurringDates.length}`}
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Transactions -->
  <div class="card overflow-hidden">
    <div class="card-header">
      <span class="card-title">
        <input type="checkbox" class="accent-brand" checked={allSelected} onchange={toggleAll} title="Select all" aria-label="Select all" />
        <Icon name="wallet" size={16} /> Transactions {#if loading}<span class="text-ink-400">· loading…</span>{/if}
      </span>
      <div class="flex items-center gap-2">
        <button class="btn-ghost text-xs" onclick={() => (groupBy = !groupBy)} title="Group by category">
          <Icon name="layers" size={14} /> {groupBy ? 'Ungroup' : 'Group'}
        </button>
        <button class="btn-ghost text-xs" onclick={exportXlsx} disabled={txns.length === 0} title="Export to Excel">
          <Icon name="download" size={14} /> Export
        </button>
        <span class="text-xs text-ink-400">{txns.length}</span>
      </div>
    </div>

    {#if selected.size > 0}
      <!-- Bulk action bar -->
      <div class="flex flex-wrap items-center gap-2 border-b border-surface-divider px-4 py-2 text-sm" style="background: var(--accent-alpha-10);">
        <span class="font-medium text-ink-900">{selected.size} selected</span>
        <select
          class="rounded-full border border-surface-border bg-surface-card px-2 py-1 text-xs"
          disabled={bulkBusy}
          onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) bulkSetCategory(v); (e.currentTarget as HTMLSelectElement).value = ''; }}
        >
          <option value="">Set category…</option>
          {#each FINANCE_CATEGORIES as c}<option value={c.value}>{c.label}</option>{/each}
        </select>
        <span class="text-ink-300">·</span>
        <span class="text-ink-500">Paid</span>
        <select class="rounded-md border border-surface-border bg-surface-card px-1.5 py-1 text-xs" bind:value={bulkPaidBy}>
          <option value="me">Me</option><option value="ex">Ex</option>
        </select>
        <span class="text-ink-500">ex</span>
        <input type="number" min="0" max="100" class="w-14 rounded-md border border-surface-border bg-surface-card px-1.5 py-1 text-xs" bind:value={bulkPct} />
        <span class="text-ink-500">%</span>
        <button class="btn-ghost text-xs" disabled={bulkBusy} onclick={bulkMarkShared}>Mark shared</button>
        <button class="btn-ghost text-xs" disabled={bulkBusy} onclick={bulkUnshare}>Unshare</button>
        <button class="ml-auto text-xs text-brand hover:underline" onclick={clearSel}>Clear</button>
      </div>
    {/if}

    {#snippet txnRow(t)}
      <li class="px-4 py-2.5" class:bg-surface-hover={selected.has(t.id)}>
        <div class="flex items-center gap-3">
          <input type="checkbox" class="accent-brand shrink-0" checked={selected.has(t.id)} onchange={() => toggleSel(t.id)} aria-label="Select transaction" />
          <div class="w-12 shrink-0 text-xs text-ink-400 tabular-nums">{fmtDate(t.txn_date)}</div>
          <a href={`/tools/finances/${t.id}`} class="min-w-0 flex-1 hover:underline" title="Open details">
            <div class="truncate text-sm font-medium text-ink-900">{t.description || '—'}</div>
            {#if t.detail}<div class="truncate text-[11px] text-ink-400">{t.detail}</div>{/if}
          </a>
          <select
            class="rounded-full border border-surface-border bg-surface-card px-2 py-1 text-xs"
            style={`color:${financeCategoryColor(t.category)};`}
            value={t.category ?? ''}
            onchange={(e) => setCategory(t, (e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">Uncategorized</option>
            {#each FINANCE_CATEGORIES as c}<option value={c.value}>{c.label}</option>{/each}
          </select>
          <div class="w-24 shrink-0 text-right text-sm font-semibold tabular-nums" style={`color:${(t.amount ?? 0) < 0 ? 'var(--state-danger)' : 'var(--state-success)'};`}>{formatISK(t.amount)}</div>
          <button class="nav-icon shrink-0" class:nav-icon-active={t.shared} title="Shared with ex" aria-label="Toggle shared" onclick={() => toggleShared(t)}><Icon name="users" size={14} /></button>
          <button class="nav-icon shrink-0" aria-label="Row actions" title="Make rule from this" onclick={() => makeRule(t)}><Icon name="filter" size={14} /></button>
          <button class="nav-icon shrink-0" aria-label="Delete" onclick={() => removeTxn(t)}><Icon name="trash" size={14} /></button>
        </div>
        {#if t.shared}
          <div class="mt-1.5 flex flex-wrap items-center gap-2 pl-[3.75rem] text-xs text-ink-500">
            <span>Paid by</span>
            <select class="rounded-md border border-surface-border bg-surface-card px-1.5 py-0.5 text-xs" value={t.paid_by ?? 'me'} onchange={(e) => setSplit(t, { paid_by: (e.currentTarget as HTMLSelectElement).value })}>
              <option value="me">Me</option><option value="ex">Ex</option>
            </select>
            <span>· Ex's share</span>
            <input type="number" min="0" max="100" class="w-16 rounded-md border border-surface-border bg-surface-card px-1.5 py-0.5 text-xs" value={t.share_ex_pct ?? 50} onchange={(e) => setSplit(t, { share_ex_pct: Number((e.currentTarget as HTMLInputElement).value) })} />
            <span>%</span>
          </div>
        {/if}
      </li>
    {/snippet}

    {#if txns.length === 0}
      <div class="px-4 pb-6 pt-2 text-sm text-ink-400">No transactions in range. Import a statement or add one manually.</div>
    {:else if groupBy}
      {#each grouped as g (g.key)}
        <div class="border-b border-surface-divider last:border-0">
          <button type="button" class="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-surface-hover" onclick={() => toggleCat(g.key)}>
            <Icon name="chevron-right" size={14} class={collapsed.has(g.key) ? 'text-ink-300' : 'rotate-90 text-ink-300'} />
            <span class="h-2.5 w-2.5 shrink-0 rounded-full" style={`background:${g.color};`}></span>
            <span class="text-sm font-medium text-ink-900">{g.label}</span>
            <span class="text-xs text-ink-400">{g.count}</span>
            <span class="ml-auto text-sm font-semibold tabular-nums" style={`color:${g.total < 0 ? 'var(--state-danger)' : 'var(--state-success)'};`}>{formatISK(g.total)}</span>
          </button>
          {#if !collapsed.has(g.key)}
            <ul class="divide-y divide-surface-divider border-t border-surface-divider">
              {#each g.items as t (t.id)}{@render txnRow(t)}{/each}
            </ul>
          {/if}
        </div>
      {/each}
    {:else}
      <ul class="divide-y divide-surface-divider">
        {#each txns as t (t.id)}{@render txnRow(t)}{/each}
      </ul>
    {/if}
  </div>

  <!-- Rules -->
  {#if rules.length}
    <div class="card p-4">
      <div class="card-title mb-2"><Icon name="filter" size={14} /> Auto-categorization rules</div>
      <div class="flex flex-wrap gap-2">
        {#each rules as r (r.id)}
          <span class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2 py-0.5 text-xs">
            <span class="font-medium">{r.match_text}</span> → {r.category}
            <button class="ml-0.5 text-ink-400 hover:text-ink-700" aria-label="Delete rule" onclick={() => removeRule(r.id)}><Icon name="x" size={11} /></button>
          </span>
        {/each}
      </div>
    </div>
  {/if}
</section>
