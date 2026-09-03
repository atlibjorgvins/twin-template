<script lang="ts">
  // Evergreen machine — campaign list. A campaign is a reusable bucket:
  // source records + filters + post template. Open one to generate
  // social-post briefs; duplicate one to clone a recipe.
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import {
    createCampaign,
    duplicateCampaign,
    formatError,
    CAMPAIGN_PLATFORM_LABEL,
    type Campaign,
    type CampaignPlatform
  } from '$lib/directus';

  let { data }: { data: { campaigns: Campaign[]; error: string | null } } = $props();
  let campaigns = $state<Campaign[]>([...data.campaigns]);
  let creating = $state(false);
  let errorMsg = $state<string | null>(data.error);

  const SOURCE_LABEL: Record<string, string> = {
    organization: 'Organizations',
    Person: 'People',
    Project: 'Projects'
  };

  async function newCampaign() {
    creating = true;
    errorMsg = null;
    try {
      const c = await createCampaign({
        name: 'New campaign',
        status: 'draft',
        source_collection: 'organization',
        platforms: ['general']
      });
      await goto(`/tools/evergreen/${c.id}`);
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      creating = false;
    }
  }

  async function duplicate(c: Campaign) {
    errorMsg = null;
    try {
      const copy = await duplicateCampaign(c.id);
      campaigns = [copy, ...campaigns];
    } catch (e) {
      errorMsg = formatError(e);
    }
  }
</script>

<svelte:head><title>Evergreen machine · Tools</title></svelte:head>

<section class="mx-auto max-w-3xl space-y-5">
  <header class="flex items-start justify-between gap-3">
    <div>
      <div class="hero-eyebrow">Tools</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
        Evergreen machine
      </h1>
      <p class="mt-1 text-sm text-ink-500">
        Turn your records into rotating social posts. Pick filters, write a template with
        {'{tokens}'}, generate a copyable brief — posting happens in Claude, not here.
      </p>
    </div>
    <button class="btn-primary shrink-0" disabled={creating} onclick={newCampaign}>
      {creating ? 'Creating…' : '+ New campaign'}
    </button>
  </header>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 text-sm" style="color: #C0392B;">
      {errorMsg}
    </div>
  {/if}

  {#if campaigns.length === 0 && !errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-10 text-center text-ink-500">
      <span class="inline-flex text-ink-300"><Icon name="sparkles" size={28} /></span>
      <p class="mt-2">No campaigns yet. Create one to start the rotation.</p>
    </div>
  {/if}

  <ul class="space-y-3">
    {#each campaigns as c (c.id)}
      <li class="overflow-hidden rounded-[14px] border border-surface-border bg-surface-card transition hover:bg-surface-hover">
        <div class="flex items-center gap-3 px-4 py-3">
          <a href={`/tools/evergreen/${c.id}`} class="flex min-w-0 flex-1 items-center gap-3">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center"
              style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);"
            >
              <Icon name="sparkles" size={16} />
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2">
                <span class="truncate font-medium text-ink-900">{c.name ?? '(untitled)'}</span>
                {#if c.status === 'draft'}
                  <span class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase" style="background: var(--bg-tertiary); color: var(--text-secondary);">draft</span>
                {/if}
              </span>
              <span class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-500">
                <span>{SOURCE_LABEL[c.source_collection ?? ''] ?? c.source_collection}</span>
                {#if c.platforms?.length}
                  <span>·</span>
                  <span>{c.platforms.map((p) => CAMPAIGN_PLATFORM_LABEL[p as CampaignPlatform] ?? p).join(', ')}</span>
                {/if}
              </span>
            </span>
          </a>
          <button
            class="btn-ghost !px-2 shrink-0 text-xs"
            title="Duplicate campaign"
            aria-label="Duplicate campaign"
            onclick={() => duplicate(c)}
          >
            <Icon name="copy" size={15} />
          </button>
          <a href={`/tools/evergreen/${c.id}`} class="shrink-0 text-ink-300" aria-label="Open campaign">
            <Icon name="chevron-right" size={14} />
          </a>
        </div>
      </li>
    {/each}
  </ul>
</section>
