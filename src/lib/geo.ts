// Geocoding + travel time, on free services only.
//
// Nominatim is already used elsewhere in twin for reverse geocoding, and
// OSRM's demo server answers routing without a key. Neither costs anything,
// and neither is fast or guaranteed — so everything here caches hard and
// fails soft. A wall tablet that cannot reach a router should show the event
// without an ETA, never an error.
//
// Nominatim's usage policy asks for caching and a low request rate. Addresses
// do not move, so a geocode is cached in localStorage forever; a route is
// cached for an hour because traffic estimates do drift.

export type LatLon = { lat: number; lon: number };
export type Travel = { seconds: number; metres: number };

const GEO_KEY = 'twin.geocache.v1';
const ROUTE_TTL_MS = 60 * 60_000;

type GeoCache = Record<string, { lat: number; lon: number } | null>;
type RouteCache = Record<string, { at: number; seconds: number; metres: number }>;

const routeCache: RouteCache = {};

function readGeoCache(): GeoCache {
  try {
    return JSON.parse(localStorage.getItem(GEO_KEY) || '{}') as GeoCache;
  } catch {
    return {};
  }
}

function writeGeoCache(c: GeoCache): void {
  try {
    localStorage.setItem(GEO_KEY, JSON.stringify(c));
  } catch {
    /* private mode — we just geocode again next time */
  }
}

/** One Nominatim lookup, cached by exact query string. */
async function geocodeOnce(query: string): Promise<LatLon | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;

  const cache = readGeoCache();
  if (key in cache) return cache[key];

  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ lat: string; lon: string }>;
    const hit = rows[0] ? { lat: Number(rows[0].lat), lon: Number(rows[0].lon) } : null;
    // A null is cached too: "not findable" is a real answer, and re-asking
    // the same unanswerable question on every page view is the abuse
    // Nominatim's policy is about.
    cache[key] = hit;
    writeGeoCache(cache);
    return hit;
  } catch {
    // Do NOT cache a network failure as "not findable" — that would poison
    // the address permanently over one flaky moment.
    return null;
  }
}

/**
 * Address text → coordinates, degrading to a coarser query when the exact
 * string fails.
 *
 * Real calendar locations carry a venue prefix — "Gróska - innovation and
 * business growth center, Bjargargata 1 102, 101 Reykjavík, Iceland" — and
 * Nominatim returns nothing for the whole string while resolving the street
 * part happily. Dropping the prefix and then falling back to the last few
 * comma-separated parts turns "no map" into "the right map" for most of the
 * places in this calendar.
 *
 * Each candidate is cached on its own key, so an address that misses
 * everywhere costs nothing on later views.
 */
export async function geocode(address: string): Promise<LatLon | null> {
  const raw = address.trim();
  if (!raw) return null;

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const candidates = [raw];
  if (parts.length > 1) candidates.push(parts.slice(1).join(', '));
  if (parts.length > 3) candidates.push(parts.slice(-3).join(', '));

  for (const q of candidates) {
    const hit = await geocodeOnce(q);
    if (hit) return hit;
  }
  return null;
}

/**
 * Driving time between two points, via OSRM's public demo server.
 *
 * Driving is the assumption a wall tablet in a house should make: it is the
 * mode that makes "leave now" meaningful. If that is wrong for a given trip
 * the number is still a reasonable floor.
 */
export async function travelTime(from: LatLon, to: LatLon): Promise<Travel | null> {
  const key = `${from.lat.toFixed(3)},${from.lon.toFixed(3)}>${to.lat.toFixed(3)},${to.lon.toFixed(3)}`;
  const hit = routeCache[key];
  if (hit && Date.now() - hit.at < ROUTE_TTL_MS) {
    return { seconds: hit.seconds, metres: hit.metres };
  }

  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as {
      code?: string;
      routes?: Array<{ duration: number; distance: number }>;
    };
    const r = j.routes?.[0];
    if (j.code !== 'Ok' || !r) return null;
    routeCache[key] = { at: Date.now(), seconds: r.duration, metres: r.distance };
    return { seconds: r.duration, metres: r.distance };
  } catch {
    return null;
  }
}

/** "25 min", "1 h 10 min" — minutes are the unit people leave the house in. */
export function formatDuration(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}
