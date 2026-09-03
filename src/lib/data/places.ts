// Places — towns, venues and the graph that suggests them
//
// A leaf by dependency, not by size: it reads Organization and Person as
// types only and calls nothing defined elsewhere in directus.ts.
//
// `location` began as a taxonomy of 71 Icelandic towns and is now also the
// venue registry: "KLAK Office" is a row with an address, a parent town, and
// coordinates a map provider agrees with. One table rather than two, because
// a venue sits INSIDE a town and the hierarchy is what lets "orgs in
// Reykjavík" keep working after venues arrive.
//
// The point of the graph is suggestion. Two questions, opposite directions:
//
//   org → places      "you added KLAK; did you mean its office?"
//   coords → places   "you are here; this is probably about KLAK"
//
// Both are ranked by how often you have ACTUALLY met somewhere, counted from
// Dates.location_id. That is the whole reason events reference a place
// instead of storing a string.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module, so every existing
// `from '$lib/directus'` import keeps working.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
// Type-only: erased at compile time, so no runtime cycle back into
// the module this was split out of.
import type { Organization, Person } from '$lib/data/types';

// ─────────────────────────────────────────────────────────────────────────

export type PlaceType = 'municipality' | 'region' | 'venue' | 'address' | 'area';

export type Place = {
  id: number;
  name: string;
  name_en?: string | null;
  /** NULL on the original 71 rows, which are all municipalities. */
  place_type?: PlaceType | null;
  parent_id?: number | Place | null;
  address?: string | null;
  region?: string | null;
  municipality?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  osm_id?: string | null;
  geocoded_at?: string | null;
  aliases?: string[] | null;
};

export type OrgPlaceRole = 'office' | 'hq' | 'venue' | 'mailing';
export type PersonPlaceRole = 'home' | 'work' | 'from' | 'meet';

export type OrgPlace = {
  id: number;
  organization_id: number | Organization | null;
  location_id: number | Place | null;
  role?: OrgPlaceRole | null;
  is_primary?: boolean | null;
};

export type PersonPlace = {
  id: number;
  person_id: number | Person | null;
  location_id: number | Place | null;
  role?: PersonPlaceRole | null;
};

/** A place plus why we are suggesting it. */
export type PlaceSuggestion = {
  place: Place;
  /** Times an event has referenced this place. Drives the ordering. */
  uses: number;
  role?: OrgPlaceRole | PersonPlaceRole | null;
  /** Metres from the caller, when the suggestion came from proximity. */
  distance?: number;
  /** Short human reason: "KLAK office", "1.2 km away", "used 14 times". */
  why: string;
};

/** Rows with no place_type are the original municipality taxonomy. */
export function placeType(p: Place): PlaceType {
  return p.place_type ?? 'municipality';
}

export function placeLabel(p: Place): string {
  return p.name || p.name_en || `#${p.id}`;
}

/** The string a geocoder should get: the address if we have one, else the
 *  name qualified by its town so "Gróska" is not ambiguous worldwide. */
export function placeQuery(p: Place, parent?: Place | null): string {
  if (p.address?.trim()) return p.address.trim();
  const town = parent ? placeLabel(parent) : p.municipality || '';
  return [placeLabel(p), town, p.country || 'Iceland'].filter(Boolean).join(', ');
}

export async function listPlaces(opts: { type?: PlaceType; search?: string; limit?: number } = {}) {
  const conds: Filter[] = [];
  if (opts.type) conds.push({ field: 'place_type', op: 'eq', value: opts.type });
  if (opts.search?.trim()) {
    const q = opts.search.trim();
    conds.push({ or: [
      { field: 'name', op: 'icontains', value: q },
      { field: 'name_en', op: 'icontains', value: q },
      { field: 'address', op: 'icontains', value: q }
    ] });
  }
  return await repo.list<Place>('location', {
    fields: ['*'],
    where: conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : { and: conds },
    sort: ['name'],
    limit: opts.limit ?? 200
  });
}

export async function getPlace(id: number) {
  const pl = await repo.get<Place>('location', id, { fields: ['*'] });
  if (!pl) throw new Error(`location ${id} not found`);
  return pl;
}

/**
 * How many events reference each of the given places.
 *
 * One grouped aggregate rather than a request per place — the suggestion
 * dropdown runs this on every keystroke-free open, and N round-trips for a
 * five-item list is the kind of thing that makes a wall tablet feel broken.
 */
export async function placeUseCounts(placeIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (placeIds.length === 0) return out;
  try {
    const rows = await repo.aggregate<{ location_id: number | null; count: { id: string | number } }>('Dates', {
      aggregate: { count: ['id'] },
      groupBy: ['location_id'],
      where: { field: 'location_id', op: 'in', value: placeIds }
    });
    for (const r of rows) {
      if (r.location_id == null) continue;
      out.set(Number(r.location_id), Number(r.count?.id ?? 0));
    }
  } catch {
    // Counts are ordering, not correctness. A failed aggregate should leave
    // the suggestions unranked, never empty.
  }
  return out;
}

async function decorate(
  links: Array<{ location_id: number | Place | null; role?: string | null; is_primary?: boolean | null }>,
  reason: (p: Place, role: string | null, uses: number) => string
): Promise<PlaceSuggestion[]> {
  const places = links
    .map((l) => l.location_id)
    .filter((v): v is Place => !!v && typeof v === 'object');
  const counts = await placeUseCounts(places.map((p) => p.id));

  const out = places.map((p, i) => {
    const link = links[i];
    const role = (link?.role ?? null) as OrgPlaceRole | PersonPlaceRole | null;
    const uses = counts.get(p.id) ?? 0;
    return { place: p, uses, role, why: reason(p, role, uses) };
  });

  // Most-met-at first; is_primary breaks the tie before there is any history,
  // which is the whole first-run experience.
  out.sort((a, b) => {
    if (b.uses !== a.uses) return b.uses - a.uses;
    const ap = links.find((l) => (l.location_id as Place)?.id === a.place.id)?.is_primary ? 1 : 0;
    const bp = links.find((l) => (l.location_id as Place)?.id === b.place.id)?.is_primary ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return placeLabel(a.place).localeCompare(placeLabel(b.place));
  });
  return out;
}

/**
 * "You added KLAK to this event — did you mean one of its places?"
 *
 * Ranked by meetings held there, so the office you actually use floats to
 * the top on its own rather than needing to be marked.
 */
export async function placesForOrg(orgId: number): Promise<PlaceSuggestion[]> {
  try {
    const links = (await repo.list<OrgPlace>('organization_location', {
      fields: ['id', 'role', 'is_primary', 'location_id.*'],
      where: { field: 'organization_id', op: 'eq', value: orgId },
      limit: 50
    })) as OrgPlace[];

    return await decorate(links as never, (p, role, uses) => {
      if (uses > 0) return `met here ${uses}×`;
      if (role === 'hq') return 'headquarters';
      if (role) return String(role);
      return placeType(p) === 'municipality' ? 'town' : 'linked place';
    });
  } catch {
    return [];
  }
}

export async function placesForPerson(personId: number): Promise<PlaceSuggestion[]> {
  try {
    const links = (await repo.list<PersonPlace>('person_location', {
      fields: ['id', 'role', 'location_id.*'],
      where: { field: 'person_id', op: 'eq', value: personId },
      limit: 50
    })) as PersonPlace[];

    return await decorate(links as never, (_p, role, uses) =>
      uses > 0 ? `met here ${uses}×` : role ? String(role) : 'linked place'
    );
  } catch {
    return [];
  }
}

/** Metres between two coordinates. Haversine is plenty at city scale. */
export function metresBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * "You are standing somewhere — which place is this?"
 *
 * Filtered client-side rather than in the database: there are hundreds of
 * rows, not millions, and PostGIS for that is a dependency bought with no
 * change in the answer.
 *
 * Municipalities are excluded by default. A town centroid technically
 * "matches" from anywhere in the town and would bury the venue you are
 * actually standing in.
 */
export async function placesNear(
  at: { lat: number; lon: number },
  opts: { radius?: number; limit?: number; includeTowns?: boolean } = {}
): Promise<PlaceSuggestion[]> {
  const radius = opts.radius ?? 1_500;
  try {
    const rows = await repo.list<Place>('location', {
      fields: ['*'],
      where: { and: [
        { field: 'latitude', op: 'nnull' },
        { field: 'longitude', op: 'nnull' }
      ] },
      limit: 500
    });

    const near = rows
      .filter((p) => opts.includeTowns || placeType(p) !== 'municipality')
      .map((p) => ({
        p,
        d: metresBetween(at, { lat: Number(p.latitude), lon: Number(p.longitude) })
      }))
      .filter((x) => x.d <= radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, opts.limit ?? 6);

    const counts = await placeUseCounts(near.map((x) => x.p.id));
    return near.map(({ p, d }) => ({
      place: p,
      uses: counts.get(p.id) ?? 0,
      distance: d,
      why: d < 120 ? "you're here" : `${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'} away`
    }));
  } catch {
    return [];
  }
}

/** Orgs and people attached to a place — the "tag this note" payload. */
export async function whoIsAt(placeId: number): Promise<{ orgs: Organization[]; people: Person[] }> {
  const [orgLinks, personLinks] = await Promise.all([
    repo
      .list<{ organization_id: Organization | null }>('organization_location', {
        fields: ['organization_id.*'],
        where: { field: 'location_id', op: 'eq', value: placeId },
        limit: 50
      })
      .catch(() => []),
    repo
      .list<{ person_id: Person | null }>('person_location', {
        fields: ['person_id.*'],
        where: { field: 'location_id', op: 'eq', value: placeId },
        limit: 50
      })
      .catch(() => [])
  ]);

  const orgs = (orgLinks as Array<{ organization_id: Organization | null }>)
    .map((l) => l.organization_id)
    .filter((v): v is Organization => !!v && typeof v === 'object');
  const people = (personLinks as Array<{ person_id: Person | null }>)
    .map((l) => l.person_id)
    .filter((v): v is Person => !!v && typeof v === 'object');
  return { orgs, people };
}

/**
 * Create a venue, optionally attached to an org.
 *
 * Deliberately does NOT geocode: resolving an address is a network call that
 * can fail, and a place worth saving is still worth saving without
 * coordinates. `geocoded_at` stays NULL and the coordinates get filled in on
 * first use, by whoever needs them.
 */
export async function createPlace(input: {
  name: string;
  address?: string | null;
  place_type?: PlaceType;
  parent_id?: number | null;
  orgId?: number | null;
  role?: OrgPlaceRole | null;
}): Promise<Place> {
  const place = await repo.create<Place>('location', {
    name: input.name.trim(),
    address: input.address?.trim() || null,
    place_type: input.place_type ?? 'venue',
    parent_id: input.parent_id ?? null,
    country: 'Iceland'
  } as Record<string, unknown>);

  if (input.orgId) {
    await repo
      .create('organization_location', {
        organization_id: input.orgId,
        location_id: place.id,
        role: input.role ?? 'office'
      } as Record<string, unknown>)
      .catch(() => {
        // The place exists and is usable; a missing link is repairable by
        // hand, so this must not throw away the row we just made.
      });
  }
  return place;
}

/** Store coordinates once resolved, so nobody geocodes this address again. */
export async function savePlaceCoords(id: number, lat: number, lon: number, osmId?: string) {
  return await repo.update('location', id, {
    latitude: lat,
    longitude: lon,
    osm_id: osmId ?? null,
    geocoded_at: new Date().toISOString()
  });
}
