<script lang="ts">
  // Admin list for the PhotoType catalogue — the fixed set of photo
  // kinds selectable on org photos. Inline rename + archive, create
  // form at the top. Mirrors ActivityKindAdmin, just simpler.
  import {
    listPhotoTypes,
    createPhotoType,
    updatePhotoType,
    formatError,
    type PhotoType
  } from '$lib/directus';

  let types = $state<PhotoType[]>([]);
  let loading = $state(true);
  let error = $state('');
  let savingId = $state<number | null>(null);

  async function refresh() {
    loading = true;
    try {
      types = await listPhotoTypes({ includeArchived: true });
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void refresh();
  });

  async function patch(id: number, fields: Partial<PhotoType>) {
    savingId = id;
    error = '';
    try {
      const updated = await updatePhotoType(id, fields);
      types = types.map((t) => (t.id === id ? { ...t, ...updated } : t));
    } catch (e) {
      error = formatError(e);
    } finally {
      savingId = null;
    }
  }

  let newName = $state('');
  let creating = $state(false);
  async function create() {
    const name = newName.trim();
    if (!name) return;
    creating = true;
    error = '';
    try {
      const next = await createPhotoType({
        name,
        status: 'published',
        sort: (types.reduce((max, t) => Math.max(max, t.sort ?? 0), 0) ?? 0) + 10
      });
      types = [...types, next];
      newName = '';
    } catch (e) {
      error = formatError(e);
    } finally {
      creating = false;
    }
  }
</script>

<div class="space-y-3">
  {#if error}
    <div class="rounded-md border border-surface-border bg-surface-card p-3 text-sm" style="color: #C0392B;">{error}</div>
  {/if}

  <form
    class="flex items-center gap-2"
    onsubmit={(e) => {
      e.preventDefault();
      void create();
    }}
  >
    <input class="input flex-1" placeholder="New photo type — e.g. Team offsite" bind:value={newName} />
    <button class="btn-primary shrink-0" disabled={creating || !newName.trim()} type="submit">
      {creating ? 'Adding…' : '+ Add'}
    </button>
  </form>

  {#if loading}
    <div class="py-6 text-center text-sm text-ink-400">Loading…</div>
  {:else if types.length === 0}
    <div class="py-6 text-center text-sm text-ink-400">No photo types yet — add the first above.</div>
  {:else}
    <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
      {#each types as t (t.id)}
        <li class="flex items-center gap-3 px-4 py-2.5" class:opacity-50={t.status === 'archived'}>
          <input
            class="input flex-1 !py-1 text-sm"
            value={t.name ?? ''}
            disabled={savingId === t.id}
            onchange={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value.trim();
              if (v && v !== t.name) void patch(t.id, { name: v });
            }}
          />
          {#if t.status === 'archived'}
            <button class="btn-ghost !px-2 text-[11px]" disabled={savingId === t.id} onclick={() => patch(t.id, { status: 'published' })}>
              Restore
            </button>
          {:else}
            <button class="btn-ghost !px-2 text-[11px]" disabled={savingId === t.id} onclick={() => patch(t.id, { status: 'archived' })}>
              Archive
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    <p class="px-1 text-xs text-ink-400">
      Archiving hides a type from the picker — photos already labelled with it keep the label.
    </p>
  {/if}
</div>
