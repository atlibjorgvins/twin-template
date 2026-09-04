<script lang="ts">
  // The Work / Private / All switch. It sets the SCOPE only — it never
  // switches vaults. The People/Org lists react: All merges every vault,
  // Work/Private merge the vaults flagged for that world (Settings → Vaults)
  // plus shared ones. So "Work" shows your work across every vault at once,
  // rather than jumping you into one. To actually open a different vault, use
  // the vault switcher in the sidebar or Settings → Vaults.
  import { scope, type Scope } from '$lib/scope';

  const opts: { value: Scope; label: string; title: string }[] = [
    { value: 'all', label: 'All', title: 'Everything, every vault' },
    { value: 'work', label: 'Work', title: 'Work — across every work vault' },
    { value: 'private', label: 'Private', title: 'Private — across every personal vault' }
  ];
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
      title={opt.title}
      onclick={() => ($scope = opt.value)}
      class="rounded-full px-3 py-1 transition {$scope === opt.value
        ? 'bg-brand text-white shadow-card'
        : 'text-ink-500 hover:text-ink-900'}"
    >
      {opt.label}
    </button>
  {/each}
</div>
