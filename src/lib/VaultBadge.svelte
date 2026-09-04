<script lang="ts">
  // A small pill naming the vault a row lives in — shown on FOREIGN rows in
  // the unified "All vaults" list (the 1Password model: one list, each item
  // wears its vault). The active vault's own rows carry no badge; only the
  // ones from elsewhere need placing.
  let { name }: { name: string } = $props();
</script>

<span
  class="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
  style="background: var(--accent-alpha-10); color: var(--accent-electric);"
  title={`Lives in the “${name}” vault`}
>
  {name}
</span>
