// Queries against the frettir instance. Feature-scoped, beside
// src/lib/events/data.ts and src/lib/food/data.ts.
//
// Every read goes through newsQuery(), which swallows failures and returns the
// fallback — see client.ts for why. Nothing here throws at a caller.
import { readItems, updateItem, aggregate } from '@directus/sdk';
import { newsQuery } from './client';

export type NewsArticle = {
  id: number;
  title: string | null;
  summary: string | null;
  url: string | null;
  image_url: string | null;
  published_at: string | null;
  author: string | null;
  read_at: string | null;
  saved: boolean | null;
  source?: { slug: string; outlet: string | null; name: string | null } | null;
};

export type NewsMention = {
  id: number;
  entity_type: string;
  entity_id: number;
  entity_name_snapshot: string | null;
  matched_text: string | null;
  confidence: number | null;
  article?: NewsArticle | null;
};

const ARTICLE_FIELDS = [
  'id',
  'title',
  'summary',
  'url',
  'image_url',
  'published_at',
  'author',
  'read_at',
  'saved',
  'source.slug',
  'source.outlet',
  'source.name'
];

export type FeedFilter = {
  /** Unread only. */
  unread?: boolean;
  /** Saved only. */
  saved?: boolean;
  /** Restrict to one outlet slug. */
  outlet?: string | null;
  /** Free-text over title and summary. */
  q?: string | null;
};

export async function listArticles(
  opts: FeedFilter & { limit?: number; page?: number } = {}
): Promise<NewsArticle[]> {
  const and: Record<string, unknown>[] = [];
  if (opts.unread) and.push({ read_at: { _null: true } });
  if (opts.saved) and.push({ saved: { _eq: true } });
  if (opts.outlet) and.push({ source: { outlet: { _eq: opts.outlet } } });
  const q = (opts.q ?? '').trim();
  if (q) {
    and.push({
      _or: [{ title: { _icontains: q } }, { summary: { _icontains: q } }]
    });
  }

  // The filter key is OMITTED when empty rather than set to undefined: the
  // SDK serialises `filter: undefined` as the literal string "undefined" and
  // Directus answers "Invalid JSON for filter object". Every unfiltered read
  // failed and newsQuery swallowed it, so the feed was simply empty.
  const query: Record<string, unknown> = {
    fields: ARTICLE_FIELDS,
    sort: ['-published_at'],
    limit: opts.limit ?? 40,
    page: opts.page ?? 1
  };
  if (and.length) query.filter = { _and: and };

  return newsQuery(
    (c) => c.request(readItems('article' as never, query as never)) as Promise<NewsArticle[]>,
    []
  );
}

/**
 * Distinct outlets that have articles, for the filter chips.
 *
 * Grouped by the LOCAL foreign key and mapped to outlets here, not
 * `groupBy: ['source.outlet']` — Directus answers that with a 500
 * ("Cannot read properties of undefined"), so grouping across the relation is
 * not an option however much tidier it reads. Two small queries instead: the
 * counts, and the source table, which is seven rows.
 */
export async function listOutlets(): Promise<Array<{ outlet: string; count: number }>> {
  const [counts, sources] = await Promise.all([
    newsQuery(
      (c) =>
        c.request(
          aggregate('article' as never, {
            aggregate: { count: '*' },
            groupBy: ['source']
          } as never)
        ) as Promise<Array<Record<string, unknown>>>,
      []
    ),
    newsQuery(
      (c) =>
        c.request(
          readItems('source' as never, { fields: ['id', 'outlet'], limit: -1 } as never)
        ) as Promise<Array<{ id: number; outlet: string | null }>>,
      []
    )
  ]);

  const outletOf = new Map(sources.map((s) => [s.id, s.outlet ?? '']));
  const totals = new Map<string, number>();
  for (const row of counts) {
    const id = Number(row.source);
    const outlet = outletOf.get(id) ?? '';
    if (!outlet) continue;
    const n = Number((row.count as { id?: number })?.id ?? row.count ?? 0) || 0;
    totals.set(outlet, (totals.get(outlet) ?? 0) + n);
  }
  return [...totals.entries()]
    .map(([outlet, count]) => ({ outlet, count }))
    .sort((a, b) => b.count - a.count);
}

export async function markRead(id: number, read: boolean): Promise<void> {
  await newsQuery(
    (c) =>
      c.request(
        updateItem('article' as never, id, {
          read_at: read ? new Date().toISOString() : null
        } as never)
      ),
    undefined
  );
}

export async function setSaved(id: number, saved: boolean): Promise<void> {
  await newsQuery(
    (c) => c.request(updateItem('article' as never, id, { saved } as never)),
    undefined
  );
}

/**
 * Confirmed coverage for one entity — the org-page card.
 *
 * `status = confirmed` only. Nothing auto-confirms in frettir; every match
 * lands as a candidate for review, and twin must never show a guess as though
 * it were a fact.
 *
 * `mention` does not exist until frettir phase 2, so this returns [] on a
 * phase-1 instance rather than erroring. That is newsQuery's fallback doing
 * its job, not a special case here.
 */
export async function coverageFor(
  entityType: 'organization' | 'project' | 'person',
  entityId: number,
  limit = 5
): Promise<NewsMention[]> {
  return newsQuery(
    (c) =>
      c.request(
        readItems('mention' as never, {
          filter: {
            entity_type: { _eq: entityType },
            entity_id: { _eq: entityId },
            status: { _eq: 'confirmed' }
          },
          fields: ['id', 'entity_type', 'entity_id', 'entity_name_snapshot', 'matched_text', 'confidence', ...ARTICLE_FIELDS.map((f) => `article.${f}`)],
          sort: ['-article.published_at'],
          limit
        } as never)
      ) as Promise<NewsMention[]>,
    []
  );
}
