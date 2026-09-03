<script lang="ts">
  /**
   * Instagram-highlights-style horizontal row of circle buttons. Sits
   * below the dashboard hero on mobile (`md:hidden`) and replaces the
   * always-on Quick-capture / Log-an-interaction cards there. Each
   * circle's `onTap` writes the active sheet id back to the parent
   * via `bind:active`; the parent owns the BottomSheet bodies.
   *
   * Visual is Helga-restrained — no rainbow gradient, just a subtle
   * 1.5px border and an outline icon in the accent colour.
   */
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';

  type Highlight = {
    key: string;
    label: string;     // ≤ 9 chars to fit comfortably under the circle
    icon: IconName;
  };

  type Props = {
    items: Highlight[];
    /** Active sheet id (or null when nothing's open). */
    active: string | null;
    onActivate: (key: string) => void;
  };

  let { items, active, onActivate }: Props = $props();
</script>

<div class="highlights" role="toolbar" aria-label="Quick actions">
  {#each items as h (h.key)}
    <button
      type="button"
      class="highlight"
      aria-pressed={active === h.key}
      onclick={() => onActivate(h.key)}
    >
      <span
        class="highlight-circle"
        style={active === h.key
          ? 'border-color: var(--accent-electric); background: var(--accent-alpha-10);'
          : ''}
      >
        <Icon name={h.icon} size={22} />
      </span>
      <span class="highlight-label">{h.label}</span>
    </button>
  {/each}
</div>

<style>
  .highlights {
    display: flex;
    gap: 0.875rem;
    overflow-x: auto;
    overflow-y: hidden;
    /* Side padding so the first / last circle don't bump the viewport edges. */
    padding: 0.25rem 1rem 0.5rem;
    margin: 0 -1rem;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .highlights::-webkit-scrollbar { display: none; }

  .highlight {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    background: transparent;
    border: none;
    padding: 0.25rem 0;
    cursor: pointer;
    /* Stop browsers from treating long-press as text selection */
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  .highlight-circle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 9999px;
    border: 1.5px solid var(--border-subtle);
    background: var(--bg-secondary);
    color: var(--accent-electric);
    transition:
      transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1),
      background var(--transition-fast),
      border-color var(--transition-fast);
  }
  .highlight:active .highlight-circle { transform: scale(0.94); }

  .highlight-label {
    font-family: var(--font-display);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
    white-space: nowrap;
    max-width: 72px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
