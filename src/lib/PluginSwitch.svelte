<script lang="ts">
  // The plugin on/off switch — shared by the Plugins list and detail pages.
  //
  // Optimistic: the knob flips the moment it is pressed (its own local state),
  // while applyAndReload commits the change and re-loads once the motion has
  // settled. Transitions name exact properties (transform / background-color)
  // with a strong ease-out — never `transition: all`.
  let {
    checked,
    label,
    onchange
  }: { checked: boolean; label: string; onchange: (next: boolean) => void } = $props();

  let visual = $state(checked);

  function press() {
    visual = !visual;
    onchange(visual);
  }
</script>

<button
  type="button"
  role="switch"
  aria-checked={visual}
  aria-label={label}
  onclick={press}
  class="plugin-switch relative inline-flex h-5 w-9 shrink-0 items-center rounded-full"
  style={`background: ${visual ? '#16A34A' : 'var(--bg-tertiary)'};`}
>
  <span
    class="plugin-switch-knob inline-block h-4 w-4 rounded-full bg-white"
    style={`transform: translateX(${visual ? '18px' : '2px'});`}
  ></span>
</button>

<style>
  .plugin-switch {
    transition:
      background-color 200ms ease,
      transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  .plugin-switch:active {
    transform: scale(0.94);
  }
  .plugin-switch-knob {
    transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
  }
  @media (prefers-reduced-motion: reduce) {
    .plugin-switch,
    .plugin-switch-knob {
      transition: none;
    }
  }
</style>
