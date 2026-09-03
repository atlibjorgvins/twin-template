// Receipts
//
// OCR'd receipts. Holds FINANCE_RECEIPT_FIELDS, ensureReceiptsFolder and
// updateFinanceReceipt, which is why the org-linking half could not move
// separately.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import { authHeader } from '$lib/data/client';
import { PUBLIC_DIRECTUS_URL } from '$env/static/public';
import { uploadFile } from '$lib/data/batch';

// ─── Receipts ────────────────────────────────────────────────────────────
// A photographed purchase receipt, stored as a Directus file in the
// "Receipts" folder. OCR (added later) fills amount/merchant/txn_date and
// links to a finance_txn via txn_id.
export type FinanceReceipt = {
  id: number;
  image?: string | null;        // directus_files id
  captured_at?: string | null;
  status?: 'new' | 'processed' | 'linked' | 'failed' | string | null;
  note?: string | null;
  amount?: number | null;
  merchant?: string | null;
  txn_date?: string | null;
  txn_id?: number | null;
  date_created?: string | null;
  // Written by directus-extension-ocr-receipts; read-only from the app's
  // point of view. ocr_text is kept so the parser can be re-run without
  // re-OCR, which is also what makes it useful in the review UI when a
  // field came back empty.
  ocr_text?: string | null;
  ocr_confidence?: number | null;
  ocr_attempts?: number | null;
  /** VAT, filled only when the printed figure reconciles against the total
   *  at 24% or 11% — most "VSK" lines are the company's VAT number. */
  vsk_amount?: number | null;
  /** Organization this receipt is from (m2o). Auto-filled on an exact name
   *  or taught-alias match; expanded to an object when requested. */
  org_id?: number | unknown | null;
  /** Project this expense belongs to (m2o). Always set by hand — nothing in
   *  a receipt's text says which project it serves. */
  project_id?: number | unknown | null;
};

/** Find (or create) the "Receipts" file folder and return its id. Cached
 *  for the session so we only hit /folders once. */
let _receiptsFolderId: string | null = null;
export async function ensureReceiptsFolder(): Promise<string> {
  if (_receiptsFolderId) return _receiptsFolderId;
  const auth = authHeader();
  const q = encodeURIComponent(JSON.stringify({ name: { _eq: 'Receipts' } }));
  const found = await fetch(`${PUBLIC_DIRECTUS_URL}/folders?filter=${q}&limit=1`, {
    headers: auth,
    credentials: 'include'
  })
    .then((r) => r.json())
    .catch(() => null);
  const existing = found?.data?.[0]?.id as string | undefined;
  if (existing) return (_receiptsFolderId = existing);
  const created = await fetch(`${PUBLIC_DIRECTUS_URL}/folders`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name: 'Receipts' })
  }).then((r) => r.json());
  return (_receiptsFolderId = created?.data?.id as string);
}

/** Upload a receipt photo into the Receipts folder + create the row. */
export async function createFinanceReceipt(
  file: File,
  opts: {
    note?: string | null;
    captured_at?: string;
    /** Tagged at capture: standing at the till is when you actually know
     *  which org and project a purchase belongs to. */
    org_id?: number | null;
    project_id?: number | null;
  } = {}
): Promise<FinanceReceipt> {
  const folder = await ensureReceiptsFolder();
  const captured = opts.captured_at ?? new Date().toISOString();
  const imageId = await uploadFile(file, { folder, title: `Receipt — ${captured}` });
  return await repo.create<FinanceReceipt>('finance_receipt', {
    image: imageId,
    captured_at: captured,
    status: 'new',
    note: opts.note || null,
    org_id: opts.org_id ?? null,
    project_id: opts.project_id ?? null
  } as Record<string, unknown>);
}

// Exported because the org-linking half in receiptOrgs.ts reads it.
export const FINANCE_RECEIPT_FIELDS = [
  'id', 'image', 'captured_at', 'status', 'note', 'amount', 'merchant',
  'txn_date', 'txn_id', 'date_created', 'ocr_text', 'ocr_confidence', 'ocr_attempts',
  'vsk_amount',
  // Expanded so the review list can show the names without an extra round
  // trip per row.
  'org_id.id', 'org_id.name', 'project_id.id', 'project_id.name'
];

export async function listFinanceReceipts(limit = 200): Promise<FinanceReceipt[]> {
  return await repo.list<FinanceReceipt>('finance_receipt', {
    fields: FINANCE_RECEIPT_FIELDS,
    sort: ['-captured_at', '-id'],
    limit
  });
}

export async function updateFinanceReceipt(
  id: number,
  patch: Partial<FinanceReceipt>
): Promise<FinanceReceipt> {
  return await repo.update<FinanceReceipt>('finance_receipt', id, patch as Record<string, unknown>);
}

export async function deleteFinanceReceipt(id: number): Promise<void> {
  await repo.remove('finance_receipt', id);
}

/**
 * Put a receipt back in the OCR queue.
 *
 * `ocr_attempts` has to be cleared too, or the worker's 3-strike counter
 * parks it again on the first hiccup — a row that failed three times last
 * week should get a clean three attempts after someone asks for a retry.
 */
export async function requeueFinanceReceipt(id: number): Promise<FinanceReceipt> {
  return updateFinanceReceipt(id, { status: 'new', ocr_attempts: 0 });
}

/** Link a receipt to a transaction (or unlink when txnId is null). */
export async function linkFinanceReceipt(
  id: number,
  txnId: number | null
): Promise<FinanceReceipt> {
  return updateFinanceReceipt(id, {
    txn_id: txnId,
    status: txnId === null ? 'processed' : 'linked'
  });
}
