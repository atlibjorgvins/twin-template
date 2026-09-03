<script lang="ts">
  // The facets a record COULD have but doesn't. Each absent facet used to
  // announce itself as a full empty card — "No education recorded", "No
  // grants recorded for this org yet" — and on a typical person page three
  // of those boxes stacked up saying nothing (Education and Languages have
  // zero rows in the entire database). Absence is now one row of chips;
  // the card itself appears when it has data, or when you ask for it here.
  let {
    facets,
    onopen
  }: {
    facets: Array<{ key: string; label: string; hidden: boolean }>;
    onopen: (key: string) => void;
  } = $props();

  const hidden = $derived(facets.filter((f) => f.hidden));
</script>

{#if hidden.length > 0}
  <div class="flex flex-wrap items-center gap-1.5 pt-1 text-xs" role="group" aria-label="Add a section">
    <span class="text-ink-400">Add</span>
    {#each hidden as f (f.key)}
      <button type="button" class="chip-radio" onclick={() => onopen(f.key)}>
        + {f.label}
      </button>
    {/each}
  </div>
{/if}
