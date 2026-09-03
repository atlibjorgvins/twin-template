// Receipts review — the human-in-the-loop step between OCR and the ledger
// (docs/receipt-ocr-plan.md §Next). Nothing here trusts the OCR blindly:
// every parsed field is editable, and linking to a transaction is a
// deliberate click.
import {
  listFinanceReceipts,
  listReceiptMerchantAliases,
  listProjectsForTree,
  searchOrgs,
  type FinanceReceipt,
  type Organization,
  type Project,
  type ReceiptMerchantAlias
} from '$lib/directus';

export const ssr = false;

export type ReceiptsData = {
  receipts: FinanceReceipt[];
  orgs: Pick<Organization, 'id' | 'name'>[];
  projects: Pick<Project, 'id' | 'name'>[];
  aliases: ReceiptMerchantAlias[];
};

export async function load(): Promise<ReceiptsData> {
  // Orgs are fetched whole rather than searched per receipt: name matching
  // has to fold accents, which the API cannot do, so the comparison happens
  // client-side. A few thousand {id, name} pairs is a small payload and one
  // request instead of one per row.
  const [receipts, orgs, projects, aliases] = await Promise.all([
    listFinanceReceipts(300).catch(() => [] as FinanceReceipt[]),
    searchOrgs('', 5000).catch(() => [] as Organization[]),
    listProjectsForTree().catch(() => []),
    listReceiptMerchantAliases().catch(() => [] as ReceiptMerchantAlias[])
  ]);
  return {
    receipts,
    orgs: (orgs as Organization[]).map((o) => ({ id: o.id, name: o.name })),
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    aliases
  };
}
