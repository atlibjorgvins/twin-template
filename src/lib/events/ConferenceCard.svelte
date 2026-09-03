<script lang="ts">
  // The conferencing block, as controls rather than as text.
  //
  // What Google appends is 467 characters of tildes, a URL, a PIN and a
  // phone list. What you actually want from it is one tap to join, and
  // occasionally a number to ring. So: a Join button, and the dial-in as a
  // real tel: link with the PIN next to it.
  import Icon from '$lib/Icon.svelte';
  import type { Conferencing } from '$lib/events/conferencing';

  let { conf, compact = false }: { conf: Conferencing; compact?: boolean } = $props();

  // Copy-to-clipboard for the codes — they exist to be pasted into a phone
  // keypad or a join dialog, and selecting text inside a bottom sheet on a
  // touch screen is a fight.
  let copied = $state<string | null>(null);
  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      copied = label;
      setTimeout(() => (copied = copied === label ? null : copied), 1400);
    } catch {
      /* clipboard blocked — the value is still on screen to read */
    }
  }

  // Built in the script rather than inline: a tuple array widens every
  // element to string | undefined, and an {#if} can't narrow back through
  // the click handler's closure.
  const codes = $derived(
    (
      [
        { label: 'PIN', value: conf.pin },
        { label: 'ID', value: conf.meetingId },
        { label: 'Passcode', value: conf.passcode }
      ] as Array<{ label: string; value?: string }>
    ).filter((c): c is { label: string; value: string } => !!c.value)
  );

  const icon = $derived(
    conf.provider === 'teams' ? 'users' : conf.provider === 'zoom' ? 'message-square' : 'globe'
  );
</script>

<div class="rounded-[10px] border border-surface-border bg-surface-hover/30 p-2.5">
  <a
    href={conf.joinUrl}
    target="_blank"
    rel="noreferrer"
    class="btn-primary w-full justify-center !py-2 text-sm"
  >
    <Icon name={icon} size={15} />
    {conf.label}
  </a>

  {#if conf.phone || codes.length > 0}
    <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-500">
      {#if conf.phone}
        <!-- tel: so a phone actually dials it. -->
        <a href={`tel:${conf.phone}`} class="inline-flex items-center gap-1 text-ink-700 hover:text-brand">
          <Icon name="phone" size={12} class="shrink-0 text-ink-400" />
          <span class="tabular-nums">{conf.phoneDisplay ?? conf.phone}</span>
          {#if conf.phoneCountry}<span class="text-ink-400">({conf.phoneCountry})</span>{/if}
        </a>
      {/if}

      {#each codes as c (c.label)}
        <button
          type="button"
          class="inline-flex items-center gap-1 hover:text-brand"
          onclick={() => copy(c.label, c.value)}
          title={`Copy ${c.label}`}
        >
          <span class="text-ink-400">{c.label}</span>
          <span class="tabular-nums text-ink-700">{c.value}</span>
          <Icon name={copied === c.label ? 'check' : 'copy'} size={11} class="shrink-0 {copied === c.label ? 'text-brand' : 'text-ink-300'}" />
        </button>
      {/each}

      {#if conf.morePhonesUrl && !compact}
        <a href={conf.morePhonesUrl} target="_blank" rel="noreferrer" class="text-ink-400 hover:text-brand">
          More numbers
        </a>
      {/if}
    </div>
  {/if}
</div>
