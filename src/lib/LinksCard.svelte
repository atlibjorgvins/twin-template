<script lang="ts">
  // Labelled links / dynamic info for any entity (Project, org, person…).
  // Each row is a label + value; a value that looks like a URL renders as
  // a clickable external link, anything else as plain selectable text. An
  // optional note captures context ("shared with partners, read-only").
  import Icon from '$lib/Icon.svelte';
  import {
    listEntityLinks,
    createEntityLink,
    updateEntityLink,
    deleteEntityLink,
    formatError,
    type EntityLink
  } from '$lib/directus';
  import { onMount } from 'svelte';

  let { collection, itemId }: { collection: string; itemId: number | string } = $props();

  let links = $state<EntityLink[]>([]);
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    try { links = await listEntityLinks(collection, itemId); }
    catch (e) { error = formatError(e); }
    finally { loading = false; }
  });

  function isUrl(v?: string | null): boolean {
    return typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim());
  }
  function hostOf(v: string): string {
    try { return new URL(v).host.replace(/^www\./, ''); } catch { return v; }
  }

  // ── Add ────────────────────────────────────────────────────────────────
  let adding = $state(false);
  let newLabel = $state('');
  let newValue = $state('');
  let newNote = $state('');
  let saving = $state(false);
  async function add() {
    if (!newLabel.trim() || !newValue.trim() || saving) return;
    saving = true; error = '';
    try {
      const created = await createEntityLink(collection, itemId, {
        label: newLabel.trim(),
        value: newValue.trim(),
        note: newNote.trim() || null,
        sort: links.length
      });
      links = [...links, created];
      newLabel = ''; newValue = ''; newNote = ''; adding = false;
    } catch (e) { error = formatError(e); } finally { saving = false; }
  }

  // ── Inline edit ──────────────────────────────────────────────────────────
  let editingId = $state<number | null>(null);
  let editLabel = $state('');
  let editValue = $state('');
  let editNote = $state('');
  function startEdit(l: EntityLink) {
    editingId = l.id;
    editLabel = l.label ?? '';
    editValue = l.value ?? '';
    editNote = l.note ?? '';
  }
  async function saveEdit() {
    if (editingId == null || !editLabel.trim() || !editValue.trim()) return;
    const id = editingId;
    try {
      const patch = { label: editLabel.trim(), value: editValue.trim(), note: editNote.trim() || null };
      await updateEntityLink(id, patch);
      links = links.map((l) => (l.id === id ? { ...l, ...patch } : l));
      editingId = null;
    } catch (e) { error = formatError(e); }
  }
  async function remove(l: EntityLink) {
    if (!confirm(`Delete "${l.label}"?`)) return;
    try {
      await deleteEntityLink(l.id);
      links = links.filter((x) => x.id !== l.id);
    } catch (e) { error = formatError(e); }
  }
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title"><Icon name="link" size={16} /> Links &amp; info <span class="text-ink-300 font-normal">{links.length}</span></span>
    {#if !adding}
      <button
        class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
        onclick={() => { adding = true; }}
      ><Icon name="plus" size={14} /> Add</button>
    {/if}
  </div>

  {#if adding}
    <div class="mx-4 mb-3 space-y-2 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3">
      <input class="input w-full" placeholder="Label (e.g. Shared image library)" bind:value={newLabel} disabled={saving} />
      <input class="input w-full" placeholder="URL or text" bind:value={newValue} disabled={saving} autocomplete="off" spellcheck="false" />
      <input class="input w-full" placeholder="Note (optional — e.g. shared with partners)" bind:value={newNote} disabled={saving} />
      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost" onclick={() => { adding = false; newLabel=''; newValue=''; newNote=''; }} disabled={saving}>Cancel</button>
        <button class="btn-primary" onclick={add} disabled={saving || !newLabel.trim() || !newValue.trim()}>{saving ? 'Adding…' : 'Add'}</button>
      </div>
    </div>
  {/if}

  {#if error}<div class="mx-4 mb-2 text-xs text-tag-salesText">{error}</div>{/if}

  {#if loading}
    <div class="px-4 pb-4 text-sm text-ink-400">Loading…</div>
  {:else if links.length === 0 && !adding}
    <div class="px-4 pb-4 text-sm text-ink-400">
      Nothing yet. Add a labelled link or note — a shared drive, a brief, a reference URL.
    </div>
  {:else}
    <ul class="space-y-2 px-4 pb-4">
      {#each links as l (l.id)}
        <li class="rounded-[10px] border border-surface-divider bg-surface-hover/40 p-3">
          {#if editingId === l.id}
            <div class="space-y-2">
              <input class="input w-full" bind:value={editLabel} placeholder="Label" />
              <input class="input w-full" bind:value={editValue} placeholder="URL or text" autocomplete="off" spellcheck="false" />
              <input class="input w-full" bind:value={editNote} placeholder="Note (optional)" />
              <div class="flex items-center justify-end gap-2">
                <button class="btn-ghost" onclick={() => (editingId = null)}>Cancel</button>
                <button class="btn-primary" onclick={saveEdit} disabled={!editLabel.trim() || !editValue.trim()}>Save</button>
              </div>
            </div>
          {:else}
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-ink-900">{l.label}</div>
                {#if isUrl(l.value)}
                  <a
                    href={l.value}
                    target="_blank"
                    rel="noreferrer noopener"
                    class="mt-0.5 inline-flex items-center gap-1 text-sm text-brand hover:underline break-all"
                  >
                    <Icon name="globe" size={12} /> {hostOf(l.value ?? '')}
                    <span class="text-ink-300">↗</span>
                  </a>
                {:else}
                  <div class="mt-0.5 text-sm text-ink-700 break-words whitespace-pre-wrap">{l.value}</div>
                {/if}
                {#if l.note}<div class="mt-1 text-xs text-ink-400 break-words whitespace-pre-wrap">{l.note}</div>{/if}
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <button class="text-xs text-ink-400 hover:text-ink-700" onclick={() => startEdit(l)}>Edit</button>
                <button class="text-xs text-tag-salesText hover:opacity-80" aria-label="Delete" onclick={() => remove(l)}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
