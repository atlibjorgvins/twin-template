// Parse a Landsbankinn account-statement .xlsx into finance_txn rows.
//
// Layout (verified): title rows 1–3, header row ~5, data below. Columns are
// matched by header NAME (Icelandic), not position, so a reordered export
// still works:
//   Dags (date) · Upphæð (amount) · Staða (balance) · Texti (merchant) ·
//   Skýring greiðslu (payment type) · Kennitala · Tnr/Seðilnr. + Tilvísun (refs)
// The account number lives in the row-2 title ("…reikningi 0113-26-100013 …").
//
// Amounts: negative = expense, positive = income (ISK). A composite dedup_key
// lets re-imports of the full year skip rows already stored.
import type { FinanceTxnInput } from '$lib/directus';

export type ParsedImport = {
  account: string;
  rowCount: number;
  rows: FinanceTxnInput[];
};

const pad = (n: number) => String(n).padStart(2, '0');

function toDateStr(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'number') {
    // Excel serial → date (25569 days between 1899-12-30 and 1970-01-01).
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${pad(+mo)}-${pad(+d)}`;
  }
  const dd = new Date(s);
  return Number.isNaN(dd.getTime()) ? null : `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}-${pad(dd.getDate())}`;
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  // Icelandic grouping: "1.234.567,89" → 1234567.89
  const s = String(v).replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().replace(/[\s.]+/g, ' ').trim();

// header alias → which field it feeds
const HEADER_ALIASES: { key: string; aliases: string[] }[] = [
  { key: 'date', aliases: ['dags'] },
  { key: 'amount', aliases: ['upphæð', 'upphaed', 'upphæ'] },
  { key: 'balance', aliases: ['staða', 'stada'] },
  { key: 'description', aliases: ['texti'] },
  { key: 'detail', aliases: ['skýring greiðslu', 'skýring', 'skyring'] },
  { key: 'kt', aliases: ['kennitala'] },
  { key: 'tnr', aliases: ['tnr', 'seðil', 'tnr/seðilnr', 'seðilnr'] },
  { key: 'ref', aliases: ['tilvísun', 'tilvisun'] }
];

function matchHeader(cell: unknown): string | null {
  const n = norm(cell);
  if (!n) return null;
  for (const h of HEADER_ALIASES) {
    if (h.aliases.some((a) => n === norm(a) || n.includes(norm(a)))) return h.key;
  }
  return null;
}

export async function parseLandsbankinn(buffer: ArrayBuffer): Promise<ParsedImport> {
  // xlsx is ~450KB — loaded on demand so it never rides the boot graph
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, blankrows: false });

  // Account number from any of the first title rows.
  let account = '';
  for (const row of grid.slice(0, 5)) {
    const text = (row || []).map((c) => String(c ?? '')).join(' ');
    const m = text.match(/(\d{4}-\d{2}-\d{4,})/);
    if (m) { account = m[1]; break; }
  }

  // Locate the header row: the one mapping both a date and an amount column.
  let headerIdx = -1;
  let colmap: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const map: Record<string, number> = {};
    (grid[i] || []).forEach((cell, ci) => {
      const k = matchHeader(cell);
      if (k && !(k in map)) map[k] = ci;
    });
    if ('date' in map && 'amount' in map) { headerIdx = i; colmap = map; break; }
  }
  if (headerIdx < 0) return { account, rowCount: 0, rows: [] };

  const get = (row: unknown[], key: string): unknown =>
    key in colmap ? row[colmap[key]] : undefined;

  const rows: FinanceTxnInput[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i] || [];
    const date = toDateStr(get(row, 'date'));
    const amount = toNum(get(row, 'amount'));
    if (!date || amount == null) continue; // skip totals / blanks

    const description = String(get(row, 'description') ?? '').trim();
    const detail = String(get(row, 'detail') ?? '').trim();
    const kt = String(get(row, 'kt') ?? '').trim();
    const balance = toNum(get(row, 'balance'));
    const tnr = String(get(row, 'tnr') ?? '').trim();
    const ref = String(get(row, 'ref') ?? '').trim();
    const dedup_key = `${account}|${date}|${amount}|${tnr}|${ref}|${description}`;

    rows.push({
      txn_date: date,
      amount,
      description: description || null,
      detail: detail || null,
      counterparty_kt: kt || null,
      balance,
      category: null,
      account: account || null,
      source: 'import',
      dedup_key,
      shared: false,
      paid_by: 'me',
      share_ex_pct: 50,
      recurring_group: null,
      notes: null
    });
  }

  return { account, rowCount: rows.length, rows };
}
