// WordPress (klak.is) integration. twin pushes events to the klak.is
// "vidburdure" custom post type through a Directus Flow ("WordPress
// proxy") that holds an Application Password server-side — same thin
// passthrough shape as the Meta proxy. The browser never sees the
// credential and wp-json's CORS never applies.
//
// twin is the source of truth: every push records the WordPress post id
// in event_platform_link (platform 'wordpress'), so re-pushing UPDATES
// the same post instead of duplicating, and the same table will hold
// Facebook/Instagram/LinkedIn event ids later.
//
// Set WP_FLOW_ID once the Flow exists; the empty placeholder makes every
// call throw a clear "not connected" error. Flow setup is shown in twin
// under Settings → WordPress.
import { repo } from '$lib/data/repo';
import { PUBLIC_DIRECTUS_URL } from '$env/static/public';

const WP_FLOW_ID = ''; // ← Directus Flow id for the "WordPress proxy"
/** klak.is event custom post type (viðburður). */
const WP_EVENT_TYPE = 'vidburdure';

export function wordpressConfigured(): boolean {
  return WP_FLOW_ID.length > 0;
}

export type WpStatus = 'draft' | 'publish' | 'pending' | 'private';

export type EventPlatformLink = {
  id: number;
  event_id?: number | null;
  platform?: string | null;
  external_id?: string | null;
  url?: string | null;
  status?: string | null;
  synced_at?: string | null;
};

/** Low-level: forward one request through the WordPress proxy flow and
 *  return wp-json's parsed body. `path` is relative to /wp-json (e.g.
 *  "wp/v2/vidburdure/123"). Throws with WordPress's own message. */
async function wpRequest<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  if (!WP_FLOW_ID) {
    throw new Error(
      'No WordPress site is connected yet — create the "WordPress proxy" Flow (see Settings → WordPress) and set WP_FLOW_ID in src/lib/wordpress.ts.'
    );
  }
  const res = await fetch(`${PUBLIC_DIRECTUS_URL}/flows/trigger/${WP_FLOW_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, body })
  });
  const wrapper = (await res.json().catch(() => null)) as
    | ({ status?: number; data?: unknown } & Record<string, unknown>)
    | null;
  if (!wrapper) throw new Error('WordPress proxy returned an unreadable response');
  const payload = (wrapper.data ?? wrapper) as { code?: string; message?: string } & Record<string, unknown>;
  const status = (wrapper.status as number | undefined) ?? res.status;
  // WordPress REST errors: { code, message, data: { status } }.
  if (payload?.code && payload?.message) {
    if (status === 401 || status === 403 || payload.code === 'rest_cannot_create') {
      throw new Error('The WordPress site rejected the credential — refresh the Application Password in the "WordPress proxy" Flow.');
    }
    throw new Error(payload.message);
  }
  if (status < 200 || status >= 300) throw new Error(`WordPress proxy HTTP ${status}`);
  return payload as T;
}

/** ISO (twin) → WordPress/ACF datetime "YYYY-MM-DD HH:MM:SS" (UTC,
 *  matching klak.is which runs Atlantic/Reykjavík = UTC). */
function toWpDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  let s = iso.replace('T', ' ').replace(/(\.\d+)?Z?$/, '').slice(0, 19);
  // datetime-local gives "YYYY-MM-DD HH:MM" — pad seconds for ACF.
  if (/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(s)) s += ':00';
  return s;
}

/** All platform links for an event (the id registry row set). */
export async function listEventPlatformLinks(eventId: number): Promise<EventPlatformLink[]> {
  return repo.list<EventPlatformLink>('event_platform_link', {
    where: { field: 'event_id', op: 'eq', value: eventId },
    sort: ['platform']
  });
}

async function upsertPlatformLink(row: {
  event_id: number;
  platform: string;
  external_id: string;
  url?: string | null;
  status?: string | null;
}): Promise<void> {
  const existing = await repo.list<EventPlatformLink>('event_platform_link', {
    where: {
      and: [
        { field: 'event_id', op: 'eq', value: row.event_id },
        { field: 'platform', op: 'eq', value: row.platform }
      ]
    },
    limit: 1
  });
  const patch = { ...row, synced_at: new Date().toISOString() };
  if (existing[0]) {
    await repo.update('event_platform_link', existing[0].id, patch as Record<string, unknown>);
  } else {
    await repo.create('event_platform_link', patch as Record<string, unknown>);
  }
}

/** Minimal event shape the push needs (avoids coupling to events/data.ts). */
export type PublishableEvent = {
  id: number;
  name?: string | null;
  summary?: string | null;
  start?: string | null;
  end?: string | null;
  location_name?: string | null;
};

type WpPost = { id: number; link?: string; status?: string };

/** Push a twin event to klak.is as a `vidburdure` post. Updates the
 *  existing WP post when one is already linked, else creates a new one
 *  and records its id. Returns the live link + status. */
export async function publishEventToWordPress(
  event: PublishableEvent,
  opts: { status: WpStatus } = { status: 'draft' }
): Promise<{ id: string; url: string; status: string }> {
  const links = await listEventPlatformLinks(event.id);
  const wp = links.find((l) => l.platform === 'wordpress' && l.external_id);

  const body = {
    title: event.name ?? '',
    content: event.summary ?? '',
    excerpt: event.summary ?? '',
    status: opts.status,
    acf: {
      start: toWpDate(event.start),
      end: toWpDate(event.end),
      location_text: event.location_name ?? ''
    }
  };

  const path = wp ? `wp/v2/${WP_EVENT_TYPE}/${wp.external_id}` : `wp/v2/${WP_EVENT_TYPE}`;
  const post = await wpRequest<WpPost>('POST', path, body);

  await upsertPlatformLink({
    event_id: event.id,
    platform: 'wordpress',
    external_id: String(post.id),
    url: post.link ?? null,
    status: post.status ?? opts.status
  });

  return { id: String(post.id), url: post.link ?? '', status: post.status ?? opts.status };
}
