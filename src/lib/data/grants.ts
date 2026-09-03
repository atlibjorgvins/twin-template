// Grants — programmes, awards and payout schedules
//
// Feature key `grants`. Reads three grant types declared in directus.ts and
// calls nothing defined there.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module, so every existing
// `from '$lib/directus'` import keeps working.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
// Type-only: erased at compile time, so no runtime cycle back into
// the module this was split out of.
import type { Grant, GrantAward, GrantAwardPayment } from '$lib/data/types';

// ── Grants ──────────────────────────────────────────────────────────────
// Grant = programme catalogue. GrantAward = each instance of an award.
// GrantAwardPayment = staged payouts (Rannís TÞS pays year-1 / year-2 /
// year-3 over the life of an award).

export async function listGrants(opts?: { includeArchived?: boolean }): Promise<Grant[]> {
  return await repo.list<Grant>('Grant', {
    where: opts?.includeArchived ? undefined : { field: 'status', op: 'neq', value: 'archived' },
    fields: ['*', { funder_org_id: ['id', 'name'] }],
    sort: ['name']
  });
}

export async function getGrant(id: number): Promise<Grant> {
  const g = await repo.get<Grant>('Grant', id, {
    fields: ['*', { funder_org_id: ['id', 'name', 'website'] }]
  });
  if (!g) throw new Error(`Grant ${id} not found`);
  return g;
}

export async function createGrant(patch: Partial<Grant> & { name: string }): Promise<Grant> {
  return await repo.create<Grant>('Grant', { status: 'published', ...patch } as Record<string, unknown>);
}
export async function updateGrant(id: number, patch: Partial<Grant>): Promise<Grant> {
  return await repo.update<Grant>('Grant', id, patch as Record<string, unknown>);
}

export async function listGrantAwards(opts?: {
  grantId?: number;
  orgId?: number;
  /** Match any of these org ids (used by the project roll-up so we
   *  fetch every cohort member's grants in a single round-trip). */
  orgIds?: number[];
  projectId?: number;
  includeArchived?: boolean;
}): Promise<GrantAward[]> {
  // orgIds = [] is "no orgs at all" — return nothing rather than
  // unfiltered everything, which would be misleading.
  if (opts?.orgIds && opts.orgIds.length === 0) return [];
  const ands: Filter[] = [];
  if (!opts?.includeArchived) ands.push({ field: 'status', op: 'neq', value: 'archived' });
  if (opts?.grantId)   ands.push({ field: 'grant_id', op: 'eq', value: opts.grantId });
  if (opts?.orgId)     ands.push({ field: 'organization_id', op: 'eq', value: opts.orgId });
  if (opts?.orgIds)    ands.push({ field: 'organization_id', op: 'in', value: opts.orgIds });
  if (opts?.projectId) ands.push({ field: 'project_id', op: 'eq', value: opts.projectId });
  return await repo.list<GrantAward>('GrantAward', {
    fields: [
        '*',
        { grant_id: ['id', 'name', 'short_name', 'color', { funder_org_id: ['id', 'name'] }] },
        { organization_id: ['id', 'name', 'logo', 'image_focal'] },
        { project_id: ['id', 'name'] },
        { domain_id: ['id', 'name', 'color'] },
        { subdomain_id: ['id', 'name'] },
        { contact_person_id: ['id', 'full_name', 'first_name', 'last_name'] },
        { contact_org_id: ['id', 'name'] }
    ],
    where: ands.length === 0 ? undefined : ands.length === 1 ? ands[0] : { and: ands },
    sort: ['-awarded_year', '-award_date']
  });
}

/** Single GrantAward with relations expanded for the award detail page. */
export async function getGrantAward(id: number): Promise<GrantAward> {
  const a = await repo.get<GrantAward>('GrantAward', id, {
    fields: [
        '*',
        { grant_id: ['id', 'name', 'short_name', 'color', 'category', { funder_org_id: ['id', 'name', 'logo'] }] },
        { organization_id: ['id', 'name', 'logo', 'image_focal', 'website', 'industry', 'region'] },
        { project_id: ['id', 'name', 'kind'] },
        { domain_id: ['id', 'name', 'color'] },
        { subdomain_id: ['id', 'name'] },
        { contact_person_id: ['id', 'full_name', 'first_name', 'last_name', 'email', 'phone'] },
        { contact_org_id: ['id', 'name', 'logo', 'image_focal'] }
    ]
  });
  if (!a) throw new Error(`GrantAward ${id} not found`);
  return a;
}

export async function createGrantAward(patch: Partial<GrantAward> & { grant_id: number; organization_id?: number | null }): Promise<GrantAward> {
  return await repo.create<GrantAward>('GrantAward', { status: 'published', award_status: 'awarded', ...patch } as Record<string, unknown>);
}
export async function updateGrantAward(id: number, patch: Partial<GrantAward>): Promise<GrantAward> {
  return await repo.update<GrantAward>('GrantAward', id, patch as Record<string, unknown>);
}
export async function removeGrantAward(id: number): Promise<void> {
  await repo.update('GrantAward', id, { status: 'archived' });
}

export async function listGrantAwardPayments(awardId: number): Promise<GrantAwardPayment[]> {
  return await repo.list<GrantAwardPayment>('GrantAwardPayment', {
    where: { and: [
      { field: 'status', op: 'neq', value: 'archived' },
      { field: 'award_id', op: 'eq', value: awardId }
    ] },
    fields: ['*'],
    sort: ['installment_index', 'planned_date']
  });
}

export async function createGrantAwardPayment(patch: Partial<GrantAwardPayment> & { award_id: number }): Promise<GrantAwardPayment> {
  return await repo.create<GrantAwardPayment>('GrantAwardPayment', { status: 'published', payment_status: 'planned', ...patch } as Record<string, unknown>);
}
export async function updateGrantAwardPayment(id: number, patch: Partial<GrantAwardPayment>): Promise<GrantAwardPayment> {
  return await repo.update<GrantAwardPayment>('GrantAwardPayment', id, patch as Record<string, unknown>);
}
export async function removeGrantAwardPayment(id: number): Promise<void> {
  await repo.update('GrantAwardPayment', id, { status: 'archived' });
}

/** Format a grant amount with the right thousand-separator + currency
 *  suffix. ISK uses no decimals; EUR/USD/GBP use two. */
export function formatGrantAmount(amount: number | string | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '';
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return '';
  const cur = (currency || 'ISK').toUpperCase();
  const fmt = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: cur === 'ISK' ? 0 : 2,
    maximumFractionDigits: cur === 'ISK' ? 0 : 2
  });
  return `${fmt.format(n)} ${cur}`;
}
