// Buffer integration
//
// The posting queue. Imports platformService and isStoryPlatform from
// evergreen.ts, which is the whole reason these two had to move together.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import { PUBLIC_DIRECTUS_URL } from '$env/static/public';
import type { CampaignPlatform } from '$lib/data/evergreen';
import type { Project } from '$lib/data/types';
import { isStoryPlatform, platformService } from '$lib/data/evergreen';

// ── Buffer integration ──────────────────────────────────────────────
// twin queues Evergreen posts into Buffer through a Directus Flow
// ("Buffer post proxy") that holds the Buffer API key server-side —
// the browser never sees the key and api.buffer.com's CORS never
// applies. Images ride as public URLs (Tailscale Funnel on :10000
// exposes only /assets; file UUIDs are unguessable).
export type BufferChannel = {
  id: string;
  name?: string | null;
  display_name?: string | null;
  service?: string | null; // facebook | instagram | linkedin | …
  channel_type?: string | null;
  avatar?: string | null;
  is_disconnected?: boolean | null;
  project_id?: number | Project | null;
};

export async function listBufferChannels(): Promise<BufferChannel[]> {
  return await repo.list<BufferChannel>('buffer_channel', {
    fields: ['*', { project_id: ['id', 'name'] }],
    sort: ['service', 'display_name']
  });
}

export async function updateBufferChannel(
  id: string,
  patch: Partial<BufferChannel>
): Promise<BufferChannel> {
  return await repo.update<BufferChannel>('buffer_channel', id, patch as Record<string, unknown>);
}

const BUFFER_FLOW_ID = '';

/** Public (Funnel) asset URL Buffer's servers can fetch — same host,
 *  port 10000, /assets only. */
export function publicAssetUrl(fileId: string | null | undefined): string {
  if (!fileId) return '';
  const u = new URL(PUBLIC_DIRECTUS_URL);
  u.port = '10000';
  u.pathname = `/assets/${fileId}`;
  u.search = '';
  return u.toString();
}

const CREATE_POST_MUTATION = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id dueAt status isCustomScheduled } }
    ... on NotFoundError { message }
    ... on UnauthorizedError { message }
    ... on UnexpectedError { message }
    ... on RestProxyError { message code }
    ... on LimitReachedError { message }
    ... on InvalidInputError { message }
  }
}`;

export type QueueToBufferInput = {
  channelId: string;
  text: string;
  platform: CampaignPlatform | string;
  imageId?: string | null;
  altText?: string;
  /** ShareMode, per Buffer's schema. `customScheduled` is set automatically
   *  when scheduledAt is given, so callers do not pass it. */
  mode?: 'addToQueue' | 'shareNow' | 'shareNext' | 'customScheduled';
  /** ISO datetime — schedules the post at this exact slot (Buffer
   *  dueAt + custom scheduling) instead of the channel queue. */
  scheduledAt?: string | null;
};

/** Queue one post in Buffer via the proxy flow. Returns the Buffer
 *  post id. Throws with Buffer's own message on validation errors. */
export type QueuedBufferPost = {
  id: string;
  /** When Buffer will actually publish it. For an automatic queue slot this is
   *  the only place that time exists — twin cannot compute it, which is why
   *  "used on <date>" was all a queued post could previously show. */
  dueAt?: string | null;
  status?: string | null;
  isCustomScheduled?: boolean | null;
};

export async function queueToBuffer(input: QueueToBufferInput): Promise<QueuedBufferPost> {
  const assets: unknown[] = [];
  if (input.imageId) {
    assets.push({
      image: {
        url: publicAssetUrl(input.imageId),
        metadata: { altText: input.altText || 'post image' }
      }
    });
  }
  // Service-specific required metadata. `type` is required on both Facebook and
  // Instagram, and it is the only thing separating a story from a feed post —
  // same channel, same assets, different type. Instagram additionally requires
  // shouldShareToFeed, which must be false for a story: true would also drop it
  // into the grid.
  const service = platformService(String(input.platform));
  const kind = isStoryPlatform(String(input.platform)) ? 'story' : 'post';
  const metadata: Record<string, unknown> = {};
  if (service === 'facebook') metadata.facebook = { type: kind };
  if (service === 'instagram')
    metadata.instagram = { type: kind, shouldShareToFeed: kind !== 'story' };

  const variables = {
    input: {
      channelId: input.channelId,
      text: input.text,
      assets,
      // `mode` and `schedulingType` are both required on EVERY post — the
      // scheduled branch used to omit mode, which is why queueing a batch
      // failed ("Field \"mode\" of required type \"ShareMode!\" was not
      // provided") while single posts, which take the other branch, worked.
      //
      // And there is no 'custom' SchedulingType: the enum is automatic |
      // notification. A fixed time is expressed as mode customScheduled with
      // dueAt, still on the automatic schedule.
      ...(input.scheduledAt
        ? { dueAt: input.scheduledAt, mode: 'customScheduled', schedulingType: 'automatic' }
        : { mode: input.mode ?? 'addToQueue', schedulingType: 'automatic' }),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      source: 'twin-evergreen'
    }
  };

  const res = await fetch(`${PUBLIC_DIRECTUS_URL}/flows/trigger/${BUFFER_FLOW_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CREATE_POST_MUTATION, variables })
  });
  const wrapper = (await res.json().catch(() => null)) as
    | { status?: number; data?: { data?: { createPost?: Record<string, string> }; errors?: Array<{ message: string }> } }
    | null;
  if (!wrapper) throw new Error('Buffer proxy returned an unreadable response');
  const status = wrapper.status ?? res.status;
  if (status === 401) throw new Error('Buffer rejected the API key — set it in the "Buffer post proxy" flow in Directus.');
  if (status < 200 || status >= 300) {
    throw new Error(`Buffer proxy HTTP ${status}`);
  }
  const gqlErrors = wrapper.data?.errors;
  if (gqlErrors?.length) throw new Error(gqlErrors[0].message);
  const payload = wrapper.data?.data?.createPost as
    | { __typename: string; message?: string; post?: QueuedBufferPost }
    | undefined;
  if (!payload) throw new Error('Unexpected Buffer response shape');
  if (payload.__typename !== 'PostActionSuccess' || !payload.post) {
    throw new Error(payload.message || `Buffer error: ${payload.__typename}`);
  }
  return {
    id: payload.post.id,
    dueAt: payload.post.dueAt ?? null,
    status: payload.post.status ?? null,
    isCustomScheduled: payload.post.isCustomScheduled ?? null
  };
}

// Meta (Graph API) integration — moved to $lib/data/meta.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Meta ad creatives → previews — moved to $lib/data/metaCreatives.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
