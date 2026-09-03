<script lang="ts">
  // Vertical bars over a categorical/time axis, grouped or stacked.
  // Dependency-free SVG, same idiom as campaigns/MetricsChart.svelte.
  //
  // Deliberate choices:
  //  • ONE y-scale, always. Two series of wildly different magnitude get two
  //    charts, never two axes — a second scale invents a correlation.
  //  • A 2px surface-coloured gap separates stacked segments and adjacent
  //    bars, instead of a stroke around each mark.
  //  • Rounded top corners only (4px), so the fill stays anchored to the
  //    baseline and short bars don't turn into lozenges.
  //  • Labels are selective: the group total sits above each bar; per-segment
  //    values live in the tooltip and the table view.
  import { axisTicks } from './metrics';

  type Series = { key: string; label: string; color: string };

  let {
    categories,
    series,
    /** values[categoryIndex][seriesIndex] */
    values,
    mode = 'grouped',
    height = 200,
    /** Formats the total above each bar and the tooltip figures. */
    format = (n: number) => String(n),
    /** Optional per-category click — used to drill into a cohort. */
    onpick
  }: {
    categories: string[];
    series: Series[];
    values: number[][];
    mode?: 'grouped' | 'stacked';
    height?: number;
    format?: (n: number) => string;
    onpick?: (index: number) => void;
  } = $props();

  // Geometry in user units; the SVG scales to its container width.
  const W = 720;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 22; // room for the total label above the tallest bar
  const AXIS_H = 26; // x-axis band — inside the viewBox, so it never clips
  const GAP = 2; // the surface gap, in user units

  const plotH = $derived(height - PAD_T - AXIS_H);
  const bandW = $derived((W - PAD_L - PAD_R) / Math.max(1, categories.length));
  const totals = $derived(values.map((row) => row.reduce((s, v) => s + (v || 0), 0)));
  const dataMax = $derived(
    Math.max(
      1,
      ...(mode === 'stacked' ? totals : values.flatMap((row) => row.map((v) => v || 0)))
    )
  );

  // Axis steps come from metrics.ts so the arithmetic is unit-tested; the
  // component only draws them.
  const axis = $derived(axisTicks(dataMax));
  const axisMax = $derived(axis.axisMax);
  const scale = $derived((v: number) => (v / axisMax) * plotH);

  // Bars occupy 68% of their band; the rest is breathing room.
  const barsW = $derived(bandW * 0.68);
  const barW = $derived(
    mode === 'stacked' ? barsW : Math.max(2, (barsW - GAP * (series.length - 1)) / series.length)
  );

  let hover = $state<{ ci: number; si: number } | null>(null);
  const hoveredLabel = $derived.by(() => {
    if (!hover) return '';
    const cat = categories[hover.ci] ?? '';
    const s = series[hover.si];
    if (!s) return cat;
    return `${cat} · ${s.label}: ${format(values[hover.ci]?.[hover.si] ?? 0)}`;
  });

  /** Rounded-top bar path: 4px radius on the top corners, square at the
   *  baseline. `r` shrinks for bars shorter than the radius. */
  function barPath(x: number, y: number, w: number, h: number): string {
    if (h <= 0) return '';
    const r = Math.min(4, w / 2, h);
    return `M ${x} ${y + h} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h} Z`;
  }

  // Gridlines on the step, values included so the axis is readable without a
  // tooltip. Solid hairlines only.
  const ticks = $derived(axis.ticks.map((value) => ({ f: value / axisMax, value })));
</script>

<div class="space-y-1">
  <svg
    viewBox={`0 0 ${W} ${height}`}
    class="h-auto w-full overflow-visible"
    role="img"
    aria-label={`Bar chart: ${series.map((s) => s.label).join(', ')} by ${categories.length} categories`}
    onmouseleave={() => (hover = null)}
  >
    <!-- Recessive solid hairlines. Never dashed: dashing reads as a threshold. -->
    {#each ticks as t (t.f)}
      {@const y = PAD_T + plotH - t.f * plotH}
      <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--viz-grid)" stroke-width="1" vector-effect="non-scaling-stroke" />
      {#if t.f > 0}
        <text x={PAD_L} y={y - 3} font-size="9" fill="var(--text-tertiary)" class="tabular-nums">{format(t.value)}</text>
      {/if}
    {/each}

    {#each categories as cat, ci (cat + ci)}
      {@const bandX = PAD_L + ci * bandW}
      {@const barsX = bandX + (bandW - barsW) / 2}
      <!-- One wide hit target per category: 24px+ even on a phone, and it
           carries the drill-through click. Two variants rather than
           conditional attributes, so the interactive one is a real button to
           both the a11y linter and a keyboard. -->
      {#if onpick}
        <rect
          x={bandX}
          y={PAD_T}
          width={bandW}
          height={plotH + AXIS_H}
          fill="transparent"
          style="cursor:pointer"
          role="button"
          tabindex="0"
          aria-label={`Open ${cat}`}
          onmouseenter={() => (hover = { ci, si: 0 })}
          onfocus={() => (hover = { ci, si: 0 })}
          onclick={() => onpick(ci)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onpick(ci); }
          }}
        />
      {:else}
        <rect
          x={bandX}
          y={PAD_T}
          width={bandW}
          height={plotH + AXIS_H}
          fill="transparent"
          role="presentation"
          onmouseenter={() => (hover = { ci, si: 0 })}
        />
      {/if}
      {#if mode === 'stacked'}
        {#each series as s, si (s.key)}
          {@const below = values[ci].slice(0, si).reduce((a, b) => a + (b || 0), 0)}
          {@const h = scale(values[ci][si] || 0)}
          {@const y = PAD_T + plotH - scale(below) - h}
          {#if h > 0}
            <path
              d={barPath(barsX, y, barsW, Math.max(0, h - (si > 0 ? GAP : 0)))}
              fill={s.color}
              opacity={hover && hover.ci === ci && hover.si !== si ? 0.55 : 1}
              role="graphics-symbol"
              aria-label={`${cat} ${s.label}: ${format(values[ci][si] || 0)}`}
              onmouseenter={() => (hover = { ci, si })}
            />
          {/if}
        {/each}
      {:else}
        {#each series as s, si (s.key)}
          {@const h = scale(values[ci][si] || 0)}
          {@const x = barsX + si * (barW + GAP)}
          {#if h > 0}
            <path
              d={barPath(x, PAD_T + plotH - h, barW, h)}
              fill={s.color}
              opacity={hover && hover.ci === ci && hover.si !== si ? 0.55 : 1}
              role="graphics-symbol"
              aria-label={`${cat} ${s.label}: ${format(values[ci][si] || 0)}`}
              onmouseenter={() => (hover = { ci, si })}
            />
          {/if}
        {/each}
      {/if}
      <!-- The one direct label: the group total. Text wears an ink token,
           never a series colour. -->
      {#if totals[ci] > 0}
        <text
          x={bandX + bandW / 2}
          y={PAD_T + plotH - (mode === 'stacked' ? scale(totals[ci]) : scale(Math.max(...values[ci]))) - 6}
          text-anchor="middle"
          font-size="10"
          font-weight="600"
          fill="var(--text-primary)"
          class="tabular-nums"
        >{format(totals[ci])}</text>
      {/if}
      <text
        x={bandX + bandW / 2}
        y={PAD_T + plotH + 15}
        text-anchor="middle"
        font-size="10"
        fill="var(--text-tertiary)"
        class="tabular-nums"
      >{cat}</text>
    {/each}

    <line
      x1={PAD_L}
      y1={PAD_T + plotH}
      x2={W - PAD_R}
      y2={PAD_T + plotH}
      stroke="var(--viz-axis)"
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    />
  </svg>

  <!-- Tooltip as text under the plot rather than a floating layer: on a phone
       a hover popover is unreachable, and this stays in the flow. aria-live so
       a screen reader hears the same thing a mouse user sees. -->
  <p class="min-h-[1.25rem] text-xs text-ink-500 tabular-nums" aria-live="polite">{hoveredLabel}</p>
</div>
