// The desktop (Tauri) bridge — the only module that talks to the shell.
//
// Everything is dynamic-import + guarded on isDesktop(), so the web bundles
// (NAS, KLAK, GitHub Pages) carry no Tauri code on their load path and every
// call is a silent no-op in a plain browser. The shell side is
// src-tauri/src/lib.rs.
//
// Global shortcut: default ⌘K (CmdOrCtrl+K), stored per device under
// twin.spotlightShortcut, rebindable in Settings → Appearance. Registration
// happens from the MAIN window only; the callback invokes the shell's
// toggle_spotlight, so it works while the main window is hidden — closing the
// window hides it (shell keeps running), which is what makes the shortcut
// truly global.

import { goto } from '$app/navigation';

export const SHORTCUT_KEY = 'twin.spotlightShortcut';
export const DEFAULT_SHORTCUT = 'CmdOrCtrl+K';

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function storedShortcut(): string {
  try {
    return localStorage.getItem(SHORTCUT_KEY) || DEFAULT_SHORTCUT;
  } catch {
    return DEFAULT_SHORTCUT;
  }
}

async function windowLabel(): Promise<string> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow().label;
}

/** Register `accel` as THE global shortcut (replacing any previous one).
 *  Throws if the accelerator is invalid or taken system-wide, so the settings
 *  UI can show the reason; the previous binding is already gone by then, so
 *  callers should re-register the old one on failure. */
async function registerShortcut(accel: string): Promise<void> {
  const { register, unregisterAll } = await import('@tauri-apps/plugin-global-shortcut');
  const { invoke } = await import('@tauri-apps/api/core');
  await unregisterAll();
  await register(accel, (event) => {
    if (event.state === 'Pressed') void invoke('toggle_spotlight');
  });
}

/** Change the binding from settings. Persists on success; on failure restores
 *  the previous binding and rethrows for the UI to display. */
export async function setSpotlightShortcut(accel: string): Promise<void> {
  const previous = storedShortcut();
  try {
    await registerShortcut(accel);
    localStorage.setItem(SHORTCUT_KEY, accel);
  } catch (e) {
    try {
      await registerShortcut(previous);
    } catch {
      /* previous also failed — nothing sensible left to restore */
    }
    throw e;
  }
}

/** Main-window startup: register the stored shortcut and listen for the
 *  shell's navigate events (a spotlight result was chosen). Call once from
 *  the root layout; no-ops everywhere but the desktop main window. */
export async function initDesktop(): Promise<void> {
  if (!isDesktop()) return;
  if ((await windowLabel()) !== 'main') return;
  try {
    await registerShortcut(storedShortcut());
  } catch (e) {
    // A taken accelerator must not break app boot — settings can rebind.
    console.error('[desktop] global shortcut registration failed:', e);
  }
  const { listen } = await import('@tauri-apps/api/event');
  await listen<string>('twin:navigate', (ev) => {
    if (typeof ev.payload === 'string' && ev.payload.startsWith('/')) void goto(ev.payload);
  });
}

/** Spotlight-window helpers — no-ops outside the desktop shell. */
export async function spotlightDismiss(): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('hide_spotlight');
}

export async function spotlightOpen(path: string): Promise<void> {
  if (!isDesktop()) {
    void goto(path); // browser preview of /spotlight: behave like a link
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_in_main', { path });
}

/** Reload the spotlight page when the shell re-shows it, so the local
 *  backend re-hydrates and search sees rows written since last open. */
export async function onSpotlightShown(cb: () => void): Promise<void> {
  if (!isDesktop()) return;
  const { listen } = await import('@tauri-apps/api/event');
  await listen('spotlight:show', cb);
}
