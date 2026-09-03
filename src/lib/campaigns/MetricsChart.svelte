<script lang="ts">
  // Dependency-free trend chart for campaign metrics. Renders one or
  // more series over a shared set of date labels as smooth-ish polylines,
  // with the first series also drawn as a soft area fill. Each series is
  // normalised to its own maximum so shapes stay readable even when the
  // magnitudes differ wildly (spend in thousands vs results in tens).
  // Themed entirely through CSS variables; sized via a fixed viewBox so
  // it scales to its container width.

  type Series = { label: string; color: string; values: number[] };

  let {
    series,
    labels,
    height = 140
  }: { series: Series[]; labels: string[]; height?: number } = $props();

  const W = 600;
  const PAD_X = 8;
  const PAD_Y = 12;

  function path(values: number[]): { line: string; area: string } {
    const n = values.length;
    if (n === 0) return { line: '', area: '' };
    const max = Math.max(1, ...values);
    const innerW = W - PAD_X * 2;
    const innerH = height - PAD_Y * 2;
    const x = (i: number) => (n === 1 ? W / 2 : PAD_X + (i / (n - 1)) * innerW);
    const y = (v: number) => PAD_Y + innerH - (v / max) * innerH;
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const line = `M ${pts.join(' L ')}`;
    const area = `${line} L ${x(n - 1).toFixed(1)},${(height - PAD_Y).toFixed(1)} L ${x(0).toFixed(1)},${(height - PAD_Y).toFixed(1)} Z`;
    return { line, area };
  }

  const firstLast = $derived(
    labels.length > 0 ? [labels[0], labels[labels.length - 1]] : ['', '']
  );
</script>

<div class="space-y-1">
  <svg viewBox={`0 0 ${W} ${height}`} class="h-auto w-full" role="img" aria-label="Metrics trend">
    {#each series as s, si (s.label)}
      {@const p = path(s.values)}
      {#if si === 0 && p.area}
        <path d={p.area} fill={s.color} opacity="0.12" />
      {/if}
      {#if p.line}
        <path
          d={p.line}
          fill="none"
          stroke={s.color}
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      {/if}
    {/each}
  </svg>
  <div class="flex items-center justify-between text-[10px] text-ink-400">
    <span>{firstLast[0]}</span>
    <span class="flex items-center gap-3">
      {#each series as s (s.label)}
        <span class="inline-flex items-center gap-1">
          <span class="inline-block h-2 w-2 rounded-full" style={`background:${s.color}`}></span>
          {s.label}
        </span>
      {/each}
    </span>
    <span>{firstLast[1]}</span>
  </div>
</div>
