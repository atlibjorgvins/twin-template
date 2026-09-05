// Reading the change history (twin_audit) — the display side of the audit log
// whose recording side lives in auditSchema.ts. Any signed-in member may read
// it (RLS grants authenticated SELECT); the rows are written only by the
// server trigger, so what you read is the true record of who changed what.

import { repo } from '$lib/data/repo';

export interface AuditEntry {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  actor_id: string | null;
  action: 'insert' | 'update' | 'delete';
  table_name: string;
  row_id: string | null;
  label: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  /** Full deleted row (delete entries only) — lets a delete be re-inserted. */
  snapshot: Record<string, unknown> | null;
}

/** Map a raw table name to a friendly noun for the history line. */
const ENTITY_LABEL: Record<string, string> = {
  Person: 'person',
  organization: 'organization',
  Person_organization: 'role',
  Person_email: 'email',
  person_social: 'social link',
  organization_social: 'social link',
  notes: 'note',
  Project: 'project',
  Dates: 'event',
  Grant: 'grant',
  GrantAward: 'grant award',
  focus_task: 'task',
  habit: 'habit',
  Activity: 'interaction',
  Person_family: 'family link'
};

export function entityNoun(table: string): string {
  return ENTITY_LABEL[table] ?? table.replace(/_/g, ' ').toLowerCase();
}

/** Recent history, newest first, optionally filtered to one actor's email.
 *  Best-effort: returns [] on any backend without the table. */
export async function listAudit(limit = 100, actorEmail?: string): Promise<AuditEntry[]> {
  try {
    return await repo.list<AuditEntry>('twin_audit', {
      ...(actorEmail ? { where: { field: 'actor_email', op: 'eq', value: actorEmail } } : {}),
      sort: ['-occurred_at', '-id'],
      limit
    });
  } catch {
    return [];
  }
}

/** Undo one recorded change, from the current member's session (so RLS
 *  enforces editor/admin — a viewer's revert is refused). The revert is
 *  itself a normal write, so the trigger records it as new history:
 *    - update → write the changed fields' `from` values back
 *    - insert → delete the row it created
 *    - delete → re-insert the row from its snapshot
 *  Throws with a clear reason when an entry can't be reverted. */
export async function revertEntry(e: AuditEntry): Promise<void> {
  if (!e.row_id) throw new Error("This change can't be reverted.");
  if (e.action === 'update') {
    if (!e.changes || Object.keys(e.changes).length === 0) {
      throw new Error('Nothing to revert on this change.');
    }
    const patch = Object.fromEntries(Object.entries(e.changes).map(([k, v]) => [k, v.from]));
    await repo.update(e.table_name, e.row_id, patch as Record<string, unknown>);
  } else if (e.action === 'insert') {
    await repo.remove(e.table_name, e.row_id);
  } else {
    // delete
    if (!e.snapshot) {
      throw new Error('This deletion predates revert support, so it can’t be restored.');
    }
    await repo.create(e.table_name, e.snapshot);
  }
}

/** Can this entry be reverted at all (ignoring permissions)? A delete with no
 *  snapshot (recorded before snapshots) can't. */
export function isRevertable(e: AuditEntry): boolean {
  if (!e.row_id) return false;
  if (e.action === 'delete') return !!e.snapshot;
  if (e.action === 'update') return !!e.changes && Object.keys(e.changes).length > 0;
  return true; // insert
}

/** History for ONE record (a person/org card). row_id is stored as text, so
 *  the id is compared as a string. Best-effort — [] when history is off. */
export async function listAuditFor(
  table: string,
  rowId: number | string,
  limit = 50
): Promise<AuditEntry[]> {
  try {
    return await repo.list<AuditEntry>('twin_audit', {
      where: {
        and: [
          { field: 'table_name', op: 'eq', value: table },
          { field: 'row_id', op: 'eq', value: String(rowId) }
        ]
      },
      sort: ['-occurred_at', '-id'],
      limit
    });
  } catch {
    return [];
  }
}
