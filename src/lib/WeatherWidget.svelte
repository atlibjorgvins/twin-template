<script lang="ts">
  // Minimal weather chip for the Today hero. Collapsed: condition glyph +
  // current temperature. Tap → dropdown with current details and the next
  // few days. Data from Open-Meteo (free, keyless, CORS-open); position
  // from the browser's geolocation with a Reykjavík fallback when denied,
  // unavailable, or slow.
  import { onMount } from 'svelte';
  // Data + WMO code mapping live in $lib/weather so this chip and the
  // always-on tablet display cannot drift apart.
  import WeatherGlyph from '$lib/WeatherGlyph.svelte';
  import {
    loadWeather,
    labelOf,
    dayName,
    type Weather
  } from '$lib/weather';

  let open = $state(false);
  let weather = $state<Weather | null>(null);
  let place = $state<'Reykjavík' | 'Current location'>('Reykjavík');
  let error = $state(false);

  async function load() {
    const { weather: w, own } = await loadWeather();
    place = own ? 'Current location' : 'Reykjavík';
    weather = w;
  }

  onMount(() => {
    load().catch(() => {
      error = true;
    });
  });
</script>



{#if weather && !error}
  <div class="relative">
    <button
      type="button"
      class="flex cursor-pointer items-center gap-2 rounded-full border border-surface-border bg-surface-card px-4 py-2.5 text-ink-700 transition hover:bg-surface-hover"
      title="Weather — {labelOf(weather.code)}, {weather.temp}°"
      aria-label="Weather: {labelOf(weather.code)}, {weather.temp} degrees. Show details"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <WeatherGlyph code={weather.code} size={26} />
      <span class="font-display text-xl font-semibold tabular-nums" style="letter-spacing: -0.02em;">{weather.temp}°</span>
    </button>

    {#if open}
      <!-- Click-away backdrop, then the details card. -->
      <button
        type="button"
        class="fixed inset-0 z-20 cursor-default"
        aria-label="Close weather details"
        onclick={() => (open = false)}
      ></button>
      <div class="absolute right-0 z-30 mt-2 w-64 rounded-[14px] border border-surface-border bg-surface-card p-4 shadow-card">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">{place}</div>
            <div class="mt-1 flex items-center gap-2">
              <span class="text-ink-700"><WeatherGlyph code={weather.code} size={26} /></span>
              <span class="font-display text-2xl font-bold tabular-nums" style="letter-spacing: -0.02em;">{weather.temp}°</span>
            </div>
            <div class="mt-0.5 text-xs text-ink-500">{labelOf(weather.code)}</div>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
          <span>Feels {weather.feels}°</span>
          <span>Wind {weather.wind} m/s</span>
          {#if weather.precip > 0}<span>Precip {weather.precip} mm</span>{/if}
        </div>

        <ul class="mt-3 divide-y divide-surface-divider border-t border-surface-divider">
          {#each weather.days as d, i (d.date)}
            <li class="flex items-center gap-2 py-1.5 text-sm">
              <span class="w-12 shrink-0 text-xs text-ink-500">{dayName(d.date, i)}</span>
              <span class="text-ink-600"><WeatherGlyph code={d.code} size={16} /></span>
              <span class="ml-auto tabular-nums text-ink-400">{d.min}°</span>
              <span class="w-8 text-right tabular-nums font-medium text-ink-900">{d.max}°</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/if}
