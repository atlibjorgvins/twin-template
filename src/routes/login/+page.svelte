<script lang="ts">
  // The sign-in page. Only reachable when PUBLIC_AUTH_MODE=session — in
  // static-token mode there are no sessions, so +page.ts redirects away and
  // this never renders. See docs/phase2-auth.md.
  import { goto } from '$app/navigation';
  import { login, needsFirstRunSetup } from '$lib/data/auth';
  import { onMount } from 'svelte';
  import { INSTANCE_LABEL } from '$lib/instance';

  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');
  let setupNeeded = $state(false);

  onMount(async () => {
    setupNeeded = await needsFirstRunSetup();
  });

  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      await login(email.trim(), password);
      // Full navigation so the layout guard re-runs with the new session and
      // every store re-reads its data as the signed-in user.
      await goto('/', { invalidateAll: true });
    } catch {
      // Directus returns the same error for bad email and bad password, on
      // purpose — do not tell an attacker which half was wrong.
      error = 'That email and password did not match.';
      password = '';
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4">
  <h1 class="mb-1 font-display text-2xl font-semibold text-ink-900">
    {INSTANCE_LABEL || 'twin'}
  </h1>
  <p class="mb-6 text-sm text-ink-400">Sign in to continue.</p>

  {#if setupNeeded}
    <div class="card space-y-2 p-4 text-sm text-ink-600">
      <p class="font-medium text-ink-900">This instance has no accounts yet.</p>
      <p>
        The first account is created by Directus, not here — set
        <span class="font-mono text-xs">ADMIN_EMAIL</span> and
        <span class="font-mono text-xs">ADMIN_PASSWORD</span> in the stack's
        compose file and restart it, then reload this page and sign in.
      </p>
    </div>
  {:else}
  <form onsubmit={submit} class="card space-y-3 p-4">
    <label class="block">
      <span class="mb-1 block text-xs text-ink-400">Email</span>
      <input
        class="input w-full"
        type="email"
        autocomplete="username"
        bind:value={email}
        required
        autofocus
      />
    </label>
    <label class="block">
      <span class="mb-1 block text-xs text-ink-400">Password</span>
      <input
        class="input w-full"
        type="password"
        autocomplete="current-password"
        bind:value={password}
        required
      />
    </label>

    {#if error}
      <p class="text-sm" style="color: #b91c1c;">{error}</p>
    {/if}

    <button class="btn-primary w-full justify-center" type="submit" disabled={busy}>
      {busy ? 'Signing in…' : 'Sign in'}
    </button>
  </form>
  {/if}
</div>
