// Prompt library
//
// Unblocked by the previous pass: its only dependency was listTags, which
// left with tags.ts.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { Tag } from '$lib/data/tags';
import { listTags } from '$lib/data/tags';

// ─── Prompt library ────────────────────────────────────────────────────────
// Reusable prompts with a purpose bio, shared-pool tags (search-by-purpose),
// project links, freeform system chips, favourites + usage tracking.
export type Prompt = {
  id: number;
  title?: string | null;
  body?: string | null;
  purpose?: string | null;
  systems?: string[] | null;
  is_favorite?: boolean | null;
  times_used?: number | null;
  last_used_at?: string | null;
  status?: string | null;
  sort?: number | null;
  date_created?: string | null;
  date_updated?: string | null;
  // Hydrated by listPrompts / getPrompt:
  tags?: Tag[];
  projectIds?: number[];
  projects?: Array<{ id: number; name?: string | null; color?: string | null }>;
};

export type PromptSort = 'recent' | 'used' | 'title';

/** List prompts with tags/projects hydrated + full-text and facet filters.
 *  The library is personal-scale, so junctions are resolved in a couple of
 *  bulk reads and merged in memory rather than per-row. */
export async function listPrompts(opts: {
  q?: string;
  tagIds?: number[];
  projectId?: number;
  system?: string;
  favoritesOnly?: boolean;
  includeArchived?: boolean;
  sort?: PromptSort;
} = {}): Promise<Prompt[]> {
  const { q = '', tagIds = [], projectId, system, favoritesOnly = false, includeArchived = false, sort = 'recent' } = opts;
  const filters: Filter[] = [];
  if (!includeArchived) filters.push({ field: 'status', op: 'neq', value: 'archived' });
  if (favoritesOnly) filters.push({ field: 'is_favorite', op: 'eq', value: true });
  if (q.trim()) {
    const term = q.trim();
    filters.push({ or: [
      { field: 'title', op: 'icontains', value: term },
      { field: 'body', op: 'icontains', value: term },
      { field: 'purpose', op: 'icontains', value: term }
    ] });
  }
  // Tag / project facets resolve to prompt ids via the junctions first.
  const idConstraints: number[][] = [];
  if (tagIds.length) {
    const j = await repo.list<{ prompt_id: number | null }>('prompt_tag', {
      where: { field: 'tag_id', op: 'in', value: tagIds }, fields: ['prompt_id']
    });
    idConstraints.push([...new Set(j.map((r) => r.prompt_id).filter((v): v is number => typeof v === 'number'))]);
  }
  if (projectId) {
    const j = await repo.list<{ prompt_id: number | null }>('prompt_project', {
      where: { field: 'project_id', op: 'eq', value: projectId }, fields: ['prompt_id']
    });
    idConstraints.push([...new Set(j.map((r) => r.prompt_id).filter((v): v is number => typeof v === 'number'))]);
  }
  for (const ids of idConstraints) {
    if (ids.length === 0) return []; // a facet with no matches → empty result
    filters.push({ field: 'id', op: 'in', value: ids });
  }

  const sortMap: Record<PromptSort, string[]> = {
    recent: ['-is_favorite', '-date_updated', '-date_created'],
    used: ['-is_favorite', '-times_used', '-last_used_at'],
    title: ['-is_favorite', 'title']
  };
  const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { and: filters };
  let prompts = await repo.list<Prompt>('prompt', {
    fields: ['id', 'title', 'body', 'purpose', 'systems', 'is_favorite', 'times_used', 'last_used_at', 'status', 'date_created', 'date_updated'],
    sort: sortMap[sort],
    where,
    limit: 500
  });
  // System is a JSON-array field — filter in memory (library is small).
  if (system) prompts = prompts.filter((p) => (p.systems ?? []).some((s) => s === system));
  if (prompts.length === 0) return prompts;
  await hydratePromptRelations(prompts);
  return prompts;
}

/** Attach tags[] + projectIds[]/projects[] to the given prompts in bulk. */
async function hydratePromptRelations(prompts: Prompt[]): Promise<void> {
  const ids = prompts.map((p) => p.id);
  const [tagJ, projJ, allTags] = await Promise.all([
    repo.list<{ prompt_id: number; tag_id: number }>('prompt_tag', { where: { field: 'prompt_id', op: 'in', value: ids }, fields: ['prompt_id', 'tag_id'] }),
    repo.list<{ prompt_id: number; project_id: number }>('prompt_project', { where: { field: 'prompt_id', op: 'in', value: ids }, fields: ['prompt_id', 'project_id'] }),
    listTags().catch(() => [] as Tag[])
  ]);
  const tagById = new Map(allTags.map((t) => [t.id, t]));
  const projIds = [...new Set(projJ.map((r) => r.project_id).filter(Boolean))];
  const projById = new Map<number, { id: number; name?: string | null; color?: string | null }>();
  if (projIds.length) {
    const rows = await repo.list<{ id: number; name?: string | null; color?: string | null }>('Project', {
      where: { field: 'id', op: 'in', value: projIds }, fields: ['id', 'name', 'color']
    });
    for (const r of rows) projById.set(r.id, r);
  }
  for (const p of prompts) {
    p.tags = tagJ.filter((r) => r.prompt_id === p.id).map((r) => tagById.get(r.tag_id)).filter((t): t is Tag => !!t);
    const myProjIds = projJ.filter((r) => r.prompt_id === p.id).map((r) => r.project_id);
    p.projectIds = myProjIds;
    p.projects = myProjIds.map((id) => projById.get(id)).filter((x): x is { id: number; name?: string | null; color?: string | null } => !!x);
  }
}

export async function getPrompt(id: number): Promise<Prompt> {
  const p = await repo.get<Prompt>('prompt', id, {
    fields: ['id', 'title', 'body', 'purpose', 'systems', 'is_favorite', 'times_used', 'last_used_at', 'status', 'date_created', 'date_updated']
  });
  if (!p) throw new Error(`Prompt ${id} not found`);
  await hydratePromptRelations([p]);
  return p;
}
export async function createPrompt(patch: Partial<Prompt> = {}): Promise<Prompt> {
  return await repo.create<Prompt>('prompt', { status: 'published', ...patch } as Record<string, unknown>);
}
export async function updatePrompt(id: number, patch: Partial<Prompt>): Promise<Prompt> {
  return await repo.update<Prompt>('prompt', id, patch as Record<string, unknown>);
}
export async function deletePrompt(id: number): Promise<void> {
  await repo.remove('prompt', id);
}
/** Bump usage on copy — count + last-used timestamp. */
export async function recordPromptUse(id: number, currentCount = 0): Promise<void> {
  await repo.update('prompt', id, {
    times_used: (currentCount ?? 0) + 1,
    last_used_at: new Date().toISOString()
  });
}

export async function setPromptTags(promptId: number, tagIds: number[]): Promise<void> {
  const existing = await repo.list<{ id: number; tag_id: number }>('prompt_tag', {
    where: { field: 'prompt_id', op: 'eq', value: promptId }, fields: ['id', 'tag_id']
  });
  const have = new Set(existing.map((r) => r.tag_id));
  const want = new Set(tagIds);
  for (const t of tagIds) if (!have.has(t)) await repo.create('prompt_tag', { prompt_id: promptId, tag_id: t });
  for (const r of existing) if (!want.has(r.tag_id)) await repo.remove('prompt_tag', r.id);
}
export async function setPromptProjects(promptId: number, projectIds: number[]): Promise<void> {
  const existing = await repo.list<{ id: number; project_id: number }>('prompt_project', {
    where: { field: 'prompt_id', op: 'eq', value: promptId }, fields: ['id', 'project_id']
  });
  const have = new Set(existing.map((r) => r.project_id));
  const want = new Set(projectIds);
  for (const pid of projectIds) if (!have.has(pid)) await repo.create('prompt_project', { prompt_id: promptId, project_id: pid });
  for (const r of existing) if (!want.has(r.project_id)) await repo.remove('prompt_project', r.id);
}

/** Distinct system chips across all prompts — feeds the autocomplete. */
export async function listPromptSystems(): Promise<string[]> {
  const rows = await repo.list<{ systems: string[] | null }>('prompt', {
    fields: ['systems']
  });
  const seen = new Map<string, string>();
  for (const r of rows) for (const s of r.systems ?? []) {
    const v = String(s).trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Extract {tokens} from a prompt body, in first-seen order, de-duped. */
export function promptTokens(body: string | null | undefined): string[] {
  if (!body) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\{([^{}\n]+)\}/g)) {
    const k = m[1].trim();
    if (k && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}
/** Fill {tokens} in a body from a values map (missing → left as-is). */
export function fillPromptTokens(body: string, values: Record<string, string>): string {
  return body.replace(/\{([^{}\n]+)\}/g, (whole, k) => {
    const v = values[String(k).trim()];
    return v != null && v !== '' ? v : whole;
  });
}

/** Split a prompt body into the copyable prompt and a trailing metadata
 *  section ("How to use" / Usage / Instructions / Notes / Meta / Guide).
 *  Non-destructive: the stored body keeps both; the split is computed for
 *  display + copy so the meta never lands in the clipboard. Everything from
 *  the first recognised meta heading to the end becomes `meta`. */
const META_HEADING = /^\s{0,3}#{1,6}\s*(how\s*to\s*use|usage|how\s*to|instructions?|notes?|meta(?:data)?|guide)\b.*$/im;
export function splitPromptMeta(body: string | null | undefined): { prompt: string; meta: string } {
  const text = body ?? '';
  const m = META_HEADING.exec(text);
  if (!m || m.index == null) return { prompt: text, meta: '' };
  return {
    prompt: text.slice(0, m.index).replace(/\s+$/, ''),
    meta: text.slice(m.index).replace(/\s+$/, '')
  };
}

/** How a {token} should be filled at copy time: a picker over the prompt's
 *  linked projects / systems, or free text. Name-based so authors just write
 *  {target project} / {system}. */
export function tokenKind(name: string): 'project' | 'system' | 'text' {
  const n = name.toLowerCase();
  if (/\bproject\b|verkefni/.test(n)) return 'project';
  if (/\bsystem\b|kerfi/.test(n)) return 'system';
  return 'text';
}
