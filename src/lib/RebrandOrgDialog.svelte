<script lang="ts">
  // Rebrands the source org into a target: the same entity took a new
  // name. Relations (people, activities, events, project links, grants,
  // photos, tags, notes) transfer onto the new identity; the old row
  // stays findable as a "previously known as" record (lifecycle
  // 'rebranded', not archived) and the target keeps the name trail so
  // projects can show "New (fka Old)".
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import { goto } from '$app/navigation';
  import {
    searchOrgs,
    rebrandOrgTo,
    mergePreview,
    avatarSrc,
    formatError,
    type MergePreview,
    type Organization
  } from '$lib/directus';

  type Props = {
    source: Organization;
    open: boolean;
    onClose: () => void;
  };
  let { source, open = $bindable(false), onClose }: Props = $props();

  let q = $state('');
  let results = $state<Organization[]>([]);
  let target = $state<Organization | null>(null);
  let preview = $state<MergePreview | null>(null);
  let previewing = $state(false);
  let busy = $state(false);
  let error = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  const totalCount = $derived(
    preview ? Object.values(preview.counts).reduce((a, b) => a + b, 0) : 0
  );

  function onQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    q = v;
    target = null;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!v.trim()) { results = []; return; }
      try {
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
    preview = null;
    previewing = true;
    try {
      preview = await mergePreview(source.id, o.id);
    } catch (e) {
      error = formatError(e);
    } finally {
      previewing = false;
    }
  }
  function clearTarget() { target = null; q = ''; preview = null; }

  async function execute() {
    if (!target) return;
    busy = true; error = '';
    try {
      await rebrandOrgTo(source.id, target.id);
      goto(`/orgs/${target.id}`);
      open = false;
    } catch (e) {
      error = formatError(e);
    } finally { busy = false; }
  }

  function close() { if (busy) return; onClose(); }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-900/40"
    role="presentation"
    onclick={close}
  >
    <div
      class="w-full max-w-lg bg-surface-card"
      style="border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: 0 24px 60px rgba(0, 0, 0, 0.32), 0 4px 16px rgba(0, 0, 0, 0.18);"
      role="dialog"
      aria-modal="true"
      aria-label="Mark as rebranded"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      tabindex="-1"
    >
      <div class="flex items-center justify-between gap-2 border-b border-surface-divider px-4 py-3">
        <h2 class="font-display text-sm font-semibold" style="letter-spacing: -0.01em;">Mark as rebranded</h2>
        <button type="button" class="text-ink-400 hover:text-ink-700" aria-label="Close" onclick={close}>
          <Icon name="x" size={16} />
        </button>
      </div>

      <div class="space-y-3 px-4 py-3 text-sm">
        <p class="text-ink-500">
          <span class="font-medium text-ink-700">{source.name}</span> rebranded into another organisation.
          Its relations (people, activities, events, project links, grants, photos, tags, notes) transfer to the
          new identity; the old name stays recorded so projects can show “New (fka {source.name})”. Pick the new identity below.
        </p>

        {#if error}
          <div class="rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">{error}</div>
        {/if}

        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">New identity</span>
          <input type="text" autocomplete="off" class="input w-full" placeholder="Search organisations…" value={q} oninput={onQuery} />
        </label>
        {#if results.length > 0}
          <ul class="max-h-56 overflow-auto rounded-[10px] border border-surface-border bg-surface-card">
            {#each results as o (o.id)}
              <li>
                <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => pickTarget(o)}>
                  <Avatar name={o.name ?? '?'} src={avatarSrc(o.logo, o.image_focal, 40)} size={24} />
                  <span class="truncate">{o.name}</span>
                  {#if o.industry}<span class="ml-auto text-xs text-ink-400 truncate">{o.industry}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if target}
          <div class="rounded-[10px] border border-surface-border bg-surface-hover/40 p-3 text-sm">
            <div class="flex items-center gap-2">
              <Avatar name={target.name ?? '?'} src={avatarSrc(target.logo, target.image_focal, 40)} size={28} />
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium text-ink-900">{target.name}</div>
                <div class="text-xs text-ink-500">Relations move here; {source.name} stays as a “formerly known as” record.</div>
              </div>
              <button type="button" class="text-xs text-ink-400 hover:text-ink-700" onclick={clearTarget}>Change</button>
            </div>
          </div>
          {#if previewing}
            <div class="text-xs text-ink-400">Counting what will move…</div>
          {:else if preview}
            <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span class="text-ink-500">Roles</span><span class="text-right tabular-nums text-ink-900">{preview.counts.roles}</span>
              <span class="text-ink-500">Activities</span><span class="text-right tabular-nums text-ink-900">{preview.counts.activities}</span>
              <span class="text-ink-500">Calendar events</span><span class="text-right tabular-nums text-ink-900">{preview.counts.dates}</span>
              <span class="text-ink-500">Projects (owned)</span><span class="text-right tabular-nums text-ink-900">{preview.counts.projects}</span>
              <span class="text-ink-500">Project links</span><span class="text-right tabular-nums text-ink-900">{preview.counts.projectLinks}</span>
              <span class="text-ink-500">Grant awards</span><span class="text-right tabular-nums text-ink-900">{preview.counts.grants}</span>
              <span class="text-ink-500">Photos</span><span class="text-right tabular-nums text-ink-900">{preview.counts.photos}</span>
              <span class="text-ink-500">Notes</span><span class="text-right tabular-nums text-ink-900">{preview.counts.notes}</span>
              <span class="text-ink-500">Tags</span><span class="text-right tabular-nums text-ink-900">{preview.counts.tags}</span>
              <span class="col-span-2 mt-1 border-t border-surface-divider pt-1 text-ink-700"><strong>{totalCount}</strong> items move from <em>{source.name}</em> onto <em>{target.name}</em>.</span>
            </div>
          {/if}
          <ul class="space-y-1 text-xs text-ink-500">
            <li>· <em>{source.name}</em> → lifecycle <strong>Rebranded</strong>, marked inactive (kept findable, not archived).</li>
            <li>· <em>{target.name}</em>.previous_names gains <em>{source.name}</em> → shows as “{target.name} (fka {source.name})”.</li>
          </ul>
        {/if}
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-surface-divider px-4 py-3">
        <button class="btn-ghost" onclick={close} disabled={busy}>Cancel</button>
        <button class="btn-primary" onclick={execute} disabled={busy || !target}>
          {busy ? 'Marking…' : 'Mark as rebranded'}
        </button>
      </div>
    </div>
  </div>
{/if}
