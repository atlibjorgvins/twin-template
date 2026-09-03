<script lang="ts">
  // Education history for a person — a small inline-editable list, same
  // add / edit / delete shape as LinksCard. Sorted newest first by the
  // data layer. Years are optional ints; blank end = "ongoing".
  import Icon from '$lib/Icon.svelte';
  import {
    getPersonEducation,
    createPersonEducation,
    updatePersonEducation,
    deletePersonEducation,
    formatError,
    type PersonEducation
  } from '$lib/directus';
  import { onMount } from 'svelte';

  let { personId, onCount }: { personId: number; onCount?: (n: number) => void } = $props();

  let items = $state<PersonEducation[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Report the row count upward once known, so the page can collapse this
  // card into the "Add" facet row when it has nothing to show. Called again
  // after every add/remove, so creating the first row reveals the card and
  // deleting the last one folds it away on the next visit.
  $effect(() => { if (!loading) onCount?.(items.length); });

  onMount(async () => {
    try { items = await getPersonEducation(personId); }
    catch (e) { error = formatError(e); }
    finally { loading = false; }
  });

  function yearInt(v: string): number | null {
    const n = parseInt(v.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  function yearsLabel(e: PersonEducation): string {
    if (!e.start_year && !e.end_year) return '';
    return `${e.start_year ?? '?'} – ${e.end_year ?? 'ongoing'}`;
  }

  // ── Add ────────────────────────────────────────────────────────────────
  let adding = $state(false);
  let f = $state({ institution: '', degree: '', field: '', start_year: '', end_year: '', notes: '' });
  let saving = $state(false);
  function resetForm() { f = { institution: '', degree: '', field: '', start_year: '', end_year: '', notes: '' }; }
  async function add() {
    if (!f.institution.trim() || saving) return;
    saving = true; error = '';
    try {
      const created = await createPersonEducation(personId, {
        institution: f.institution.trim(),
        degree: f.degree.trim() || null,
        field: f.field.trim() || null,
        start_year: yearInt(f.start_year),
        end_year: yearInt(f.end_year),
        notes: f.notes.trim() || null,
        sort: items.length
      });
      items = [created, ...items];
      resetForm(); adding = false;
    } catch (e) { error = formatError(e); } finally { saving = false; }
  }

  // ── Inline edit ──────────────────────────────────────────────────────────
  let editingId = $state<number | null>(null);
  let e = $state({ institution: '', degree: '', field: '', start_year: '', end_year: '', notes: '' });
  function startEdit(row: PersonEducation) {
    editingId = row.id;
    e = {
      institution: row.institution ?? '',
      degree: row.degree ?? '',
      field: row.field ?? '',
      start_year: row.start_year != null ? String(row.start_year) : '',
      end_year: row.end_year != null ? String(row.end_year) : '',
      notes: row.notes ?? ''
    };
  }
  async function saveEdit() {
    if (editingId == null || !e.institution.trim()) return;
    const id = editingId;
    const patch = {
      institution: e.institution.trim(),
      degree: e.degree.trim() || null,
      field: e.field.trim() || null,
      start_year: yearInt(e.start_year),
      end_year: yearInt(e.end_year),
      notes: e.notes.trim() || null
    };
    try {
      await updatePersonEducation(id, patch);
      items = items.map((r) => (r.id === id ? { ...r, ...patch } : r));
      editingId = null;
    } catch (err) { error = formatError(err); }
  }
  async function remove(row: PersonEducation) {
    if (!confirm(`Delete "${row.degree || row.institution}"?`)) return;
    try {
      await deletePersonEducation(row.id);
      items = items.filter((x) => x.id !== row.id);
    } catch (err) { error = formatError(err); }
  }
</script>

{#snippet fields(m: typeof f, disabled: boolean)}
  <input class="input w-full" placeholder="Institution / school *" bind:value={m.institution} {disabled} />
  <div class="grid grid-cols-2 gap-2">
    <input class="input w-full" placeholder="Degree (BSc, MBA…)" bind:value={m.degree} {disabled} />
    <input class="input w-full" placeholder="Field of study" bind:value={m.field} {disabled} />
  </div>
  <div class="grid grid-cols-2 gap-2">
    <input class="input w-full" inputmode="numeric" placeholder="Start year" bind:value={m.start_year} {disabled} />
    <input class="input w-full" inputmode="numeric" placeholder="End year (blank = ongoing)" bind:value={m.end_year} {disabled} />
  </div>
  <input class="input w-full" placeholder="Notes (optional)" bind:value={m.notes} {disabled} />
{/snippet}

<div class="card">
  <div class="card-header">
    <span class="card-title"><Icon name="school" size={16} /> Education <span class="text-ink-300 font-normal">{items.length}</span></span>
    {#if !adding}
      <button
        class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
        onclick={() => { adding = true; }}
      ><Icon name="plus" size={14} /> Add</button>
    {/if}
  </div>

  {#if adding}
    <div class="mx-4 mb-3 space-y-2 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3">
      {@render fields(f, saving)}
      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost" onclick={() => { adding = false; resetForm(); }} disabled={saving}>Cancel</button>
        <button class="btn-primary" onclick={add} disabled={saving || !f.institution.trim()}>{saving ? 'Adding…' : 'Add'}</button>
      </div>
    </div>
  {/if}

  {#if error}<div class="mx-4 mb-2 text-xs text-tag-salesText">{error}</div>{/if}

  {#if loading}
    <div class="px-4 pb-4 text-sm text-ink-400">Loading…</div>
  {:else if items.length === 0 && !adding}
    <div class="px-4 pb-4 text-sm text-ink-400">No education recorded. Add a degree or course.</div>
  {:else}
    <ul class="space-y-2 px-4 pb-4">
      {#each items as row (row.id)}
        <li class="rounded-[10px] border border-surface-divider bg-surface-hover/40 p-3">
          {#if editingId === row.id}
            <div class="space-y-2">
              {@render fields(e, false)}
              <div class="flex items-center justify-end gap-2">
                <button class="btn-ghost" onclick={() => (editingId = null)}>Cancel</button>
                <button class="btn-primary" onclick={saveEdit} disabled={!e.institution.trim()}>Save</button>
              </div>
            </div>
          {:else}
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-ink-900">
                  {row.degree ? `${row.degree}` : row.institution}{#if row.field}<span class="font-normal text-ink-600">&nbsp;· {row.field}</span>{/if}
                </div>
                {#if row.degree}<div class="text-xs text-ink-500">{row.institution}</div>{/if}
                {#if yearsLabel(row)}<div class="mt-0.5 text-xs text-ink-400">{yearsLabel(row)}</div>{/if}
                {#if row.notes}<div class="mt-1 text-xs text-ink-400 whitespace-pre-wrap break-words">{row.notes}</div>{/if}
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <button class="text-xs text-ink-400 hover:text-ink-700" onclick={() => startEdit(row)}>Edit</button>
                <button class="text-xs text-tag-salesText hover:opacity-80" aria-label="Delete" onclick={() => remove(row)}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
