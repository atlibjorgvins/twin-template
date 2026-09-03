<script lang="ts">
  // First-run onboarding. The layout guard sends every un-onboarded device
  // here (see +layout.ts); finishing — or skipping — sets twin.onboarded and
  // never shows the wizard again. Everything it writes is device-local
  // (twin.name / twin.accent / twin.theme), so there is no backend dependency:
  // this page must work on a fresh clone with no database at all.
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import AccentPicker from '$lib/AccentPicker.svelte';
  import StorageChooser from '$lib/StorageChooser.svelte';
  import { completeOnboarding, profile, setName } from '$lib/profile.svelte';
  import { theme, setTheme, type ThemeMode } from '$lib/theme.svelte';
  import { PLUGINS } from '$lib/plugins/registry';
  import { INSTANCE_LABEL, authEnabled } from '$lib/instance';
  import { activeBackend, saveBackendChoice, deviceDirectusUrl, type BackendId } from '$lib/data/repo';
  import { PUBLIC_DIRECTUS_URL } from '$env/static/public';

  // What the "external database" card should say it points at: the device
  // override if one was saved, else the build's URL, else nothing yet.
  const buildDirectusUrl = (PUBLIC_DIRECTUS_URL ?? '').trim();
  const effectiveDirectusUrl = deviceDirectusUrl() || buildDirectusUrl;

  // The storage step is hidden on managed session-mode instances (KLAK): the
  // operator chose the database; a member picking "this device" would just
  // orphan their rows.
  const STEPS = authEnabled()
    ? (['name', 'appearance', 'plugins'] as const)
    : (['name', 'storage', 'appearance', 'plugins'] as const);
  let step = $state(0);

  // ── Storage choice ───────────────────────────────────────────────────────
  let backendPick = $state<BackendId>(activeBackend);
  let sbUrl = $state('');
  let sbKey = $state('');
  let dxUrl = $state(effectiveDirectusUrl);
  let dxToken = $state('');
  // Supabase needs both fields, Directus needs a URL, before the wizard may
  // advance past storage.
  const storageValid = $derived(
    backendPick === 'local' ||
      (backendPick === 'supabase' && sbUrl.trim().length > 0 && sbKey.trim().length > 0) ||
      (backendPick === 'directus' && dxUrl.trim().length > 0)
  );
  const blocked = $derived(STEPS[step] === 'storage' && !storageValid);


  // Session mode knows who signed in — prefill rather than ask twice.
  // Static-token / local mode has no user; the field starts empty.
  const me = $page.data?.me as { first_name?: string; last_name?: string } | undefined;
  let name = $state(
    profile.name || [me?.first_name, me?.last_name].filter(Boolean).join(' ')
  );

  const THEME_CHOICES: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'auto', label: 'Auto' }
  ];

  const publicCount = PLUGINS.filter((p) => p.tier === 'public').length;

  const greeting = $derived.by(() => {
    const h = new Date().getHours();
    if (h < 5 || h >= 22) return 'Late night';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  });

  function next() {
    if (STEPS[step] === 'name') setName(name);
    if (STEPS[step] === 'storage' && !storageValid) return;
    if (step < STEPS.length - 1) step += 1;
    else finish();
  }

  function finish() {
    if (STEPS[step] === 'name') setName(name); // "Skip the rest" keeps a typed name
    completeOnboarding();
    // Apply the storage decision last. A change swaps which backend the whole
    // module graph talks to, so it needs a full load, not a client-side goto —
    // the repo singleton is constructed once per page load, deliberately.
    // "Changed" includes re-pointing the SAME backend at a different server
    // (Directus URL/token edited while directus stays selected).
    const directusEdited =
      backendPick === 'directus' &&
      (dxUrl.trim() !== effectiveDirectusUrl || dxToken.trim().length > 0);
    if (!authEnabled() && storageValid && (backendPick !== activeBackend || directusEdited)) {
      saveBackendChoice(backendPick, {
        supabase: backendPick === 'supabase' ? { url: sbUrl, key: sbKey } : undefined,
        directus: backendPick === 'directus' ? { url: dxUrl, token: dxToken } : undefined
      });
      window.location.href = '/';
      return;
    }
    goto('/');
  }
</script>

<svelte:head><title>Welcome · Hub</title></svelte:head>

<div class="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4 py-8">
  <!-- Progress dots -->
  <div class="mb-6 flex items-center gap-2" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
    {#each STEPS as s, i (s)}
      <span
        class="h-1.5 transition-all"
        style={`border-radius: 9999px; width: ${i === step ? '1.75rem' : '0.75rem'}; background: ${i <= step ? 'var(--accent-electric)' : 'var(--bg-tertiary)'};`}
      ></span>
    {/each}
  </div>

  {#if STEPS[step] === 'name'}
    <div class="hero-eyebrow">{INSTANCE_LABEL || 'twin'} · setup</div>
    <h1 class="hero-display mt-2">
      {greeting}.<br />
      <span style="color: var(--accent-electric);">Who's there?</span>
    </h1>
    <p class="mt-4 text-sm text-ink-500">
      Your name personalises the Today page and the avatar in the corner. It stays on this
      device — nothing is sent anywhere.
    </p>
    <form
      class="mt-6"
      onsubmit={(e) => {
        e.preventDefault();
        next();
      }}
    >
      <label class="block">
        <span class="mb-1 block text-xs text-ink-400">Your name</span>
        <!-- svelte-ignore a11y_autofocus — the wizard exists to fill this field -->
        <input
          type="text"
          bind:value={name}
          autofocus
          autocomplete="name"
          placeholder="e.g. Atli Björgvinsson"
          class="input w-full"
        />
      </label>
      {#if name.trim()}
        <p class="mt-3 text-sm text-ink-500">
          The front page will greet you with
          “{greeting}, <span style="color: var(--accent-electric);">{name.trim().split(/\s+/)[0]}</span>.”
        </p>
      {/if}
    </form>
  {:else if STEPS[step] === 'storage'}
    <div class="hero-eyebrow">Setup · your data</div>
    <h1 class="hero-display mt-2">
      Where should<br /><span style="color: var(--accent-electric);">it live?</span>
    </h1>
    <p class="mt-4 text-sm text-ink-500">
      Twin is a contact system — the people and organizations you add have to be stored
      somewhere, and you decide where. There is no twin company server: every option below
      is yours. You can change this later and take your data with you.
    </p>
    <div class="mt-6">
      <StorageChooser bind:backendPick bind:sbUrl bind:sbKey bind:dxUrl bind:dxToken />
    </div>
    {#if !storageValid}
      <p class="mt-3 text-xs" style="color: var(--state-warning);">
        {backendPick === 'supabase'
          ? 'Fill in the project URL and anon key to continue — or pick another option.'
          : 'Enter the server URL to continue — or pick another option.'}
      </p>
    {/if}
  {:else if STEPS[step] === 'appearance'}
    <div class="hero-eyebrow">Setup · appearance</div>
    <h1 class="hero-display mt-2">
      Make it<br /><span style="color: var(--accent-electric);">yours.</span>
    </h1>
    <p class="mt-4 text-sm text-ink-500">
      Both apply instantly — this page is the preview. Change either any time under
      Settings → Appearance.
    </p>
    <fieldset class="mt-6 space-y-2" aria-label="Theme">
      <legend class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400"
        >Theme</legend
      >
      <div class="flex gap-2">
        {#each THEME_CHOICES as c (c.value)}
          {@const selected = theme.mode === c.value}
          <button
            type="button"
            class="px-4 py-2 font-display text-sm font-medium transition"
            style={`border: 1px solid ${selected ? 'var(--accent-electric)' : 'var(--border-subtle)'}; border-radius: var(--radius-md); background: ${selected ? 'var(--accent-alpha-10)' : 'transparent'};`}
            aria-pressed={selected}
            onclick={() => setTheme(c.value)}
          >
            {c.label}
          </button>
        {/each}
      </div>
    </fieldset>
    <fieldset class="mt-5 space-y-2" aria-label="Accent color">
      <legend class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400"
        >Accent</legend
      >
      <AccentPicker />
    </fieldset>
  {:else}
    <div class="hero-eyebrow">Setup · plugins</div>
    <h1 class="hero-display mt-2">
      Everything is<br /><span style="color: var(--accent-electric);">a plugin.</span>
    </h1>
    <p class="mt-4 text-sm text-ink-500">
      The core is contacts — people and organizations. The other {publicCount} features
      (habits, notes, photos, games, …) are plugins you can switch on or off per device,
      or replace with ones from GitHub. Browse them any time under Settings → Plugins.
    </p>
    <a href="/settings/plugins" class="mt-4 inline-block text-sm underline text-ink-500"
      >See what's installed →</a
    >
  {/if}

  <!-- Wizard controls -->
  <div class="mt-8 flex items-center gap-3">
    {#if step > 0}
      <button
        type="button"
        class="px-4 py-2 text-sm text-ink-500 transition hover:text-ink-900"
        onclick={() => (step -= 1)}
      >
        Back
      </button>
    {/if}
    <button
      type="button"
      class="px-5 py-2 font-display text-sm font-medium transition"
      style={`background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md); opacity: ${blocked ? 0.4 : 1};`}
      disabled={blocked}
      onclick={next}
    >
      {step === STEPS.length - 1 ? 'Start using twin' : 'Continue'}
    </button>
    {#if step < STEPS.length - 1}
      <button type="button" class="ml-auto text-xs text-ink-400 underline" onclick={finish}>
        Skip setup
      </button>
    {/if}
  </div>
</div>
