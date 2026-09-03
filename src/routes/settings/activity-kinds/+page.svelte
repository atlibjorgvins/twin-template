<script lang="ts">
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import ActivityKindAdmin from '$lib/admin/ActivityKindAdmin.svelte';
</script>

<svelte:head><title>Activity kinds · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Activity kinds"
    subtitle="The vocabulary of interactions you can log — coffee, meeting, mentored, etc. Each kind has a colour and icon that show up everywhere it appears."
  />
  <ActivityKindAdmin />
</section>
