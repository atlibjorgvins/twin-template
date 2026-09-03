<script lang="ts">
  /**
   * Fullscreen countdown. Helga typography, no menus, big tap target.
   * Tap the face → start / pause. Reset button + Esc both reset.
   *
   * Length is adjustable via an "edit mode" — tap the pencil button
   * to reveal a slider + number input + unit picker (sec / min / hr).
   * For free-form multi-segment schedules use `/schedule-timer`.
   */
  import { onDestroy } from 'svelte';
  import Icon from '$lib/Icon.svelte';

  let totalMs = $state(60_000);       // chosen length
  let remaining = $state(totalMs);    // ms left
  let running = $state(false);
  let endsAt = 0;                     // performance.now() target when running
  let tickHandle: ReturnType<typeof setInterval> | null = null;

  // ── Edit mode ──────────────────────────────────────────────────────────
  // Tapping "Adjust" enters edit mode. The value/unit drive `totalMs`
  // live (see the $effect below) so the face shows what'll run the
  // moment the user taps Start.
  type Unit = 'sec' | 'min' | 'hr';
  let editing = $state(false);
  let editValue = $state(60);
  let editUnit = $state<Unit>('sec');

  const UNIT_MS: Record<Unit, number> = {
    sec: 1_000,
    min: 60_000,
    hr: 3_600_000
  };
  const UNIT_LABEL: Record<Unit, string> = { sec: 'sec', min: 'min', hr: 'hr' };
  // Slider range + step chosen so each unit's slider has a useful
  // resolution. The text input accepts the same range.
  const UNIT_RANGE: Record<Unit, { min: number; max: number; step: number }> = {
    sec: { min: 5,  max: 600,  step: 5 },   // 5s … 10min, 5s increments
    min: { min: 1,  max: 180,  step: 1 },   // 1min … 3hr
    hr:  { min: 1,  max: 12,   step: 1 }    // 1hr … 12hr
  };

  function startEdit() {
    // Seed the editor from the current totalMs, picking the unit
    // that produces the cleanest round number.
    if (totalMs >= UNIT_MS.hr && totalMs % UNIT_MS.hr === 0) {
      editUnit = 'hr'; editValue = totalMs / UNIT_MS.hr;
    } else if (totalMs >= UNIT_MS.min && totalMs % UNIT_MS.min === 0) {
      editUnit = 'min'; editValue = totalMs / UNIT_MS.min;
    } else {
      editUnit = 'sec'; editValue = Math.max(1, Math.round(totalMs / UNIT_MS.sec));
    }
    editing = true;
  }
  function endEdit() { editing = false; }
  function changeUnit(u: Unit) {
    // Preserve the wall-clock duration when the unit changes — e.g.
    // 120 sec stays as 2 min when the user swaps sec → min.
    const ms = editValue * UNIT_MS[editUnit];
    editUnit = u;
    const r = UNIT_RANGE[u];
    editValue = Math.min(r.max, Math.max(r.min, Math.round(ms / UNIT_MS[u])));
  }
  function clampEditValue() {
    const r = UNIT_RANGE[editUnit];
    if (!Number.isFinite(editValue)) editValue = r.min;
    editValue = Math.min(r.max, Math.max(r.min, Math.round(editValue)));
  }

  // Live-bind totalMs to the editor state while in edit mode. We only
  // touch `remaining` when the timer isn't running so we don't
  // hijack an active countdown — but that's a no-op in practice
  // because the editor surface is hidden when running.
  $effect(() => {
    if (!editing) return;
    const ms = Math.max(0, editValue) * UNIT_MS[editUnit];
    if (ms > 0 && ms !== totalMs) {
      totalMs = ms;
      if (!running) remaining = ms;
    }
  });

  // Sub-minute lengths read better as `seconds.tenths`. Anything 60s+
  // switches to `MM:SS` and we drop the tenths — they're noise at
  // that scale.
  const longForm = $derived(totalMs > 60_000);

  // Derived display.
  const display = $derived.by(() => {
    const ms = Math.max(0, remaining);
    if (longForm) {
      // Round up so we never show "0:00" while a tick is still pending.
      const totalSec = Math.ceil(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return {
        primary: `${m}:${String(s).padStart(2, '0')}`,
        secondary: '',
        done: ms === 0
      };
    }
    const wholeSec = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);
    return {
      primary: String(wholeSec),
      secondary: `.${tenths}`,
      done: ms === 0
    };
  });
  // Progress 0…1 for the ring (ring fills as time runs out).
  const progress = $derived(1 - Math.max(0, remaining) / totalMs);


  function startTicker() {
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = setInterval(() => {
      if (!running) return;
      const left = endsAt - performance.now();
      if (left <= 0) {
        remaining = 0;
        running = false;
        if (tickHandle) clearInterval(tickHandle);
        tickHandle = null;
        // Vibrate on phones that support it — short triple-buzz.
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate?.([120, 60, 120, 60, 120]); } catch { /* ignore */ }
        }
        return;
      }
      remaining = left;
    }, 50);
  }
  onDestroy(() => { if (tickHandle) clearInterval(tickHandle); });

  function toggle() {
    if (display.done) {
      reset();
      return;
    }
    if (running) {
      running = false;
      remaining = Math.max(0, endsAt - performance.now());
      if (tickHandle) clearInterval(tickHandle);
      tickHandle = null;
    } else {
      running = true;
      endsAt = performance.now() + remaining;
      startTicker();
    }
  }
  function reset() {
    running = false;
    remaining = totalMs;
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = null;
  }

  // Toggle a global attribute on <html> while the timer is running so
  // the surrounding chrome (header, bottom nav, page eyebrow) can
  // fade out via CSS. Cleared on stop and on page destroy so the
  // chrome never gets stuck dim.
  $effect(() => {
    if (typeof document === 'undefined') return;
    if (running) document.documentElement.setAttribute('data-timer-active', 'true');
    else document.documentElement.removeAttribute('data-timer-active');
  });
  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.removeAttribute('data-timer-active');
    }
  });

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape' || e.key.toLowerCase() === 'r') { e.preventDefault(); reset(); }
  }

  // Ring geometry — SVG circle drawn as a stroked path. Viewport-
  // relative inside the CSS, but the underlying SVG numbers stay
  // unitless (we just pick a tidy 200px radius inside a 480px box
  // and let CSS scale the rendered element).
  const RING_R = 200;
  const RING_C = $derived(2 * Math.PI * RING_R);
  const dashOffset = $derived(RING_C * (1 - progress));
</script>

<svelte:head>
  <title>Timer · Hub</title>
</svelte:head>

<svelte:window onkeydown={onWindowKey} />

<section class="timer-wrap">
  <!-- Top eyebrow + reset. Marked `timer-chrome` so the CSS fade
       rule (when running) catches them along with the layout's
       header / bottom nav. -->
  <div class="timer-head timer-chrome">
    <div class="hero-eyebrow">Countdown</div>
    <button
      type="button"
      class="timer-reset"
      onclick={reset}
      disabled={remaining === totalMs && !running}
      aria-label="Reset"
    >
      <Icon name="x" size={14} />
      <span>Reset</span>
    </button>
  </div>

  <!-- Length editor. Collapsed: a single "Adjust" pill that tells
       you the current length. Expanded: unit segmented control +
       slider + number input, all live-bound to `totalMs`. Sits
       among the chrome so it fades while the timer's running. -->
  {#if !editing}
    <button
      type="button"
      class="timer-adjust timer-chrome"
      onclick={startEdit}
      aria-label="Adjust timer length"
      disabled={running}
    >
      <Icon name="settings" size={12} />
      <span>Adjust · {Math.round(totalMs / 1000)}s</span>
    </button>
  {:else}
    <div class="timer-editor timer-chrome">
      <!-- Unit segmented control -->
      <div class="timer-unit-row" role="radiogroup" aria-label="Unit">
        {#each (['sec', 'min', 'hr'] as Unit[]) as u (u)}
          {@const selected = editUnit === u}
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            class="timer-unit"
            style={selected
              ? 'background: var(--accent-electric); color: var(--accent-text);'
              : ''}
            onclick={() => changeUnit(u)}
          >{UNIT_LABEL[u]}</button>
        {/each}
      </div>

      <!-- Slider -->
      <input
        type="range"
        class="timer-slider"
        min={UNIT_RANGE[editUnit].min}
        max={UNIT_RANGE[editUnit].max}
        step={UNIT_RANGE[editUnit].step}
        bind:value={editValue}
        aria-label={`Length in ${UNIT_LABEL[editUnit]}`}
      />

      <!-- Number input + done -->
      <div class="timer-input-row">
        <label class="timer-number">
          <input
            type="number"
            min={UNIT_RANGE[editUnit].min}
            max={UNIT_RANGE[editUnit].max}
            step={UNIT_RANGE[editUnit].step}
            bind:value={editValue}
            onblur={clampEditValue}
            onkeydown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); endEdit(); } }}
          />
          <span class="timer-unit-tag">{UNIT_LABEL[editUnit]}</span>
        </label>
        <button type="button" class="timer-done" onclick={endEdit}>Done</button>
      </div>
    </div>
  {/if}

  <!-- Big tappable countdown surface. -->
  <button
    type="button"
    class="timer-face"
    class:done={display.done}
    onclick={toggle}
    aria-label={running ? 'Pause' : display.done ? 'Reset' : 'Start'}
  >
    <svg
      class="timer-ring"
      viewBox="-240 -240 480 480"
      aria-hidden="true"
    >
      <circle
        cx="0" cy="0" r={RING_R}
        fill="none"
        stroke="var(--border-subtle)"
        stroke-width="4"
      />
      <circle
        cx="0" cy="0" r={RING_R}
        fill="none"
        stroke="var(--accent-electric)"
        stroke-width="6"
        stroke-linecap="round"
        stroke-dasharray={RING_C}
        stroke-dashoffset={dashOffset}
        transform="rotate(-90)"
        style="transition: stroke-dashoffset 100ms linear;"
      />
    </svg>

    <div class="timer-digits">
      <span class="timer-stack" class:timer-stack-long={longForm}>
        <span class="timer-sec tabular-nums">{display.primary}</span>
        {#if display.secondary}
          <span class="timer-tenths tabular-nums">{display.secondary}</span>
        {/if}
      </span>
    </div>

    <div class="timer-state">
      {#if display.done}
        Done — tap to reset
      {:else if running}
        Pause
      {:else if remaining === totalMs}
        Tap to start
      {:else}
        Tap to resume
      {/if}
    </div>
  </button>

  <p class="timer-hint timer-chrome">Space starts / pauses · R resets</p>
</section>

<style>
  /* Full-bleed surface — the layout's `<main>` provides padding we
     don't want here, so the wrapper pushes back with negative margins
     and re-imposes its own centring. */
  .timer-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    margin: -2rem -1rem 0;   /* counter `main`'s px-4 py-5 */
    padding: 1rem 1.25rem 3rem;
    min-height: calc(100dvh - 8rem);
  }

  .timer-head {
    width: 100%;
    max-width: 32rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .timer-reset {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.7rem;
    font-family: var(--font-display);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }
  .timer-reset:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  .timer-reset:disabled { opacity: 0.4; cursor: default; }

  /* Collapsed "Adjust" pill — same shape as the reset button so the
     two read as the same control vocabulary. */
  .timer-adjust {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.85rem;
    font-family: var(--font-display);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }
  .timer-adjust:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  .timer-adjust:disabled { opacity: 0.4; cursor: default; }

  /* Expanded editor — sits above the face. Three rows: unit toggle,
     slider, number input + Done. */
  .timer-editor {
    width: 100%;
    max-width: 28rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.85rem 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
  }
  .timer-unit-row {
    display: inline-flex;
    align-self: center;
    padding: 2px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }
  .timer-unit {
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.25rem 0.75rem;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    border-radius: calc(var(--radius-md) - 2px);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }
  .timer-slider {
    width: 100%;
    accent-color: var(--accent-electric);
  }
  .timer-input-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .timer-number {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 0.25rem 0.65rem;
  }
  .timer-number input {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 18px;
    width: 4rem;
    background: transparent;
    border: none;
    color: var(--text-primary);
    text-align: right;
    outline: none;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .timer-number input::-webkit-outer-spin-button,
  .timer-number input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .timer-unit-tag {
    font-family: var(--font-display);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
  }
  .timer-done {
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.04em;
    padding: 0.4rem 0.95rem;
    background: var(--accent-electric);
    color: var(--accent-text);
    border: none;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .timer-done:hover { background: var(--accent-electric-hover); }

  /* While the timer is running, fade everything BUT the face. The
     `:global()` selectors reach into the layout chrome (header,
     bottom nav, desktop sidebar). Stays interactive — opacity-only,
     no pointer-events lockout — so the user can still tap the
     header search or back-out if they need to. */
  :global(html[data-timer-active='true']) :global(header),
  :global(html[data-timer-active='true']) :global(nav),
  :global(html[data-timer-active='true']) :global(aside) {
    opacity: 0.12;
    transition: opacity 600ms ease;
  }
  :global(html[data-timer-active='true']) .timer-chrome {
    opacity: 0.12;
    transition: opacity 600ms ease;
  }
  /* Bring chrome back smoothly when the timer pauses. */
  :global(html) :global(header),
  :global(html) :global(nav),
  :global(html) :global(aside),
  .timer-chrome {
    transition: opacity 400ms ease;
  }

  /* The big tappable face. Acts as the start/pause button and
     hosts the ring + digits + state caption. Size scales with the
     viewport so it fills mobile and laptop screens alike — capped
     so it never overflows the tab strip / header. */
  .timer-face {
    position: relative;
    width: min(80vmin, 640px);
    height: min(80vmin, 640px);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .timer-face:active { transform: scale(0.97); }

  .timer-ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  /* Outer wrapper: grid-centre both axes inside the square so the
     digit stack lands on the circle's centre regardless of width. */
  .timer-digits {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  /* Inner stack: keeps the tenths anchored to the seconds' baseline
     while the whole stack is centred as one unit by the grid above.
     `translateY(-3%)` optically lifts the digits — Space Grotesk's
     metrics leave a touch more empty space below the baseline than
     above the cap-line, so a tiny upward nudge looks more "centred"
     to the eye than geometric perfection. */
  .timer-stack {
    display: inline-flex;
    align-items: baseline;
    line-height: 1;
    transform: translateY(-3%);
  }
  .timer-sec {
    font-family: var(--font-display);
    font-weight: 700;
    /* ~40% of the face — keeps two digits comfortably inside. */
    font-size: min(32vmin, 256px);
    line-height: 1;
    letter-spacing: -0.06em;
    color: var(--text-primary);
  }
  /* MM:SS form has up to 5 glyphs ("30:00"), so we trim the size so
     the colon doesn't push the row past the ring's interior. */
  .timer-stack-long .timer-sec {
    font-size: min(20vmin, 160px);
    letter-spacing: -0.04em;
  }
  .timer-tenths {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: min(8vmin, 64px);
    line-height: 1;
    letter-spacing: -0.04em;
    color: var(--text-tertiary);
    margin-left: 0.4rem;
  }

  .timer-state {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 1.25rem;
    text-align: center;
    font-family: var(--font-display);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--text-tertiary);
    pointer-events: none;
  }

  /* Done state — the whole face flashes the accent colour and
     a slow pulse makes it obvious from across the room. */
  .timer-face.done .timer-sec,
  .timer-face.done .timer-tenths { color: var(--accent-electric); }
  .timer-face.done {
    animation: timer-pulse 1.4s ease-in-out infinite;
  }
  @keyframes timer-pulse {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.03); }
  }

  .timer-hint {
    font-family: var(--font-display);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  /* Sizing is now `vmin`-driven so narrow phones scale automatically;
     no explicit breakpoint needed. */
</style>
