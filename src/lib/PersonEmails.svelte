<script lang="ts">
  // Additional email addresses, as rows inside Contact details.
  //
  // Deliberately not its own card: these ARE the person's emails, and an
  // "Emails" card sitting next to an "Email" row invites the question of
  // which one is real. The primary stays the row above; these sit under it.
  //
  // Archived addresses are kept rather than deleted because attendee
  // matching sweeps them — an old address is exactly what an old invitation
  // was sent to — so removing archives by default, and only edit mode
  // offers an outright delete.
  import Icon from '$lib/Icon.svelte';
  import {
    listPersonEmails,
    addPersonEmail,
    archivePersonEmail,
    restorePersonEmail,
    deletePersonEmail,
    PERSON_EMAIL_LABELS,
    formatError,
    type PersonEmail
  } from '$lib/directus';

  let {
    personId,
    editing = false,
    onCount
  }: {
    personId: number;
    editing?: boolean;
    /** Published count, so the caller can show a total or gate a facet. */
    onCount?: (n: number) => void;
  } = $props();

  let rows = $state<PersonEmail[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let busyId = $state<number | null>(null);

  let draft = $state('');
  let draftLabel = $state<string>('other');
  let adding = $state(false);

  const published = $derived(rows.filter((r) => r.status !== 'archived'));
  const archived = $derived(rows.filter((r) => r.status === 'archived'));

  $effect(() => {
    void load(personId);
  });
  async function load(id: number) {
    loaded = false;
    try {
      rows = await listPersonEmails(id);
      error = null;
    } catch (e) {
      error = formatError(e);
      rows = [];
    } finally {
      loaded = true;
    }
  }
  $effect(() => {
    if (loaded) onCount?.(published.length);
  });

  async function add() {
    const value = draft.trim();
    if (!value || adding) return;
    adding = true;
    error = null;
    try {
      const created = await addPersonEmail(personId, value, { label: draftLabel, source: 'manual' });
      if (created) {
        rows = [...rows, created];
        draft = '';
      } else {
        // addPersonEmail returns null when this person already holds the
        // address — primary included. Say so rather than doing nothing.
        error = `${value} is already on this contact.`;
      }
    } catch (e) {
      error = formatError(e);
    } finally {
      adding = false;
    }
  }

  async function archive(row: PersonEmail) {
    busyId = row.id;
    try {
      await archivePersonEmail(row.id);
      rows = rows.map((r) => (r.id === row.id ? { ...r, status: 'archived' } : r));
    } catch (e) {
      error = formatError(e);
    } finally {
      busyId = null;
    }
  }
  async function restore(row: PersonEmail) {
    busyId = row.id;
    try {
      await restorePersonEmail(row.id);
      rows = rows.map((r) => (r.id === row.id ? { ...r, status: 'published' } : r));
    } catch (e) {
      error = formatError(e);
    } finally {
      busyId = null;
    }
  }
  async function destroy(row: PersonEmail) {
    if (!confirm(`Delete ${row.email} outright? Archiving keeps it matching old invitations.`)) return;
    busyId = row.id;
    try {
      await deletePersonEmail(row.id);
      rows = rows.filter((r) => r.id !== row.id);
    } catch (e) {
      error = formatError(e);
    } finally {
      busyId = null;
    }
  }

  const labelTone = (l?: string | null) =>
    l === 'work' ? 'text-tag-eventText' : l === 'old' ? 'text-ink-400' : 'text-ink-500';
</script>

{#snippet addressRow(row: PersonEmail, muted: boolean)}
  <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
    <dt class="text-ink-400">
      {#if row.label && row.label !== 'other'}
        <span class={labelTone(row.label)}>{row.label}</span>
      {:else}
        Also
      {/if}
      {#if muted}<span class="text-ink-300"> · archived</span>{/if}
    </dt>
    <dd class="min-w-0 flex-1">
      <span class="flex items-center gap-2">
        <a
          href={`mailto:${row.email}`}
          class="min-w-0 flex-1 truncate {muted ? 'text-ink-400 line-through' : 'text-ink-900 hover:text-brand'}"
        >{row.email}</a>
        {#if editing}
          {#if muted}
            <button
              type="button"
              class="shrink-0 text-[11px] text-brand hover:underline disabled:opacity-40"
              disabled={busyId === row.id}
              onclick={() => restore(row)}
            >restore</button>
            <button
              type="button"
              class="shrink-0 text-ink-300 hover:text-tag-salesText disabled:opacity-40"
              disabled={busyId === row.id}
              aria-label={`Delete ${row.email}`}
              title="Delete outright"
              onclick={() => destroy(row)}
            ><Icon name="trash" size={12} /></button>
          {:else}
            <button
              type="button"
              class="shrink-0 text-ink-300 hover:text-ink-700 disabled:opacity-40"
              disabled={busyId === row.id}
              aria-label={`Archive ${row.email}`}
              title="Archive — keeps it matching old invitations"
              onclick={() => archive(row)}
            ><Icon name="x" size={12} /></button>
          {/if}
        {/if}
      </span>
    </dd>
  </div>
{/snippet}

{#each published as row (row.id)}
  {@render addressRow(row, false)}
{/each}

{#if editing}
  {#each archived as row (row.id)}
    {@render addressRow(row, true)}
  {/each}

  <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:py-1.5">
    <dt class="text-ink-400">Add email</dt>
    <dd class="min-w-0 flex-1">
      <span class="flex flex-wrap items-center gap-1.5">
        <input
          class="input min-w-0 flex-1 text-sm"
          type="email"
          placeholder="name@company.is"
          bind:value={draft}
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
        />
        <select class="input shrink-0 text-xs" bind:value={draftLabel}>
          {#each PERSON_EMAIL_LABELS as l (l)}<option value={l}>{l}</option>{/each}
        </select>
        <button
          type="button"
          class="btn-ghost shrink-0 !px-2 text-xs text-brand disabled:opacity-40"
          disabled={!draft.trim() || adding}
          onclick={add}
        >{adding ? 'Adding…' : 'Add'}</button>
      </span>
      {#if error}
        <span class="mt-1 block text-[11px]" style="color: #C0392B;">{error}</span>
      {/if}
    </dd>
  </div>
{:else if error}
  <div class="py-1.5">
    <span class="text-[11px]" style="color: #C0392B;">{error}</span>
  </div>
{/if}
