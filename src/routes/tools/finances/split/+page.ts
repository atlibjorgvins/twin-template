// Ex-vs-me split dashboard. Loads every shared transaction (all-time, so the
// balance is complete regardless of date) plus settlements — nothing else.
import {
  listFinanceTxns,
  listFinanceSettlements,
  type FinanceTxn,
  type FinanceSettlement
} from '$lib/directus';

export const ssr = false;

export type SplitData = {
  sharedTxns: FinanceTxn[];
  settlements: FinanceSettlement[];
};

export async function load(): Promise<SplitData> {
  const [sharedTxns, settlements] = await Promise.all([
    listFinanceTxns({ sharedOnly: true, limit: 5000 }).catch(() => [] as FinanceTxn[]),
    listFinanceSettlements().catch(() => [] as FinanceSettlement[])
  ]);
  return { sharedTxns, settlements };
}
