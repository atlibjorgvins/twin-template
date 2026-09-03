// Theme: light / dark / auto. Persisted in localStorage under
// `twin.theme`. App boot uses an inline script in app.html to apply
// the stored value *before* first paint so there's no flash of the
// wrong theme on load.
//
// The settings UI mutates `theme.mode` via `setTheme(...)`. The
// `applyTheme()` helper writes the effective mode onto <html>
// (`data-theme="dark"` for dark, attribute removed for light) — the
// CSS in app.css picks it up.

import { browser } from '$app/environment';

export type ThemeMode = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'twin.theme';

function readStored(): ThemeMode {
  if (!browser) return 'auto';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'auto') return v;
  } catch { /* ignore */ }
  return 'auto';
}

/** Reactive theme container. Read `theme.mode` and `theme.effective`
 *  from components; never assign directly — call `setTheme()` so the
 *  side-effects (localStorage write, html attribute) run too. */
export const theme = $state<{ mode: ThemeMode; effective: 'light' | 'dark' }>({
  mode: readStored(),
  effective: 'light'
});

function resolveEffective(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  if (!browser) return 'light';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Push the current mode onto <html> + recompute `effective`. Idempotent. */
export function applyTheme() {
  const eff = resolveEffective(theme.mode);
  theme.effective = eff;
  if (!browser) return;
  if (eff === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}

export function setTheme(mode: ThemeMode) {
  theme.mode = mode;
  if (browser) {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
  }
  applyTheme();
}

// Re-apply when the OS appearance flips while we're in 'auto'. Wired
// once from the layout's onMount so we don't add multiple listeners.
let mqUnsub: (() => void) | null = null;
export function watchSystemTheme() {
  if (!browser || mqUnsub) return;
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (theme.mode === 'auto') applyTheme(); };
    mq.addEventListener('change', onChange);
    mqUnsub = () => mq.removeEventListener('change', onChange);
  } catch { /* ignore */ }
}
