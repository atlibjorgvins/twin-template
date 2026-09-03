<script lang="ts">
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import PhotoTypeAdmin from '$lib/admin/PhotoTypeAdmin.svelte';
</script>

<svelte:head><title>Photo types · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Photo types"
    subtitle="The fixed list of kinds an organization photo can be labelled with — group photo, location, in action, product, … Archive a type to retire it from the picker."
  />
  <PhotoTypeAdmin />
</section>
