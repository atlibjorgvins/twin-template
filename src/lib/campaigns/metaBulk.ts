// Meta Ads Manager "Import Ads in Bulk" file generation.
//
// Ads Manager (Import/Export → Import ads in bulk) accepts an XLSX
// with ONE ROW PER OBJECT — a campaign row, then a row per ad set,
// then a row per ad — linked by repeating the parent name columns on
// child rows. ID columns stay blank so the import CREATES new objects
// (a filled ID would overwrite an existing one).
//
// XLSX (not CSV) because Ads Manager mangles Icelandic characters in
// plain CSV unless saved as Unicode .txt — SheetJS sidesteps encoding
// entirely.
//
// The COLUMNS map below follows Meta's documented template. Header
// names drift over time and differ from the Ads Manager UI labels
// ("Body" = primary text, "Title" = headline) — if Meta rejects a
// column, export one existing campaign from Ads Manager and mirror
// its headers here; everything routes through this one table.
import * as XLSX from 'xlsx';
import type { MkAd, MkAdSet, MkCampaign, MkMetaCampaign, MkTargeting } from '$lib/directus';

export type MetaBulkInput = {
  campaign: MkCampaign;
  metaCampaigns: MkMetaCampaign[];
  adSets: MkAdSet[];
  ads: MkAd[];
  /** mk_ad.id → exported image file name (must match the files the
   *  user uploads in the import dialog, case-sensitive). */
  imageFileNames: Map<number, string>;
};

const COLUMNS = [
  'Campaign ID',
  'Campaign Name',
  'Campaign Status',
  'Campaign Objective',
  'Buying Type',
  'Campaign Daily Budget',
  'Campaign Lifetime Budget',
  'Ad Set ID',
  'Ad Set Name',
  'Ad Set Run Status',
  'Ad Set Daily Budget',
  'Ad Set Lifetime Budget',
  'Ad Set Time Start',
  'Ad Set Time Stop',
  'Optimization Goal',
  'Billing Event',
  'Countries',
  'Age Min',
  'Age Max',
  'Gender',
  'Flexible Inclusions',
  'Ad ID',
  'Ad Name',
  'Ad Status',
  'Title',
  'Body',
  'Link Description',
  'Link',
  'Call to Action',
  'Image File Name'
] as const;

type Row = Partial<Record<(typeof COLUMNS)[number], string>>;

function money(v: number | string | null | undefined): string {
  const n = typeof v === 'string' ? Number(v) : v;
  return n != null && Number.isFinite(n) && n > 0 ? String(n) : '';
}

function genderLabel(t?: MkTargeting | null): string {
  if (!t?.genders || t.genders === 'all') return 'All';
  return t.genders === 'male' ? 'Men' : t.genders === 'female' ? 'Women' : 'All';
}

// Ads Manager expects "MM/DD/YYYY HH:mm" style times in bulk files.
function bulkTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Build the row set: campaign row → ad set rows → ad rows, with the
 *  parent-name columns repeated on every child row (that's how the
 *  importer links levels when IDs are blank). */
export function buildMetaBulkRows(input: MetaBulkInput): Row[] {
  const rows: Row[] = [];
  for (const mc of input.metaCampaigns) {
    const campaignCols: Row = {
      'Campaign Name': mc.name ?? '',
      'Campaign Status': mc.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      'Campaign Objective': mc.objective ?? 'OUTCOME_TRAFFIC',
      'Buying Type': mc.buying_type ?? 'AUCTION',
      'Campaign Daily Budget': mc.budget_mode === 'daily' ? money(mc.budget_amount) : '',
      'Campaign Lifetime Budget': mc.budget_mode === 'lifetime' ? money(mc.budget_amount) : ''
    };
    rows.push({ ...campaignCols });

    const sets = input.adSets.filter((a) => Number(a.mk_meta_campaign_id) === mc.id);
    for (const as of sets) {
      const t = as.targeting ?? {};
      const adSetCols: Row = {
        ...campaignCols,
        'Ad Set Name': as.name ?? '',
        'Ad Set Run Status': as.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
        'Ad Set Daily Budget':
          mc.budget_mode === 'adset' && as.budget_mode === 'daily' ? money(as.budget_amount) : '',
        'Ad Set Lifetime Budget':
          mc.budget_mode === 'adset' && as.budget_mode === 'lifetime' ? money(as.budget_amount) : '',
        'Ad Set Time Start': bulkTime(as.start_time),
        'Ad Set Time Stop': bulkTime(as.end_time),
        'Optimization Goal': as.optimization_goal ?? 'LINK_CLICKS',
        'Billing Event': as.billing_event ?? 'IMPRESSIONS',
        Countries: (t.countries ?? ['IS']).join(', '),
        'Age Min': t.ageMin != null ? String(t.ageMin) : '',
        'Age Max': t.ageMax != null ? String(t.ageMax) : '',
        Gender: genderLabel(t),
        'Flexible Inclusions': t.interests?.trim() ?? ''
      };
      rows.push({ ...adSetCols });

      for (const ad of input.ads.filter((a) => Number(a.mk_ad_set_id) === as.id)) {
        rows.push({
          ...adSetCols,
          'Ad Name': ad.name ?? '',
          'Ad Status': ad.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
          Title: ad.title ?? '',
          Body: ad.body ?? '',
          'Link Description': ad.description ?? '',
          Link: ad.link_url ?? '',
          'Call to Action': ad.call_to_action ?? 'LEARN_MORE',
          'Image File Name': ad.image_id ? (input.imageFileNames.get(ad.id) ?? '') : ''
        });
      }
    }
  }
  return rows;
}

/** File name for an ad's creative — must match what the user uploads
 *  in the import dialog, so keep it ASCII-safe and deterministic. */
export function adImageFileName(ad: MkAd, ext = 'jpg'): string {
  const slug = (ad.name ?? `ad-${ad.id}`)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ð/g, 'd')
    .replace(/þ/g, 'th')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || `ad-${ad.id}`}.${ext}`;
}

/** Generate the XLSX and hand it to the browser as a download. */
export function downloadMetaBulkXlsx(input: MetaBulkInput, fileName: string): void {
  const rows = buildMetaBulkRows(input);
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...COLUMNS] });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Ads');
  XLSX.writeFile(book, fileName);
}
