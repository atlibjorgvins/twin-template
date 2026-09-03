// Single transaction detail.
import { error } from '@sveltejs/kit';
import { getFinanceTxn, type FinanceTxn } from '$lib/directus';

export const ssr = false;

export async function load({ params }): Promise<{ txn: FinanceTxn }> {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Not found');
  try {
    const txn = await getFinanceTxn(id);
    if (!txn) throw error(404, 'Transaction not found');
    return { txn };
  } catch (e) {
    if ((e as { status?: number })?.status === 404) throw e;
    throw error(404, 'Transaction not found');
  }
}
