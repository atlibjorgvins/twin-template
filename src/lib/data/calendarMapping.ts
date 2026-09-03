// Calendar source → Project mapping
//
// Maps each synced calendar to a default project, so events from you@work.example
// land on KLAK and the personal calendar stays unattached.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Note, Project } from '$lib/data/types';
import { reconcilePersonProjectInheritance } from '$lib/project-inheritance';
import { updateProjectPerson } from '$lib/data/projectMembers';

// ── Calendar source → Project mapping ───────────────────────────────
// One row per external calendar name (e.g. "you@work.example"). When set,
// the Apple Calendar ingest applies the row's project_id to every
// event from that calendar, and a Settings backfill button can re-
// link existing rows.
export type CalendarMapping = {
  id: number;
  external_calendar: string;
  project_id?: number | Project | null;
  scope?: 'work' | 'private' | 'both' | string | null;
  note?: string | null;
  status?: string;
};

export async function listCalendarMappings(): Promise<CalendarMapping[]> {
  return await repo.list<CalendarMapping>('CalendarMapping', {
    where: { field: 'status', op: 'neq', value: 'archived' },
    fields: ['*', { project_id: ['id', 'name', 'kind', 'color'] }],
    sort: ['external_calendar']
  });
}

export async function createCalendarMapping(patch: Partial<CalendarMapping> & { external_calendar: string }): Promise<CalendarMapping> {
  return await repo.create<CalendarMapping>('CalendarMapping', { status: 'published', ...patch } as Record<string, unknown>);
}

export async function updateCalendarMapping(id: number, patch: Partial<CalendarMapping>): Promise<CalendarMapping> {
  return await repo.update<CalendarMapping>('CalendarMapping', id, patch as Record<string, unknown>);
}

export async function deleteCalendarMapping(id: number): Promise<void> {
  await repo.remove('CalendarMapping', id);
}

/** Distinct external_calendar values currently present on Dates,
 *  with a count per calendar — feeds the Settings picker so the user
 *  doesn't have to type calendar names by hand. */
export async function listExternalCalendars(): Promise<Array<{ name: string; count: number }>> {
  const rows = await repo.list<{ external_calendar: string | null }>('Dates', {
    where: { and: [
      { field: 'status', op: 'neq', value: 'archived' },
      { field: 'external_calendar', op: 'nnull' }
    ] },
    fields: ['external_calendar']
  });
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = (r.external_calendar ?? '').trim();
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/** One-shot backfill: for every Dates row whose external_calendar
 *  matches a CalendarMapping with a project_id set, write that
 *  project_id to the row (only when the row's project_id is null —
 *  hand-set links are never clobbered). Returns counts per mapping
 *  so the UI can summarise. */
export async function backfillCalendarMappings(): Promise<Array<{ external_calendar: string; project_id: number | null; updated: number }>> {
  const mappings = await listCalendarMappings();
  const out: Array<{ external_calendar: string; project_id: number | null; updated: number }> = [];
  for (const m of mappings) {
    const pid = m.project_id && typeof m.project_id === 'object' ? (m.project_id as Project).id : (typeof m.project_id === 'number' ? m.project_id : null);
    if (!pid) { out.push({ external_calendar: m.external_calendar, project_id: null, updated: 0 }); continue; }
    const rows = await repo.list<{ id: number }>('Dates', {
      where: { and: [
        { field: 'external_calendar', op: 'eq', value: m.external_calendar },
        { field: 'project_id', op: 'null' },
        { field: 'status', op: 'neq', value: 'archived' }
      ] },
      fields: ['id']
    });
    for (const r of rows) {
      await repo.update('Dates', r.id, { project_id: pid });
    }
    out.push({ external_calendar: m.external_calendar, project_id: pid, updated: rows.length });
  }
  return out;
}

export async function removeProjectPerson(id: number) {
  const row = await repo.list<{ person_id: number | { id: number } | null }>('Project_people', {
    where: { field: 'id', op: 'eq', value: id },
    fields: ['person_id'],
    limit: 1
  });
  const personId = typeof row[0]?.person_id === 'object'
    ? row[0]?.person_id?.id
    : row[0]?.person_id;
  const res = await updateProjectPerson(id, { status: 'archived' });
  if (personId) await reconcilePersonProjectInheritance(personId);
  return res;
}

export async function captureInbox(text: string) {
  return await repo.create<Note>('notes', {
    title: text.slice(0, 80),
    content: text,
    status: 'draft',
    note_type: 'inbox'
  } as Record<string, unknown>);
}

// Notes — moved to $lib/data/notes.ts and re-exported
// at the end of this file. See docs/opening-up-twin.md.
