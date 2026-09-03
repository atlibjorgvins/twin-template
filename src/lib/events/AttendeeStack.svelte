<script lang="ts">
  // Overlapping avatar stack for the people attached to an event.
  //
  // Lifted out of Calendar.svelte's view dialog so the event page hero and
  // the calendar peek show the same faces the same way. The whole cluster is
  // one control: clicking it takes you to wherever the full roster lives.
  import Avatar from '$lib/Avatar.svelte';
  import Icon from '$lib/Icon.svelte';
  import { assetUrl } from '$lib/directus';

  let {
    faces = [],
    total = null,
    max = 5,
    size = 28,
    onclick,
    label
  }: {
    faces?: Array<{ id: string | number; name: string; picture?: string | null; focal?: string | null }>;
    /** Known headcount when it exceeds the faces we can render (e.g. calendar
     *  attendee emails with no Person row yet). Defaults to faces.length. */
    total?: number | null;
    max?: number;
    size?: number;
    onclick?: () => void;
    label?: string;
  } = $props();

  const count = $derived(Math.max(total ?? 0, faces.length));
  const shown = $derived(faces.slice(0, max));
  const overflow = $derived(count - shown.length);
  const text = $derived(label ?? `${count} attendee${count === 1 ? '' : 's'}`);
</script>

<!-- Two explicit branches rather than one <svelte:element>. A conditional
     `role` doesn't satisfy the a11y check (and a real <button> gets keyboard
     activation and focus for free, which a span with a click handler doesn't).
     The faces themselves are a snippet so the two branches can't diverge. -->
{#snippet stack()}
  <span class="flex -space-x-2">
      {#each shown as p (p.id)}
        <span class="rounded-full ring-2 ring-surface-card">
          <Avatar
            name={p.name}
            src={p.picture ? (assetUrl(p.picture, { width: size * 2, height: size * 2, fit: 'cover' }) ?? '') : ''}
            {size}
            position={p.focal ?? ''}
            lazy
          />
        </span>
      {/each}
      {#if shown.length === 0}
        <!-- Headcount known but no Person rows attached yet — keep a target
             so the control doesn't vanish and strand the count. -->
        <span
          class="inline-flex items-center justify-center rounded-full bg-surface-hover text-ink-500 ring-2 ring-surface-card"
          style="width: {size}px; height: {size}px;"
        >
          <Icon name="users" size={Math.round(size / 2)} />
        </span>
      {/if}
      {#if overflow > 0}
        <span
          class="inline-flex items-center justify-center rounded-full bg-surface-hover px-1 text-[10px] font-medium tabular-nums text-ink-700 ring-2 ring-surface-card"
          style="height: {size}px; min-width: {size}px;"
        >+{overflow}</span>
      {/if}
  </span>
{/snippet}

{#if count > 0}
  {#if onclick}
    <button
      type="button"
      class="group inline-flex shrink-0 items-center gap-2 rounded-full p-0.5 transition hover:bg-surface-hover"
      {onclick}
      aria-label={`${text} — open the full list`}
      title={text}
    >
      {@render stack()}
    </button>
  {:else}
    <span class="inline-flex shrink-0 items-center gap-2 rounded-full" title={text}>
      {@render stack()}
    </span>
  {/if}
{/if}
