// Personal finances
//
// Feature key `finances`. Zero dependencies of any kind on the rest of
// directus.ts — the cleanest leaf in the file.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module, so every existing
// `from '$lib/directus'` import keeps working.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';

// ── Personal finances ─────────────────────────────────────────────────────
// Transactions are imported from bank statements (insert-only dedup so a
// re-uploaded full year never duplicates) or entered manually. Shared
// expenses with the ex carry a split; financeExBalance() rolls them up.
export const FINANCE_CATEGORIES: { value: string; label: string; color: string }[] = [
  { value: 'groceries', label: 'Groceries', color: '#1E9B55' },
  { value: 'dining', label: 'Dining out', color: '#C6762A' },
  { value: 'transport', label: 'Transport', color: '#1D6BFE' },
  { value: 'fuel', label: 'Fuel', color: '#8A5A2B' },
  { value: 'utilities', label: 'Utilities', color: '#2C8C99' },
  { value: 'housing', label: 'Housing', color: '#6B5ADB' },
  { value: 'subscriptions', label: 'Subscriptions', color: '#9333EA' },
  { value: 'kids', label: 'Kids', color: '#E8590C' },
  { value: 'health', label: 'Health', color: '#C93B3B' },
  { value: 'shopping', label: 'Shopping', color: '#DB2777' },
  { value: 'entertainment', label: 'Entertainment', color: '#7C3AED' },
  { value: 'fees', label: 'Bank / Fees', color: '#64748B' },
  { value: 'loan', label: 'Loan', color: '#475569' },
  { value: 'income', label: 'Income', color: '#16A34A' },
  { value: 'transfer', label: 'Transfer', color: '#0EA5E9' },
  { value: 'other', label: 'Other', color: '#5F6B7A' }
];
export function financeCategoryLabel(v?: string | null): string {
  if (!v) return 'Uncategorized';
  return FINANCE_CATEGORIES.find((c) => c.value === v)?.label ?? v;
}
export function financeCategoryColor(v?: string | null): string {
  return FINANCE_CATEGORIES.find((c) => c.value === v)?.color ?? '#5F6B7A';
}

export type FinanceTxn = {
  id: number;
  txn_date?: string | null;
  amount?: number | null;
  description?: string | null;
  detail?: string | null;
  counterparty_kt?: string | null;
  balance?: number | null;
  category?: string | null;
  account?: string | null;
  source?: 'import' | 'manual' | 'recurring' | string | null;
  dedup_key?: string | null;
  shared?: boolean | null;
  paid_by?: 'me' | 'ex' | string | null;
  share_ex_pct?: number | null;
  recurring_group?: string | null;
  notes?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
};
export type FinanceTxnInput = Omit<FinanceTxn, 'id' | 'date_created' | 'date_updated'>;
export type FinanceSettlement = {
  id: number;
  settle_date?: string | null;
  amount?: number | null;
  direction?: 'ex_to_me' | 'me_to_ex' | string | null;
  notes?: string | null;
  date_created?: string | null;
};
export type FinanceRule = {
  id: number;
  match_text?: string | null;
  category?: string | null;
  sort?: number | null;
  date_created?: string | null;
};

const FINANCE_TXN_FIELDS = [
  'id', 'txn_date', 'amount', 'description', 'detail', 'counterparty_kt', 'balance',
  'category', 'account', 'source', 'dedup_key', 'shared', 'paid_by', 'share_ex_pct',
  'recurring_group', 'notes', 'date_created', 'date_updated'
] as const;

export async function listFinanceTxns(opts: {
  from?: string; to?: string; category?: string | null; q?: string;
  sharedOnly?: boolean; uncategorized?: boolean; account?: string | null;
  sort?: 'date' | 'amount_desc' | 'amount_asc'; limit?: number;
} = {}): Promise<FinanceTxn[]> {
  const { from, to, category = null, q = '', sharedOnly = false, uncategorized = false, account = null, sort = 'date', limit = 2000 } = opts;
  const filters: Filter[] = [];
  if (from) filters.push({ field: 'txn_date', op: 'gte', value: from });
  if (to) filters.push({ field: 'txn_date', op: 'lte', value: to });
  if (uncategorized)
    filters.push({ or: [{ field: 'category', op: 'null' }, { field: 'category', op: 'empty' }] });
  else if (category) filters.push({ field: 'category', op: 'eq', value: category });
  if (account) filters.push({ field: 'account', op: 'eq', value: account });
  if (sharedOnly) filters.push({ field: 'shared', op: 'eq', value: true });
  if (q.trim()) filters.push({ field: 'description', op: 'icontains', value: q.trim() });
  const where: Filter | undefined =
    filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { and: filters };
  const sortMap: Record<string, string[]> = {
    date: ['-txn_date', '-id'],
    amount_desc: ['-amount', '-id'],
    amount_asc: ['amount', '-id']
  };
  return await repo.list<FinanceTxn>('finance_txn', {
    fields: FINANCE_TXN_FIELDS,
    where,
    sort: sortMap[sort] ?? sortMap.date,
    limit
  });
}
export async function getFinanceTxn(id: number): Promise<FinanceTxn> {
  const txn = await repo.get<FinanceTxn>('finance_txn', id, { fields: FINANCE_TXN_FIELDS });
  if (!txn) throw new Error(`finance_txn ${id} not found`);
  return txn;
}
export async function createFinanceTxn(patch: FinanceTxnInput): Promise<FinanceTxn> {
  return repo.create<FinanceTxn>('finance_txn', patch as Record<string, unknown>);
}
export async function updateFinanceTxn(id: number, patch: Partial<FinanceTxn>): Promise<FinanceTxn> {
  return repo.update<FinanceTxn>('finance_txn', id, patch as Record<string, unknown>);
}
export async function deleteFinanceTxn(id: number): Promise<void> {
  await repo.remove('finance_txn', id);
}
/** Apply the same patch to many transactions at once (bulk category / split). */
export async function bulkUpdateFinanceTxns(ids: number[], patch: Partial<FinanceTxn>): Promise<void> {
  if (ids.length === 0) return;
  await repo.updateMany('finance_txn', ids, patch as Record<string, unknown>);
}
export async function listFinanceAccounts(): Promise<string[]> {
  const rows = await repo.list<{ account?: string | null }>('finance_txn', {
    fields: ['account'],
    limit: -1
  });
  return [...new Set(rows.map((r) => (r.account || '').trim()).filter(Boolean))].sort();
}

// Insert-only dedup: skip rows whose dedup_key already exists, so re-importing
// the full year never duplicates and never clobbers manual edits.
export async function importFinanceTxns(rows: FinanceTxnInput[]): Promise<{ imported: number; skipped: number }> {
  if (rows.length === 0) return { imported: 0, skipped: 0 };
  const accounts = [...new Set(rows.map((r) => r.account || '').filter(Boolean))];
  const existing = await repo.list<{ dedup_key?: string | null }>('finance_txn', {
    fields: ['dedup_key'],
    where: accounts.length ? { field: 'account', op: 'in', value: accounts } : undefined,
    limit: -1
  });
  const seen = new Set(existing.map((r) => r.dedup_key).filter(Boolean) as string[]);
  let imported = 0, skipped = 0;
  for (const row of rows) {
    if (row.dedup_key && seen.has(row.dedup_key)) { skipped++; continue; }
    await repo.create('finance_txn', row as Record<string, unknown>);
    if (row.dedup_key) seen.add(row.dedup_key); // guard against in-batch dupes
    imported++;
  }
  return { imported, skipped };
}
export async function deleteRecurringGroup(group: string): Promise<number> {
  const rows = await repo.list<{ id: number }>('finance_txn', {
    fields: ['id'],
    where: { field: 'recurring_group', op: 'eq', value: group },
    limit: -1
  });
  if (rows.length > 0) await repo.removeMany('finance_txn', rows.map((r) => r.id));
  return rows.length;
}

export async function listFinanceRules(): Promise<FinanceRule[]> {
  return repo.list<FinanceRule>('finance_rule', {
    fields: ['id', 'match_text', 'category', 'sort', 'date_created'],
    sort: ['sort', 'id'],
    limit: -1
  });
}
export async function createFinanceRule(patch: Partial<FinanceRule>): Promise<FinanceRule> {
  return repo.create<FinanceRule>('finance_rule', patch as Record<string, unknown>);
}
export async function deleteFinanceRule(id: number): Promise<void> {
  await repo.remove('finance_rule', id);
}
/** Run all rules over the given transactions and set categories on matches
 *  (bulk, grouped by category). Returns how many were updated. */
export async function applyRulesToTxns(txns: FinanceTxn[], rules: FinanceRule[]): Promise<number> {
  if (rules.length === 0) return 0;
  const byCat = new Map<string, number[]>();
  for (const t of txns) {
    const cat = applyFinanceRules(t.description, rules);
    if (cat) (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(t.id);
  }
  let updated = 0;
  for (const [cat, ids] of byCat) {
    await bulkUpdateFinanceTxns(ids, { category: cat });
    updated += ids.length;
  }
  return updated;
}

/** First rule whose match_text is a case-insensitive substring of `description`. */
export function applyFinanceRules(description: string | null | undefined, rules: FinanceRule[]): string | null {
  const d = (description || '').toLowerCase();
  if (!d) return null;
  for (const r of rules) {
    const m = (r.match_text || '').trim().toLowerCase();
    if (m && d.includes(m)) return r.category || null;
  }
  return null;
}

export type FinanceBudget = { id: number; category?: string | null; amount?: number | null };
export async function listFinanceBudgets(): Promise<FinanceBudget[]> {
  return repo.list<FinanceBudget>('finance_budget', {
    fields: ['id', 'category', 'amount'],
    limit: -1
  });
}
/** Upsert a monthly budget for a category; amount ≤ 0 removes it. */
export async function setFinanceBudget(category: string, amount: number): Promise<void> {
  const existing = await repo.list<{ id: number }>('finance_budget', {
    where: { field: 'category', op: 'eq', value: category },
    fields: ['id'],
    limit: 1
  });
  if (amount > 0) {
    if (existing[0]) await repo.update('finance_budget', existing[0].id, { amount });
    else await repo.create('finance_budget', { category, amount });
  } else if (existing[0]) {
    await repo.remove('finance_budget', existing[0].id);
  }
}

export async function listFinanceSettlements(): Promise<FinanceSettlement[]> {
  return repo.list<FinanceSettlement>('finance_settlement', {
    fields: ['id', 'settle_date', 'amount', 'direction', 'notes', 'date_created'],
    sort: ['-settle_date', '-id'],
    limit: -1
  });
}
export async function createFinanceSettlement(patch: Partial<FinanceSettlement>): Promise<FinanceSettlement> {
  return repo.create<FinanceSettlement>('finance_settlement', patch as Record<string, unknown>);
}
export async function deleteFinanceSettlement(id: number): Promise<void> {
  await repo.remove('finance_settlement', id);
}

/** Net ISK the ex owes me: shared txns' split contributions minus net settlements.
 *  paid_by 'me' → ex owes their share; paid_by 'ex' → I owe my share (reduces). */
export function financeExBalance(txns: FinanceTxn[], settlements: FinanceSettlement[]): number {
  let bal = 0;
  for (const t of txns) {
    if (!t.shared) continue;
    const amt = Math.abs(Number(t.amount) || 0);
    const exPct = (t.share_ex_pct ?? 50) / 100;
    bal += t.paid_by === 'ex' ? -amt * (1 - exPct) : amt * exPct;
  }
  for (const s of settlements) {
    const amt = Number(s.amount) || 0;
    bal += s.direction === 'ex_to_me' ? -amt : amt;
  }
  return Math.round(bal);
}

export type RecurringCharge = {
  merchant: string;
  cadence: 'weekly' | 'biweekly' | 'monthly';
  count: number;
  typical: number;   // median amount (ISK, positive)
  monthly: number;   // normalised monthly cost
  lastDate: string;
  category: string | null;
  ids: number[];
};
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Find repeating expense charges (same merchant, regular cadence) — the
 *  subscriptions / fixed costs. Sorted by normalised monthly cost. */
export function detectRecurring(txns: FinanceTxn[]): RecurringCharge[] {
  const byMerchant = new Map<string, FinanceTxn[]>();
  for (const t of txns) {
    if ((t.amount ?? 0) >= 0) continue; // expenses only
    const m = (t.description || '—').split(',')[0].trim() || '—';
    (byMerchant.get(m) ?? byMerchant.set(m, []).get(m)!).push(t);
  }
  const out: RecurringCharge[] = [];
  for (const [merchant, list] of byMerchant) {
    if (list.length < 3) continue;
    const sorted = list.slice().sort((a, b) => (a.txn_date ?? '') < (b.txn_date ?? '') ? -1 : 1);
    const days = sorted.map((t) => new Date(t.txn_date as string).getTime() / 86_400_000).filter((n) => !Number.isNaN(n));
    const gaps = days.slice(1).map((d, i) => d - days[i]).filter((x) => x > 0);
    if (gaps.length < 2) continue;
    const med = median(gaps);
    const consistent = gaps.filter((x) => Math.abs(x - med) <= Math.max(4, med * 0.4)).length / gaps.length;
    if (consistent < 0.5) continue;
    let cadence: RecurringCharge['cadence'] | null = null;
    if (med >= 5 && med <= 9) cadence = 'weekly';
    else if (med >= 11 && med <= 18) cadence = 'biweekly';
    else if (med >= 24 && med <= 38) cadence = 'monthly';
    if (!cadence) continue;
    const typical = median(sorted.map((t) => Math.abs(t.amount || 0)));
    const perMonth = cadence === 'weekly' ? typical * (365 / 7 / 12) : cadence === 'biweekly' ? typical * (365 / 14 / 12) : typical;
    const cat = sorted.map((t) => t.category).find(Boolean) ?? null;
    out.push({ merchant, cadence, count: sorted.length, typical: Math.round(typical), monthly: Math.round(perMonth), lastDate: sorted[sorted.length - 1].txn_date as string, category: cat, ids: sorted.map((t) => t.id) });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

export type FinanceExBreakdown = {
  net: number;            // ex owes me (positive) / I owe ex (negative)
  exOwesYou: number;      // ex's share of what I fronted
  youOweEx: number;       // my share of what ex fronted
  youFronted: number;     // total shared I paid
  exFronted: number;      // total shared ex paid
  sharedTotal: number;    // all shared spend (|amount|)
  settleExToMe: number;
  settleMeToEx: number;
  sharedCount: number;
  byCat: { key: string; label: string; shared: number; exShare: number; count: number }[];
};
/** Full ex-vs-me split breakdown (the numbers behind financeExBalance). */
export function financeExBreakdown(txns: FinanceTxn[], settlements: FinanceSettlement[]): FinanceExBreakdown {
  let exOwesYou = 0, youOweEx = 0, youFronted = 0, exFronted = 0, sharedTotal = 0, sharedCount = 0;
  const cats = new Map<string, { shared: number; exShare: number; count: number }>();
  for (const t of txns) {
    if (!t.shared) continue;
    sharedCount++;
    const amt = Math.abs(Number(t.amount) || 0);
    const exPct = (t.share_ex_pct ?? 50) / 100;
    sharedTotal += amt;
    let contrib: number;
    if (t.paid_by === 'ex') { exFronted += amt; youOweEx += amt * (1 - exPct); contrib = -amt * (1 - exPct); }
    else { youFronted += amt; exOwesYou += amt * exPct; contrib = amt * exPct; }
    const key = t.category || '__uncat__';
    const c = cats.get(key) ?? { shared: 0, exShare: 0, count: 0 };
    c.shared += amt; c.exShare += contrib; c.count++;
    cats.set(key, c);
  }
  let settleExToMe = 0, settleMeToEx = 0;
  for (const s of settlements) {
    const amt = Number(s.amount) || 0;
    if (s.direction === 'ex_to_me') settleExToMe += amt; else settleMeToEx += amt;
  }
  const r = (n: number) => Math.round(n);
  return {
    net: r(exOwesYou - youOweEx - settleExToMe + settleMeToEx),
    exOwesYou: r(exOwesYou), youOweEx: r(youOweEx), youFronted: r(youFronted), exFronted: r(exFronted),
    sharedTotal: r(sharedTotal), settleExToMe: r(settleExToMe), settleMeToEx: r(settleMeToEx), sharedCount,
    byCat: [...cats.entries()]
      .map(([key, v]) => ({ key, label: key === '__uncat__' ? 'Uncategorized' : financeCategoryLabel(key), shared: r(v.shared), exShare: r(v.exShare), count: v.count }))
      .sort((a, b) => b.shared - a.shared)
  };
}
