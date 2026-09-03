<script lang="ts">
  // Settings → Buffer. Surfaces the channels connected in Buffer
  // (LinkedIn, Facebook, Instagram, …) that twin publishes to via the
  // Evergreen → Buffer queue. Each channel links to a twin project so
  // campaigns know who it belongs to. The channel list itself is
  // synced from Buffer by scripts/sync-buffer-channels.mjs — this view
  // reads + project-links them; it doesn't re-fetch from Buffer.
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import {
    listBufferChannels,
    updateBufferChannel,
    searchProjects,
    formatError,
    type BufferChannel,
    type Project
  } from '$lib/directus';

  let channels = $state<BufferChannel[]>([]);
  let loading = $state(true);
  let error = $state('');

  async function refresh() {
    loading = true;
    error = '';
    try {
      channels = await listBufferChannels();
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void refresh();
  });

  // Group by service, LinkedIn first (the focus), then FB, IG, rest.
  const ORDER = ['linkedin', 'facebook', 'instagram'];
  const SERVICE_LABEL: Record<string, string> = {
    linkedin: 'LinkedIn',
    facebook: 'Facebook',
    instagram: 'Instagram'
  };
  const grouped = $derived.by(() => {
    const map = new Map<string, BufferChannel[]>();
    for (const c of channels) {
      const k = c.service ?? 'other';
      (map.get(k) ?? map.set(k, []).get(k)!).push(c);
    }
    return [...map.entries()].sort((a, b) => {
      const ai = ORDER.indexOf(a[0]);
      const bi = ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  });

  // ── Inline project linker ──────────────────────────────────────────
  let linkingId = $state<string | null>(null);
  let projQuery = $state('');
  let projResults = $state<Project[]>([]);
  let projTimer: ReturnType<typeof setTimeout> | null = null;

  function openLink(id: string) {
    linkingId = id;
    projQuery = '';
    projResults = [];
  }
  function closeLink() {
    linkingId = null;
    projResults = [];
    if (projTimer) clearTimeout(projTimer);
  }
  function onProjQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    projQuery = v;
    if (projTimer) clearTimeout(projTimer);
    projTimer = setTimeout(async () => {
      if (!v.trim()) {
        projResults = [];
        return;
      }
      try {
        projResults = await searchProjects(v, 6);
      } catch (e) {
        error = formatError(e);
      }
    }, 180);
  }
  function projName(proj: number | Project | null | undefined): string | null {
    if (proj && typeof proj === 'object') return proj.name ?? null;
    return null;
  }
  async function pickProject(id: string, proj: Project) {
    closeLink();
    try {
      await updateBufferChannel(id, { project_id: proj.id });
      channels = channels.map((c) => (c.id === id ? { ...c, project_id: { id: proj.id, name: proj.name } } : c));
    } catch (e) {
      error = formatError(e);
      void refresh();
    }
  }
  async function clearLink(id: string) {
    try {
      await updateBufferChannel(id, { project_id: null });
      channels = channels.map((c) => (c.id === id ? { ...c, project_id: null } : c));
    } catch (e) {
      error = formatError(e);
    }
  }
</script>

<div class="space-y-5">
  {#if error}
    <div class="rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">{error}</div>
  {/if}

  {#if loading}
    <div class="text-sm text-ink-400">Loading…</div>
  {:else if channels.length === 0}
    <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card px-4 py-6 text-center text-sm text-ink-400">
      No Buffer channels yet — connect them in Buffer, then run <span class="font-mono">scripts/sync-buffer-channels.mjs</span>.
    </div>
  {:else}
    {#each grouped as [service, list] (service)}
      <div class="space-y-2">
        <div class="flex items-center gap-2 px-1">
          {#if service === 'linkedin' || service === 'facebook' || service === 'instagram'}
            <Icon name={service} size={13} class="text-ink-400" />
          {/if}
          <span class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
            {SERVICE_LABEL[service] ?? service}
          </span>
          <span class="text-[10px] text-ink-300">{list.length}</span>
        </div>
        <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
          {#each list as c (c.id)}
            <li class="px-4 py-3" class:opacity-60={c.is_disconnected}>
              <div class="flex items-center gap-3">
                <Avatar name={c.display_name ?? c.name ?? '?'} src={c.avatar ?? undefined} size={28} />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate font-medium text-ink-900">{c.display_name ?? c.name}</span>
                    {#if c.is_disconnected}
                      <span class="rounded-full bg-tag-sales/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-tag-salesText">Disconnected</span>
                    {/if}
                  </div>
                  <div class="truncate text-xs text-ink-500">
                    {#if projName(c.project_id)}
                      <button type="button" class="text-ink-600 hover:text-ink-900" onclick={() => openLink(c.id)}>{projName(c.project_id)}</button>
                      <button type="button" class="ml-1 text-ink-300 hover:text-ink-600" aria-label="Unlink project" onclick={() => clearLink(c.id)}><Icon name="x" size={10} /></button>
                    {:else}
                      <button type="button" class="text-ink-400 hover:text-ink-700" onclick={() => openLink(c.id)}>+ Link project</button>
                    {/if}
                  </div>
                </div>
              </div>
              {#if linkingId === c.id}
                <div class="mt-2 rounded-[10px] border border-surface-border bg-surface-hover/40 p-2">
                  <input
                    type="text"
                    autocomplete="off"
                    class="input w-full text-sm"
                    placeholder="Search projects…"
                    value={projQuery}
                    oninput={onProjQuery}
                  />
                  {#if projResults.length > 0}
                    <ul class="mt-1 max-h-44 overflow-auto">
                      {#each projResults as p (p.id)}
                        <li>
                          <button type="button" class="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-sm hover:bg-surface-hover" onclick={() => pickProject(c.id, p)}>
                            <span class="truncate">{p.name}</span>
                            {#if p.kind}<span class="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-ink-400">{p.kind}</span>{/if}
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  {/if}
</div>
