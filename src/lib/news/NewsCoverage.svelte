<script lang="ts">
  // The seam that keeps the CRM light.
  //
  // Host pages mount THIS, which is a few lines and imports nothing from the
  // news stack at module scope. The real card — and with it the Directus
  // client, the SDK query builders and the data layer — is pulled in by
  // dynamic import() only when the feature is both configured and switched
  // on. A twin with news off downloads none of it, on any org page, ever.
  //
  // Static-importing CoverageCard here would defeat the entire arrangement:
  // the bundler cannot tree-shake past a runtime `if`, so the news client
  // would ship inside the CRM chunk and be paid for on every page view.
  import type { Component } from 'svelte';
  import { newsConfigured, newsEnabled, newsVisible } from '$lib/news/enabled';

  let {
    entityType,
    entityId
  }: { entityType: 'organization' | 'project' | 'person'; entityId: number } = $props();

  let Card = $state<Component<{ entityType: string; entityId: number }> | null>(null);

  $effect(() => {
    if (!newsVisible($newsEnabled)) {
      Card = null;
      return;
    }
    let alive = true;
    void import('./CoverageCard.svelte')
      .then((m) => {
        if (alive) Card = m.default as never;
      })
      .catch(() => {
        // A chunk that fails to load must not break the page it sits on.
        if (alive) Card = null;
      });
    return () => {
      alive = false;
    };
  });
</script>

{#if Card}
  <!-- svelte-ignore svelte_component_deprecated -->
  <Card {entityType} {entityId} />
{/if}
