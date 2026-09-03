// Actively working on — the focus queue
//
// Feature key `focus`. Zero dependencies.
// Note: closing a task and pushing it to Asana stays behind for now — that
// section has 3 runtime dependencies and belongs with the Asana work.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module, so every existing
// `from '$lib/directus'` import keeps working.

import { repo } from '$lib/data/repo';

// ── "Actively working on" — focus queue + time tracking ──────────────
// A manual queue; one task is active at a time. Time accrues into
// seconds_spent; while active, started_at marks the running session so
// live elapsed = seconds_spent + (now − started_at).

export type FocusStatus = 'backlog' | 'queued' | 'active' | 'done';
export type FocusTask = {
  id: number;
  title?: string | null;
  status?: FocusStatus | string;
  sort?: number | null;
  seconds_spent?: number | null;
  started_at?: string | null;
  project_id?: number | { id: number; name?: string | null } | null;
  /** Parent task — set on subtasks. */
  parent_id?: number | { id: number; title?: string | null } | null;
  notes?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
  /** Where the task came from — 'manual' or 'asana'. */
  source?: string | null;
  /** Asana task gid when source === 'asana'. */
  source_ref?: string | null;
  due_on?: string | null;
  closed_by?: string | null;
  /** Which Asana project this came from. Cached on the row so resolving it
   *  costs one Asana call ever, not one per render. Null until resolved —
   *  ingestion happens outside twin and records only the task gid. */
  asana_project_gid?: string | null;
  asana_project_name?: string | null;
};

// Exported because the task-closing / Asana code still in directus.ts reads it.
export const FOCUS_FIELDS = ['*', { project_id: ['id', 'name'] }, { parent_id: ['id', 'title'] }];

/** Open focus tasks (queued + active), in queue order. */
export async function listFocusTasks(): Promise<FocusTask[]> {
  return await repo.list<FocusTask>('focus_task', {
    where: { field: 'status', op: 'neq', value: 'done' },
    fields: FOCUS_FIELDS as unknown as string[],
    sort: ['sort', 'id']
  });
}

/** The single active task, or null. */
export async function getActiveFocusTask(): Promise<FocusTask | null> {
  const rows = await repo.list<FocusTask>('focus_task', {
    where: { field: 'status', op: 'eq', value: 'active' },
    fields: FOCUS_FIELDS as unknown as string[],
    limit: 1
  });
  return rows[0] ?? null;
}

export async function createFocusTask(p: {
  title: string;
  project_id?: number | null;
  status?: FocusStatus;
  parent_id?: number | null;
}): Promise<FocusTask> {
  const max = await repo.aggregate<{ max: { sort: number | null } }>('focus_task', {
    aggregate: { max: ['sort'] },
    limit: 1
  });
  const nextSort = (Number(max[0]?.max?.sort ?? 0) || 0) + 1;
  return await repo.create<FocusTask>('focus_task', {
    title: p.title,
    status: p.status ?? 'queued',
    sort: nextSort,
    seconds_spent: 0,
    project_id: p.project_id ?? null,
    parent_id: p.parent_id ?? null
  } as Record<string, unknown>);
}

/** Move a task between tiers (backlog ⇄ queue). */
export async function setFocusStatus(id: number, status: FocusStatus): Promise<void> {
  await repo.update('focus_task', id, { status });
}
