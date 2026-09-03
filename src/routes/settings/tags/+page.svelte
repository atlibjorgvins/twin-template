<script lang="ts">
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import TagAdmin from '$lib/admin/TagAdmin.svelte';
</script>

<svelte:head><title>Tags · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Tags"
    subtitle="Shared label pool used by people, organisations, notes and activities. Archive tags to retire them without losing the links."
  />
  <TagAdmin />
</section>
