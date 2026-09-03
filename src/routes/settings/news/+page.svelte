<script lang="ts">
  // The run-time half of the switch: turn news off on this device without
  // rebuilding twin. Build-time absence is the other half and is not something
  // a settings page can change — if PUBLIC_NEWS_URL was never set, this page
  // says so and stops.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import { NEWS_URL, newsConfigured, newsEnabled } from '$lib/news/enabled';
  import { newsReachable } from '$lib/news/client';

  let reachable = $state<boolean | null>(null);

  onMount(() => {
    if (!newsConfigured()) return;
    void newsReachable().then((r) => (reachable = r));
  });
</script>

<svelte:head><title>News · Settings</title></svelte:head>

<section class="space-y-4">
  <header class="flex items-center justify-between gap-3">
    <div>
      <h1 class="text-xl font-semibold text-ink-900">News</h1>
      <p class="text-sm text-ink-500">Icelandic press monitoring, served by the separate frettir stack.</p>
    </div>
    <a href="/settings" class="btn-ghost shrink-0"><Icon name="chevron-left" size={14} /> Settings</a>
  </header>

  {#if !newsConfigured()}
    <div class="card p-4 text-sm text-ink-500">
      <p class="font-medium text-ink-900">Not built with news.</p>
      <p class="mt-1">
        This twin was built without <code>PUBLIC_NEWS_URL</code>, so the feature does not exist in
        this bundle — no route, no card on an org page, and no code shipped for it. Set the
        variable and rebuild to turn it on.
      </p>
    </div>
  {:else}
    <div class="card p-4">
      <label class="flex items-start gap-3">
        <input type="checkbox" class="mt-0.5" bind:checked={$newsEnabled} />
        <span>
          <span class="block text-sm font-medium text-ink-900">Show news in twin</span>
          <span class="mt-0.5 block text-xs text-ink-500">
            Off means the news tile, the <code>/news</code> feed and the coverage card on org pages
            all disappear on this device. Nothing is deleted and the archive keeps filling — this is
            about whether you want it in front of you while you work.
          </span>
        </span>
      </label>
    </div>

    <div class="card p-4 text-sm">
      <div class="flex items-center gap-2">
        <span class="text-ink-500">Service</span>
        <code class="text-xs text-ink-700">{NEWS_URL}</code>
        {#if reachable === null}
          <span class="text-xs text-ink-400">checking…</span>
        {:else if reachable}
          <span class="text-xs" style="color:#1B8A4B;">reachable</span>
        {:else}
          <span class="text-xs text-tag-salesText">not answering</span>
        {/if}
      </div>
      {#if reachable === false}
        <p class="mt-2 text-xs text-ink-500">
          The stack is tailnet-only, so this is expected off the tailnet. News reads fail quietly
          rather than erroring — an org page will simply show no coverage card.
        </p>
      {/if}
    </div>
  {/if}
</section>
