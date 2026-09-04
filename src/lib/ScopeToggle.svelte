<script lang="ts">
  import { scope, type Scope } from '$lib/scope';
  import { vaultForScope, activeVault } from '$lib/data/repo/vaults';
  import { switchVault } from '$lib/vaultSwitch';

  const opts: { value: Scope; label: string; title: string }[] = [
    { value: 'all', label: 'All', title: 'Work + Private' },
    { value: 'work', label: 'Work', title: 'Work contacts only' },
    { value: 'private', label: 'Private', title: 'Private contacts only' }
  ];

  // A side of the toggle can be BOUND to a vault (Settings → Vaults): clicking
  // Work then doesn't just filter — it OPENS the work vault. The scope value
  // is written first so the destination loads already filtered, and the swap
  // is a full reload because the repo is a per-load singleton. 'All' never
  // switches vaults: it means "everything in the vault I'm looking at".
  function pick(v: Scope) {
    $scope = v;
    if (v === 'work' || v === 'private') {
      const bound = vaultForScope(v);
      if (bound && bound.id !== activeVault().id) {
        switchVault(bound.id, bound.name);
        return;
      }
    }
  }

  // Show where a click will take you: the bound vault's name in the tooltip.
  function titleFor(opt: { value: Scope; title: string }): string {
    if (opt.value === 'work' || opt.value === 'private') {
      const bound = vaultForScope(opt.value);
      if (bound && bound.id !== activeVault().id) return `${opt.title} — opens “${bound.name}”`;
    }
    return opt.title;
  }
</script>

<div
  class="inline-flex items-center rounded-full border border-surface-border bg-surface-card p-0.5 text-xs font-medium shadow-sm"
  role="tablist"
  aria-label="Scope"
>
  {#each opts as opt}
    <button
      type="button"
      role="tab"
      aria-selected={$scope === opt.value}
      title={titleFor(opt)}
      onclick={() => pick(opt.value)}
      class="rounded-full px-3 py-1 transition {$scope === opt.value
        ? 'bg-brand text-white shadow-card'
        : 'text-ink-500 hover:text-ink-900'}"
    >
      {opt.label}
    </button>
  {/each}
</div>
