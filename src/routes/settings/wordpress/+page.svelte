<script lang="ts">
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import WordPressAdmin from '$lib/admin/WordPressAdmin.svelte';
</script>

<svelte:head><title>WordPress · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="WordPress"
    subtitle="Publish twin events to your WordPress site. The Application Password lives server-side in a Directus Flow — twin never sees it. twin keeps the WordPress post id per event, so it stays the source of truth and never duplicates."
  />
  <WordPressAdmin />
</section>
