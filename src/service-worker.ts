/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
//
// Service worker — makes the app SHELL load offline.
//
// The app and the Directus API live on the SAME origin (the Tailscale
// host). So when the tailnet is down the browser can't even fetch the
// HTML/JS to boot the app — the offline mirror/queue never get a chance.
// This worker precaches the app shell + assets so the app launches from
// cache, then the in-app offline layer takes over for data.
//
// Rules:
//  • navigations            → cached SPA shell (so any route boots offline)
//  • app assets (_app, etc.) → cache-first (immutable, hashed)
//  • Directus images /assets → stale-while-revalidate (avatars persist)
//  • everything else (API)   → passthrough; let it fail so the app's
//                              mirror/queue handle it. NEVER cache data.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Dev guard. In `vite dev` the app boots from hashed module URLs
// (…?v=<hash>) that change on every server restart. Precaching the shell
// then replaying it serves a dead bootstrap whose imports 404 → blank gray
// screen. So in dev the worker does nothing: it skips precaching, purges
// any shell cache a previous prod build left behind, and passes every
// request straight to the network. `import.meta.env.DEV` is false in the
// production build, so offline support there is unchanged.
const DEV = import.meta.env.DEV;

const SHELL_CACHE = `twin-shell-${version}`;
const IMG_CACHE = `twin-img`; // kept across versions; images are id-addressed

// App-owned assets to precache. `build` = hashed JS/CSS chunks, `files` =
// everything in /static (manifest, icons, fonts…).
const PRECACHE = [...build, ...files];
const ASSET_SET = new Set(PRECACHE);

// The SPA entry. adapter-static serves index.html as the fallback for all
// client routes; we cache it under a stable key and replay it for any
// offline navigation.
const SHELL_URL = '/';

sw.addEventListener('install', (event) => {
  if (DEV) {
    event.waitUntil(sw.skipWaiting());
    return;
  }
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE);
      // Cache the shell HTML itself (the navigation fallback).
      try {
        await cache.add(SHELL_URL);
      } catch {
        /* offline at install — unlikely, shell fills in on first online nav */
      }
      await sw.skipWaiting();
    })()
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop stale shell caches from previous deploys (keep the image cache).
      // In dev, drop ALL of them — a prod build may have left a shell that
      // would otherwise replay a dead bootstrap.
      for (const key of await caches.keys()) {
        if (key.startsWith('twin-shell-') && (DEV || key !== SHELL_CACHE)) {
          await caches.delete(key);
        }
      }
      await sw.clients.claim();
    })()
  );
});

function isDirectusApi(pathname: string): boolean {
  // Directus shares this origin; never serve its data from cache.
  return (
    pathname.startsWith('/items/') ||
    pathname.startsWith('/server/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/users') ||
    pathname.startsWith('/files') ||
    pathname.startsWith('/graphql') ||
    pathname.startsWith('/fields') ||
    pathname.startsWith('/relations') ||
    pathname.startsWith('/collections')
  );
}

sw.addEventListener('fetch', (event) => {
  if (DEV) return; // dev: never intercept — let Vite serve everything fresh
  const req = event.request;
  if (req.method !== 'GET') return; // mutations always go to the network
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // third-party → passthrough

  // 1) Navigations → SPA shell. Network-first so a reachable server gives
  //    fresh HTML; fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(SHELL_URL, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cached = (await caches.match(SHELL_URL)) || (await caches.match(req));
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // 1b) Runtime env + version manifest → network-first, cache only as an
  //     offline fallback. These are the ONLY files under /_app/ whose URL is
  //     stable across builds (`/_app/env.js`, `/_app/version.json`); every
  //     other /_app/ asset is content-hashed under /_app/immutable/. If they
  //     were served cache-first (rule 4 below) the first cached copy would win
  //     forever, freezing runtime config across deploys. That is exactly what
  //     stranded the auth-mode flip: an old env.js kept PUBLIC_AUTH_MODE empty,
  //     so authEnabled() stayed false and the +layout.ts login guard never ran
  //     — a redeployed session bundle rendered /people unauthenticated. Fresh
  //     when online (a redeploy's config takes effect); cached copy offline (so
  //     the app still boots). env.js is imported at startup, so it must be
  //     reachable offline — hence cache fallback, not passthrough.
  if (url.pathname === '/_app/env.js' || url.pathname === '/_app/version.json') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          return (await caches.match(req)) || Response.error();
        }
      })()
    );
    return;
  }

  // 2) Directus image transforms → stale-while-revalidate, so avatars/logos
  //    you've seen still render offline. Bounded to /assets/ only.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMG_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached || Response.error());
        return cached || network;
      })()
    );
    return;
  }

  // 3) Other Directus API paths → never cache; let them hit the network
  //    (and fail offline, which the app's mirror/queue handle).
  if (isDirectusApi(url.pathname)) return;

  // 4) App assets → cache-first (hashed/immutable). Scoped to /_app/immutable/,
  //    NOT all of /_app/: the stable-URL files there (env.js, version.json) are
  //    handled network-first in rule 1b above and must never be frozen here.
  if (ASSET_SET.has(url.pathname) || url.pathname.startsWith('/_app/immutable/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put(req, res.clone()).catch(() => {});
        return res;
      })()
    );
  }
});
