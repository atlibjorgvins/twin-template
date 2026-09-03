<script lang="ts">
  // Kind / status / project pills for an event.
  //
  // Shared by the event page hero and the calendar peek sheet so the two
  // can't drift — before this, the popup rendered a raw `kind` slug in a
  // coloured chip while the page showed the humanised label in a <select>,
  // which meant the same event read as "demo_day" in one place and
  // "Demo day" in the other.
  import TagPill from '$lib/TagPill.svelte';
  import { EVENT_KIND_LABEL, EVENT_STATUS_LABEL } from '$lib/events/data';

  let {
    kind = null,
    status = null,
    projectName = null,
    projectId = null,
    scope = null,
    calendar = null
  }: {
    kind?: string | null;
    status?: string | null;
    projectName?: string | null;
    projectId?: number | null;
    scope?: string | null;
    /** Source-calendar bucket label (calendar peek only). */
    calendar?: string | null;
  } = $props();

  // The calendar's kinds are a wider vocabulary than the Event collection's —
  // 'project_span', 'birthday_derived' and friends aren't in EVENT_KIND_LABEL.
  // Falling through to the raw value printed "project_span" in a pill, which
  // is what a slug looks like when it escapes into the UI.
  function humanise(v: string): string {
    const t = v.replace(/_/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const kindLabel = $derived(kind ? (EVENT_KIND_LABEL[kind] ?? humanise(kind)) : null);
  const statusLabel = $derived(status ? (EVENT_STATUS_LABEL[status] ?? status) : null);
  // 'past' and 'archived' are the two states that mean "don't act on this",
  // so they read muted rather than as a live accent.
  const statusTone = $derived(
    status === 'upcoming' ? 'online' : status === 'idea' || status === 'planning' ? 'chat' : 'neutral'
  );
</script>

<span class="flex flex-wrap items-center gap-1.5">
  {#if kindLabel}<TagPill tone="online">{kindLabel}</TagPill>{/if}
  {#if statusLabel}<TagPill tone={statusTone}>{statusLabel}</TagPill>{/if}
  {#if scope}<TagPill tone="neutral">{scope}</TagPill>{/if}
  {#if calendar}<TagPill tone="neutral">{calendar}</TagPill>{/if}
  {#if projectName}
    {#if projectId != null}
      <a href={`/projects/${projectId}`} class="tag hover:border-brand hover:text-brand" style="background: var(--bg-tertiary); color: var(--text-secondary); border-color: var(--border-subtle);">
        {projectName}
      </a>
    {:else}
      <TagPill tone="neutral">{projectName}</TagPill>
    {/if}
  {/if}
</span>
