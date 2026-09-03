// Closing a focus task, and getting that back to Asana
//
// Left behind in the previous pass because it reads FocusTask, FOCUS_FIELDS
// and getActiveFocusTask — which is what made focus.ts look like a leaf when
// it was not. Now that focus.ts exists as a module, this simply imports from
// it, and the back-imports added to directus.ts for its sake can go.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module, so every existing
// `from '$lib/directus'` import keeps working.

import { repo } from '$lib/data/repo';
import { FOCUS_FIELDS, getActiveFocusTask } from '$lib/data/focus';
import type { FocusStatus, FocusTask } from '$lib/data/focus';

// ── Closing a task, and getting that back to Asana ───────────────────────
// `closed_by` is an outbox, and its meaning is exact:
//
//   'twin'   closed in this UI — STILL NEEDS PUSHING to Asana
//   'synced' already pushed
//   NULL     closed by the reconcile step because it left the Asana query.
//            NEVER push those — Asana already knows; pushing would be a
//            write we cannot justify.
//
// So closing must set 'twin', not just `status`. Using setFocusStatus to
// close a task marks it NULL, which reads as "never push" — the task would
// silently stay open in Asana forever. That is the trap these two exist to
// close, and why the board's Done column routes through here.

/**
 * Close a task here, queueing it for Asana when it came from there.
 *
 * `closed_by: 'twin'` means "needs pushing to Asana", so it is only set for
 * asana-sourced tasks. A manual task has nothing to push, and marking one
 * 'twin' would make the field mean two different things — harmless today
 * because every push path also filters on source, but only by accident.
 * Callers already hold the row, so this costs no extra read.
 */
export async function completeFocusTask(
  id: number,
  opts: { source?: string | null } = {}
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: 'done',
    // Stop the clock — a closed task must not keep accruing time if it was
    // the active one.
    started_at: null
  };
  // Third path that clears started_at, so the stretch has to be banked here
  // too. The read is only paid when something is actually running.
  const current = (await repo
    .get<FocusTask>('focus_task', id, { fields: ['id', 'title', 'started_at', 'seconds_spent'] })
    .catch(() => null)) as FocusTask | null;
  if (current?.started_at) {
    await recordFocusStretch(current);
    patch.seconds_spent = focusElapsed(current);
  }
  if (opts.source === 'asana') patch.closed_by = 'twin';
  await repo.update('focus_task', id, patch);
}

/** Reopen a task. Clears the outbox flag: it is no longer closed, so there is
 *  nothing to push, and leaving 'twin' would push a completion for a task
 *  that is open again. */
export async function reopenFocusTask(id: number, status: FocusStatus = 'queued'): Promise<void> {
  await repo.update('focus_task', id, { status, closed_by: null });
}

/** Tasks closed here that Asana has not been told about yet. */
export async function listPendingAsanaPush(): Promise<FocusTask[]> {
  return await repo.list<FocusTask>('focus_task', {
    where: { and: [
      { field: 'status', op: 'eq', value: 'done' },
      { field: 'closed_by', op: 'eq', value: 'twin' },
      { field: 'source', op: 'eq', value: 'asana' },
      { field: 'source_ref', op: 'nnull' }
    ] },
    fields: FOCUS_FIELDS as unknown as string[]
  });
}

/**
 * Push queued completions to Asana and mark them synced.
 *
 * `complete` is injected rather than imported so this stays testable and so
 * directus.ts keeps no dependency on the Asana transport. A task is only
 * flipped to 'synced' after Asana confirms — a failed push leaves it as
 * 'twin' so the next attempt retries it. That is the whole point of the
 * outbox: with no token, closing still works here and nothing is lost.
 *
 * Stops after three consecutive failures, because a missing or rejected
 * credential fails every task identically and there is nothing to learn from
 * the fourth attempt.
 */
export async function pushClosedTasksToAsana(
  tasks: FocusTask[],
  complete: (gid: string) => Promise<unknown>
): Promise<{ pushed: number; failed: number; skipped: number; firstError: string | null }> {
  const out = { pushed: 0, failed: 0, skipped: 0, firstError: null as string | null };
  let consecutive = 0;
  for (const t of tasks) {
    if (!t.source_ref) { out.skipped++; continue; }
    if (consecutive >= 3) { out.skipped++; continue; }
    try {
      await complete(t.source_ref);
      await repo.update('focus_task', t.id, { closed_by: 'synced' });
      out.pushed++;
      consecutive = 0;
    } catch (e) {
      out.failed++;
      consecutive++;
      out.firstError ??= e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}

export async function updateFocusTask(id: number, patch: Partial<FocusTask>): Promise<FocusTask> {
  return await repo.update<FocusTask>('focus_task', id, patch as Record<string, unknown>);
}
export async function deleteFocusTask(id: number): Promise<void> {
  await repo.remove('focus_task', id);
}

/** Live elapsed seconds = banked time + the running session if active. */
export function focusElapsed(t: FocusTask): number {
  const base = Number(t.seconds_spent ?? 0) || 0;
  if (t.status === 'active' && t.started_at) {
    return base + Math.max(0, Math.floor((Date.now() - Date.parse(t.started_at)) / 1000));
  }
  return base;
}

/** Pause whatever is active back into the queue, banking its time. */

/**
 * Record the stretch that just ended, for Clockify.
 *
 * Every path that clears `started_at` banks cumulative seconds and throws the
 * interval away, so this has to run at the same moment or the timestamps are
 * gone for good. Imported lazily and failure-tolerant: time tracking is a
 * side-effect of the timer, and it must never stop a task from pausing.
 */
async function recordFocusStretch(t: Pick<FocusTask, 'id' | 'title' | 'started_at'>): Promise<void> {
  if (!t.started_at) return;
  try {
    const { recordSession } = await import('$lib/focusSession');
    await recordSession({
      taskId: t.id,
      startedAt: t.started_at,
      description: (t.title ?? '').trim() || 'Work'
    });
  } catch {
    // A missing focus_session collection, or Directus being unhappy, must not
    // leave a task stuck in 'active'.
  }
}

async function pauseActiveFocus(): Promise<void> {
  const active = await getActiveFocusTask();
  if (!active) return;
  await recordFocusStretch(active);
  await repo.update('focus_task', active.id, {
    status: 'queued',
    seconds_spent: focusElapsed(active),
    started_at: null
  });
}

/** Make a task active (pausing any current active task first). */
export async function startFocusTask(id: number): Promise<void> {
  await pauseActiveFocus();
  await repo.update('focus_task', id, { status: 'active', started_at: new Date().toISOString() });
}

/** Stop a task — bank its time and mark it done.
 *
 *  Sets closed_by='twin' for the same reason completeFocusTask does: this
 *  closes the task, so Asana has to be told. Without it the timer's Stop
 *  button was a third way to close something in twin that stayed open in
 *  Asana forever (the board's Done was the first, the list checkbox the
 *  second). */
export async function stopFocusTask(id: number): Promise<void> {
  const t = await repo.get<FocusTask>('focus_task', id);
  if (!t) throw new Error(`focus_task ${id} not found`);
  await recordFocusStretch(t);
  await repo.update('focus_task', id, {
    status: 'done',
    seconds_spent: focusElapsed(t),
    started_at: null,
    closed_by: 'twin'
  });
}

/** One task with its relations resolved, for the detail page. */
export async function getFocusTask(id: number): Promise<FocusTask> {
  const t = await repo.get<FocusTask>('focus_task', id, { fields: FOCUS_FIELDS as unknown as string[] });
  if (!t) throw new Error(`focus_task ${id} not found`);
  return t;
}

/** A task's subtasks, including done ones — the detail page shows the whole
 *  picture, not just what is left. */
export async function listFocusSubtasks(parentId: number): Promise<FocusTask[]> {
  return await repo.list<FocusTask>('focus_task', {
    where: { field: 'parent_id', op: 'eq', value: parentId },
    fields: FOCUS_FIELDS as unknown as string[],
    sort: ['sort', 'id']
  });
}

/** Finish the active task and start the next queued one. Returns the new
 *  active task, or null if the queue is now empty. */
export async function nextFocusTask(): Promise<FocusTask | null> {
  const active = await getActiveFocusTask();
  if (active) {
      await repo.update('focus_task', active.id, { status: 'done', seconds_spent: focusElapsed(active), started_at: null });
  }
  const queued = await repo.list<FocusTask>('focus_task', {
    where: { field: 'status', op: 'eq', value: 'queued' },
    sort: ['sort', 'id'],
    limit: 1
  });
  if (!queued[0]) return null;
  await repo.update('focus_task', queued[0].id, { status: 'active', started_at: new Date().toISOString() });
  return getActiveFocusTask();
}

/** Persist a new queue order (ids in desired order). */
export async function reorderFocusTasks(ids: number[]): Promise<void> {
  await Promise.all(
    ids.map((id, i) => repo.update('focus_task', id, { sort: i + 1 }))
  );
}

/** Every task including done ones — the Tasks overview needs closed work to
 *  show a Done column and to render history in the calendar. */
export async function listAllFocusTasks(): Promise<FocusTask[]> {
  return await repo.list<FocusTask>('focus_task', {
    fields: FOCUS_FIELDS as unknown as string[],
    sort: ['sort', 'id']
  });
}
