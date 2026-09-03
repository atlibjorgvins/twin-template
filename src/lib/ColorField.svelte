<script lang="ts">
  // A colour role, edited properly.
  //
  // What was here before was a bare <input type="color">: the operating
  // system's picker, with no way to type a value at all. For a BRAND colour
  // that is backwards — a brand colour is a specification you already have
  // written down, not something you nudge on a gradient. You paste #FF5E72,
  // or you read RGB off a spec sheet, or a printer asks you for CMYK.
  //
  // So: three notations, all live-linked, and the visual picker demoted to
  // one button among them rather than the whole interface.
  //
  // The eyedropper is offered only where it exists (Chromium's EyeDropper
  // API). Sampling the colour off a PDF or a website is how a brand colour
  // actually gets recovered when nobody can find the guidelines.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';

  let {
    value = null,
    inherited = null,
    inheritedFrom = null,
    label,
    hint = '',
    options = [],
    onSave
  }: {
    /** This owner's own value, or null when inheriting. */
    value?: string | null;
    /** The value inherited from a parent, shown greyed when there is no own. */
    inherited?: string | null;
    inheritedFrom?: string | null;
    label: string;
    hint?: string;
    /** The brand's palette. Offering these first is the whole mechanism that
     *  keeps a role pointing at a colour the brand actually owns, instead of
     *  a hex somebody typed once and nothing else references. */
    /** `key` must be unique and structural — see paletteOptions in BrandCard. */
    options?: Array<{ hex: string; label: string; key: string }>;
    onSave: (hex: string | null) => void | Promise<void>;
  } = $props();

  const shown = $derived(value ?? inherited);
  const isOwn = $derived(!!value);

  let open = $state(false);
  let root = $state<HTMLDivElement | undefined>();
  let hexInput = $state<HTMLInputElement | undefined>();

  // ── Notation plumbing ───────────────────────────────────────────────
  // One source of truth (`draft`, always a #RRGGBB string) with the three
  // notations derived from it. Editing any of them writes back to draft, so
  // they can never disagree.
  let draft = $state('#000000');

  function normalizeHex(input: string): string | null {
    const raw = input.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(raw)) {
      return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toUpperCase();
    }
    if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toUpperCase()}`;
    return null;
  }

  function toRgb(hex: string): { r: number; g: number; b: number } {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function fromRgb(r: number, g: number, b: number): string {
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v || 0)));
    return `#${((1 << 24) + (c(r) << 16) + (c(g) << 8) + c(b)).toString(16).slice(1).toUpperCase()}`;
  }

  /**
   * Naive RGB↔CMYK, which is what every on-screen tool does.
   *
   * Real CMYK depends on the press, the stock and an ICC profile — these
   * numbers are a starting point for a conversation with a printer, not a
   * print spec. The field says so rather than implying a precision it does
   * not have.
   */
  function toCmyk(hex: string): { c: number; m: number; y: number; k: number } {
    const { r, g, b } = toRgb(hex);
    const R = r / 255, G = g / 255, B = b / 255;
    const k = 1 - Math.max(R, G, B);
    if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
    return {
      c: Math.round(((1 - R - k) / (1 - k)) * 100),
      m: Math.round(((1 - G - k) / (1 - k)) * 100),
      y: Math.round(((1 - B - k) / (1 - k)) * 100),
      k: Math.round(k * 100)
    };
  }
  function fromCmyk(c: number, m: number, y: number, k: number): string {
    const p = (v: number) => Math.max(0, Math.min(100, v || 0)) / 100;
    const K = p(k);
    return fromRgb(
      255 * (1 - p(c)) * (1 - K),
      255 * (1 - p(m)) * (1 - K),
      255 * (1 - p(y)) * (1 - K)
    );
  }

  const rgb = $derived(toRgb(draft));

  /**
   * CMYK is STATE, not derived — unlike RGB, which is lossless.
   *
   * Deriving the four inputs from the hex looks equivalent and is not: the
   * conversion loses information at the edges. Pure black is (0,0,0,100),
   * so the moment a value passes through black the C/M/Y you just typed
   * snap back to zero, and the next keystroke reads those zeros as its
   * siblings. Typing C=100 over #FF0000 ended at #FFFFFF instead of cyan.
   *
   * So CMYK holds its own value while the popover is open, and is
   * recomputed from the hex only when the change came from somewhere else.
   */
  let cmyk = $state({ c: 0, m: 0, y: 0, k: 0 });

  /** Set the colour from any non-CMYK source, resyncing CMYK to match. */
  function setDraft(hex: string) {
    draft = hex;
    cmyk = toCmyk(hex);
  }

  function setCmyk(part: 'c' | 'm' | 'y' | 'k', n: number) {
    const v = Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
    cmyk = { ...cmyk, [part]: v };
    draft = fromCmyk(cmyk.c, cmyk.m, cmyk.y, cmyk.k);
  }

  /** Text that stays readable on the draft colour. */
  function readableOn(hex: string): string {
    const { r, g, b } = toRgb(hex);
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.4 ? '#111111' : '#FFFFFF';
  }

  // ── Open / close ────────────────────────────────────────────────────
  // The popover is position:fixed, placed from the trigger's rect, because it
  // is NOT free to overflow its parent: inside the brand editor the colour
  // rows sit in a `.cr-rows` list with `overflow: hidden`, which clipped a
  // 443px popover to the 158px that happened to fit — hex field, native
  // picker and Save all cut off. An absolutely-positioned popover is at the
  // mercy of every ancestor's overflow; a fixed one is only trapped by a
  // transformed ancestor, and there are none between here and the body.
  let popStyle = $state('');
  let triggerEl = $state<HTMLButtonElement | undefined>();

  /** Place the popover against the trigger, flipping above when the space
   *  below runs out, and clamping horizontally so it never leaves the
   *  viewport on a phone. */
  function place() {
    const t = triggerEl?.getBoundingClientRect();
    if (!t) return;
    const w = Math.min(300, window.innerWidth - 24);
    const H = 460; // enough for the tallest form (CMYK shown)
    const gap = 6;
    const below = window.innerHeight - t.bottom - gap;
    const above = t.top - gap;
    const up = below < Math.min(H, 260) && above > below;
    const left = Math.max(12, Math.min(t.left, window.innerWidth - w - 12));
    // maxHeight + its own scroll: on a short window neither placement fits,
    // and a scrollable popover beats a clipped one.
    const room = Math.max(220, Math.round(up ? above : below));
    // Always resolve to a `top`, then clamp it into the viewport. Anchoring
    // with `bottom` looked right until the trigger scrolled out of view: the
    // popover followed it off-screen (measured at top:-730) and there was no
    // way to reach the field you had just opened. Clamped, it stays put and
    // visible even when its own row has scrolled away.
    const h = Math.min(H, room);
    const wanted = up ? t.top - gap - h : t.bottom + gap;
    const top = Math.max(12, Math.min(wanted, window.innerHeight - h - 12));
    popStyle = `left: ${Math.round(left)}px; top: ${Math.round(top)}px; width: ${w}px; max-height: ${room}px;`;
  }

  function openEditor() {
    setDraft(shown ?? '#1D6BFE');
    open = true;
    place();
    // Focus hex first: typing or pasting a value is the common case, and
    // the field should be ready for it without a click.
    queueMicrotask(() => hexInput?.select());
  }

  function commit() {
    onSave(draft);
    open = false;
  }

  function clear() {
    onSave(null);
    open = false;
  }

  onMount(() => {
    const onDoc = (e: MouseEvent) => {
      if (open && root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') { e.stopPropagation(); open = false; }
    };
    // Fixed placement is a snapshot, so it has to be retaken whenever the
    // trigger moves under it. Capture phase catches scrolls in the editor's
    // own scroll containers, not just the window.
    const onMove = () => { if (open) place(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  });

  // Chromium only; the button simply is not offered elsewhere.
  const hasEyeDropper = $derived(typeof window !== 'undefined' && 'EyeDropper' in window);
  async function pickFromScreen() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ed = new (window as any).EyeDropper();
      const res = await ed.open();
      const hex = normalizeHex(res.sRGBHex);
      if (hex) setDraft(hex);
    } catch {
      // Cancelled — nothing to report.
    }
  }

  let copied = $state('');
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = key;
      setTimeout(() => (copied = ''), 1200);
    } catch {
      /* clipboard blocked */
    }
  }

  function onHexInput(v: string) {
    const hex = normalizeHex(v);
    if (hex) setDraft(hex);
  }
  /** Half-typed or invalid text is ignored while typing; on blur the field
   *  snaps back to the real value rather than sitting there lying. */
  function onHexBlur(el: HTMLInputElement) {
    el.value = draft;
  }
</script>

<div class="cf" bind:this={root}>
  <div class="cf-row">
    <button
      type="button"
      class="cf-swatch"
      bind:this={triggerEl}
      style="background: {shown ?? 'transparent'};"
      class:empty={!shown}
      class:inherited={!isOwn && !!shown}
      aria-label="{shown ? `Edit ${label}, currently ${shown}` : `Set ${label}`}"
      aria-expanded={open}
      onclick={() => (open ? (open = false) : openEditor())}
    >
      {#if !shown}<Icon name="plus" size={14} />{/if}
    </button>

    <div class="cf-meta">
      <span class="cf-label">{label}</span>
      {#if shown}
        <button type="button" class="cf-hex" onclick={() => copy(shown, 'row')}>
          {copied === 'row' ? 'Copied' : shown}
        </button>
      {:else}
        <span class="cf-empty-note">Not set</span>
      {/if}
      {#if !isOwn && inheritedFrom}
        <span class="cf-from">from {inheritedFrom}</span>
      {/if}
      {#if hint}<span class="cf-hint">{hint}</span>{/if}
    </div>

    {#if isOwn}
      <button
        type="button"
        class="cf-clear"
        title={inherited ? 'Clear (inherit again)' : 'Clear'}
        aria-label="Clear {label}"
        onclick={clear}
      ><Icon name="x" size={13} /></button>
    {/if}
  </div>

  {#if open}
    <div class="cf-pop" role="dialog" aria-label="Edit {label}" style={popStyle}>
      <div class="cf-preview" style="background: {draft}; color: {readableOn(draft)};">
        <span>{draft}</span>
      </div>

      {#if options.length > 0}
        <div class="cf-field">
          <span class="cf-field-label">From the palette</span>
          <div class="cf-opts">
            {#each options as o (o.key)}
              <button
                type="button"
                class="cf-opt"
                class:on={draft.toUpperCase() === o.hex.toUpperCase()}
                style="background: {o.hex};"
                title="{o.label} · {o.hex}"
                aria-label="Use {o.label}"
                onclick={() => setDraft(o.hex.toUpperCase())}
              ></button>
            {/each}
          </div>
        </div>
      {/if}

      <label class="cf-field">
        <span class="cf-field-label">HEX</span>
        <input
          bind:this={hexInput}
          class="cf-input cf-mono"
          value={draft}
          spellcheck="false"
          autocomplete="off"
          oninput={(e) => onHexInput((e.currentTarget as HTMLInputElement).value)}
          onblur={(e) => onHexBlur(e.currentTarget as HTMLInputElement)}
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        />
      </label>

      <div class="cf-field">
        <span class="cf-field-label">RGB</span>
        <div class="cf-triplet">
          {#each [['R', rgb.r], ['G', rgb.g], ['B', rgb.b]] as [name, v] (name)}
            <label class="cf-num">
              <span>{name}</span>
              <input
                type="number" min="0" max="255" class="cf-input cf-mono"
                value={v}
                oninput={(e) => {
                  const n = Number((e.currentTarget as HTMLInputElement).value);
                  setDraft(fromRgb(
                    name === 'R' ? n : rgb.r,
                    name === 'G' ? n : rgb.g,
                    name === 'B' ? n : rgb.b
                  ));
                }}
              />
            </label>
          {/each}
        </div>
      </div>

      <div class="cf-field">
        <span class="cf-field-label">
          CMYK
          <span class="cf-approx" title="Converted without a colour profile — a printer needs the real spec">approx</span>
        </span>
        <div class="cf-triplet cf-quad">
          {#each [['C', cmyk.c], ['M', cmyk.m], ['Y', cmyk.y], ['K', cmyk.k]] as [name, v] (name)}
            <label class="cf-num">
              <span>{name}</span>
              <input
                type="number" min="0" max="100" class="cf-input cf-mono"
                value={v}
                oninput={(e) => setCmyk(
                  name === 'C' ? 'c' : name === 'M' ? 'm' : name === 'Y' ? 'y' : 'k',
                  Number((e.currentTarget as HTMLInputElement).value)
                )}
              />
            </label>
          {/each}
        </div>
      </div>

      <div class="cf-tools">
        <!-- The OS picker, demoted to one option among three notations
             rather than being the entire interface. -->
        <label class="cf-tool" title="Pick visually">
          <Icon name="sliders" size={13} />
          <span>Picker</span>
          <input
            type="color"
            class="cf-native"
            value={draft}
            oninput={(e) => setDraft((e.currentTarget as HTMLInputElement).value.toUpperCase())}
          />
        </label>
        {#if hasEyeDropper}
          <button type="button" class="cf-tool" onclick={pickFromScreen} title="Sample a colour from anywhere on screen">
            <Icon name="eye" size={13} /> <span>Screen</span>
          </button>
        {/if}
        <button type="button" class="cf-tool" onclick={() => copy(draft, 'pop')}>
          <Icon name={copied === 'pop' ? 'check' : 'copy'} size={13} />
          <span>{copied === 'pop' ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      <div class="cf-actions">
        {#if isOwn}
          <button type="button" class="cf-btn" onclick={clear}>
            {inherited ? 'Inherit again' : 'Clear'}
          </button>
        {/if}
        <button type="button" class="cf-btn ghost" onclick={() => (open = false)}>Cancel</button>
        <button type="button" class="cf-btn primary" onclick={commit}>Apply</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .cf { position: relative; }
  .cf-row { display: flex; align-items: center; gap: 0.7rem; }

  /* 44px: this gets tapped on the tablet. The checkerboard shows through
     when nothing is set, so "no colour" never reads as "white". */
  .cf-swatch {
    width: 44px; height: 44px; flex: 0 0 auto;
    border-radius: 10px;
    border: 1px solid var(--surface-border, #e5e5e5);
    cursor: pointer;
    display: grid; place-items: center;
    color: var(--ink-400, #888);
  }
  .cf-swatch.empty {
    background-image:
      linear-gradient(45deg, #e9e9e9 25%, transparent 25%, transparent 75%, #e9e9e9 75%),
      linear-gradient(45deg, #e9e9e9 25%, transparent 25%, transparent 75%, #e9e9e9 75%);
    background-size: 12px 12px;
    background-position: 0 0, 6px 6px;
    border-style: dashed;
  }
  .cf-swatch.inherited { opacity: 0.75; }
  .cf-swatch:focus-visible { outline: 2px solid var(--brand, #2f7d7d); outline-offset: 2px; }

  .cf-meta { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1 1 auto; }
  .cf-label { font-size: 0.82rem; font-weight: 600; color: var(--ink-900, #111); }
  .cf-hex {
    align-self: flex-start;
    font-family: ui-monospace, monospace; font-size: 0.75rem;
    color: var(--ink-600, #555); background: none; cursor: pointer; padding: 0;
  }
  .cf-hex:hover { color: var(--ink-900, #111); }
  .cf-empty-note { font-size: 0.75rem; color: var(--ink-400, #888); }
  .cf-hint { font-size: 0.7rem; color: var(--ink-400, #888); }
  .cf-from {
    align-self: flex-start; border-radius: 999px; padding: 0.02rem 0.4rem;
    background: var(--bg-tertiary, #eee); color: var(--ink-500, #666);
    font-size: 9px; font-weight: 600;
  }
  .cf-clear {
    flex: 0 0 auto; display: grid; place-items: center;
    width: 28px; height: 28px; border-radius: 6px;
    color: var(--ink-300, #aaa); cursor: pointer;
  }
  .cf-clear:hover { color: #a3271c; background: var(--bg-secondary, #f4f4f4); }

  /* Popover */
  .cf-pop {
    /* fixed + JS placement: see place(). Left/top/width/max-height all come
       from the inline style; the values here are only the fallback for the
       instant before place() runs. */
    position: fixed; z-index: 60; top: 0; left: 0;
    width: min(300px, calc(100vw - 3rem));
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex; flex-direction: column; gap: 0.6rem;
    padding: 0.8rem;
    border: 1px solid var(--surface-border, #e5e5e5);
    border-radius: 12px;
    background: var(--surface-card, #fff);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
  }
  .cf-preview {
    display: grid; place-items: center;
    height: 60px; border-radius: 8px;
    border: 1px solid var(--surface-border, #e5e5e5);
    font-family: ui-monospace, monospace; font-size: 0.85rem; font-weight: 600;
  }
  .cf-field { display: flex; flex-direction: column; gap: 0.25rem; }
  .cf-field-label {
    display: flex; align-items: center; gap: 0.35rem;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--ink-400, #888);
  }
  .cf-approx {
    text-transform: none; letter-spacing: 0;
    border-radius: 999px; padding: 0 0.3rem;
    background: var(--bg-tertiary, #eee); font-size: 9px; font-weight: 600;
  }
  .cf-input {
    width: 100%; min-height: 34px;
    padding: 0 0.5rem;
    border: 1px solid var(--surface-border, #e5e5e5);
    border-radius: 8px;
    background: var(--surface-card, #fff);
    color: var(--ink-900, #111);
    font-size: 0.82rem;
  }
  .cf-input:focus-visible { outline: 2px solid var(--brand, #2f7d7d); outline-offset: -1px; }
  .cf-mono { font-family: ui-monospace, monospace; }
  .cf-triplet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.3rem; }
  .cf-quad { grid-template-columns: repeat(4, 1fr); }
  .cf-num { display: flex; flex-direction: column; gap: 0.1rem; }
  .cf-num > span { font-size: 9px; color: var(--ink-400, #888); text-align: center; }
  .cf-num .cf-input { text-align: center; padding: 0 0.15rem; }

  .cf-opts { display: flex; flex-wrap: wrap; gap: 0.25rem; }
  .cf-opt {
    width: 26px; height: 26px; border-radius: 6px;
    border: 1px solid var(--surface-border, #e5e5e5);
    cursor: pointer;
  }
  .cf-opt.on { outline: 2px solid var(--brand, #2f7d7d); outline-offset: 1px; }
  .cf-opt:focus-visible { outline: 2px solid var(--brand, #2f7d7d); outline-offset: 1px; }

  .cf-tools { display: flex; gap: 0.3rem; }
  .cf-tool {
    position: relative; overflow: hidden;
    display: inline-flex; align-items: center; gap: 0.25rem;
    min-height: 32px; padding: 0 0.55rem;
    border: 1px solid var(--surface-border, #e5e5e5);
    border-radius: 8px; background: var(--surface-card, #fff);
    font-size: 0.72rem; color: var(--ink-700, #333); cursor: pointer;
  }
  .cf-tool:hover { background: var(--bg-secondary, #f4f4f4); }
  /* The native input still does the work; it is just not what you look at. */
  .cf-native { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

  .cf-actions { display: flex; justify-content: flex-end; gap: 0.3rem; }
  .cf-btn {
    min-height: 32px; padding: 0 0.7rem; border-radius: 8px;
    border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--surface-card, #fff);
    font-size: 0.75rem; font-weight: 500; color: var(--ink-700, #333);
    cursor: pointer;
  }
  .cf-btn:hover { background: var(--bg-secondary, #f4f4f4); }
  .cf-btn.ghost { border-color: transparent; }
  .cf-btn.primary {
    background: var(--brand, #2f7d7d); border-color: var(--brand, #2f7d7d); color: #fff;
  }
  .cf-btn:focus-visible { outline: 2px solid var(--brand, #2f7d7d); outline-offset: 1px; }
</style>
