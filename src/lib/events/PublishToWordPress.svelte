<script lang="ts">
  // Per-event "Publish to klak.is" card. Choose Draft or Publish, push
  // to the WordPress "vidburdure" type via the proxy, and surface the
  // live link. twin stores the post id (event_platform_link), so this
  // updates the same post on every re-publish — never a duplicate.
  import Icon from '$lib/Icon.svelte';
  import { formatError } from '$lib/directus';
  import {
    wordpressConfigured,
    publishEventToWordPress,
    listEventPlatformLinks,
    type WpStatus,
    type EventPlatformLink
  } from '$lib/wordpress';

  type Props = {
    // Stable id drives the link lookup; the live `event` payload (which
    // changes as the user edits) is only read at publish time.
    eventId: number;
    event: { id: number; name?: string | null; start?: string | null; end?: string | null; location_name?: string | null; summary?: string | null; cover?: string | null };
    /** Original klak.is permalink captured on import (event.source_url) —
     *  shown as the canonical external link even before a re-push. */
    sourceUrl?: string | null;
    /** Notify the page when the klak.is link changes (preview checkmark). */
    onChange?: (link: EventPlatformLink | null) => void;
    /** Drop the card chrome so this can sit inside a host card. The event
     *  page groups klak.is + Facebook + LinkedIn into one Distribution card,
     *  and nesting a card inside a card reads as a rendering bug. */
    bare?: boolean;
  };
  let { eventId, event, sourceUrl = null, onChange, bare = false }: Props = $props();
  let featuredNote = $state<'set' | 'failed' | 'none'>('none');

  const configured = wordpressConfigured();
  let link = $state<EventPlatformLink | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');

  // The external klak.is URL to surface: the live platform-link url wins
  // (it's the post we keep in sync), else the import-time source_url.
  const externalUrl = $derived(link?.url || sourceUrl || null);
  let chosen = $state<WpStatus>('draft');

  async function refresh() {
    loading = true;
    try {
      const links = await listEventPlatformLinks(eventId);
      link = links.find((l) => l.platform === 'wordpress') ?? null;
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    // Track only eventId — re-fetch when the event changes, not on edits.
    void eventId;
    void refresh();
  });

  async function publish() {
    busy = true;
    error = '';
    try {
      const res = await publishEventToWordPress({ ...event, id: eventId }, { status: chosen });
      link = { id: link?.id ?? 0, event_id: eventId, platform: 'wordpress', external_id: res.id, url: res.url, status: res.status, synced_at: new Date().toISOString() };
      featuredNote = res.featuredImage;
      onChange?.(link);
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class={bare ? '' : 'rounded-[14px] border border-surface-border bg-surface-card p-4'}>
  <div class="flex items-center gap-2">
    <Icon name="globe" size={15} class="text-ink-500" />
    <span class="font-medium text-ink-900">Publish to WordPress</span>
    {#if link?.external_id}
      <span class="ml-auto rounded-full bg-tag-eventText/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tag-eventText">
        {link.status === 'publish' ? 'Live' : link.status ?? 'Linked'}
      </span>
    {/if}
  </div>

  {#if error}
    <div class="mt-2 rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">{error}</div>
  {/if}

  {#if loading}
    <p class="mt-2 text-xs text-ink-400">Checking…</p>
  {:else}
    {#if externalUrl}
      <div class="mt-2 space-y-1 text-xs">
        <div class="flex items-center gap-2">
          <a href={externalUrl} target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-tag-eventText hover:underline">
            View on the site <Icon name="arrow-right" size={11} class="-rotate-45" />
          </a>
          {#if link?.external_id}<span class="text-ink-300">· post {link.external_id}</span>{/if}
        </div>
        <div class="truncate font-mono text-[10px] text-ink-400" title={externalUrl}>{externalUrl}</div>
      </div>
    {/if}

    {#if configured}
      <div class="mt-3 flex items-center gap-2">
        <select class="input !w-auto !py-1.5 text-sm" bind:value={chosen} disabled={busy}>
          <option value="draft">Draft</option>
          <option value="publish">Publish</option>
        </select>
        <button type="button" class="btn-primary text-sm" onclick={publish} disabled={busy}>
          {busy ? 'Pushing…' : link?.external_id ? 'Update on the site' : 'Push to the site'}
        </button>
      </div>
      <p class="mt-1.5 text-[11px] text-ink-400">
        {link?.external_id ? 'Updates the existing post' : 'Creates a new post and remembers its id'} — no duplicates.
        {#if event.cover}Cover is pushed as the featured image.{/if}
      </p>
      {#if featuredNote === 'set'}
        <p class="mt-1 text-[11px]" style="color:#1B8A4B;">✓ Featured image uploaded.</p>
      {:else if featuredNote === 'failed'}
        <p class="mt-1 text-[11px]" style="color:#B57A12;">Post saved, but the featured image didn’t upload — try again or set it on the site.</p>
      {/if}
    {:else}
      <p class="mt-2 text-xs text-ink-500">
        {link?.external_id ? 'Imported from WordPress. ' : ''}Connect the proxy in <a class="text-tag-eventText underline" href="/settings/wordpress">Settings → WordPress</a> to publish from twin.
      </p>
    {/if}
  {/if}
</div>
