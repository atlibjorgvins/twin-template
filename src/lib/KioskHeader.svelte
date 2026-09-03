<script lang="ts">
  // The way out, for someone standing at a wall tablet.
  //
  // Deliberately heavier than the normal app header: big targets, plain
  // words, and only two of them. Someone who tapped a name on the display
  // and is now three pages deep needs "back" and "home" to be unmissable —
  // not a chevron tucked beside a breadcrumb.
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import { exitKiosk, kioskHref } from '$lib/kiosk.svelte';

  let { title = '' }: { title?: string } = $props();

  function back() {
    // history.back() rather than a fixed parent route: the funnel can be any
    // shape (person → org → project), so the only correct "one page back" is
    // the one the browser already knows about.
    if (history.length > 1) history.back();
    else void goto(kioskHref('/display'));
  }

  function home() {
    void goto(kioskHref('/display'));
  }

  function leave() {
    exitKiosk();
    void goto('/');
  }
</script>

<header class="kiosk-bar">
  <button class="kiosk-btn" onclick={back}>
    <Icon name="chevron-left" size={22} />
    <span>Back</span>
  </button>

  <button class="kiosk-btn" onclick={home}>
    <Icon name="home" size={20} />
    <span>Display</span>
  </button>

  {#if title}
    <span class="kiosk-title">{title}</span>
  {/if}

  <!-- An escape hatch out of kiosk mode itself, for when the tablet is
       picked up and used as a normal device. Quiet on purpose. -->
  <button class="kiosk-exit" onclick={leave} title="Use twin normally on this device">
    Exit kiosk
  </button>
</header>

<style>
  .kiosk-bar {
    position: sticky;
    top: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.7rem clamp(12px, 2vw, 24px);
    padding-top: calc(0.7rem + env(safe-area-inset-top));
    border-bottom: 1px solid var(--surface-border, #e5e5e5);
    background: var(--bg-primary, #fff);
  }
  .kiosk-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    /* 52px: a thumb on a wall tablet, not a mouse pointer. */
    min-height: 52px;
    padding: 0 1.1rem;
    border-radius: 12px;
    border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--bg-secondary, #f6f6f6);
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--ink-900, #111);
    cursor: pointer;
  }
  .kiosk-btn:active { transform: scale(0.98); }
  .kiosk-title {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1rem;
    color: var(--ink-500, #666);
  }
  .kiosk-exit {
    margin-left: auto;
    padding: 0.5rem 0.75rem;
    border: 0;
    background: transparent;
    font-size: 0.85rem;
    color: var(--ink-400, #888);
    cursor: pointer;
  }
</style>
