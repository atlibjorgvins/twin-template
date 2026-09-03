<script lang="ts">
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import ProjectRoleAdmin from '$lib/admin/ProjectRoleAdmin.svelte';
</script>

<svelte:head><title>Project roles · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Project roles"
    subtitle="The fixed vocabulary for the role a person or organisation has in a project (student, teacher, partner, sponsor, host, …). Drives the picker on the People + Organisations tabs of every project."
  />
  <ProjectRoleAdmin />
</section>
