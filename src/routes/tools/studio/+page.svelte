<script lang="ts">
  // Image Studio — template list. A template is a layered design
  // (base photo + PNG overlays + dynamic {token} text) applied across
  // a filtered set of records; rendering happens in the browser and
  // the outputs land back in Directus (Files → Studio).
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import { formatError } from '$lib/directus';
  import {
    createImageTemplate,
    duplicateImageTemplate,
    newLayer,
    type ImageTemplate
  } from '$lib/studio/data';

  let { data }: { data: { templates: ImageTemplate[]; error: string | null } } = $props();
  let templates = $state<ImageTemplate[]>([...data.templates]);
  let creating = $state<'template' | 'oneoff' | 'carousel' | null>(null);
  let errorMsg = $state<string | null>(data.error);

  // One-off batches keep their config + outputs, but are not offered
  // as reusable templates — they live in their own quieter section.
  // Carousels ("summary posts") are a different editor entirely.
  const reusable = $derived(templates.filter((t) => t.kind !== 'oneoff' && t.kind !== 'carousel'));
  const oneoffs = $derived(templates.filter((t) => t.kind === 'oneoff'));
  const carousels = $derived(templates.filter((t) => t.kind === 'carousel'));

  const SOURCE_LABEL: Record<string, string> = {
    organization: 'Organizations',
    Person: 'People',
    Project: 'Projects'
  };

  async function newTemplate(kind: 'template' | 'oneoff') {
    creating = kind;
    errorMsg = null;
    try {
      const t = await createImageTemplate({
        name:
          kind === 'oneoff'
            ? `One-off batch — ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date())}`
            : 'New template',
        status: 'draft',
        kind,
        width: 1080,
        height: 1080,
        source_collection: 'organization',
        layers: [newLayer('base'), newLayer('text')]
      });
      await goto(`/tools/studio/${t.id}`);
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      creating = null;
    }
  }

  async function newSummary() {
    creating = 'carousel';
    errorMsg = null;
    try {
      const t = await createImageTemplate({
        name: 'New summary post',
        status: 'draft',
        kind: 'carousel',
        width: 1080,
        height: 1080,
        background: '#111114',
        slides: [],
        assignments: []
      });
      await goto(`/tools/studio/carousel/${t.id}`);
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      creating = null;
    }
  }

  async function duplicate(t: ImageTemplate) {
    errorMsg = null;
    try {
      const copy = await duplicateImageTemplate(t.id);
      templates = [copy, ...templates];
    } catch (e) {
      errorMsg = formatError(e);
    }
  }
</script>

<svelte:head><title>Image studio · Tools</title></svelte:head>

<section class="mx-auto max-w-3xl space-y-5">
  <header class="flex items-start justify-between gap-3">
    <div>
      <a href="/tools" class="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700">
        <Icon name="chevron-left" size={12} /> Tools
      </a>
      <h1 class="font-display mt-1 text-2xl font-bold" style="letter-spacing: -0.03em;">Image studio</h1>
      <p class="mt-1 max-w-xl text-sm text-ink-500">
        Layered image templates — crop record photos, drop PNG overlays on top and fill
        {'{name}'}-style text from the database. Batch-render straight back into Directus.
      </p>
    </div>
    <div class="flex shrink-0 flex-col items-end gap-1.5">
      <button class="btn-primary" disabled={creating !== null} onclick={() => newTemplate('template')}>
        {creating === 'template' ? 'Creating…' : '+ New template'}
      </button>
      <button
        class="btn-ghost text-xs"
        title="Multi-image carousel built from an event's photo gallery"
        disabled={creating !== null}
        onclick={newSummary}
      >
        {creating === 'carousel' ? 'Creating…' : '+ Summary post'}
      </button>
      <button
        class="btn-ghost text-xs"
        title="Design + generate once — saved here, but not offered as a reusable template"
        disabled={creating !== null}
        onclick={() => newTemplate('oneoff')}
      >
        {creating === 'oneoff' ? 'Creating…' : 'One-off batch'}
      </button>
    </div>
  </header>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-3 text-sm" style="color: #C0392B;">{errorMsg}</div>
  {/if}

  {#if reusable.length === 0}
    <div class="rounded-[14px] border border-dashed border-surface-border p-8 text-center text-sm text-ink-400">
      No templates yet — create one to design your first overlay.
    </div>
  {:else}
    <ul class="space-y-2">
      {#each reusable as t (t.id)}
        <li class="flex items-center gap-3 rounded-[14px] border border-surface-border bg-surface-card px-4 py-3 transition hover:bg-surface-hover">
          <a href={`/tools/studio/${t.id}`} class="flex min-w-0 flex-1 items-center gap-3">
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-md text-ink-400" style="background: var(--bg-tertiary);">
              <Icon name="image" size={18} />
            </span>
            <span class="min-w-0">
              <span class="flex items-center gap-2">
                <span class="truncate text-sm font-medium text-ink-900">{t.name ?? 'Untitled'}</span>
                {#if t.status === 'draft'}
                  <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style="background: rgba(214,158,46,0.16); color: #B57A12;">draft</span>
                {/if}
              </span>
              <span class="mt-0.5 block truncate text-[11px] text-ink-500">
                {t.width ?? 1080}×{t.height ?? 1080} · {SOURCE_LABEL[t.source_collection ?? ''] ?? t.source_collection} · {(t.layers ?? []).length} layer{(t.layers ?? []).length === 1 ? '' : 's'}
              </span>
            </span>
          </a>
          <button class="btn-ghost !px-2 text-xs" title="Duplicate template" onclick={() => duplicate(t)}>
            <Icon name="copy" size={15} />
          </button>
          <a href={`/tools/studio/${t.id}`} class="btn-ghost !px-2 text-xs" title="Open template">
            <Icon name="chevron-right" size={15} />
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if carousels.length > 0}
    <div class="space-y-2">
      <div class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">Summary posts</div>
      <ul class="space-y-2">
        {#each carousels as t (t.id)}
          <li class="flex items-center gap-3 rounded-[14px] border border-surface-border bg-surface-card px-4 py-2.5 transition hover:bg-surface-hover">
            <a href={`/tools/studio/carousel/${t.id}`} class="flex min-w-0 flex-1 items-center gap-3">
              <span class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-400" style="background: var(--bg-tertiary);">
                <Icon name="layers" size={15} />
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm text-ink-900">{t.name ?? 'Summary post'}</span>
                <span class="mt-0.5 block truncate text-[11px] text-ink-500">
                  {(t.slides ?? []).length} slide{(t.slides ?? []).length === 1 ? '' : 's'} · {(t.assignments ?? []).filter(Boolean).length} photos placed
                </span>
              </span>
            </a>
            <button class="btn-ghost !px-2 text-xs" title="Duplicate (reuse structure)" onclick={() => duplicate(t)}>
              <Icon name="copy" size={15} />
            </button>
            <a href={`/tools/studio/carousel/${t.id}`} class="btn-ghost !px-2 text-xs" title="Open summary post">
              <Icon name="chevron-right" size={15} />
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if oneoffs.length > 0}
    <div class="space-y-2">
      <div class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">One-off batches</div>
      <ul class="space-y-2">
        {#each oneoffs as t (t.id)}
          <li class="flex items-center gap-3 rounded-[14px] border border-surface-border bg-surface-card px-4 py-2.5 transition hover:bg-surface-hover">
            <a href={`/tools/studio/${t.id}`} class="flex min-w-0 flex-1 items-center gap-3">
              <span class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-400" style="background: var(--bg-tertiary);">
                <Icon name="bolt" size={15} />
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm text-ink-900">{t.name ?? 'One-off batch'}</span>
                <span class="mt-0.5 block truncate text-[11px] text-ink-500">
                  {t.width ?? 1080}×{t.height ?? 1080} · {SOURCE_LABEL[t.source_collection ?? ''] ?? t.source_collection}
                </span>
              </span>
            </a>
            <a href={`/tools/studio/${t.id}`} class="btn-ghost !px-2 text-xs" title="Open batch">
              <Icon name="chevron-right" size={15} />
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
