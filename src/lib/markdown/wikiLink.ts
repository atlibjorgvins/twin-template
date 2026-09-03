// Wiki-link autocomplete: type `[[` and a popup searches across
// People / Organisations / Projects via Directus and inserts a real
// markdown link to the entity's page.
//
// We use `@codemirror/autocomplete` so the popup placement, keyboard
// navigation, and accessibility all come for free. The source is async
// and debounces by virtue of CodeMirror only firing the completion
// engine on document changes near the cursor.

import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { searchPeople, searchOrgs, searchProjects, personName } from '$lib/directus';

type Hit = {
  label: string;
  kind: 'person' | 'org' | 'project';
  href: string;
};

async function search(query: string): Promise<Hit[]> {
  if (!query.trim()) return [];
  const [people, orgs, projects] = await Promise.all([
    searchPeople(query, 5).catch(() => []),
    searchOrgs(query, 5).catch(() => []),
    searchProjects(query, 5).catch(() => [])
  ]);
  const hits: Hit[] = [];
  for (const p of people as Array<{ id: number }>) {
    hits.push({ label: personName(p as never), kind: 'person', href: `/people/${p.id}` });
  }
  for (const o of orgs as Array<{ id: number; name?: string | null }>) {
    hits.push({ label: o.name ?? `Org ${o.id}`, kind: 'org', href: `/orgs/${o.id}` });
  }
  for (const pr of projects as Array<{ id: number; name?: string | null }>) {
    hits.push({ label: pr.name ?? `Project ${pr.id}`, kind: 'project', href: `/projects/${pr.id}` });
  }
  return hits;
}

export async function wikiLinkSource(context: CompletionContext): Promise<CompletionResult | null> {
  // Match an unclosed `[[…` going back from the cursor. No upper bound
  // on the query length — the previous 40-char cap caused the popup to
  // stop responding for long names.
  const before = context.matchBefore(/\[\[[^\n\]]*/);
  if (!before || !before.text.startsWith('[[')) return null;
  const query = before.text.slice(2);
  if (!query && !context.explicit) return null;
  const hits = await search(query);
  return {
    from: before.from,
    to: context.pos,
    filter: false,
    // Intentionally no `validFor` — with `filter: false` set, telling
    // CodeMirror the list is "still valid" leaves the popup showing
    // stale results from the earlier query. Re-running the source on
    // every keystroke is what gives the live-search feel.
    options: hits.map((h) => ({
      label: h.label,
      type: h.kind,
      detail: h.kind,
      apply: `[${h.label}](${h.href})`
    }))
  };
}
