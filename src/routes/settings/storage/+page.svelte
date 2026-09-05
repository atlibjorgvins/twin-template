<script lang="ts">
  // Settings → Storage. The same decision the /welcome wizard offers, plus
  // what only a settings page needs: where this device's data lives RIGHT NOW,
  // whether the backend is reachable, and the JSON export (local mode's
  // safety valve). Hidden on managed session-mode instances — see the load
  // guard in +page.ts; the operator owns the database there.
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import Icon from '$lib/Icon.svelte';
  import StorageChooser from '$lib/StorageChooser.svelte';
  import {
    activeBackend,
    saveBackendChoice,
    deviceDirectusUrl,
    repo,
    localDump,
    mediaLocation,
    saveMediaLocation,
    type BackendId,
    type MediaLocation
  } from '$lib/data/repo';
  import { checkSupabaseConn, connCheckMessage } from '$lib/data/repo/validate';
  import { driveClientId, setDriveClientId, driveConnected, connectDrive } from '$lib/data/repo/driveMedia';
  import { localFileStore } from '$lib/data/repo/files';
  import { activeVault } from '$lib/data/repo/vaults';
  import { connection } from '$lib/offline';
  import { PUBLIC_DIRECTUS_URL } from '$env/static/public';
  import { onMount } from 'svelte';

  const effectiveDirectusUrl = deviceDirectusUrl() || (PUBLIC_DIRECTUS_URL ?? '').trim();
  const BACKEND_LABEL: Record<BackendId, string> = {
    local: 'This device',
    supabase: 'Supabase cloud',
    directus: 'External database (Directus)'
  };
  const whereItPoints =
    activeBackend === 'local'
      ? 'IndexedDB inside this app/browser'
      : activeBackend === 'supabase'
        ? activeVault().supabaseUrl || 'the build-configured Supabase project'
        : effectiveDirectusUrl;

  // Row counts through the port — works identically on every backend, and
  // doubles as proof the backend actually answers.
  let peopleCount = $state<number | null>(null);
  let orgCount = $state<number | null>(null);
  let countsFailed = $state(false);
  onMount(async () => {
    try {
      [peopleCount, orgCount] = await Promise.all([
        repo.count('Person'),
        repo.count('organization')
      ]);
    } catch {
      countsFailed = true;
    }
  });

  // ── Change storage (mirrors the wizard's finish() semantics) ────────────
  let backendPick = $state<BackendId>(activeBackend);
  let sbUrl = $state('');
  let sbKey = $state('');
  let dxUrl = $state(effectiveDirectusUrl);
  let dxToken = $state('');

  const valid = $derived(
    backendPick === 'local' ||
      (backendPick === 'supabase' && sbUrl.trim().length > 0 && sbKey.trim().length > 0) ||
      (backendPick === 'directus' && dxUrl.trim().length > 0)
  );
  const directusEdited = $derived(
    backendPick === 'directus' &&
      (dxUrl.trim() !== effectiveDirectusUrl || dxToken.trim().length > 0)
  );
  const changed = $derived(backendPick !== activeBackend || directusEdited);

  // A Supabase target is probed BEFORE the switch is saved — a rejected key
  // must fail here, next to the paste field, not as a broken vault later.
  let applyBusy = $state(false);
  let applyError = $state('');
  async function apply() {
    if (!valid || !changed || applyBusy) return;
    applyError = '';
    if (backendPick === 'supabase') {
      applyBusy = true;
      const check = await checkSupabaseConn(sbUrl.trim(), sbKey.trim());
      applyBusy = false;
      if (check !== 'ok') {
        applyError = connCheckMessage(check);
        return;
      }
    }
    saveBackendChoice(backendPick, {
      supabase: backendPick === 'supabase' ? { url: sbUrl, key: sbKey } : undefined,
      directus: backendPick === 'directus' ? { url: dxUrl, token: dxToken } : undefined
    });
    // A backend swap re-points the whole module graph — full load, not goto.
    window.location.href = '/';
  }

  // ── Media location ("offload") ──────────────────────────────────────────
  // Only meaningful on cloud backends; the local backend keeps media on the
  // device by definition.
  let mediaPick = $state<MediaLocation>(mediaLocation());
  function applyMedia() {
    if (mediaPick === mediaLocation()) return;
    saveMediaLocation(mediaPick);
    window.location.href = '/settings/storage'; // repo singleton — full reload
  }

  // ── Google Drive connect ────────────────────────────────────────────────
  let driveClientIdValue = $state(driveClientId());
  let driveIsConnected = $state(driveConnected());
  let driveBusy = $state(false);
  let driveError = $state('');
  async function connectDriveNow() {
    if (driveBusy || !driveClientIdValue.trim()) return;
    driveBusy = true;
    driveError = '';
    try {
      setDriveClientId(driveClientIdValue.trim());
      await connectDrive();
      driveIsConnected = driveConnected();
    } catch (e) {
      driveError = e instanceof Error ? e.message : String(e);
    } finally {
      driveBusy = false;
    }
  }

  // ── Import (local vault, empty only — ids are preserved as-is) ───────────
  let importing = $state(false);
  let importMsg = $state('');
  const vaultEmpty = $derived((peopleCount ?? 1) === 0 && (orgCount ?? 1) === 0);
  async function importJson(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file || importing) return;
    importing = true;
    importMsg = '';
    try {
      const payload = JSON.parse(await file.text()) as {
        collections?: Record<string, Record<string, unknown>[]> | null;
        media?: Record<string, { type?: string; title?: string; base64: string }>;
      };
      let rows = 0;
      for (const [collection, list] of Object.entries(payload.collections ?? {})) {
        for (const row of list) {
          await repo.create(collection, row); // ids preserved: create honors row.id
          rows++;
        }
      }
      let files = 0;
      const store = localFileStore();
      for (const [id, m] of Object.entries(payload.media ?? {})) {
        const bin = atob(m.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await store.put(new Blob([bytes], { type: m.type }), { id, title: m.title });
        files++;
      }
      importMsg = `Imported ${rows} rows and ${files} images — reloading…`;
      setTimeout(() => (window.location.href = '/'), 900);
    } catch (err) {
      importMsg = `Import failed: ${err instanceof Error ? err.message : 'not a twin export file'}`;
      importing = false;
    }
  }

  // ── Export (device data: rows if local, plus any device-stored media) ────
  let exporting = $state(false);
  const hasDeviceMedia = $derived(activeBackend === 'local' || mediaLocation() === 'device');
  async function exportJson() {
    exporting = true;
    try {
      const rows = await localDump();
      // Blobs → base64 so one JSON file carries the images too. Fine at
      // personal scale; a media-heavy vault would want a zip — later.
      const media: Record<string, { type?: string; title?: string; base64: string }> = {};
      if (hasDeviceMedia) {
        for (const f of await localFileStore().dumpAll()) {
          const buf = new Uint8Array(await f.blob.arrayBuffer());
          let bin = '';
          for (const b of buf) bin += String.fromCharCode(b);
          media[f.id] = { type: f.type, title: f.title, base64: btoa(bin) };
        }
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob(
        [JSON.stringify({ exportedAt: new Date().toISOString(), collections: rows, media }, null, 2)],
        { type: 'application/json' }
      );
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `twin-export-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      exporting = false;
    }
  }
</script>

<svelte:head><title>Storage · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Storage"
    subtitle="Where this device keeps your twin's data, and how to move it."
  />

  <!-- Current state ──────────────────────────────────────────────────── -->
  <div class="card p-4">
    <div class="flex items-center gap-3">
      <span class="flex h-9 w-9 shrink-0 items-center justify-center"
            style="background: var(--accent-alpha-10); color: var(--accent-electric); border-radius: var(--radius-md);">
        <Icon name="layers" size={16} />
      </span>
      <div class="min-w-0 flex-1">
        <div class="font-medium text-ink-900">{BACKEND_LABEL[activeBackend]}</div>
        <div class="truncate text-xs text-ink-500">{whereItPoints}</div>
      </div>
      <span class="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={$connection.offline
              ? 'background: color-mix(in srgb, var(--state-warning) 15%, transparent); color: var(--state-warning);'
              : 'background: color-mix(in srgb, var(--state-success) 15%, transparent); color: var(--state-success);'}>
        <span class="inline-block h-1.5 w-1.5 rounded-full" style="background: currentColor;"></span>
        {$connection.offline ? 'Unreachable' : 'Connected'}
      </span>
    </div>
    <div class="mt-3 flex gap-6 border-t pt-3 text-xs text-ink-500" style="border-color: var(--border-subtle);">
      {#if countsFailed}
        <span>Could not read row counts — the backend did not answer.</span>
      {:else}
        <span><span class="font-medium tabular-nums" style="color: var(--text-primary);">{peopleCount ?? '…'}</span> people</span>
        <span><span class="font-medium tabular-nums" style="color: var(--text-primary);">{orgCount ?? '…'}</span> organizations</span>
      {/if}
    </div>
  </div>

  <!-- Media location ("offload") ─────────────────────────────────────── -->
  {#if activeBackend !== 'local'}
    <fieldset class="card p-4 space-y-3" aria-label="Where images are stored">
      <legend class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Images & files</legend>
      <p class="text-xs text-ink-500">
        Rows and images are separate: your database holds the records, and images can either
        travel with them or stay on this machine.
      </p>
      <div class="space-y-2" role="radiogroup" aria-label="Image storage">
        <button type="button" role="radio" aria-checked={mediaPick === 'backend'}
                class="block w-full p-3 text-left transition"
                style={`border: 1px solid ${mediaPick === 'backend' ? 'var(--accent-electric)' : 'var(--border-subtle)'}; border-radius: var(--radius-md); background: ${mediaPick === 'backend' ? 'var(--accent-alpha-10)' : 'transparent'};`}
                onclick={() => (mediaPick = 'backend')}>
          <span class="font-display font-medium">With your database</span>
          <span class="mt-1 block text-xs text-ink-500">
            Uploads go where the rows go — images follow you to every device.
          </span>
        </button>
        <button type="button" role="radio" aria-checked={mediaPick === 'device'}
                class="block w-full p-3 text-left transition"
                style={`border: 1px solid ${mediaPick === 'device' ? 'var(--accent-electric)' : 'var(--border-subtle)'}; border-radius: var(--radius-md); background: ${mediaPick === 'device' ? 'var(--accent-alpha-10)' : 'transparent'};`}
                onclick={() => (mediaPick = 'device')}>
          <span class="font-display font-medium">On this device only</span>
          <span class="mt-1 block text-xs text-ink-500">
            Company logos and photos never leave this machine. The trade: other devices show
            initials instead of these images. Images already in your database keep rendering.
          </span>
        </button>
        <button type="button" role="radio" aria-checked={mediaPick === 'drive'}
                class="block w-full p-3 text-left transition"
                style={`border: 1px solid ${mediaPick === 'drive' ? 'var(--accent-electric)' : 'var(--border-subtle)'}; border-radius: var(--radius-md); background: ${mediaPick === 'drive' ? 'var(--accent-alpha-10)' : 'transparent'};`}
                onclick={() => (mediaPick = 'drive')}>
          <span class="font-display font-medium">Google Drive <span class="text-[10px] uppercase tracking-wider text-ink-400">your Drive</span></span>
          <span class="mt-1 block text-xs text-ink-500">
            Images live in a “Twin” folder in your own Google Drive — off your database, synced
            to every device you connect. twin only ever sees files it created (drive.file scope).
          </span>
        </button>
      </div>

      {#if mediaPick === 'drive'}
        <div class="rounded-[10px] border border-surface-border p-3 space-y-2" style="background: var(--bg-secondary);">
          <label class="block">
            <span class="mb-1 block text-xs text-ink-400">Google OAuth client ID</span>
            <input type="text" class="input w-full font-mono text-xs" placeholder="…apps.googleusercontent.com"
                   bind:value={driveClientIdValue} />
          </label>
          <div class="flex items-center gap-2">
            <button type="button" onclick={connectDriveNow} disabled={driveBusy || !driveClientIdValue.trim()}
                    class="rounded-[10px] px-3 py-1.5 text-xs font-medium"
                    style={`background: var(--accent-electric); color: var(--accent-text); opacity: ${driveBusy || !driveClientIdValue.trim() ? 0.5 : 1};`}>
              {driveBusy ? 'Connecting…' : driveIsConnected ? 'Reconnect' : 'Connect Google Drive'}
            </button>
            {#if driveIsConnected}<span class="text-xs" style="color: var(--state-success, #16a34a);">Connected ✓</span>{/if}
          </div>
          {#if driveError}<p class="text-xs" style="color: var(--state-danger);">{driveError}</p>{/if}
          <p class="text-[11px] text-ink-400">
            One-time Google setup (create the OAuth client, enable the Drive API) is in
            <span class="font-mono">docs/google-drive-media.md</span>. The client ID is public config, not a secret.
          </p>
        </div>
      {/if}

      <div>
        <button type="button" onclick={applyMedia} disabled={mediaPick === mediaLocation() || (mediaPick === 'drive' && !driveIsConnected)}
                class="px-5 py-2 font-display text-sm font-medium transition"
                style={`background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md); opacity: ${mediaPick === mediaLocation() || (mediaPick === 'drive' && !driveIsConnected) ? 0.4 : 1};`}>
          Apply
        </button>
        {#if mediaPick === 'drive' && !driveIsConnected}
          <span class="ml-2 text-xs text-ink-400">Connect Drive first.</span>
        {/if}
      </div>
    </fieldset>
  {/if}

  <!-- Export ─────────────────────────────────────────────────────────── -->
  {#if hasDeviceMedia}
    <div class="card flex items-center gap-3 p-4">
      <div class="min-w-0 flex-1">
        <div class="font-medium text-ink-900">Export everything on this device</div>
        <div class="text-xs text-ink-500">
          {activeBackend === 'local'
            ? 'One JSON file with every collection and every image stored here. Your data lives only in this app — keep a copy somewhere safe.'
            : 'One JSON file with the images stored only on this device (your rows live in your database and are not included).'}
        </div>
      </div>
      <button type="button"
              onclick={exportJson}
              disabled={exporting}
              class="flex shrink-0 items-center gap-1.5 px-4 py-2 font-display text-sm font-medium"
              style="background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md);">
        <Icon name="download" size={14} /> {exporting ? 'Exporting…' : 'Export'}
      </button>
    </div>
  {/if}

  <!-- Import ─────────────────────────────────────────────────────────── -->
  {#if activeBackend === 'local'}
    <div class="card flex items-center gap-3 p-4">
      <div class="min-w-0 flex-1">
        <div class="font-medium text-ink-900">Import a twin export</div>
        <div class="text-xs text-ink-500">
          {vaultEmpty
            ? 'Restore a twin-export JSON file into this vault — rows, images, ids, everything.'
            : 'Imports only into an empty vault, so nothing collides — create a fresh vault (Settings → Vaults) and import there.'}
        </div>
        {#if importMsg}<div class="mt-1 text-xs" style="color: var(--text-secondary);">{importMsg}</div>{/if}
      </div>
      <label class="shrink-0 cursor-pointer px-4 py-2 font-display text-sm font-medium"
             style={`background: var(--bg-tertiary); color: var(--text-primary); border-radius: var(--radius-md); opacity: ${vaultEmpty && !importing ? 1 : 0.4};`}>
        {importing ? 'Importing…' : 'Import'}
        <input type="file" accept="application/json" class="hidden" disabled={!vaultEmpty || importing} onchange={importJson} />
      </label>
    </div>
  {/if}

  <!-- Change storage ─────────────────────────────────────────────────── -->
  <fieldset class="card p-4 space-y-3" aria-label="Change storage">
    <legend class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Change storage</legend>
    <p class="text-xs text-ink-500">
      Switching changes where this device reads and writes from now on — existing rows stay in
      the old place (moving data between backends is a separate step; export above is the raw
      material). The app reloads on apply.
    </p>
    <StorageChooser bind:backendPick bind:sbUrl bind:sbKey bind:dxUrl bind:dxToken />
    {#if changed && !valid}
      <p class="text-xs" style="color: var(--state-warning);">
        {backendPick === 'supabase'
          ? 'Fill in the project URL and anon key first.'
          : 'Enter the server URL first.'}
      </p>
    {/if}
    {#if applyError}
      <p class="text-xs" style="color: var(--state-danger);">{applyError}</p>
    {/if}
    <div>
      <button type="button"
              onclick={apply}
              disabled={!valid || !changed || applyBusy}
              class="px-5 py-2 font-display text-sm font-medium transition"
              style={`background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md); opacity: ${valid && changed && !applyBusy ? 1 : 0.4};`}>
        {applyBusy ? 'Checking connection…' : 'Switch storage'}
      </button>
    </div>
  </fieldset>
</section>
