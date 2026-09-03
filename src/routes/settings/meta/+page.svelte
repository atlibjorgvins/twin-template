<script lang="ts">
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import MetaAdmin from '$lib/admin/MetaAdmin.svelte';
</script>

<svelte:head><title>Meta · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Meta"
    subtitle="Publish to Facebook Pages + Instagram and pull ad reports straight from Meta. The access token lives server-side in a Directus Flow — twin never sees it. Sync your targets, then link each to the project it belongs to."
  />
  <MetaAdmin />
</section>
