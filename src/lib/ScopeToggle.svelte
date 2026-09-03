<script lang="ts">
  import { scope, type Scope } from '$lib/scope';

  const opts: { value: Scope; label: string; title: string }[] = [
    { value: 'all', label: 'All', title: 'Work + Private' },
    { value: 'work', label: 'Work', title: 'Work contacts only' },
    { value: 'private', label: 'Private', title: 'Private contacts only' }
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
