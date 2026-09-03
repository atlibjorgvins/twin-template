<script lang="ts">
  // The faces of a programme: a scroll-snap strip of everyone in the current
  // slice, newest cohort first, each a link to their person page.
  //
  // Ordering is by cohort count then name — NOT "photos first". Sorting by who
  // has a picture would quietly present the programme as better-documented
  // than it is, and the people without a photo are the ones worth noticing.
  // Avatar already renders initials on a deterministic tint, so a missing
  // picture is a legitimate tile rather than a hole.
  import Avatar from '$lib/Avatar.svelte';
  import Icon from '$lib/Icon.svelte';
  import { assetUrl } from '$lib/directus';
  import { roleLabel, type PersonRow } from './metrics';

  let {
    people,
    /** Tiles rendered before the "+N more" card. Kept modest, and the photos
     *  are lazy: a burst of 100+ asset requests over Tailscale comes back as
     *  ERR_CONNECTION_CLOSED rather than as avatars. */
    limit = 24
  }: { people: PersonRow[]; limit?: number } = $props();

  const ordered = $derived(
    [...people].sort((a, b) => b.cohortCount - a.cohortCount || a.name.localeCompare(b.name))
  );
  const shown = $derived(ordered.slice(0, limit));
  const withPhoto = $derived(people.filter((p) => p.picture).length);
</script>

<div class="space-y-2">
  <!-- Horizontal scroll, snapped. Sized so a phone shows ~4.5 tiles: a
       half-visible tile is what tells you the strip scrolls. -->
  <ul
    class="scroll-momentum -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-2"
    aria-label="People in this programme"
  >
    {#each shown as p (p.id)}
      <li class="w-[76px] shrink-0 snap-start sm:w-[88px]">
        <a
          href={`/people/${p.id}`}
          class="group flex flex-col items-center gap-1.5 rounded-[10px] p-1 transition hover:bg-surface-hover"
          title={`${p.name}${p.roles.length ? ' — ' + p.roles.map(roleLabel).join(', ') : ''}`}
        >
          <span class="relative">
            <Avatar
              name={p.name}
              src={p.picture ? assetUrl(p.picture, { width: 176, height: 176, fit: 'cover' }) : ''}
              position={p.focal ?? ''}
              size={64}
              lazy
            />
            {#if p.cohortCount > 1}
              <!-- Returning participants/mentors are the interesting tail, so
                   they get a badge rather than being buried in the sort. -->
              <span
                class="absolute -bottom-0.5 -right-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border border-surface-card bg-brand px-1 text-[10px] font-semibold tabular-nums"
                style="color:var(--accent-text)"
                title={`${p.cohortCount} cohorts: ${p.years.join(', ')}`}
              >{p.cohortCount}×</span>
            {/if}
          </span>
          <span class="w-full truncate text-center text-[11px] leading-tight text-ink-700">{p.name}</span>
        </a>
      </li>
    {/each}
    {#if ordered.length > shown.length}
      <li class="flex w-[76px] shrink-0 snap-start items-center justify-center sm:w-[88px]">
        <span class="text-center text-[11px] text-ink-400">
          +{ordered.length - shown.length}<br />more
        </span>
      </li>
    {/if}
  </ul>

  <p class="flex items-center gap-1.5 text-xs text-ink-400">
    <Icon name="users" size={12} />
    {people.length} people · {withPhoto} with a photo
    {#if people.length}({Math.round((withPhoto / people.length) * 100)}%){/if}
  </p>
</div>
