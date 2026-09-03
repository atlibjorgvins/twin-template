<script lang="ts">
  // Shared header for every `/settings/<sub>` page. Renders a small
  // back-link, the section title in display font, and an optional
  // subtitle. Keeps the visual rhythm consistent across sub-pages.
  import Icon from '$lib/Icon.svelte';

  type Props = {
    title: string;
    subtitle?: string;
  };
  let { title, subtitle = '' }: Props = $props();
</script>

<header class="space-y-1">
  <a
    href="/settings"
    class="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700"
  >
    <Icon name="chevron-left" size={12} /> Settings
  </a>
  <h1
    class="font-display text-2xl font-bold sm:text-3xl"
    style="letter-spacing: -0.03em;"
  >{title}</h1>
  {#if subtitle}
    <p class="text-sm text-ink-500">{subtitle}</p>
  {/if}
</header>
