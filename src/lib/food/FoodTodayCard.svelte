<script lang="ts">
  // "What am I eating today" on the front page.
  //
  // Renders nothing at all when nothing is ordered today *and* nothing is
  // ordered in the next few days — an empty card every day would be noise on a
  // page that is already dense. When today is empty but something is coming,
  // it shows the next meal instead, because that is the useful answer then.
  import Icon from '$lib/Icon.svelte';
  import { listFoodOrders, type FoodOrder } from '$lib/food/data';

  const MEAL_LABEL: Record<string, string> = {
    breakfast: 'Breakfast',
    lunch: 'Lunch',
    dinner: 'Dinner'
  };

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = iso(new Date());
  const horizon = iso(new Date(Date.now() + 7 * 86400000));

  let rows = $state<FoodOrder[]>([]);
  let loaded = $state(false);

  $effect(() => {
    void listFoodOrders(today, horizon)
      .then((r) => (rows = r))
      .catch(() => (rows = []))
      .finally(() => (loaded = true));
  });

  const todays = $derived(rows.filter((r) => r.order_date === today));
  const upcoming = $derived(rows.filter((r) => r.order_date > today));
  /** The next day that has anything, when today has nothing. */
  const nextDate = $derived(upcoming[0]?.order_date ?? null);
  const next = $derived(nextDate ? upcoming.filter((r) => r.order_date === nextDate) : []);
  const showing = $derived(todays.length > 0 ? todays : next);

  function dayLabel(iso8601: string): string {
    if (iso8601 === today) return 'today';
    const d = new Date(`${iso8601}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
</script>

{#if loaded && showing.length > 0}
  <div class="card">
    <div class="card-header">
      <span class="card-title">
        <Icon name="utensils" size={16} />
        {todays.length > 0 ? 'Lunch today' : `Next meal — ${dayLabel(showing[0].order_date)}`}
      </span>
      <a href="/tools/food" class="text-xs text-ink-400 hover:text-ink-700">Add</a>
    </div>
    <ul class="space-y-2 px-4 pb-4">
      {#each showing as row (row.id)}
        <li class="rounded-[10px] border border-surface-divider bg-surface-hover/40 px-3 py-2">
          <div class="flex items-baseline justify-between gap-3">
            <span class="min-w-0 truncate text-sm font-medium text-ink-900">{row.dish || '—'}</span>
            <span class="shrink-0 text-[11px] uppercase tracking-wide text-ink-400">
              {MEAL_LABEL[row.meal ?? 'lunch'] ?? ''}
            </span>
          </div>
          <div class="mt-0.5 flex flex-wrap items-center gap-2">
            {#if row.restaurant}<span class="text-xs text-ink-500">{row.restaurant}</span>{/if}
            {#each row.diet ?? [] as d (d)}
              <span class="rounded-full bg-tag-eventText/10 px-2 py-0.5 text-[10px] text-tag-eventText">{d}</span>
            {/each}
          </div>
        </li>
      {/each}
    </ul>
  </div>
{/if}
