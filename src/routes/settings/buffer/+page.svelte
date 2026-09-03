<script lang="ts">
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import BufferAdmin from '$lib/admin/BufferAdmin.svelte';
</script>

<svelte:head><title>Buffer · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Buffer"
    subtitle="Channels you publish to through Buffer's queue — LinkedIn, Facebook, Instagram. The Evergreen machine posts to these. Link each to the project it belongs to. (Connect new channels in Buffer; they sync into twin.)"
  />
  <BufferAdmin />
</section>
