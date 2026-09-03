// Spending insights — loads the current year's transactions; all breakdowns
// are computed client-side from them.
import { listFinanceTxns, listFinanceBudgets, type FinanceTxn, type FinanceBudget } from '$lib/directus';

export const ssr = false;

export type InsightsData = { txns: FinanceTxn[]; budgets: FinanceBudget[]; year: number; from: string; to: string };

export async function load(): Promise<InsightsData> {
  const year = new Date().getFullYear();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [txns, budgets] = await Promise.all([
    listFinanceTxns({ from, to, limit: 5000 }).catch(() => [] as FinanceTxn[]),
    listFinanceBudgets().catch(() => [] as FinanceBudget[])
  ]);
  return { txns, budgets, year, from, to };
}
