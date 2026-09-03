<script lang="ts">
  // Optional "Brand" card on the project page: structured logo roles,
  // fixed colour roles and a small asset gallery. Self-contained — owns
  // its loading and saving so the (large) project page just mounts one
  // tag. (The old freeform swatch editor is gone; legacy brand_colors
  // data stays in the DB for the image studio until it reads the roles.)
  //
  // Structure (usage-ready, so landing pages can apply it directly):
  //   Logos   — colour treatments: Original / Inverted / Flat black;
  //             orientation lockups: Landscape / Vertical / Simple (mark)
  //   Colours — Primary / Main background / Inverse background; text
  //             colours are derived from luminance, never entered.
  //
  // Inheritance: each facet falls back to the nearest ancestor up the
  // parent chain that has it set ("from Gulleggið" badge). Setting a
  // value on the sub-project overrides; clearing it falls back again.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import ColorEditor from '$lib/ColorField.svelte';
  import {
    brandBookHref,
    resolveBrand,
    saveBrandField,
    resolvePalette,
    createPaletteColor,
    deletePaletteColor,
    judgeContrast,
    PALETTE_GROUPS,
    BRAND_COLOR_ROLES,
    COLOR_ROLE_GROUPS,
    listOwnLogoAssets,
    resolveLogoAssets,
    createLogoAsset,
    deleteLogoAsset,
    legacyFieldFor,
    cellKey,
    LOGO_LOCKUPS,
    LOGO_TREATMENTS,
    listOwnFontFaces,
    createFontFace,
    deleteFontFace,
    adoptBrand,
    forkBrandFromParent,
    BRAND_ELEMENT_KINDS,
    gradientCss,
    listOwnElements,
    resolveElements,
    createBrandElement,
    updateBrandElement,
    deleteBrandElement,
    type BrandElement,
    type BrandElementKind,
    type GradientStop,
    isBrandStandalone,
    startBrandFromScratch,
    brandInheritance,
    BRAND_FONT_ROLES,
    type BrandFontFace,
    type BrandFontRole,
    type BrandOwner,
    type LogoCell,
    type PaletteColor,
    type BrandColorField,
    type PaletteGroup,
    type LogoLockup,
    type LogoTreatment,
    type BrandOwnerKind,
    type ResolvedBrand
  } from '$lib/brand';
  import {
    listProjectBrandAssets,
    addProjectBrandAsset,
    updateProjectBrandAsset,
    deleteProjectBrandAsset,
    uploadFile,
    assetUrl,
    formatError,
    textColorFor,
    type Project,
    type ProjectBrandAsset,
  } from '$lib/directus';

  let {
    project,
    /** Which collection `project` came from. Organizations carry the same
     *  brand field names, so everything below works on either — only the
     *  parent column, the asset gallery and the write target differ. */
    kind = 'project',
    compact = false,
    editable = false,
    onExpand,
    onForked
  }: {
    /** Structurally typed, not `Project`: the card only ever touches the id,
     *  the name, the brand_* columns and a parent pointer — and both
     *  collections now have all of those. Naming the concrete type here
     *  would couple an organization card to the Project interface for no
     *  reason. */
    project: BrandRow;
    kind?: BrandOwnerKind;
    /** View-mode strip: logo thumb + role swatches. Tapping expands a
     *  read-only brand sheet in place (still view mode); the sheet's
     *  pencil hands off to `onExpand` for actual editing. The full editor
     *  renders when compact is false.
     *
     *  `compact` must be driven by state of its OWN, not by the host page's
     *  edit toggle. The project page had `compact={!editing}`, so turning on
     *  Edit to change a text field also unfolded the entire brand editor. */
    compact?: boolean;
    /** Does this mount own the brand, or is it showing someone else's?
     *
     *  Only the brand book edits a brand. Everywhere else — project pages, org
     *  pages — the card is a snapshot: the same brand, read-only, with the
     *  pencil pointing at the book instead of unfolding an editor in place.
     *  Two editors for one brand meant two places to look for why a colour
     *  changed, and the project-page one had no room for the lockup grid.
     *
     *  This gates the editor structurally, not just visually: with
     *  `editable` false the editor branch never renders, so no host page can
     *  reach it by passing `compact={false}`. */
    editable?: boolean;
    onExpand?: () => void;
    /** Fired when the brand stops inheriting (either fork branch). The host
     *  needs this because provenance is rendered OUTSIDE this card — the brand
     *  book's "inherits from KLAK" bar kept saying so after the fork, which is
     *  precisely the kind of stale claim the book exists to prevent. */
    onForked?: () => void;
  } = $props();

  type BrandRow = {
    id: number;
    name?: string | null;
    parent_id?: number | { id?: number } | null;
    parent_organization?: number | { id?: number } | null;
    brand_logo?: string | null;
    brand_logo_inverted?: string | null;
    brand_logo_black?: string | null;
    brand_logo_landscape?: string | null;
    brand_logo_vertical?: string | null;
    brand_logo_simple?: string | null;
    brand_primary?: string | null;
    brand_action?: string | null;
    brand_text?: string | null;
    brand_text_muted?: string | null;
    brand_text_inverse?: string | null;
    brand_headline?: string | null;
    brand_bg_light?: string | null;
    brand_bg_dark?: string | null;
    brand_font?: string | null;
  };

  const owner = $derived<BrandOwner>({ kind, id: project.id, name: project.name ?? `#${project.id}` });

  /** One brand field, written to whichever collection owns it. */
  const saveField = async (field: Parameters<typeof saveBrandField>[1], value: string | null) => {
    await saveBrandField(owner, field, value);
    pulseSaved();
  };

  // Strip ⇄ sheet toggle (view mode only).
  let open = $state(false);

  // Click-to-copy for the sheet's colour tiles + logo URLs.
  let copiedHex = $state<string | null>(null);
  let copiedLogo = $state<LogoField | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let logoCopyTimer: ReturnType<typeof setTimeout> | null = null;
  async function copyHex(hex: string) {
    try {
      await navigator.clipboard.writeText(hex);
      copiedHex = hex;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copiedHex = null), 1500);
    } catch {
      // Clipboard blocked (non-secure context) — nothing to signal.
    }
  }
  async function copyLogoUrl(field: LogoField, id: string) {
    try {
      await navigator.clipboard.writeText(assetUrl(id));
      copiedLogo = field;
      if (logoCopyTimer) clearTimeout(logoCopyTimer);
      logoCopyTimer = setTimeout(() => (copiedLogo = null), 1500);
    } catch {
      // Clipboard blocked — nothing to signal.
    }
  }
  /** Directus forces an attachment download with `?download`. */
  function logoDownloadUrl(id: string): string {
    return assetUrl(id, { download: '' });
  }
  function logoDownloadName(field: LogoField): string {
    const role = LOGO_ROLES.find((r) => r.field === field);
    const base = (project.name ?? 'project').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase();
    return `${base}-${(role?.label ?? 'logo').toLowerCase().replace(/\s+/g, '-')}`;
  }

  // ── Handing the brand to someone ────────────────────────────────
  //
  // Two payloads, because introducing a brand and reminding someone of it
  // are different jobs. The brief is what you send a new designer or
  // agency once; the short one is what you paste into a thread when
  // someone asks "what's our red again".
  //
  // Asset links are stripped of the access token on purpose. assetUrl()
  // appends the static Directus token so <img> tags work, but a URL that
  // carries a credential must not travel into a chat window — and Directus
  // serves these files unauthenticated anyway, so the token buys nothing
  // here. The links still need the tailnet, which the text says.
  let copiedBrief = $state(false);
  let copiedShort = $state(false);
  let briefTimer: ReturnType<typeof setTimeout> | null = null;
  let shortTimer: ReturnType<typeof setTimeout> | null = null;

  /** Same as assetUrl(), minus the credential. */
  function publicAssetUrl(id: string): string {
    return `${assetUrl(id).split('?')[0]}`;
  }

  const brandName = $derived(project.name ?? 'This project');


  /** Where a facet actually came from, for the "(from X)" annotations. */
  function colorSource(f: ColorField): string {
    if (roleColors[f]) return '';
    const from = inheritedColor(f).from;
    return from ? `  (from ${from})` : '';
  }

  function buildBrief(): string {
    const L: string[] = [];
    L.push(`${brandName} — brand basics`);
    L.push('');
    L.push('COLOURS');
    for (const role of COLOR_ROLES) {
      const hex = effColor(role.field);
      if (!hex) continue;
      L.push(`  ${role.label.padEnd(20)}${hex}   ${role.hint}${colorSource(role.field)}`);
    }
    if (effFont) {
      L.push('');
      L.push('TYPE');
      L.push(`  ${effFont}`);
    }
    const logoLines: string[] = [];
    for (const role of LOGO_ROLES) {
      const id = effLogo(role.field);
      if (!id) continue;
      logoLines.push(`  ${role.label} — ${role.hint}`);
      logoLines.push(`    ${publicAssetUrl(id)}`);
    }
    if (logoLines.length > 0) {
      L.push('');
      L.push('LOGOS');
      L.push(...logoLines);
    }
    if (showAssets.length > 0) {
      L.push('');
      L.push('OTHER ASSETS');
      for (const a of showAssets) {
        if (!a.file_id) continue;
        L.push(`  ${a.label || 'Asset'}`);
        L.push(`    ${publicAssetUrl(a.file_id)}`);
      }
    }
    L.push('');
    L.push('Notes');
    L.push('  Text colour is derived from the background, never picked by hand.');
    L.push('  Use the Inverted logo on the inverse background, Original on the main one.');
    L.push('  Links open on the source instance.');
    return L.join('\n');
  }

  /** The refresher: colours and type, nothing else. */
  function buildShort(): string {
    const L = [brandName];
    for (const role of COLOR_ROLES) {
      const hex = effColor(role.field);
      if (hex) L.push(`${role.label}: ${hex}`);
    }
    if (effFont) L.push(`Type: ${effFont}`);
    return L.join('\n');
  }

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(buildBrief());
      copiedBrief = true;
      if (briefTimer) clearTimeout(briefTimer);
      briefTimer = setTimeout(() => (copiedBrief = false), 1800);
    } catch {
      error = 'Clipboard blocked — copy needs a secure context.';
    }
  }
  async function copyShort() {
    try {
      await navigator.clipboard.writeText(buildShort());
      copiedShort = true;
      if (shortTimer) clearTimeout(shortTimer);
      shortTimer = setTimeout(() => (copiedShort = false), 1800);
    } catch {
      error = 'Clipboard blocked — copy needs a secure context.';
    }
  }

  async function saveFont(v: string | null) {
    if (needsFork()) return;
    const value = v?.trim() || null;
    try {
      await saveField('brand_font', value);
      font = value;
    } catch (e) {
      error = formatError(e);
    }
  }

  // ── Font faces ──────────────────────────────────────────────────
  // brand_font is the NAME. These are the faces: an uploaded file for a
  // licensed or custom typeface, or a stylesheet URL for a publicly hosted
  // one. Either makes the brand book's specimen render for real instead of
  // approximating the brand in system-ui.
  let faces = $state<BrandFontFace[]>([]);
  let faceBusy = $state(false);
  let faceOpen = $state(false);
  let fFamily = $state('');
  let fRole = $state<BrandFontRole>('display');
  let fWeight = $state('');
  let fStyle = $state<'normal' | 'italic'>('normal');
  let fCssUrl = $state('');
  let fSourceUrl = $state('');
  let fLicense = $state('');
  let faceFileEl = $state<HTMLInputElement | undefined>();
  let pendingFile = $state<File | null>(null);

  async function reloadFaces() {
    faces = await listOwnFontFaces(owner.kind, owner.id);
  }

  function resetFaceForm() {
    fFamily = '';
    fRole = 'display';
    fWeight = '';
    fStyle = 'normal';
    fCssUrl = '';
    fSourceUrl = '';
    fLicense = '';
    pendingFile = null;
    if (faceFileEl) faceFileEl.value = '';
  }

  async function addFace() {
    if (needsFork()) return;
    const family = fFamily.trim();
    if (!family || faceBusy) return;
    faceBusy = true;
    error = '';
    try {
      let fileId: string | null = null;
      if (pendingFile) {
        fileId = await uploadFile(pendingFile, {
          title: `${project.name ?? 'project'} — ${family} ${fWeight || ''}`.trim()
        });
      }
      await createFontFace({
        owner_kind: owner.kind,
        owner_id: owner.id,
        family,
        role: fRole,
        weight: fWeight.trim() ? Number(fWeight) : null,
        style: fStyle,
        file_id: fileId,
        css_url: fCssUrl.trim() || null,
        source_url: fSourceUrl.trim() || null,
        license: fLicense.trim() || null
      });
      await reloadFaces();
      resetFaceForm();
      faceOpen = false;
      // The named typeface should agree with the faces attached to it.
      if (!font) await saveFont(family);
    } catch (e) {
      error = formatError(e);
    } finally {
      faceBusy = false;
    }
  }

  async function removeFace(id: number) {
    try {
      await deleteFontFace(id);
      await reloadFaces();
    } catch (e) {
      error = formatError(e);
    }
  }

  // ── Structured roles ────────────────────────────────────────────
  type LogoField = 'brand_logo' | 'brand_logo_inverted' | 'brand_logo_black' | 'brand_logo_landscape' | 'brand_logo_vertical' | 'brand_logo_simple';
  type ColorField = BrandColorField;

  // Backgrounds are named by FUNCTION, paired with their logo variant —
  // not by lightness. A dark-navy brand's *main* background is simply
  // dark; "light/dark mode" language would mislead here. (The underlying
  // fields keep their original names — labels only.)
  const LOGO_ROLES: Array<{ field: LogoField; label: string; hint: string; onDark: boolean }> = [
    { field: 'brand_logo', label: 'Original', hint: 'Full colour — lives on the main background', onDark: false },
    { field: 'brand_logo_inverted', label: 'Inverted', hint: 'Lives on the inverse background', onDark: true },
    { field: 'brand_logo_black', label: 'Flat black', hint: 'Edge cases (print, stamps, faxes…)', onDark: false },
    { field: 'brand_logo_landscape', label: 'Landscape', hint: 'Wide lockup — headers, navbars', onDark: false },
    { field: 'brand_logo_vertical', label: 'Vertical', hint: 'Stacked lockup — square-ish placements', onDark: false },
    { field: 'brand_logo_simple', label: 'Simple', hint: 'Mark only — favicons, avatars, small sizes', onDark: false }
  ];
  // Roles now live in brand.ts — grouped, each tied to the surface it is
  // read against, and marked with whether a blank value derives safely.
  const COLOR_ROLES = BRAND_COLOR_ROLES;

  // Own values (this project's row only).
  let logos = $state<Record<LogoField, string | null>>({
    brand_logo: project.brand_logo ?? null,
    brand_logo_inverted: project.brand_logo_inverted ?? null,
    brand_logo_black: project.brand_logo_black ?? null,
    brand_logo_landscape: project.brand_logo_landscape ?? null,
    brand_logo_vertical: project.brand_logo_vertical ?? null,
    brand_logo_simple: project.brand_logo_simple ?? null
  });
  let roleColors = $state<Record<ColorField, string | null>>({
    brand_primary: project.brand_primary ?? null,
    brand_action: project.brand_action ?? null,
    brand_bg_light: project.brand_bg_light ?? null,
    brand_bg_dark: project.brand_bg_dark ?? null,
    brand_text: project.brand_text ?? null,
    brand_text_muted: project.brand_text_muted ?? null,
    brand_text_inverse: project.brand_text_inverse ?? null,
    brand_headline: project.brand_headline ?? null
  });
  let font = $state<string | null>(project.brand_font ?? null);
  let assets = $state<ProjectBrandAsset[]>([]);
  // Inherited fallback — the parent chain's resolved brand.
  let inherited = $state<ResolvedBrand | null>(null);
  let error = $state('');
  let busy = $state(false);

  const parentId = $derived.by(() => {
    const p = kind === 'project' ? project.parent_id : project.parent_organization;
    if (p == null) return null;
    return typeof p === 'object' ? ((p as { id?: number }).id ?? null) : (p as number);
  });

  onMount(async () => {
    try {
      // The asset gallery is a project_brand_asset table; organizations
      // have no equivalent yet, so they simply get no gallery.
      if (kind === 'project') assets = await listProjectBrandAssets(project.id);
    } catch {
      // gallery stays empty — the card still works for colors/logo
    }
    try {
      await reloadPalette();
    } catch {
      // brand_palette_color may not exist yet.
    }
    try {
      await reloadCells();
    } catch {
      // brand_logo_asset may not exist yet; legacy columns still resolve.
    }
    try {
      await reloadFaces();
    } catch {
      // brand_font_face may not exist yet; the rest of the card is fine.
    }
    try {
      await reloadElements();
    } catch {
      // brand_element may not exist yet; the rest of the card is fine.
    }
    // Only resolve the parent when this brand actually inherits. A standalone
    // brand has no inherited values, and resolving them anyway is what kept
    // "from KLAK" badges and a 5/8 colour count on screen after choosing
    // "Start from scratch" — the flag was set, the display just never asked.
    if (parentId != null && !(await isBrandStandalone(kind, project.id).catch(() => false))) {
      try {
        inherited = await resolveBrand(kind, parentId);
      } catch {
        inherited = null;
      }
    } else {
      inherited = null;
    }
    await refreshInheritance();
  });

  // ── Adoption ──────────────────────────────────────────────────────────
  // Editing a scalar field here always wrote an override, so colours were
  // never at risk. The row-backed lists were: palette, logo cells and the
  // asset gallery all render the ANCESTOR's rows, and their remove buttons
  // deleted by id. Rather than make each control cleverer, the fork is now
  // explicit — take a copy, then edit freely.
  let inheritedFrom = $state<string | null>(null);
  let adopting = $state(false);
  let adoptedNote = $state('');

  /** The fork question, shown once on the first edit of an inherited brand. */
  let forkAsk = $state(false);
  let forking = $state<null | 'copy' | 'scratch'>(null);
  /** So the question is asked once per mount, not re-asked on every keystroke
   *  after "Keep inheriting". */
  let forkAsked = $state(false);

  /**
   * Gate every mutation while the brand still belongs to a parent.
   *
   * Returns true when the caller should stop and let the user answer first.
   * This is what makes the fork unavoidable-but-not-nagging: nothing asks until
   * you actually try to change something, and once answered (either way) it
   * never asks again this session.
   */
  function needsFork(): boolean {
    if (!inheritedFrom) return false;
    if (forkAsked) return false;
    forkAsk = true;
    forkAsked = true;
    return true;
  }

  async function afterFork() {
    // Every list was rendering the ancestor's rows; they all have to be
    // re-read against rows we now own or the Remove buttons stay hidden.
    if (kind === 'project') assets = await listProjectBrandAssets(project.id).catch(() => assets);
    await reloadPalette().catch(() => undefined);
    await reloadCells().catch(() => undefined);
    await reloadFaces().catch(() => undefined);
    await reloadElements().catch(() => undefined);
    const fresh = await resolveBrand(kind, project.id).catch(() => null);
    if (fresh) {
      for (const r of BRAND_COLOR_ROLES) roleColors[r.field] = fresh.colors[r.field];
      for (const r of LOGO_ROLES) logos[r.field] = fresh.logos[r.field];
    }
    // Nothing is inherited any more, either because it was copied down or
    // because the brand is deliberately empty. Keeping the parent's snapshot
    // would leave every field showing a value this brand does not have.
    inherited = null;
    await refreshInheritance();
    forkAsk = false;
    pulseSaved();
    onForked?.();
  }

  async function forkFromParent() {
    if (forking) return;
    forking = 'copy';
    error = '';
    try {
      const s = await forkBrandFromParent(kind, project.id);
      const bits: string[] = [];
      if (s.colors) bits.push(`${s.colors} colour${s.colors === 1 ? '' : 's'}`);
      if (s.logoFields + s.logoRows) bits.push(`${s.logoFields + s.logoRows} logo${s.logoFields + s.logoRows === 1 ? '' : 's'}`);
      if (s.paletteRows) bits.push(`${s.paletteRows} extra colour${s.paletteRows === 1 ? '' : 's'}`);
      if (s.fontFaces) bits.push(`${s.fontFaces} font file${s.fontFaces === 1 ? '' : 's'}`);
      if (s.font) bits.push('the typeface');
      if (s.assets) bits.push(`${s.assets} asset${s.assets === 1 ? '' : 's'}`);
      await afterFork();
      adoptedNote = bits.length > 0
        ? `Copied ${bits.join(', ')}. This ${kind} no longer inherits — edit and remove freely.`
        : `This ${kind} now has its own brand.`;
    } catch (e) {
      error = formatError(e);
    } finally {
      forking = null;
    }
  }

  async function forkFromScratch() {
    if (forking) return;
    forking = 'scratch';
    error = '';
    try {
      await startBrandFromScratch(kind, project.id);
      await afterFork();
      adoptedNote = `Starting from scratch — nothing is inherited. Add a logo or a colour to begin.`;
    } catch (e) {
      error = formatError(e);
    } finally {
      forking = null;
    }
  }

  async function refreshInheritance() {
    try {
      const r = await brandInheritance(kind, project.id);
      inheritedFrom = r.inherited ? (r.from ?? 'a parent') : null;
    } catch {
      inheritedFrom = null;
    }
  }

  async function adopt() {
    if (adopting) return;
    adopting = true;
    error = '';
    adoptedNote = '';
    try {
      const s = await adoptBrand(kind, project.id);
      const bits: string[] = [];
      if (s.colors) bits.push(`${s.colors} colour${s.colors === 1 ? '' : 's'}`);
      if (s.logoFields + s.logoRows) bits.push(`${s.logoFields + s.logoRows} logo${s.logoFields + s.logoRows === 1 ? '' : 's'}`);
      if (s.paletteRows) bits.push(`${s.paletteRows} palette colour${s.paletteRows === 1 ? '' : 's'}`);
      if (s.fontFaces) bits.push(`${s.fontFaces} font file${s.fontFaces === 1 ? '' : 's'}`);
      if (s.font) bits.push('the typeface');
      if (s.assets) bits.push(`${s.assets} asset${s.assets === 1 ? '' : 's'}`);

      // Reload every list so the controls now point at rows we own.
      if (kind === 'project') assets = await listProjectBrandAssets(project.id).catch(() => assets);
      await reloadPalette().catch(() => undefined);
      await reloadCells().catch(() => undefined);
      await reloadFaces().catch(() => undefined);
      const fresh = await resolveBrand(kind, project.id).catch(() => null);
      if (fresh) {
        for (const r of BRAND_COLOR_ROLES) roleColors[r.field] = fresh.colors[r.field];
        for (const r of LOGO_ROLES) logos[r.field] = fresh.logos[r.field];
      }
      await refreshInheritance();
      adoptedNote = bits.length > 0
        ? `Copied ${bits.join(', ')} onto this ${kind}. Edits here no longer touch the parent.`
        : 'Nothing left to copy — this brand is already its own.';
      pulseSaved();
    } catch (e) {
      error = formatError(e);
    } finally {
      adopting = false;
    }
  }

  // Inherited lookups per role field. resolveBrand keys everything by the
  // field name, so these are lookups rather than the switch this used to be.
  function inheritedLogo(field: LogoField): { id: string | null; from: string | null } {
    if (!inherited) return { id: null, from: null };
    return { id: inherited.logos[field], from: inherited.logoFrom[field]?.name ?? null };
  }
  function inheritedColor(field: ColorField): { hex: string | null; from: string | null } {
    if (!inherited) return { hex: null, from: null };
    return { hex: inherited.colors[field], from: inherited.colorFrom[field]?.name ?? null };
  }

  // ── Logo roles ──────────────────────────────────────────────────
  let logoFileEls = $state<Partial<Record<LogoField, HTMLInputElement>>>({});
  async function uploadLogoRole(field: LogoField, file: File) {
    if (needsFork()) return;
    busy = true;
    error = '';
    try {
      const role = LOGO_ROLES.find((r) => r.field === field)!;
      const id = await uploadFile(file, { title: `${project.name ?? 'project'} — logo (${role.label.toLowerCase()})` });
      await saveField(field, id);
      logos = { ...logos, [field]: id };
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = false;
    }
  }
  async function removeLogoRole(field: LogoField) {
    if (needsFork()) return;
    try {
      await saveField(field, null);
      logos = { ...logos, [field]: null };
    } catch (e) {
      error = formatError(e);
    }
  }

  // ── Colour roles ────────────────────────────────────────────────
  async function saveColorRole(field: ColorField, hex: string | null) {
    if (needsFork()) return;
    const v = hex ? hex.toUpperCase() : null;
    if (v && !/^#[0-9A-F]{6}$/.test(v)) {
      error = 'Colors need a #RRGGBB hex value.';
      return;
    }
    error = '';
    const prev = roleColors[field];
    roleColors = { ...roleColors, [field]: v };
    try {
      await saveField(field, v);
    } catch (e) {
      roleColors = { ...roleColors, [field]: prev };
      error = formatError(e);
    }
  }

  // ── Asset gallery ───────────────────────────────────────────────
  let assetFileEl: HTMLInputElement | undefined = $state();
  async function uploadAssets(files: FileList) {
    busy = true;
    error = '';
    try {
      for (const file of files) {
        const id = await uploadFile(file, { title: `${project.name ?? 'project'} — brand asset` });
        const row = await addProjectBrandAsset({
          project_id: project.id,
          file_id: id,
          label: file.name.replace(/\.[a-z0-9]+$/i, '')
        });
        assets = [...assets, row];
      }
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = false;
    }
  }
  async function relabel(a: ProjectBrandAsset, label: string) {
    const v = label.trim() || null;
    if ((a.label ?? null) === v) return;
    try {
      await updateProjectBrandAsset(a.id, { label: v });
      assets = assets.map((x) => (x.id === a.id ? { ...x, label: v } : x));
    } catch (e) {
      error = formatError(e);
    }
  }
  async function removeAsset(a: ProjectBrandAsset) {
    // showAssets falls back to the ancestor's list, so a row here may not be
    // ours. `assetsInherited` was already computed below and simply never
    // consulted — this is the third place the same id-without-ownership bug
    // reached through to the parent.
    if (assetsInherited) {
      error = 'That asset belongs to the parent brand. Adopt the brand here first.';
      return;
    }
    if (!confirm(`Remove "${a.label ?? 'asset'}" from the brand gallery?`)) return;
    try {
      await deleteProjectBrandAsset(a.id);
      assets = assets.filter((x) => x.id !== a.id);
    } catch (e) {
      error = formatError(e);
    }
  }
  const showAssets = $derived(assets.length > 0 ? assets : (inherited?.assets ?? []));
  const assetsInherited = $derived(assets.length === 0 && (inherited?.assets.length ?? 0) > 0);
  const assetsSource = $derived(
    assetsInherited ? (inherited?.assetsFrom?.name ?? 'parent') : null
  );

  // ── Theme-aware preview ─────────────────────────────────────────
  // Composes the effective (own ?? inherited) roles into a mock
  // placement so you see exactly what a landing page would apply:
  // background per theme, derived text colour, matching logo variant,
  // and a primary-coloured CTA.
  let previewTheme = $state<'light' | 'dark'>('light');
  const effLogo = (f: LogoField) => logos[f] ?? inheritedLogo(f).id;
  const effColor = (f: ColorField) => roleColors[f] ?? inheritedColor(f).hex;
  const effFont = $derived(font ?? inherited?.font ?? null);

  // ── Logo grid ───────────────────────────────────────────────────
  // Lockup × treatment, because those are two independent decisions: what
  // SHAPE fits the space, and what COLOUR survives the background. The old
  // six-slot list gave the primary lockup all three treatments and left
  // landscape, vertical and mark with one each, which is not a brand system
  // — it is the shape of the columns leaking into the UI.
  let cells = $state<Map<string, LogoCell>>(new Map());
  let logoBusy = $state(false);
  let pickerFor = $state<LogoLockup | null>(null);
  let pendingCell = $state<{ lockup: LogoLockup; treatment: LogoTreatment } | null>(null);
  let cellFileEl = $state<HTMLInputElement | undefined>();

  async function reloadCells() {
    cells = await resolveLogoAssets(owner.kind, owner.id);
  }

  const cellAt = (l: LogoLockup, t: LogoTreatment) => cells.get(cellKey(l, t)) ?? null;
  const filledIn = (l: LogoLockup) => LOGO_TREATMENTS.filter((t) => !!cellAt(l, t.value)).length;

  /** Lockups worth showing: any with a file, plus Primary always. The rest
   *  live behind "Add a version" so an empty brand is not a wall of slots. */
  const shownLockups = $derived(
    LOGO_LOCKUPS.filter((l) => l.value === 'primary' || filledIn(l.value) > 0)
  );
  const hiddenLockups = $derived(LOGO_LOCKUPS.filter((l) => !shownLockups.includes(l)));

  function openPicker(lockup: LogoLockup) {
    pickerFor = pickerFor === lockup ? null : lockup;
  }

  /** Pick a cell, then immediately ask for the file — two dialogs in a row
   *  is worse than one, so the treatment choice IS the upload trigger. */
  function chooseCell(lockup: LogoLockup, treatment: LogoTreatment) {
    pendingCell = { lockup, treatment };
    pickerFor = null;
    cellFileEl?.click();
  }

  async function uploadCell(file: File) {
    const target = pendingCell;
    if (!target) return;
    if (needsFork()) return;
    logoBusy = true;
    error = '';
    try {
      const lock = LOGO_LOCKUPS.find((l) => l.value === target.lockup)!;
      const treat = LOGO_TREATMENTS.find((t) => t.value === target.treatment)!;
      const fileId = await uploadFile(file, {
        title: `${owner.name} — logo (${lock.label.toLowerCase()}, ${treat.label.toLowerCase()})`
      });
      // Keep writing the legacy column when the cell has one, so the older
      // readers (image studio, evergreen) keep seeing the brand.
      const legacy = legacyFieldFor(target.lockup, target.treatment);
      if (legacy) {
        await saveField(legacy, fileId);
        logos = { ...logos, [legacy]: fileId };
      } else {
        await createLogoAsset({
          owner_kind: owner.kind,
          owner_id: owner.id,
          lockup: target.lockup,
          treatment: target.treatment,
          file_id: fileId
        });
        pulseSaved();
      }
      await reloadCells();
    } catch (e) {
      error = formatError(e);
    } finally {
      logoBusy = false;
      pendingCell = null;
    }
  }

  async function clearCell(cell: LogoCell) {
    if (needsFork()) return;
    logoBusy = true;
    error = '';
    try {
      if (cell.legacy) {
        const legacy = legacyFieldFor(cell.lockup, cell.treatment);
        if (legacy) {
          await saveField(legacy, null);
          logos = { ...logos, [legacy]: null };
        }
      } else if (cell.rowId != null) {
        // Same ownership rule as the palette: an inherited cell carries the
        // ancestor's row id, and deleting it would clear the parent's logo.
        if (cell.from && cell.from.id !== owner.id) {
          error = 'That logo belongs to the parent brand. Adopt the brand here first, or upload your own into this cell.';
          return;
        }
        await deleteLogoAsset(cell.rowId);
        pulseSaved();
      }
      await reloadCells();
    } catch (e) {
      error = formatError(e);
    } finally {
      logoBusy = false;
    }
  }

  // ── Palette ─────────────────────────────────────────────────────
  // What the brand owns, as opposed to what each colour is for. Entries are
  // base + "(+)" pairs, mirroring how the guidelines are actually drawn.
  let palette = $state<PaletteColor[]>([]);
  let paletteFrom = $state<string | null>(null);
  let palOpen = $state(false);
  let palName = $state('');
  let palGroup = $state<PaletteGroup>('support');
  let palHex = $state('#FF5E72');
  let palStrong = $state<string | null>(null);
  let palBusy = $state(false);

  async function reloadPalette() {
    const r = await resolvePalette(owner.kind, owner.id);
    palette = r.colors;
    paletteFrom = r.from && r.from.id !== owner.id ? r.from.name : null;
  }

  /**
   * What a role actually resolves to, including its automatic answer.
   *
   * Three ways a role gets a value, in order: set here, inherited, or —
   * only for the roles marked `derive`/`follows` — computed. The UI has to
   * tell those apart, because "derived" is a safe default the brand has not
   * actually chosen, and that is exactly what a brand book should not
   * silently present as a decision.
   */
  function roleValue(field: ColorField): { hex: string | null; auto: boolean } {
    const own = roleColors[field];
    if (own) return { hex: own, auto: false };
    const inh = inheritedColor(field).hex;
    if (inh) return { hex: inh, auto: false };

    const role = COLOR_ROLES.find((r) => r.field === field);
    if (role?.follows) {
      const f = roleValue(role.follows);
      if (f.hex) return { hex: f.hex, auto: true };
    }
    if (role?.derive) {
      const bg = role.on === 'dark' ? surfaceInverse : surface;
      return { hex: textColorFor(bg), auto: true };
    }
    return { hex: null, auto: false };
  }

  // One role open at a time. Eight roles each showing an editor, a demo and
  // a paragraph measured 1,873px tall — the guidance drowned the editing.
  // Collapsed rows carry the whole status (value, source, verdict) in one
  // line; the demo and the explanation appear only for the row you are
  // actually working on, which is the only row they were ever FOR.
  let openRole = $state<ColorField | null>(null);

  const surface = $derived(effColor('brand_bg_light') ?? '#FFFFFF');
  const surfaceInverse = $derived(effColor('brand_bg_dark') ?? '#16181D');

  function resetPal() {
    palName = '';
    palGroup = 'support';
    palHex = '#FF5E72';
    palStrong = null;
  }

  async function addPaletteColor() {
    if (needsFork()) return;
    const name = palName.trim();
    if (!name || palBusy) return;
    palBusy = true;
    error = '';
    try {
      await createPaletteColor({
        owner_kind: owner.kind,
        owner_id: owner.id,
        name,
        group: palGroup,
        hex: palHex,
        hex_strong: palStrong,
        sort: palette.length
      });
      await reloadPalette();
      resetPal();
      palOpen = false;
      pulseSaved();
    } catch (e) {
      error = formatError(e);
    } finally {
      palBusy = false;
    }
  }

  /** Rows we did not create must never be deleted from here. The palette list
   *  renders the ANCESTOR's rows when the palette is inherited, so an id alone
   *  is not proof of ownership — this is the guard that stops a swatch removed
   *  on a sub-project disappearing from the parent and every sibling. */
  function ownsPaletteRow(c: PaletteColor): boolean {
    return c.id > 0 && c.owner_kind === owner.kind && c.owner_id === owner.id;
  }

  async function removePaletteColor(id: number) {
    if (id < 0) return; // legacy JSON entry, not a row
    const row = palette.find((c) => c.id === id);
    if (!row || !ownsPaletteRow(row)) {
      error = 'That colour belongs to the parent brand. Adopt the brand here first.';
      return;
    }
    try {
      await deletePaletteColor(id);
      await reloadPalette();
      pulseSaved();
    } catch (e) {
      error = formatError(e);
    }
  }

  /** Roles pick FROM the palette — that is where coherence comes from. */
  const paletteOptions = $derived.by(() => {
    // `key` is structural (row id + which slot), not the colour or the name.
    // Two rows can share a hex, and a row's name can be blank, so a key built
    // from those values is not unique — and a duplicate key is a thrown error
    // that blanks the whole page, not a cosmetic glitch.
    const out: Array<{ hex: string; label: string; key: string }> = [];
    for (const c of palette) {
      out.push({ hex: c.hex, label: c.name, key: `${c.id}-base` });
      if (c.hex_strong) out.push({ hex: c.hex_strong, label: `${c.name} (+)`, key: `${c.id}-strong` });
    }
    return out;
  });


  // ── Brand elements ──────────────────────────────────────────────────
  // Patterns, gradients, graphic elements and photography direction. Same
  // ownership rule as the palette: an inherited row carries the ancestor's id,
  // so removing it here would strip it from every brand inheriting it.
  let elements = $state<BrandElement[]>([]);
  let elementsFrom = $state<string | null>(null);
  let elBusy = $state(false);
  let elFileEl = $state<HTMLInputElement | undefined>();
  let elPendingFor = $state<number | 'new' | null>(null);

  // Draft for the add form.
  let elOpen = $state(false);
  let elKind = $state<BrandElementKind>('pattern');
  let elName = $state('');
  let elNotes = $state('');
  /** Bound to an <input type="number">, so Svelte hands back a NUMBER (or null
   *  when empty) — not the string it looks like. Typing it as a string and
   *  calling .trim() on it threw "$.get(...).trim is not a function" and the
   *  save silently failed. */
  let elTile = $state<number | null>(null);
  let elOnDark = $state(false);
  let elFileId = $state<string | null>(null);
  let elAngle = $state(180);
  let elStops = $state<GradientStop[]>([
    { hex: '#FF5E72', pos: 0 },
    { hex: '#2D2D2D', pos: 100 }
  ]);

  const elDraftCss = $derived(gradientCss({ gradient_stops: elStops, gradient_angle: elAngle }));

  async function reloadElements() {
    const r = await resolveElements(kind, project.id);
    elements = r.elements;
    elementsFrom = r.from && r.from.id !== project.id ? r.from.name : null;
  }

  function ownsElement(el: BrandElement): boolean {
    return el.owner_kind === kind && el.owner_id === project.id;
  }

  function resetEl() {
    elKind = 'pattern';
    elName = '';
    elNotes = '';
    elTile = null;
    elOnDark = false;
    elFileId = null;
    elAngle = 180;
    elStops = [
      { hex: '#FF5E72', pos: 0 },
      { hex: '#2D2D2D', pos: 100 }
    ];
  }

  /** One hidden input for every upload here; the target is chosen first. */
  function pickElFile(target: number | 'new') {
    elPendingFor = target;
    elFileEl?.click();
  }

  async function onElFile(file: File) {
    const target = elPendingFor;
    elPendingFor = null;
    if (target == null) return;
    if (target !== 'new' && needsFork()) return;
    elBusy = true;
    error = '';
    try {
      const fileId = await uploadFile(file, { title: `${owner.name} — ${elName || 'brand element'}` });
      if (target === 'new') {
        elFileId = fileId;
      } else {
        await updateBrandElement(target, { file_id: fileId });
        await reloadElements();
        pulseSaved();
      }
    } catch (e) {
      error = formatError(e);
    } finally {
      elBusy = false;
    }
  }

  async function addElement() {
    if (needsFork()) return;
    const name = elName.trim();
    if (!name) {
      error = 'Give it a name — "Diagonal stripes" beats "Pattern 3" when someone else opens the book.';
      return;
    }
    // A pattern or graphic with no artwork is an empty frame in the book, and
    // a gradient needs two stops before there is anything to render.
    if (elKind !== 'gradient' && !elFileId) {
      error = 'Add the artwork first — there is nothing to show without it.';
      return;
    }
    if (elKind === 'gradient' && !elDraftCss) {
      error = 'A gradient needs at least two valid colour stops.';
      return;
    }
    elBusy = true;
    error = '';
    try {
      await createBrandElement({
        owner_kind: kind,
        owner_id: project.id,
        kind: elKind,
        name,
        notes: elNotes.trim() || null,
        file_id: elFileId,
        gradient_stops: elKind === 'gradient' ? elStops : null,
        gradient_angle: elKind === 'gradient' ? elAngle : null,
        tile_width: elKind === 'pattern' && Number(elTile) > 0 ? Number(elTile) : null,
        on_dark: elOnDark,
        sort: elements.length
      });
      await reloadElements();
      resetEl();
      elOpen = false;
      pulseSaved();
    } catch (e) {
      error = formatError(e);
    } finally {
      elBusy = false;
    }
  }

  async function removeElement(el: BrandElement) {
    if (needsFork()) return;
    if (!ownsElement(el)) {
      error = 'That element belongs to the parent brand. Start your own brand here first.';
      return;
    }
    elBusy = true;
    error = '';
    try {
      await deleteBrandElement(el.id);
      await reloadElements();
      pulseSaved();
    } catch (e) {
      error = formatError(e);
    } finally {
      elBusy = false;
    }
  }

  function addStop() {
    const last = elStops[elStops.length - 1];
    elStops = [...elStops, { hex: last?.hex ?? '#888888', pos: 100 }];
  }
  function removeStop(i: number) {
    if (elStops.length <= 2) return; // two is the minimum for a gradient
    elStops = elStops.filter((_, x) => x !== i);
  }

  // ── Editor sections ─────────────────────────────────────────────
  // One long form with six upload slots, three colour pickers, a typeface
  // and a face list means everything competes and nothing reads as "the
  // thing I am doing now". The pattern that solves it is the one theme
  // customizers and design-tool inspectors converged on: pin the artefact
  // and the exit, show ONE group at a time, and put progress on the tabs so
  // choosing a group is an informed choice rather than a guess.
  type Section = 'logos' | 'colour' | 'type' | 'elements' | 'assets';
  let section = $state<Section>('logos');

  const logosSet = $derived(cells.size);
  const coloursSet = $derived(COLOR_ROLES.filter((r) => !!effColor(r.field)).length);
  const typeSet = $derived((effFont ? 1 : 0) + faces.length);

  const SECTIONS = $derived.by(() => {
    const out: Array<{ value: Section; label: string; done: number; of: number | null }> = [
      { value: 'logos', label: 'Logos', done: logosSet, of: null },
      { value: 'colour', label: 'Colour', done: coloursSet, of: COLOR_ROLES.length },
      { value: 'type', label: 'Type', done: typeSet, of: null },
      { value: 'elements', label: 'Elements', done: elements.length, of: null }
    ];
    // Organizations have no asset table, so the tab would lead nowhere.
    if (kind === 'project') out.push({ value: 'assets', label: 'Assets', done: showAssets.length, of: null });
    return out;
  });

  // Every field here saves on its own the moment it changes, which is
  // invisible — and an editor that gives no sign it worked gets clicked
  // twice. One shared pulse, announced politely for screen readers.
  let savedAt = $state(0);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function pulseSaved() {
    savedAt = Date.now();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => (savedAt = 0), 2000);
  }


  const isEmpty = $derived(
    LOGO_ROLES.every((r) => !logos[r.field]) &&
    !roleColors.brand_primary && !roleColors.brand_bg_light && !roleColors.brand_bg_dark &&
    showAssets.length === 0 &&
    !inheritedLogo('brand_logo').id
  );

  // The Brand book button wears the brand's own primary, so it is a sample
  // of the thing it opens. Falls back to the app colour before a palette
  // exists — a colourless button still has to be legible.
  const bookBg = $derived(effColor('brand_primary') ?? 'var(--brand, #2f7d7d)');
  const bookFg = $derived(effColor('brand_primary') ? textColorFor(effColor('brand_primary')!) : '#FFFFFF');
  const previewBg = $derived(
    previewTheme === 'dark'
      ? (effColor('brand_bg_dark') ?? '#16181D')
      : (effColor('brand_bg_light') ?? '#FFFFFF')
  );
  const previewText = $derived(textColorFor(previewBg));
  // Dark theme wants the inverted mark (original as a last resort);
  // light theme the original (flat black as a last resort).
  const previewLogo = $derived(
    previewTheme === 'dark'
      ? (effLogo('brand_logo_inverted') ?? effLogo('brand_logo'))
      : (effLogo('brand_logo') ?? effLogo('brand_logo_black'))
  );
  const previewPrimary = $derived(effColor('brand_primary'));
  const hasPreview = $derived(
    !!previewLogo || !!previewPrimary ||
    !!effColor('brand_bg_light') || !!effColor('brand_bg_dark')
  );

  // Anything set (own or inherited) worth showing in the view-mode strip?
  const hasAnyBrand = $derived(
    LOGO_ROLES.some((r) => !!effLogo(r.field)) ||
    !!effColor('brand_primary') || !!effColor('brand_bg_light') || !!effColor('brand_bg_dark') ||
    showAssets.length > 0
  );
  /** Keyed by ROLE, never by hex. Two roles sharing one colour is normal — a
   *  dark grey doing duty as both body text and a dark background — and keying
   *  the strip by hex made that a duplicate key, which Svelte throws on. The
   *  throw unmounts the whole page tree, so one repeated colour in a palette
   *  turned the entire project page blank. */
  const stripSwatches = $derived(
    COLOR_ROLES
      .map((r) => ({ field: r.field, hex: effColor(r.field) }))
      .filter((s): s is { field: BrandColorField; hex: string } => !!s.hex)
  );
  /** Everything shown comes from an ancestor — surface where. */
  const allInherited = $derived(
    LOGO_ROLES.every((r) => !logos[r.field]) &&
    !roleColors.brand_primary && !roleColors.brand_bg_light && !roleColors.brand_bg_dark &&
    assets.length === 0
  );
  const stripSource = $derived(
    allInherited
      ? (inheritedLogo('brand_logo').from ?? inheritedColor('brand_primary').from ?? null)
      : null
  );
</script>

{#snippet inheritedBadge(source: string)}
  <span
    class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
    style="background: var(--bg-tertiary); color: var(--text-secondary);"
    title="Inherited — set a value here to override"
  >from {source}</span>
{/snippet}

{#snippet brandPreview()}
  <!-- Theme-aware preview — how the roles compose on a real placement. -->
  {#if hasPreview}
    <div>
      <div class="mb-1.5 flex items-center justify-between gap-2">
        <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Preview</span>
        <div class="flex items-center gap-1 rounded-full border border-surface-border p-0.5" role="radiogroup" aria-label="Preview theme">
          {#each ['light', 'dark'] as t (t)}
            <button
              type="button"
              role="radio"
              aria-checked={previewTheme === t}
              class="cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-medium transition {previewTheme === t ? 'bg-brand text-white' : 'text-ink-500 hover:text-ink-900'}"
              onclick={() => (previewTheme = t as 'light' | 'dark')}
            >{t === 'light' ? 'Main' : 'Inverse'}</button>
          {/each}
        </div>
      </div>
      <div
        class="rounded-[12px] border border-surface-border p-5 transition-colors"
        style="background: {previewBg}; color: {previewText};"
        data-testid="brand-preview"
      >
        {#if previewLogo}
          <img
            src={assetUrl(previewLogo, { width: 320, height: 320, fit: 'contain' })}
            alt="Logo on {previewTheme} background"
            class="mb-3 h-12 w-auto max-w-[60%] object-contain object-left"
          />
        {/if}
        <div class="font-display text-lg font-bold" style="letter-spacing: -0.02em;">
          {project.name ?? 'Project name'}
        </div>
        <p class="mt-1 max-w-[36ch] text-xs" style="opacity: 0.75;">
          Body text uses the derived colour — {previewText} on {previewBg}. Swap
          between main and inverse to check both placements.
        </p>
        {#if previewPrimary}
          <span
            class="mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold"
            style="background: {previewPrimary}; color: {textColorFor(previewPrimary)};"
          >Primary action</span>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

{#if compact || !editable}
  <!-- View mode. Collapsed: a glanceable strip (logo + role swatches +
       source). Tap → expands a READ-ONLY brand sheet in place — still
       view mode; the sheet's pencil is the explicit hand-off to Edit
       mode. Renders nothing when no brand is set anywhere up the chain. -->
  {#if hasAnyBrand}
    {#if !open}
      <button
        type="button"
        class="card flex w-full cursor-pointer items-center gap-3 p-3 text-left transition hover:bg-surface-hover"
        title="Show the brand sheet"
        onclick={() => (open = true)}
      >
        {#if effLogo('brand_logo')}
          <img
            src={assetUrl(effLogo('brand_logo'), { width: 96, height: 96, fit: 'contain' })}
            alt="Brand logo"
            class="h-8 w-8 shrink-0 rounded object-contain p-0.5"
            style="background: var(--bg-tertiary);"
          />
        {:else}
          <span class="grid h-8 w-8 shrink-0 place-items-center rounded text-ink-300" style="background: var(--bg-tertiary);">
            <Icon name="sparkles" size={14} />
          </span>
        {/if}
        <span class="text-sm font-medium text-ink-900">Brand</span>
        {#if stripSwatches.length > 0}
          <span class="flex items-center gap-1">
            {#each stripSwatches as s (s.field)}
              <span class="h-4 w-4 rounded-full border border-surface-border" style="background: {s.hex};"></span>
            {/each}
          </span>
        {/if}
        {#if stripSource}{@render inheritedBadge(stripSource)}{/if}
        <Icon name="chevron-right" size={14} class="ml-auto shrink-0 text-ink-300" />
      </button>
    {:else}
      <!-- Read-only brand sheet: what the brand IS, no editing surface. -->
      <div class="card p-4 space-y-4">
        <div class="flex items-center gap-2">
          <span class="card-title"><Icon name="sparkles" size={16} /> Brand</span>
          <div class="ml-auto flex items-center gap-1">
            <!-- Two payloads: the brief introduces the brand to someone
                 who has never seen it; the short one reminds a team that
                 already has. Same data, different job. -->
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-[11px] font-medium text-ink-700 hover:bg-surface-hover"
              title="Copy a full brand brief — colours, type, logo links and how to use them"
              onclick={copyBrief}
            ><Icon name={copiedBrief ? 'check' : 'copy'} size={12} /> {copiedBrief ? 'Copied' : 'Brief'}</button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-[11px] font-medium text-ink-700 hover:bg-surface-hover"
              title="Copy just the colours and the typeface — a refresher for people who know the brand"
              onclick={copyShort}
            ><Icon name={copiedShort ? 'check' : 'copy'} size={12} /> {copiedShort ? 'Copied' : 'Colours'}</button>
            <!-- The brand's own primary, not the app's: the button is a
                 sample of the thing it opens. Falls back to the app brand
                 colour when the palette has no primary yet. -->
            <a
              class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold no-underline"
              style="background: {bookBg}; color: {bookFg};"
              href={brandBookHref(owner.kind, owner.id)}
              title="Open the full brand book"
            ><Icon name="book-open" size={12} /> Brand book</a>
            {#if editable}
              <button
                type="button"
                class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-ink-400 hover:bg-surface-hover hover:text-ink-900"
                title="Edit the brand"
                aria-label="Edit the brand"
                onclick={() => onExpand?.()}
              ><Icon name="pencil" size={14} /></button>
            {:else}
              <!-- The brand is edited in one place. This goes there rather
                   than opening a second editor over a snapshot. -->
              <a
                class="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-400 no-underline hover:bg-surface-hover hover:text-ink-900"
                href={brandBookHref(owner.kind, owner.id)}
                title="Edit in the brand book"
                aria-label="Edit in the brand book"
              ><Icon name="pencil" size={14} /></a>
            {/if}
            <button
              type="button"
              class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-ink-400 hover:bg-surface-hover hover:text-ink-900"
              title="Collapse"
              aria-label="Collapse brand sheet"
              onclick={() => (open = false)}
            ><Icon name="x" size={14} /></button>
          </div>
        </div>

        <!-- Logos (effective values only) -->
        {#if LOGO_ROLES.some((r) => !!effLogo(r.field))}
          <div class="grid grid-cols-3 gap-2">
            {#each LOGO_ROLES as role (role.field)}
              {@const shown = effLogo(role.field)}
              {#if shown}
                <div class="rounded-[10px] border border-surface-border p-2 text-center">
                  <img
                    src={assetUrl(shown, { width: 160, height: 160, fit: 'contain' })}
                    alt="{role.label} logo"
                    class="mx-auto h-12 w-full rounded object-contain p-1"
                    style="background: {role.onDark ? (effColor('brand_bg_dark') ?? '#16181D') : (effColor('brand_bg_light') ?? 'var(--bg-tertiary)')};"
                  />
                  <div class="mt-1 text-[10px] text-ink-500">{role.label}</div>
                  <div class="mt-1 flex items-center justify-center gap-1">
                    <a
                      href={logoDownloadUrl(shown)}
                      download={logoDownloadName(role.field)}
                      class="inline-flex h-6 w-6 items-center justify-center rounded text-ink-400 transition hover:bg-surface-hover hover:text-ink-900"
                      title="Download {role.label} logo"
                      aria-label="Download {role.label} logo"
                    ><Icon name="download" size={13} /></a>
                    <button
                      type="button"
                      class="inline-flex h-6 w-6 items-center justify-center rounded text-ink-400 transition hover:bg-surface-hover hover:text-ink-900"
                      title="Copy image URL"
                      aria-label="Copy {role.label} logo URL"
                      onclick={() => copyLogoUrl(role.field, shown)}
                    ><Icon name={copiedLogo === role.field ? 'check' : 'copy'} size={13} /></button>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        {/if}

        <!-- Colour roles — big copyable tiles: tap a colour to copy its hex. -->
        {#if stripSwatches.length > 0}
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {#each COLOR_ROLES as role (role.field)}
              {@const shown = effColor(role.field)}
              {#if shown}
                {@const inh = inheritedColor(role.field)}
                {@const isOwn = !!roleColors[role.field]}
                <button
                  type="button"
                  class="cursor-pointer rounded-[10px] border border-surface-border p-1.5 text-left transition hover:bg-surface-hover"
                  title="Copy {shown}"
                  onclick={() => copyHex(shown)}
                >
                  <span
                    class="flex h-16 w-full items-center justify-center rounded-md font-mono text-xs"
                    style="background: {shown}; color: {textColorFor(shown)};"
                  >{copiedHex === shown ? 'Copied!' : shown}</span>
                  <span class="mt-1 flex items-center gap-1.5 px-0.5">
                    <span class="text-[11px] text-ink-700">{role.label}</span>
                    {#if !isOwn && inh.from}{@render inheritedBadge(inh.from)}{/if}
                  </span>
                </button>
              {/if}
            {/each}
          </div>
        {/if}

        {#if effFont}
          <div class="flex items-baseline gap-2">
            <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Type</span>
            <span class="text-sm text-ink-900">{effFont}</span>
            {#if !font && inherited?.fontFrom}{@render inheritedBadge(inherited.fontFrom.name)}{/if}
          </div>
        {/if}

        {@render brandPreview()}

        <!-- Assets (read-only) -->
        {#if showAssets.length > 0}
          <div>
            <div class="mb-1.5 font-display text-[10px] uppercase tracking-wider text-ink-400">Brand assets</div>
            <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {#each showAssets as a (a.id)}
                <div>
                  <img src={assetUrl(a.file_id, { width: 240, height: 240, fit: 'contain' })} alt={a.label ?? ''} class="aspect-square w-full rounded-md border border-surface-border object-contain p-1" style="background: var(--bg-tertiary);" loading="lazy" />
                  <div class="mt-1 truncate text-center text-[10px] text-ink-400">{a.label ?? ''}</div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
{:else}
<div class="card be">
  <!-- Sticky header. Three jobs: say what is being edited, keep a live
       sample of it on screen while you change it, and confirm that changes
       landed. All three stop working the moment they scroll away, which is
       why this is pinned. -->
  <div class="be-bar">
    <div class="be-bar-top">
      <span class="be-swatches" aria-hidden="true">
        {#if effLogo('brand_logo') || effLogo('brand_logo_simple')}
          <img
            class="be-swatch-logo"
            src={assetUrl((effLogo('brand_logo_simple') ?? effLogo('brand_logo'))!, { width: 64, height: 64, fit: 'contain' })}
            alt=""
            style="background: {effColor('brand_bg_light') ?? 'var(--bg-tertiary)'};"
          />
        {/if}
        {#each COLOR_ROLES as role (role.field)}
          {@const hex = effColor(role.field)}
          {#if hex}<span class="be-swatch" style="background: {hex};"></span>{/if}
        {/each}
      </span>
      <span class="be-title">Brand<span class="be-owner"> · {owner.name}</span></span>
      <span class="be-status" role="status" aria-live="polite">
        {#if savedAt}<Icon name="check" size={12} /> Saved{/if}
      </span>
    </div>

    <!-- One group at a time. The counts turn "which tab?" into a decision
         you can make without opening all of them. -->
    <div class="be-tabs" role="tablist" aria-label="Brand sections">
      {#each SECTIONS as t (t.value)}
        <button
          type="button"
          role="tab"
          aria-selected={section === t.value}
          class="be-tab"
          class:on={section === t.value}
          onclick={() => (section = t.value)}
        >
          {t.label}
          {#if t.of}
            <span class="be-count">{t.done}/{t.of}</span>
          {:else if t.done > 0}
            <span class="be-count">{t.done}</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <div class="be-body">
  {#if error}
    <p class="text-xs" style="color: #C0392B;">{error}</p>
  {/if}

  <!-- The fork is a QUESTION now, not a banner you learn to ignore.
       While a brand is inherited, its logo / palette / asset rows belong to the
       parent and cannot be removed from here — so the first edit asks which
       brand you are actually building, once, and then gets out of the way. The
       standing "Adopt for this {kind}" banner sat above every section forever,
       including long after you had started editing, and it never explained that
       "adopt" was the thing standing between you and a Remove button. -->
  {#if forkAsk}
    <div class="be-fork" role="dialog" aria-label="Start this brand">
      <div class="be-fork-text">
        <span class="be-adopt-title">Start {owner.name}’s own brand?</span>
        <span class="be-adopt-hint">
          This brand is {inheritedFrom}’s right now, so its logos and colours
          can’t be edited or removed from here. Pick a starting point — either
          way, {inheritedFrom} is left untouched and this {kind} stops
          inheriting.
        </span>
      </div>
      <div class="be-fork-actions">
        <button class="btn-primary" onclick={forkFromParent} disabled={!!forking}>
          <Icon name="copy" size={13} />
          {forking === 'copy' ? 'Copying…' : `Start from ${inheritedFrom}’s`}
        </button>
        <button class="be-fork-scratch" onclick={forkFromScratch} disabled={!!forking}>
          {forking === 'scratch' ? 'Clearing…' : 'Start from scratch'}
        </button>
        <button class="be-fork-cancel" onclick={() => (forkAsk = false)} disabled={!!forking}>
          Keep inheriting
        </button>
      </div>
    </div>
  {/if}
  {#if adoptedNote}
    <p class="be-adopted-note">{adoptedNote}</p>
  {/if}
  {#if isEmpty}
    <p class="text-xs text-ink-400">
      Optional — logo variants, fixed colour roles and brand assets for this project.
      Sub-projects inherit these until they set their own. The Evergreen machine and
      image tools pull from here.
    </p>
  {/if}

  {#if section === 'logos'}
  <!-- Lockup × treatment. Grouped by lockup because that is the decision you
       make first — what shape fits — and the treatments are the variants of
       it. Vertical rows rather than a three-across grid: the logos are the
       content here, and 48px thumbnails in a cramped column were too small
       to tell an inverted mark from a flat one. -->
  <div class="lg-groups">
    {#each shownLockups as lock (lock.value)}
      <section class="lg-group">
        <header class="lg-head">
          <span class="lg-title">{lock.label}</span>
          <span class="lg-hint">{lock.hint}</span>
          <span class="lg-count">{filledIn(lock.value)}/{LOGO_TREATMENTS.length}</span>
        </header>

        <ul class="lg-rows">
          {#each LOGO_TREATMENTS as treat (treat.value)}
            {@const cell = cellAt(lock.value, treat.value)}
            {#if cell}
              <li class="lg-row">
                <span
                  class="lg-stage"
                  style="background: {treat.onDark
                    ? (effColor('brand_bg_dark') ?? '#16181D')
                    : (effColor('brand_bg_light') ?? 'var(--bg-tertiary)')};"
                >
                  <img src={assetUrl(cell.fileId, { width: 320, fit: 'contain' })} alt="{lock.label} {treat.label} logo" />
                </span>
                <span class="lg-meta">
                  <span class="lg-name">{treat.label}</span>
                  <span class="lg-sub">{treat.hint}</span>
                  {#if cell.from && cell.from.id !== owner.id}{@render inheritedBadge(cell.from.name)}{/if}
                </span>
                <span class="lg-actions">
                  <button
                    class="lg-btn"
                    disabled={logoBusy}
                    onclick={() => chooseCell(lock.value, treat.value)}
                  >Replace</button>
                  {#if cell.from && cell.from.id === owner.id}
                    <button class="lg-btn danger" disabled={logoBusy} onclick={() => clearCell(cell)}>Remove</button>
                  {/if}
                </span>
              </li>
            {/if}
          {/each}
        </ul>

        {#if filledIn(lock.value) < LOGO_TREATMENTS.length}
          <div class="lg-add">
            <button class="lg-add-btn" onclick={() => openPicker(lock.value)} aria-expanded={pickerFor === lock.value}>
              <Icon name="plus" size={13} /> Add a version
            </button>
            {#if pickerFor === lock.value}
              <!-- A fixed list, not a free field: a brand has the treatments
                   it has, and letting someone invent "dark-ish" here is how a
                   brand system stops being one. -->
              <ul class="lg-picker">
                {#each LOGO_TREATMENTS as t (t.value)}
                  {#if !cellAt(lock.value, t.value)}
                    <li>
                      <button class="lg-pick" onclick={() => chooseCell(lock.value, t.value)}>
                        <span class="lg-pick-name">{t.label}</span>
                        <span class="lg-pick-hint">{t.hint}</span>
                      </button>
                    </li>
                  {/if}
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </section>
    {/each}

    {#if hiddenLockups.length > 0}
      <div class="lg-add">
        <span class="lg-hint">Other lockups</span>
        <!-- These open the same treatment picker the shown lockups use. They
             used to call chooseCell(lock, 'original'), which silently decided
             the treatment for you: the only way to add an inverted landscape
             was to add an original first so the group appeared, then add a
             version to it. Every lockup needs every treatment, so every lockup
             is entered the same way. -->
        <div class="lg-lockups">
          {#each hiddenLockups as lock (lock.value)}
            <button
              class="lg-add-btn"
              onclick={() => openPicker(lock.value)}
              aria-expanded={pickerFor === lock.value}
              title={lock.hint}
            >
              <Icon name="plus" size={13} /> {lock.label}
            </button>
          {/each}
        </div>
        {#if pickerFor && hiddenLockups.some((l) => l.value === pickerFor)}
          {@const lock = LOGO_LOCKUPS.find((l) => l.value === pickerFor)!}
          <ul class="lg-picker">
            <li class="lg-picker-head">{lock.label} — pick the treatment</li>
            {#each LOGO_TREATMENTS as t (t.value)}
              {#if !cellAt(lock.value, t.value)}
                <li>
                  <button class="lg-pick" onclick={() => chooseCell(lock.value, t.value)}>
                    <span class="lg-pick-name">{t.label}</span>
                    <span class="lg-pick-hint">{t.hint}</span>
                  </button>
                </li>
              {/if}
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>

  <!-- One input for the whole grid: the cell is chosen before it opens. -->
  <input
    type="file" accept="image/*" class="hidden"
    bind:this={cellFileEl}
    onchange={(e) => {
      const f = (e.currentTarget as HTMLInputElement).files?.[0];
      if (f) uploadCell(f);
      (e.currentTarget as HTMLInputElement).value = '';
    }}
  />
  {/if}

  {#if section === 'colour'}
  <!-- ONE colour concept, not two.
       This tab used to open with a "Roles" heading and close with a peer
       "Palette" heading, and the palette could be fed by either
       brand_palette_color rows or a legacy brand_colors blob — so it was
       labelled "older list" and there was no answer to "where does this
       colour live?". The roles ARE the brand's colours now; anything that
       isn't a role is an extra, listed under them and visibly subordinate. -->
  <div>

    {#each COLOR_ROLE_GROUPS as g (g.value)}
      <div class="cr-group">
        <div class="cr-group-head">
          <span class="cr-group-name">{g.label}</span>
          <span class="cr-group-hint">{g.hint}</span>
        </div>
        <div class="cr-rows">
          {#each COLOR_ROLES.filter((r) => r.group === g.value) as role (role.field)}
            {@const inh = inheritedColor(role.field)}
            {@const rv = roleValue(role.field)}
            {@const own = roleColors[role.field]}
            {@const bg = role.on === 'dark' ? surfaceInverse : surface}
            {@const v = rv.hex && role.on !== null ? judgeContrast(rv.hex, bg) : null}
            {@const isOpen = openRole === role.field}

            <div class="cr-row" class:open={isOpen}>
              <!-- Everything you need to decide whether to open it: the
                   colour, whose decision it was, and whether it passes. -->
              <button
                type="button"
                class="cr-summary"
                aria-expanded={isOpen}
                onclick={() => (openRole = isOpen ? null : role.field)}
              >
                <span
                  class="cr-dot"
                  class:unset={!rv.hex}
                  style="background: {rv.hex ?? 'transparent'};"
                ></span>
                <span class="cr-name">{role.label}</span>
                <span class="cr-flags">
                  {#if rv.auto}
                    <span class="cr-flag">auto</span>
                  {:else if !own && inh.hex}
                    <span class="cr-flag">from {inh.from}</span>
                  {:else if !rv.hex}
                    <span class="cr-flag dim">not set</span>
                  {/if}
                  {#if rv.hex}<span class="cr-hexs">{rv.hex}</span>{/if}
                  {#if v}
                    <span class="cr-badge" class:ok={v.ok} class:iffy={!v.ok && v.level === 'large'}>
                      {v.ok ? v.label : v.level === 'large' ? '3:1' : '✕'}
                    </span>
                  {/if}
                </span>
                <Icon name="chevron-right" size={13} class={isOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />
              </button>

              {#if isOpen}
                <div class="cr-detail">
                  <p class="cr-role-hint">{role.hint}</p>

                  <ColorEditor
                    label={role.label}
                    value={own}
                    inherited={inh.hex}
                    inheritedFrom={inh.from}
                    options={paletteOptions}
                    onSave={(h) => saveColorRole(role.field, h)}
                  />

                  {#if rv.hex}
                    {#if role.on === null}
                      <div class="cr-demo" style="background: {rv.hex}; color: {textColorFor(rv.hex)};">
                        <span class="cr-demo-t">Aa</span>
                        <span class="cr-demo-s">Everything else is judged against this surface</span>
                      </div>
                    {:else}
                      <div class="cr-demo" style="background: {bg};">
                        {#if role.group === 'text'}
                          <span
                            style="color: {rv.hex}; font-size: {role.field === 'brand_headline' ? '1.15rem' : role.field === 'brand_text_muted' ? '0.7rem' : '0.85rem'}; font-weight: {role.field === 'brand_headline' ? 700 : 400};"
                          >{role.field === 'brand_text_muted' ? 'Updated 3 days ago · 4 min read' : 'The quick brown fox jumps over the lazy dog'}</span>
                        {:else}
                          <span class="cr-chip" style="background: {rv.hex}; color: {textColorFor(rv.hex)};">Button</span>
                          <span class="cr-swatch-text" style="color: {rv.hex};">Link text</span>
                        {/if}
                        {#if v}
                          <span class="cr-verdict" class:bad={!v.ok}>
                            {v.ratio?.toFixed(2)}:1 · {v.label}{#if rv.auto}{' · auto'}{/if}
                          </span>
                        {/if}
                      </div>

                      {#if rv.auto}
                        <p class="cr-note">
                          Derived from the background — safe, but not a colour the brand
                          chose. Set it to use the brand's own ink.
                        </p>
                      {:else if v && !v.ok && role.field === 'brand_action'}
                        <p class="cr-warn">
                          {v.usable}. An action colour needs 4.5:1 here — try the darker
                          “(+)” version of this palette colour.
                        </p>
                      {:else if v && !v.ok && role.group === 'text'}
                        <p class="cr-warn">{v.usable}.</p>
                      {:else if v && !v.ok}
                        <p class="cr-note">On this surface: {v.usable.toLowerCase()}.</p>
                      {/if}
                    {/if}
                  {:else if role.field === 'brand_text_muted'}
                    <p class="cr-note">
                      No safe default exists for this one — too light and it disappears.
                      On this surface #5A5A5A passes and #CECECE does not.
                    </p>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Extras: brand colours that are not one of the eight roles — a chart
       ramp, a sub-brand accent. Subordinate on purpose; the roles above are
       what the app and the guidelines actually read. -->
  <div class="pl-extra">
    <div class="mb-1.5 flex items-center gap-2">
      <span class="pl-extra-title">Extra colours</span>
      <span class="pl-extra-hint">Not a role — reference only</span>
      {#if paletteFrom}{@render inheritedBadge(paletteFrom)}{/if}
    </div>

    {#if palette.length > 0}
      <div class="pl-groups">
        {#each PALETTE_GROUPS as g (g.value)}
          {@const rows = palette.filter((c) => (c.group ?? 'support') === g.value)}
          {#if rows.length > 0}
            <div class="pl-group">
              <div class="pl-group-head">
                <span class="pl-group-name">{g.label}</span>
                <span class="pl-group-hint">{g.hint}</span>
              </div>
              {#each rows as c (c.id)}
                {@const base = judgeContrast(c.hex, surface)}
                {@const strong = c.hex_strong ? judgeContrast(c.hex_strong, surface) : null}
                <div class="pl-row">
                  <div class="pl-pair">
                    <!-- Base and "(+)" always shown together: the darker one
                         only makes sense as the usable version of the base. -->
                    <span class="pl-cell" style="background: {c.hex}; color: {textColorFor(c.hex)};">
                      <span class="pl-hex">{c.hex}</span>
                      <span class="pl-v" class:bad={!base.ok}>{base.ratio?.toFixed(2)} · {base.label}</span>
                    </span>
                    {#if c.hex_strong && strong}
                      <span class="pl-cell" style="background: {c.hex_strong}; color: {textColorFor(c.hex_strong)};">
                        <span class="pl-hex">{c.hex_strong} <span class="pl-plus">(+)</span></span>
                        <span class="pl-v" class:bad={!strong.ok}>{strong.ratio?.toFixed(2)} · {strong.label}</span>
                      </span>
                    {/if}
                  </div>
                  <div class="pl-meta">
                    <span class="pl-name">{c.name}</span>
                    {#if c.notes}<span class="pl-notes">{c.notes}</span>{/if}
                  </div>
                  <!-- Only for rows this owner actually holds. An inherited
                       swatch has the ancestor's id, and removing it there
                       would strip it from every project inheriting it. -->
                  {#if ownsPaletteRow(c)}
                    <button class="pl-x" aria-label="Remove {c.name}" onclick={() => removePaletteColor(c.id)}>
                      <Icon name="x" size={12} />
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      </div>
    {:else}
      <p class="text-xs text-ink-400">
        None. Add one only for a colour that isn’t one of the roles above.
      </p>
    {/if}

    {#if !palOpen}
      <button class="pl-add" onclick={() => { resetPal(); palOpen = true; }}>
        <Icon name="plus" size={13} /> Add a colour
      </button>
    {:else}
      <div class="pl-form">
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1 block text-[10px] text-ink-400">Name *</span>
            <input class="input w-full" bind:value={palName} placeholder="Accent 1 · Brand Pink" />
          </label>
          <label class="block">
            <span class="mb-1 block text-[10px] text-ink-400">Group</span>
            <select class="input w-full" bind:value={palGroup}>
              {#each PALETTE_GROUPS as g (g.value)}<option value={g.value}>{g.label}</option>{/each}
            </select>
          </label>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <div>
            <span class="mb-1 block text-[10px] text-ink-400">Base</span>
            <ColorEditor label="Base" value={palHex} onSave={(h) => { palHex = h ?? palHex; }} />
          </div>
          <div>
            <span class="mb-1 block text-[10px] text-ink-400">Darker “(+)” — optional</span>
            <ColorEditor label="(+)" value={palStrong} onSave={(h) => { palStrong = h; }} />
          </div>
        </div>
        <p class="cr-note">
          The “(+)” is the version that survives a light background. Most identity
          colours are too light to hold text on their own.
        </p>
        <div class="flex justify-end gap-2">
          <button class="btn-ghost text-xs" onclick={() => (palOpen = false)} disabled={palBusy}>Cancel</button>
          <button class="btn-primary text-xs" onclick={addPaletteColor} disabled={palBusy || !palName.trim()}>
            {palBusy ? 'Saving…' : 'Add colour'}
          </button>
        </div>
      </div>
    {/if}
  </div>
  {/if}

  {#if section === 'type'}
  <!-- Typeface. Free text, not a picker: a brand's type is "Inter", or
       "Söhne / Inter fallback" — any list would be wrong within a week,
       and this value's job is to be read by a person. -->
  <div>
    <div class="mb-1.5 flex items-center gap-2">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Typeface</span>
      {#if !font && inherited?.fontFrom}{@render inheritedBadge(inherited.fontFrom.name)}{/if}
    </div>
    <div class="flex items-center gap-2">
      <input
        type="text"
        class="input w-full max-w-sm"
        placeholder={inherited?.font ?? 'e.g. Inter'}
        value={font ?? ''}
        onchange={(e) => saveFont((e.currentTarget as HTMLInputElement).value)}
      />
      {#if font}
        <button
          class="cursor-pointer text-ink-300 transition hover:text-ink-700"
          title={inherited?.font ? 'Clear (inherit again)' : 'Clear'}
          onclick={() => saveFont(null)}
        ><Icon name="x" size={12} /></button>
      {/if}
    </div>

    <!-- The faces themselves. A name alone cannot render; a file or a
         stylesheet URL can, which is what makes the brand book's specimen
         the real typeface instead of an approximation. -->
    <div class="mt-3">
      {#if faces.length > 0}
        <ul class="mb-2 divide-y divide-surface-divider rounded-[10px] border border-surface-border">
          {#each faces as f (f.id)}
            <li class="flex items-center gap-2 px-2.5 py-1.5">
              <Icon name={f.file_id ? 'download' : 'globe'} size={12} class="shrink-0 text-ink-300" />
              <span class="min-w-0 flex-1 truncate text-xs text-ink-900">
                {f.family}
                <span class="text-ink-400">
                  {f.role ?? ''}{f.weight ? ` · ${f.weight}` : ''}{f.style === 'italic' ? ' italic' : ''}
                </span>
              </span>
              {#if !f.file_id && f.css_url}
                <span class="shrink-0 rounded-full bg-surface-hover px-1.5 py-0.5 text-[9px] font-semibold text-ink-500">linked</span>
              {/if}
              <button
                class="shrink-0 cursor-pointer text-ink-300 transition hover:text-ink-700"
                title="Remove this face"
                aria-label="Remove {f.family}"
                onclick={() => removeFace(f.id)}
              ><Icon name="x" size={12} /></button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if !faceOpen}
        <button
          class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-[11px] font-medium text-ink-700 hover:bg-surface-hover"
          onclick={() => { resetFaceForm(); faceOpen = true; }}
        ><Icon name="plus" size={12} /> Add a font face</button>
      {:else}
        <div class="rounded-[10px] border border-surface-border p-3 space-y-2">
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1 block text-[10px] text-ink-400">Family *</span>
              <input class="input w-full" bind:value={fFamily} placeholder="Inter" />
            </label>
            <label class="block">
              <span class="mb-1 block text-[10px] text-ink-400">Role</span>
              <select class="input w-full" bind:value={fRole}>
                {#each BRAND_FONT_ROLES as r (r.value)}
                  <option value={r.value}>{r.label}</option>
                {/each}
              </select>
            </label>
            <label class="block">
              <span class="mb-1 block text-[10px] text-ink-400">Weight</span>
              <input class="input w-full" bind:value={fWeight} placeholder="400 — blank for variable" />
            </label>
            <label class="block">
              <span class="mb-1 block text-[10px] text-ink-400">Style</span>
              <select class="input w-full" bind:value={fStyle}>
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </label>
          </div>

          <div>
            <span class="mb-1 block text-[10px] text-ink-400">Font file</span>
            <input
              bind:this={faceFileEl}
              type="file"
              class="w-full text-xs"
              accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
              onchange={(e) => (pendingFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
            />
            <p class="mt-1 text-[10px] text-ink-400">
              woff2 is the one to upload if you have it. Skip this for a
              publicly hosted face and use the stylesheet URL instead.
            </p>
          </div>

          <label class="block">
            <span class="mb-1 block text-[10px] text-ink-400">Stylesheet URL (fallback for public fonts)</span>
            <input class="input w-full" bind:value={fCssUrl} placeholder="https://fonts.googleapis.com/css2?family=Inter…" />
            <p class="mt-1 text-[10px] text-ink-400">
              Family above must match what the stylesheet declares — a sheet
              defining “Inter” will not render a face you named “Inter Tight”.
            </p>
          </label>
          <label class="block">
            <span class="mb-1 block text-[10px] text-ink-400">Source</span>
            <input class="input w-full" bind:value={fSourceUrl} placeholder="Foundry or listing page" />
          </label>
          <label class="block">
            <span class="mb-1 block text-[10px] text-ink-400">Licence</span>
            <input class="input w-full" bind:value={fLicense} placeholder="SIL OFL 1.1 · Licensed — 5 seats" />
          </label>

          <div class="flex justify-end gap-2">
            <button class="btn-ghost text-xs" onclick={() => (faceOpen = false)} disabled={faceBusy}>Cancel</button>
            <button class="btn-primary text-xs" onclick={addFace} disabled={faceBusy || !fFamily.trim()}>
              {faceBusy ? 'Saving…' : 'Add face'}
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  {/if}

  <!-- The preview is the artefact, so it stays put across sections. -->
  {@render brandPreview()}

  {#if section === 'elements'}
  <!-- Brand elements: the parts that are neither a logo nor a colour.
       Grouped by kind because each is *read* differently — a pattern has to be
       seen repeating to judge the seam, a gradient has to be seen as CSS you
       can paste, photography is mostly the written direction. -->
  <div class="el-wrap">
    {#if elementsFrom}
      <div class="mb-2">{@render inheritedBadge(elementsFrom)}</div>
    {/if}

    {#each BRAND_ELEMENT_KINDS as k (k.value)}
      {@const rows = elements.filter((e) => e.kind === k.value)}
      {#if rows.length > 0}
        <section class="el-group">
          <header class="el-head">
            <span class="el-title">{k.plural}</span>
            <span class="el-hint">{k.hint}</span>
          </header>
          <ul class="el-rows">
            {#each rows as el (el.id)}
              {@const css = gradientCss(el)}
              {@const bg = el.on_dark ? (effColor('brand_bg_dark') ?? '#16181D') : (effColor('brand_bg_light') ?? 'var(--bg-tertiary)')}
              <li class="el-row">
                <span
                  class="el-stage"
                  style={
                    el.kind === 'gradient' && css
                      ? `background: ${css};`
                      : el.kind === 'pattern' && el.file_id
                        ? `background-color: ${bg}; background-image: url('${assetUrl(el.file_id, { width: 480 })}'); background-repeat: repeat; background-size: ${el.tile_width ? el.tile_width + 'px' : 'auto'};`
                        : `background: ${bg};`
                  }
                >
                  {#if el.kind !== 'pattern' && el.kind !== 'gradient' && el.file_id}
                    <img src={assetUrl(el.file_id, { width: 320, fit: 'contain' })} alt={el.name} />
                  {/if}
                </span>
                <span class="el-meta">
                  <span class="el-name">{el.name}</span>
                  {#if el.kind === 'gradient' && css}
                    <button class="el-css" type="button" title="Copy the CSS" onclick={() => copyHex(css)}>{css}</button>
                  {/if}
                  {#if el.kind === 'pattern' && el.tile_width}
                    <span class="el-sub">Tile {el.tile_width}px</span>
                  {/if}
                  {#if el.notes}<span class="el-sub">{el.notes}</span>{/if}
                  {#if !ownsElement(el)}{@render inheritedBadge(elementsFrom ?? 'parent')}{/if}
                </span>
                <span class="el-actions">
                  {#if el.file_id}
                    <a class="lg-btn" href={assetUrl(el.file_id, { download: '' })} download={el.name}>Download</a>
                  {/if}
                  {#if ownsElement(el)}
                    <button class="lg-btn" disabled={elBusy} onclick={() => pickElFile(el.id)}>
                      {el.file_id ? 'Replace' : 'Add file'}
                    </button>
                    <button class="lg-btn danger" disabled={elBusy} onclick={() => removeElement(el)}>Remove</button>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/each}

    {#if elements.length === 0}
      <p class="text-xs text-ink-400">
        Nothing yet. Add a background pattern, a gradient, a graphic element, or
        the photography direction.
      </p>
    {/if}

    {#if !elOpen}
      <button class="pl-add" onclick={() => { resetEl(); elOpen = true; }}>
        <Icon name="plus" size={13} /> Add an element
      </button>
    {:else}
      <div class="el-form">
        <div class="el-kinds" role="radiogroup" aria-label="Element kind">
          {#each BRAND_ELEMENT_KINDS as k (k.value)}
            <button
              type="button"
              role="radio"
              aria-checked={elKind === k.value}
              class="el-kind"
              class:on={elKind === k.value}
              onclick={() => (elKind = k.value)}
            >{k.label}</button>
          {/each}
        </div>

        <input class="input" bind:value={elName} placeholder="Name — e.g. Diagonal stripes" />

        {#if elKind === 'gradient'}
          <!-- Authored, not uploaded: stops and an angle are the source of
               truth, so the gradient stays recolourable and the CSS below is
               always in step with it. -->
          <div class="el-grad-preview" style="background: {elDraftCss ?? 'var(--bg-tertiary)'};"></div>
          <div class="el-stops">
            {#each elStops as stop, i (i)}
              <div class="el-stop">
                <input type="color" bind:value={elStops[i].hex} aria-label="Stop {i + 1} colour" />
                <input class="input !w-auto" type="number" min="0" max="100" bind:value={elStops[i].pos} aria-label="Stop {i + 1} position" />
                <span class="el-stop-pct">%</span>
                {#if elStops.length > 2}
                  <button class="lg-btn danger" onclick={() => removeStop(i)} aria-label="Remove stop {i + 1}">
                    <Icon name="x" size={12} />
                  </button>
                {/if}
              </div>
            {/each}
            <button class="lg-btn" onclick={addStop}>+ Stop</button>
          </div>
          <label class="el-field">
            <span class="el-label">Angle</span>
            <input class="input !w-auto" type="number" min="0" max="360" bind:value={elAngle} />
            <span class="el-sub">degrees — 180 is top to bottom</span>
          </label>
          {#if elDraftCss}<code class="el-css-static">{elDraftCss}</code>{/if}
        {/if}

        {#if elKind === 'pattern'}
          <label class="el-field">
            <span class="el-label">Tile width</span>
            <input class="input !w-auto" type="number" min="1" bind:value={elTile} placeholder="px" />
            <span class="el-sub">so it previews at the size it is meant to be used</span>
          </label>
        {/if}

        <label class="el-check">
          <input type="checkbox" bind:checked={elOnDark} />
          <span>Made for the inverse background</span>
        </label>

        <textarea class="input" rows="2" bind:value={elNotes} placeholder={elKind === 'photography' ? 'The direction — what the photography should and should not look like' : 'How and where to use it (optional)'}></textarea>

        <div class="el-form-actions">
          <button class="lg-btn" disabled={elBusy} onclick={() => pickElFile('new')}>
            {elFileId ? 'File attached ✓' : elKind === 'gradient' ? 'Attach a raster (optional)' : 'Choose artwork'}
          </button>
          <span class="flex-1"></span>
          <button class="lg-btn" onclick={() => { elOpen = false; resetEl(); }}>Cancel</button>
          <button class="btn-primary" disabled={elBusy} onclick={addElement}>
            {elBusy ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    {/if}
  </div>

  <input
    type="file" accept="image/*" class="hidden"
    bind:this={elFileEl}
    onchange={(e) => {
      const f = (e.currentTarget as HTMLInputElement).files?.[0];
      if (f) onElFile(f);
      (e.currentTarget as HTMLInputElement).value = '';
    }}
  />
  {/if}

  {#if section === 'assets'}
  <!-- Assets -->
  <div>
    <div class="mb-1.5 flex items-center gap-2">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400">Brand assets</span>
      {#if assetsSource}{@render inheritedBadge(assetsSource)}{/if}
    </div>
    <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {#each showAssets as a (a.id)}
        <div class="group relative" style:opacity={assetsInherited ? 0.75 : 1}>
          <img src={assetUrl(a.file_id, { width: 240, height: 240, fit: 'contain' })} alt={a.label ?? ''} class="aspect-square w-full rounded-md border border-surface-border object-contain p-1" style="background: var(--bg-tertiary);" loading="lazy" />
          {#if !assetsInherited}
            <button
              class="absolute -right-1.5 -top-1.5 grid h-5 w-5 cursor-pointer place-items-center rounded-full border border-surface-border bg-surface-card text-ink-400 opacity-0 transition hover:text-ink-900 group-hover:opacity-100"
              title="Remove asset"
              onclick={() => removeAsset(a)}
            ><Icon name="x" size={10} /></button>
            <input
              class="mt-1 w-full border-none bg-transparent text-center text-[10px] text-ink-500 outline-none focus:text-ink-900"
              value={a.label ?? ''}
              placeholder="label"
              onblur={(e) => relabel(a, (e.currentTarget as HTMLInputElement).value)}
            />
          {:else}
            <div class="mt-1 truncate text-center text-[10px] text-ink-400">{a.label ?? ''}</div>
          {/if}
        </div>
      {/each}
      <button
        class="grid aspect-square w-full cursor-pointer place-items-center rounded-md border-2 border-dashed border-surface-border text-ink-400 transition hover:bg-surface-hover hover:text-ink-700"
        title={assetsInherited ? 'Upload assets for this project (overrides the inherited set)' : 'Upload brand assets'}
        disabled={busy}
        onclick={() => assetFileEl?.click()}
      >
        {#if busy}<span class="text-[10px]">…</span>{:else}<Icon name="plus" size={16} />{/if}
      </button>
    </div>
    <input
      type="file" accept="image/*" multiple class="hidden" bind:this={assetFileEl}
      onchange={(e) => {
        const fs = (e.currentTarget as HTMLInputElement).files;
        if (fs && fs.length > 0) uploadAssets(fs);
        (e.currentTarget as HTMLInputElement).value = '';
      }}
    />
  </div>
  {/if}
  </div>
</div>
{/if}

<style>
  /* Editor chrome. The pinned header is the whole point: what you are
     editing, a sample of it, and the save state must not scroll away —
     that is what keeps you oriented once the form is taller than the
     screen. */
  .be { padding: 0; }
  .be-bar {
    position: sticky;
    /* The app's own header is a 56px sticky at top:0. Pinning to 0 here put
       the swatches, the name and the save state underneath it — visible in
       the DOM, invisible to the user. */
    top: 56px;
    z-index: 5;
    padding: 0.75rem 1rem 0;
    background: var(--surface-card, #fff);
    border-bottom: 1px solid var(--surface-divider, #ececec);
    border-radius: 14px 14px 0 0;
  }
  .be-bar-top { display: flex; align-items: center; gap: 0.6rem; }
  .be-title { font-size: 0.9rem; font-weight: 600; color: var(--ink-900, #111); }
  .be-owner { font-weight: 400; color: var(--ink-400, #888); }
  .be-swatches { display: inline-flex; align-items: center; gap: 3px; }
  .be-swatch {
    width: 14px; height: 14px; border-radius: 999px;
    border: 1px solid var(--surface-border, #e5e5e5);
  }
  .be-swatch-logo { width: 22px; height: 22px; border-radius: 5px; object-fit: contain; padding: 1px; }
  /* Fixed width so the label appearing and disappearing never nudges the
     header sideways. */
  .be-status {
    margin-left: auto;
    display: inline-flex; align-items: center; gap: 0.25rem;
    min-width: 4.2rem; justify-content: flex-end;
    font-size: 11px; font-weight: 600; color: #1d6b3f;
  }
  .be-tabs { display: flex; gap: 0.15rem; margin-top: 0.6rem; overflow-x: auto; }
  .be-tab {
    display: inline-flex; align-items: center; gap: 0.35rem;
    /* 44px tall: this gets used on the tablet too. */
    min-height: 44px;
    padding: 0 0.7rem;
    border-bottom: 2px solid transparent;
    background: none;
    font-size: 0.8rem; font-weight: 500; white-space: nowrap;
    color: var(--ink-400, #888);
    cursor: pointer;
    transition: color 200ms, border-color 200ms;
  }
  .be-tab:hover { color: var(--ink-900, #111); }
  .be-tab.on { color: var(--ink-900, #111); border-bottom-color: var(--brand, #2f7d7d); }
  .be-tab:focus-visible { outline: 2px solid var(--brand, #2f7d7d); outline-offset: -2px; border-radius: 6px; }
  .be-count {
    border-radius: 999px; padding: 0.05rem 0.35rem;
    background: var(--bg-tertiary, #f0f0f0);
    font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums;
  }
  /* Colour roles */
  .cr-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .cr-item {
    padding: 0.6rem;
    border: 1px solid var(--surface-border, #e5e5e5);
    border-radius: 12px;
  }

  .cr-group + .cr-group { margin-top: 0.9rem; }
  .cr-rows {
    border: 1px solid var(--surface-border, #e5e5e5);
    border-radius: 12px;
    overflow: hidden;
  }
  .cr-row + .cr-row { border-top: 1px solid var(--surface-divider, #ececec); }
  .cr-row.open { background: var(--bg-secondary, #fafafa); }
  .cr-summary {
    display: flex; align-items: center; gap: 0.6rem;
    width: 100%; min-height: 44px; padding: 0 0.7rem;
    background: none; cursor: pointer; text-align: left;
  }
  .cr-summary:hover { background: var(--bg-secondary, #f6f6f6); }
  .cr-dot {
    width: 20px; height: 20px; border-radius: 999px; flex: 0 0 auto;
    border: 1px solid var(--surface-border, #e5e5e5);
  }
  .cr-dot.unset {
    background-image:
      linear-gradient(45deg, #e9e9e9 25%, transparent 25%, transparent 75%, #e9e9e9 75%),
      linear-gradient(45deg, #e9e9e9 25%, transparent 25%, transparent 75%, #e9e9e9 75%);
    background-size: 8px 8px; background-position: 0 0, 4px 4px;
    border-style: dashed;
  }
  .cr-name { font-size: 0.82rem; font-weight: 600; color: var(--ink-900, #111); flex: 0 0 auto; }
  .cr-flags { display: flex; align-items: center; gap: 0.35rem; margin-left: auto; min-width: 0; }
  .cr-flag {
    border-radius: 999px; padding: 0.05rem 0.4rem;
    background: var(--bg-tertiary, #eee); color: var(--ink-500, #666);
    font-size: 9px; font-weight: 600; white-space: nowrap;
  }
  .cr-flag.dim { background: none; border: 1px dashed var(--surface-border, #ddd); }
  .cr-hexs { font-family: ui-monospace, monospace; font-size: 0.68rem; color: var(--ink-500, #666); }
  .cr-badge {
    min-width: 2rem; text-align: center;
    border-radius: 999px; padding: 0.08rem 0.35rem;
    font-size: 9px; font-weight: 700;
    background: #fdecea; color: #a3271c;
  }
  .cr-badge.ok { background: #e8f5ec; color: #1d6b3f; }
  .cr-badge.iffy { background: #fdf3e3; color: #8a5a12; }
  .cr-detail {
    display: flex; flex-direction: column; gap: 0.6rem;
    padding: 0.2rem 0.7rem 0.8rem;
  }
  .cr-role-hint { font-size: 0.72rem; color: var(--ink-400, #888); }
  .cr-group-head { display: flex; align-items: baseline; gap: 0.4rem; margin-bottom: 0.35rem; flex-wrap: wrap; }
  .cr-group-name { font-size: 0.78rem; font-weight: 600; color: var(--ink-900, #111); }
  .cr-group-hint { font-size: 0.68rem; color: var(--ink-400, #888); }

  /* Role demos */
  .cr-demos { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; margin-top: 0.6rem; }
  .cr-demo {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem;
    padding: 0.55rem; border-radius: 9px;
    border: 1px solid var(--surface-border, #e5e5e5);
  }
  .cr-demo-t { font-size: 1.1rem; font-weight: 700; }
  .cr-demo-s { font-size: 0.68rem; opacity: 0.75; }
  .cr-chip { border-radius: 999px; padding: 0.15rem 0.55rem; font-size: 0.7rem; font-weight: 600; }
  .cr-swatch-text { font-size: 0.72rem; text-decoration: underline; }
  .cr-verdict {
    flex-basis: 100%; font-family: ui-monospace, monospace;
    font-size: 0.62rem; color: #1d6b3f;
  }
  .cr-verdict.bad { color: #b4472f; }
  .cr-warn {
    margin-top: 0.4rem; padding: 0.4rem 0.55rem; border-radius: 8px;
    background: #fdf3e3; color: #8a5a12; font-size: 0.7rem; line-height: 1.45;
  }
  .cr-note { margin-top: 0.4rem; font-size: 0.7rem; line-height: 1.45; color: var(--ink-400, #888); }

  /* ── Brand elements ── */
  .el-wrap { display: flex; flex-direction: column; gap: 1rem; }
  .el-group { display: flex; flex-direction: column; gap: 0.4rem; }
  .el-head { display: flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap; }
  .el-title { font-size: 0.78rem; font-weight: 600; color: var(--ink-900, #111); }
  .el-hint { font-size: 0.68rem; color: var(--ink-400, #888); }
  .el-rows { display: flex; flex-direction: column; gap: 0.4rem; }
  .el-row {
    display: flex; align-items: center; gap: 0.6rem;
    border-radius: 10px; padding: 0.5rem;
    border: 1px solid var(--surface-divider, #eee);
  }
  /* Wide and short: a pattern is judged by how it repeats across a run, and a
     square swatch shows too few tiles to see a seam. */
  .el-stage {
    display: grid; place-items: center;
    width: 148px; height: 64px; flex: 0 0 auto;
    border-radius: 8px; overflow: hidden;
    border: 1px solid var(--surface-border, #e5e5e5);
  }
  .el-stage img { width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: contain; padding: 0.3rem; }
  .el-meta { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1 1 auto; }
  .el-name { font-size: 0.82rem; font-weight: 600; color: var(--ink-900, #111); }
  .el-sub { font-size: 0.7rem; color: var(--ink-400, #888); }
  .el-css {
    font-family: ui-monospace, monospace; font-size: 0.65rem;
    color: var(--ink-500, #666); text-align: left;
    background: none; border: 0; padding: 0; cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
  }
  .el-css:hover { color: var(--ink-900, #111); text-decoration: underline; }
  .el-actions { display: flex; flex-direction: column; gap: 0.2rem; flex: 0 0 auto; }

  .el-form {
    display: flex; flex-direction: column; gap: 0.6rem;
    border-radius: 10px; padding: 0.7rem;
    border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--bg-secondary, #fafafa);
  }
  .el-kinds { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .el-kind {
    border-radius: 999px; padding: 0.25rem 0.6rem;
    border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--surface-card, #fff);
    font-size: 0.72rem; color: var(--ink-500, #666); cursor: pointer;
  }
  .el-kind.on {
    background: var(--brand, #2f7d7d); border-color: var(--brand, #2f7d7d);
    color: #fff; font-weight: 600;
  }
  .el-grad-preview { height: 72px; border-radius: 8px; border: 1px solid var(--surface-border, #e5e5e5); }
  .el-stops { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
  .el-stop { display: flex; align-items: center; gap: 0.2rem; }
  .el-stop input[type='color'] { width: 28px; height: 28px; padding: 0; border: 0; background: none; cursor: pointer; }
  .el-stop input[type='number'] { width: 4.5rem; }
  .el-stop-pct { font-size: 0.7rem; color: var(--ink-400, #888); }
  .el-field { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .el-label { font-size: 0.72rem; font-weight: 600; color: var(--ink-700, #444); }
  .el-check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.72rem; color: var(--ink-700, #444); }
  .el-css-static {
    font-family: ui-monospace, monospace; font-size: 0.65rem;
    color: var(--ink-500, #666); word-break: break-all;
  }
  .el-form-actions { display: flex; align-items: center; gap: 0.4rem; }

  /* Extra colours */
  .pl-groups { display: flex; flex-direction: column; gap: 0.9rem; }
  .pl-group-head { display: flex; align-items: baseline; gap: 0.4rem; margin-bottom: 0.35rem; }
  .pl-group-name { font-size: 0.78rem; font-weight: 600; color: var(--ink-900, #111); }
  .pl-group-hint { font-size: 0.68rem; color: var(--ink-400, #888); }
  .pl-row { display: flex; align-items: center; gap: 0.6rem; padding: 0.3rem 0; }
  .pl-pair { display: flex; gap: 0.25rem; flex: 0 0 auto; }
  .pl-cell {
    display: flex; flex-direction: column; justify-content: center; gap: 0.1rem;
    width: 116px; min-height: 46px; padding: 0.35rem 0.5rem;
    border-radius: 8px; border: 1px solid var(--surface-border, #e5e5e5);
  }
  .pl-hex { font-family: ui-monospace, monospace; font-size: 0.68rem; font-weight: 600; }
  .pl-plus { opacity: 0.7; }
  .pl-v { font-family: ui-monospace, monospace; font-size: 0.58rem; opacity: 0.85; }
  .pl-v.bad { text-decoration: underline wavy; text-underline-offset: 2px; }
  .pl-meta { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1 1 auto; }
  .pl-name { font-size: 0.8rem; font-weight: 600; color: var(--ink-900, #111); }
  .pl-notes { font-size: 0.68rem; color: var(--ink-400, #888); }
  .pl-x {
    flex: 0 0 auto; display: grid; place-items: center;
    width: 26px; height: 26px; border-radius: 6px; color: var(--ink-300, #aaa); cursor: pointer;
  }
  .pl-x:hover { color: #a3271c; background: var(--bg-secondary, #f4f4f4); }
  .pl-add {
    display: inline-flex; align-items: center; gap: 0.3rem; margin-top: 0.6rem;
    min-height: 36px; padding: 0 0.7rem; border-radius: 999px;
    border: 1px dashed var(--surface-border, #d8d8d8);
    background: none; font-size: 0.78rem; color: var(--ink-500, #666); cursor: pointer;
  }
  .pl-add:hover { color: var(--ink-900, #111); background: var(--bg-secondary, #f4f4f4); }
  .pl-form {
    margin-top: 0.6rem; padding: 0.75rem;
    border: 1px solid var(--surface-border, #e5e5e5); border-radius: 12px;
    display: flex; flex-direction: column; gap: 0.6rem;
  }

  /* Logo grid */
  .lg-groups { display: flex; flex-direction: column; gap: 1.25rem; }
  .lg-group { border: 1px solid var(--surface-border, #e5e5e5); border-radius: 12px; padding: 0.85rem; }
  .lg-head { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
  .lg-title { font-size: 0.9rem; font-weight: 600; color: var(--ink-900, #111); }
  .lg-hint { font-size: 0.72rem; color: var(--ink-400, #888); }
  .lg-count {
    margin-left: auto; border-radius: 999px; padding: 0.05rem 0.4rem;
    background: var(--bg-tertiary, #f0f0f0);
    font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums;
    color: var(--ink-500, #666);
  }
  .lg-rows { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.7rem; }
  .lg-row {
    display: flex; align-items: center; gap: 0.8rem;
    padding: 0.5rem; border-radius: 10px;
    background: var(--bg-secondary, #f8f8f8);
  }
  /* Big enough to actually read the mark — the old 48px square could not
     distinguish an inverted lockup from a flat one. */
  .lg-stage {
    display: grid; place-items: center;
    width: 116px; height: 64px; flex: 0 0 auto;
    border-radius: 8px; padding: 0.4rem;
    border: 1px solid var(--surface-border, #e5e5e5);
  }
  /* width/height 100% + object-fit, NOT max-width/max-height.
     The stage is a grid container, and a grid item's automatic minimum size
     (`min-height: auto`) is its intrinsic height for a replaced element —
     which beats `max-height`. So a 202×150 logo constrained to 101px wide
     computed a 75px min-height inside a 51px content box and spilled 18px out
     of the frame, over the row below it. Sizing the box explicitly and letting
     object-fit letterbox the bitmap inside it cannot overflow; min-*: 0 stops
     the automatic minimum from re-inflating it. */
  .lg-stage img {
    width: 100%; height: 100%;
    min-width: 0; min-height: 0;
    object-fit: contain;
  }
  .lg-meta { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1 1 auto; }
  .lg-name { font-size: 0.82rem; font-weight: 600; color: var(--ink-900, #111); }
  .lg-sub { font-size: 0.7rem; color: var(--ink-400, #888); }
  .lg-actions { display: flex; flex-direction: column; gap: 0.2rem; flex: 0 0 auto; }
  .lg-btn {
    min-height: 24px; padding: 0 0.4rem; border-radius: 6px;
    font-size: 0.72rem; color: var(--ink-500, #666);
    background: none; cursor: pointer; text-align: right;
  }
  .lg-btn:hover { color: var(--ink-900, #111); background: var(--bg-tertiary, #eee); }
  .lg-btn.danger:hover { color: #a3271c; }
  .lg-add { margin-top: 0.7rem; position: relative; }
  .lg-add-btn {
    display: inline-flex; align-items: center; gap: 0.3rem;
    min-height: 36px; padding: 0 0.7rem; border-radius: 999px;
    border: 1px dashed var(--surface-border, #d8d8d8);
    background: none; font-size: 0.78rem; color: var(--ink-500, #666);
    cursor: pointer;
  }
  .lg-add-btn:hover { color: var(--ink-900, #111); background: var(--bg-secondary, #f4f4f4); }
  .lg-lockups { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.35rem; }
  .lg-picker {
    position: absolute; z-index: 8; margin-top: 0.3rem; min-width: 220px;
    border: 1px solid var(--surface-border, #e5e5e5); border-radius: 10px;
    background: var(--surface-card, #fff);
    box-shadow: 0 8px 24px rgba(0,0,0,0.08);
    overflow: hidden;
  }
  .lg-pick {
    display: flex; flex-direction: column; gap: 0.1rem;
    width: 100%; padding: 0.5rem 0.7rem; text-align: left;
    background: none; cursor: pointer;
  }
  .lg-pick:hover { background: var(--bg-secondary, #f4f4f4); }
  .lg-pick-name { font-size: 0.8rem; font-weight: 500; color: var(--ink-900, #111); }
  .lg-pick-hint { font-size: 0.7rem; color: var(--ink-400, #888); }
  /* Names the lockup, because the "Other lockups" picker is detached from the
     button that opened it — without this it is four treatments with no subject. */
  /* Visibly a footnote to the roles, not a peer section: smaller title, a
     rule above it, and no all-caps heading competing with "Roles". */
  .pl-extra {
    margin-top: 1rem; padding-top: 0.8rem;
    border-top: 1px solid var(--surface-divider, #eee);
  }
  .pl-extra-title { font-size: 0.75rem; font-weight: 600; color: var(--ink-700, #444); }
  .pl-extra-hint { font-size: 0.68rem; color: var(--ink-400, #888); }

  .lg-picker-head {
    padding: 0.4rem 0.7rem;
    border-bottom: 1px solid var(--surface-divider, #eee);
    font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--ink-400, #888);
  }

  .be-body { padding: 1rem; display: flex; flex-direction: column; gap: 1.25rem; }

  /* Informational, not alarming — inheriting is the normal, useful state, so
     this is a tinted note rather than a warning. */
  /* A question, so it stacks: prose then a row of answers. The banner this
     replaced put its one button beside the text, which read as dismissable
     chrome rather than something to decide. */
  .be-fork {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    border-radius: 10px;
    padding: 0.8rem;
    background: color-mix(in srgb, var(--brand, #2f7d7d) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--brand, #2f7d7d) 22%, transparent);
  }
  .be-fork-text { display: flex; flex-direction: column; gap: 0.25rem; }
  .be-fork-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  /* Both alternatives are real choices, so neither is a bare link — but only
     one is primary, because copying the parent is what you usually want. */
  .be-fork-scratch {
    border-radius: 8px; padding: 0.4rem 0.7rem;
    border: 1px solid var(--surface-border, #e5e5e5);
    background: var(--surface-card, #fff);
    font-size: 12px; font-weight: 500; color: var(--text-primary);
    cursor: pointer; white-space: nowrap;
  }
  .be-fork-scratch:hover:not(:disabled) { background: var(--bg-secondary, #f4f4f4); }
  .be-fork-cancel {
    margin-left: auto;
    background: none; border: 0; padding: 0.4rem 0.2rem;
    font-size: 11.5px; color: var(--text-secondary); cursor: pointer;
  }
  .be-fork-cancel:hover:not(:disabled) { color: var(--text-primary); text-decoration: underline; }
  .be-adopt-title { font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
  .be-adopt-hint { font-size: 11px; line-height: 1.5; color: var(--text-secondary); }
  .be-adopted-note {
    font-size: 11px;
    border-radius: 8px;
    padding: 0.4rem 0.6rem;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }
</style>
