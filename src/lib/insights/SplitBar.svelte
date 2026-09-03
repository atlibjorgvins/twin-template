<script lang="ts">
  // A single 100%-stacked bar — the right form for a part-to-whole with two or
  // three segments. Chosen over a donut deliberately: a donut makes close
  // shares (48/52) unreadable and wastes the space a label needs.
  //
  // Segments carry their own labels when they fit; a segment too narrow for
  // text gets its number in the row beneath instead of a clipped label. The
  // 2px surface gap does the separating, not a stroke.
  let {
    segments,
    /** Rendered under the bar, e.g. "205 people". */
    caption = '',
    height = 14
  }: {
    segments: Array<{ key: string; label: string; value: number; color: string }>;
    caption?: string;
    height?: number;
  } = $props();

  const total = $derived(segments.reduce((s, x) => s + x.value, 0));
  const parts = $derived(
    segments
      .filter((s) => s.value > 0)
      .map((s) => ({ ...s, share: total ? s.value / total : 0 }))
  );
</script>

<div class="space-y-2">
  <div class="flex w-full gap-[2px] overflow-hidden rounded-full" style={`height:${height}px`}>
    {#each parts as p (p.key)}
      <div
        class="h-full first:rounded-l-full last:rounded-r-full"
        style={`width:${(p.share * 100).toFixed(2)}%;background:${p.color}`}
        title={`${p.label}: ${p.value} (${(p.share * 100).toFixed(0)}%)`}
      ></div>
    {/each}
    {#if total === 0}
      <div class="h-full w-full rounded-full" style="background:var(--bg-tertiary)"></div>
    {/if}
  </div>

  <!-- Every value in text, so nothing depends on colour or hover. -->
  <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
    {#each segments as s (s.key)}
      <li class="inline-flex items-baseline gap-1.5">
        <span class="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={`background:${s.color}`}></span>
        <span class="text-ink-500">{s.label}</span>
        <span class="font-medium text-ink-900 tabular-nums">{s.value}</span>
        <span class="text-ink-400 tabular-nums">
          {total ? `${((s.value / total) * 100).toFixed(0)}%` : '—'}
        </span>
      </li>
    {/each}
  </ul>

  {#if caption}<p class="text-xs text-ink-400">{caption}</p>{/if}
</div>
