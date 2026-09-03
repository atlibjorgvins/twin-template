<script lang="ts">
  // A brand book: the whole brand on one page, for someone who has to USE
  // it — not the card's glance, and not a folder of PNGs.
  //
  // The structure follows what brand guideline tools converged on
  // (Frontify, Brandpad, the public Uber/Material brand centres), in the
  // order a person needs it:
  //
  //   Cover     the brand wearing itself, so the page proves the palette
  //   Logo      every variant on the background it is meant for
  //   Colour    values you can copy, and the contrast facts
  //   Type      a specimen, not a font name
  //   Assets    everything else that ships with the brand
  //   Usage     the handful of rules that are easy to get wrong
  //
  // Two things this does that a static PDF cannot: every value is
  // click-to-copy, and the contrast ratios are computed from the actual
  // colours rather than asserted by whoever wrote the deck.
  import { invalidateAll } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import BrandCard from '$lib/admin/BrandCard.svelte';
  import { assetUrl, textColorFor } from '$lib/directus';
  import {
    LOGO_LOCKUPS,
    BRAND_ELEMENT_KINDS,
    gradientCss,
    type BrandElement,
    LOGO_TREATMENTS,
    type LogoCell,
    BRAND_COLOR_ROLES,
    BRAND_FONT_ROLES,
    fontFaceCss,
    fontStylesheets,
    fontStackFor,
    type BrandColorField,
    type BrandFontFace
  } from '$lib/brand';
  import type { BrandSource } from '$lib/brand';
  import type { BrandBookData } from './+page';

  let { data }: { data: BrandBookData } = $props();
  const brand = $derived(data.brand);
  const owner = $derived(data.owner);

  const mainBg = $derived(brand.colors.brand_bg_light ?? '#FFFFFF');
  const inverseBg = $derived(brand.colors.brand_bg_dark ?? '#16181D');
  const primary = $derived(brand.colors.brand_primary ?? null);

  /** The best logo for the cover: landscape reads biggest, then original. */
  const coverLogo = $derived(
    brand.logos.brand_logo_landscape ?? brand.logos.brand_logo ?? brand.logos.brand_logo_simple
  );

  // ── Type ────────────────────────────────────────────────────────────
  // The whole point of uploading a face: the specimen renders in the ACTUAL
  // typeface instead of approximating it in system-ui. Files become
  // @font-face rules; css_url faces load through a <link> because we cannot
  // know what a remote stylesheet declares.
  const faces = $derived(data.fonts);
  const faceCss = $derived(fontFaceCss(faces, (id) => assetUrl(id)));
  const sheets = $derived(fontStylesheets(faces));
  const displayStack = $derived(fontStackFor(faces, 'display'));
  const bodyStack = $derived(fontStackFor(faces, 'body') ?? displayStack);

  /** Faces grouped by role, in the order the roles are declared. */
  const facesByRole = $derived.by(() => {
    const out: Array<{ label: string; hint: string; items: BrandFontFace[] }> = [];
    for (const r of BRAND_FONT_ROLES) {
      const items = faces.filter((f) => f.role === r.value);
      if (items.length > 0) out.push({ label: r.label, hint: r.hint, items });
    }
    const rest = faces.filter((f) => !f.role || !BRAND_FONT_ROLES.some((r) => r.value === f.role));
    if (rest.length > 0) out.push({ label: 'Other', hint: '', items: rest });
    return out;
  });

  // The @font-face rules are injected as a style node at runtime, not
  // written into the template. A style block in markup is picked up by
  // Svelte's CSS preprocessor at BUILD time, which then tries to parse the
  // interpolation as literal CSS and fails. These rules depend on data, so
  // they can only exist at runtime.
  $effect(() => {
    if (!faceCss) return;
    const el = document.createElement('style');
    el.dataset.brandFaces = String(owner.id);
    el.textContent = faceCss;
    document.head.appendChild(el);
    return () => el.remove();
  });

  /**
   * Which families the browser is REALLY using, measured rather than asked.
   *
   * Same principle as the contrast table: check, do not assert. A face whose
   * `family` does not match what its stylesheet declares — "ZZTEST Inter"
   * against a sheet that defines "Inter" — loads fine and then silently
   * renders in system-ui, which is the exact failure a brand book exists to
   * prevent.
   *
   * document.fonts.check() is no help: it answers "can this be rendered",
   * and a fallback counts, so it returns true for a family that does not
   * exist at all. The reliable test is to measure a string in
   * `"Family", <fallback>` and in `<fallback>` alone — identical widths
   * against every fallback means nothing but the fallback was ever used.
   */
  let available = $state<Set<string>>(new Set());
  $effect(() => {
    const families = [...new Set(faces.map((f) => f.family))];
    if (families.length === 0) return;
    let cancelled = false;

    void (async () => {
      // Wait for webfonts to settle, or a face that is merely still
      // downloading measures as missing.
      try { await document.fonts.ready; } catch { /* older browser */ }
      if (cancelled) return;

      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      const SAMPLE = 'mmmmmmmmmmlliWWW0Oo';
      // Three fallbacks with very different metrics: a real face is
      // vanishingly unlikely to match all three by coincidence.
      const FALLBACKS = ['monospace', 'serif', 'sans-serif'];

      const width = (stack: string) => {
        ctx.font = `48px ${stack}`;
        return ctx.measureText(SAMPLE).width;
      };

      const ok = new Set<string>();
      for (const fam of families) {
        const differs = FALLBACKS.some((fb) => width(`"${fam}", ${fb}`) !== width(fb));
        if (differs) ok.add(fam);
      }
      if (!cancelled) available = ok;
    })();

    return () => { cancelled = true; };
  });

  function weightLabel(f: BrandFontFace): string {
    const w = f.weight ? String(f.weight) : 'variable';
    return f.style === 'italic' ? `${w} italic` : w;
  }

  // Every uploaded logo, grouped the way the editor groups them: lockup
  // first (what SHAPE fits the space), treatments within it (what COLOUR
  // survives the background). The old list was BRAND_LOGO_ROLES — one slot
  // per role — so a second treatment of the same lockup had nowhere to go and
  // simply did not appear, and the book quietly contradicted the editor.
  const cells = $derived((data.logoCells ?? []) as LogoCell[]);
  const logoGroups = $derived(
    LOGO_LOCKUPS.map((lock) => ({
      lock,
      items: LOGO_TREATMENTS.map((treat) => ({
        treat,
        cell: cells.find((c) => c.lockup === lock.value && c.treatment === treat.value) ?? null
      })).filter((x) => x.cell !== null) as Array<{ treat: (typeof LOGO_TREATMENTS)[number]; cell: LogoCell }>
    })).filter((g) => g.items.length > 0)
  );
  const hasLogos = $derived(logoGroups.length > 0);

  /** Elements grouped by kind — each kind is READ differently, so each is
   *  rendered differently: a pattern has to be seen repeating, a gradient has
   *  to be seen as CSS you can paste, photography is mostly the direction. */
  const elements = $derived((data.elements ?? []) as BrandElement[]);
  const elementGroups = $derived(
    BRAND_ELEMENT_KINDS.map((k) => ({ k, items: elements.filter((e) => e.kind === k.value) }))
      .filter((g) => g.items.length > 0)
  );
  const shownColors = $derived(BRAND_COLOR_ROLES.filter((r) => !!brand.colors[r.field]));

  /**
   * Contrast pairs, built from the roles that actually exist.
   *
   * This used to be four hardcoded rows — primary on each background, plus
   * `textColorFor(bg)` on each — which no longer describes the setup:
   *
   *   • `brand_action` was never tested, though its own hint says it needs
   *     4.5:1 on the main surface. The one role with a stated requirement
   *     was the one the table skipped.
   *   • `brand_text_muted` was never tested either — the role documented as
   *     "the one that cannot be guessed".
   *   • Text was always the DERIVED black/white, so a brand that chose its
   *     own text colour had a table reporting a colour it does not use.
   *
   * Each non-surface role is now checked against the surface it declares via
   * `on`, using the value the brand actually resolves to. `derived` is carried
   * through so the table can mark a row as an automatic answer rather than a
   * decision — a derived pair passing tells you nothing about the brand.
   */
  const contrastPairs = $derived.by(() => {
    const out: Array<{ label: string; fg: string; bg: string; derived: boolean }> = [];
    for (const role of BRAND_COLOR_ROLES) {
      if (role.on === null) continue;          // surfaces are the ground, not a pair
      const bg = role.on === 'dark' ? inverseBg : mainBg;
      const chosen = brand.colors[role.field];
      let fg = chosen ?? null;
      let derived = false;
      if (!fg && role.follows) fg = brand.colors[role.follows] ?? null;
      if (!fg && role.derive) { fg = textColorFor(bg); derived = true; }
      if (!fg) continue;                       // genuinely unset — nothing to judge
      // "Text on inverse" already names its surface; appending it again read
      // "Text on inverse on inverse background".
      const word = role.on === 'dark' ? 'inverse' : 'main';
      const label = new RegExp(word, 'i').test(role.label)
        ? `${role.label} background`
        : `${role.label} on ${word} background`;
      out.push({ label, fg, bg, derived });
    }
    // The brand hue is the one thing worth seeing against BOTH surfaces —
    // it has to survive wherever the brand is placed.
    if (primary) {
      out.push({ label: 'Brand on inverse background', fg: primary, bg: inverseBg, derived: false });
    }
    return out;
  });
  const isEmpty = $derived(
    !hasLogos && shownColors.length === 0 && !brand.font && faces.length === 0
  );

  // ── Edit mode ───────────────────────────────────────────────────────
  // The same BrandCard the project and org pages use, mounted inline. A
  // second editor written for this page would be a second thing to keep in
  // step with the schema, and it would drift.
  //
  // Leaving edit mode re-runs the loader rather than patching local state:
  // the book renders the RESOLVED brand, and resolution walks the parent
  // chain, so a change here can alter values this page inherited. Only the
  // loader knows the new answer.
  let editing = $state(false);

  async function stopEditing() {
    editing = false;
    await invalidateAll();
  }

  // ── Contrast ────────────────────────────────────────────────────────
  // Computed, not claimed. A brand book that says "our primary works on
  // white" without the number is how unreadable buttons get shipped.
  function rgb(hex: string): [number, number, number] | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function luminance(hex: string): number | null {
    const c = rgb(hex);
    if (!c) return null;
    const lin = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  }
  function ratio(a: string, b: string): number | null {
    const la = luminance(a), lb = luminance(b);
    if (la == null || lb == null) return null;
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }
  /** WCAG AA is 4.5:1 for body text, 3:1 for large text and UI edges. */
  function grade(r: number | null): { label: string; ok: boolean } {
    if (r == null) return { label: '—', ok: false };
    if (r >= 7) return { label: 'AAA', ok: true };
    if (r >= 4.5) return { label: 'AA', ok: true };
    if (r >= 3) return { label: 'AA large only', ok: false };
    return { label: 'fails', ok: false };
  }
  function rgbLabel(hex: string): string {
    const c = rgb(hex);
    return c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : '';
  }

  // ── Copy ────────────────────────────────────────────────────────────
  let copied = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = key;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (copied = null), 1500);
    } catch {
      // Clipboard blocked — the value is on screen either way.
    }
  }

  /** Asset links without the access token: a URL that carries a credential
   *  must not be pasted into a chat. Directus serves these unauthenticated. */
  function publicUrl(id: string): string {
    return assetUrl(id).split('?')[0];
  }
  function downloadName(label: string): string {
    const base = owner.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase();
    return `${base}-${label.toLowerCase().replace(/\s+/g, '-')}`;
  }

  const SECTIONS = $derived(
    [
      hasLogos ? { id: 'logo', label: 'Logo' } : null,
      shownColors.length > 0 ? { id: 'colour', label: 'Colour' } : null,
      brand.font || faces.length > 0 ? { id: 'type', label: 'Type' } : null,
      elements.length > 0 ? { id: 'elements', label: 'Elements' } : null,
      brand.assets.length > 0 ? { id: 'assets', label: 'Assets' } : null,
      { id: 'usage', label: 'Usage' }
    ].filter((s): s is { id: string; label: string } => !!s)
  );

  const ownerHref = $derived(
    owner.kind === 'project' ? `/projects/${owner.id}` : `/orgs/${owner.id}`
  );

  /** Page where a resolved value is actually set — the point of "from X". */
  function sourceHref(src: BrandSource): string {
    if (!src) return ownerHref;
    return src.kind === 'project' ? `/projects/${src.id}` : `/orgs/${src.id}`;
  }

  /**
   * Everything this brand inherits, and from where.
   *
   * The per-value "from KLAK" badges answer "where did this come from" one
   * value at a time, which is not the same as answering "so where do I go to
   * change it". This collects the distinct sources once, up front, as links.
   */
  const inheritedFrom = $derived.by(() => {
    const srcs: BrandSource[] = [
      // From the cells, not the legacy role columns: an inherited logo that
      // only exists as a brand_logo_asset row is still inherited, and the
      // "inherits from" bar has to say so.
      ...cells.map((c) => c.from),
      ...BRAND_COLOR_ROLES.map((r) => brand.colors[r.field] ? brand.colorFrom[r.field] : null),
      brand.fontFrom,
      data.fontsFrom,
      brand.assetsFrom
    ];
    const seen = new Map<string, { name: string; href: string }>();
    for (const s of srcs) {
      if (!s || s.id === owner.id) continue;
      seen.set(`${s.kind}-${s.id}`, { name: s.name, href: sourceHref(s) });
    }
    return [...seen.values()];
  });
</script>

<svelte:head>
  <title>{owner.name} — brand book</title>
  <!-- Uploaded faces become real @font-face rules; publicly hosted ones load
       through their own stylesheet. Both are needed for the specimen below
       to be the actual typeface rather than an approximation of it. -->
  {#each sheets as href (href)}
    <link rel="stylesheet" {href} />
  {/each}
</svelte:head>

<article class="bb">
  <!-- Cover. The brand wearing itself: if the palette is wrong you see it
       here before you read a single hex value. -->
  <header class="bb-cover" style="background: {mainBg}; color: {textColorFor(mainBg)};">
    <div class="bb-cover-inner">
      {#if coverLogo}
        <img class="bb-cover-logo" src={assetUrl(coverLogo, { width: 900, fit: 'contain' })} alt="{owner.name} logo" />
      {:else}
        <h1 class="bb-cover-name">{owner.name}</h1>
      {/if}
      <p class="bb-cover-kicker">
        Brand book
        <span class="bb-dot">·</span>
        <a class="bb-cover-link" href={ownerHref} style="color: inherit;">{owner.name}</a>
      </p>
    </div>
  </header>

  <!-- Where the brand is CONNECTED, said plainly. The per-value badges tell
       you a colour came from KLAK; this tells you which page to open to
       change it, which is the question you actually have. -->
  <div class="bb-where">
    <span class="bb-where-label">Set on</span>
    <a class="bb-where-link" href={ownerHref}>
      <Icon name={owner.kind === 'organization' ? 'building' : 'sparkles'} size={13} />
      {owner.name}
    </a>
    {#if inheritedFrom.length > 0}
      <span class="bb-where-label">· inherits from</span>
      {#each inheritedFrom as src (src.href)}
        <a class="bb-where-link" href={src.href}>{src.name}</a>
      {/each}
    {/if}
    <button
      type="button"
      class="bb-where-edit"
      aria-pressed={editing}
      onclick={() => (editing ? stopEditing() : (editing = true))}
      title={editing ? 'Done — re-read the brand' : 'Edit this brand here'}
    >
      <Icon name={editing ? 'check' : 'pencil'} size={13} />
      {editing ? 'Done' : 'Edit'}
    </button>
    <span class="bb-where-hint">
      {#if editing}
        Editing {owner.name}. Inherited values stay inherited until you set one
        here — clearing a value falls back to the parent again.
      {:else}
        Edit here, or open a linked page above to change it at its source.
      {/if}
    </span>
  </div>

  {#if editing}
    <!-- keyed so switching brands never leaves a stale editor mounted -->
    {#key `${owner.kind}-${owner.id}`}
      <div class="bb-editor">
        <BrandCard
          project={data.row as never}
          kind={owner.kind}
          compact={false}
          editable
          onForked={() => void invalidateAll()}
        />
      </div>
    {/key}
  {/if}

  {#if isEmpty}
    <section class="bb-section">
      <p class="bb-empty">
        No brand set for {owner.name} yet — add a logo or a colour on
        <a class="bb-inline-link" href={ownerHref}>its page</a> and it will show up here.
      </p>
    </section>
  {:else}
    <nav class="bb-nav" aria-label="Brand book sections">
      {#each SECTIONS as s (s.id)}
        <a class="bb-nav-link" href="#{s.id}">{s.label}</a>
      {/each}
    </nav>

    {#if hasLogos}
      <section class="bb-section" id="logo">
        <h2 class="bb-h2">Logo</h2>
        <p class="bb-lede">
          Grouped by lockup — the shape that fits the space. Within each, every
          treatment is shown on the background it is made for. Pick by
          placement, not by preference.
        </p>
        {#each logoGroups as group (group.lock.value)}
          <div class="bb-lockup">
            <h3 class="bb-h3">{group.lock.label}</h3>
            <p class="bb-lockup-hint">{group.lock.hint}</p>
            <div class="bb-logos">
              {#each group.items as item (item.treat.value)}
                {@const id = item.cell.fileId}
                {@const key = `${group.lock.value}-${item.treat.value}`}
                {@const bg = item.treat.onDark ? inverseBg : mainBg}
                <figure class="bb-logo">
                  <div class="bb-logo-stage" style="background: {bg};">
                    <img src={assetUrl(id, { width: 480, fit: 'contain' })} alt="{group.lock.label} {item.treat.label} logo" />
                  </div>
                  <figcaption>
                    <span class="bb-logo-name">{item.treat.label}</span>
                    <span class="bb-logo-hint">{item.treat.hint}</span>
                    {#if item.cell.from && item.cell.from.id !== owner.id}
                      <a class="bb-from" href={sourceHref(item.cell.from)}>from {item.cell.from.name}</a>
                    {/if}
                    <span class="bb-logo-actions">
                      <a class="bb-btn" href={assetUrl(id, { download: '' })} download={downloadName(`${group.lock.label} ${item.treat.label}`)}>
                        <Icon name="download" size={13} /> Download
                      </a>
                      <button class="bb-btn" type="button" onclick={() => copy(publicUrl(id), `logo-${key}`)}>
                        <Icon name={copied === `logo-${key}` ? 'check' : 'copy'} size={13} />
                        {copied === `logo-${key}` ? 'Copied' : 'Copy link'}
                      </button>
                    </span>
                  </figcaption>
                </figure>
              {/each}
            </div>
          </div>
        {/each}
      </section>
    {/if}

    {#if shownColors.length > 0}
      <section class="bb-section" id="colour">
        <h2 class="bb-h2">Colour</h2>
        <p class="bb-lede">Tap any value to copy it.</p>
        <div class="bb-colors">
          {#each shownColors as role (role.field)}
            {@const hex = brand.colors[role.field as BrandColorField]!}
            <div class="bb-color">
              <button
                class="bb-chip"
                type="button"
                style="background: {hex}; color: {textColorFor(hex)};"
                onclick={() => copy(hex, `hex-${role.field}`)}
                title="Copy {hex}"
              >{copied === `hex-${role.field}` ? 'Copied' : hex}</button>
              <div class="bb-color-meta">
                <span class="bb-color-name">{role.label}</span>
                <span class="bb-color-hint">{role.hint}</span>
                <button class="bb-mono" type="button" onclick={() => copy(rgbLabel(hex), `rgb-${role.field}`)}>
                  {copied === `rgb-${role.field}` ? 'Copied' : rgbLabel(hex)}
                </button>
                {#if brand.colorFrom[role.field as BrandColorField] && brand.colorFrom[role.field as BrandColorField]!.id !== owner.id}
                  <a class="bb-from" href={sourceHref(brand.colorFrom[role.field as BrandColorField])}
                    >from {brand.colorFrom[role.field as BrandColorField]!.name}</a>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- Contrast, computed from the actual values. This is the section
             that stops an unreadable button reaching production. -->
        <!-- Gated on the pairs, not on `primary`: a brand that sets text and
             action colours but no brand hue used to get no contrast table at
             all, which is exactly when one is worth reading. -->
        {#if contrastPairs.length > 0}
          <h3 class="bb-h3">Contrast</h3>
          <table class="bb-table">
            <thead>
              <tr><th>Pair</th><th>Ratio</th><th>Rating</th></tr>
            </thead>
            <tbody>
              {#each contrastPairs as pair (pair.label)}
                {@const r = ratio(pair.fg, pair.bg)}
                {@const g = grade(r)}
                <tr>
                  <td>
                    <span class="bb-pair-sw" aria-hidden="true" style="background: {pair.bg};">
                      <span style="background: {pair.fg};"></span>
                    </span>
                    {pair.label}
                    {#if pair.derived}<span class="bb-derived" title="No colour set for this role — this is the automatic answer from the background's luminance">auto</span>{/if}
                  </td>
                  <td class="bb-num">{r ? `${r.toFixed(2)}:1` : '—'}</td>
                  <td><span class="bb-grade" class:ok={g.ok}>{g.label}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="bb-note">
            WCAG AA needs 4.5:1 for body text and 3:1 for large text or UI
            edges. "AA large only" means the pair is fine for headlines and
            borders but not for paragraphs. Rows marked
            <span class="bb-derived">auto</span> have no colour set for that
            role — they pass or fail on the derived value, which the brand has
            not actually chosen.
          </p>
        {/if}
      </section>
    {/if}

    {#if brand.font || faces.length > 0}
      <section class="bb-section" id="type">
        <h2 class="bb-h2">Type</h2>
        {#if brand.font}
          <p class="bb-lede">
            {brand.font}
            {#if brand.fontFrom && brand.fontFrom.id !== owner.id}
              <a class="bb-from" href={sourceHref(brand.fontFrom)}>from {brand.fontFrom.name}</a>
            {/if}
          </p>
        {/if}
        {#if faces.length > 0 && data.fontsFrom && data.fontsFrom.id !== owner.id}
          <p class="bb-lede">
            <a class="bb-from" href={sourceHref(data.fontsFrom)}>faces from {data.fontsFrom.name}</a>
          </p>
        {/if}

        {#if faces.length > 0}
          <!-- The payoff of uploading a face: this specimen is the real
               thing, not system-ui pretending. -->
          <div class="bb-specimen" style="font-family: {displayStack};">
            <p class="bb-spec-xl">Aa Bb Cc</p>
            <p class="bb-spec-l">{owner.name}</p>
          </div>
          <div class="bb-specimen" style="font-family: {bodyStack};">
            <p class="bb-spec-m">The quick brown fox jumps over the lazy dog.</p>
            <p class="bb-spec-s">
              Body copy at reading size — 0123456789 — áéíóúýþæðö. Hástafir:
              ÁÉÍÓÚÝÞÆÐÖ. Punctuation: ()&#123;&#125;[]&amp;@#%$ &ldquo;quotes&rdquo; — dashes –
              ellipsis…
            </p>
          </div>

          {#each facesByRole as group (group.label)}
            <h3 class="bb-h3">{group.label}</h3>
            {#if group.hint}<p class="bb-note" style="margin-top:0.2rem;">{group.hint}</p>{/if}
            <div class="bb-faces">
              {#each group.items as f (f.id)}
                <div class="bb-face">
                  <p class="bb-face-sample" style="font-family: &quot;{f.family}&quot;, system-ui, sans-serif; font-weight: {f.weight ?? 400}; font-style: {f.style ?? 'normal'};">
                    Aa Bb Cc 123
                  </p>
                  <div class="bb-face-meta">
                    <span class="bb-face-name">{f.family}</span>
                    <span class="bb-face-weight">{weightLabel(f)}</span>
                    {#if !available.has(f.family)}
                      <span class="bb-face-warn">
                        Not rendering — nothing on this page provides “{f.family}”.
                        {#if f.css_url}Check the family name matches what the stylesheet declares.{/if}
                      </span>
                    {/if}
                    {#if f.license}<span class="bb-face-lic">{f.license}</span>{/if}
                    {#if f.notes}<span class="bb-face-notes">{f.notes}</span>{/if}
                    <span class="bb-face-actions">
                      {#if f.file_id}
                        <a class="bb-btn" href={assetUrl(f.file_id, { download: '' })} download>
                          <Icon name="download" size={13} /> Download
                        </a>
                        <button class="bb-btn" type="button" onclick={() => copy(publicUrl(f.file_id!), `font-${f.id}`)}>
                          <Icon name={copied === `font-${f.id}` ? 'check' : 'copy'} size={13} />
                          {copied === `font-${f.id}` ? 'Copied' : 'Copy link'}
                        </button>
                      {/if}
                      {#if f.source_url}
                        <a class="bb-btn" href={f.source_url} target="_blank" rel="noreferrer">
                          <Icon name="globe" size={13} /> Source
                        </a>
                      {/if}
                      {#if !f.file_id && f.css_url}
                        <span class="bb-face-hosted">web-hosted</span>
                      {/if}
                    </span>
                  </div>
                </div>
              {/each}
            </div>
          {/each}
        {:else}
          <!-- Named but not carried: the face cannot render, so say that
               rather than showing a system-font specimen that lies. -->
          <div class="bb-specimen">
            <p class="bb-spec-xl">Aa Bb Cc</p>
            <p class="bb-spec-s">
              No font files or stylesheet links are attached, so this specimen
              is rendering in the system typeface — not {brand.font}. Attach the
              face on <a class="bb-inline-link" href={ownerHref}>{owner.name}</a>
              to make this real.
            </p>
          </div>
        {/if}
      </section>
    {/if}

    {#if elementGroups.length > 0}
      <section class="bb-section" id="elements">
        <h2 class="bb-h2">Elements</h2>
        <p class="bb-lede">
          The parts of the brand that are neither a logo nor a colour. Each is
          shown the way you have to judge it — patterns repeating, gradients as
          CSS you can paste, photography with its direction.
        </p>
        {#each elementGroups as group (group.k.value)}
          <div class="bb-elgroup">
            <h3 class="bb-h3">{group.k.plural}</h3>
            <p class="bb-lockup-hint">{group.k.hint}</p>
            <div class="bb-els">
              {#each group.items as el (el.id)}
                {@const css = gradientCss(el)}
                {@const bg = el.on_dark ? inverseBg : mainBg}
                <figure class="bb-el">
                  <!-- A pattern is tiled at its real tile width, not scaled to
                       fit: the whole question a pattern has to answer is
                       whether it seams, and a stretched single tile hides
                       exactly that. -->
                  <div
                    class="bb-el-stage"
                    class:tall={el.kind === 'photography'}
                    style={
                      el.kind === 'gradient' && css
                        ? `background: ${css};`
                        : el.kind === 'pattern' && el.file_id
                          ? `background-color: ${bg}; background-image: url('${assetUrl(el.file_id, { width: 640 })}'); background-repeat: repeat; background-size: ${el.tile_width ? el.tile_width + 'px' : 'auto'};`
                          : `background: ${bg};`
                    }
                  >
                    {#if el.kind !== 'pattern' && el.kind !== 'gradient' && el.file_id}
                      <img src={assetUrl(el.file_id, { width: 640, fit: 'contain' })} alt={el.name} loading="lazy" />
                    {/if}
                  </div>
                  <figcaption>
                    <span class="bb-logo-name">{el.name}</span>
                    {#if el.kind === 'pattern' && el.tile_width}
                      <span class="bb-logo-hint">Tiles at {el.tile_width}px</span>
                    {/if}
                    {#if el.notes}<span class="bb-logo-hint">{el.notes}</span>{/if}
                    {#if data.elementsFrom && data.elementsFrom.id !== owner.id}
                      <a class="bb-from" href={sourceHref(data.elementsFrom)}>from {data.elementsFrom.name}</a>
                    {/if}
                    <span class="bb-logo-actions">
                      {#if css}
                        <button class="bb-btn" type="button" onclick={() => copy(css, `el-${el.id}`)}>
                          <Icon name={copied === `el-${el.id}` ? 'check' : 'copy'} size={13} />
                          {copied === `el-${el.id}` ? 'Copied' : 'Copy CSS'}
                        </button>
                      {/if}
                      {#if el.file_id}
                        <a class="bb-btn" href={assetUrl(el.file_id, { download: '' })} download={downloadName(el.name)}>
                          <Icon name="download" size={13} /> Download
                        </a>
                        <button class="bb-btn" type="button" onclick={() => copy(publicUrl(el.file_id!), `elf-${el.id}`)}>
                          <Icon name={copied === `elf-${el.id}` ? 'check' : 'copy'} size={13} />
                          {copied === `elf-${el.id}` ? 'Copied' : 'Copy link'}
                        </button>
                      {/if}
                    </span>
                  </figcaption>
                </figure>
              {/each}
            </div>
          </div>
        {/each}
      </section>
    {/if}

    {#if brand.assets.length > 0}
      <section class="bb-section" id="assets">
        <h2 class="bb-h2">Assets</h2>
        <div class="bb-assets">
          {#each brand.assets as a (a.id)}
            {#if a.file_id}
              <figure class="bb-asset">
                <img src={assetUrl(a.file_id, { width: 400, height: 400, fit: 'contain' })} alt={a.label ?? ''} loading="lazy" />
                <figcaption>
                  <span>{a.label || 'Asset'}</span>
                  <button class="bb-btn" type="button" onclick={() => copy(publicUrl(a.file_id!), `asset-${a.id}`)}>
                    <Icon name={copied === `asset-${a.id}` ? 'check' : 'copy'} size={13} />
                    {copied === `asset-${a.id}` ? 'Copied' : 'Copy link'}
                  </button>
                </figcaption>
              </figure>
            {/if}
          {/each}
        </div>
      </section>
    {/if}

    <section class="bb-section" id="usage">
      <h2 class="bb-h2">Usage</h2>
      <ul class="bb-rules">
        <li><strong>Pair the logo to the background.</strong> Original on the main background, Inverted on the inverse one. Never the other way round.</li>
        <!-- Was "Text colour is derived, not chosen" — untrue since the text
             roles landed. It is chosen when set and derived only as a
             fallback, which is what the contrast table's `auto` marks. -->
        <li><strong>Text colour is set where it matters.</strong> Where a text role has no value it falls back to the background's luminance — the contrast table marks those <span class="bb-derived">auto</span>.</li>
        <li><strong>Use Simple below about 32px.</strong> A full lockup at favicon size is a smudge.</li>
        <li><strong>Do not recolour the logo.</strong> If a placement needs a colour that is not here, it needs a new variant, not a filter.</li>
        <li><strong>Links need the tailnet.</strong> Copied asset URLs resolve on the internal network, not the public internet.</li>
      </ul>
      <p class="bb-note">
        Everything on this page is resolved live from
        <a class="bb-inline-link" href={ownerHref}>{owner.name}</a>, so it
        cannot go stale the way an exported PDF does.
      </p>
    </section>
  {/if}
</article>

<style>
  .bb { max-width: 1000px; margin: 0 auto; padding-bottom: 4rem; }

  /* Cover */
  .bb-cover {
    border-radius: 18px;
    padding: clamp(2.5rem, 8vw, 5.5rem) clamp(1.25rem, 5vw, 3rem);
    border: 1px solid var(--surface-border, #e5e5e5);
  }
  .bb-cover-inner { display: flex; flex-direction: column; align-items: flex-start; gap: 1.5rem; }
  .bb-cover-logo { max-width: min(100%, 420px); max-height: 140px; object-fit: contain; }
  .bb-cover-name { font-size: clamp(2rem, 7vw, 4rem); font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  .bb-cover-kicker {
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.16em; opacity: 0.7;
  }
  .bb-dot { margin: 0 0.4rem; }
  .bb-cover-link { text-decoration: underline; text-underline-offset: 3px; }

  /* Section nav */
  .bb-nav {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: 0.25rem; flex-wrap: wrap;
    margin: 1.5rem 0 0.5rem;
    padding: 0.5rem 0;
    background: var(--bg-primary, #fff);
  }
  .bb-nav-link {
    padding: 0.35rem 0.75rem; border-radius: 999px;
    font-size: 13px; color: var(--ink-600, #555); text-decoration: none;
    border: 1px solid transparent;
  }
  .bb-nav-link:hover { background: var(--bg-secondary, #f3f3f3); color: var(--ink-900, #111); }

  .bb-section { padding: 2.5rem 0; border-top: 1px solid var(--surface-divider, #ececec); }
  .bb-section:first-of-type { border-top: 0; }
  .bb-h2 { font-size: clamp(1.4rem, 3vw, 2rem); font-weight: 700; letter-spacing: -0.02em; color: var(--ink-900, #111); }
  .bb-h3 { margin-top: 2rem; font-size: 1.05rem; font-weight: 600; color: var(--ink-900, #111); }
  .bb-lede { margin-top: 0.5rem; color: var(--ink-500, #666); font-size: 0.95rem; }
  .bb-empty { color: var(--ink-500, #666); }
  .bb-inline-link { color: var(--brand, #2f7d7d); text-decoration: underline; }
  .bb-note { margin-top: 1rem; font-size: 0.8rem; line-height: 1.5; color: var(--ink-400, #888); max-width: 62ch; }
  /* A link, not a label: "from KLAK" is only useful if it takes you to the
     page where KLAK's brand is actually set. */
  .bb-from {
    display: inline-block; border-radius: 999px; padding: 0.05rem 0.45rem;
    background: var(--bg-tertiary, #eee); color: var(--ink-500, #666);
    font-size: 10px; font-weight: 600; text-decoration: none;
  }
  a.bb-from:hover { background: var(--bg-secondary, #e8e8e8); color: var(--ink-900, #111); }

  .bb-where {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem;
    margin-top: 0.9rem; padding: 0.6rem 0.8rem;
    border: 1px solid var(--surface-border, #e5e5e5);
    border-radius: 12px;
    background: var(--bg-secondary, #f8f8f8);
  }
  .bb-where-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-400, #888); }
  .bb-where-link {
    display: inline-flex; align-items: center; gap: 0.3rem;
    border-radius: 999px; padding: 0.15rem 0.6rem;
    background: var(--surface-card, #fff);
    border: 1px solid var(--surface-border, #e5e5e5);
    font-size: 0.8rem; font-weight: 500; color: var(--ink-900, #111);
    text-decoration: none;
  }
  .bb-where-link:hover { background: var(--bg-tertiary, #f0f0f0); }
  .bb-where-hint { flex-basis: 100%; font-size: 0.72rem; color: var(--ink-400, #888); }
  .bb-where-edit {
    display: inline-flex; align-items: center; gap: 0.3rem;
    margin-left: auto;
    border-radius: 999px; padding: 0.2rem 0.7rem;
    border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--surface-card, #fff);
    font-size: 0.78rem; font-weight: 600; color: var(--ink-700, #333);
    cursor: pointer;
  }
  .bb-where-edit[aria-pressed='true'] {
    background: var(--brand, #2f7d7d); border-color: var(--brand, #2f7d7d); color: #fff;
  }
  .bb-editor { margin-top: 0.9rem; }

  /* Logos */
  /* One block per lockup, so "Landscape" is a heading with its treatments
     under it rather than a single tile that could only ever show one. */
  .bb-lockup { margin-top: 2rem; }
  .bb-elgroup { margin-top: 2rem; }
  .bb-els { margin-top: 0.9rem; display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .bb-el-stage {
    height: 150px; border-radius: 12px; overflow: hidden;
    border: 1px solid var(--surface-border, #e5e5e5);
    display: grid; place-items: center;
  }
  /* Photography is judged on the image, so it gets the room to be one. */
  .bb-el-stage.tall { height: 220px; }
  .bb-el-stage img { width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: contain; padding: 0.6rem; }
  .bb-el figcaption { margin-top: 0.6rem; display: flex; flex-direction: column; gap: 0.2rem; }
  .bb-lockup .bb-logos { margin-top: 0.9rem; }
  .bb-lockup-hint { margin-top: 0.15rem; font-size: 0.85rem; color: var(--ink-400, #888); }
  .bb-logos { margin-top: 1.5rem; display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .bb-logo-stage {
    display: flex; align-items: center; justify-content: center;
    height: 150px; border-radius: 12px; padding: 1.5rem;
    border: 1px solid var(--surface-border, #e5e5e5);
  }
  .bb-logo-stage img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .bb-logo figcaption { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.6rem; align-items: flex-start; }
  .bb-logo-name { font-size: 0.9rem; font-weight: 600; color: var(--ink-900, #111); }
  .bb-logo-hint { font-size: 0.78rem; color: var(--ink-400, #888); }
  .bb-logo-actions { display: flex; gap: 0.4rem; margin-top: 0.2rem; }
  .bb-btn {
    display: inline-flex; align-items: center; gap: 0.3rem;
    border-radius: 999px; border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--surface-card, #fff);
    padding: 0.25rem 0.65rem; font-size: 11px; font-weight: 500;
    color: var(--ink-700, #333); text-decoration: none; cursor: pointer;
  }
  .bb-btn:hover { background: var(--bg-secondary, #f3f3f3); }

  /* Colours */
  .bb-colors { margin-top: 1.5rem; display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  .bb-chip {
    width: 100%; height: 110px; border-radius: 12px; cursor: pointer;
    border: 1px solid var(--surface-border, #e5e5e5);
    font-family: ui-monospace, monospace; font-size: 0.85rem; font-weight: 600;
  }
  .bb-color-meta { display: flex; flex-direction: column; gap: 0.15rem; margin-top: 0.5rem; align-items: flex-start; }
  .bb-color-name { font-size: 0.9rem; font-weight: 600; color: var(--ink-900, #111); }
  .bb-color-hint { font-size: 0.78rem; color: var(--ink-400, #888); }
  .bb-mono {
    font-family: ui-monospace, monospace; font-size: 0.72rem;
    color: var(--ink-500, #666); cursor: pointer; background: none; padding: 0;
  }
  .bb-mono:hover { color: var(--ink-900, #111); }

  /* Contrast table */
  .bb-table { width: 100%; margin-top: 0.75rem; border-collapse: collapse; font-size: 0.85rem; }
  .bb-table th {
    text-align: left; padding: 0.5rem 0.6rem;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--ink-400, #888); border-bottom: 1px solid var(--surface-divider, #ececec);
  }
  .bb-table td { padding: 0.55rem 0.6rem; border-bottom: 1px solid var(--surface-divider, #ececec); color: var(--ink-700, #333); }
  .bb-num { font-family: ui-monospace, monospace; }
  .bb-grade {
    display: inline-block; border-radius: 999px; padding: 0.1rem 0.5rem;
    font-size: 11px; font-weight: 600;
    background: #fdecea; color: #a3271c;
  }
  .bb-grade.ok { background: #e8f5ec; color: #1d6b3f; }

  /* A derived value is not a decision — say so inline rather than letting a
     passing ratio imply the brand chose it. */
  .bb-derived {
    display: inline-block;
    margin-left: 0.3rem;
    border-radius: 999px;
    padding: 0 0.32rem;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    vertical-align: 1px;
  }
  /* The pair as pixels: foreground square inside its background. Reading two
     hex codes and imagining the result is exactly the work this removes. */
  .bb-pair-sw {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 4px;
    border: 1px solid var(--border-subtle);
    margin-right: 0.4rem;
    vertical-align: -3px;
  }
  .bb-pair-sw span { display: block; width: 0.5rem; height: 0.5rem; border-radius: 2px; }

  /* Type specimen */
  .bb-specimen { margin-top: 1.25rem; color: var(--ink-900, #111); }
  .bb-spec-xl { font-size: clamp(3rem, 12vw, 6rem); line-height: 1; letter-spacing: -0.03em; }
  .bb-spec-l { font-size: clamp(1.6rem, 5vw, 2.6rem); line-height: 1.1; margin-top: 0.75rem; }
  .bb-spec-m { font-size: clamp(1.05rem, 2.5vw, 1.35rem); margin-top: 0.75rem; }
  .bb-spec-s { font-size: 1rem; line-height: 1.6; margin-top: 0.75rem; max-width: 62ch; color: var(--ink-700, #333); }

  /* Faces */
  .bb-faces { margin-top: 0.75rem; display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .bb-face { border: 1px solid var(--surface-border, #e5e5e5); border-radius: 12px; padding: 0.9rem; }
  .bb-face-sample { font-size: 1.6rem; line-height: 1.2; color: var(--ink-900, #111); }
  .bb-face-meta { display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.6rem; align-items: flex-start; }
  .bb-face-name { font-size: 0.85rem; font-weight: 600; color: var(--ink-900, #111); }
  .bb-face-weight { font-family: ui-monospace, monospace; font-size: 0.72rem; color: var(--ink-400, #888); }
  .bb-face-lic { font-size: 0.72rem; color: var(--ink-500, #666); }
  .bb-face-warn {
    border-radius: 8px; padding: 0.3rem 0.5rem;
    background: #fdf3e3; color: #8a5a12;
    font-size: 0.7rem; line-height: 1.4;
  }
  .bb-face-notes { font-size: 0.75rem; line-height: 1.45; color: var(--ink-500, #666); }
  .bb-face-hosted {
    border-radius: 999px; padding: 0.05rem 0.45rem;
    background: var(--bg-tertiary, #eee); color: var(--ink-500, #666);
    font-size: 10px; font-weight: 600;
  }
  .bb-face-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.2rem; }

  /* Assets */
  .bb-assets { margin-top: 1.5rem; display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  .bb-asset img {
    width: 100%; aspect-ratio: 1; object-fit: contain; padding: 0.5rem;
    border-radius: 12px; border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--bg-tertiary, #f5f5f5);
  }
  .bb-asset figcaption { display: flex; flex-direction: column; gap: 0.3rem; align-items: flex-start; margin-top: 0.4rem; font-size: 0.78rem; color: var(--ink-500, #666); }

  /* Usage */
  .bb-rules { margin-top: 1.25rem; display: flex; flex-direction: column; gap: 0.7rem; max-width: 68ch; }
  .bb-rules li { font-size: 0.92rem; line-height: 1.55; color: var(--ink-700, #333); }
  .bb-rules strong { color: var(--ink-900, #111); }

  /* Print: this is the one page in twin someone will actually want on
     paper or as a PDF, so the sticky nav and buttons get out of the way. */
  @media print {
    .bb-nav, .bb-btn, .bb-mono, .bb-where-edit, .bb-editor { display: none !important; }
    .bb-section { break-inside: avoid; }
    .bb-cover { break-after: page; }
  }
</style>
