// Profile: who this device belongs to and how the app should look for them.
// Persisted as flat localStorage keys, one per fact, matching twin.theme /
// twin.scope so the flash-free inline script in app.html can read them
// without JSON parsing:
//
//   twin.name       display name — the Today greeting and the rail initials
//   twin.accent     accent preset id (data-accent on <html>; absent = default)
//   twin.onboarded  '1' once /welcome has been completed (or skipped)
//
// The settings UI and the /welcome wizard mutate via setName/setAccent/
// completeOnboarding — never assign the state directly, the side-effects
// (localStorage write, html attribute) live in the setters. Pure logic
// (initials, preset list) is in profileCore.ts so it stays node-testable.

import { browser } from '$app/environment';
import { isAccentId } from './profileCore';

const NAME_KEY = 'twin.name';
const ACCENT_KEY = 'twin.accent';
const ONBOARDED_KEY = 'twin.onboarded';

function read(key: string): string {
  if (!browser) return '';
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string): void {
  if (!browser) return;
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode / storage full — the in-memory state still applies */
  }
}

export const profile = $state<{ name: string; accent: string }>({
  name: read(NAME_KEY),
  accent: isAccentId(read(ACCENT_KEY)) ? read(ACCENT_KEY) : 'default'
});

/** Write the effective accent onto <html>. `default` removes the attribute —
 *  the base palette (and the scope overrides) take over. Mirrors the inline
 *  script in app.html; keep them in sync. */
function applyAccent(id: string): void {
  if (!browser) return;
  const el = document.documentElement;
  if (id && id !== 'default') el.setAttribute('data-accent', id);
  else el.removeAttribute('data-accent');
}

export function setName(name: string): void {
  profile.name = name.trim();
  write(NAME_KEY, profile.name);
}

export function setAccent(id: string): void {
  if (!isAccentId(id)) return;
  profile.accent = id;
  write(ACCENT_KEY, id === 'default' ? '' : id);
  applyAccent(id);
}

/** Has /welcome run on this device? Read fresh (not cached) — the layout
 *  guard calls this on every navigation and the wizard flips it mid-session. */
export function isOnboarded(): boolean {
  return read(ONBOARDED_KEY) === '1';
}

export function completeOnboarding(): void {
  write(ONBOARDED_KEY, '1');
}

/** Settings → "Run setup again". Keeps name/accent; only re-opens the wizard. */
export function resetOnboarding(): void {
  write(ONBOARDED_KEY, '');
}
