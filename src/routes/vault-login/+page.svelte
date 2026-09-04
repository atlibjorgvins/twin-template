<script lang="ts">
  // Sign-in for a MANAGED vault (Supabase Auth). The layout guard sends every
  // signed-out navigation here while such a vault is active. Members are
  // created/removed by the vault's admin in the Supabase dashboard; twin only
  // holds the session (supabase-js persists it per project).
  import { auth } from '$lib/data/repo';
  import { activeVault, vaults } from '$lib/data/repo/vaults';
  import { switchVault } from '$lib/vaultSwitch';

  const vault = activeVault();
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      await auth.login(email.trim(), password);
      // Full navigation: the layout guard re-probes the session and every
      // loader re-reads as the signed-in member.
      window.location.href = '/';
    } catch (e) {
      // Say what actually failed. A wrong password, a key the gateway
      // rejects, and a dead URL are three different problems with three
      // different fixes — collapsing them into one message once cost a
      // whole debugging afternoon. Credentials stay deliberately vague
      // (never tell a prober which half was wrong); the other two are the
      // vault's configuration and deserve the truth.
      const status = (e as { status?: number })?.status;
      if (status === 401 || status === 403) {
        error =
          "The server rejected this vault's API key — the password never got checked. " +
          'Remove the vault and add it again with the full "anon" key ' +
          '(Supabase dashboard → Project Settings → API keys → Legacy API keys).';
      } else if (status === 429) {
        error = 'Too many attempts — wait a minute, then try again.';
      } else if (typeof status === 'number' && status < 500) {
        error = 'That email and password did not match.';
      } else {
        error =
          "Could not reach this vault's server at all — check the project URL on the vault " +
          '(Settings → Vaults shows it) and your connection.';
      }
      password = '';
    } finally {
      busy = false;
    }
  }

  // An escape hatch: a person who cannot sign in must still be able to get
  // back to their own vault instead of being locked out of the whole app.
  const others = vaults().filter((v) => v.id !== vault.id);
  function backTo(id: string) {
    const v = others.find((x) => x.id === id);
    switchVault(id, v?.name ?? 'vault');
  }
</script>

<svelte:head><title>Sign in · {vault.name} · Hub</title></svelte:head>

<div class="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4">
  <div class="hero-eyebrow">Managed vault</div>
  <h1 class="mb-1 font-display text-2xl font-semibold text-ink-900">{vault.name}</h1>
  <p class="mb-6 text-sm text-ink-400">
    Sign in with the account this vault's admin created for you.
  </p>

  <form onsubmit={submit} class="card space-y-3 p-4">
    <label class="block">
      <span class="mb-1 block text-xs text-ink-400">Email</span>
      <input type="email" class="input w-full" bind:value={email} autocomplete="username" required />
    </label>
    <label class="block">
      <span class="mb-1 block text-xs text-ink-400">Password</span>
      <input type="password" class="input w-full" bind:value={password} autocomplete="current-password" required />
    </label>
    {#if error}
      <p class="text-xs" style="color: var(--state-danger);">{error}</p>
    {/if}
    <button
      type="submit"
      disabled={busy}
      class="w-full px-5 py-2 font-display text-sm font-medium"
      style="background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md);"
    >
      {busy ? 'Signing in…' : 'Sign in'}
    </button>
  </form>

  {#if others.length}
    <p class="mt-4 text-xs text-ink-400">
      Not you? Switch to
      {#each others as v, i (v.id)}
        {i > 0 ? ' · ' : ''}<button type="button" class="underline hover:text-ink-700" onclick={() => backTo(v.id)}>{v.name}</button>
      {/each}
    </p>
  {/if}
</div>
