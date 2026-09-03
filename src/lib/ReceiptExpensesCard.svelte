<script lang="ts">
  // Expenses attributed to one project or one organization — the read side
  // of receipt tagging. Without this the org/project links set in the
  // receipts review screen are invisible everywhere they would matter, and
  // there is no reason for anyone to keep tagging.
  //
  // Deliberately read-only: editing belongs in /tools/receipts,
  // which already does it properly. This card answers "what has this project
  // cost so far, and what is the evidence" and links out for the rest.
  import Icon from '$lib/Icon.svelte';
  import {
    assetUrl,
    formatISK,
    formatError,
    listReceiptsFor,
    receiptTotals,
    type FinanceReceipt
  } from '$lib/directus';

  let {
    projectId = null,
    orgId = null,
    /** Rows shown before "see all"; the total always covers everything. */
    preview = 5,
    onCount
  }: { projectId?: number | null; orgId?: number | null; preview?: number; onCount?: (n: number) => void } = $props();

  let receipts = $state<FinanceReceipt[]>([]);
  let loaded = $state(false);

  $effect(() => { if (loaded) onCount?.(receipts.length); });
  let error = $state('');

  // Keyed on the id so the card refetches when the parent switches record
  // (the pages reuse the component across navigations).
  $effect(() => {
    const target = { projectId, orgId };
    loaded = false;
    void (async () => {
      try {
        receipts = await listReceiptsFor(target, 100);
        error = '';
      } catch (e) {
        error = formatError(e);
        receipts = [];
      } finally {
        loaded = true;
      }
    })();
  });

  const totals = $derived(receiptTotals(receipts));
  const shown = $derived(receipts.slice(0, preview));
  const fmtDate = (s?: string | null) => (s ? String(s).slice(0, 10) : '—');
</script>

<section class="card p-4">
  <div class="mb-3 flex items-center gap-2">
    <Icon name="receipt" size={16} />
    <h2 class="text-sm font-semibold text-ink-900">Expenses</h2>
    {#if loaded && totals.count > 0}
      <span class="text-xs text-ink-400">
        {totals.count} receipt{totals.count === 1 ? '' : 's'}
      </span>
    {/if}
    <a class="ml-auto text-[11px] text-brand hover:underline" href="/tools/receipts">
      Receipts →
    </a>
  </div>

  {#if error}
    <p class="text-sm text-rose-600">{error}</p>
  {:else if !loaded}
    <p class="text-sm text-ink-400">Loading…</p>
  {:else if totals.count === 0}
    <p class="text-sm text-ink-400">
      No receipts tagged yet. Assign one from the
      <a class="text-brand hover:underline" href="/tools/receipts">receipts review</a>.
    </p>
  {:else}
    <div class="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span class="text-xl font-semibold tabular-nums text-ink-900">{formatISK(totals.total)}</span>
      <!-- Say so when the total is incomplete. A number that silently omits
           receipts whose amount was never filled in is worse than no number. -->
      {#if totals.missingAmount > 0}
        <span class="text-xs text-amber-600">
          {totals.missingAmount} without an amount — total is incomplete
        </span>
      {/if}
      {#if totals.vsk > 0}
        <!-- The number that makes filing receipts pay for itself. -->
        <span class="text-xs text-ink-400">{formatISK(totals.vsk)} VSK</span>
      {/if}
      {#if totals.unlinked > 0}
        <span class="text-xs text-ink-400">{totals.unlinked} not matched to a transaction</span>
      {/if}
    </div>

    <ul class="divide-y divide-surface-border">
      {#each shown as r (r.id)}
        <li class="flex items-center gap-3 py-2">
          {#if r.image}
            <a
              href={assetUrl(r.image)}
              target="_blank"
              rel="noreferrer"
              class="shrink-0 overflow-hidden rounded border border-surface-border"
              title="Open the photo"
            >
              <img
                src={assetUrl(r.image, { width: 64, height: 64, fit: 'cover' })}
                alt="Receipt from {r.merchant || fmtDate(r.txn_date)}"
                class="h-8 w-8 object-cover object-top"
                width="32"
                height="32"
              />
            </a>
          {:else}
            <div class="grid h-8 w-8 shrink-0 place-items-center rounded border border-surface-border text-ink-400">
              <Icon name="image" size={12} />
            </div>
          {/if}
          <span class="w-20 shrink-0 text-xs text-ink-400 tabular-nums">{fmtDate(r.txn_date)}</span>
          <span class="min-w-0 flex-1 truncate text-sm text-ink-900">{r.merchant || '—'}</span>
          <span class="shrink-0 text-sm tabular-nums text-ink-900">
            {typeof r.amount === 'number' ? formatISK(r.amount) : '—'}
          </span>
        </li>
      {/each}
    </ul>

    {#if receipts.length > shown.length}
      <a class="mt-2 inline-block text-[11px] text-brand hover:underline" href="/tools/receipts">
        {receipts.length - shown.length} more →
      </a>
    {/if}
  {/if}
</section>
