<script lang="ts">
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import Icon from '$lib/Icon.svelte';
  import { aiUsageSummary, AI_PROVIDERS, AI_TASKS, type AiUsage } from '$lib/directus';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Time window filter — client-side over the loaded rows.
  let range = $state<'7d' | '30d' | 'all'>('30d');
  const cutoff = $derived.by(() => {
    if (range === 'all') return 0;
    const days = range === '7d' ? 7 : 30;
    return Date.now() - days * 86_400_000;
  });
  const rows = $derived(
    (data.usage as AiUsage[]).filter((r) => {
      if (!cutoff) return true;
      const t = r.date_created ? new Date(r.date_created).getTime() : 0;
      return t >= cutoff;
    })
  );
  const summary = $derived(aiUsageSummary(rows));

  const providerLabel = (p: string) => AI_PROVIDERS.find((x) => x.value === p)?.label ?? p;
  const taskLabel = (t: string) => AI_TASKS.find((x) => x.slug === t)?.label ?? t;
  const fmtInt = (n: number) => new Intl.NumberFormat('en-GB').format(Math.round(n));
  const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
  const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);
  function fmtWhen(iso?: string | null) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }
</script>

<svelte:head><title>AI usage · Settings · Hub</title></svelte:head>

<section class="space-y-6">
  <SettingsSubpageHeader
    title="AI usage"
    subtitle="Requests, tokens, and estimated cost per provider and per task. Populated once tasks start making calls (recordAiUsage logs each one)."
  />

  <!-- Range -->
  <div class="inline-flex rounded-full border border-surface-border p-0.5 text-xs">
    {#each [['7d', '7 days'], ['30d', '30 days'], ['all', 'All time']] as const as [k, label]}
      <button
        class="rounded-full px-3 py-1 transition {range === k ? 'bg-brand text-white shadow-card' : 'text-ink-500 hover:text-ink-900'}"
        onclick={() => (range = k)}
      >{label}</button>
    {/each}
  </div>

  {#if rows.length === 0}
    <div class="rounded-[14px] border border-dashed border-surface-border px-4 py-10 text-center">
      <div class="mx-auto mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface-hover text-ink-400">
        <Icon name="layers" size={18} />
      </div>
      <p class="text-sm text-ink-600">No AI usage logged yet.</p>
      <p class="mx-auto mt-1 max-w-sm text-xs text-ink-400">
        Once a task calls a model, each request is recorded here — requests, input/output tokens, and estimated cost, broken down by provider and task.
      </p>
    </div>
  {:else}
    <!-- Totals -->
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {@render tile('Requests', fmtInt(summary.totals.calls), summary.totals.errors ? `${summary.totals.errors} failed` : 'all ok')}
      {@render tile('Input tokens', fmtTok(summary.totals.tokensIn))}
      {@render tile('Output tokens', fmtTok(summary.totals.tokensOut))}
      {@render tile('Est. cost', fmtUsd(summary.totals.cost))}
    </div>

    <!-- By provider -->
    <div class="space-y-2">
      <h2 class="font-display text-sm font-semibold text-ink-900">By provider</h2>
      {@render breakdown(summary.byProvider.map((r) => ({ ...r, name: providerLabel(r.key) })))}
    </div>

    <!-- By task -->
    <div class="space-y-2">
      <h2 class="font-display text-sm font-semibold text-ink-900">By task</h2>
      {@render breakdown(summary.byTask.map((r) => ({ ...r, name: taskLabel(r.key) })))}
    </div>

    <!-- Recent -->
    <div class="space-y-2">
      <h2 class="font-display text-sm font-semibold text-ink-900">Recent calls</h2>
      <div class="overflow-x-auto rounded-[12px] border border-surface-border">
        <table class="w-full min-w-[34rem] text-left text-xs">
          <thead class="text-ink-400">
            <tr class="border-b border-surface-divider">
              <th class="px-3 py-2 font-medium">When</th>
              <th class="px-3 py-2 font-medium">Task</th>
              <th class="px-3 py-2 font-medium">Model</th>
              <th class="px-3 py-2 text-right font-medium">In</th>
              <th class="px-3 py-2 text-right font-medium">Out</th>
              <th class="px-3 py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {#each rows.slice(0, 50) as r (r.id)}
              <tr class="border-b border-surface-divider/60 {r.ok === false ? 'text-tag-salesText' : 'text-ink-700'}">
                <td class="whitespace-nowrap px-3 py-1.5 tabular-nums">{fmtWhen(r.date_created)}</td>
                <td class="px-3 py-1.5">{taskLabel(r.task ?? '')}</td>
                <td class="px-3 py-1.5 font-mono text-[11px]">{r.model ?? '—'}</td>
                <td class="px-3 py-1.5 text-right tabular-nums">{fmtInt(r.tokens_in ?? 0)}</td>
                <td class="px-3 py-1.5 text-right tabular-nums">{fmtInt(r.tokens_out ?? 0)}</td>
                <td class="px-3 py-1.5 text-right tabular-nums">{fmtUsd(r.cost_usd ?? 0)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</section>

{#snippet tile(label: string, value: string, hint?: string)}
  <div class="rounded-[12px] border border-surface-border p-3">
    <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
    <div class="mt-0.5 font-display text-xl font-semibold text-ink-900 tabular-nums">{value}</div>
    {#if hint}<div class="text-[11px] text-ink-400">{hint}</div>{/if}
  </div>
{/snippet}

{#snippet breakdown(items: { name: string; calls: number; tokensIn: number; tokensOut: number; cost: number }[])}
  <ul class="divide-y divide-surface-divider rounded-[12px] border border-surface-border">
    {#each items as it (it.name)}
      <li class="flex items-center gap-3 px-3 py-2 text-sm">
        <span class="min-w-0 flex-1 truncate font-medium text-ink-900">{it.name}</span>
        <span class="text-[11px] text-ink-500 tabular-nums">{fmtInt(it.calls)} calls</span>
        <span class="text-[11px] text-ink-500 tabular-nums">{fmtTok(it.tokensIn)}/{fmtTok(it.tokensOut)} tok</span>
        <span class="w-16 text-right font-medium text-ink-900 tabular-nums">{fmtUsd(it.cost)}</span>
      </li>
    {/each}
  </ul>
{/snippet}
