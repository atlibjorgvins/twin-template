// Receipt → organization linking
//
// Attributing a receipt to an org, and the merchant-alias learning that
// makes the next one automatic.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import type { FinanceReceipt } from '$lib/data/receipts';
import type { FinanceTxn } from '$lib/data/finances';
import type { Organization } from '$lib/data/types';
import { createOrg } from '$lib/data/orgs';
import { FINANCE_RECEIPT_FIELDS, ensureReceiptsFolder, updateFinanceReceipt } from '$lib/data/receipts';
import { listFinanceTxns } from '$lib/data/finances';

// ─── Receipt → organization ──────────────────────────────────────────────
// Two ways a receipt finds its org: the merchant text matches an org name
// outright, or someone has taught us that this text means that org. The
// second exists because real receipts print places and branches, not
// company names — "Naustabryggja" is never going to equal an org name.

export type ReceiptMerchantAlias = {
  id: number;
  match_text?: string | null;
  org_id?: number | unknown | null;
  hits?: number | null;
  sort?: number | null;
  date_created?: string | null;
};

/**
 * Fold merchant text for comparison: lowercase, strip accents and anything
 * that is not a letter or digit.
 *
 * Same idea as the OCR parser's fold(), and deliberately a separate copy —
 * that one models glyph substitutions the recogniser makes (þ→p, ð→d) and
 * is calibrated by its own test suite. This one only needs to make
 * "Bónus Nýbýlavegur" and "bonus nybylavegur" meet. Coupling them would
 * mean OCR-model findings silently changing how orgs match.
 */
export function foldMerchant(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/þ/g, 'th')
    .replace(/ð/g, 'd')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Company-form suffixes, stripped before comparing names.
 *
 * Without this, nothing ever matches automatically: the org record is
 * "N1 ehf." while the receipt says "N1", so the folded forms differ and the
 * exact-match path — the only path allowed to auto-link — never fires.
 * Stripped from both sides, since receipts sometimes print the suffix too
 * ("Innnes ehf").
 */
const ORG_SUFFIXES = ['ehf', 'hf', 'slf', 'sf', 'ohf', 'svf', 'ltd', 'as', 'oy', 'ab', 'inc', 'llc', 'gmbh'];

export function foldOrgName(s: string | null | undefined): string {
  let k = foldMerchant(s);
  // Repeat: "Foo ehf. hf." exists in real registries more than you would like.
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of ORG_SUFFIXES) {
      if (k.length > suf.length + 1 && k.endsWith(suf)) {
        k = k.slice(0, -suf.length);
        changed = true;
      }
    }
  }
  return k;
}

export async function listReceiptMerchantAliases(): Promise<ReceiptMerchantAlias[]> {
  return repo.list<ReceiptMerchantAlias>('receipt_merchant_alias', {
    fields: ['id', 'match_text', 'org_id', 'hits', 'sort', 'date_created'],
    sort: ['-hits', 'match_text'],
    limit: -1
  });
}

export async function createReceiptMerchantAlias(
  matchText: string,
  orgId: number
): Promise<ReceiptMerchantAlias> {
  return repo.create<ReceiptMerchantAlias>('receipt_merchant_alias', {
    match_text: matchText.trim(),
    org_id: orgId,
    hits: 0
  });
}

export async function deleteReceiptMerchantAlias(id: number): Promise<void> {
  await repo.remove('receipt_merchant_alias', id);
}

export type OrgResolution = {
  orgId: number;
  orgName: string;
  /** How we got there — drives whether it is applied or merely offered. */
  via: 'alias' | 'exact' | 'contains';
  /** Only 'alias' and 'exact' are safe to write without asking. */
  auto: boolean;
  aliasId?: number;
};

/**
 * Which organization does this merchant text mean?
 *
 * Precedence: a taught alias beats everything (it is an explicit human
 * decision), then an exact folded name match, then containment either way
 * round. Containment is offered but never auto-applied: "Nova" is inside
 * "Novator", and quietly filing a receipt against the wrong company is
 * worse than leaving it unfiled.
 */
export function resolveMerchantOrg(
  merchant: string | null | undefined,
  orgs: Pick<Organization, 'id' | 'name'>[],
  aliases: ReceiptMerchantAlias[]
): OrgResolution | null {
  const key = foldOrgName(merchant);
  if (!key) return null;

  const orgById = new Map(orgs.map((o) => [o.id, o]));

  for (const a of aliases) {
    const aliasKey = foldOrgName(a.match_text);
    if (!aliasKey) continue;
    const rawId = typeof a.org_id === 'object' && a.org_id !== null
      ? (a.org_id as { id?: number }).id
      : (a.org_id as number | null);
    if (!rawId) continue;
    // Either direction: the alias may be shorter than the OCR'd line
    // ("Naustabryggja" inside "Kaffihus Naustabryggja 4").
    if (aliasKey === key || key.includes(aliasKey) || aliasKey.includes(key)) {
      const org = orgById.get(rawId);
      if (org) {
        return { orgId: rawId, orgName: org.name || `#${rawId}`, via: 'alias', auto: true, aliasId: a.id };
      }
    }
  }

  for (const o of orgs) {
    if (foldOrgName(o.name) === key) {
      return { orgId: o.id, orgName: o.name || `#${o.id}`, via: 'exact', auto: true };
    }
  }

  // Containment matches on whole WORDS, not raw substrings. A plain
  // substring test suggested an org literally named "test" for a merchant
  // reading "ZZTEST Kaffi …", because "test" is inside "zztest". Comparing
  // tokens keeps the useful cases — "Innnes vöruhús Korngörðum" still finds
  // "Innnes ehf." on the shared `innnes` token — and drops the accidents.
  const tokens = (v: string | null | undefined) =>
    (v ?? '')
      .split(/[^\p{L}\p{N}]+/u)
      .map(foldMerchant)
      .filter((t) => t.length >= 4);
  const merchantTokens = new Set(tokens(merchant));

  // Closest length wins, NOT longest. With "N1" the candidates are "N1 ehf.",
  // "N1 Rafmagn ehf." and "N18 ehf."; longest-first would confidently offer
  // N1 Rafmagn. Nearest in length picks the plainest name, and still prefers
  // "Olís Álfheimar" over "Olís" when the receipt itself says Álfheimar.
  const partial = orgs
    .filter((o) => tokens(o.name).some((t) => merchantTokens.has(t)))
    .sort(
      (a, b) =>
        Math.abs(foldOrgName(a.name).length - key.length) -
        Math.abs(foldOrgName(b.name).length - key.length)
    )[0];
  if (partial) {
    return { orgId: partial.id, orgName: partial.name || `#${partial.id}`, via: 'contains', auto: false };
  }
  return null;
}

/** Bump an alias's hit counter. Best-effort: a failed stat must never break
 *  the linking that just succeeded. */
export async function bumpReceiptAliasHits(aliasId: number, current: number): Promise<void> {
  try {
    await repo.update('receipt_merchant_alias', aliasId, { hits: (current ?? 0) + 1 });
  } catch {
    /* ignore */
  }
}

export type AutoLinkResult = {
  /** receipt id → what it was linked to. */
  linked: Map<number, OrgResolution>;
  /** Resolutions that need a human: containment guesses, keyed by receipt. */
  suggested: Map<number, OrgResolution>;
};

/**
 * Link every receipt we can be sure about, and collect the maybes.
 *
 * Only 'alias' and 'exact' hits are written. Receipts that already have an
 * org are left alone — re-deciding a link someone made by hand would be
 * both rude and lossy. Writes run sequentially: this is a handful of rows
 * behind a page load, and hammering Directus with parallel PATCHes to save
 * a few ms is not a trade worth making.
 */
export async function autoLinkReceiptOrgs(
  receipts: FinanceReceipt[],
  orgs: Pick<Organization, 'id' | 'name'>[],
  aliases: ReceiptMerchantAlias[]
): Promise<AutoLinkResult> {
  const linked = new Map<number, OrgResolution>();
  const suggested = new Map<number, OrgResolution>();

  for (const r of receipts) {
    if (receiptOrgId(r) !== null) continue;
    const hit = resolveMerchantOrg(r.merchant, orgs, aliases);
    if (!hit) continue;
    if (!hit.auto) {
      suggested.set(r.id, hit);
      continue;
    }
    try {
      await updateFinanceReceipt(r.id, { org_id: hit.orgId });
      linked.set(r.id, hit);
      if (hit.aliasId) {
        const alias = aliases.find((a) => a.id === hit.aliasId);
        await bumpReceiptAliasHits(hit.aliasId, alias?.hits ?? 0);
      }
    } catch {
      // A row that fails to link is not fatal — the UI still offers it
      // manually, and the next page load will try again.
    }
  }
  return { linked, suggested };
}

/** org_id comes back as a bare id or an expanded object depending on the
 *  query; callers should never have to care which. */
export function receiptOrgId(r: Pick<FinanceReceipt, 'org_id'>): number | null {
  const v = r.org_id;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    const id = (v as { id?: number }).id;
    return typeof id === 'number' ? id : null;
  }
  return null;
}

export function receiptOrgName(r: Pick<FinanceReceipt, 'org_id'>): string | null {
  const v = r.org_id;
  if (v && typeof v === 'object') return ((v as { name?: string }).name ?? null) || null;
  return null;
}

export function receiptProjectId(r: Pick<FinanceReceipt, 'project_id'>): number | null {
  const v = r.project_id;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    const id = (v as { id?: number }).id;
    return typeof id === 'number' ? id : null;
  }
  return null;
}

export function receiptProjectName(r: Pick<FinanceReceipt, 'project_id'>): string | null {
  const v = r.project_id;
  if (v && typeof v === 'object') return ((v as { name?: string }).name ?? null) || null;
  return null;
}

/**
 * Create an organization from a receipt and link it in one step.
 *
 * A receipt from a company that is not on file yet should not dead-end: the
 * merchant text is usually the best name we will ever have for it, and
 * typing it a second time into the orgs screen is pure friction. The alias
 * is written too, so OCR variants of the same name resolve without asking
 * again — `Kaffihús Naustabryggja 4` finds the org created from
 * `Naustabryggja`.
 */
export async function createOrgFromReceipt(
  name: string,
  receiptId: number
): Promise<{ org: Organization; alias: ReceiptMerchantAlias | null }> {
  const org = await createOrg({ name: name.trim() });
  await updateFinanceReceipt(receiptId, { org_id: org.id });
  let alias: ReceiptMerchantAlias | null = null;
  try {
    alias = await createReceiptMerchantAlias(name, org.id);
  } catch {
    // The org exists and the receipt is linked; a missing alias only costs
    // one more teach later, so it must not fail the whole action.
  }
  return { org, alias };
}

/**
 * Teach the mapping, then apply it everywhere it fits.
 *
 * The whole point of teaching is that you only do it once, so this also
 * sweeps the receipts already on screen — otherwise the user corrects
 * "Naustabryggja" and still sees five unlinked copies of it.
 */
export async function teachReceiptMerchantOrg(
  merchantText: string,
  orgId: number,
  receipts: FinanceReceipt[]
): Promise<{ alias: ReceiptMerchantAlias; appliedTo: number[] }> {
  const alias = await createReceiptMerchantAlias(merchantText, orgId);
  const key = foldOrgName(merchantText);
  const appliedTo: number[] = [];
  for (const r of receipts) {
    if (receiptOrgId(r) !== null) continue;
    const rk = foldOrgName(r.merchant);
    if (!rk || !(rk === key || rk.includes(key) || key.includes(rk))) continue;
    try {
      await updateFinanceReceipt(r.id, { org_id: orgId });
      appliedTo.push(r.id);
    } catch {
      /* keep going: one failure should not abandon the rest */
    }
  }
  if (appliedTo.length > 0) await bumpReceiptAliasHits(alias.id, appliedTo.length - 1);
  return { alias, appliedTo };
}

/**
 * Receipts attributed to one project or one organization.
 *
 * This is the read side of the org/project linking — without it the
 * attribution is write-only, visible nowhere except the review screen that
 * set it, which is a good way to make people stop bothering to tag things.
 */
export async function listReceiptsFor(
  target: { projectId?: number | null; orgId?: number | null },
  limit = 100
): Promise<FinanceReceipt[]> {
  const filters: Filter[] = [];
  if (target.projectId) filters.push({ field: 'project_id', op: 'eq', value: target.projectId });
  if (target.orgId) filters.push({ field: 'org_id', op: 'eq', value: target.orgId });
  // No filter would mean "every receipt ever", which is never what a card on
  // a project page wants.
  if (filters.length === 0) return [];
  return repo.list<FinanceReceipt>('finance_receipt', {
    fields: FINANCE_RECEIPT_FIELDS,
    where: filters.length === 1 ? filters[0] : { and: filters },
    sort: ['-txn_date', '-captured_at', '-id'],
    limit
  });
}

/**
 * Photos sitting in the Receipts folder with no `finance_receipt` row
 * pointing at them.
 *
 * These accumulate because deleting a receipt row deliberately leaves the
 * file — the photo is the evidence, and a mis-tap should not destroy it. The
 * cost of that choice is a slow leak in a flat directory where an orphan is
 * indistinguishable from a live receipt. This only COUNTS them: surfacing the
 * number keeps the leak honest, and deleting anything is a separate decision
 * that belongs to a human.
 */
export async function countOrphanReceiptFiles(): Promise<number> {
  const folder = await ensureReceiptsFolder();
  const [files, receipts] = await Promise.all([
    repo.listFiles<{ id: string }>({
      where: { field: 'folder', op: 'eq', value: folder },
      fields: ['id'],
      limit: -1
    }),
    repo.list<{ image?: string | null }>('finance_receipt', { fields: ['image'], limit: -1 })
  ]);
  const used = new Set(receipts.map((r) => r.image).filter(Boolean) as string[]);
  return files.filter((f) => !used.has(f.id)).length;
}

export type ReceiptTotals = {
  count: number;
  /** Sum of the receipts that have an amount. */
  total: number;
  /** How many are still missing one — the total is incomplete by this much. */
  missingAmount: number;
  /** Receipts not yet tied to a bank transaction. */
  unlinked: number;
  /** VAT across the receipts that have it — the reclaimable figure. */
  vsk: number;
};

export function receiptTotals(receipts: FinanceReceipt[]): ReceiptTotals {
  let total = 0;
  let missingAmount = 0;
  let unlinked = 0;
  let vsk = 0;
  for (const r of receipts) {
    if (typeof r.amount === 'number') total += Math.abs(r.amount);
    else missingAmount++;
    if (typeof r.vsk_amount === 'number') vsk += Math.abs(r.vsk_amount);
    if (!r.txn_id) unlinked++;
  }
  return { count: receipts.length, total, missingAmount, unlinked, vsk };
}

export type ReceiptMatch = { txn: FinanceTxn; dayGap: number; amountGap: number };

/** Amount tolerance in ISK, and date window in days, from the spec. */
export const RECEIPT_MATCH_AMOUNT_TOLERANCE = 5;
export const RECEIPT_MATCH_DAY_WINDOW = 4;

/**
 * Candidate transactions for a receipt, closest first.
 *
 * Conservative on purpose: this only ever *suggests*. Receipt amounts are
 * positive as printed while spending rows are negative, so matching compares
 * absolute values. A receipt missing both amount and date has nothing to
 * match on and returns nothing rather than the whole ledger.
 */
export async function findReceiptTxnCandidates(
  receipt: Pick<FinanceReceipt, 'amount' | 'txn_date' | 'captured_at'>,
  opts: { amountTolerance?: number; dayWindow?: number } = {}
): Promise<ReceiptMatch[]> {
  const tol = opts.amountTolerance ?? RECEIPT_MATCH_AMOUNT_TOLERANCE;
  const days = opts.dayWindow ?? RECEIPT_MATCH_DAY_WINDOW;
  const amount = receipt.amount ?? null;
  const anchor = receipt.txn_date || receipt.captured_at || null;
  if (amount === null && !anchor) return [];

  const anchorMs = anchor ? new Date(anchor).getTime() : null;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const from = anchorMs === null ? undefined : iso(anchorMs - days * 86400_000);
  const to = anchorMs === null ? undefined : iso(anchorMs + days * 86400_000);

  const txns = await listFinanceTxns({ from, to, limit: 500 });
  const out: ReceiptMatch[] = [];
  for (const txn of txns) {
    const txnAmount = Math.abs(txn.amount ?? 0);
    const amountGap = amount === null ? 0 : Math.abs(txnAmount - Math.abs(amount));
    if (amount !== null && amountGap > tol) continue;
    const dayGap =
      anchorMs === null || !txn.txn_date
        ? 0
        : Math.round(Math.abs(new Date(txn.txn_date).getTime() - anchorMs) / 86400_000);
    out.push({ txn, dayGap, amountGap });
  }
  // Nearest amount wins, then nearest date — an exact amount a day away is a
  // better bet than a 5 kr discrepancy on the same day.
  return out.sort((a, b) => a.amountGap - b.amountGap || a.dayGap - b.dayGap).slice(0, 8);
}

// AI brains — the AI vault — moved to $lib/data/aiVault.ts, re-exported at the end of
// this file. See docs/opening-up-twin.md.
// Prompt library — moved to $lib/data/promptLibrary.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
