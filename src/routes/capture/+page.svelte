<script lang="ts">
  // Capture — a fast inbox dump for text, links, and images.
  //
  // The textarea is the heart of it but it accepts more than text:
  //   - Cmd/Ctrl+V of an image (screenshot, copied photo) → uploads
  //     to directus_files and pins a thumbnail chip below the
  //     textarea. The image's URL is also appended to the captured
  //     content as a markdown link so the resulting note carries it.
  //   - Drag-and-drop of one or more files (images or otherwise) →
  //     same flow.
  //   - URLs typed/pasted in the textarea are detected on save and
  //     emitted as a tidy bullet list at the end of the note so
  //     they're easy to scan later.
  //
  // Save still lands one row in `notes` as before; the captured
  // attachments live in directus_files and are linked by URL inside
  // the note's `content` field so the existing notes view shows them.
  import Icon from '$lib/Icon.svelte';
  import { captureInbox, uploadFile, assetUrl } from '$lib/directus';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  type Attachment = {
    fileId: string;
    name: string;
    /** Pre-signed image URL for the thumbnail; null for non-image. */
    previewUrl: string | null;
    /** MIME type — drives the thumbnail vs file-icon switch. */
    mime: string;
    sizeBytes: number;
    /** Direct asset URL written into note content on save. */
    contentUrl: string;
  };

  let text = $state('');
  let attachments = $state<Attachment[]>([]);
  let uploading = $state(0);            // count of in-flight uploads
  let status: 'idle' | 'saving' | 'saved' | 'error' = $state('idle');
  let message = $state('');
  let dragOver = $state(false);

  // ── URL detection ──────────────────────────────────────────────
  // Lightweight regex — catches http(s) URLs and bare domains like
  // example.com/path. Doesn't need to be perfect; users see the
  // extracted list and can edit before saving.
  const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g;
  const detectedUrls = $derived.by(() => {
    const found = text.match(URL_RE) ?? [];
    return [...new Set(found.map((u) => u.replace(/[.,;:!?)]+$/, '')))];
  });

  // ── Attachment ingestion ───────────────────────────────────────
  async function ingestFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.size > 0);
    if (!list.length) return;
    for (const f of list) {
      uploading++;
      try {
        const fileId = await uploadFile(f, { title: f.name });
        const isImage = f.type.startsWith('image/');
        const previewUrl = isImage ? assetUrl(fileId, { width: 320, height: 320, fit: 'cover' }) : null;
        // For the markdown reference we want the *original* URL,
        // not a transformed thumb; the notes view picks its own
        // sizing if it renders the image.
        const contentUrl = assetUrl(fileId) ?? '';
        attachments = [
          ...attachments,
          {
            fileId,
            name: f.name,
            previewUrl,
            mime: f.type || 'application/octet-stream',
            sizeBytes: f.size,
            contentUrl
          }
        ];
      } catch (err) {
        status = 'error';
        message = err instanceof Error ? err.message : `Upload of "${f.name}" failed`;
      } finally {
        uploading--;
      }
    }
  }

  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      // Let the file paste happen, but don't ALSO paste the binary
      // garbage some browsers emit into the textarea.
      e.preventDefault();
      void ingestFiles(files);
    }
    // Plain-text paste falls through to the default handler.
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (e.dataTransfer?.files?.length) void ingestFiles(e.dataTransfer.files);
  }
  function onDragOver(e: DragEvent) {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      dragOver = true;
    }
  }
  function onDragLeave() { dragOver = false; }

  async function onPickFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (input.files?.length) await ingestFiles(input.files);
    input.value = '';
  }

  function removeAttachment(idx: number) {
    attachments = attachments.filter((_, i) => i !== idx);
  }

  function formatSize(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  // ── Save ───────────────────────────────────────────────────────
  // Compose the final note content: original text + a markdown
  // section for attachments (so images render in any markdown-aware
  // viewer, and others are at least clickable links). Plain text
  // notes degrade gracefully — the user just sees the URLs.
  function composeContent(): string {
    const parts: string[] = [];
    if (text.trim()) parts.push(text.trim());
    if (attachments.length > 0) {
      const lines = attachments.map((a) => {
        const isImage = a.mime.startsWith('image/');
        return isImage
          ? `![${a.name}](${a.contentUrl})`
          : `[📎 ${a.name}](${a.contentUrl})`;
      });
      parts.push('\n— Attachments —\n' + lines.join('\n'));
    }
    return parts.join('\n');
  }

  async function submit() {
    const composed = composeContent();
    if (!composed.trim()) return;
    if (uploading > 0) {
      message = 'Wait for uploads to finish first.';
      return;
    }
    status = 'saving';
    message = '';
    try {
      const row = await captureInbox(composed);
      status = 'saved';
      message = `Saved as note #${(row as { id: number }).id}`;
      text = '';
      attachments = [];
      setTimeout(() => (status = 'idle'), 2500);
    } catch (err) {
      status = 'error';
      message = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Modal-style dismissal ─────────────────────────────────────
  // /capture is a real route (so direct links work), but it should
  // *feel* like a popup: Esc and clicking the dimmed backdrop both
  // close it. We try history.back() first so the user lands wherever
  // they came from; if there's no history (deep link / cold-load)
  // we fall back to the home dashboard.
  function dismiss() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      void goto('/');
    }
  }
  function onWindowKey(e: KeyboardEvent) {
    // Don't interfere with a textarea Cmd+Enter or normal typing —
    // only act on Esc, and only when the user *isn't* mid-edit
    // submission (status === 'saving').
    if (e.key === 'Escape' && status !== 'saving') {
      e.preventDefault();
      dismiss();
    }
  }
  onMount(() => {
    window.addEventListener('keydown', onWindowKey);
    return () => window.removeEventListener('keydown', onWindowKey);
  });
</script>

<svelte:head><title>Capture · Hub</title></svelte:head>

<!-- Backdrop: clicking anywhere outside the card dismisses, matching
     the rest of the app's popups. The header + card stop propagation
     so their own contents stay interactive. -->
<div
  class="mx-auto max-w-2xl space-y-5"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
>
  <div
    class="flex items-start justify-between gap-3"
    role="presentation"
    onclick={(e) => e.stopPropagation()}
  >
    <div>
      <h1 class="text-3xl font-semibold">Capture</h1>
      <p class="mt-1 text-sm text-ink-500">
        Drop a thought, link, screenshot, or file. Lands in the Inbox as a draft note —
        paste images straight in, or drag files onto the box.
      </p>
    </div>
    <button
      type="button"
      class="shrink-0 rounded-md border border-surface-border bg-surface-card p-1.5 text-ink-500 hover:bg-surface-hover hover:text-ink-900"
      onclick={dismiss}
      aria-label="Close capture"
      title="Close (Esc)"
    >
      <Icon name="x" size={16} />
    </button>
  </div>

  <!-- Combined textarea + drop zone. The textarea handles paste
       (including image data from the clipboard); the parent div
       handles drag-and-drop so the user can also drop files onto
       the surrounding card. stopPropagation so a click *inside*
       the card never bubbles up and dismisses. -->
  <div
    class="card space-y-3 p-4 transition {dragOver ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface-card' : ''}"
    ondragover={onDragOver}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    onclick={(e) => e.stopPropagation()}
    role="region"
    aria-label="Capture drop zone"
  >
    <label class="muted-label" for="capture">What's on your mind</label>
    <textarea
      id="capture"
      bind:value={text}
      onpaste={onPaste}
      rows="6"
      placeholder={'E.g. follow up with Eva re: Gulleggið — paste a screenshot or a link…'}
      class="input resize-none"
    ></textarea>

    <!-- Detected links (preview only — they're already in the
         saved content; this is just a "yes I saw the URL" cue). -->
    {#if detectedUrls.length > 0}
      <div class="flex flex-wrap items-center gap-1.5 text-xs">
        <span class="text-ink-400">Links:</span>
        {#each detectedUrls as u (u)}
          <a
            href={u}
            target="_blank"
            rel="noreferrer"
            class="inline-flex max-w-[18rem] items-center gap-1 truncate rounded-full border border-surface-border bg-surface-hover px-2 py-0.5 text-ink-700 hover:text-brand"
            title={u}
          >
            <Icon name="globe" size={12} />
            <span class="truncate">{u.replace(/^https?:\/\//, '')}</span>
          </a>
        {/each}
      </div>
    {/if}

    <!-- Attachments — thumbnails for images, generic chip otherwise. -->
    {#if attachments.length > 0 || uploading > 0}
      <div class="flex flex-wrap gap-2">
        {#each attachments as a, i (a.fileId)}
          <div class="group relative">
            {#if a.previewUrl}
              <img
                src={a.previewUrl}
                alt={a.name}
                class="h-20 w-20 rounded-md border border-surface-border object-cover"
              />
            {:else}
              <div class="flex h-20 w-20 flex-col items-center justify-center rounded-md border border-surface-border bg-surface-hover px-1 text-center">
                <Icon name="notebook" size={20} class="text-ink-400" />
                <span class="mt-1 truncate text-[10px] text-ink-500" title={a.name}>{a.name}</span>
              </div>
            {/if}
            <button
              type="button"
              class="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-surface-border bg-surface-card text-ink-500 shadow-sm hover:bg-tag-sales hover:text-tag-salesText"
              aria-label={`Remove ${a.name}`}
              onclick={() => removeAttachment(i)}
            >
              <Icon name="x" size={12} />
            </button>
            <div class="mt-0.5 max-w-[5rem] truncate text-[10px] text-ink-400">{formatSize(a.sizeBytes)}</div>
          </div>
        {/each}
        {#each Array.from({ length: uploading }) as _ (`u${_}`)}
          <div class="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-surface-border text-[10px] text-ink-400">
            uploading…
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 text-xs text-ink-400">
        <label class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-surface-border bg-surface-card px-2 py-1 hover:bg-surface-hover">
          <Icon name="plus" size={12} />
          <span>Attach</span>
          <input type="file" multiple class="sr-only" onchange={onPickFiles} />
        </label>
        <span class="text-ink-400">
          {text.trim().length} chars{attachments.length ? ` · ${attachments.length} file${attachments.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      <button
        onclick={submit}
        disabled={status === 'saving' || uploading > 0 || (!text.trim() && attachments.length === 0)}
        class="btn-primary"
      >
        {#if status === 'saving'}Saving…{:else}Save to Inbox <Icon name="arrow-right" size={16} />{/if}
      </button>
    </div>

    {#if message}
      <p class="text-sm {status === 'error' ? 'text-tag-salesText' : 'text-tag-nutritionText'}">
        {message}
      </p>
    {/if}

    <p class="text-[11px] text-ink-400">
      Tip: <kbd class="rounded border border-surface-border bg-surface-hover px-1 text-[10px]">⌘V</kbd>
      or <kbd class="rounded border border-surface-border bg-surface-hover px-1 text-[10px]">Ctrl+V</kbd>
      to paste images straight in. Drop files anywhere on the card.
    </p>
  </div>
</div>
