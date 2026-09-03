import { writable } from 'svelte/store';
import type { IconName } from '$lib/icon-types';

/**
 * Contextual "page tools" registration.
 *
 * The mobile chrome shows one trailing action button. By default it's
 * the notification bell, but a page can register its own contextual
 * action — a filters/search/tools entry point — by calling
 * `setPageTools(...)` on mount and `clearPageTools()` on destroy. The
 * layout then swaps the bell for a button with the page's icon + label
 * that calls the page's `onOpen` (which typically opens a fullscreen
 * tools menu the page itself renders).
 *
 * Kept deliberately tiny: the page owns the menu markup + state, this
 * store only carries the trigger so the chrome can surface it.
 */
export type PageTools = {
  /** Icon shown in the chrome button. */
  icon: IconName;
  /** Accessible label / tooltip. */
  label: string;
  /** Opens the page's tools menu. The page registers this (re-registers
   *  from an $effect so the live component instance always owns the
   *  current setter) and renders its own menu from local state. */
  onOpen: () => void;
  /** Optional count badge (e.g. active filters) shown on the button. */
  badge?: number;
};

export const pageTools = writable<PageTools | null>(null);

export function setPageTools(tools: PageTools) {
  pageTools.set(tools);
}
export function clearPageTools() {
  pageTools.set(null);
}
