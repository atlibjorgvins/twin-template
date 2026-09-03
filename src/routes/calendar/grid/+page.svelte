<script lang="ts">
  // Header back button (mobile chevron + desktop chevron in the
  // layout) is the canonical way back to /events — no inline
  // breadcrumb here.
  import Calendar from '$lib/Calendar.svelte';
</script>

<svelte:head>
  <title>Calendar grid · Hub</title>
</svelte:head>

<section class="space-y-4">
  <Calendar />
</section>
