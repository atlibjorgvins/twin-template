<script lang="ts">
  // Admin table for the ProjectRole catalogue. Each row is the
  // canonical {key, label, applies_to, color, sort} for a role that
  // can be picked on Project_people / Project_organization. Create
  // at the top; inline-edit per row; archive to retire without
  // breaking historical junction rows that still reference the key.
  import Icon from '$lib/Icon.svelte';
  import {
    listProjectRoles,
    createProjectRole,
    updateProjectRole,
    formatError,
    type ProjectRole
  } from '$lib/directus';

  let roles = $state<ProjectRole[]>([]);
  let loading = $state(true);
  let error = $state('');
  let savingId = $state<number | null>(null);

  async function refresh() {
    loading = true;
    try {
      roles = await listProjectRoles({ includeArchived: true, force: true });
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => { void refresh(); });

  async function patch(id: number, fields: Partial<ProjectRole>) {
    savingId = id;
    error = '';
    try {
      const updated = await updateProjectRole(id, fields);
      roles = roles.map((r) => (r.id === id ? { ...r, ...updated } : r));
    } catch (e) {
      error = formatError(e);
    } finally {
      savingId = null;
    }
  }

  // ── Create ─────────────────────────────────────────────────────────────
  let newKey = $state('');
  let newLabel = $state('');
  let newAppliesTo = $state<'person' | 'org' | 'both'>('both');
  let newColor = $state('');
  let creating = $state(false);

  function autoKey(label: string): string {
    return label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
  }

  async function create() {
    const key = (newKey.trim() || autoKey(newLabel));
    const label = newLabel.trim();
    if (!key || !label) return;
    creating = true; error = '';
    try {
      const next = await createProjectRole({
        key,
        label,
        applies_to: newAppliesTo,
        color: newColor || null,
        sort: (roles.reduce((m, r) => Math.max(m, r.sort ?? 0), 0) ?? 0) + 10,
        status: 'published'
      });
      roles = [...roles, next];
      newKey = ''; newLabel = ''; newAppliesTo = 'both'; newColor = '';
    } catch (e) {
      error = formatError(e);
    } finally { creating = false; }
  }

  const APPLIES_OPTS: { value: 'person' | 'org' | 'both'; label: string }[] = [
    { value: 'person', label: 'Person' },
    { value: 'org', label: 'Org' },
    { value: 'both', label: 'Both' }
  ];
</script>

<div class="space-y-3">
  {#if error}
    <div class="px-3 py-2 text-xs" style="background: var(--bg-tertiary); color: var(--state-danger); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">{error}</div>
  {/if}

  <!-- Create -->
  <div class="card p-3 space-y-2">
    <div class="card-title"><Icon name="plus" size={14} /> Create role</div>
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-6">
      <label class="sm:col-span-2 block">
        <span class="block text-xs text-ink-400 mb-1">Label</span>
        <input
          type="text"
          class="input w-full"
          placeholder="e.g. Teacher"
          bind:value={newLabel}
          oninput={() => { if (!newKey) newKey = autoKey(newLabel); }}
        />
      </label>
      <label class="sm:col-span-2 block">
        <span class="block text-xs text-ink-400 mb-1">Key (slug — stable)</span>
        <input type="text" class="input w-full" placeholder="auto-generated" bind:value={newKey} />
      </label>
      <label class="block">
        <span class="block text-xs text-ink-400 mb-1">Applies to</span>
        <select class="input w-full" bind:value={newAppliesTo}>
          {#each APPLIES_OPTS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
        </select>
      </label>
      <label class="block">
        <span class="block text-xs text-ink-400 mb-1">Colour</span>
        <input type="color" bind:value={newColor} class="h-9 w-full rounded-md border border-surface-border bg-surface-card" />
      </label>
      <div class="sm:col-span-6 flex justify-end">
        <button class="btn-primary" onclick={create} disabled={creating || !newLabel.trim()}>
          {creating ? 'Creating…' : 'Create role'}
        </button>
      </div>
    </div>
  </div>

  <!-- List -->
  {#if loading}
    <div class="text-sm text-ink-400">Loading roles…</div>
  {:else}
    <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
      {#each roles as r (r.id)}
        {@const archived = r.status === 'archived'}
        {@const saving = savingId === r.id}
        <li class="flex flex-wrap items-center gap-3 px-3 py-2 text-sm {archived ? 'opacity-60' : ''}">
          <span
            class="inline-flex h-6 w-6 shrink-0 items-center justify-center text-xs"
            style={`border-radius: var(--radius-md); ${r.color ? `background: ${r.color}22; color: ${r.color};` : 'background: var(--bg-tertiary); color: var(--text-secondary);'}`}
            title={r.key}
          >
            <Icon name="tag" size={12} />
          </span>
          <input
            type="text"
            class="min-w-[8rem] flex-1 bg-transparent px-1 font-medium text-ink-900 focus:outline-none"
            value={r.label}
            onblur={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value.trim();
              if (v && v !== r.label) void patch(r.id, { label: v });
            }}
            onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
          />
          <span class="font-mono text-[11px] text-ink-400">{r.key}</span>
          <select
            class="input"
            value={r.applies_to ?? 'both'}
            onchange={(e) => patch(r.id, { applies_to: (e.currentTarget as HTMLSelectElement).value as 'person' | 'org' | 'both' })}
            title="Applies to"
          >
            {#each APPLIES_OPTS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          </select>
          <input
            type="color"
            value={r.color ?? '#000000'}
            onchange={(e) => patch(r.id, { color: (e.currentTarget as HTMLInputElement).value })}
            title="Colour"
          />
          <input
            type="number"
            class="w-16 bg-transparent px-1 text-right focus:outline-none"
            value={r.sort ?? 0}
            min={0}
            step={10}
            onblur={(e) => {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              if (!Number.isNaN(v) && v !== (r.sort ?? 0)) void patch(r.id, { sort: v });
            }}
            title="Sort order"
          />
          {#if saving}<span class="text-[10px] uppercase tracking-wider text-ink-400">saving…</span>{/if}
          <button
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs"
            style="border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: {archived ? 'var(--accent-electric)' : 'var(--state-danger)'};"
            onclick={() => patch(r.id, { status: archived ? 'published' : 'archived' })}
          >{archived ? 'Restore' : 'Archive'}</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
