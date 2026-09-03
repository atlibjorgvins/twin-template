import type { PageLoad } from './$types';
import { listInsightsProjects, loadInsights, type LoadedInsights } from '$lib/insights/data';
import { loadMarketing } from '$lib/marketing/data';
import type { MarketingBundle } from '$lib/marketing/metrics';

// Filters live in the query string so a view is shareable and the back button
// works. SvelteKit's `url` dependency has no per-parameter granularity, so ANY
// filter change re-runs this load — hence the cache: flipping a year chip must
// not re-fetch 400 junction rows. Keyed by project id, one entry deep, which is
// all a single-project dashboard needs.
let cached: { id: number; promise: Promise<LoadedInsights> } | null = null;

function insightsFor(id: number): Promise<LoadedInsights> {
  if (cached?.id === id) return cached.promise;
  const promise = loadInsights(id);
  cached = { id, promise };
  // A failed load must not be remembered as the answer.
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });
  return promise;
}

// The marketing rows are the same whichever programme you are looking at, so
// this cache needs no key: one fetch per visit, reused across programme
// switches and every chip click.
let marketingCache: Promise<MarketingBundle> | null = null;

/** Meta serves 37 months of insights and no more, so that is the widest window
 *  worth asking for. Wider than the workspace's trailing year on purpose: this
 *  page is read a cohort at a time, and a 2024 cohort should show its own spend
 *  rather than nothing. */
function marketingWindow(): { since: string; until: string } {
  const until = new Date().toISOString().slice(0, 10);
  const d = new Date(`${until}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 37);
  return { since: d.toISOString().slice(0, 10), until };
}

function marketing(): Promise<MarketingBundle> {
  if (!marketingCache) {
    marketingCache = loadMarketing(marketingWindow());
    marketingCache.catch(() => {
      marketingCache = null;
    });
  }
  return marketingCache;
}

const emptyMarketing = (): MarketingBundle => ({
  meta: [],
  manual: [],
  breakdowns: [],
  budgets: [],
  projects: [],
  mediums: [],
  window: marketingWindow()
});

export const load: PageLoad = async ({ url }) => {
  const raw = url.searchParams.get('project');
  const id = raw ? Number(raw) : NaN;
  const projects = await listInsightsProjects().catch(() => []);
  if (!Number.isFinite(id)) {
    return { projects, insights: null, marketing: emptyMarketing(), error: null };
  }
  try {
    // Marketing degrades to an empty bundle rather than costing the page: a
    // missing mk_budget permission must lose you the Marketing block, not the
    // cohort figures.
    const [insights, marketingBundle] = await Promise.all([
      insightsFor(id),
      marketing().catch(() => emptyMarketing())
    ]);
    return { projects, insights, marketing: marketingBundle, error: null };
  } catch (e) {
    return {
      projects,
      insights: null,
      marketing: emptyMarketing(),
      error: e instanceof Error ? e.message : String(e)
    };
  }
};
