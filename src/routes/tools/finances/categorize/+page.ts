// Categorize workflow — loads uncategorized transactions grouped by merchant
// so they can be tagged fast (and turned into rules for future imports).
import { listFinanceTxns, listFinanceRules, type FinanceTxn, type FinanceRule } from '$lib/directus';

export const ssr = false;

export type CategorizeData = { uncategorized: FinanceTxn[]; rules: FinanceRule[] };

export async function load(): Promise<CategorizeData> {
  const [uncategorized, rules] = await Promise.all([
    listFinanceTxns({ uncategorized: true, limit: 5000 }).catch(() => [] as FinanceTxn[]),
    listFinanceRules().catch(() => [] as FinanceRule[])
  ]);
  return { uncategorized, rules };
}
