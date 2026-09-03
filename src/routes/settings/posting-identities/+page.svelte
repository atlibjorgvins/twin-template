<script lang="ts">
  // Settings → Posting identities. The presets the Evergreen workbench
  // offers in its identity dropdown: page name, handle, avatar URL.
  // Exactly one row should be the default — the radio enforces it via
  // setDefaultPostingIdentity (clears the flag on the others).
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import {
    listPostingIdentities,
    createPostingIdentity,
    updatePostingIdentity,
    deletePostingIdentity,
    setDefaultPostingIdentity,
    listBufferChannels,
    formatError,
    type PostingIdentity,
    type BufferChannel
  } from '$lib/directus';

  let identities = $state<PostingIdentity[]>([]);
  let channels = $state<BufferChannel[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Which Buffer channel each identity posts through, per platform.
  //
  // This page used to manage only the preview (name, handle, avatar), while
  // the channel that actually receives the post lived in an unreachable JSON
  // column. An identity with none set does NOT refuse to post — Evergreen
  // falls back to "first connected channel of that service", which is how a
  // Startup SuperNova campaign quietly scheduled twenty posts onto KLAK's
  // Instagram and Facebook. That fallback is silent, so the mapping has to be
  // visible here, and an unmapped platform has to say what it will do instead.
  const SERVICES: ReadonlyArray<[string, string]> = [
    ['facebook', 'Facebook'],
    ['instagram', 'Instagram'],
    ['linkedin', 'LinkedIn']
  ];
  const channelsFor = (service: string) =>
    channels.filter((c) => c.service === service && !c.is_disconnected);
  /** What Evergreen would actually use for this identity + platform today. */
  const resolvedChannel = (i: PostingIdentity, service: string): BufferChannel | null => {
    const mapped = i.channels?.[service];
    if (mapped) {
      const c = channels.find((x) => x.id === mapped && !x.is_disconnected);
      if (c) return c;
    }
    return channelsFor(service)[0] ?? null;
  };

  async function setChannel(i: PostingIdentity, service: string, channelId: string) {
    const next: Record<string, string> = { ...(i.channels ?? {}) } as Record<string, string>;
    if (channelId) next[service] = channelId;
    else delete next[service];
    try {
      await updatePostingIdentity(i.id, { channels: next });
      identities = identities.map((x) => (x.id === i.id ? { ...x, channels: next } : x));
    } catch (e) {
      error = formatError(e);
    }
  }

  async function refresh() {
    loading = true;
    error = '';
    try {
      // Channels are optional — a missing Buffer connection must not stop you
      // editing the names and handles.
      const [ids, chs] = await Promise.all([
        listPostingIdentities(),
        listBufferChannels().catch(() => [] as BufferChannel[])
      ]);
      identities = ids;
      channels = chs;
    } catch (e) {
      error = formatError(e);
    } finally {
      loading = false;
    }
  }
  onMount(refresh);

  // New-row form.
  let newName = $state('');
  let newHandle = $state('');
  let newAvatar = $state('');
  let adding = $state(false);

  async function add() {
    if (!newName.trim()) return;
    adding = true;
    error = '';
    try {
      const created = await createPostingIdentity({
        name: newName.trim(),
        handle: newHandle.trim() || null,
        avatar_url: newAvatar.trim() || null,
        // First preset becomes the default automatically.
        is_default: identities.length === 0
      });
      identities = [...identities, created];
      newName = newHandle = newAvatar = '';
    } catch (e) {
      error = formatError(e);
    } finally {
      adding = false;
    }
  }

  // Inline edits save on blur.
  async function patchField(i: PostingIdentity, field: 'name' | 'handle' | 'avatar_url', value: string) {
    const v = value.trim() || null;
    if ((i[field] ?? null) === v) return;
    try {
      await updatePostingIdentity(i.id, { [field]: v });
      identities = identities.map((x) => (x.id === i.id ? { ...x, [field]: v } : x));
    } catch (e) {
      error = formatError(e);
    }
  }

  async function makeDefault(i: PostingIdentity) {
    if (i.is_default) return;
    try {
      await setDefaultPostingIdentity(i.id);
      identities = identities.map((x) => ({ ...x, is_default: x.id === i.id }));
    } catch (e) {
      error = formatError(e);
    }
  }

  async function remove(i: PostingIdentity) {
    if (!confirm(`Delete "${i.name}"? Campaigns using it fall back to the default preset.`)) return;
    try {
      await deletePostingIdentity(i.id);
      identities = identities.filter((x) => x.id !== i.id);
    } catch (e) {
      error = formatError(e);
    }
  }

  const initials = (name?: string | null) =>
    (name ?? '')
      .split(/\s+/)
      .map((w) => w[0])
      .filter((ch) => !!ch && /[\p{L}\p{N}]/u.test(ch))
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
</script>

<svelte:head><title>Posting identities · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Posting identities"
    subtitle="Who a campaign posts as: the identity Evergreen shows in its previews, and the Buffer channel each platform actually posts through. An unmapped platform does not fail — it falls back to the first connected channel of that service, which is rarely the one you meant."
  />

  {#if error}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-3 text-sm" style="color: #C0392B;">{error}</div>
  {/if}

  {#if loading}
    <div class="py-8 text-center text-sm text-ink-400">Loading…</div>
  {:else}
    <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
      {#each identities as i (i.id)}
        <li class="space-y-2 px-4 py-3">
        <div class="flex flex-wrap items-center gap-3 sm:flex-nowrap">
          {#if i.avatar_url}
            <img src={i.avatar_url} alt="" class="h-9 w-9 shrink-0 rounded-full object-cover" />
          {:else}
            <span
              class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
              style="background: linear-gradient(135deg, #2C8C99, #1D6BFE);"
            >{initials(i.name)}</span>
          {/if}
          <div class="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-3">
            <input
              class="input w-full text-sm"
              placeholder="Page name"
              value={i.name ?? ''}
              onblur={(e) => patchField(i, 'name', (e.currentTarget as HTMLInputElement).value)}
            />
            <input
              class="input w-full text-sm"
              placeholder="Handle (Instagram)"
              value={i.handle ?? ''}
              onblur={(e) => patchField(i, 'handle', (e.currentTarget as HTMLInputElement).value)}
            />
            <input
              class="input w-full text-sm"
              placeholder="Avatar URL"
              value={i.avatar_url ?? ''}
              onblur={(e) => patchField(i, 'avatar_url', (e.currentTarget as HTMLInputElement).value)}
            />
          </div>
          <label class="flex shrink-0 items-center gap-1.5 text-xs text-ink-500">
            <input type="radio" name="default-identity" checked={!!i.is_default} onchange={() => makeDefault(i)} />
            Default
          </label>
          <button
            class="btn-ghost !px-2 shrink-0 text-ink-300 hover:text-ink-700"
            title="Delete preset"
            aria-label="Delete preset"
            onclick={() => remove(i)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <!-- Which channel actually receives the post, per platform. -->
        {#if channels.length > 0}
          <div class="grid gap-2 sm:grid-cols-3">
            {#each SERVICES as [svc, label] (svc)}
              {@const mapped = i.channels?.[svc] ?? ''}
              {@const resolved = resolvedChannel(i, svc)}
              <label class="block">
                <span class="mb-0.5 block font-display text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
                <select
                  class="input w-full text-sm"
                  value={mapped}
                  onchange={(e) => setChannel(i, svc, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">— not set —</option>
                  {#each channelsFor(svc) as c (c.id)}
                    <option value={c.id}>{c.display_name || c.name}</option>
                  {/each}
                </select>
                {#if !mapped}
                  <!-- Naming the fallback is the point: silence here is what
                       sent SuperNova's posts to KLAK. -->
                  <span class="mt-0.5 block text-[10px]" style="color: #B57A12;">
                    {resolved
                      ? `falls back to ${resolved.display_name || resolved.name}`
                      : 'no connected channel — cannot post'}
                  </span>
                {/if}
              </label>
            {/each}
          </div>
        {/if}
        </li>
      {/each}
      {#if identities.length === 0}
        <li class="px-4 py-6 text-center text-sm text-ink-400">
          No presets yet — add your page below. The first one becomes the default.
        </li>
      {/if}
    </ul>

    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
      <div class="mb-2 font-display text-[10px] uppercase tracking-wider text-ink-400">Add preset</div>
      <div class="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <input class="input w-full text-sm" placeholder="Page name (e.g. Acme Inc)" bind:value={newName} />
        <input class="input w-full text-sm" placeholder="Handle (e.g. acme.com)" bind:value={newHandle} />
        <input class="input w-full text-sm" placeholder="Avatar URL" bind:value={newAvatar} />
        <button class="btn-primary" disabled={adding || !newName.trim()} onclick={add}>
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  {/if}
</section>
