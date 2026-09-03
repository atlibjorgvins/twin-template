<script lang="ts">
  // Social profiles for one organization.
  //
  // These lived in five columns (linkedin, linkedin_url, instagram, facebook,
  // twitter) of which the page rendered exactly one — 381 stored values were
  // invisible, and LinkedIn existed twice. They are rows now, so a new network
  // costs nothing and nothing hides.
  //
  // `platform` is free text on purpose. The catalogue below supplies a label
  // and an icon for the ones twin knows; anything else still renders, just
  // without a branded icon. An enum would mean a migration per network, which
  // is what left four of the five columns unrendered in the first place.
  import Icon from '$lib/Icon.svelte';
  import { formatError } from '$lib/directus';
  import {
    SOCIAL_CATALOGUE,
    listSocials,
    createSocial,
    updateSocialUrl,
    deleteSocial,
    socialLabel,
    socialMeta,
    toSocialUrl,
    socialDisplay,
    type OrgSocial as Social,
    type SocialTarget
  } from '$lib/orgSocial';

  // onRows lets the page header show the same glyphs without a second query,
  // and keeps them correct the moment one is added or removed here.
  // `target` is the only difference between an organization's profiles and a
  // person's: same columns, same catalogue, same parsing, different table.
  let {
    orgId,
    target = 'organization',
    editing = false,
    onRows
  }: {
    orgId: number;
    target?: SocialTarget;
    editing?: boolean;
    onRows?: (rows: Social[]) => void;
  } = $props();

  const CATALOGUE = SOCIAL_CATALOGUE;
  const meta = socialMeta;
  const labelOf = socialLabel;

  let rows = $state<Social[]>([]);
  let loading = $state(true);
  let error = $state('');
  let adding = $state(false);
  let newPlatform = $state('linkedin');
  let newValue = $state('');

  $effect(() => {
    void orgId;
    void target;
    void load();
  });

  async function load() {
    loading = true;
    try {
      rows = await listSocials(target, orgId);
      onRows?.(rows);
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }


  async function add() {
    const url = toSocialUrl(newPlatform, newValue);
    if (!url) return;
    adding = true;
    try {
      const created = await createSocial(target, orgId, newPlatform, url, rows.length + 1);
      rows = [...rows, created];
      onRows?.(rows);
      newValue = '';
    } catch (e) {
      error = formatError(e);
    } finally {
      adding = false;
    }
  }

  async function patch(s: Social, raw: string) {
    const url = toSocialUrl(s.platform, raw);
    if (url === (s.url ?? '')) return;
    try {
      await updateSocialUrl(target, s.id, url);
      rows = rows.map((r) => (r.id === s.id ? { ...r, url } : r));
    } catch (e) {
      error = formatError(e);
    }
  }

  async function remove(s: Social) {
    if (!confirm(`Remove the ${labelOf(s.platform)} link?`)) return;
    try {
      await deleteSocial(target, s.id);
      rows = rows.filter((r) => r.id !== s.id);
      onRows?.(rows);
    } catch (e) {
      error = formatError(e);
    }
  }
</script>

{#if editing || rows.length > 0}
  <div class="card">
    <div class="card-header">
      <span class="card-title"><Icon name="globe" size={16} /> Social
        {#if rows.length > 0}<span class="font-normal text-ink-300">{rows.length}</span>{/if}
      </span>
    </div>

    {#if error}<p class="px-4 pb-2 text-xs text-tag-salesText">{error}</p>{/if}

    {#if loading}
      <p class="px-4 pb-4 text-sm text-ink-400">Loading…</p>
    {:else}
      <ul class="divide-y divide-surface-divider">
        {#each rows as s (s.id)}
          {@const m = meta(s.platform)}
          <li class="flex flex-wrap items-center gap-2 px-4 py-2">
            <span class="flex w-24 shrink-0 items-center gap-1.5 text-xs text-ink-500">
              {#if m?.icon}<Icon name={m.icon} size={14} />{/if}
              {labelOf(s.platform)}
            </span>
            {#if editing}
              <input
                class="input min-w-0 flex-1 text-sm"
                value={s.url ?? ''}
                placeholder="URL or @handle"
                onblur={(e) => patch(s, (e.currentTarget as HTMLInputElement).value)}
              />
              <button
                class="btn-ghost !px-2 shrink-0 text-ink-300 hover:text-ink-700"
                title="Remove"
                aria-label={`Remove ${labelOf(s.platform)}`}
                onclick={() => remove(s)}
              ><Icon name="x" size={13} /></button>
            {:else}
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                class="min-w-0 flex-1 truncate text-sm text-ink-900 hover:underline"
              >{socialDisplay(s)}</a>
            {/if}
          </li>
        {/each}
        {#if rows.length === 0}
          <li class="px-4 py-3 text-sm text-ink-400">No social profiles yet.</li>
        {/if}
      </ul>

      {#if editing}
        <div class="flex flex-wrap items-center gap-2 px-4 py-3">
          <select class="input !w-auto text-sm" bind:value={newPlatform}>
            {#each CATALOGUE as c (c.key)}<option value={c.key}>{c.label}</option>{/each}
          </select>
          <input
            class="input min-w-0 flex-1 text-sm"
            placeholder="URL or @handle"
            bind:value={newValue}
            onkeydown={(e) => { if (e.key === 'Enter') add(); }}
          />
          <button class="btn-primary shrink-0" disabled={adding || !newValue.trim()} onclick={add}>
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
      {/if}
    {/if}
  </div>
{/if}
