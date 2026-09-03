<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import { createNote } from '$lib/directus';

  let { data }: {
    data: { sharedTitle: string; sharedText: string; sharedUrl: string };
  } = $props();

  // Pre-derive a sensible title + body. The Web Share Target spec says any of
  // the three params can be empty, so we fall back gracefully:
  // - title supplied → use it as the title
  // - else the first line of text → title; the rest → body
  // - URL goes on its own line at the bottom of the body so it's clickable
  //   when the note renders (Obsidian + the bridge both honor inline links)
  const initial = (() => {
    const lines = (data.sharedText ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    let title = (data.sharedTitle ?? '').trim();
    let bodyLines = [...lines];
    if (!title && bodyLines.length > 0) {
      title = bodyLines.shift()!.slice(0, 200);
    }
    if (data.sharedUrl) {
      bodyLines.push('');
      bodyLines.push(data.sharedUrl);
    }
    return { title, body: bodyLines.join('\n') };
  })();

  let title = $state(initial.title);
  let body = $state(initial.body);
  let noteType = $state<string>('inbox');
  let followUp = $state<string>('');
  let saving = $state(false);
  let error = $state('');

  // If absolutely nothing came through (e.g. the user navigated to /share
  // by hand) we still want a usable form, not an empty wasteland.
  const empty = $derived(!title.trim() && !body.trim());

  // Hint for the user about which fields the share dialog managed to capture.
  // Useful when iOS Safari sends only `url` for example, or only `text`.
  const incoming = $derived(
    [
      data.sharedTitle ? 'title' : null,
      data.sharedText ? 'text' : null,
      data.sharedUrl ? 'url' : null,
    ].filter(Boolean) as string[]
  );

  // Auto-focus the title field once the form is populated so a confirm-tap
  // is the only friction between the share gesture and a saved note.
  let titleEl = $state<HTMLInputElement | null>(null);
  onMount(() => {
    queueMicrotask(() => titleEl?.focus());
  });

  async function save(thenWhere: 'note' | 'home') {
    const t = title.trim();
    if (!t) { error = 'Add a title or a body to save the note'; return; }
    saving = true;
    error = '';
    try {
      const created = await createNote({
        title: t.slice(0, 200),
        content: body.trim() || null,
        note_type: noteType,
        follow_up_date: followUp || null,
        status: 'published',
      });
      // 'note' → land on the detail page so the user can tag relations.
      // 'home' → land back on Today (great for "save and move on" reflex).
      if (thenWhere === 'note') goto(`/notes/${created.id}`);
      else goto('/');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function cancel() {
    if (history.length > 1) history.back();
    else goto('/');
  }
</script>

<svelte:head>
  <title>Share to Hub</title>
</svelte:head>

<section class="space-y-5">
  <header>
    <div class="text-xs font-medium uppercase tracking-wider text-ink-300">Share to Hub</div>
    <h1 class="text-2xl font-semibold text-ink-900 sm:text-3xl">New from share</h1>
    <p class="mt-1 text-sm text-ink-500">
      {#if empty}
        No content received from share. You can type one in below, or
        <a class="text-brand hover:underline" href="/">go back to Today</a>.
      {:else}
        Captured {incoming.join(' + ')} from the share sheet — review and save.
      {/if}
    </p>
  </header>

  <div class="card p-4 sm:p-5 space-y-3">
    <label class="block">
      <span class="block text-xs text-ink-400 mb-1">Title</span>
      <input
        bind:this={titleEl}
        type="text"
        class="input w-full"
        placeholder="Title"
        bind:value={title}
        disabled={saving}
      />
    </label>

    <label class="block">
      <span class="block text-xs text-ink-400 mb-1">Body (markdown welcome)</span>
      <textarea
        class="input w-full font-mono"
        rows="8"
        placeholder="Body…"
        bind:value={body}
        disabled={saving}
      ></textarea>
    </label>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class="block text-xs text-ink-400 mb-1">Type</span>
        <select class="input w-full" bind:value={noteType} disabled={saving}>
          <option value="inbox">Inbox</option>
          <option value="general">General</option>
          <option value="meeting">Meeting</option>
          <option value="journal">Journal</option>
          <option value="log">Log</option>
        </select>
      </label>
      <label class="block">
        <span class="block text-xs text-ink-400 mb-1">Follow-up (optional)</span>
        <input type="date" class="input w-full" bind:value={followUp} disabled={saving} />
      </label>
    </div>

    {#if error}
      <div class="rounded-[10px] border border-tag-sales bg-tag-sales/40 px-3 py-2 text-xs text-tag-salesText">
        {error}
      </div>
    {/if}

    <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
      <button class="btn-ghost" onclick={cancel} disabled={saving}>Cancel</button>
      <button class="btn-ghost" onclick={() => save('home')} disabled={saving || !title.trim()}>
        <Icon name="bolt" size={14} /> Save & close
      </button>
      <button class="btn-primary" onclick={() => save('note')} disabled={saving || !title.trim()}>
        <Icon name="plus" size={14} />
        {saving ? 'Saving…' : 'Save & open'}
      </button>
    </div>
  </div>

  <!-- iOS power-user shortcut: documented inline so it's obvious when the
       Web Share Target API doesn't surface this PWA in the system share
       sheet. Tested as the most reliable fallback on iOS. -->
  <details class="text-sm text-ink-500">
    <summary class="cursor-pointer">iPhone setup tips</summary>
    <div class="mt-2 space-y-2 rounded-[10px] border border-surface-border bg-surface-card p-3 text-xs">
      <p>
        On iPhone, the Web Share Target only appears in the share sheet after
        you <strong>add this site to the home screen</strong> (Safari → Share → Add to Home Screen).
      </p>
      <p>
        If your version of iOS doesn't surface it, build a <strong>Shortcut</strong>:
      </p>
      <ol class="ml-4 list-decimal space-y-1">
        <li>Shortcuts app → New Shortcut → "Receive any input from share sheet"</li>
        <li>Action: "URL" → set to <code>{`{base}/share?text=`}</code> + the shared input</li>
        <li>Action: "Open URLs"</li>
        <li>Pin the shortcut to the share sheet in the shortcut's settings.</li>
      </ol>
    </div>
  </details>
</section>
