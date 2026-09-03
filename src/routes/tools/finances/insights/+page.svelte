<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import {
    formatISK,
    financeCategoryColor,
    financeCategoryLabel,
    listFinanceTxns,
    listFinanceBudgets,
    setFinanceBudget,
    formatError,
    type FinanceTxn,
    type FinanceBudget
  } from '$lib/directus';
  import type { InsightsData } from './+page';

  let { data }: { data: InsightsData } = $props();
  let txns = $state<FinanceTxn[]>(data.txns);
  let budgets = $state<FinanceBudget[]>(data.budgets);
  let from = $state(data.from);
  let to = $state(data.to);
  let loading = $state(false);
  let error = $state('');

  let firstRun = true;
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const f = from, t = to;
    if (firstRun) { firstRun = false; return; }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      loading = true; error = '';
      try { txns = await listFinanceTxns({ from: f, to: t, limit: 5000 }); }
      catch (e) { error = formatError(e); } finally { loading = false; }
    }, 250);
  });

  const expenses = $derived(txns.filter((t) => (t.amount ?? 0) < 0));
  const totalExpense = $derived(expenses.reduce((s, t) => s + Math.abs(t.amount || 0), 0));
  const totalIncome = $derived(txns.filter((t) => (t.amount ?? 0) > 0).reduce((s, t) => s + (t.amount || 0), 0));
  const net = $derived(Math.round(totalIncome - totalExpense));

  // Spending by category (expenses only)
  type Cat = { key: string; label: string; color: string; spend: number; count: number; pct: number };
  const byCategory = $derived.by<Cat[]>(() => {
    const m = new Map<string, { spend: number; count: number }>();
    for (const t of expenses) {
      const key = t.category || '__uncat__';
      const c = m.get(key) ?? { spend: 0, count: 0 };
      c.spend += Math.abs(t.amount || 0); c.count++; m.set(key, c);
    }
    const total = totalExpense || 1;
    return [...m.entries()]
      .map(([key, v]) => ({ key, label: key === '__uncat__' ? 'Uncategorized' : financeCategoryLabel(key), color: financeCategoryColor(key === '__uncat__' ? null : key), spend: Math.round(v.spend), count: v.count, pct: Math.round((v.spend / total) * 100) }))
      .sort((a, b) => b.spend - a.spend);
  });

  // Monthly trend
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  type Mon = { label: string; expense: number; income: number };
  const byMonth = $derived.by<Mon[]>(() => {
    const arr = MONTHS.map((label) => ({ label, expense: 0, income: 0 }));
    for (const t of txns) {
      if (!t.txn_date) continue;
      const mi = new Date(t.txn_date).getMonth();
      if (Number.isNaN(mi)) continue;
      if ((t.amount ?? 0) < 0) arr[mi].expense += Math.abs(t.amount || 0);
      else arr[mi].income += t.amount || 0;
    }
    return arr.filter((m) => m.expense > 0 || m.income > 0);
  });
  const maxMonth = $derived(Math.max(1, ...byMonth.map((m) => Math.max(m.expense, m.income))));

  // Top merchants (by spend)
  type Merchant = { name: string; spend: number; count: number };
  const topMerchants = $derived.by<Merchant[]>(() => {
    const m = new Map<string, { spend: number; count: number }>();
    for (const t of expenses) {
      const name = (t.description || '—').split(',')[0].trim() || '—';
      const c = m.get(name) ?? { spend: 0, count: 0 };
      c.spend += Math.abs(t.amount || 0); c.count++; m.set(name, c);
    }
    return [...m.entries()].map(([name, v]) => ({ name, spend: Math.round(v.spend), count: v.count })).sort((a, b) => b.spend - a.spend).slice(0, 12);
  });

  const maxCat = $derived(Math.max(1, ...byCategory.map((c) => c.spend)));
  const maxMerchant = $derived(Math.max(1, ...topMerchants.map((m) => m.spend)));
  const monthsSpan = $derived(byMonth.length || 1);

  // Budgets (monthly). Compare each category's average monthly spend over the
  // selected range against its monthly target.
  const monthsInRange = $derived.by(() => {
    const f = new Date(from), t = new Date(to);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return 1;
    return Math.max(1, (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()) + 1);
  });
  const budgetMap = $derived(new Map(budgets.map((b) => [b.category, b.amount || 0])));
  type BudgetRow = { key: string; label: string; color: string; perMonth: number; budget: number };
  const budgetRows = $derived.by<BudgetRow[]>(() => {
    const spend = new Map(byCategory.map((c) => [c.key, c.spend]));
    const keys = new Set<string>([...spend.keys(), ...budgetMap.keys() as Iterable<string>]);
    return [...keys]
      .filter((k) => k && k !== '__uncat__')
      .map((key) => ({
        key,
        label: financeCategoryLabel(key),
        color: financeCategoryColor(key),
        perMonth: Math.round((spend.get(key) || 0) / monthsInRange),
        budget: budgetMap.get(key) || 0
      }))
      .sort((a, b) => (b.budget ? 1 : 0) - (a.budget ? 1 : 0) || b.perMonth - a.perMonth);
  });
  const budgetTotal = $derived(budgetRows.reduce((s, r) => s + r.budget, 0));
  const budgetedActual = $derived(budgetRows.filter((r) => r.budget > 0).reduce((s, r) => s + r.perMonth, 0));

  async function saveBudget(key: string, raw: string) {
    const amt = Math.max(0, Math.round(Number(raw) || 0));
    try {
      await setFinanceBudget(key, amt);
      budgets = amt > 0
        ? [...budgets.filter((b) => b.category !== key), { id: 0, category: key, amount: amt }]
        : budgets.filter((b) => b.category !== key);
    } catch (e) { error = formatError(e); }
  }

  // ── Trends ───────────────────────────────────────────────────────────
  // Per-month expense + per-category, so we can do month-over-month and a
  // cumulative line.
  type MonthCell = { expense: number; income: number; byCat: Map<string, number> };
  const monthsData = $derived.by<MonthCell[]>(() => {
    const arr: MonthCell[] = Array.from({ length: 12 }, () => ({ expense: 0, income: 0, byCat: new Map() }));
    for (const t of txns) {
      if (!t.txn_date) continue;
      const mi = new Date(t.txn_date).getMonth();
      if (Number.isNaN(mi)) continue;
      const amt = t.amount || 0;
      if (amt < 0) {
        arr[mi].expense += Math.abs(amt);
        const k = t.category || '__uncat__';
        arr[mi].byCat.set(k, (arr[mi].byCat.get(k) || 0) + Math.abs(amt));
      } else arr[mi].income += amt;
    }
    return arr;
  });
  const activeIdx = $derived(monthsData.map((m, i) => ({ m, i })).filter((x) => x.m.expense > 0 || x.m.income > 0).map((x) => x.i));
  const latestIdx = $derived(activeIdx.length ? activeIdx[activeIdx.length - 1] : -1);
  const prevIdx = $derived(activeIdx.length > 1 ? activeIdx[activeIdx.length - 2] : -1);
  const latestExpense = $derived(latestIdx >= 0 ? Math.round(monthsData[latestIdx].expense) : 0);
  const prevExpense = $derived(prevIdx >= 0 ? Math.round(monthsData[prevIdx].expense) : 0);
  const momPct = $derived(prevExpense > 0 ? Math.round(((latestExpense - prevExpense) / prevExpense) * 100) : null);

  type MoMCat = { key: string; label: string; color: string; cur: number; prev: number };
  const momCats = $derived.by<MoMCat[]>(() => {
    if (latestIdx < 0) return [];
    const cur = monthsData[latestIdx].byCat;
    const prev = prevIdx >= 0 ? monthsData[prevIdx].byCat : new Map<string, number>();
    const keys = new Set<string>([...cur.keys(), ...prev.keys()]);
    return [...keys].filter((k) => k !== '__uncat__')
      .map((k) => ({ key: k, label: financeCategoryLabel(k), color: financeCategoryColor(k), cur: Math.round(cur.get(k) || 0), prev: Math.round(prev.get(k) || 0) }))
      .sort((a, b) => b.cur - a.cur).slice(0, 6);
  });

  const cumulative = $derived.by(() => {
    let run = 0;
    return activeIdx.map((i) => { run += monthsData[i].expense; return { label: MONTHS[i], value: Math.round(run) }; });
  });
  const cumMax = $derived(Math.max(1, ...cumulative.map((p) => p.value)));
  // SVG polyline points over a 100×40 viewBox.
  const cumPoints = $derived(
    cumulative.map((p, i) => `${cumulative.length <= 1 ? 0 : (i / (cumulative.length - 1)) * 100},${40 - (p.value / cumMax) * 38}`).join(' ')
  );
  const latestLabel = $derived(latestIdx >= 0 ? MONTHS[latestIdx] : '');
  const prevLabel = $derived(prevIdx >= 0 ? MONTHS[prevIdx] : '');
</script>

<svelte:head><title>Spending insights · Finances</title></svelte:head>

<section class="space-y-5">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-3">
      <a href="/tools/finances" class="btn-ghost !px-2" aria-label="Back"><Icon name="chevron-left" size={20} /></a>
      <div>
        <div class="hero-eyebrow">Finances</div>
        <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing:-0.03em;">Spending insights</h1>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <a class="btn-ghost text-sm" href="/tools/finances/recurring"><Icon name="clock" size={14} /> Recurring</a>
      <input type="date" class="input max-w-[150px]" bind:value={from} />
      <span class="text-ink-400">–</span>
      <input type="date" class="input max-w-[150px]" bind:value={to} />
    </div>
  </header>

  {#if error}<div class="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>{/if}

  <!-- Totals -->
  <div class="grid gap-3 sm:grid-cols-4">
    <div class="card p-4"><div class="muted-label">Income</div><div class="mt-1 font-display text-lg font-bold text-[color:var(--state-success)]">{formatISK(totalIncome)}</div></div>
    <div class="card p-4"><div class="muted-label">Expense</div><div class="mt-1 font-display text-lg font-bold text-[color:var(--state-danger)]">{formatISK(totalExpense)}</div></div>
    <div class="card p-4"><div class="muted-label">Net</div><div class="mt-1 font-display text-lg font-bold" style={`color:${net >= 0 ? 'var(--state-success)' : 'var(--state-danger)'};`}>{formatISK(net)}</div></div>
    <div class="card p-4"><div class="muted-label">Avg spend / month</div><div class="mt-1 font-display text-lg font-bold text-ink-900">{formatISK(Math.round(totalExpense / monthsSpan))}</div></div>
  </div>

  {#if loading}<div class="text-sm text-ink-400">Loading…</div>{/if}

  {#if expenses.length === 0}
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card px-4 py-10 text-center text-sm text-ink-500">No spending in this range yet.</div>
  {:else}
    <!-- Monthly trend -->
    <div class="card p-4">
      <div class="card-title mb-3"><Icon name="bolt" size={16} /> Monthly spend</div>
      <div class="flex items-end gap-2" style="height: 140px;">
        {#each byMonth as m (m.label)}
          <div class="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div class="w-full rounded-t" style={`height:${(m.expense / maxMonth) * 110}px; background:var(--state-danger); min-height:2px;`} title={`${m.label}: ${formatISK(m.expense)}`}></div>
            <div class="text-[10px] text-ink-400">{m.label}</div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Trends -->
    {#if latestIdx >= 0}
      <div class="card p-4">
        <div class="card-title mb-3"><Icon name="arrow-right" size={16} /> Trends</div>
        <div class="grid gap-4 sm:grid-cols-2">
          <!-- This month vs last -->
          <div>
            <div class="text-xs text-ink-400">{latestLabel} vs {prevLabel || '—'}</div>
            <div class="mt-1 flex items-baseline gap-2">
              <span class="font-display text-xl font-bold text-ink-900">{formatISK(latestExpense)}</span>
              {#if momPct !== null}
                <span class="text-sm font-medium" style={momPct > 0 ? 'color:var(--state-danger)' : 'color:var(--state-success)'}>
                  {momPct > 0 ? '▲' : '▼'} {Math.abs(momPct)}%
                </span>
              {/if}
            </div>
            <div class="text-xs text-ink-400">was {formatISK(prevExpense)}</div>
            <ul class="mt-3 space-y-1">
              {#each momCats as c (c.key)}
                {@const diff = c.cur - c.prev}
                <li class="flex items-center justify-between gap-2 text-xs">
                  <span class="inline-flex min-w-0 items-center gap-1.5">
                    <span class="h-2 w-2 shrink-0 rounded-full" style={`background:${c.color};`}></span>
                    <span class="truncate">{c.label}</span>
                  </span>
                  <span class="shrink-0 tabular-nums">
                    {formatISK(c.cur)}
                    <span style={diff > 0 ? 'color:var(--state-danger)' : diff < 0 ? 'color:var(--state-success)' : 'color:var(--text-tertiary)'}>
                      {diff > 0 ? '▲' : diff < 0 ? '▼' : '·'}{diff !== 0 ? formatISK(Math.abs(diff)) : ''}
                    </span>
                  </span>
                </li>
              {/each}
            </ul>
          </div>
          <!-- Cumulative spend -->
          <div>
            <div class="text-xs text-ink-400">Cumulative spend</div>
            <div class="mt-1 font-display text-xl font-bold text-ink-900">{formatISK(cumMax)}</div>
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" class="mt-2 h-24 w-full">
              <polyline points={cumPoints} fill="none" stroke="var(--accent-electric)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
            </svg>
            <div class="flex justify-between text-[10px] text-ink-400">
              <span>{cumulative[0]?.label ?? ''}</span><span>{cumulative[cumulative.length - 1]?.label ?? ''}</span>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- By category -->
    <div class="card p-4">
      <div class="card-title mb-3"><Icon name="layers" size={16} /> Spending by category</div>
      <ul class="space-y-2.5">
        {#each byCategory as c (c.key)}
          <li>
            <div class="flex items-center justify-between text-sm">
              <a class="inline-flex min-w-0 items-center gap-2 hover:underline" href={c.key === '__uncat__' ? '/tools/finances/categorize' : `/tools/finances?cat=${c.key}`}>
                <span class="h-2.5 w-2.5 shrink-0 rounded-full" style={`background:${c.color};`}></span>
                <span class="truncate">{c.label}</span> <span class="shrink-0 text-xs text-ink-400">· {c.count}</span>
              </a>
              <span class="shrink-0 tabular-nums text-ink-700">{formatISK(c.spend)} <span class="text-ink-400">· {c.pct}%</span></span>
            </div>
            <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
              <div class="h-full rounded-full" style={`width:${Math.max(2, (c.spend / maxCat) * 100)}%; background:${c.color};`}></div>
            </div>
          </li>
        {/each}
      </ul>
    </div>

    <!-- Budgets (monthly) -->
    <div class="card p-4">
      <div class="mb-1 flex items-center justify-between">
        <span class="card-title"><Icon name="wallet" size={16} /> Budgets (monthly)</span>
        {#if budgetTotal > 0}<span class="text-xs tabular-nums" style={budgetedActual > budgetTotal ? 'color:var(--state-danger)' : 'color:var(--state-success)'}>{formatISK(budgetedActual)} / {formatISK(budgetTotal)}</span>{/if}
      </div>
      <p class="mb-3 text-[11px] text-ink-400">Average spend per month over this range vs your monthly target. Type a target to track a category.</p>
      <ul class="space-y-2.5">
        {#each budgetRows as r (r.key)}
          {@const over = r.budget > 0 && r.perMonth > r.budget}
          <li>
            <div class="flex items-center justify-between gap-2 text-sm">
              <span class="inline-flex min-w-0 items-center gap-2">
                <span class="h-2.5 w-2.5 shrink-0 rounded-full" style={`background:${r.color};`}></span>
                <span class="truncate">{r.label}</span>
              </span>
              <span class="flex shrink-0 items-center gap-2 text-xs">
                <span class="tabular-nums" style={over ? 'color:var(--state-danger)' : 'color:var(--text-secondary)'}>{formatISK(r.perMonth)}/mo</span>
                <span class="text-ink-300">of</span>
                <input type="number" min="0" step="1000" class="w-24 rounded-md border border-surface-border bg-surface-card px-1.5 py-1 text-right tabular-nums" value={r.budget || ''} placeholder="set…" onchange={(e) => saveBudget(r.key, (e.currentTarget as HTMLInputElement).value)} />
              </span>
            </div>
            {#if r.budget > 0}
              <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                <div class="h-full rounded-full" style={`width:${Math.min(100, (r.perMonth / r.budget) * 100)}%; background:${over ? 'var(--state-danger)' : 'var(--state-success)'};`}></div>
              </div>
              <div class="mt-0.5 text-[10px]" style={over ? 'color:var(--state-danger)' : 'color:var(--text-tertiary)'}>
                {over ? `${formatISK(r.perMonth - r.budget)} over` : `${formatISK(r.budget - r.perMonth)} left`} · {Math.round((r.perMonth / r.budget) * 100)}%
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>

    <!-- Top merchants -->
    <div class="card p-4">
      <div class="card-title mb-3"><Icon name="building" size={16} /> Top merchants</div>
      <ul class="space-y-2">
        {#each topMerchants as mch (mch.name)}
          <li class="flex items-center gap-3 text-sm">
            <span class="min-w-0 flex-1 truncate">{mch.name} <span class="text-xs text-ink-400">· {mch.count}×</span></span>
            <div class="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-hover sm:block">
              <div class="h-full rounded-full bg-brand" style={`width:${Math.max(4, (mch.spend / maxMerchant) * 100)}%;`}></div>
            </div>
            <span class="w-24 shrink-0 text-right tabular-nums font-medium text-ink-900">{formatISK(mch.spend)}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
