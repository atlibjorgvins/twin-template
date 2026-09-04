<script lang="ts">
  // "Save to" — destination vault for a record being created. Renders only
  // when there is an actual choice (two or more create-capable vaults);
  // single-vault devices never see it. The PARENT owns the default (usually
  // the vault bound to the record's scope) and the save routing
  // (createInVault); this is just the choice, presented consistently.
  import { creatableVaults } from '$lib/data/repo/crossVault';
  import { activeVault } from '$lib/data/repo/vaults';

  let {
    value = $bindable(activeVault().id),
    label = 'Save to'
  }: { value?: string; label?: string } = $props();

  const options = creatableVaults();
  const activeId = activeVault().id;
</script>

{#if options.length > 1}
  <label class="mt-3 block">
    <span class="mb-1 block text-xs text-ink-400">{label}</span>
    <select class="input w-full" bind:value>
      {#each options as v (v.id)}
        <option value={v.id}>{v.name}{v.id === activeId ? ' — current vault' : ''}</option>
      {/each}
    </select>
  </label>
{/if}
