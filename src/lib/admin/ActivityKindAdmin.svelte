<script lang="ts">
  // Admin table for the dynamic `ActivityKind` catalogue. Each kind
  // has emoji + icon + color so chips and badges everywhere stay on
  // brand. Inline-edit per row + create form at the top.
  import Icon from '$lib/Icon.svelte';
  import IconPicker from './IconPicker.svelte';
  import {
    listActivityKinds,
    createActivityKind,
    updateActivityKind,
    formatError,
    type ActivityKind
  } from '$lib/directus';

  let kinds = $state<ActivityKind[]>([]);
  let loading = $state(true);
  let error = $state('');
  let savingId = $state<number | null>(null);

  async function refresh() {
    loading = true;
    try {
      kinds = await listActivityKinds({ includeArchived: true, force: true });
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => { void refresh(); });

  async function patch(id: number, fields: Partial<ActivityKind>) {
    savingId = id;
    error = '';
    try {
      const updated = await updateActivityKind(id, fields);
      kinds = kinds.map((k) => (k.id === id ? { ...k, ...updated } : k));
    } catch (e) {
      error = formatError(e);
    } finally {
      savingId = null;
    }
  }

  // ── Create new ─────────────────────────────────────────────────────────
  let newKey = $state('');
  let newLabel = $state('');
  let newIcon = $state<string | null>(null);
  let newColor = $state('#2C8C99');
  let newSig = $state<'minor' | 'normal' | 'major'>('normal');
  let creating = $state(false);
  async function create() {
    const key = newKey.trim();
    const label = newLabel.trim();
    if (!key || !label) return;
    creating = true;
    error = '';
    try {
      const next = await createActivityKind({
        key,
        label,
        icon: newIcon,
        color: newColor || null,
        default_significance: newSig,
        sort: (kinds.reduce((max, k) => Math.max(max, k.sort ?? 0), 0) ?? 0) + 10,
        status: 'published'
      });
      kinds = [...kinds, next];
      newKey = '';
      newLabel = '';
      newIcon = null;
      newColor = '#2C8C99';
      newSig = 'normal';
    } catch (e) {
      error = formatError(e);
    } finally {
      creating = false;
    }
  }

  const SIG_OPTS: { value: 'minor' | 'normal' | 'major'; label: string }[] = [
    { value: 'minor', label: 'Minor' },
    { value: 'normal', label: 'Normal' },
    { value: 'major', label: 'Major' }
  ];
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

  <!-- Create -->
  <div class="card p-3 space-y-2">
    <div class="card-title"><Icon name="plus" size={14} /> Create activity kind</div>
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-6">
      <label class="sm:col-span-2 block">
        <span class="block text-xs text-ink-400 mb-1">Key (slug — stable)</span>
        <input
          type="text"
          class="input w-full"
          placeholder="e.g. drop_in"
          bind:value={newKey}
        />
      </label>
      <label class="sm:col-span-2 block">
        <span class="block text-xs text-ink-400 mb-1">Label</span>
        <input
          type="text"
          class="input w-full"
          placeholder="e.g. Drop-in"
          bind:value={newLabel}
        />
      </label>
      <div>
        <span class="block text-xs text-ink-400 mb-1">Icon</span>
        <IconPicker value={newIcon} onChange={(v) => (newIcon = v)} />
      </div>
      <label class="block">
        <span class="block text-xs text-ink-400 mb-1">Color</span>
        <input type="color" bind:value={newColor} class="h-9 w-full rounded-md border border-surface-border bg-surface-card" />
      </label>
      <label class="block">
        <span class="block text-xs text-ink-400 mb-1">Default significance</span>
        <select class="input w-full" bind:value={newSig}>
          {#each SIG_OPTS as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
        </select>
      </label>
      <div class="sm:col-span-6 flex justify-end">
        <button
          class="btn-primary"
          onclick={create}
          disabled={creating || !newKey.trim() || !newLabel.trim()}
        >{creating ? 'Creating…' : 'Create kind'}</button>
      </div>
    </div>
  </div>

  <!-- List -->
  {#if loading}
    <div class="text-sm text-ink-400">Loading kinds…</div>
  {:else}
    <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
      {#each kinds as k (k.id)}
        {@const archived = k.status === 'archived'}
        {@const saving = savingId === k.id}
        <li class="flex flex-wrap items-center gap-3 px-3 py-2 text-sm {archived ? 'opacity-60' : ''}">
          <!-- Preview chip — matches QuickLogChips / ActivityCard / the
               /interactions feed. Prefer the Helga outline icon; fall
               back to the emoji only when no icon is set on the row. -->
          <span
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center text-base leading-none"
            style={`border-radius: var(--radius-md); ${k.color ? `background: ${k.color}22; color: ${k.color};` : 'background: var(--bg-tertiary); color: var(--text-secondary);'}`}
            title={k.key}
          >
            {#if k.icon}<Icon name={k.icon as never} size={14} />{:else if k.emoji}<span aria-hidden="true">{k.emoji}</span>{:else}<Icon name="bolt" size={14} />{/if}
          </span>
          <input
            type="text"
            class="min-w-[8rem] flex-1 bg-transparent px-1 font-medium text-ink-900 focus:outline-none"
            value={k.label}
            onblur={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value.trim();
              if (v && v !== k.label) void patch(k.id, { label: v });
            }}
            onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
          />
          <span class="font-mono text-[11px] text-ink-400">{k.key}</span>
          <IconPicker value={k.icon ?? null} onChange={(v) => patch(k.id, { icon: v })} />
          <input
            type="color"
            value={k.color ?? '#000000'}
            onchange={(e) => patch(k.id, { color: (e.currentTarget as HTMLInputElement).value })}
            title="Color"
          />
          <select
            class="input"
            value={k.default_significance ?? 'normal'}
            onchange={(e) => patch(k.id, { default_significance: (e.currentTarget as HTMLSelectElement).value as ActivityKind['default_significance'] })}
            title="Default significance"
          >
            {#each SIG_OPTS as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
          </select>
          <select
            class="input"
            value={k.scope ?? ''}
            onchange={(e) => patch(k.id, { scope: ((e.currentTarget as HTMLSelectElement).value || null) as ActivityKind['scope'] })}
            title="Scope"
          >
            {#each SCOPES as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
          </select>
          <input
            type="number"
            class="w-16 bg-transparent px-1 text-right focus:outline-none"
            value={k.sort ?? 0}
            min={0}
            step={10}
            onblur={(e) => {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              if (!Number.isNaN(v) && v !== (k.sort ?? 0)) void patch(k.id, { sort: v });
            }}
            title="Sort order (lower = first)"
          />
          {#if saving}
            <span class="text-[10px] uppercase tracking-wider text-ink-400">saving…</span>
          {/if}
          <button
            type="button"
            class="inline-flex items-center gap-1 px-2 py-1 text-xs"
            style="border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: {archived ? 'var(--accent-electric)' : 'var(--state-danger)'};"
            onclick={() => patch(k.id, { status: archived ? 'published' : 'archived' })}
          >{archived ? 'Restore' : 'Archive'}</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
