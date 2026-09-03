<script lang="ts">
  // Settings → Meta. Manages twin's first-party Meta connection: the
  // System-User-token proxy Flow, the synced publishing targets (FB
  // Pages / Instagram accounts) and the ad accounts, each linkable to a
  // client org. Mirrors the other /settings admin components — loads on
  // mount via $effect, writes immediately, no save button.
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import { PUBLIC_DIRECTUS_URL } from '$env/static/public';
  import {
    listMetaChannels,
    updateMetaChannel,
    syncMetaChannels,
    metaConfigured,
    listMkAdAccounts,
    updateMkAdAccount,
    searchProjects,
    formatError,
    type MetaChannel,
    type MkAdAccount,
    type Project
  } from '$lib/directus';

  const configured = metaConfigured();
  const GRAPH_URL = 'https://graph.facebook.com/v21.0/{{$trigger.body.path}}';
  const METHOD_TMPL = '{{$trigger.body.method}}';
  const SCOPES =
    'pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, business_management, ads_read';

  let channels = $state<MetaChannel[]>([]);
  let accounts = $state<MkAdAccount[]>([]);
  let loading = $state(true);
  let error = $state('');
  let syncing = $state(false);
  let setupOpen = $state(!configured);

  async function refresh() {
    loading = true;
    error = '';
    try {
      [channels, accounts] = await Promise.all([listMetaChannels(), listMkAdAccounts()]);
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void refresh();
  });

  async function sync() {
    syncing = true;
    error = '';
    try {
      channels = await syncMetaChannels();
    } catch (e) {
      error = formatError(e);
    } finally {
      syncing = false;
    }
  }

  async function toggleChannel(c: MetaChannel) {
    const next = !c.is_enabled;
    channels = channels.map((x) => (x.id === c.id ? { ...x, is_enabled: next } : x));
    try {
      await updateMetaChannel(c.id, { is_enabled: next });
    } catch (e) {
      error = formatError(e);
      void refresh();
    }
  }

  // ── Inline project linker (shared by channels + ad accounts) ───────
  type LinkTarget = { kind: 'channel' | 'account'; id: string };
  let linking = $state<LinkTarget | null>(null);
  let projQuery = $state('');
  let projResults = $state<Project[]>([]);
  let projTimer: ReturnType<typeof setTimeout> | null = null;

  function openLink(t: LinkTarget) {
    linking = t;
    projQuery = '';
    projResults = [];
  }
  function closeLink() {
    linking = null;
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
  async function pickProject(proj: Project) {
    if (!linking) return;
    const t = linking;
    closeLink();
    try {
      if (t.kind === 'channel') {
        await updateMetaChannel(t.id, { project_id: proj.id });
        channels = channels.map((c) => (c.id === t.id ? { ...c, project_id: { id: proj.id, name: proj.name } } : c));
      } else {
        await updateMkAdAccount(t.id, { project_id: proj.id });
        accounts = accounts.map((a) => (a.id === t.id ? { ...a, project_id: { id: proj.id, name: proj.name } } : a));
      }
    } catch (e) {
      error = formatError(e);
      void refresh();
    }
  }
  async function clearLink(t: LinkTarget) {
    try {
      if (t.kind === 'channel') {
        await updateMetaChannel(t.id, { project_id: null });
        channels = channels.map((c) => (c.id === t.id ? { ...c, project_id: null } : c));
      } else {
        await updateMkAdAccount(t.id, { project_id: null });
        accounts = accounts.map((a) => (a.id === t.id ? { ...a, project_id: null } : a));
      }
    } catch (e) {
      error = formatError(e);
    }
  }

  // ── Copy helper ────────────────────────────────────────────────────
  let copiedKey = $state('');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* nothing else to try */
      }
      ta.remove();
    }
    copiedKey = key;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copiedKey = ''), 1500);
  }

  const fbPages = $derived(channels.filter((c) => c.kind !== 'instagram'));
  const igAccounts = $derived(channels.filter((c) => c.kind === 'instagram'));
</script>

<div class="space-y-5">
  {#if error}
    <div class="rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">{error}</div>
  {/if}

  <!-- Connection status -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
    <div class="flex items-center gap-3">
      <span
        class="flex h-9 w-9 shrink-0 items-center justify-center"
        style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);"
      >
        <Icon name="globe" size={16} />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="font-medium text-ink-900">Meta Graph proxy</span>
          {#if configured}
            <span class="rounded-full bg-tag-eventText/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tag-eventText">Connected</span>
          {:else}
            <span class="rounded-full bg-tag-sales/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tag-salesText">Not connected</span>
          {/if}
        </div>
        <div class="text-xs text-ink-500">
          {#if configured}
            Publishing + ad reports route through your Directus Flow, token held server-side.
          {:else}
            Create the Flow below and set <code class="font-mono">META_FLOW_ID</code> to go live.
          {/if}
        </div>
      </div>
      {#if configured}
        <button
          type="button"
          onclick={sync}
          disabled={syncing}
          class="flex shrink-0 items-center gap-1.5 rounded-[10px] border border-surface-border px-3 py-2 text-xs font-medium text-ink-700 transition hover:bg-surface-hover disabled:opacity-50"
        >
          <Icon name="download" size={14} />
          {syncing ? 'Syncing…' : 'Sync from Meta'}
        </button>
      {/if}
    </div>
  </div>

  <!-- Setup instructions -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card">
    <button
      type="button"
      class="flex w-full items-center gap-2 px-4 py-3 text-left"
      onclick={() => (setupOpen = !setupOpen)}
    >
      <Icon name="chevron-right" size={14} class="text-ink-400 transition-transform {setupOpen ? 'rotate-90' : ''}" />
      <span class="font-medium text-ink-900">Connection setup</span>
      <span class="ml-auto text-xs text-ink-400">System User token · proxy Flow</span>
    </button>
    {#if setupOpen}
      <div class="space-y-4 border-t border-surface-divider px-4 py-4 text-sm">
        <ol class="space-y-3 text-ink-600">
          <li>
            <span class="font-medium text-ink-900">1. Generate a System User token</span> at
            <a class="text-tag-eventText underline" href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer">Business Settings → System Users</a>.
            Assign your Pages, Instagram accounts and ad accounts to it, then
            <em>Generate token</em> for app <span class="font-mono">1625209488084075</span>, expiration <strong>Never</strong>, with these scopes:
            <div class="mt-1.5 flex items-stretch gap-2">
              <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[8px] border border-surface-border px-2.5 py-1.5 font-mono text-[11px] text-ink-900" style="background: var(--bg-tertiary);">{SCOPES}</code>
              <button type="button" onclick={() => copy(SCOPES, 'scopes')} class="flex shrink-0 items-center gap-1 rounded-[8px] border border-surface-border px-2 text-xs text-ink-700 hover:bg-surface-hover">
                <Icon name={copiedKey === 'scopes' ? 'check' : 'copy'} size={12} />
              </button>
            </div>
          </li>
          <li>
            <span class="font-medium text-ink-900">2. Create a Directus Flow</span> named “Meta Graph proxy” —
            <a class="text-tag-eventText underline" href={`${PUBLIC_DIRECTUS_URL}/admin/settings/flows`} target="_blank" rel="noreferrer">open Flows</a>.
            Trigger: <strong>Webhook</strong>, method <strong>POST</strong>, response body “Data of last operation”.
          </li>
          <li>
            <span class="font-medium text-ink-900">3. Add one “Web Request” operation:</span>
            <div class="mt-1.5 space-y-1.5">
              <div class="flex items-stretch gap-2">
                <span class="w-16 shrink-0 pt-1.5 text-[11px] uppercase tracking-wide text-ink-400">Method</span>
                <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[8px] border border-surface-border px-2.5 py-1.5 font-mono text-[11px] text-ink-900" style="background: var(--bg-tertiary);">{METHOD_TMPL}</code>
                <button type="button" onclick={() => copy(METHOD_TMPL, 'method')} class="flex shrink-0 items-center gap-1 rounded-[8px] border border-surface-border px-2 text-xs text-ink-700 hover:bg-surface-hover"><Icon name={copiedKey === 'method' ? 'check' : 'copy'} size={12} /></button>
              </div>
              <div class="flex items-stretch gap-2">
                <span class="w-16 shrink-0 pt-1.5 text-[11px] uppercase tracking-wide text-ink-400">URL</span>
                <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[8px] border border-surface-border px-2.5 py-1.5 font-mono text-[11px] text-ink-900" style="background: var(--bg-tertiary);">{GRAPH_URL}</code>
                <button type="button" onclick={() => copy(GRAPH_URL, 'url')} class="flex shrink-0 items-center gap-1 rounded-[8px] border border-surface-border px-2 text-xs text-ink-700 hover:bg-surface-hover"><Icon name={copiedKey === 'url' ? 'check' : 'copy'} size={12} /></button>
              </div>
              <div class="flex items-stretch gap-2">
                <span class="w-16 shrink-0 pt-1.5 text-[11px] uppercase tracking-wide text-ink-400">Header</span>
                <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[8px] border border-surface-border px-2.5 py-1.5 font-mono text-[11px] text-ink-900" style="background: var(--bg-tertiary);">Authorization: Bearer &lt;YOUR_SYSTEM_USER_TOKEN&gt;</code>
                <button type="button" onclick={() => copy('Authorization', 'hdr')} class="flex shrink-0 items-center gap-1 rounded-[8px] border border-surface-border px-2 text-xs text-ink-700 hover:bg-surface-hover"><Icon name={copiedKey === 'hdr' ? 'check' : 'copy'} size={12} /></button>
              </div>
            </div>
            <p class="mt-1.5 text-xs text-ink-400">The token lives only in this header, server-side. twin sends just <span class="font-mono">{'{ method, path }'}</span>.</p>
          </li>
          <li>
            <span class="font-medium text-ink-900">4. Copy the Flow’s id</span> (from its URL) into
            <code class="font-mono">META_FLOW_ID</code> in <span class="font-mono">src/lib/directus.ts</span>, then deploy.
          </li>
        </ol>
      </div>
    {/if}
  </div>

  {#if loading}
    <div class="text-sm text-ink-400">Loading…</div>
  {:else}
    <!-- Publishing targets -->
    <div class="space-y-2">
      <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        Publishing targets
      </div>
      {#if channels.length === 0}
        <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card px-4 py-6 text-center text-sm text-ink-400">
          {configured ? 'No Pages or Instagram accounts yet — hit “Sync from Meta”.' : 'Connect the proxy above, then sync your Pages and Instagram accounts.'}
        </div>
      {:else}
        <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
          {#each [...fbPages, ...igAccounts] as c (c.id)}
            <li class="px-4 py-3">
              <div class="flex items-center gap-3">
                <Avatar name={c.name ?? '?'} src={c.avatar ?? undefined} size={28} />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate font-medium text-ink-900">{c.name}</span>
                    <span class="rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide {c.kind === 'instagram' ? 'bg-tag-personalText/10 text-tag-personalText' : 'bg-tag-eventText/10 text-tag-eventText'}">
                      {c.kind === 'instagram' ? 'Instagram' : 'Facebook'}
                    </span>
                  </div>
                  <div class="truncate text-xs text-ink-500">
                    {#if projName(c.project_id)}
                      <button type="button" class="text-ink-600 hover:text-ink-900" onclick={() => openLink({ kind: 'channel', id: c.id })}>{projName(c.project_id)}</button>
                      <button type="button" class="ml-1 text-ink-300 hover:text-ink-600" aria-label="Unlink project" onclick={() => clearLink({ kind: 'channel', id: c.id })}><Icon name="x" size={10} /></button>
                    {:else}
                      <button type="button" class="text-ink-400 hover:text-ink-700" onclick={() => openLink({ kind: 'channel', id: c.id })}>+ Link project</button>
                    {/if}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.is_enabled ?? false}
                  onclick={() => toggleChannel(c)}
                  class="relative h-5 w-9 shrink-0 rounded-full transition-colors {c.is_enabled ? 'bg-tag-eventText' : 'bg-surface-divider'}"
                  aria-label="Toggle target"
                >
                  <span class="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all {c.is_enabled ? 'left-[18px]' : 'left-0.5'}"></span>
                </button>
              </div>
              {#if linking && linking.kind === 'channel' && linking.id === c.id}
                {@render orgPicker()}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Ad accounts -->
    <div class="space-y-2">
      <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        Ad accounts <span class="text-ink-300">· for reports</span>
      </div>
      {#if accounts.length === 0}
        <div class="rounded-[14px] border border-dashed border-surface-border bg-surface-card px-4 py-6 text-center text-sm text-ink-400">
          No ad accounts registered yet.
        </div>
      {:else}
        <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
          {#each accounts as a (a.id)}
            <li class="px-4 py-3">
              <div class="flex items-center gap-3">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style="background: var(--bg-tertiary); color: var(--text-secondary);"><Icon name="layers" size={14} /></span>
                <div class="min-w-0 flex-1">
                  <div class="truncate font-medium text-ink-900">{a.name ?? a.id}</div>
                  <div class="truncate text-xs text-ink-500">
                    {#if projName(a.project_id)}
                      <button type="button" class="text-ink-600 hover:text-ink-900" onclick={() => openLink({ kind: 'account', id: a.id })}>{projName(a.project_id)}</button>
                      <button type="button" class="ml-1 text-ink-300 hover:text-ink-600" aria-label="Unlink project" onclick={() => clearLink({ kind: 'account', id: a.id })}><Icon name="x" size={10} /></button>
                    {:else}
                      <button type="button" class="text-ink-400 hover:text-ink-700" onclick={() => openLink({ kind: 'account', id: a.id })}>+ Link project</button>
                    {/if}
                    {#if a.currency}<span class="ml-2 text-ink-300">{a.currency}</span>{/if}
                  </div>
                </div>
              </div>
              {#if linking && linking.kind === 'account' && linking.id === a.id}
                {@render orgPicker()}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

{#snippet orgPicker()}
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
            <button type="button" class="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-sm hover:bg-surface-hover" onclick={() => pickProject(p)}>
              <span class="truncate">{p.name}</span>
              {#if p.kind}<span class="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-ink-400">{p.kind}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}
