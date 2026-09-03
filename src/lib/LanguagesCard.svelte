<script lang="ts">
  // Spoken languages for a person — a compact list of language + proficiency
  // rows. Add via a name field + proficiency dropdown; proficiency is
  // editable inline; delete per row.
  import Icon from '$lib/Icon.svelte';
  import {
    getPersonLanguages,
    createPersonLanguage,
    updatePersonLanguage,
    deletePersonLanguage,
    LANGUAGE_PROFICIENCIES,
    formatError,
    type PersonLanguage,
    type LanguageProficiency
  } from '$lib/directus';
  import { onMount } from 'svelte';

  let { personId, onCount }: { personId: number; onCount?: (n: number) => void } = $props();

  let items = $state<PersonLanguage[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Report the row count upward once known, so the page can collapse this
  // card into the "Add" facet row when it has nothing to show. Called again
  // after every add/remove, so creating the first row reveals the card and
  // deleting the last one folds it away on the next visit.
  $effect(() => { if (!loading) onCount?.(items.length); });

  onMount(async () => {
    try { items = await getPersonLanguages(personId); }
    catch (e) { error = formatError(e); }
    finally { loading = false; }
  });

  const profLabel = (v?: string | null) =>
    LANGUAGE_PROFICIENCIES.find((p) => p.value === v)?.label ?? '';

  // ── Add ────────────────────────────────────────────────────────────────
  let adding = $state(false);
  let newLang = $state('');
  let newProf = $state<LanguageProficiency>('fluent');
  let saving = $state(false);
  async function add() {
    if (!newLang.trim() || saving) return;
    saving = true; error = '';
    try {
      const created = await createPersonLanguage(personId, {
        language: newLang.trim(),
        proficiency: newProf,
        sort: items.length
      });
      items = [...items, created];
      newLang = ''; newProf = 'fluent'; adding = false;
    } catch (e) { error = formatError(e); } finally { saving = false; }
  }

  async function setProf(row: PersonLanguage, proficiency: LanguageProficiency) {
    try {
      await updatePersonLanguage(row.id, { proficiency });
      items = items.map((x) => (x.id === row.id ? { ...x, proficiency } : x));
    } catch (e) { error = formatError(e); }
  }
  async function remove(row: PersonLanguage) {
    try {
      await deletePersonLanguage(row.id);
      items = items.filter((x) => x.id !== row.id);
    } catch (e) { error = formatError(e); }
  }
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title"><Icon name="globe" size={16} /> Languages <span class="text-ink-300 font-normal">{items.length}</span></span>
    {#if !adding}
      <button
        class="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
        onclick={() => { adding = true; }}
      ><Icon name="plus" size={14} /> Add</button>
    {/if}
  </div>

  {#if adding}
    <div class="mx-4 mb-3 space-y-2 rounded-[10px] border border-brand/40 bg-surface-hover/40 p-3">
      <div class="flex gap-2">
        <input class="input w-full" placeholder="Language (e.g. Icelandic)" bind:value={newLang} disabled={saving} onkeydown={(ev) => ev.key === 'Enter' && add()} />
        <select class="input !w-auto" bind:value={newProf} disabled={saving}>
          {#each LANGUAGE_PROFICIENCIES as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
        </select>
      </div>
      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost" onclick={() => { adding = false; newLang = ''; }} disabled={saving}>Cancel</button>
        <button class="btn-primary" onclick={add} disabled={saving || !newLang.trim()}>{saving ? 'Adding…' : 'Add'}</button>
      </div>
    </div>
  {/if}

  {#if error}<div class="mx-4 mb-2 text-xs text-tag-salesText">{error}</div>{/if}

  {#if loading}
    <div class="px-4 pb-4 text-sm text-ink-400">Loading…</div>
  {:else if items.length === 0 && !adding}
    <div class="px-4 pb-4 text-sm text-ink-400">No languages recorded.</div>
  {:else}
    <ul class="space-y-1.5 px-4 pb-4">
      {#each items as row (row.id)}
        <li class="flex items-center justify-between gap-3 rounded-[10px] border border-surface-divider bg-surface-hover/40 px-3 py-2">
          <span class="min-w-0 truncate text-sm font-medium text-ink-900">{row.language}</span>
          <div class="flex shrink-0 items-center gap-2">
            <!-- Chip look, real <select> behaviour: app.css forces
                 `select { font-size: 16px !important }` under 768px to stop iOS
                 zooming on focus, which blows a styled small select up into a
                 grey slab. So the visible chip is a span and the select sits
                 invisibly on top of it, still native and still focusable. -->
            <span class="relative inline-flex items-center rounded-full bg-surface-hover px-2.5 py-0.5 text-xs text-ink-700">
              {LANGUAGE_PROFICIENCIES.find((p) => p.value === row.proficiency)?.label ?? 'Set level'}
              <select
                class="absolute inset-0 cursor-pointer opacity-0"
                value={row.proficiency ?? ''}
                onchange={(ev) => setProf(row, (ev.currentTarget as HTMLSelectElement).value as LanguageProficiency)}
                aria-label={`Proficiency for ${row.language}`}
              >
                {#each LANGUAGE_PROFICIENCIES as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
              </select>
            </span>
            <button class="text-xs text-tag-salesText hover:opacity-80" aria-label="Delete" onclick={() => remove(row)}><Icon name="trash" size={14} /></button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
