// Budget envelopes: what an amount covers, and how much of it is gone.
//
// NO $lib imports (see media.ts). Pure arithmetic over rows data.ts loaded.
//
// The one rule here: an envelope only ever claims spend it actually covers.
// A project envelope with `includeDescendants` counts the cohorts; without it,
// only its own row. A medium-narrowed envelope counts one medium. Spend that
// no envelope covers is not silently absorbed by the nearest one — it shows up
// as unbudgeted, which is the number that tells you the budget is wrong.
import type { SpendRow } from './metrics.ts';

export type BudgetScope = 'project' | 'campaign' | 'medium';
export type BudgetState = 'draft' | 'approved' | 'closed';
export type BudgetPeriod = 'total' | 'year' | 'month';

export type Budget = {
  id: number;
  label: string | null;
  scope: BudgetScope | string;
  status: BudgetState | string;
  projectId: number | null;
  includeDescendants: boolean;
  campaignId: number | null;
  medium: string | null;
  period: BudgetPeriod | string;
  /** First day of the period. Null with period = total means unbounded. */
  periodStart: string | null;
  amount: number;
  currency: string;
  /** Booked but not yet spent — signed insertion orders, unbilled contracts. */
  committed: number;
};

/** Draft envelopes are excluded everywhere: a number someone is still
 *  arguing about must not move a dashboard. Closed ones stay, so last
 *  year's budget still reports. */
export function activeBudgets(budgets: Budget[]): Budget[] {
  return budgets.filter((b) => b.status !== 'draft');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Inclusive date bounds the envelope covers. Null on either side = open. */
export function budgetBounds(b: Budget): { since: string | null; until: string | null } {
  if (b.period === 'total' || !b.periodStart) return { since: b.periodStart ?? null, until: null };
  const [y, m] = b.periodStart.split('-').map(Number);
  if (!Number.isFinite(y)) return { since: null, until: null };
  if (b.period === 'year') return { since: `${y}-01-01`, until: `${y}-12-31` };
  if (b.period === 'month') {
    const month = Number.isFinite(m) && m >= 1 && m <= 12 ? m : 1;
    // Day 0 of the next month is the last day of this one, leap years included.
    const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
    return { since: `${y}-${pad(month)}-01`, until: `${y}-${pad(month)}-${pad(last)}` };
  }
  return { since: b.periodStart, until: null };
}

function withinBounds(date: string, bounds: { since: string | null; until: string | null }): boolean {
  if (bounds.since && date < bounds.since) return false;
  if (bounds.until && date > bounds.until) return false;
  return true;
}

/** Does this envelope cover this spend row? `descendants` is the resolved
 *  project set for a project-scoped envelope (see descendantIds in metrics). */
export function budgetCovers(b: Budget, row: SpendRow, descendants: Set<number> | null): boolean {
  if (!withinBounds(row.date, budgetBounds(b))) return false;
  // A medium narrows any scope, not just scope = medium.
  if (b.medium && row.medium !== b.medium) return false;

  if (b.scope === 'campaign') return b.campaignId != null && row.campaignId === b.campaignId;
  if (b.scope === 'medium') return b.medium != null; // the medium check above did the work
  // scope = project
  if (b.projectId == null) return false;
  if (row.projectId == null) return false;
  return b.includeDescendants && descendants ? descendants.has(row.projectId) : row.projectId === b.projectId;
}

export type BudgetStatus = {
  budget: Budget;
  spent: number;
  committed: number;
  /** amount − spent − committed. Negative means over. */
  remaining: number;
  /** (spent + committed) / amount, 0 when the envelope is 0 — not Infinity,
   *  which a progress bar renders as a full bar and a reader as "fine". */
  usedShare: number;
  over: boolean;
  /** Rows this envelope claimed, for a drill-in. */
  rows: SpendRow[];
};

export function budgetStatus(
  b: Budget,
  rows: SpendRow[],
  descendantsFor: (projectId: number) => Set<number>
): BudgetStatus {
  const descendants = b.scope === 'project' && b.projectId != null ? descendantsFor(b.projectId) : null;
  const claimed = rows.filter((r) => budgetCovers(b, r, descendants));
  const spent = claimed.reduce((s, r) => s + r.amount, 0);
  const committed = b.committed ?? 0;
  const remaining = b.amount - spent - committed;
  return {
    budget: b,
    spent,
    committed,
    remaining,
    usedShare: b.amount > 0 ? (spent + committed) / b.amount : 0,
    over: remaining < 0,
    rows: claimed
  };
}

export function budgetStatuses(
  budgets: Budget[],
  rows: SpendRow[],
  descendantsFor: (projectId: number) => Set<number>
): BudgetStatus[] {
  return activeBudgets(budgets)
    .map((b) => budgetStatus(b, rows, descendantsFor))
    .sort((a, b) => b.spent - a.spent);
}

/** Spend no active envelope covers. The honest counterpart to a budget
 *  page: without it, an under-budgeted account looks like a healthy one. */
export function unbudgetedSpend(
  budgets: Budget[],
  rows: SpendRow[],
  descendantsFor: (projectId: number) => Set<number>
): { spend: number; share: number; rows: SpendRow[] } {
  const active = activeBudgets(budgets);
  const cache = new Map<number, Set<number>>();
  const descendants = (b: Budget) => {
    if (b.scope !== 'project' || b.projectId == null) return null;
    if (!cache.has(b.projectId)) cache.set(b.projectId, descendantsFor(b.projectId));
    return cache.get(b.projectId)!;
  };
  const loose = rows.filter((r) => !active.some((b) => budgetCovers(b, r, descendants(b))));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const spend = loose.reduce((s, r) => s + r.amount, 0);
  return { spend, share: total > 0 ? spend / total : 0, rows: loose };
}
