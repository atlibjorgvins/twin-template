// Ads Manager report parsing for the metrics tab.
//
// The user exports a report (Ads Reporting → Export → CSV, or copies
// the table) with day breakdown. Headers vary with the chosen columns
// and account language, so matching is fuzzy: case-insensitive,
// "Amount spent (ISK)" → spend, "Day"/"Reporting starts" → date, etc.
// Unmatched campaign names surface in the preview so nothing drops
// silently.
import type { MkMetricInput } from '$lib/directus';

export type ParsedReportRow = {
  refName: string;
  date: string; // YYYY-MM-DD
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  results: number | null;
  resultType: string | null;
};

export type ReportPreview = {
  rows: ParsedReportRow[];
  /** Distinct campaign names found in the file. */
  names: string[];
  warnings: string[];
};

// header alias → canonical field
const HEADER_ALIASES: [RegExp, keyof ParsedReportRow | 'refName'][] = [
  [/^(campaign name|herferðarheiti|herferð)$/i, 'refName'],
  [/^(day|date|reporting starts|dagur|dagsetning)$/i, 'date'],
  [/^amount spent(\s*\(.+\))?$|^spend$|^upphæð notuð/i, 'spend'],
  [/^impressions$|^birtingar$/i, 'impressions'],
  [/^reach$|^dekkun$|^umfang$/i, 'reach'],
  [/^(link clicks|clicks \(all\)|clicks|smellir( á tengil)?)$/i, 'clicks'],
  [/^results$|^niðurstöður$/i, 'results'],
  [/^(result indicator|result type|results indicator)$/i, 'resultType']
];

/** Split a CSV/TSV line honoring quoted fields. */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseNumber(raw: string): number | null {
  if (!raw) return null;
  // Reports may use "1.234,56" (is-IS) or "1,234.56" (en) grouping.
  let s = raw.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  // "12.345" / "1.234.567" / "12,345" in 3-digit groups is grouping,
  // not a decimal — pasted is-IS/en UI tables format spend that way.
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) {
    s = s.replace(/[.,]/g, '');
  } else {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD.MM.YYYY (Icelandic) or MM/DD/YYYY (US export)
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/** Parse pasted text or CSV file contents into preview rows. */
export function parseAdsReport(text: string): ReportPreview {
  const warnings: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], names: [], warnings: ['No data rows found.'] };

  const sep = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitLine(lines[0], sep);
  const colMap = new Map<number, keyof ParsedReportRow>();
  headers.forEach((h, i) => {
    for (const [re, field] of HEADER_ALIASES) {
      if (re.test(h.trim())) {
        colMap.set(i, field as keyof ParsedReportRow);
        break;
      }
    }
  });

  const fields = new Set(colMap.values());
  if (!fields.has('refName')) warnings.push('No "Campaign name" column found.');
  if (!fields.has('date')) warnings.push('No "Day" / date column found — export with a day breakdown.');

  const rows: ParsedReportRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, sep);
    const row: ParsedReportRow = {
      refName: '',
      date: '',
      spend: null,
      impressions: null,
      reach: null,
      clicks: null,
      results: null,
      resultType: null
    };
    for (const [idx, field] of colMap) {
      const raw = cells[idx] ?? '';
      if (field === 'refName') row.refName = raw;
      else if (field === 'date') row.date = parseDate(raw) ?? '';
      else if (field === 'resultType') row.resultType = raw || null;
      else row[field] = parseNumber(raw);
    }
    if (row.refName && row.date) rows.push(row);
  }
  if (rows.length === 0 && lines.length > 1) {
    warnings.push('No rows had both a campaign name and a parseable date.');
  }
  const names = [...new Set(rows.map((r) => r.refName))];
  return { rows, names, warnings };
}

/** Convert preview rows to mk_metric inputs, matching report campaign
 *  names against this umbrella's Meta campaign names. Unmatched names
 *  are returned so the UI can show what would be skipped. */
export function toMetricInputs(
  rows: ParsedReportRow[],
  metaCampaignNames: string[]
): { metrics: MkMetricInput[]; unmatched: string[] } {
  const known = new Set(metaCampaignNames.map((n) => n.trim().toLowerCase()));
  const metrics: MkMetricInput[] = [];
  const unmatched = new Set<string>();
  for (const r of rows) {
    const matches = known.has(r.refName.trim().toLowerCase());
    if (!matches) unmatched.add(r.refName);
    metrics.push({
      level: matches ? 'meta_campaign' : 'campaign',
      ref_name: r.refName,
      date: r.date,
      spend: r.spend,
      impressions: r.impressions,
      reach: r.reach,
      clicks: r.clicks,
      results: r.results,
      result_type: r.resultType,
      source: 'import'
    });
  }
  return { metrics, unmatched: [...unmatched] };
}
