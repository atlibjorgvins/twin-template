// Which Clockify project a twin project belongs to, by inheritance.
//
// Clockify is deliberately coarser than twin: 27 projects against twin's 114.
// "Gulleggið" is one project in Clockify and fourteen in twin. Mapping each of
// those fourteen by hand is work that has to be redone every time a new cohort
// or sub-project appears, and the one that gets forgotten is the one whose
// hours quietly land with no project attached.
//
// So a mapping is inherited down `parent_id`: map "Gulleggið" once and every
// project under it resolves there, until some descendant sets its own mapping
// and takes over its own subtree.
//
// No imports on purpose — this is the part worth testing, and bare node can run
// it (npm run test:clockify).

export type ProjectNode = {
  id: number;
  name?: string | null;
  /** Marks the catch-all — see fallbackMapping. */
  clockify_fallback?: boolean | null;
  /** Directus hands this back as an id or as an expanded object, depending on
   *  the `fields` asked for. Both shapes appear in this codebase. */
  parent_id?: number | { id: number } | null;
  clockify_project_id?: string | null;
};

export function parentIdOf(node: ProjectNode | undefined | null): number | null {
  const p = node?.parent_id;
  if (p == null) return null;
  const id = typeof p === 'object' ? p.id : p;
  return Number.isFinite(Number(id)) ? Number(id) : null;
}

export function indexById(nodes: ProjectNode[]): Map<number, ProjectNode> {
  return new Map(nodes.map((n) => [Number(n.id), n]));
}

/** Where a mapping came from: the Clockify id, and the twin project that holds it. */
export type Resolved = { clockifyId: string; viaId: number; inherited: boolean };

/**
 * The nearest mapping at or above this project.
 *
 * Own mapping first, so a child can always override its parent. Walks with a
 * `seen` set because `parent_id` is editable in the Directus admin and a cycle
 * there must not hang the page that pushes time.
 */
export function nearestMapped(
  projectId: number | null | undefined,
  byId: Map<number, ProjectNode>
): Resolved | null {
  let id = projectId == null ? null : Number(projectId);
  const seen = new Set<number>();
  let hops = 0;
  while (id != null && !seen.has(id)) {
    seen.add(id);
    const node = byId.get(id);
    if (!node) return null;
    const mapped = node.clockify_project_id;
    if (mapped) return { clockifyId: mapped, viaId: id, inherited: hops > 0 };
    id = parentIdOf(node);
    hops++;
  }
  return null;
}

/**
 * The projects a mapping actually covers — every descendant that resolves here.
 *
 * This is what makes mapping a parent feel safe rather than like a guess: the
 * UI can say "14 projects inherit this" instead of leaving you to work out
 * whether the children were caught.
 */
export function inheritorsOf(projectId: number, nodes: ProjectNode[]): ProjectNode[] {
  const byId = indexById(nodes);
  return nodes.filter((n) => {
    if (Number(n.id) === Number(projectId)) return false;
    const r = nearestMapped(Number(n.id), byId);
    return r?.viaId === Number(projectId);
  });
}

/** Projects carrying a mapping of their own — the points worth showing. */
export function mappingPoints(nodes: ProjectNode[]): ProjectNode[] {
  return nodes.filter((n) => !!n.clockify_project_id);
}

/**
 * Where work with no project of its own goes.
 *
 * KLAK's Clockify workspace has `forceProjects` on: it refuses any entry
 * without a project. Most focus tasks carry no project at all, so without a
 * catch-all their sessions fail to push and sit in the retry queue forever.
 * One twin project is flagged; whatever it maps to receives the strays.
 *
 * Returns null when nothing is flagged, or when the flagged project maps
 * nowhere — a fallback that resolves to nothing is not a fallback, and saying
 * so is better than pretending the strays are handled.
 */
export function fallbackMapping(nodes: ProjectNode[]): Resolved | null {
  const flagged = nodes.find((n) => n.clockify_fallback);
  if (!flagged) return null;
  return nearestMapped(Number(flagged.id), indexById(nodes));
}

/**
 * The whole question, answered in one place: which Clockify project does this
 * session belong to? Own mapping, then ancestors, then the catch-all.
 */
export function resolveForPush(
  projectId: number | null | undefined,
  nodes: ProjectNode[]
): Resolved | null {
  return nearestMapped(projectId, indexById(nodes)) ?? fallbackMapping(nodes);
}

/**
 * Mappings that could be deleted without changing where any hour lands —
 * a project whose own mapping is what it would have inherited anyway.
 *
 * These are the residue of mapping by hand before inheritance existed, and
 * they are not harmless: each one silently pins its subtree, so re-pointing the
 * parent later moves everything except the children someone already clicked.
 */
export function redundantMappings(nodes: ProjectNode[]): ProjectNode[] {
  const byId = indexById(nodes);
  return nodes.filter((n) => {
    if (!n.clockify_project_id) return false;
    const above = nearestMapped(parentIdOf(n), byId);
    return above?.clockifyId === n.clockify_project_id;
  });
}

/** Everything that resolves somewhere, however far up. The honest coverage number. */
export function coveredCount(nodes: ProjectNode[]): number {
  const byId = indexById(nodes);
  return nodes.filter((n) => nearestMapped(Number(n.id), byId)).length;
}
