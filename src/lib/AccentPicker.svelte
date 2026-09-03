<script lang="ts">
  // Accent swatch row — shared by /welcome and Settings → Appearance.
  // Picking a swatch applies immediately (setAccent writes <html data-accent>),
  // so the page the picker sits on IS the preview.
  import { ACCENTS } from '$lib/profileCore';
  import { profile, setAccent } from '$lib/profile.svelte';
  import { theme } from '$lib/theme.svelte';

  // Paint each swatch with its value for the theme currently in effect —
  // light presets are mid tones, dark presets pastels, and showing the wrong
  // set would missell the choice.
  const swatchRgb = $derived((a: (typeof ACCENTS)[number]) =>
    theme.effective === 'dark' ? a.dark : a.light
  );
</script>

<div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent color">
  {#each ACCENTS as a (a.id)}
    {@const selected = profile.accent === a.id}
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      title={a.label}
      class="flex flex-col items-center gap-1 p-2 transition"
      style={`border: 1px solid ${selected ? 'var(--accent-electric)' : 'var(--border-subtle)'}; border-radius: var(--radius-md); background: ${selected ? 'var(--accent-alpha-10)' : 'transparent'};`}
      onclick={() => setAccent(a.id)}
    >
      <span
        class="h-7 w-7"
        style={`border-radius: 9999px; background: rgb(${swatchRgb(a)}); box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08);`}
      ></span>
      <span class="text-[10px] uppercase tracking-wider {selected ? 'text-ink-900' : 'text-ink-400'}"
        >{a.label}</span
      >
    </button>
  {/each}
</div>
