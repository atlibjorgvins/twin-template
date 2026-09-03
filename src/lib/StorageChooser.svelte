<script lang="ts">
  // The storage/backend chooser — shared by the /welcome storage step and
  // Settings → Storage, so the two surfaces can never drift on what the
  // options are or what they need. This component owns the option cards, the
  // credential fields, and validity; the PAGE owns when the choice is applied
  // (the wizard applies on finish, settings on its Apply button) via the
  // bindable props.
  import { activeBackend, deviceDirectusUrl, type BackendId } from '$lib/data/repo';
  import { PUBLIC_DIRECTUS_URL } from '$env/static/public';

  let {
    backendPick = $bindable(activeBackend),
    sbUrl = $bindable(''),
    sbKey = $bindable(''),
    dxUrl = $bindable(deviceDirectusUrl() || (PUBLIC_DIRECTUS_URL ?? '').trim()),
    dxToken = $bindable('')
  }: {
    backendPick?: BackendId;
    sbUrl?: string;
    sbKey?: string;
    dxUrl?: string;
    dxToken?: string;
  } = $props();

  const effectiveDirectusUrl = deviceDirectusUrl() || (PUBLIC_DIRECTUS_URL ?? '').trim();

  type StorageOption = { id: BackendId; label: string; blurb: string; badge?: string };
  const STORAGE_OPTIONS: StorageOption[] = [
    {
      id: 'local',
      label: 'This device',
      badge: 'simplest',
      blurb:
        'Everything is saved inside this app, on this machine. Private, free, works with no ' +
        'internet — but it lives on one device, so make exports part of your habit.'
    },
    {
      id: 'supabase',
      label: 'Supabase cloud',
      badge: 'free tier',
      blurb:
        'A free cloud database that you own. Your twin is reachable from every device you ' +
        'sign in on. Create a project at supabase.com, then paste its URL and anon key below.'
    },
    {
      id: 'directus',
      label: 'External database',
      badge: 'advanced',
      blurb:
        'Connect to a database server you (or your team) run — twin speaks Directus. ' +
        (effectiveDirectusUrl
          ? `This build already knows one at ${effectiveDirectusUrl}; keep it or point elsewhere below.`
          : 'Enter its URL below — the docker-compose stack in the repo gives you one in minutes.')
    }
  ];
</script>

<div class="space-y-2" role="radiogroup" aria-label="Where your data is stored">
  {#each STORAGE_OPTIONS as o (o.id)}
    {@const selected = backendPick === o.id}
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      class="block w-full p-3 text-left transition"
      style={`border: 1px solid ${selected ? 'var(--accent-electric)' : 'var(--border-subtle)'}; border-radius: var(--radius-md); background: ${selected ? 'var(--accent-alpha-10)' : 'transparent'};`}
      onclick={() => (backendPick = o.id)}
    >
      <span class="flex items-center gap-2">
        <span
          class="inline-block h-3 w-3 shrink-0"
          style={`border-radius: 9999px; border: 1px solid var(--border-strong); background: ${selected ? 'var(--accent-electric)' : 'transparent'};`}
        ></span>
        <span class="font-display font-medium" style="letter-spacing: -0.01em;">{o.label}</span>
        {#if o.badge}
          <span class="text-[10px] uppercase tracking-wider text-ink-400">{o.badge}</span>
        {/if}
        {#if o.id === activeBackend}
          <span class="ml-auto text-[10px] uppercase tracking-wider" style="color: var(--accent-electric);">current</span>
        {/if}
      </span>
      <span class="mt-1 block pl-5 text-xs text-ink-500">{o.blurb}</span>
    </button>
  {/each}
</div>

{#if backendPick === 'supabase'}
  <div class="mt-4 space-y-2">
    <label class="block">
      <span class="mb-1 block text-xs text-ink-400">Supabase project URL</span>
      <input type="url" class="input w-full" placeholder="https://abcdefgh.supabase.co" bind:value={sbUrl} />
    </label>
    <label class="block">
      <span class="mb-1 block text-xs text-ink-400">Anon (public) key</span>
      <input type="text" class="input w-full" placeholder="eyJhbGciOi…" bind:value={sbKey} />
    </label>
    <p class="text-xs text-ink-400">
      Both are on your project's API settings page. The anon key is designed to be
      public — it only grants what your database rules allow.
    </p>
  </div>
{/if}
{#if backendPick === 'directus'}
  <div class="mt-4 space-y-2">
    <label class="block">
      <span class="mb-1 block text-xs text-ink-400">Server URL</span>
      <input type="url" class="input w-full" placeholder="https://twin.example.com" bind:value={dxUrl} />
    </label>
    <label class="block">
      <span class="mb-1 block text-xs text-ink-400">Access token (optional)</span>
      <input type="text" class="input w-full" placeholder="Leave empty for a public-read server or session login" bind:value={dxToken} />
    </label>
    <p class="text-xs text-ink-400">
      Any Directus server works — your own machine, a NAS, or a host. The repo's
      docker-compose file stands one up with a single command; the setup guide in the
      README walks through it and through creating the token.
    </p>
  </div>
{/if}
