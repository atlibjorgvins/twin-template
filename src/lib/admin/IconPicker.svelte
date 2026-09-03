<script lang="ts">
  // Tiny icon picker for the admin surfaces. Dropdown lists every
  // available `IconName` with a live preview, so editors don't have to
  // remember the string keys. Backed by the same `Icon.svelte` so what
  // they see in the picker matches the rest of the app exactly.
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';

  type Props = {
    value: string | null | undefined;
    onChange: (next: string | null) => void;
    /** Allow clearing the icon (Activity kinds prefer emoji). */
    nullable?: boolean;
  };
  let { value, onChange, nullable = true }: Props = $props();

  // Hardcoded list mirroring src/lib/icon-types.ts. Updated together.
  const NAMES: IconName[] = [
    'home', 'search', 'bolt', 'users', 'building', 'calendar', 'tag',
    'chevron-right', 'chevron-left', 'plus', 'arrow-right', 'mail',
    'phone', 'globe', 'sparkles', 'settings', 'bell', 'move',
    'notebook', 'x',
    // Activity-kind glyphs added with the Helga-outline pass.
    'message-square', 'coffee', 'utensils', 'wine', 'footprints',
    'mic', 'check', 'clock', 'gift', 'flag',
    'graduation-cap', 'book-open', 'cake', 'hand-wave'
  ];

  let open = $state(false);
  function pick(name: string | null) {
    onChange(name);
    open = false;
  }
</script>

<div class="icon-picker" onkeydown={(e) => { if (e.key === 'Escape') open = false; }} role="presentation">
  <button
    type="button"
    class="inline-flex items-center gap-1.5 px-2 py-1 text-xs"
    style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: var(--text-primary);"
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-haspopup="listbox"
  >
    {#if value}
      <Icon name={value as IconName} size={14} />
      <span>{value}</span>
    {:else}
      <span class="text-ink-400">No icon</span>
    {/if}
    <span aria-hidden="true" style="font-size: 10px; color: var(--text-tertiary);">▾</span>
  </button>
  {#if open}
    <div
      role="listbox"
      class="icon-picker-popover"
      style="background: var(--bg-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); box-shadow: 0 8px 24px rgba(0,0,0,0.18);"
    >
      {#if nullable}
        <button
          type="button"
          class="block w-full px-2 py-1.5 text-left text-xs hover:bg-surface-hover"
          style="border-radius: var(--radius-sm); color: var(--text-tertiary);"
          onclick={() => pick(null)}
        >
          <span aria-hidden="true">—</span> Clear
        </button>
      {/if}
      <div class="grid grid-cols-5 gap-1 p-1">
        {#each NAMES as name (name)}
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center hover:bg-surface-hover"
            style={`border-radius: var(--radius-sm); ${value === name ? 'background: var(--accent-alpha-10); color: var(--accent-electric);' : 'color: var(--text-secondary);'}`}
            title={name}
            aria-label={name}
            onclick={() => pick(name)}
          >
            <Icon {name} size={14} />
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .icon-picker { position: relative; display: inline-block; }
  .icon-picker-popover {
    position: absolute;
    z-index: 30;
    margin-top: 4px;
    min-width: 14rem;
    max-width: 18rem;
  }
</style>
