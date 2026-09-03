<script lang="ts">
  // Horizontal bars for a ranked single-series list — grants by fund, top
  // recipients. Rows are HTML, not SVG: the label is real selectable text, the
  // whole row is a 44px touch target, and long Icelandic fund names wrap
  // instead of being clipped by a viewBox.
  //
  // One series → one colour for every bar (slot 1). Shading bars darker-where-
  // bigger would double-encode the length in hue and burn the free channel.
  let {
    rows,
    /** Formats the value shown at the row end. */
    format = (n: number) => String(n),
    color = 'var(--viz-1)',
    /** Cap the list; the remainder is summarised rather than silently cut. */
    limit = 8,
    /** Optional drill-through per row. */
    href
  }: {
    rows: Array<{ label: string; value: number; sub?: string; id?: number }>;
    format?: (n: number) => string;
    color?: string;
    limit?: number;
    href?: (row: { label: string; value: number; id?: number }) => string | null;
  } = $props();

  const max = $derived(Math.max(1, ...rows.map((r) => r.value)));
  const shown = $derived(rows.slice(0, limit));
  const hidden = $derived(rows.slice(limit));
  const hiddenTotal = $derived(hidden.reduce((s, r) => s + r.value, 0));
</script>

<ul class="space-y-1.5">
  {#each shown as r (r.label)}
    {@const link = href?.(r) ?? null}
    <li>
      <svelte:element
        this={link ? 'a' : 'div'}
        href={link || undefined}
        class="block rounded-[8px] px-1 py-1.5 {link ? 'hover:bg-surface-hover' : ''}"
      >
        <div class="flex items-baseline justify-between gap-3 text-sm">
          <span class="min-w-0 truncate text-ink-900">{r.label}</span>
          <span class="shrink-0 text-ink-500 tabular-nums">{format(r.value)}</span>
        </div>
        <div class="mt-1 flex items-center gap-2">
          <!-- 6px track: a thin mark, not a saturated block. -->
          <div class="h-1.5 flex-1 rounded-full" style="background:var(--bg-tertiary)">
            <div
              class="h-1.5 rounded-full"
              style={`width:${Math.max(2, (r.value / max) * 100)}%;background:${color}`}
            ></div>
          </div>
          {#if r.sub}<span class="shrink-0 text-[11px] text-ink-400">{r.sub}</span>{/if}
        </div>
      </svelte:element>
    </li>
  {/each}
</ul>

{#if hidden.length > 0}
  <!-- Never truncate silently: a capped list that doesn't say so reads as
       "this is all of it". -->
  <p class="mt-2 text-xs text-ink-400">
    + {hidden.length} more, {format(hiddenTotal)} combined — full list in the table view and the export.
  </p>
{/if}
