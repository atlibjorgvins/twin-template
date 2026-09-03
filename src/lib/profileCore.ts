// Pure profile logic — no DOM, no Svelte, so it is testable under
// `node --test` (profileCore.test.ts). The reactive wrapper with the
// localStorage + <html data-accent> side-effects is profile.svelte.ts.

/**
 * Accent presets. Each entry mirrors how the scope accents in app.css work:
 * a mid tone with white text for the light theme, a pastel with dark text for
 * the dark theme. The CSS lives in app.css under `:root[data-accent='…']` —
 * these values exist here only so the picker can paint its swatches; keep the
 * two lists in sync (the ids are asserted against app.css in the test).
 *
 * `default` is the absence of the attribute: teal in light, chartreuse in
 * dark — the Helga base palette, and what every existing device shows today.
 */
export interface AccentPreset {
  id: string;
  label: string;
  /** `R G B` for the light theme swatch (matches --accent-electric-rgb). */
  light: string;
  /** `R G B` for the dark theme swatch. */
  dark: string;
}

export const ACCENTS: readonly AccentPreset[] = [
  { id: 'default', label: 'Electric', light: '44 140 153', dark: '217 249 157' },
  { id: 'ocean', label: 'Ocean', light: '37 99 235', dark: '147 197 253' },
  { id: 'forest', label: 'Forest', light: '5 150 105', dark: '110 231 183' },
  { id: 'rose', label: 'Rose', light: '225 29 72', dark: '253 164 175' },
  { id: 'amber', label: 'Amber', light: '217 119 6', dark: '252 211 77' },
  { id: 'violet', label: 'Violet', light: '124 58 237', dark: '196 181 253' },
  { id: 'slate', label: 'Slate', light: '71 85 105', dark: '203 213 225' }
];

/** Is `v` a preset id we ship CSS for? (`default` counts — it means "unset".) */
export function isAccentId(v: unknown): v is string {
  return typeof v === 'string' && ACCENTS.some((a) => a.id === v);
}

/**
 * Initials for the rail avatar: first letter of the first two words, so
 * "Atli Björgvins" → "AB", "atli" → "A", "" → "". Uses the locale-aware
 * uppercase so Icelandic þ/ð/æ/ö come out right.
 */
export function initialsFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toLocaleUpperCase('is'))
    .join('');
}
