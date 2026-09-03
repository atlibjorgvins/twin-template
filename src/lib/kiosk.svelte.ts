// Kiosk mode — the state twin is in when you arrived from the wall display.
//
// The wall tablet is a different kind of visit: nobody signed in, nobody is
// holding it, and there is no muscle memory for where the back button lives.
// So links out of /display are tagged `utm_source=kioskmode`, and anything
// that wants to behave differently for that audience can ask `isKiosk()`.
//
// The tag marks the ENTRY. It is then remembered for the tab, because a
// second or third hop (person → org → project) would otherwise silently drop
// out of kiosk mode and strand someone in front of a screen with no way
// home. sessionStorage is the right scope: it dies with the tab, so opening
// twin normally on the same device is unaffected.
import { browser } from '$app/environment';

export const KIOSK_PARAM = 'utm_source';
export const KIOSK_VALUE = 'kioskmode';
const KEY = 'twin.kiosk';

let active = $state(false);

/** Reactive — read it in a component and it re-renders on change. */
export function isKiosk(): boolean {
  return active;
}

/**
 * Called on every navigation. Turns kiosk on when the tag is present and
 * keeps it on for the rest of the tab's life.
 */
export function syncKioskFromUrl(url: URL): void {
  if (!browser) return;
  if (url.searchParams.get(KIOSK_PARAM) === KIOSK_VALUE) {
    active = true;
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      /* private mode — kiosk then lasts only as long as the tag is in the URL */
    }
    return;
  }
  if (!active) {
    try {
      active = sessionStorage.getItem(KEY) === '1';
    } catch {
      active = false;
    }
  }
}

/** Leave kiosk mode — the app behaves normally again for this tab. */
export function exitKiosk(): void {
  active = false;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Tag a link as coming from the wall display.
 *
 * Existing query strings are preserved — `/calendar/grid?event=12` has to
 * keep its event — and the tag is never added twice.
 */
export function kioskHref(path: string): string {
  if (path.includes(`${KIOSK_PARAM}=${KIOSK_VALUE}`)) return path;
  const [base, hash] = path.split('#');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${KIOSK_PARAM}=${KIOSK_VALUE}${hash ? `#${hash}` : ''}`;
}
