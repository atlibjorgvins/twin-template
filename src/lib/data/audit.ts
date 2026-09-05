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

/** Recent history, newest first. Best-effort: returns [] on any backend
 *  without the table (a vault that never enabled history). */
export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  try {
    return await repo.list<AuditEntry>('twin_audit', {
      sort: ['-occurred_at', '-id'],
      limit
    });
  } catch {
    return [];
  }
}
