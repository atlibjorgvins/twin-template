// A second Directus client, for the frettir instance.
//
// Its own client, its own token, its own types — never an extension of the
// main Schema. Same posture as src/lib/immich.ts: a second system is a second
// system, and typing it into the main schema would make an outage over there
// look like a bug over here.
//
// Built lazily. `createDirectus('')` throws inside the URL parser, and this
// module is imported by code that runs whether or not the feature is
// configured, so constructing at import time would take the whole page down
// on a twin that simply does not use news.
import { createDirectus, rest, staticToken, type DirectusClient, type RestClient } from '@directus/sdk';
import { NEWS_URL, NEWS_TOKEN, newsConfigured } from './enabled';

type NewsSchema = Record<string, unknown>;
type Client = DirectusClient<NewsSchema> & RestClient<NewsSchema>;

let client: Client | null = null;

function build(): Client {
  return createDirectus<NewsSchema>(NEWS_URL)
    .with(staticToken(NEWS_TOKEN))
    .with(rest()) as Client;
}

/**
 * Run a query against the news instance.
 *
 * Returns `fallback` instead of throwing when the feature is unconfigured or
 * the service is unreachable. That is deliberate and it is the whole
 * isolation story: a wedged frettir must render an empty card on an org page,
 * never an error, and never take the CRM page down with it.
 */
export async function newsQuery<T>(
  run: (c: Client) => Promise<T>,
  fallback: T
): Promise<T> {
  if (!newsConfigured()) return fallback;
  try {
    client ??= build();
    return await run(client);
  } catch {
    return fallback;
  }
}

/** Is the service actually answering? For the settings page, not for reads. */
export async function newsReachable(timeoutMs = 5000): Promise<boolean> {
  if (!newsConfigured()) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${NEWS_URL}/server/ping`, { signal: ctl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
