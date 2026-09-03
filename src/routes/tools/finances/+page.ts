// Personal finances loader. Pulls the current year's transactions for the
// list, ALL shared transactions (so the ex balance is correct regardless of
// the date filter), settlements, rules, and the distinct account list.
import {
  listFinanceTxns,
  listFinanceSettlements,
  listFinanceRules,
  listFinanceAccounts,
  type FinanceTxn,
  type FinanceSettlement,
  type FinanceRule
} from '$lib/directus';

export const ssr = false;

export type FinanceData = {
  txns: FinanceTxn[];
  sharedTxns: FinanceTxn[];
  settlements: FinanceSettlement[];
  rules: FinanceRule[];
  accounts: string[];
  year: number;
  from: string;
  to: string;
};

export async function load(): Promise<FinanceData> {
  const year = new Date().getFullYear();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [txns, sharedTxns, settlements, rules, accounts] = await Promise.all([
    listFinanceTxns({ from, to, limit: 3000 }).catch(() => [] as FinanceTxn[]),
    listFinanceTxns({ sharedOnly: true, limit: 5000 }).catch(() => [] as FinanceTxn[]),
    listFinanceSettlements().catch(() => [] as FinanceSettlement[]),
    listFinanceRules().catch(() => [] as FinanceRule[]),
    listFinanceAccounts().catch(() => [] as string[])
  ]);
  return { txns, sharedTxns, settlements, rules, accounts, year, from, to };
}
