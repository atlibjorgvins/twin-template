// Sessions: one row per stretch of work, and the push to Clockify.
//
// This exists because focus_task cannot answer "when was this worked on".
// `seconds_spent` is cumulative and `started_at` is cleared on every pause, so
// a task worked in three stretches has one number and no timestamps. Clockify
// needs a real start and end, and inventing them would put blocks of time in
// the record that never happened.
//
// The push is deliberately AFTER the fact, at pause/stop, when both ends are
// known. twin owns the clock; Clockify receives finished stretches.
import { repo } from '$lib/data/repo';
import {
  clockifyConfigured,
  clockifyCreateEntry,
  type ClockifyEntry
} from './clockify';
import { explainPushFailure } from './clockifyErrors';

export type PushStatus = 'pending' | 'pushed' | 'failed' | 'skipped';

export type FocusSession = {
  id: number;
  task_id?: number | { id: number; title?: string | null } | null;
  /** Set from Tools → Time to attribute one stretch away from its task. */
  project_id?: number | { id: number } | null;
  started_at: string;
  ended_at: string | null;
  seconds: number;
  description: string | null;
  clockify_entry_id: string | null;
  push_status: PushStatus;
  push_error: string | null;
  pushed_at: string | null;
};

/** Sessions shorter than this are noise — a mis-click, not work. */
export const MIN_SESSION_SECONDS = 60;

/**
 * Record a finished stretch.
 *
 * Called from the pause/stop paths, which is the only moment both ends exist.
 * Returns null for a stretch too short to be worth recording, so the caller
 * does not have to care.
 */
export async function recordSession(input: {
  taskId: number;
  startedAt: string;
  endedAt?: string;
  description: string;
}): Promise<FocusSession | null> {
  const start = Date.parse(input.startedAt);
  const end = input.endedAt ? Date.parse(input.endedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  const seconds = Math.floor((end - start) / 1000);
  if (seconds < MIN_SESSION_SECONDS) return null;

  return repo.create<FocusSession>('focus_session', {
    task_id: input.taskId,
    started_at: new Date(start).toISOString(),
    ended_at: new Date(end).toISOString(),
    seconds,
    // Snapshotted, not joined: renaming a task later must not rewrite what
    // Clockify was told at the time.
    description: input.description,
    push_status: 'pending'
  });
}

/** Sessions still owed to Clockify. This is the number that makes a failed
 *  push visible instead of silently missing hours. */
export async function unpushedSessions(limit = 100): Promise<FocusSession[]> {
  return repo.list<FocusSession>('focus_session', {
    where: { field: 'push_status', op: 'in', value: ['pending', 'failed'] },
    fields: ['id', 'task_id.id', 'task_id.title', 'task_id.project_id', 'project_id', 'started_at', 'ended_at', 'seconds', 'description', 'push_status', 'push_error'],
    sort: ['started_at'],
    limit
  });
}

export async function unpushedCount(): Promise<number> {
  const rows = await unpushedSessions(500).catch(() => [] as FocusSession[]);
  return rows.length;
}

/**
 * Push one session, once.
 *
 * Idempotent on `clockify_entry_id`: a session that already carries one is
 * never sent again, so a retry after a partial failure cannot double-bill.
 * A failure is recorded on the row rather than thrown away — that is the whole
 * reason this model is safe to use.
 */
export async function pushSession(
  session: FocusSession,
  // Takes the whole session, not just its task id: a stretch may name its own
  // project, and resolving from the task alone would silently discard that.
  ctx: { workspaceId: string; projectIdFor?: (session: FocusSession) => Promise<string | null> }
): Promise<'pushed' | 'skipped' | 'failed'> {
  if (session.clockify_entry_id) return 'skipped';
  if (!session.ended_at) return 'skipped';
  if (!clockifyConfigured()) return 'skipped';

  try {
    const projectId = ctx.projectIdFor ? await ctx.projectIdFor(session).catch(() => null) : null;
    const entry: ClockifyEntry = await clockifyCreateEntry(ctx.workspaceId, {
      start: session.started_at,
      end: session.ended_at,
      description: session.description || 'Work',
      projectId
    });
    await repo.update('focus_session', session.id, {
      clockify_entry_id: entry.id,
      push_status: 'pushed',
      pushed_at: new Date().toISOString(),
      push_error: null
    });
    return 'pushed';
  } catch (e) {
    // Recorded, not swallowed and not thrown at the caller: the timer must
    // keep working when Clockify is down, and the row is the retry queue.
    await repo
      .update('focus_session', session.id, {
        push_status: 'failed',
        push_error: explainPushFailure(e).slice(0, 500)
      })
      .catch(() => undefined);
    return 'failed';
  }
}

/** Push everything owed. Returns the tally, so the UI can say what happened. */
export async function pushAllPending(ctx: {
  workspaceId: string;
  projectIdFor?: (session: FocusSession) => Promise<string | null>;
}): Promise<{ pushed: number; failed: number; skipped: number }> {
  const out = { pushed: 0, failed: 0, skipped: 0 };
  if (!clockifyConfigured()) return out;
  for (const s of await unpushedSessions()) {
    // Serial on purpose: Clockify rate-limits, and a burst of parallel writes
    // is how an integration gets throttled into looking broken.
    out[await pushSession(s, ctx)]++;
  }
  return out;
}
