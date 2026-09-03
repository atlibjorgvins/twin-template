// food_order reads/writes. Kept out of the already-huge directus.ts, same as
// events/data.ts and photos/explore.ts.
//
// `food_order` is not in the generated Schema type, so the collection name
// takes `as never` and the returns `as unknown as Promise<T>` — the pattern
// used throughout this codebase for collections added by a scripts/add-*.sh.
import { repo } from '$lib/data/repo';
import type { MealKey } from './parseFoodOrder';

export type FoodOrder = {
  id: number;
  order_date: string;
  meal: MealKey | null;
  restaurant: string | null;
  dish: string | null;
  diet: string[] | null;
  notes: string | null;
  source_image: string | null;
  ocr_confidence: number | null;
  date_created?: string | null;
};

export type FoodOrderDraft = Omit<FoodOrder, 'id' | 'date_created'>;

const FIELDS = [
  'id',
  'order_date',
  'meal',
  'restaurant',
  'dish',
  'diet',
  'notes',
  'source_image',
  'ocr_confidence'
];

const MEAL_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2 };

/** Stable within-day ordering: breakfast, then lunch, then dinner. */
function byMeal(a: FoodOrder, b: FoodOrder): number {
  return (MEAL_ORDER[a.meal ?? 'lunch'] ?? 1) - (MEAL_ORDER[b.meal ?? 'lunch'] ?? 1);
}

export async function listFoodOrders(fromDate: string, toDate: string): Promise<FoodOrder[]> {
  const rows = await repo.list<FoodOrder>('food_order', {
    where: {
      and: [
        { field: 'order_date', op: 'gte', value: fromDate },
        { field: 'order_date', op: 'lte', value: toDate }
      ]
    },
    fields: FIELDS,
    sort: ['order_date']
  });
  return rows.sort((a, b) => a.order_date.localeCompare(b.order_date) || byMeal(a, b));
}

/** Everything ordered for one day — what the front-page card shows. */
export async function foodOrdersOn(date: string): Promise<FoodOrder[]> {
  return listFoodOrders(date, date);
}

export async function createFoodOrder(patch: Partial<FoodOrderDraft>): Promise<FoodOrder> {
  return repo.create<FoodOrder>('food_order', patch as Record<string, unknown>);
}

export async function updateFoodOrder(id: number, patch: Partial<FoodOrderDraft>): Promise<FoodOrder> {
  return repo.update<FoodOrder>('food_order', id, patch as Record<string, unknown>);
}

export async function deleteFoodOrder(id: number): Promise<void> {
  await repo.remove('food_order', id);
}

/**
 * Write a parsed screenshot back, treating (order_date, meal, restaurant) as
 * the identity of a row: re-uploading the same screenshot after fixing a typo
 * should correct the existing day, not add a second lunch to it.
 */
export async function saveFoodOrders(
  drafts: FoodOrderDraft[]
): Promise<{ created: number; updated: number }> {
  if (drafts.length === 0) return { created: 0, updated: 0 };
  const dates = drafts.map((d) => d.order_date).sort();
  const existing = await listFoodOrders(dates[0], dates[dates.length - 1]);

  const keyOf = (d: { order_date: string; meal: MealKey | null; restaurant: string | null }) =>
    `${d.order_date}|${d.meal ?? 'lunch'}|${(d.restaurant ?? '').trim().toLowerCase()}`;
  const have = new Map(existing.map((r) => [keyOf(r), r]));

  let created = 0;
  let updated = 0;
  for (const d of drafts) {
    const match = have.get(keyOf(d));
    if (match) {
      await updateFoodOrder(match.id, d);
      updated++;
    } else {
      await createFoodOrder(d);
      created++;
    }
  }
  return { created, updated };
}
