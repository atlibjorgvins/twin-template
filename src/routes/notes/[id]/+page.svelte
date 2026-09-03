<script lang="ts">
  import { goto } from '$app/navigation';
  import { archiveNote, deleteNote, updateNote, type Note } from '$lib/directus';
  import Icon from '$lib/Icon.svelte';
  import NoteRelations from '$lib/NoteRelations.svelte';
  import NoteTagsCard from '$lib/NoteTagsCard.svelte';
  import MarkdownEditor from '$lib/MarkdownEditor.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Local working copy — debounced autosave on each change.
  let title = $state(data.note.title ?? '');
  let content = $state(data.note.content ?? '');
  let noteType = $state(data.note.note_type ?? 'general');
  let priority = $state(data.note.priority ?? '');
  let isDone = $state(!!data.note.is_done);
  let isPinned = $state(!!data.note.is_pinned);
  let followUp = $state(data.note.follow_up_date ?? '');
  let noteScope = $state<string>(data.note.scope ?? '');

  let saving = $state(false);
  let savedAt = $state<string | null>(null);
  let error = $state('');

  // Editor view mode. "live" renders an Obsidian-style live preview:
  // markdown syntax is hidden on inactive lines, styled where applicable.
  // "source" is the raw markdown editor — what Obsidian sees one-to-one.
  // Persisted per-device so power users who prefer source mode stay there.
  function lsEditorMode(): 'live' | 'source' {
    if (typeof localStorage === 'undefined') return 'live';
    return localStorage.getItem('twin.notes.editorMode') === 'source' ? 'source' : 'live';
  }
  let editorMode = $state<'live' | 'source'>(lsEditorMode());
  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('twin.notes.editorMode', editorMode);
    }
  });

  // Debounced autosave. Only fires when something actually changed —
  // we capture initial values once, derive a "dirty" signal, and reset
  // on successful save.
  let baseline = $state({
    title: data.note.title ?? '',
    content: data.note.content ?? '',
    note_type: data.note.note_type ?? 'general',
    priority: data.note.priority ?? '',
    is_done: !!data.note.is_done,
    is_pinned: !!data.note.is_pinned,
    follow_up_date: data.note.follow_up_date ?? '',
    scope: data.note.scope ?? '',
  });

  const dirty = $derived(
    title !== baseline.title ||
    content !== baseline.content ||
    noteType !== baseline.note_type ||
    priority !== baseline.priority ||
    isDone !== baseline.is_done ||
    isPinned !== baseline.is_pinned ||
    followUp !== baseline.follow_up_date ||
    noteScope !== baseline.scope,
  );

  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    if (!dirty) return;
    clearTimeout(timer);
    const t = title;
    const c = content;
    const nt = noteType;
    const p = priority;
    const d = isDone;
    const pn = isPinned;
    const f = followUp;
    const sc = noteScope;
    timer = setTimeout(async () => {
      saving = true;
      error = '';
      try {
        const patch: Partial<Note> = {
          title: t,
          content: c,
          note_type: nt,
          priority: p || null,
          is_done: d,
          is_pinned: pn,
          follow_up_date: f || null,
          scope: (sc || null) as Note['scope'],
        };
        await updateNote(data.note.id, patch);
        baseline = {
          title: t,
          content: c,
          note_type: nt,
          priority: p,
          is_done: d,
          is_pinned: pn,
          follow_up_date: f,
          scope: sc,
        };
        savedAt = new Date().toLocaleTimeString();
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        saving = false;
      }
    }, 700);
  });

  async function archive() {
    if (!confirm('Archive this note?')) return;
    await archiveNote(data.note.id);
    goto('/notes');
  }

  let deleting = $state(false);
  async function remove() {
    if (!confirm('Delete this note permanently? This cannot be undone.')) return;
    deleting = true;
    error = '';
    try {
      await deleteNote(data.note.id);
      goto('/notes');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      deleting = false;
    }
  }

  function fmtDate(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  }
</script>

<div class="space-y-5">
  <!-- Title row.
       Lightweight: large title input that reads like a document title,
       plus a thin status strip with the most-touched controls (Type
       chip, Pin, Done). Priority/Follow-up/Archive now live in the
       Properties card at the bottom of the page where they don't
       compete with writing. -->
  <div class="space-y-1">
    <input
      bind:value={title}
      placeholder="Untitled"
      class="font-display w-full bg-transparent text-2xl font-bold leading-tight tracking-tight text-ink-900 placeholder:text-ink-300 focus:outline-none sm:text-3xl"
      style="letter-spacing: -0.03em;"
    />
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <!-- Type chip: select styled as a Helga pill. The dropdown opens
           native and stays inline so the chip never grows in height. -->
      <label class="relative inline-flex">
        <select
          bind:value={noteType}
          class="appearance-none px-3 py-1 pr-7 font-display font-medium focus:outline-none"
          style="background: var(--accent-alpha-10); color: var(--accent-electric); border: 1px solid var(--accent-alpha-30); border-radius: var(--radius-pill); letter-spacing: 0.02em;"
          aria-label="Note type"
        >
          <option value="general">General</option>
          <option value="inbox">Inbox</option>
          <option value="meeting">Meeting</option>
          <option value="journal">Journal</option>
          <option value="log">Log</option>
        </select>
        <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" aria-hidden="true" style="color: var(--accent-electric);">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </span>
      </label>
      <!-- Scope chip: tags the note Work / Private / Both. Blank = untagged. -->
      <label class="relative inline-flex">
        <select
          bind:value={noteScope}
          class="appearance-none px-3 py-1 pr-7 font-display font-medium focus:outline-none"
          style="background: var(--accent-alpha-10); color: var(--accent-electric); border: 1px solid var(--accent-alpha-30); border-radius: var(--radius-pill); letter-spacing: 0.02em;"
          aria-label="Scope"
        >
          <option value="">Scope: All</option>
          <option value="work">Work</option>
          <option value="private">Private</option>
          <option value="both">Both</option>
        </select>
        <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" aria-hidden="true" style="color: var(--accent-electric);">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </span>
      </label>
      <!-- Pin toggle -->
      <button
        type="button"
        class="inline-flex items-center gap-1 px-2 py-1"
        style="border-radius: var(--radius-pill); border: 1px solid var(--border-subtle); background: {isPinned ? 'var(--accent-alpha-10)' : 'transparent'}; color: {isPinned ? 'var(--accent-electric)' : 'var(--text-tertiary)'};"
        onclick={() => (isPinned = !isPinned)}
        aria-pressed={isPinned}
        title={isPinned ? 'Unpin' : 'Pin'}
      >
        <span aria-hidden="true">{isPinned ? '★' : '☆'}</span>
        <span>{isPinned ? 'Pinned' : 'Pin'}</span>
      </button>
      <!-- Done toggle -->
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2 py-1"
        style="border-radius: var(--radius-pill); border: 1px solid var(--border-subtle); background: {isDone ? 'var(--accent-alpha-10)' : 'transparent'}; color: {isDone ? 'var(--accent-electric)' : 'var(--text-tertiary)'};"
        onclick={() => (isDone = !isDone)}
        aria-pressed={isDone}
        title={isDone ? 'Mark as not done' : 'Mark as done'}
      >
        <span aria-hidden="true">{isDone ? '✓' : '○'}</span>
        <span>{isDone ? 'Done' : 'Mark done'}</span>
      </button>
      <!-- Follow-up at a glance, only when set. Tap scrolls to the
           Properties card so the user can change it. -->
      {#if followUp}
        <a
          href="#note-properties"
          class="inline-flex items-center gap-1 px-2 py-1 text-ink-500"
          style="border-radius: var(--radius-pill); border: 1px solid var(--border-subtle); background: var(--bg-tertiary);"
          title="Edit follow-up date"
        >
          <span aria-hidden="true">⏰</span>
          <span>Follow-up {followUp}</span>
        </a>
      {/if}
    </div>
  </div>

  <!-- Body editor: Obsidian-style live preview, with a Source toggle.
       What gets saved is plain markdown either way — the toggle just
       changes whether the syntax tokens are hidden on inactive lines. -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
    <div class="flex items-center justify-between gap-2 mb-2">
      <div class="font-display text-xs uppercase tracking-wider text-ink-400">
        {editorMode === 'live' ? 'Live preview' : 'Source'}
      </div>
      <div
        class="inline-flex p-0.5"
        role="radiogroup"
        aria-label="Editor mode"
        style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
      >
        {#each [['live', 'Live'], ['source', 'Source']] as const as [k, label]}
          <button
            type="button"
            role="radio"
            aria-checked={editorMode === k}
            class="font-display px-3 py-1 text-xs font-medium transition"
            style={editorMode === k
              ? 'background: var(--accent-electric); color: var(--accent-text); border-radius: calc(var(--radius-md) - 2px); letter-spacing: 0.04em;'
              : 'background: transparent; color: var(--text-secondary); letter-spacing: 0.04em;'}
            onclick={() => (editorMode = k)}
          >{label}</button>
        {/each}
      </div>
    </div>
    <MarkdownEditor
      value={content}
      onChange={(v) => (content = v)}
      mode={editorMode}
      placeholder="Write in markdown — Obsidian sees the same file."
    />
  </div>

  <!-- Tags — shared `Tag` collection (same pool as People/Orgs). -->
  <NoteTagsCard noteId={data.note.id} />

  <!-- Related entities (people / orgs / projects / events) -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
    <NoteRelations noteId={data.note.id} />
  </div>

  <!-- Properties card: low-frequency controls live here so they don't
       dominate the writing surface. Priority + Follow-up date + Archive
       are all here. Linked from the title-strip "Follow-up …" pill. -->
  <details id="note-properties" class="card">
    <summary
      class="flex cursor-pointer items-center justify-between px-4 py-3 list-none"
      style="user-select: none;"
    >
      <span class="card-title">
        <Icon name="settings" size={16} /> Properties
      </span>
      <span class="text-xs text-ink-400">
        {priority ? `priority: ${priority}` : ''}{priority && followUp ? ' · ' : ''}{followUp ? `follow-up: ${followUp}` : ''}{!priority && !followUp ? 'tap to edit' : ''}
      </span>
    </summary>
    <dl class="divide-y divide-surface-divider px-4 pb-3 text-sm">
      <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
        <dt class="text-ink-400">Priority</dt>
        <dd>
          <select
            bind:value={priority}
            class="appearance-none rounded-md border bg-surface-hover px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
            style="border-color: var(--border-subtle);"
            aria-label="Priority"
          >
            <option value="">—</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </dd>
      </div>
      <div class="flex flex-col gap-0 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-1.5">
        <dt class="text-ink-400">Follow-up</dt>
        <dd>
          <input
            type="date"
            bind:value={followUp}
            class="rounded-md border bg-surface-hover px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
            style="border-color: var(--border-subtle);"
          />
        </dd>
      </div>
      <div class="flex items-center justify-between py-2 sm:py-1.5">
        <dt class="text-ink-400">Manage</dt>
        <dd class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium"
            style="border-radius: var(--radius-md); color: var(--text-secondary); border: 1px solid var(--border-subtle);"
            onclick={archive}
            title="Archive this note (keeps it, hidden from the default list)"
          >
            <Icon name="tag" size={14} /> Archive
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium disabled:opacity-50"
            style="border-radius: var(--radius-md); color: var(--state-danger); border: 1px solid var(--state-danger);"
            onclick={remove}
            disabled={deleting}
            title="Delete this note permanently"
          >
            <Icon name="trash" size={14} /> {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </dd>
      </div>
    </dl>
  </details>

  <!-- Footer -->
  <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
    <div class="flex items-center gap-3">
      <span>Created {fmtDate(data.note.date_created)}</span>
      <span>·</span>
      <span>Updated {fmtDate(data.note.date_updated)}</span>
    </div>
    <div>
      {#if error}
        <span class="text-red-700">{error}</span>
      {:else if saving}
        <span>Saving…</span>
      {:else if dirty}
        <span>Unsaved changes</span>
      {:else if savedAt}
        <span>Saved {savedAt}</span>
      {/if}
    </div>
  </div>
</div>
