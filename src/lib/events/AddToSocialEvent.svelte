<script lang="ts">
  // Add to a social platform's native event (Facebook / LinkedIn).
  // Neither lets you create an event via API (Facebook removed it in 2017;
  // LinkedIn's events API is closed), so this is a manual-assist popup: it
  // pre-fills paste-ready fields, opens the platform's event creator, and
  // stores the resulting event URL in event_platform_link so the preview
  // can show a "added" checkmark. Configurable by `platform`.
  import Icon from '$lib/Icon.svelte';
  import { formatError, listMetaChannels, type MetaChannel } from '$lib/directus';
  import {
    saveEventPlatformLink,
    removeEventPlatformLink,
    type EventPlatformLink
  } from '$lib/events/data';

  type Platform = 'facebook_event' | 'linkedin_event';
  type Props = {
    platform: Platform;
    eventId: number;
    event: { name?: string | null; start?: string | null; end?: string | null; location_name?: string | null; summary?: string | null };
    sourceUrl?: string | null;
    /** Current saved link for this platform (page is source of truth). */
    link?: EventPlatformLink | null;
    /** Notify the page when the saved link changes, to update checkmarks. */
    onChange?: (platform: Platform, link: EventPlatformLink | null) => void;
  };
  let { platform, eventId, event, sourceUrl = null, link = null, onChange }: Props = $props();

  const CONFIG = {
    facebook_event: {
      label: 'Facebook event',
      icon: 'facebook',
      usePages: true,
      placeholder: 'https://www.facebook.com/events/…',
      createUrl: 'https://www.facebook.com/events/create/'
    },
    linkedin_event: {
      label: 'LinkedIn event',
      icon: 'linkedin',
      usePages: false,
      placeholder: 'https://www.linkedin.com/events/…',
      createUrl: 'https://www.linkedin.com/events/'
    }
  } as const;
  const cfg = $derived(CONFIG[platform]);

  let pages = $state<MetaChannel[]>([]);
  let pageId = $state('');
  let urlInput = $state(link?.url ?? '');
  let saving = $state(false);
  let error = $state('');
  let copied = $state<string | null>(null);
  let open = $state(false);
  let pagesLoaded = $state(false);

  // Keep the input in sync if the page swaps the link in.
  $effect(() => {
    urlInput = link?.url ?? '';
  });

  async function ensurePages() {
    if (pagesLoaded || !cfg.usePages) return;
    pagesLoaded = true;
    try {
      const chans = await listMetaChannels();
      pages = chans.filter((c) => c.kind === 'facebook_page' && c.is_enabled !== false);
      if (pages[0] && !pageId) pageId = pages[0].page_id || pages[0].id;
    } catch {
      /* page picker is optional — fall back to the generic create URL */
    }
  }
  function openHelper() {
    open = true;
    void ensurePages();
  }

  // ── Pre-filled, paste-ready fields ───────────────────────────────────
  const fmtWhen = $derived.by(() => {
    if (!event.start) return '';
    const f = (iso: string) => new Intl.DateTimeFormat('is-IS', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));
    return event.end ? `${f(event.start)} – ${f(event.end)}` : f(event.start);
  });
  const description = $derived(
    [event.summary?.trim(), sourceUrl ? `Nánar: ${sourceUrl}` : null].filter(Boolean).join('\n\n')
  );
  const fields = $derived(
    [
      { key: 'title', label: 'Event name', value: event.name ?? '' },
      { key: 'when', label: 'When', value: fmtWhen },
      { key: 'where', label: 'Where', value: event.location_name ?? '' },
      { key: 'desc', label: 'Description', value: description }
    ].filter((f) => f.value)
  );

  const creatorUrl = $derived(
    cfg.usePages && pageId ? `https://www.facebook.com/${pageId}/events` : cfg.createUrl
  );

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      copied = key;
      setTimeout(() => { if (copied === key) copied = null; }, 1500);
    } catch {
      error = 'Couldn’t copy — select and copy manually.';
    }
  }

  async function saveLink() {
    const url = urlInput.trim();
    if (!url) return;
    saving = true;
    error = '';
    try {
      const idMatch = url.match(/events\/(\d+)/);
      const saved = await saveEventPlatformLink(eventId, platform, {
        url,
        external_id: idMatch ? idMatch[1] : null,
        status: 'live'
      });
      onChange?.(platform, saved);
    } catch (e) {
      error = formatError(e);
    } finally {
      saving = false;
    }
  }
  async function clearLink() {
    if (!link) return;
    if (!confirm(`Remove the saved ${cfg.label} link?`)) return;
    saving = true;
    try {
      await removeEventPlatformLink(link.id);
      urlInput = '';
      onChange?.(platform, null);
    } catch (e) {
      error = formatError(e);
    } finally {
      saving = false;
    }
  }
</script>

<!-- Compact icon trigger (added-state shown as a check badge). -->
<button
  type="button"
  class="relative grid h-10 w-10 place-items-center rounded-[12px] border border-surface-border bg-surface-card text-ink-600 transition hover:bg-surface-hover hover:text-ink-900"
  title={link?.url ? `${cfg.label} added — manage` : `Add to ${cfg.label}`}
  aria-label={link?.url ? `${cfg.label} added — manage` : `Add to ${cfg.label}`}
  onclick={openHelper}
>
  <Icon name={cfg.icon} size={18} />
  {#if link?.url}
    <span class="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full text-white" style="background: var(--accent-electric);" title="Added"><Icon name="check" size={10} /></span>
  {/if}
</button>

<!-- Helper popup -->
{#if open}
  <div class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
    <button class="absolute inset-0 cursor-default bg-black/40" aria-label="Close" tabindex="-1" onclick={() => (open = false)}></button>
    <div
      class="relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-t-[18px] border border-surface-border bg-surface-card p-5 shadow-xl sm:max-w-md sm:rounded-[18px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Add to ${cfg.label}`}
    >
      <div class="flex items-center gap-2">
        <Icon name={cfg.icon} size={16} class="text-ink-500" />
        <h2 class="font-display text-lg font-bold text-ink-900" style="letter-spacing:-0.02em;">Add to {cfg.label}</h2>
        <button class="ml-auto text-ink-300 transition hover:text-ink-700" onclick={() => (open = false)} aria-label="Close"><Icon name="x" size={16} /></button>
      </div>
      <p class="mt-1 text-[12px] text-ink-500">
        {cfg.label.split(' ')[0]} doesn’t allow creating events via its API. Paste the event link here once it exists — or use the helper below to create it.
      </p>

      {#if error}
        <div class="mt-2 rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">{error}</div>
      {/if}

      <!-- Primary action: paste / save the event link, right at the top. -->
      <div class="mt-3">
        <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">Event link</div>
        {#if link?.url}
          <div class="mt-1.5 flex items-center gap-2 text-xs">
            <span class="inline-flex items-center text-tag-eventText"><Icon name="check" size={13} /></span>
            <a href={link.url} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-tag-eventText hover:underline">
              View {cfg.label} <Icon name="arrow-right" size={11} class="-rotate-45" />
            </a>
            <button class="text-ink-300 transition hover:text-tag-salesText" onclick={clearLink} disabled={saving} aria-label="Remove link"><Icon name="x" size={13} /></button>
          </div>
        {/if}
        <div class="mt-1.5 flex items-center gap-2">
          <input class="input w-full text-sm" placeholder={cfg.placeholder} bind:value={urlInput} disabled={saving} />
          <button class="btn-primary shrink-0 text-sm" onclick={saveLink} disabled={saving || !urlInput.trim()}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      <!-- Helper for creating the event (collapsed; only when you need it). -->
      <details class="mt-4 rounded-[10px] border border-surface-border">
        <summary class="cursor-pointer list-none px-3 py-2 text-sm font-medium text-ink-700">
          Need to create it? Open {cfg.label.split(' ')[0]} + copy the details
        </summary>
        <div class="space-y-4 border-t border-surface-divider px-3 py-3">
          <!-- Open the creator -->
          <div>
            <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">Open the event creator</div>
            <div class="mt-1.5 flex flex-wrap items-center gap-2">
              {#if cfg.usePages && pages.length > 1}
                <select class="input !w-auto !py-1.5 text-sm" bind:value={pageId}>
                  {#each pages as p (p.id)}<option value={p.page_id || p.id}>{p.name}</option>{/each}
                </select>
              {:else if cfg.usePages && pages.length === 1}
                <span class="text-xs text-ink-500">Page: <span class="font-medium text-ink-700">{pages[0].name}</span></span>
              {/if}
              <a href={creatorUrl} target="_blank" rel="noreferrer" class="btn-primary inline-flex items-center gap-1 text-sm">
                Open on {cfg.label.split(' ')[0]} <Icon name="arrow-right" size={12} class="-rotate-45" />
              </a>
            </div>
          </div>

          <!-- Paste-ready fields -->
          {#if fields.length}
            <div>
              <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">Copy the details</div>
              <div class="mt-1.5 space-y-1.5">
                {#each fields as f (f.key)}
                  <div class="flex items-start gap-2 rounded-[10px] border border-surface-border px-3 py-2">
                    <div class="min-w-0 flex-1">
                      <div class="font-display text-[10px] uppercase tracking-wider text-ink-400">{f.label}</div>
                      <div class="whitespace-pre-wrap break-words text-sm text-ink-800">{f.value}</div>
                    </div>
                    <button
                      type="button"
                      class="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-500 transition hover:bg-surface-hover hover:text-ink-800"
                      onclick={() => copy(f.key, String(f.value))}
                    >{copied === f.key ? 'Copied' : 'Copy'}</button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </details>
    </div>
  </div>
{/if}
