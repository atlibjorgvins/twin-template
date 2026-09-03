<script lang="ts">
  // Admin table for the shared `Tag` collection. Inline-edit rows so
  // changes feel cheap. Archive instead of delete — anyone tagged with
  // an archived tag keeps the row, but the tag won't appear in pickers.
  import Icon from '$lib/Icon.svelte';
  import {
    listTags,
    createTag,
    updateTag,
    formatError,
    type Tag
  } from '$lib/directus';

  let tags = $state<Tag[]>([]);
  let loading = $state(true);
  let error = $state('');
  let savingId = $state<number | null>(null);

  async function refresh() {
    loading = true;
    try {
      tags = await listTags({ includeArchived: true });
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => { void refresh(); });

  // ── Inline edit ────────────────────────────────────────────────────────
  async function patch(id: number, fields: Partial<Tag>) {
    savingId = id;
    error = '';
    try {
      const updated = await updateTag(id, fields);
      tags = tags.map((t) => (t.id === id ? { ...t, ...updated } : t));
    } catch (e) {
      error = formatError(e);
    } finally {
      savingId = null;
    }
  }

  // ── Create new ─────────────────────────────────────────────────────────
  let newName = $state('');
  let newColor = $state('');
  let newScope = $state<'' | 'work' | 'private' | 'both'>('');
  let creating = $state(false);
  async function create() {
    const name = newName.trim();
    if (!name) return;
    creating = true;
    error = '';
    try {
      const t = await createTag({
        name,
        color: newColor || null,
        scope: newScope || null
      });
      tags = [t, ...tags];
      newName = '';
      newColor = '';
      newScope = '';
    } catch (e) {
      error = formatError(e);
    } finally {
      creating = false;
    }
  }

  // Scope options for the dropdown — empty string maps to NULL on save.
  const SCOPES: { value: '' | 'work' | 'private' | 'both'; label: string }[] = [
    { value: '', label: '—' },
    { value: 'work', label: 'Work' },
    { value: 'private', label: 'Private' },
    { value: 'both', label: 'Both' }
  ];
</script>

<div class="space-y-3">
  {#if error}
    <div
      class="px-3 py-2 text-xs"
      style="background: var(--bg-tertiary); color: var(--state-danger); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
    >{error}</div>
  {/if}

  <!-- Create new -->
  <div class="card p-3">
    <div class="card-title mb-2"><Icon name="plus" size={14} /> Create tag</div>
    <div class="flex flex-wrap items-center gap-2">
      <input
        type="text"
        class="input min-w-0 flex-1"
        placeholder="Tag name (e.g. investor)"
        bind:value={newName}
        onkeydown={(e) => { if (e.key === 'Enter') void create(); }}
      />
      <label class="inline-flex items-center gap-1 text-xs text-ink-500">
        Color
        <input type="color" bind:value={newColor} title="Optional color" />
      </label>
      <label class="inline-flex items-center gap-1 text-xs text-ink-500">
        Scope
        <select class="input" bind:value={newScope}>
          {#each SCOPES as s (s.value)}
            <option value={s.value}>{s.label}</option>
          {/each}
        </select>
      </label>
      <button class="btn-primary" onclick={create} disabled={creating || !newName.trim()}>
        {creating ? 'Creating…' : 'Create'}
      </button>
    </div>
  </div>

  <!-- List -->
  {#if loading}
    <div class="text-sm text-ink-400">Loading tags…</div>
  {:else if tags.length === 0}
    <div class="text-sm text-ink-400">No tags yet. Create one above.</div>
  {:else}
    <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
      {#each tags as t (t.id)}
        {@const archived = t.status === 'archived'}
        {@const saving = savingId === t.id}
        <li class="flex flex-wrap items-center gap-3 px-3 py-2 text-sm {archived ? 'opacity-60' : ''}">
          <!-- Color swatch + name (inline-editable on blur) -->
          <label class="inline-flex items-center" title="Color">
            <input
              type="color"
              value={t.color ?? '#000000'}
              onchange={(e) => patch(t.id, { color: (e.currentTarget as HTMLInputElement).value })}
            />
          </label>
          <input
            type="text"
            class="min-w-0 flex-1 bg-transparent px-1 font-medium text-ink-900 focus:outline-none"
            value={t.name}
            onblur={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value.trim();
              if (v && v !== t.name) void patch(t.id, { name: v });
            }}
            onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
          />
          <label class="inline-flex items-center gap-1 text-xs text-ink-500" title="Scope">
            Scope
            <select
              class="input"
              value={t.scope ?? ''}
              onchange={(e) =>
                patch(t.id, { scope: ((e.currentTarget as HTMLSelectElement).value || null) as Tag['scope'] })}
            >
              {#each SCOPES as s (s.value)}
                <option value={s.value}>{s.label}</option>
              {/each}
            </select>
          </label>
          {#if saving}
            <span class="text-[10px] uppercase tracking-wider text-ink-400">saving…</span>
          {/if}
          <button
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs"
            style="border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: {archived ? 'var(--accent-electric)' : 'var(--state-danger)'};"
            onclick={() => patch(t.id, { status: archived ? 'published' : 'archived' })}
            title={archived ? 'Restore tag' : 'Archive tag'}
          >
            <Icon name="tag" size={12} />
            {archived ? 'Restore' : 'Archive'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
