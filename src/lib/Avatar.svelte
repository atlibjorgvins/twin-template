<script lang="ts">
  let {
    name = '',
    src = '',
    size = 32,
    /** Position string "X% Y%" or "X% Y% Zz" with optional zoom (e.g. "50% 30% 1.4z"). */
    position = '',
    /** Backdrop behind contain-mode logos (e.g. a brand's main background
     *  colour). Falls back to the page surface when unset. */
    bgColor = '',
    /** Defer the fetch until the image is near the viewport. Off by default so
     *  existing call sites are unchanged; ON for grids and scrollers that would
     *  otherwise open a hundred connections at once. Firing 120 asset requests
     *  at the NAS over Tailscale gets them closed, not served. */
    lazy = false
  }: {
    name?: string;
    src?: string;
    size?: number;
    position?: string;
    bgColor?: string;
    lazy?: boolean;
  } = $props();

  // Parse a position spec — backward compatible with legacy formats.
  //   "X% Y%"            → cover, zoom 1
  //   "X% Y% Zz"         → cover, zoom Z
  //   "X% Y% Zz contain" → contain (whole image visible, page bg behind)
  //   "contain"          → contain at zoom 1, centered
  function parsePos(s: string): { pos: string; zoom: number; fit: 'cover' | 'contain'; bg: string } {
    if (!s) return { pos: '50% 50%', zoom: 1, fit: 'cover', bg: '' };
    const tokens = s.trim().split(/\s+/);
    let x = '50%';
    let y = '50%';
    let zoom = 1;
    let fit: 'cover' | 'contain' = 'cover';
    // Backdrop for a contain-mode logo, stored as one more token in the same
    // string (see AvatarUpload). Unknown tokens were already skipped here, so
    // values written before this still parse unchanged.
    let bg = '';
    let posCount = 0;
    for (const t of tokens) {
      if (/^-?\d+(\.\d+)?%$/.test(t)) {
        if (posCount === 0) { x = t; posCount = 1; }
        else if (posCount === 1) { y = t; posCount = 2; }
      } else if (/z$/i.test(t)) {
        const z = parseFloat(t);
        if (!isNaN(z) && z > 0) zoom = z;
      } else if (/^contain$/i.test(t)) fit = 'contain';
      else if (/^cover$/i.test(t)) fit = 'cover';
      else if (/^#[0-9a-f]{3,8}$/i.test(t)) bg = t;
    }
    return { pos: `${x} ${y}`, zoom, fit, bg };
  }
  const parsed = $derived(parsePos(position));

  // Contain means "show the whole thing", but the frame is a CIRCLE and
  // object-contain fits to the square that circle is inscribed in — so the
  // corners get clipped anyway. A square logo loses the whole diagonal
  // overhang: fitted edge-to-edge its corners sit √2 ≈ 1.41× further out than
  // the circle's radius allows.
  //
  // So inscribe the rendered rectangle in the circle instead of the square.
  // The shrink is proportional to how square the image is: a 4:1 wordmark
  // loses 3%, a square mark loses 29% — which is exactly the amount that was
  // being cut off before.
  let natW = $state(0);
  let natH = $state(0);
  function onImgLoad(e: Event) {
    const i = e.currentTarget as HTMLImageElement;
    natW = i.naturalWidth;
    natH = i.naturalHeight;
  }
  const inscribePct = $derived.by(() => {
    if (parsed.fit !== 'contain' || !natW || !natH) return 100;
    const w = natW >= natH ? 1 : natW / natH;
    const h = natH >= natW ? 1 : natH / natW;
    return Math.min(1, 1 / Math.hypot(w, h)) * 100;
  });
  /** Explicit prop wins over the stored token: the project header passes a
   *  brand background on purpose, and that outranks a per-image choice. */
  const backdrop = $derived(bgColor || parsed.bg);
  /** Contain reads x/y as a pan offset from centre (50% = centred), in
   *  fractions of the avatar's own diameter — the same units the picker
   *  drags in, so what you set is what you get. */
  const parsedX = $derived(parseFloat(parsed.pos.split(' ')[0]) || 50);
  const parsedY = $derived(parseFloat(parsed.pos.split(' ')[1]) || 50);

  // Deterministic color from name — matches the Crisp "photo avatar w/ colored ring" vibe
  // by tinting the fallback bg.
  const palette = [
    ['#FDE7E7', '#C93B3B'],
    ['#E6F7EC', '#1E9B55'],
    ['#EFEBFE', '#6B5ADB'],
    ['#FFF1E1', '#C6762A'],
    ['#E3EEFE', '#1D6BFE'],
    ['#FEE7EB', '#C1364B']
  ];
  function hash(s: string) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  const [bg, fg] = palette[hash(name) % palette.length];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
</script>

{#if src}
  <span
    class="overflow-hidden rounded-full align-middle {parsed.fit === 'contain' ? 'inline-flex items-center justify-center' : 'inline-block'} {parsed.fit === 'contain' && !backdrop ? 'bg-surface-page' : ''}"
    style="width: {size}px; height: {size}px;{parsed.fit === 'contain' && backdrop ? ` background: ${backdrop};` : ''}"
  >
    <!-- In contain mode the contract is "whole logo, centered" — focal /
         zoom are cover-mode parameters and would only distort here, so we
         reset them. In cover mode the saved focal + zoom drive the framing
         exactly as the user set it in the picker. -->
    {#if parsed.fit === 'contain'}
      <img
        {src}
        alt={name}
        loading={lazy ? 'lazy' : 'eager'}
        decoding="async"
        onload={onImgLoad}
        class="h-full w-full object-contain"
        style="object-position: 50% 50%; max-width: {inscribePct}%; max-height: {inscribePct}%; margin: auto;
               transform: translate({((parsedX - 50) / 100) * size}px, {((parsedY - 50) / 100) * size}px) scale({parsed.zoom});"
      />
    {:else}
      <img
        {src}
        alt={name}
        loading={lazy ? 'lazy' : 'eager'}
        decoding="async"
        class="h-full w-full object-cover"
        style="object-position: {parsed.pos}; transform: scale({parsed.zoom}); transform-origin: {parsed.pos};"
      />
    {/if}
  </span>
{:else}
  <span
    class="inline-flex items-center justify-center rounded-full text-[11px] font-semibold"
    style="width: {size}px; height: {size}px; background: {bg}; color: {fg};"
    aria-label={name}
  >
    {initials || '•'}
  </span>
{/if}
