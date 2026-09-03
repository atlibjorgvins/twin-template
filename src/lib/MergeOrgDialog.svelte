<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import { goto } from '$app/navigation';
  import {
    searchOrgs,
    mergePreview,
    mergeOrgInto,
    avatarSrc,
    formatError,
    type Organization,
    type MergePreview
  } from '$lib/directus';

  type Props = {
    source: Organization;
    open: boolean;
    onClose: () => void;
  };
  let { source, open = $bindable(false), onClose }: Props = $props();

  // ─── Picker state ───────────────────────────────────────────────────────
  let q = $state('');
  let results = $state<Organization[]>([]);
  let target = $state<Organization | null>(null);
  let preview = $state<MergePreview | null>(null);
  let busyPreview = $state(false);
  let busyMerge = $state(false);
  let error = $state('');

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  function onQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    q = v;
    target = null;
    preview = null;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!v.trim()) { results = []; return; }
      try {
        // Always include archived orgs in merge picker — sometimes the
        // canonical row was previously archived by the user.
        results = ((await searchOrgs(v, 8, [], { includeArchived: true, includeInactive: true })) as Organization[])
          .filter((o) => o.id !== source.id);
      } catch (e) {
        error = formatError(e);
      }
    }, 180);
  }

  async function pickTarget(o: Organization) {
    target = o;
    results = [];
    q = o.name ?? '';
    busyPreview = true;
    error = '';
    try {
      preview = await mergePreview(source.id, o.id);
    } catch (e) {
      error = formatError(e);
      preview = null;
    } finally {
      busyPreview = false;
    }
  }

  function clearTarget() {
    target = null;
    preview = null;
    q = '';
  }

  async function executeMerge() {
    if (!target) return;
    busyMerge = true;
    error = '';
    try {
      await mergeOrgInto(source.id, target.id);
      // After merge, the source is archived. Send the user to the survivor.
      goto(`/orgs/${target.id}`);
      open = false;
    } catch (e) {
      error = formatError(e);
    } finally {
      busyMerge = false;
    }
  }

  function close() {
    if (busyMerge) return;
    open = false;
    onClose?.();
  }

  const totalCount = $derived(
    preview ? Object.values(preview.counts).reduce((a, b) => a + b, 0) : 0
  );
</script>

{#if open}
  <div
    class="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Merge organization"
    onclick={close}
    onkeydown={(e) => e.key === 'Escape' && close()}
    tabindex="-1"
  >
    <div
      class="card w-full max-w-lg rounded-b-none rounded-t-card max-h-[92vh] overflow-y-auto scroll-momentum p-5 space-y-3 pb-safe-plus-2 sm:max-h-[85vh] sm:rounded-card sm:pb-5"
      role="document"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      tabindex="-1"
    >
      <div class="flex items-start justify-between">
        <div>
          <div class="card-title"><Icon name="building" size={16} /> Merge {source.name ?? 'this org'} into…</div>
          <div class="mt-1 text-xs text-ink-500">
            Move all roles, activities, events, projects and tags onto another org. The current row is then archived and points at its successor.
          </div>
        </div>
        <button class="btn-ghost !px-2" onclick={close} aria-label="Close" disabled={busyMerge}>×</button>
      </div>

      {#if error}
        <div class="rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">
          {error}
        </div>
      {/if}

      <!-- Target picker -->
      <div class="relative">
        <label class="block text-xs text-ink-400 mb-1" for="merge-target">Target organization</label>
        <input
          id="merge-target"
          type="text"
          autocomplete="off"
          class="input w-full"
          placeholder="Search by name, kennitala, tag…"
          value={q}
          oninput={onQuery}
          disabled={busyMerge}
        />
        {#if results.length > 0}
          <ul class="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-[10px] border border-surface-border bg-surface-card shadow-card">
            {#each results as o (o.id)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
                  onclick={() => pickTarget(o)}
                >
                  <Avatar name={o.name ?? '?'} src={avatarSrc(o.logo, o.image_focal, 48)} size={24} position={o.image_focal ?? ''} />
                  <span class="min-w-0 flex-1 truncate">{o.name}</span>
                  {#if o.kennitala}<span class="shrink-0 text-xs text-ink-400">{o.kennitala}</span>{/if}
                  {#if o.status === 'archived'}<span class="shrink-0 text-[10px] uppercase text-ink-400">archived</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      {#if target}
        <div class="rounded-[10px] border border-surface-divider bg-surface-hover/40 p-3">
          <div class="flex items-center gap-2">
            <Avatar name={target.name ?? '?'} src={avatarSrc(target.logo, target.image_focal, 48)} size={28} position={target.image_focal ?? ''} />
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-ink-900">{target.name}</div>
              {#if target.kennitala}<div class="text-xs text-ink-500">kt: {target.kennitala}</div>{/if}
            </div>
            <button class="text-xs text-ink-400 hover:text-ink-700" onclick={clearTarget}>change</button>
          </div>

          {#if busyPreview}
            <div class="mt-3 text-xs text-ink-400">Counting what will move…</div>
          {:else if preview}
            <div class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span class="text-ink-500">Roles</span><span class="text-right tabular-nums text-ink-900">{preview.counts.roles}</span>
              <span class="text-ink-500">Activities</span><span class="text-right tabular-nums text-ink-900">{preview.counts.activities}</span>
              <span class="text-ink-500">Calendar events</span><span class="text-right tabular-nums text-ink-900">{preview.counts.dates}</span>
              <span class="text-ink-500">Projects (owned)</span><span class="text-right tabular-nums text-ink-900">{preview.counts.projects}</span>
              <span class="text-ink-500">Project links</span><span class="text-right tabular-nums text-ink-900">{preview.counts.projectLinks}</span>
              <span class="text-ink-500">Grant awards</span><span class="text-right tabular-nums text-ink-900">{preview.counts.grants}</span>
              <span class="text-ink-500">Photos</span><span class="text-right tabular-nums text-ink-900">{preview.counts.photos}</span>
              <span class="text-ink-500">Notes</span><span class="text-right tabular-nums text-ink-900">{preview.counts.notes}</span>
              <span class="text-ink-500">Tags</span><span class="text-right tabular-nums text-ink-900">{preview.counts.tags}</span>
              <span class="col-span-2 mt-1 border-t border-surface-divider pt-1 text-ink-700"><strong>{totalCount}</strong> items will move from <em>{source.name}</em> into <em>{target.name}</em>.</span>
            </div>
            <div class="mt-2 text-[11px] leading-snug text-ink-400">
              <em>{source.name}</em> will be marked archived &amp; inactive, and its <code>successor_id</code> set to <em>{target.name}</em>. <em>{target.name}</em>'s <code>previous_names</code> will gain <em>{source.name}</em>.
            </div>
          {/if}
        </div>
      {/if}

      <div class="flex items-center justify-end gap-2 pt-1">
        <button class="btn-ghost" onclick={close} disabled={busyMerge}>Cancel</button>
        <button
          class="btn-primary"
          onclick={executeMerge}
          disabled={!target || busyPreview || busyMerge}
          title={!target ? 'Pick a target first' : ''}
        >
          {busyMerge ? 'Merging…' : 'Merge & archive source'}
        </button>
      </div>
    </div>
  </div>
{/if}
