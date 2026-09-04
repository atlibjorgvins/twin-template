// The enable/disable choreography shared by the Plugins pages.
//
// A plugin toggle must reload (nav, tiles, and the route guard read featureOn
// non-reactively at load — the page comment explains why), but the OLD flow
// was: await a network sync, then reload. Two problems: the awaited sync froze
// the switch mid-flip for as long as the network took, and the reload cut in
// at an arbitrary frame. localStorage already holds the change before the sync
// starts, so the sync never needed awaiting.
//
// New flow: mutate synchronously (the switch is already animating its 200ms
// flip) → fire the sync without awaiting → let the knob settle → 150ms fade →
// reload. The cut becomes an intentional beat instead of a flash. With
// prefers-reduced-motion the waits and the fade are skipped entirely.
import { savePluginConfig } from '$lib/data/pluginConfig';
import { ensurePluginSchema } from '$lib/data/repo/schemaSync';

/** Knob transition duration + a breath. Keep in step with PluginSwitch.svelte. */
const SETTLE_MS = 240;
const FADE_MS = 150;
const SCROLL_KEY = 'twin.plugins.scroll';

/** Re-land where the person was. SvelteKit runs scroll restoration manually,
 *  so a reload would otherwise snap to the top — toggling something far down
 *  the list must not teleport the page. Call from the page's onMount. */
export function restoreToggleScroll(): void {
  try {
    const y = sessionStorage.getItem(SCROLL_KEY);
    if (y != null) {
      sessionStorage.removeItem(SCROLL_KEY);
      requestAnimationFrame(() => scrollTo(0, Number(y)));
    }
  } catch {
    /* private mode — land at the top like any load */
  }
}

/**
 * Enabling a plugin on a Supabase vault may need its tables created first —
 * ensurePluginSchema applies them when this device holds the vault's admin
 * key. The reload WAITS for that (capped): reloading mid-DDL would abort the
 * request and the plugin would boot into missing tables anyway. The common
 * cases stay fast — wrong backend returns instantly, tables-already-there is
 * one probe — and a failed apply never blocks the toggle: the plugin then
 * shows its own missing-table state. Pass the plugin id on ENABLE toggles;
 * omit for disables (nothing to provision).
 */
export function applyAndReload(mutate: () => void, enabledPluginId?: string): void {
  mutate(); // synchronous localStorage write — the state is already safe
  void savePluginConfig(); // cross-device mirror; failure only skips the sync
  try {
    sessionStorage.setItem(SCROLL_KEY, String(scrollY));
  } catch {
    /* nothing else to try */
  }

  const ensured: Promise<unknown> = enabledPluginId
    ? Promise.race([
        ensurePluginSchema(enabledPluginId).catch(() => {}),
        new Promise((r) => setTimeout(r, 8000)) // a hung network must not trap the toggle
      ])
    : Promise.resolve();

  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    void ensured.then(() => location.reload());
    return;
  }
  setTimeout(() => {
    const el = document.documentElement;
    el.style.transition = `opacity ${FADE_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`;
    el.style.opacity = '0.5';
    setTimeout(() => {
      void ensured.then(() => location.reload());
    }, FADE_MS);
  }, SETTLE_MS);
}
