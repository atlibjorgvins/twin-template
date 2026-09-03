<script lang="ts">
  // Reverse side of NoteRelations: shows notes that have been linked to
  // this entity via the M2A `notes_related_to` junction. Mounts on the
  // Person / Organisation / Project / Event detail pages so the
  // relationship reads both ways — attach a note → it appears here.
  import { listNotesForEntity, formatError, type Note, type RelatedCollection } from '$lib/directus';
  import Icon from '$lib/Icon.svelte';

  type Props = { collection: RelatedCollection; itemId: number | string };
  let { collection, itemId }: Props = $props();

  let notes = $state<Note[]>([]);
  let loading = $state(true);
  let error = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      notes = await listNotesForEntity(collection, itemId);
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => { void load(); });

  function fmtDate(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  // Some Directus fields come back as objects (translations, structured
  // content) instead of plain strings. Coerce defensively so the UI
  // doesn't render literal "[object Object]" placeholders.
  function asString(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'string') {
      // Existing rows in the DB sometimes hold the literal string
      // "[object Object]" — the fingerprint of an earlier bug where an
      // object got coerced via `String()` before being saved. Treat it
      // as empty so we don't render the corruption.
      if (v === '[object Object]') return '';
      return v;
    }
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    // Pick the first plausible string field out of an object — covers
    // both translations (`{ en: '…' }`) and richtext (`{ text: '…' }`).
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of ['en', 'text', 'value', 'content', 'plain', 'body']) {
        if (typeof o[k] === 'string') return o[k] as string;
      }
      // Translations array: `[{ languages_code: 'en', content: '…' }]`.
      if (Array.isArray(v) && v.length > 0 && typeof (v[0] as Record<string, unknown>).content === 'string') {
        return (v[0] as Record<string, unknown>).content as string;
      }
      try { return JSON.stringify(v); } catch { return ''; }
    }
    return '';
  }
  function snippet(s: unknown, n = 120): string {
    const t = asString(s).trim();
    if (t.length <= n) return t;
    return t.slice(0, n).trim() + '…';
  }
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title">
      <Icon name="notebook" size={16} /> Notes
      {#if notes.length > 0}
        <span class="text-ink-300 font-normal">{notes.length}</span>
      {/if}
    </span>
  </div>
  {#if error}
    <div
      class="mx-4 mb-3 px-3 py-1.5 text-xs"
      style="background: var(--bg-tertiary); color: var(--state-danger); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
    >{error}</div>
  {/if}
  {#if loading}
    <div class="px-4 pb-4 text-sm text-ink-400">Loading…</div>
  {:else if notes.length === 0}
    <div class="px-4 pb-4 text-sm text-ink-400">
      No notes linked yet. Open any note and add a relation to this record.
    </div>
  {:else}
    <ul class="divide-y divide-surface-divider">
      {#each notes as n (n.id)}
        {@const titleText = asString(n.title).trim()}
        {@const bodyText = snippet(n.content, 160)}
        <li>
          <a
            href={`/notes/${n.id}`}
            class="flex items-start gap-3 px-4 py-3 hover:bg-surface-hover"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2">
                <span class="truncate font-medium text-ink-900">
                  {titleText || '(untitled note)'}
                </span>
                {#if n.is_pinned}
                  <span aria-hidden="true" style="color: var(--accent-electric);">★</span>
                {/if}
              </div>
              {#if bodyText}
                <div class="mt-0.5 line-clamp-2 text-xs text-ink-500">
                  {bodyText}
                </div>
              {/if}
              <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-400">
                {#if n.note_type}<span class="uppercase tracking-wider">{n.note_type}</span>{/if}
                {#if n.follow_up_date}
                  <span class="text-ink-300">·</span>
                  <span>⏰ {n.follow_up_date}</span>
                {/if}
                {#if n.priority}
                  <span class="text-ink-300">·</span>
                  <span>priority: {n.priority}</span>
                {/if}
                {#if n.date_updated}
                  <span class="text-ink-300">·</span>
                  <span>{fmtDate(n.date_updated)}</span>
                {/if}
              </div>
            </div>
            <Icon name="chevron-right" size={14} class="mt-0.5 shrink-0 text-ink-300" />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
