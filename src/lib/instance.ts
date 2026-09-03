// Which twin is this build, and which parts of it exist.
//
// One codebase, more than one deployment: the personal twin on the NAS and
// the KLAK twin next to it. They run the same source — what differs is the
// Directus they talk to, the name in the header, and which modules are in
// the build at all. All three come from PUBLIC_* variables baked in at build
// time, so a deployment is a `.env.<instance>` file and nothing else.
//
// DENY-LIST, deliberately. Everything is on unless PUBLIC_DISABLED_FEATURES
// names it. An empty variable therefore means "the twin as it always was" —
// the personal build cannot regress because someone forgot to add a new
// feature to an allow-list, and a feature added next month lands in every
// instance until somebody decides otherwise. The workplace build carries the
// list of what it does not want, which is the shorter list and the honest
// one: it is a subtraction from the personal twin, not a separate product.
//
// `$env/dynamic/public`, not `$env/static/public` — a static import of a
// variable nobody set is a svelte-check error in every build that does not
// set it. Under adapter-static the value is still baked in at build time;
// there is no server to read it later. Same reasoning as news/enabled.ts.
import { env } from '$env/dynamic/public';
// The plugin registry is now the single source of truth for which modules exist
// and what routes they own — see docs/phase4-plugins.md. FeatureKey, the list of
// keys, and the route map are re-exported here so every existing
// `from '$lib/instance'` import keeps working unchanged.
import { FEATURE_KEYS, ROUTE_FEATURES } from '$lib/plugins/registry';
import type { FeatureKey } from '$lib/plugins/keys';

/** Every module that a deployment is allowed to switch off. */
export type { FeatureKey };
export { FEATURE_KEYS };

const requested = (env.PUBLIC_DISABLED_FEATURES ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const known = new Set<string>(FEATURE_KEYS);

// ── ALLOW-LIST mode (strip builds) ───────────────────────────────────
// PUBLIC_ENABLED_FEATURES inverts the default: when set, ONLY the named
// plugins exist and everything else — including a plugin added next month —
// is off. This is what the roadmap's core build (People + Organizations, the
// .dmg, the public GitHub template) needs: a deny-list can never keep up with
// a growing registry, an allow-list cannot fall behind. The literal `core`
// means "core only, no plugins"; ids may follow it (`core,family,habits` —
// `core` is then redundant but harmless). When unset, the deny-list above
// rules and nothing changes for existing instances.
const allowRaw = (env.PUBLIC_ENABLED_FEATURES ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const allowListMode = allowRaw.length > 0;
const allowed = new Set(allowRaw.filter((k) => known.has(k)));

// Three build states per plugin:
//   locked-off   deny-list mode, named in PUBLIC_DISABLED_FEATURES. The
//                operator subtracted it; a device cannot bring it back.
//   default-off  allow-list mode, not named. The code IS in the bundle —
//                the strip build just ships it dormant, and a device turns
//                it on from Settings → Plugins with no terminal involved.
//   on           everything else.
const disabled = allowListMode
  ? new Set<string>() // allow-list mode locks nothing; it changes defaults
  : new Set(requested.filter((k) => known.has(k)));
const defaultOff = allowListMode
  ? new Set([...FEATURE_KEYS].filter((k) => !allowed.has(k)))
  : new Set<string>();

/** Names in PUBLIC_DISABLED_FEATURES / PUBLIC_ENABLED_FEATURES that match no
 *  feature — almost always a typo. In the deny-list a typo fails open (the
 *  feature stays visible); in the allow-list it fails closed (the feature is
 *  missing). Either way it has to be said out loud rather than silently
 *  ignored. Surfaced on /settings. `core` is a documented keyword, not a typo. */
export const unknownDisabledFeatures = allowListMode
  ? allowRaw.filter((k) => !known.has(k) && k !== 'core')
  : requested.filter((k) => !known.has(k));

// ── Per-device runtime toggle ────────────────────────────────────────
// The deny-list above is build-time (PUBLIC_DISABLED_FEATURES). On top of it a
// person can switch an installed plugin off on THIS device, from Settings →
// Plugins, persisted in localStorage. It can only turn a build-enabled plugin
// OFF (and back on) — it can never force on something the build left out, so a
// build-time decision always wins. Lazily read + cached; guarded so the Node
// build (no localStorage) never touches it.
const RUNTIME_KEY = 'twin.plugins.disabled';
const RUNTIME_ON_KEY = 'twin.plugins.enabled';

function readIdSet(key: string): Set<string> {
  const s = new Set<string>();
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key);
      if (raw) for (const k of JSON.parse(raw) as string[]) s.add(k);
    }
  } catch {
    /* private mode / no storage — treat as empty */
  }
  return s;
}
function writeIdSet(key: string, s: Set<string>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    /* nothing else to try */
  }
}

let _runtime: Set<string> | null = null;
function runtimeDisabled(): Set<string> {
  if (!_runtime) _runtime = readIdSet(RUNTIME_KEY);
  return _runtime;
}
// Plugins this device turned ON that the build ships default-off (allow-list
// strip builds — the .dmg, the GitHub template). The counterpart of the
// disabled set; only consulted for default-off plugins.
let _runtimeOn: Set<string> | null = null;
function runtimeEnabled(): Set<string> {
  if (!_runtimeOn) _runtimeOn = readIdSet(RUNTIME_ON_KEY);
  return _runtimeOn;
}

/** Is this module on?
 *  locked-off → never. default-off → only if this device enabled it.
 *  otherwise → unless this device disabled it. */
export function featureOn(key: FeatureKey): boolean {
  if (disabled.has(key)) return false;
  if (defaultOff.has(key)) return runtimeEnabled().has(key);
  return !runtimeDisabled().has(key);
}

/** Locked out of THIS build (env deny-list) — a device cannot re-enable it. */
export function featureDisabledInBuild(key: FeatureKey): boolean {
  return disabled.has(key);
}

/** Ships in this build but off by default (allow-list strip build). The
 *  Plugins page shows these with a working toggle, not a "not in build" badge. */
export function featureDefaultOff(key: FeatureKey): boolean {
  return defaultOff.has(key);
}

/** Switched off on this device (but on by default in the build). */
export function featureDisabledOnDevice(key: FeatureKey): boolean {
  return !disabled.has(key) && !defaultOff.has(key) && runtimeDisabled().has(key);
}

/** The device-disabled plugin ids, for pushing to cross-device sync. */
export function runtimeDisabledList(): string[] {
  return [...runtimeDisabled()];
}

/** The device-enabled (default-off) plugin ids, for cross-device sync. */
export function runtimeEnabledList(): string[] {
  return [...runtimeEnabled()];
}

/** Replace the device-disabled set from a synced source (Directus), and mirror
 *  to localStorage so it survives offline. Called at load before gating. */
export function hydrateRuntimeDisabled(ids: string[]): void {
  _runtime = new Set(ids);
  writeIdSet(RUNTIME_KEY, _runtime);
}

/** Replace the device-enabled set from a synced source. */
export function hydrateRuntimeEnabled(ids: string[]): void {
  _runtimeOn = new Set(ids);
  writeIdSet(RUNTIME_ON_KEY, _runtimeOn);
}

/** Turn an installed plugin on/off for this device; persists to localStorage.
 *  No-op for a locked-off plugin — the operator's subtraction stands. For a
 *  default-off plugin this edits the enabled set; otherwise the disabled set. */
export function setFeatureEnabled(key: FeatureKey, on: boolean): void {
  if (disabled.has(key)) return;
  if (defaultOff.has(key)) {
    const s = runtimeEnabled();
    if (on) s.add(key);
    else s.delete(key);
    writeIdSet(RUNTIME_ON_KEY, s);
    return;
  }
  const s = runtimeDisabled();
  if (on) s.delete(key);
  else s.add(key);
  writeIdSet(RUNTIME_KEY, s);
}

/** The build-time disabled set, for the settings page that reports the build. */
export function disabledFeatures(): FeatureKey[] {
  return FEATURE_KEYS.filter((k) => disabled.has(k));
}

// ── Identity ─────────────────────────────────────────────────────────
// A short machine-ish id (`personal`, `klak`) and a human label. The label
// is what a person sees; the id is what code branches on if it ever has to.

export const INSTANCE = (env.PUBLIC_INSTANCE ?? '').trim() || 'personal';
export const INSTANCE_LABEL = (env.PUBLIC_INSTANCE_LABEL ?? '').trim();

/** Anything other than the default instance is worth naming in the UI —
 *  two twins open in two tabs, both grey, both called "twin", is a way to
 *  write a private note into the workplace database. */
export function instanceIsDefault(): boolean {
  return INSTANCE === 'personal';
}

// ── Scope lock ───────────────────────────────────────────────────────
// The Work/Private toggle is a personal-twin idea: one database holding both
// halves of a life. A workplace instance has only the work half, so the
// toggle offers a Private mode that can only ever be empty. PUBLIC_SCOPE_LOCK
// pins the scope and hides the control; scope.ts enforces it.

export type ScopeLock = 'work' | 'private' | '';
const lock = (env.PUBLIC_SCOPE_LOCK ?? '').trim().toLowerCase();
export const SCOPE_LOCK: ScopeLock = lock === 'work' || lock === 'private' ? lock : '';

/**
 * How this build authenticates to Directus.
 *
 *   ''         the static token baked into the bundle — every visitor is the
 *              same Directus identity. What twin has always done. DEFAULT, so
 *              an unset variable changes nothing.
 *   'session'  a real login: Directus sets an httpOnly session cookie, the SDK
 *              refreshes it, and there is no token in the bundle or the DOM.
 *
 * Deliberately a build-time flag rather than a runtime toggle: the two modes
 * construct the Directus client differently (client.ts), and a workplace or
 * public deployment must not be able to fall back to a shared token by flipping
 * a setting. Requires the same-origin /api deployment — a cookie needs it.
 */
export type AuthMode = '' | 'session';
const authRaw = (env.PUBLIC_AUTH_MODE ?? '').trim();
export const AUTH_MODE: AuthMode = authRaw === 'session' ? 'session' : '';

/** Is this build using real per-user login rather than the shared token? */
export function authEnabled(): boolean {
  return AUTH_MODE === 'session';
}

// ── Route guard map ──────────────────────────────────────────────────
// Hiding a tile is not removing a feature: deep links, the command palette,
// a bookmark and the back button all still reach the route. One map, checked
// once in +layout.ts, closes every one of those doors at the same time.
//
// ROUTE_FEATURES is derived from the plugin manifests (plugins/registry.ts).
// Longest prefix wins, so a child route can belong to a different plugin than
// its parent, and the derived order does not matter.

/** The feature a path belongs to, or null if it belongs to the core app. */
export function featureForPath(pathname: string): FeatureKey | null {
  let best: readonly [string, FeatureKey] | null = null;
  for (const entry of ROUTE_FEATURES) {
    const [prefix] = entry;
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      if (!best || prefix.length > best[0].length) best = entry;
    }
  }
  return best ? best[1] : null;
}

/** Should this path load in this build? */
export function pathAllowed(pathname: string): boolean {
  const feature = featureForPath(pathname);
  return feature === null || featureOn(feature);
}
