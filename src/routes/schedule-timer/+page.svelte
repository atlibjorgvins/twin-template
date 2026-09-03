<script lang="ts">
  import ScheduleTimer from '$lib/ScheduleTimer.svelte';
  import type { Slot } from '$lib/scheduleTimer/parse';

  function onSlotChange(s: Slot | null) {
    // Hook for future ties — e.g. log an Activity when a major slot starts.
    if (s) console.debug('[schedule-timer] active slot →', s.label);
  }
</script>

<svelte:head>
  <title>Schedule Timer · Hub</title>
</svelte:head>

<section class="space-y-4">
  <div>
    <h1 class="text-2xl font-semibold tracking-tightish">Schedule Timer</h1>
    <p class="mt-1 text-sm text-ink-500">
      Paste a back-to-back time table — <code>13:30 - 13:40Sól56…</code> — and the active slot
      lights up live as the clock ticks. Use <code>Pása</code> to insert a break that fills the
      gap between two slots.
    </p>
  </div>

  <ScheduleTimer {onSlotChange} />
</section>
