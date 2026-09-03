<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import { formatISK, financeCategoryColor, detectRecurring, type FinanceTxn } from '$lib/directus';
  import type { RecurringData } from './+page';

  let { data }: { data: RecurringData } = $props();
  const txns = $state<FinanceTxn[]>(data.txns);

  const recurring = $derived(detectRecurring(txns));
  const monthlyTotal = $derived(recurring.reduce((s, r) => s + r.monthly, 0));
  const maxMonthly = $derived(Math.max(1, ...recurring.map((r) => r.monthly)));

  function fmtDate(s?: string | null) {
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(d);
  }
  const cadenceLabel: Record<string, string> = { weekly: 'Weekly', biweekly: 'Every 2 wks', monthly: 'Monthly' };
</script>

<svelte:head><title>Recurring · Finances</title></svelte:head>

<section class="space-y-5">
  <header class="flex items-center gap-3">
    <a href="/tools/finances/insights" class="btn-ghost !px-2" aria-label="Back to insights"><Icon name="chevron-left" size={20} /></a>
    <div>
      <div class="hero-eyebrow">Finances</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing:-0.03em;">Recurring & subscriptions</h1>
    </div>
  </header>

  <div class="grid gap-3 sm:grid-cols-2">
    <div class="card p-4">
      <div class="muted-label">Recurring / month</div>
      <div class="mt-1 font-display text-2xl font-bold text-[color:var(--state-danger)]">{formatISK(monthlyTotal)}</div>
      <div class="mt-1 text-xs text-ink-400">{recurring.length} repeating charges detected</div>
    </div>
    <div class="card p-4">
      <div class="muted-label">Annualised</div>
      <div class="mt-1 font-display text-2xl font-bold text-ink-900">{formatISK(monthlyTotal * 12)}</div>
      <div class="mt-1 text-xs text-ink-400">at the current cadence</div>
    </div>
  </div>

  {#if recurring.length === 0}
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card px-4 py-10 text-center text-sm text-ink-500">
      No clearly recurring charges found this year (looks for the same payee on a regular weekly/biweekly/monthly cadence, ≥3 times).
    </div>
  {:else}
    <div class="card divide-y divide-surface-divider">
      {#each recurring as r (r.merchant)}
        <a class="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover" href={`/tools/finances?q=${encodeURIComponent(r.merchant)}`}>
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" style={`background:${financeCategoryColor(r.category)};`}></span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-ink-900">{r.merchant}</div>
            <div class="text-xs text-ink-400">
              <span class="rounded-full bg-surface-hover px-1.5 py-0.5">{cadenceLabel[r.cadence]}</span>
              · {r.count}× · last {fmtDate(r.lastDate)} · ~{formatISK(r.typical)} each
            </div>
            <div class="mt-1 h-1 w-full max-w-[200px] overflow-hidden rounded-full bg-surface-hover">
              <div class="h-full rounded-full bg-brand" style={`width:${Math.max(4, (r.monthly / maxMonthly) * 100)}%;`}></div>
            </div>
          </div>
          <div class="shrink-0 text-right">
            <div class="text-sm font-semibold tabular-nums text-ink-900">{formatISK(r.monthly)}</div>
            <div class="text-[10px] text-ink-400">/ month</div>
          </div>
          <Icon name="chevron-right" size={14} class="shrink-0 text-ink-300" />
        </a>
      {/each}
    </div>
    <p class="text-xs text-ink-400">Detected by cadence — includes variable-amount monthly bills (utilities) as well as fixed subscriptions. Click one to see its transactions.</p>
  {/if}
</section>
