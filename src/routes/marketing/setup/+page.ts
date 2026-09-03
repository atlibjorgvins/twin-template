import { listMkAdAccounts, type MkAdAccount } from '$lib/directus';
import { listMediums } from '$lib/marketing/data';
import type { Medium } from '$lib/marketing/media';

export const ssr = false;

export const load = async () => {
  try {
    const [accounts, mediums] = await Promise.all([
      listMkAdAccounts(),
      listMediums().catch(() => [] as Medium[])
    ]);
    return { accounts, mediums, error: null as string | null };
  } catch (e) {
    return {
      accounts: [] as MkAdAccount[],
      mediums: [] as Medium[],
      error: e instanceof Error ? e.message : String(e)
    };
  }
};
