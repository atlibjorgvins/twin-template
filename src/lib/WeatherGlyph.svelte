<script lang="ts">
  // Weather condition glyph. Lifted out of WeatherWidget so the Today chip and
  // the always-on display draw the same sky — the twin has no icon-set entry
  // for weather, these paths are hand-drawn, and a second hand-drawn copy
  // would diverge the first time one got tweaked.
  import { glyphOf } from '$lib/weather';

  let { code, size = 20 }: { code: number; size?: number } = $props();
  const g = $derived(glyphOf(code));
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width={size} height={size} aria-hidden="true">
  {#if g === 'sun'}
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  {:else if g === 'partly'}
    <path d="M12 3v1.5M5.6 5.6l1 1M3 12h1.5" />
    <circle cx="11" cy="10.5" r="3.2" />
    <path d="M8 19h8.5a3.5 3.5 0 0 0 .5-6.97A5 5 0 0 0 8.3 13.5 2.75 2.75 0 0 0 8 19Z" />
  {:else if g === 'cloud'}
    <path d="M7 18h9.5a4 4 0 0 0 .58-7.96A6 6 0 0 0 7.34 8.72 3.75 3.75 0 0 0 7 18Z" />
  {:else if g === 'fog'}
    <path d="M7 12h9.5a4 4 0 0 0 .58-7.96A6 6 0 0 0 7.34 2.72" />
    <path d="M4 16h16M6 19.5h12" />
  {:else if g === 'rain'}
    <path d="M7 14h9.5a4 4 0 0 0 .58-7.96A6 6 0 0 0 7.34 4.72 3.75 3.75 0 0 0 7 14Z" />
    <path d="M8 17.5l-1 2.5M12.5 17.5l-1 2.5M17 17.5l-1 2.5" />
  {:else if g === 'snow'}
    <path d="M7 14h9.5a4 4 0 0 0 .58-7.96A6 6 0 0 0 7.34 4.72 3.75 3.75 0 0 0 7 14Z" />
    <path d="M8 18.2h.01M12 20h.01M16 18.2h.01M10 21h.01M14 21h.01" />
  {:else if g === 'thunder'}
    <path d="M7 13h9.5a4 4 0 0 0 .58-7.96A6 6 0 0 0 7.34 3.72 3.75 3.75 0 0 0 7 13Z" />
    <path d="M12.5 13.5 10 18h3l-1.8 4" />
  {/if}
</svg>
