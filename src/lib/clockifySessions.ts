// Reading and re-assigning tracked stretches.
//
// The Clockify settings page answers "how much is owed"; this answers "what
// exactly, and where is each piece going". Those are different jobs: a count
// tells you something is wrong, a list tells you which row to fix.
//
// Resolution order, in one place so the list and the push can never disagree:
// the session's own project, then the task's, then inherited from an ancestor,
// then the workspace catch-all.
import { repo } from '$lib/data/repo';
import { resolveForPush, type ProjectNode, type Resolved } from './clockifyTree';
import type { FocusSession, PushStatus } from './focusSession';

export type SessionRow = FocusSession & {
  /** Overrides the task's project for this stretch only. */
  project_id?: number | { id: number } | null;
  task_id?: number | { id: number; title?: string | null; project_id?: number | { id: number } | null } | null;
};

const FIELDS = [
  'id',
  'started_at',
  'ended_at',
  'seconds',
  'description',
  'push_status',
  'push_error',
  'pushed_at',
  'clockify_entry_id',
  'project_id',
  'task_id.id',
  'task_id.title',
  'task_id.project_id'
];

/** A window of tracked time, oldest first so a day reads top to bottom. */
export async function sessionsBetween(fromISO: string, toISO: string): Promise<SessionRow[]> {
  return repo.list<SessionRow>('focus_session', {
    where: {
      and: [
        { field: 'started_at', op: 'gte', value: fromISO },
        { field: 'started_at', op: 'lte', value: toISO }
      ]
    },
    fields: FIELDS,
    sort: ['started_at']
  });
}

/** Everything still owed, regardless of age — a stray from last month is
 *  exactly what a window-limited view would hide. */
export async function sessionsOwed(limit = 200): Promise<SessionRow[]> {
  return repo.list<SessionRow>('focus_session', {
    where: { field: 'push_status', op: 'in', value: ['pending', 'failed'] },
    fields: FIELDS,
    sort: ['started_at'],
    limit
  });
}

const idOf = (v: number | { id: number } | null | undefined): number | null => {
  if (v == null) return null;
  const n = typeof v === 'object' ? v.id : v;
  return Number.isFinite(Number(n)) ? Number(n) : null;
};

/** The twin project this stretch is attributed to, override first. */
export function projectIdOfSession(s: SessionRow): number | null {
  const own = idOf(s.project_id);
  if (own != null) return own;
  const task = typeof s.task_id === 'object' && s.task_id ? s.task_id.project_id : null;
  return idOf(task ?? null);
}

export type SessionTarget = Resolved & { source: 'session' | 'task' | 'inherited' | 'fallback' };

/**
 * Where this stretch will land, and why — the "why" is the whole point of the
 * view. "No project" and "went to the catch-all" look identical in Clockify
 * afterwards, and only one of them is a mistake.
 */
export function targetOf(s: SessionRow, projects: ProjectNode[]): SessionTarget | null {
  const pid = projectIdOfSession(s);
  const r = resolveForPush(pid, projects);
  if (!r) return null;
  let source: SessionTarget['source'];
  if (pid == null) source = 'fallback';
  else if (r.viaId !== pid) source = r.inherited ? 'inherited' : 'fallback';
  else source = idOf(s.project_id) != null ? 'session' : 'task';
  return { ...r, source };
}

/** Attribute one stretch. null clears the override and hands it back to the task. */
export async function assignSessionProject(sessionId: number, projectId: number | null) {
  await repo.update('focus_session', sessionId, { project_id: projectId });
}

/** Re-queue a failed row after fixing its project — without this, a corrected
 *  session keeps its old error text and reads as still broken. */
export async function clearPushError(sessionId: number) {
  await repo.update('focus_session', sessionId, {
    push_status: 'pending' satisfies PushStatus,
    push_error: null
  });
}
