<script lang="ts">
  import { onDestroy } from 'svelte';

  type Option = { value: string; label: string };
  type Props = {
    value: string;
    options: Option[];
    onChange: (v: string) => void;
    label?: string;
  };
  let { value, options, onChange, label = 'Sort' }: Props = $props();

  let open = $state(false);
  let btn = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLDivElement | null>(null);

  const current = $derived(options.find((o) => o.value === value) ?? options[0]);

  function onDocClick(e: MouseEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (btn?.contains(t) || menu?.contains(t)) return;
    open = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
      btn?.focus();
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    onDestroy(() => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    });
  }

  function pick(v: string) {
    onChange(v);
    open = false;
    btn?.focus();
  }
</script>

<div class="relative inline-block">
  <button
    bind:this={btn}
    type="button"
    class="inline-flex items-center gap-1.5 rounded-[10px] border border-surface-border bg-surface-card px-2.5 py-1.5 text-sm text-ink-700 hover:bg-surface-hover"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label="{label}: {current?.label ?? ''}"
    onclick={() => (open = !open)}
  >
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 6h13M3 12h9M3 18h5" />
      <path d="m17 14 3 3 3-3" />
      <path d="M20 17V8" />
    </svg>
    <span class="text-ink-400">{label}:</span>
    <span class="font-medium text-ink-900">{current?.label ?? ''}</span>
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </button>

  {#if open}
    <div
      bind:this={menu}
      role="listbox"
      class="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-[10px] border border-surface-border bg-surface-card shadow-pop"
    >
      <ul class="py-1">
        {#each options as o (o.value)}
          <li>
            <button
              type="button"
              role="option"
              aria-selected={o.value === value}
              class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover {o.value === value ? 'text-brand-700' : 'text-ink-700'}"
              onclick={() => pick(o.value)}
            >
              <span>{o.label}</span>
              {#if o.value === value}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
