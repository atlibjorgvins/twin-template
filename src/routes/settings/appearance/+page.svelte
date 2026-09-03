<script lang="ts">
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import Icon from '$lib/Icon.svelte';
  import AccentPicker from '$lib/AccentPicker.svelte';
  import { theme, setTheme, type ThemeMode } from '$lib/theme.svelte';
  import { profile, setName, resetOnboarding } from '$lib/profile.svelte';
  import { isDesktop, storedShortcut, setSpotlightShortcut, DEFAULT_SHORTCUT } from '$lib/desktop';
  import { goto } from '$app/navigation';
  import type { IconName } from '$lib/icon-types';

  type Choice = { value: ThemeMode; label: string; hint: string; icon: IconName };
  const CHOICES: Choice[] = [
    { value: 'light', label: 'Light', hint: 'Always use the teal-on-paper theme.', icon: 'sparkles' },
    { value: 'dark',  label: 'Dark',  hint: 'Always use the chartreuse-on-black theme.', icon: 'sparkles' },
    { value: 'auto',  label: 'Auto',  hint: 'Follow your operating-system appearance.', icon: 'settings' }
  ];

  // Buffer the input so we do not rewrite localStorage per keystroke;
  // committed on blur / Enter.
  let nameDraft = $state(profile.name);

  function rerunSetup() {
    resetOnboarding();
    goto('/welcome');
  }

  // ── Desktop-only: the global spotlight shortcut ──────────────────────────
  const desktop = isDesktop();
  let shortcutDraft = $state(storedShortcut());
  let shortcutMsg = $state('');
  async function applyShortcut() {
    shortcutMsg = '';
    try {
      await setSpotlightShortcut(shortcutDraft.trim());
      shortcutMsg = `Saved — ${shortcutDraft.trim()} now opens search anywhere.`;
    } catch (e) {
      shortcutMsg = `Could not register "${shortcutDraft.trim()}" — ${e instanceof Error ? e.message : 'invalid or taken by another app'}. The previous shortcut still applies.`;
    }
  }
</script>

<svelte:head><title>Appearance · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Appearance"
    subtitle="Your name, theme, and accent. All saved on this device only — sign in on another device and it picks the local defaults."
  />

  <fieldset class="card p-3 space-y-2" aria-label="Profile">
    <legend class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400">You</legend>
    <label class="block max-w-sm">
      <span class="mb-1 block text-xs text-ink-400">Your name</span>
      <input
        type="text"
        class="input w-full"
        placeholder="Shown on the Today page"
        bind:value={nameDraft}
        onblur={() => setName(nameDraft)}
        onkeydown={(e) => e.key === 'Enter' && setName(nameDraft)}
      />
    </label>
    <p class="px-1 text-xs text-ink-500">
      The Today page greets you by first name; the rail avatar shows your initials.
    </p>
  </fieldset>

  <fieldset
    class="card p-3 space-y-2"
    aria-label="Theme"
  >
    <legend class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Theme</legend>
    <div class="grid gap-2 sm:grid-cols-3">
      {#each CHOICES as c (c.value)}
        {@const selected = theme.mode === c.value}
        <button
          type="button"
          class="flex flex-col items-start gap-1 p-3 text-left transition"
          style={`border: 1px solid ${selected ? 'var(--accent-electric)' : 'var(--border-subtle)'}; border-radius: var(--radius-md); background: ${selected ? 'var(--accent-alpha-10)' : 'transparent'};`}
          aria-pressed={selected}
          onclick={() => setTheme(c.value)}
        >
          <span class="flex items-center gap-1.5">
            <span
              class="flex h-7 w-7 items-center justify-center"
              style={`border-radius: var(--radius-md); background: ${selected ? 'var(--accent-electric)' : 'var(--bg-tertiary)'}; color: ${selected ? 'var(--accent-text)' : 'var(--text-secondary)'};`}
            >
              <Icon name={c.icon} size={14} />
            </span>
            <span class="font-display font-medium" style="letter-spacing: -0.01em;">{c.label}</span>
            {#if c.value === 'auto'}
              <span class="ml-1 text-[10px] uppercase tracking-wider text-ink-400">
                → {theme.effective}
              </span>
            {/if}
          </span>
          <span class="text-xs text-ink-500">{c.hint}</span>
        </button>
      {/each}
    </div>
  </fieldset>

  <fieldset class="card p-3 space-y-2" aria-label="Accent color">
    <legend class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400">Accent</legend>
    <AccentPicker />
    <p class="px-1 text-xs text-ink-500">
      Colors every button, link, and highlight. The Work/Private scope toggle still
      recolors on top of this while a scope is pinned.
    </p>
  </fieldset>

  {#if desktop}
    <fieldset class="card p-3 space-y-2" aria-label="Search anywhere shortcut">
      <legend class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400"
        >Search anywhere</legend
      >
      <div class="flex max-w-md items-center gap-2">
        <input
          type="text"
          class="input w-full font-mono text-sm"
          placeholder={DEFAULT_SHORTCUT}
          bind:value={shortcutDraft}
          onkeydown={(e) => e.key === 'Enter' && applyShortcut()}
        />
        <button
          type="button"
          class="shrink-0 px-4 py-2 font-display text-sm font-medium"
          style="background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md);"
          onclick={applyShortcut}
        >
          Apply
        </button>
      </div>
      <p class="px-1 text-xs text-ink-500">
        Opens twin's search from any app, even with the window closed. Format:
        modifiers + key joined by "+" — e.g. <span class="font-mono">CmdOrCtrl+K</span>,
        <span class="font-mono">Cmd+Shift+Space</span>, <span class="font-mono">Alt+T</span>.
        Note ⌘K is also used inside some apps (Slack, browsers) — pick another combination
        if they collide.
      </p>
      {#if shortcutMsg}
        <p class="px-1 text-xs" style="color: var(--text-secondary);">{shortcutMsg}</p>
      {/if}
    </fieldset>
  {/if}

  <div class="px-1">
    <button type="button" class="text-xs text-ink-400 underline" onclick={rerunSetup}>
      Run the first-time setup again
    </button>
  </div>
</section>
