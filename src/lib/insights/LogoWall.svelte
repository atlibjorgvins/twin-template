<script lang="ts">
  // Every organisation in the current slice as a logo tile. This is the slide
  // people actually want out of a programme dashboard — and it is drillable:
  // each tile is a link to the org page.
  //
  // Logos render `contain` on the card surface, not `cover`: an accelerator
  // logo cropped to a square is unrecognisable, which defeats the point.
  // Alphabetical, so a reader can find a company; a grant-size sort would put
  // the funded few first and read as a ranking nobody asked for.
  //
  // Images are lazy and the wall starts capped. Rendering 80 tiles eagerly
  // fires 80 asset requests at the NAS over Tailscale in one burst, which comes
  // back as ERR_CONNECTION_CLOSED — measured, not hypothetical.
  import Avatar from '$lib/Avatar.svelte';
  import Icon from '$lib/Icon.svelte';
  import { assetUrl } from '$lib/directus';
  import { formatCompactMoney, type OrgRow } from './metrics';

  let {
    orgs,
    limit = 24
  }: { orgs: OrgRow[]; limit?: number } = $props();

  let expanded = $state(false);
  const shown = $derived(expanded ? orgs : orgs.slice(0, limit));
  const withLogo = $derived(orgs.filter((o) => o.logo).length);
</script>

<div class="space-y-2">
  <ul class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
    {#each shown as o (o.id)}
      <li class="min-w-0">
        <a
          href={`/orgs/${o.id}`}
          class="flex h-full flex-col items-center gap-1.5 rounded-[10px] border border-surface-border p-2 transition hover:border-brand/40 hover:bg-surface-hover"
          title={`${o.name}${o.years.length ? ' — ' + o.years.join(', ') : ''}${o.grantTotal ? ' — ' + formatCompactMoney(o.grantTotal) + ' in grants' : ''}`}
        >
          <Avatar
            name={o.name}
            src={o.logo ? assetUrl(o.logo, { width: 176, height: 176, fit: 'contain' }) : ''}
            position={o.logo ? `${o.focal ?? '50% 50%'} contain` : ''}
            size={48}
            lazy
          />
          <span class="w-full truncate text-center text-[11px] leading-tight text-ink-700">{o.name}</span>
          <span class="flex items-center gap-1 text-[10px] tabular-nums text-ink-400">
            {o.years.length ? o.years[0] : '—'}
            {#if o.grantTotal > 0}
              <!-- A funded org is worth spotting on the wall; the icon carries
                   the meaning so it isn't colour-only. -->
              <span class="inline-flex items-center gap-0.5 text-brand" title="Has grant funding">
                <Icon name="gift" size={10} />
              </span>
            {/if}
            {#if !o.isActive}
              <span class="text-ink-300" title="No longer active">· inactive</span>
            {/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>

  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="flex items-center gap-1.5 text-xs text-ink-400">
      <Icon name="building" size={12} />
      {orgs.length} organizations · {withLogo} with a logo
      {#if orgs.length}({Math.round((withLogo / orgs.length) * 100)}%){/if}
    </p>
    {#if orgs.length > limit}
      <button type="button" class="chip-radio print:hidden" onclick={() => (expanded = !expanded)}>
        {expanded ? 'Show fewer' : `Show all ${orgs.length}`}
      </button>
    {/if}
  </div>
</div>
