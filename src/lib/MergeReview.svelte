<script lang="ts" generics="T extends { id: number }">
  // Generic merge-review dialog. Renders the records side-by-side as
  // columns; the user picks which row supplies the value for each
  // field. On Confirm we emit (winnerId, loserIds, patch) where
  // `patch` is the diff to apply to the winner before relations move.
  //
  // Decision model per field:
  //   - If only one record has a non-empty value → that value wins.
  //   - If two or more records have values that match → no conflict;
  //     winner keeps its value.
  //   - If values differ → we mark the field as a conflict and the
  //     user picks. Default selection is the winner's value (so
  //     "Confirm" without touching anything == the old behaviour).
  //
  // Empty detection: null, undefined, '' (trimmed), 0 is *not* empty
  // (real numeric values matter). Booleans aren't merge-resolved here;
  // they fall through to the winner.
  import { untrack } from 'svelte';
  import Icon from '$lib/Icon.svelte';

  export type MergeField<X> = {
    key: keyof X & string;
    label: string;
    /** Optional rendering hook for the value display cell. */
    format?: (v: unknown) => string;
  };

  type Props = {
    records: T[];                // index 0 = current winner by default
    fields: MergeField<T>[];
    /** Title above the dialog body. */
    title?: string;
    /** Loaded display label per record (e.g. "Magnús Ingi Óskarsson"). */
    labelOf: (r: T) => string;
    open: boolean;
    busy?: boolean;
    /** Surfaced inside the dialog footer so a failed merge isn't
     *  invisible behind the modal. */
    error?: string;
    onCancel: () => void;
    onConfirm: (winnerId: number, loserIds: number[], patch: Partial<T>) => void | Promise<void>;
  };
  let {
    records,
    fields,
    title = 'Merge',
    labelOf,
    open,
    busy = false,
    error = '',
    onCancel,
    onConfirm
  }: Props = $props();

  // Winner — defaults to first record. The user can flip to any other
  // column by clicking its header.
  let winnerId = $state<number>(records[0]?.id ?? -1);
  // Per-field selection: which record's value to use. Keyed by field name.
  let selectedFrom = $state<Record<string, number>>({});

  function init() {
    winnerId = records[0]?.id ?? -1;
    selectedFrom = {};
    for (const f of fields) {
      // Auto-resolve: if winner is empty and exactly one other record
      // has a value, take that. Otherwise default to winner.
      const winner = records.find((r) => r.id === winnerId);
      if (!winner) continue;
      const wv = (winner as Record<string, unknown>)[f.key];
      if (!isEmpty(wv)) { selectedFrom[f.key] = winnerId; continue; }
      const candidates = records.filter((r) => r.id !== winnerId && !isEmpty((r as Record<string, unknown>)[f.key]));
      if (candidates.length >= 1) {
        // Take the first non-empty loser's value. If multiple losers
        // have differing values, user can flip manually.
        selectedFrom[f.key] = candidates[0].id;
      } else {
        selectedFrom[f.key] = winnerId;
      }
    }
  }

  // Re-init when records change OR when the dialog opens fresh.
  // untrack is load-bearing: init() reassigns `selectedFrom` (a fresh
  // object every run) and reads `winnerId`, both of which the effect
  // would otherwise register as dependencies — each run invalidates
  // itself and the effect loops until Svelte kills it
  // (effect_update_depth_exceeded), leaving the dialog frozen.
  $effect(() => {
    void records;
    if (open) untrack(init);
  });

  function isEmpty(v: unknown): boolean {
    if (v == null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    // 0, false, real objects all count as not-empty.
    return false;
  }

  function valueOf(r: T, k: string): unknown {
    return (r as Record<string, unknown>)[k];
  }
  function display(r: T, f: MergeField<T>): string {
    const v = valueOf(r, f.key);
    if (isEmpty(v)) return '—';
    if (f.format) return f.format(v);
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  function valuesMatch(values: unknown[]): boolean {
    // Compare via JSON stringification — fine for primitive fields.
    const non = values.filter((v) => !isEmpty(v));
    if (non.length <= 1) return true;
    const ref = JSON.stringify(non[0]);
    return non.every((v) => JSON.stringify(v) === ref);
  }

  type FieldState = {
    f: MergeField<T>;
    values: unknown[];          // values per record, parallel to records[]
    allEmpty: boolean;
    hasConflict: boolean;       // ≥2 distinct non-empty values
    chosenId: number;
    chosenValue: unknown;
  };

  const fieldStates: FieldState[] = $derived.by(() => {
    return fields.map((f) => {
      const values = records.map((r) => valueOf(r, f.key));
      const non = values.filter((v) => !isEmpty(v));
      const allEmpty = non.length === 0;
      const hasConflict = non.length >= 2 && !valuesMatch(values);
      const chosenId = selectedFrom[f.key] ?? winnerId;
      const chosenRec = records.find((r) => r.id === chosenId);
      const chosenValue = chosenRec ? valueOf(chosenRec, f.key) : undefined;
      return { f, values, allEmpty, hasConflict, chosenId, chosenValue };
    });
  });

  /** What we'll actually patch onto the winner: any field where the
   *  chosen value differs from the winner's current value. */
  const patch: Partial<T> = $derived.by(() => {
    const winner = records.find((r) => r.id === winnerId);
    if (!winner) return {} as Partial<T>;
    const out: Record<string, unknown> = {};
    for (const s of fieldStates) {
      const winnerVal = valueOf(winner, s.f.key);
      const chosenVal = s.chosenValue;
      // Skip if values are equivalent (don't churn the row needlessly).
      if (JSON.stringify(winnerVal ?? null) === JSON.stringify(chosenVal ?? null)) continue;
      // Skip writing nulls if winner already has a value the user didn't
      // explicitly opt to clear — preserves data.
      if (isEmpty(chosenVal) && !isEmpty(winnerVal)) continue;
      out[s.f.key] = chosenVal ?? null;
    }
    return out as Partial<T>;
  });

  const conflictCount = $derived(fieldStates.filter((s) => s.hasConflict).length);
  const fillCount = $derived(Object.keys(patch).length);

  function setWinner(id: number) {
    winnerId = id;
    // Re-anchor empty-fill defaults around the new winner.
    init();
  }
  function setFieldSource(fieldKey: string, recordId: number) {
    selectedFrom = { ...selectedFrom, [fieldKey]: recordId };
  }

  async function confirm() {
    const winner = records.find((r) => r.id === winnerId);
    if (!winner) return;
    const losers = records.filter((r) => r.id !== winnerId).map((r) => r.id);
    await onConfirm(winnerId, losers, patch);
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4"
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div
      class="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-xl bg-surface-card shadow-card sm:rounded-xl"
      onclick={(e) => e.stopPropagation()}
      role="presentation"
    >
      <header class="flex items-center justify-between gap-3 border-b border-surface-divider px-4 py-3">
        <h2 class="font-display text-lg font-semibold text-ink-900" style="letter-spacing: -0.01em;">{title}</h2>
        <div class="flex items-center gap-2 text-xs text-ink-400">
          {#if conflictCount > 0}<span class="rounded-full bg-tag-sales/20 px-2 py-0.5 text-tag-salesText">{conflictCount} conflict{conflictCount === 1 ? '' : 's'}</span>{/if}
          {#if fillCount > 0}<span class="rounded-full bg-surface-hover px-2 py-0.5">{fillCount} change{fillCount === 1 ? '' : 's'} to winner</span>{/if}
          <button class="text-ink-300 hover:text-ink-700" onclick={onCancel} aria-label="Cancel" disabled={busy}>
            <Icon name="x" size={18} />
          </button>
        </div>
      </header>

      <div class="border-b border-surface-divider bg-surface-hover/50 px-4 py-1.5 text-xs text-ink-400">
        Click a column header to switch the winner · click any value to choose what's kept — mix freely between the two.
      </div>

      <!-- Column headers — radio per record so the user picks the
           winner. -->
      <div class="grid border-b border-surface-divider" style:grid-template-columns={`12rem repeat(${records.length}, minmax(0, 1fr))`}>
        <div class="border-r border-surface-divider px-3 py-2 text-[10px] uppercase tracking-wider text-ink-400">Field</div>
        {#each records as r (r.id)}
          {@const isWinner = r.id === winnerId}
          <button
            type="button"
            class="flex flex-col gap-0.5 border-r border-surface-divider px-3 py-2 text-left text-sm transition last:border-r-0 hover:bg-surface-hover"
            class:bg-brand={false}
            style:background-color={isWinner ? 'rgba(44,140,153,0.10)' : 'transparent'}
            onclick={() => setWinner(r.id)}
            disabled={busy}
            aria-pressed={isWinner}
          >
            <span class="flex items-center gap-1.5">
              <span
                class="inline-block h-3 w-3 rounded-full border-2"
                style:border-color={isWinner ? 'var(--brand, #2C8C99)' : 'var(--surface-border)'}
                style:background-color={isWinner ? 'var(--brand, #2C8C99)' : 'transparent'}
              ></span>
              <span class="truncate font-medium text-ink-900">{labelOf(r)}</span>
            </span>
            <span class="text-[10px] uppercase tracking-wider text-ink-400">
              {isWinner ? 'Winner — keeps the id' : 'Loser — archived after merge'}
            </span>
          </button>
        {/each}
      </div>

      <!-- Field rows -->
      <div class="flex-1 overflow-y-auto">
        {#each fieldStates as s (s.f.key)}
          {#if !s.allEmpty}
            <div
              class="grid border-b border-surface-divider last:border-b-0"
              style:grid-template-columns={`12rem repeat(${records.length}, minmax(0, 1fr))`}
            >
              <div class="border-r border-surface-divider px-3 py-2">
                <div class="text-xs font-medium text-ink-700">{s.f.label}</div>
                {#if s.hasConflict}
                  <div class="mt-0.5 text-[10px] uppercase tracking-wider text-tag-salesText">Conflict</div>
                {/if}
              </div>
              {#each records as r, i (r.id)}
                {@const empty = isEmpty(s.values[i])}
                {@const isChosen = s.chosenId === r.id}
                <button
                  type="button"
                  class="group relative border-r border-surface-divider px-3 py-2 text-left text-sm transition last:border-r-0 hover:bg-surface-hover"
                  style:background-color={isChosen && !empty ? 'rgba(44,140,153,0.08)' : 'transparent'}
                  onclick={() => { if (!empty) setFieldSource(s.f.key, r.id); }}
                  disabled={busy || empty}
                  aria-pressed={isChosen}
                  title={empty ? 'No value on this record' : 'Use this value'}
                >
                  {#if empty}
                    <span class="text-ink-400">—</span>
                  {:else}
                    <span class="text-ink-900">{display(r, s.f)}</span>
                  {/if}
                  {#if isChosen && !empty}
                    <span class="absolute right-1.5 top-1.5 text-brand">
                      <Icon name="check" size={12} />
                    </span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        {/each}
      </div>

      {#if error}
        <div class="border-t border-surface-divider bg-tag-sales/10 px-4 py-2 text-xs text-tag-salesText">{error}</div>
      {/if}

      <footer class="flex items-center justify-end gap-2 border-t border-surface-divider px-4 py-3">
        <button class="btn-ghost" onclick={onCancel} disabled={busy}>Cancel</button>
        <button class="btn-primary" onclick={confirm} disabled={busy}>
          {busy ? 'Merging…' : `Merge into "${labelOf(records.find((r) => r.id === winnerId) ?? records[0])}"`}
        </button>
      </footer>
    </div>
  </div>
{/if}
