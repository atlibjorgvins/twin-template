<script lang="ts">
  // A KPI: one number, one label, one optional line of context.
  //
  // The number is the chart here — a one-bar bar chart would say less. It uses
  // proportional figures (not tabular-nums): equal-width digits make a large
  // standalone "121" look loose.
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';

  let {
    label,
    value,
    /** Second line: a denominator, a share, a caveat. */
    note = '',
    icon = undefined as IconName | undefined,
    /** Makes the tile a link — the drill-through into the underlying list. */
    href = '',
    /** Accent the value. Reserved for the one figure the page is about. */
    emphasis = false
  }: {
    label: string;
    value: string | number;
    note?: string;
    icon?: IconName;
    href?: string;
    emphasis?: boolean;
  } = $props();
</script>

<svelte:element
  this={href ? 'a' : 'div'}
  href={href || undefined}
  class="card flex min-w-0 flex-col gap-1 p-3 {href ? 'transition hover:border-brand/40' : ''}"
>
  <span class="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-400">
    {#if icon}<Icon name={icon} size={12} />{/if}
    <span class="truncate">{label}</span>
  </span>
  <span
    class="font-display text-2xl font-bold leading-none {emphasis ? 'text-brand' : 'text-ink-900'}"
  >{value}</span>
  {#if note}<span class="text-[11px] leading-snug text-ink-400">{note}</span>{/if}
</svelte:element>
