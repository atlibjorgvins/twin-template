// The vault-switch transition. A swap is still a full reload — the repo is a
// per-load singleton, and pretending otherwise would interleave two vaults'
// queries — but the reload no longer LOOKS like one: switchVault() drops a
// note in sessionStorage, app.html's inline curtain covers the load gap with
// the destination's name, and finishVaultSwitch() (root layout, after the new
// vault has booted) restores scroll and fades the curtain out. The one-time
// jank becomes a designed beat.

import { setActiveVault } from '$lib/data/repo/vaults';

const KEY = 'twin.vaultSwitch';

/** Switch to another vault with the curtain transition. Defaults to the
 *  current path; pass `path` to land somewhere specific (opening a foreign
 *  row jumps straight to its detail page in the owning vault). The
 *  destination's guards (managed sign-in, onboarding) still apply on the way
 *  in, exactly as before. */
export function switchVault(id: string, name: string, path?: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ name, y: scrollY }));
  } catch {
    /* private mode — plain reload, no curtain */
  }
  setActiveVault(id);
  window.location.href = path ?? window.location.pathname;
}

/** Called once from the root layout after boot: restore scroll, lift the
 *  curtain. No-op when this load wasn't a vault switch. */
export function finishVaultSwitch(): void {
  let y = 0;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    sessionStorage.removeItem(KEY);
    y = Number(JSON.parse(raw).y) || 0;
  } catch {
    return;
  }
  // setTimeout, not requestAnimationFrame: rAF never fires while the window
  // is hidden or minimized, which would leave the curtain covering the page
  // until the window is next shown.
  setTimeout(() => {
    scrollTo(0, y);
    const el = document.getElementById('vault-switch-curtain');
    if (!el) return;
    el.style.opacity = '0';
    // display, not `hidden`: the element's inline display would override the
    // [hidden] rule — the v1.3.0 white-screen in one line.
    setTimeout(() => (el.style.display = 'none'), 220);
  }, 30);
}
