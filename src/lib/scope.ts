import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';
import { SCOPE_LOCK } from '$lib/instance';
// Type-only: erased at compile time, so no runtime coupling to the repo layer.
import type { Filter as RepoFilter } from '$lib/data/repo';

export type Scope = 'all' | 'work' | 'private';
const KEY = 'twin.scope';

// A locked instance ignores whatever this device remembered. The Work/Private
// split is a personal-twin idea — one database holding both halves of a life.
// A workplace twin has only the work half, so Private is a mode that can only
// ever be empty, and a device that once stored 'private' would open to it.
const initial: Scope =
  SCOPE_LOCK || (browser ? ((localStorage.getItem(KEY) as Scope) ?? 'all') : 'all');

const store = writable<Scope>(initial);

/**
 * Same store shape either way, so no caller needs to know: on a locked build
 * `$scope = 'private'` is swallowed rather than throwing, and the UI that
 * should not offer the choice asks `scopeLocked()` and hides itself.
 */
export const scope: Writable<Scope> = SCOPE_LOCK
  ? { subscribe: store.subscribe, set: () => {}, update: () => {} }
  : store;

/** Is the scope fixed by this build (workplace instance) rather than chosen? */
export function scopeLocked(): boolean {
  return SCOPE_LOCK !== '';
}

if (browser) {
  store.subscribe((v) => {
    // Nothing to remember on a locked build — the value comes from the
    // build, and persisting it would strand the device if the lock is lifted.
    if (!SCOPE_LOCK) localStorage.setItem(KEY, v);
    // Drive the scope-themed accent (orange = private, purple = work,
    // default teal/chartreuse = all). CSS in app.css keys off this.
    if (v === 'work' || v === 'private') document.documentElement.setAttribute('data-scope', v);
    else document.documentElement.removeAttribute('data-scope');
  });
}

/**
 * Returns a Directus filter fragment for the given scope.
 * 'all'     → no restriction
 * 'work'    → scope in ('work','both') OR null/unset
 * 'private' → scope in ('private','both')
 *
 * Work includes null so un-tagged contacts default to the work context,
 * because most existing records were imported without scope set.
 */
export function scopeFilter(s: Scope): Record<string, unknown> | null {
  if (s === 'all') return null;
  if (s === 'work') {
    return { _or: [{ scope: { _in: ['work', 'both'] } }, { scope: { _null: true } }] };
  }
  return { scope: { _in: ['private', 'both'] } };
}

/**
 * The same scope predicate as scopeFilter(), but as a backend-neutral
 * repository Filter (phase 3 — docs/phase3-data-port.md). New/ported code uses
 * this; scopeFilter() stays until its remaining callers move to the repository.
 */
export function scopeWhere(s: Scope): RepoFilter | null {
  if (s === 'all') return null;
  if (s === 'work') {
    return {
      or: [
        { field: 'scope', op: 'in', value: ['work', 'both'] },
        { field: 'scope', op: 'null' }
      ]
    };
  }
  return { field: 'scope', op: 'in', value: ['private', 'both'] };
}

/**
 * Client-side twin of `scopeFilter` — does a row with the given `scope`
 * value belong in the current view? Same rule: 'all' passes everything,
 * 'work' includes un-tagged rows (null), 'private' does not. Used to
 * filter already-loaded lists reactively (e.g. the Today dashboard) so
 * flipping the toggle updates them without a refetch.
 */
export function matchesScope(s: Scope, value: string | null | undefined): boolean {
  if (s === 'all') return true;
  const v = value ?? null;
  if (s === 'work') return v === 'work' || v === 'both' || v === null;
  return v === 'private' || v === 'both';
}

/**
 * Should a UI *surface* (nav item, tool tile) show in the current mode?
 * Unlike `matchesScope` (which is for data rows, where un-tagged = work),
 * an un-tagged or 'both' surface always shows — you opt a page *into* a
 * single mode, you don't accidentally hide it by forgetting to tag it.
 *   'all'      → everything
 *   'work'     → surfaces tagged work or both/undefined
 *   'private'  → surfaces tagged private or both/undefined
 */
export type SurfaceScope = 'work' | 'private' | 'both';
export function surfaceInScope(active: Scope, surface: SurfaceScope | null | undefined): boolean {
  if (active === 'all') return true;
  const s = surface ?? 'both';
  return s === 'both' || s === active;
}

export const scopeLabel: Record<Scope, string> = {
  all: 'All',
  work: 'Work',
  private: 'Private'
};
