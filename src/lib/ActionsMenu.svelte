<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';

  // A reusable "Actions" popover — three-dot/labeled trigger that opens a
  // small menu of contextual actions. Each item is either a click-handler or
  // a link (for mailto:/tel:/external).
  export type ActionItem =
    | {
        label: string;
        icon?: IconName;
        onClick: () => void | Promise<void>;
        variant?: 'default' | 'danger';
        hidden?: boolean;
        disabled?: boolean;
      }
    | {
        label: string;
        icon?: IconName;
        href: string;
        target?: string;
        variant?: 'default' | 'danger';
        hidden?: boolean;
        disabled?: boolean;
      }
    | { divider: true; hidden?: boolean };

  type Props = {
    items: ActionItem[];
    label?: string;
    /** Right- or left-aligned popover. Defaults to right (anchor by trigger). */
    align?: 'left' | 'right';
    /** Compact (icon-only) trigger or full button. */
    compact?: boolean;
  };

  let { items, label = 'Actions', align = 'left', compact = false }: Props = $props();

  let open = $state(false);
  let btn = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLDivElement | null>(null);

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

  async function pick(item: Extract<ActionItem, { onClick: () => void | Promise<void> }>) {
    open = false;
    await item.onClick();
  }

  const visible = $derived(items.filter((i) => !('hidden' in i && i.hidden)));
</script>

<div class="relative inline-block">
  <button
    bind:this={btn}
    type="button"
    class="{compact ? 'nav-icon' : 'btn-ghost !px-3'}"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    onclick={() => (open = !open)}
  >
    {#if compact}
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </svg>
    {:else}
      <Icon name="sparkles" size={16} />
      <span>{label}</span>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    {/if}
  </button>

  {#if open}
    <div
      bind:this={menu}
      role="menu"
      class="absolute z-30 mt-1 w-56 overflow-hidden rounded-[10px] border border-surface-border bg-surface-card shadow-pop {align === 'right' ? 'right-0' : 'left-0'}"
    >
      <ul class="py-1">
        {#each visible as item}
          {#if 'divider' in item}
            <li class="my-1 h-px bg-surface-divider"></li>
          {:else if 'href' in item}
            <li>
              <a
                href={item.href}
                target={item.target}
                rel={item.target === '_blank' ? 'noreferrer' : undefined}
                role="menuitem"
                class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-hover {item.variant === 'danger' ? 'text-tag-salesText' : 'text-ink-700'} {item.disabled ? 'pointer-events-none opacity-50' : ''}"
                onclick={() => (open = false)}
              >
                {#if item.icon}<Icon name={item.icon} size={14} />{/if}
                <span>{item.label}</span>
              </a>
            </li>
          {:else}
            <li>
              <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-hover {item.variant === 'danger' ? 'text-tag-salesText' : 'text-ink-700'}"
                onclick={() => pick(item)}
                disabled={item.disabled}
              >
                {#if item.icon}<Icon name={item.icon} size={14} />{/if}
                <span>{item.label}</span>
              </button>
            </li>
          {/if}
        {/each}
      </ul>
    </div>
  {/if}
</div>
