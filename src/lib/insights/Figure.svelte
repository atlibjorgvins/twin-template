<script lang="ts">
  // The frame every chart on /insights sits in: title, optional legend, the
  // chart itself, and a table-view twin behind a toggle.
  //
  // The table is not a nicety. Two of the three series colours sit under 3:1
  // against the light surface, and a tooltip must never be the only way to
  // read a value — so every figure ships the same numbers as text, and the
  // CSV button hands you the same rows. One component so no chart can forget.
  import Icon from '$lib/Icon.svelte';
  import { downloadCsv, type CsvTable } from './export';
  import type { Snippet } from 'svelte';

  let {
    title,
    subtitle = '',
    /** Legend entries. Omitted for a single series — the title names it. */
    legend = [] as Array<{ label: string; color: string }>,
    /** Rows behind the chart, for the table view + CSV. */
    table,
    /** Filename stem for the CSV download. */
    filename = 'insights',
    /** Shown instead of the chart when there is nothing to plot. */
    empty = '',
    chart
  }: {
    title: string;
    subtitle?: string;
    legend?: Array<{ label: string; color: string }>;
    table: CsvTable;
    filename?: string;
    empty?: string;
    chart?: Snippet;
  } = $props();

  let showTable = $state(false);
  const hasRows = $derived(table.rows.length > 0);
</script>

<figure class="card p-4 space-y-3 print:break-inside-avoid">
  <!-- figcaption has to be a direct child of figure, so the header row is the
       caption itself rather than a div wrapping one. -->
  <figcaption class="flex flex-wrap items-start justify-between gap-2">
    <div class="min-w-0">
      <span class="card-title">{title}</span>
      {#if subtitle}
        <p class="mt-0.5 text-xs font-normal text-ink-400">{subtitle}</p>
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-1 print:hidden">
      <button
        type="button"
        class="chip-radio"
        class:is-selected={showTable}
        aria-pressed={showTable}
        onclick={() => (showTable = !showTable)}
      >
        <Icon name="list-checks" size={12} /> Table
      </button>
      <button
        type="button"
        class="chip-radio"
        disabled={!hasRows}
        title="Download these rows as CSV"
        onclick={() => downloadCsv(table, filename)}
      >
        <Icon name="download" size={12} /> CSV
      </button>
    </div>
  </figcaption>

  {#if legend.length > 1}
    <ul class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
      {#each legend as l (l.label)}
        <li class="inline-flex items-center gap-1.5">
          <span class="inline-block h-2.5 w-2.5 rounded-sm" style={`background:${l.color}`}></span>
          {l.label}
        </li>
      {/each}
    </ul>
  {/if}

  {#if !hasRows}
    <p class="py-6 text-center text-sm text-ink-400">{empty || 'Nothing to show for this filter.'}</p>
  {:else if showTable}
    <div class="overflow-x-auto">
      <table class="w-full text-sm tabular-nums">
        <thead>
          <tr class="border-b border-surface-border text-left text-xs uppercase tracking-wider text-ink-400">
            {#each table.columns as c (c)}
              <th class="py-1.5 pr-3 font-medium whitespace-nowrap">{c}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each table.rows as row, i (i)}
            <tr class="border-b border-surface-divider last:border-0">
              {#each row as cell, j (j)}
                <td class="py-1.5 pr-3 {j === 0 ? 'text-ink-900' : 'text-ink-500'} whitespace-nowrap">{cell}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    {@render chart?.()}
    <!-- Print gets the chart AND its numbers. On paper there is no hover, so
         a figure whose values live only in a tooltip prints as decoration. -->
    <div class="hidden print:block">
      <table class="w-full text-xs tabular-nums">
        <thead>
          <tr class="border-b text-left">
            {#each table.columns as c (c)}<th class="py-1 pr-2 font-medium">{c}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each table.rows as row, i (i)}
            <tr class="border-b">
              {#each row as cell, j (j)}<td class="py-1 pr-2">{cell}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</figure>
