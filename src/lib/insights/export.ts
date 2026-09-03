// Exports for /insights: a per-figure CSV and one multi-sheet workbook.
//
// `xlsx` is already a dependency (finances + campaigns use it), so the
// workbook costs no new package. It is imported lazily anyway — the library is
// ~400kB and nobody should pay for it on a page they only look at.
import type { Metrics } from './metrics';
import { roleLabel } from './metrics';

export type CsvCell = string | number;
export type CsvTable = { columns: string[]; rows: CsvCell[][] };

/** RFC-4180-ish quoting: wrap when the cell contains a comma, quote or
 *  newline, and double any embedded quotes. */
function csvCell(v: CsvCell): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: CsvTable): string {
  return [table.columns, ...table.rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking synchronously can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(table: CsvTable, filenameStem: string) {
  // Leading BOM so Excel on Windows reads the Icelandic characters as UTF-8
  // instead of mangling them — same trick as the campaigns exporter.
  const blob = new Blob(['\ufeff' + toCsv(table)], { type: 'text/csv;charset=utf-8' });
  saveBlob(blob, `${slug(filenameStem)}.csv`);
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'insights'
  );
}

// ── The workbook ────────────────────────────────────────────────────────
// One sheet per grain: the KPIs you quote, then the rows behind them. A
// funder who asks "which 18 companies?" can answer it from the file without
// coming back to you.

export type SheetSpec = { name: string; table: CsvTable };

/** Sheets for the current slice. Exported separately from the writer so the
 *  same definitions feed both the workbook and any single-table CSV. */
export function buildSheets(
  m: Metrics,
  ctx: { programme: string; filterSummary: string; generatedAt: string }
): SheetSpec[] {
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const genderRow = (splits: Metrics['gender']['all'], total: number) =>
    splits.flatMap((s) => [s.value, pct(s.value, total)]);

  const summary: CsvTable = {
    columns: ['Metric', 'Value'],
    rows: [
      ['Programme', ctx.programme],
      ['Filters', ctx.filterSummary],
      ['Generated', ctx.generatedAt],
      ['Cohorts', m.kpi.cohorts],
      ['Organizations (distinct)', m.kpi.orgs],
      ['Organization memberships', m.kpi.orgLinks],
      ['Organizations still active', m.kpi.activeOrgs],
      ['People (distinct)', m.kpi.people],
      ['People memberships', m.kpi.personLinks],
      ['Participants', m.kpi.participants],
      ['Mentors', m.kpi.mentors],
      ['People in more than one cohort', m.kpi.returningPeople],
      ['Women', m.gender.all.find((s) => s.key === 'female')?.value ?? 0],
      ['Men', m.gender.all.find((s) => s.key === 'male')?.value ?? 0],
      ['Gender not recorded', m.gender.all.find((s) => s.key === 'unknown')?.value ?? 0],
      ['Gender recorded (%)', pct(Math.round(m.gender.knownShare * m.kpi.people), m.kpi.people)],
      ['Grant awards', m.kpi.grantCount],
      ['Grant total (all-time)', m.kpi.grantTotal],
      ['Grant total after joining', m.kpi.grantTotalAfter],
      ['Organizations with a grant', m.kpi.fundedOrgs],
      ['Currencies present', m.currencies.join(' / ') || '—']
    ]
  };

  const cohorts: CsvTable = {
    columns: [
      'Cohort', 'Year', 'Start', 'End', 'Organizations', 'People',
      'Participants', 'Mentors', 'Planned intake', 'Applications'
    ],
    rows: m.cohorts.map((c) => [
      c.name, c.year ?? '', c.startDate ?? '', c.endDate ?? '',
      c.orgs, c.people, c.participants, c.mentors,
      c.participantCount ?? '', c.applicationCount ?? ''
    ])
  };

  const organizations: CsvTable = {
    columns: [
      'Organization', 'Directus ID', 'Roles', 'Cohort years', 'First year',
      'Still active', 'Website', 'Industry', 'Grant awards', 'Grant total'
    ],
    rows: m.orgs.map((o) => [
      o.name, o.id, o.roles.map(roleLabel).join('; '), o.years.join('; '),
      o.firstYear ?? '', o.isActive ? 'yes' : 'no', o.website ?? '',
      o.industry ?? '', o.grantCount, o.grantTotal
    ])
  };

  const people: CsvTable = {
    columns: [
      'Name', 'Directus ID', 'Roles', 'Cohort years', 'Cohorts',
      'Gender (normalised)', 'Gender (as stored)', 'Email', 'City', 'Country'
    ],
    rows: m.people.map((p) => [
      p.name, p.id, p.roles.map(roleLabel).join('; '), p.years.join('; '),
      p.cohortCount, p.sex, p.genderRaw ?? '', p.email ?? '', p.city ?? '', p.country ?? ''
    ])
  };

  const grants: CsvTable = {
    columns: [
      'Organization', 'Fund', 'Year', 'Amount', 'Currency', 'Status',
      'Relative to joining', 'Award ID'
    ],
    rows: m.awards.map((a) => [
      a.orgName, a.fund, a.year ?? '', a.amount, a.currency, a.status, a.timing, a.id
    ])
  };

  const genderSheet: CsvTable = {
    columns: ['Group', 'People', 'Women', 'Women %', 'Men', 'Men %', 'Not recorded', 'Not recorded %'],
    rows: [
      ['All', m.kpi.people, ...genderRow(m.gender.all, m.kpi.people)],
      ...m.gender.byRole.map((r) => [r.label, r.total, ...genderRow(r.splits, r.total)])
    ]
  };

  return [
    { name: 'Summary', table: summary },
    { name: 'Cohorts', table: cohorts },
    { name: 'Gender', table: genderSheet },
    { name: 'Organizations', table: organizations },
    { name: 'People', table: people },
    { name: 'Grants', table: grants }
  ];
}

export async function downloadWorkbook(
  m: Metrics,
  ctx: { programme: string; filterSummary: string; generatedAt: string },
  /** Sheets from another module — marketing spend, today. Appended after the
   *  programme's own, so the file opens on what the page is mostly about. */
  extraSheets: SheetSpec[] = []
): Promise<void> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const sheet of [...buildSheets(m, ctx), ...extraSheets]) {
    const ws = XLSX.utils.aoa_to_sheet([sheet.table.columns, ...sheet.table.rows]);
    // Column widths from the content — an unreadable first column is the
    // difference between a file someone uses and one they close.
    ws['!cols'] = sheet.table.columns.map((c, i) => {
      const longest = Math.max(
        String(c).length,
        ...sheet.table.rows.map((r) => String(r[i] ?? '').length)
      );
      return { wch: Math.min(48, Math.max(10, longest + 2)) };
    });
    // Excel caps sheet names at 31 chars and forbids : \ / ? * [ ].
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31));
  }
  XLSX.writeFile(wb, `${slug(ctx.programme)}-insights.xlsx`);
}
