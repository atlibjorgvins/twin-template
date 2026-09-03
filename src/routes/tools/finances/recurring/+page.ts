// Recurring / subscription finder — loads the year's transactions; detection
// runs client-side via detectRecurring().
import { listFinanceTxns, type FinanceTxn } from '$lib/directus';

export const ssr = false;

export type RecurringData = { txns: FinanceTxn[]; year: number };

export async function load(): Promise<RecurringData> {
  const year = new Date().getFullYear();
  const txns = await listFinanceTxns({ from: `${year}-01-01`, to: `${year}-12-31`, limit: 5000 }).catch(() => [] as FinanceTxn[]);
  return { txns, year };
}
