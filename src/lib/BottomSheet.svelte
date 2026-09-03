<script lang="ts">
  /**
   * Adaptive surface: a bottom sheet on mobile, a centred modal on
   * desktop. The component picks the mode automatically from
   * `matchMedia('(max-width: 767.98px)')` and re-renders if the
   * viewport crosses the breakpoint while open.
   *
   * Mobile (sheet)
   *   - Slides up from the bottom with `fly` + cubicOut.
   *   - Grab-handle bar; drag down past 80px to dismiss.
   *   - Body padded with env(safe-area-inset-bottom).
   *
   * Desktop (modal)
   *   - Backdrop fades in; the card scales from 96 % with fade.
   *   - Centred horizontally + vertically, max-w-md so even short
   *     forms feel intentional.
   *   - Closes on backdrop click, × button, or Esc.
   */
  import { fly, fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';

  type Props = {
    open: boolean;
    title?: string;
    showClose?: boolean;
    /**
     * When true, the mobile sheet supports a two-step drag:
     *   - drag the handle UP past ~40 px → expand to ~88 vh,
     *     revealing more content below the fold.
     *   - drag DOWN past ~40 px while expanded → collapse back to
     *     compact (~50 vh).
     *   - drag DOWN past ~80 px while already compact → close.
     */
    expandable?: boolean;
    /**
     * Open already expanded. For a read-only detail sheet the compact step
     * is the wrong first impression: it caps the body at min(36vh, 280px),
     * which on an 812px phone showed 42% of the screen and still clipped
     * the content. Opening expanded uses the space; dragging down still
     * collapses to compact, so you keep the peek-at-the-calendar gesture.
     */
    initialExpanded?: boolean;
    onClose: () => void;
    children?: import('svelte').Snippet;
    /** Optional footer that stays pinned below the scrollable body —
     *  use for submit buttons so they remain reachable in compact mode
     *  even when the form's optional fields are clipped below the fold. */
    footer?: import('svelte').Snippet;
  };

  let { open, title = '', showClose = true, expandable = false, initialExpanded = false, onClose, children, footer }: Props = $props();

  // ── Breakpoint detection ───────────────────────────────────────────────
  let isMobile = $state(false);
  let mq: MediaQueryList | null = null;
  function applyMQ() { isMobile = mq?.matches ?? false; }
  onMount(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    mq = window.matchMedia('(max-width: 767.98px)');
    applyMQ();
    mq.addEventListener('change', applyMQ);
    return () => mq?.removeEventListener('change', applyMQ);
  });

  // ── Drag (mobile only) ─────────────────────────────────────────────────
  // Two-step gesture when `expandable`:
  //   compact ↘ drag-down 80px = close
  //   compact ↗ drag-up   40px = expand
  //   expanded ↘ drag-down 40px = collapse
  // When `expandable` is false, drag is dismiss-only (legacy behaviour).
  let dragStartY = 0;
  let dragDelta = $state(0);
  let dragging = $state(false);
  let expanded = $state(false);
  const CLOSE_THRESHOLD = 80;
  const EXPAND_THRESHOLD = 40;
  // Reset the expansion when the sheet is opened fresh — to whatever this
  // sheet's resting state is, not unconditionally compact.
  $effect(() => { if (open) expanded = expandable && initialExpanded; });
  function onHandleDown(e: PointerEvent) {
    dragging = true;
    dragDelta = 0;
    dragStartY = e.clientY;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onHandleMove(e: PointerEvent) {
    if (!dragging) return;
    const dy = e.clientY - dragStartY;
    if (expandable) {
      // Clamp upward drag while expanded — already at top.
      dragDelta = expanded && dy < 0 ? 0 : dy;
    } else {
      dragDelta = Math.max(0, dy);
    }
  }
  function onHandleUp() {
    if (!dragging) return;
    dragging = false;
    if (expandable) {
      if (expanded) {
        if (dragDelta >= EXPAND_THRESHOLD) expanded = false;
      } else {
        if (dragDelta <= -EXPAND_THRESHOLD) expanded = true;
        else if (dragDelta >= CLOSE_THRESHOLD) onClose();
      }
    } else {
      if (dragDelta >= CLOSE_THRESHOLD) onClose();
    }
    dragDelta = 0;
  }

  function onWindowKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={onWindowKey} />

{#if open}
  {#if isMobile}
    <!-- Backdrop. We extend it well past the viewport edges with
         negative offsets so the dim reaches into the safe-area inset
         above the header — without that, `viewport-fit=cover` lets
         the html background bleed through at the very top. -->
    <div
      class="fixed z-40 bg-ink-900/40"
      style="top: -200px; bottom: -200px; left: -200px; right: -200px;"
      onclick={onClose}
      role="presentation"
      transition:fade={{ duration: 200 }}
    ></div>

    <!-- Mobile bottom sheet.
         Outer wrapper owns Svelte's `fly` transition. Inner wrapper
         owns the drag-to-dismiss translate. The real soft drop
         shadow lives on the inner element — `shadow-pop` from the
         Tailwind config is just a 1px outline (Helga rule), so for
         overlay surfaces we apply a proper shadow inline. -->
    <div
      class="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[28rem] sm:max-w-[32rem]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      transition:fly={{ y: '100%', duration: 380, easing: cubicOut, opacity: 1 }}
    >
      <div
        class="rounded-t-[20px] bg-surface-card pb-safe-plus-2"
        style={`border: 1px solid var(--border-subtle); border-bottom: none; box-shadow: 0 -16px 40px rgba(0, 0, 0, 0.28); transform: translateY(${Math.max(0, dragDelta)}px); transition: ${dragging ? 'none' : 'transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1)'};`}
      >
        <div
          class="flex h-7 cursor-grab items-center justify-center active:cursor-grabbing"
          style="touch-action: none;"
          onpointerdown={onHandleDown}
          onpointermove={onHandleMove}
          onpointerup={onHandleUp}
          onpointercancel={onHandleUp}
          role="presentation"
          title={expandable ? (expanded ? 'Drag down to collapse, further to dismiss' : 'Drag up to reveal more, down to dismiss') : 'Drag down to dismiss'}
        >
          <!-- Handle grows slightly + flips to brand when dragging up to
               expand, giving haptic-style visual feedback. -->
          <span
            class="block h-1 w-9 rounded-full transition-all"
            style="background: {expandable && !expanded && dragging && dragDelta < -EXPAND_THRESHOLD / 2 ? 'var(--accent-electric)' : 'var(--border-strong)'}; width: {expandable && !expanded && dragging && dragDelta < 0 ? Math.min(4.5, 2.25 - dragDelta / 40) + 'rem' : '2.25rem'};"
            aria-hidden="true"
          ></span>
        </div>
        {#if title || showClose}
          <div class="flex items-center justify-between gap-2 px-4 pb-1">
            {#if title}
              <h2 class="font-display text-sm font-semibold" style="letter-spacing: -0.01em;">{title}</h2>
            {:else}
              <span></span>
            {/if}
            {#if showClose}
              <button type="button" class="text-ink-400 hover:text-ink-700" aria-label="Close" onclick={onClose}>
                <Icon name="x" size={16} />
              </button>
            {/if}
          </div>
        {/if}
        <!-- In expandable mode the compact ceiling is intentionally
             tight (≤ ~300 px) so any "More details" section the
             consumer renders sits below the fold — the drag-up gesture
             is what reveals it. Expanded snaps to a full 88vh. -->
        <div
          class="overflow-y-auto scroll-momentum px-4 pt-2 {footer ? 'pb-2' : 'pb-4'}"
          style="max-height: {expandable ? (expanded ? '78vh' : 'min(36vh, 280px)') : '85vh'}; transition: max-height 300ms cubic-bezier(0.32, 0.72, 0, 1);"
        >
          {#if children}{@render children()}{/if}
        </div>
        {#if footer}
          <!-- Pinned footer (e.g. submit row). Stays reachable even when
               the form body is clipped in compact mode. -->
          <div class="border-t border-surface-divider px-4 py-3 bg-surface-card">
            {@render footer()}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Desktop centred modal. Outer wrapper handles the backdrop fade +
         flex centring; inner card runs a noticeable scale + fade.
         Real drop-shadow inline (the Tailwind `shadow-pop` is a 1px
         outline per the Helga rule — overlays need actual depth). -->
    <!-- Backdrop covers everything via negative offsets so the dim
         reaches the very top of the page (above the safe-area inset). -->
    <div
      class="fixed z-50 flex items-center justify-center p-4 bg-ink-900/40"
      style="top: -200px; bottom: -200px; left: -200px; right: -200px;"
      role="presentation"
      onclick={onClose}
      transition:fade={{ duration: 280 }}
    >
      <div
        class="w-full max-w-md bg-surface-card"
        style="border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.32), 0 4px 16px rgba(0, 0, 0, 0.18);"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        tabindex="-1"
        transition:scale={{ duration: 320, start: 0.9, opacity: 0, easing: cubicOut }}
      >
        {#if title || showClose}
          <div class="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
            {#if title}
              <h2 class="font-display text-sm font-semibold" style="letter-spacing: -0.01em;">{title}</h2>
            {:else}
              <span></span>
            {/if}
            {#if showClose}
              <button type="button" class="text-ink-400 hover:text-ink-700" aria-label="Close" onclick={onClose}>
                <Icon name="x" size={16} />
              </button>
            {/if}
          </div>
        {/if}
        <div class="max-h-[70vh] overflow-y-auto px-4 {footer ? 'pb-2' : 'pb-4'} pt-1">
          {#if children}{@render children()}{/if}
        </div>
        {#if footer}
          <div class="border-t border-surface-divider px-4 py-3 bg-surface-card" style="border-radius: 0 0 var(--radius-lg) var(--radius-lg);">
            {@render footer()}
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/if}
