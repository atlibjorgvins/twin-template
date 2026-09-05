<script lang="ts">
  // Landing for a vault invite link (…/join#i=CODE). Decodes the invite,
  // shows what's being joined, and — on confirm — adds the vault and opens
  // it (managed vaults then route to sign-in). Exempt from the onboarding and
  // managed-vault gates (+layout.ts) so a brand-new install can land here.
  import { onMount } from 'svelte';
  import { decodeInvite, type VaultInvite } from '$lib/data/repo/vaultInvite';
  import { vaults, addVault } from '$lib/data/repo/vaults';
  import { switchVault } from '$lib/vaultSwitch';

  let invite = $state<VaultInvite | null>(null);
  let pasted = $state('');
  let error = $state('');
  let joining = $state(false);

  onMount(() => {
    // The code rides in the hash so it never reaches a server as a query.
    const fromHash = decodeInvite(location.hash) || decodeInvite(location.search);
    if (fromHash) invite = fromHash;
  });

  function tryPasted() {
    const inv = decodeInvite(pasted);
    if (inv) { invite = inv; error = ''; }
    else error = "That doesn't look like a twin invite link or code.";
  }

  // Already have this vault on the device? Don't add a duplicate.
  const already = $derived(
    invite ? vaults().find((v) => v.supabaseUrl === invite!.supabaseUrl) ?? null : null
  );

  function join() {
    if (!invite || joining) return;
    joining = true;
    const existing = already;
    const v =
      existing ??
      addVault({
        name: invite.name,
        kind: 'workspace',
        backend: 'supabase',
        supabaseUrl: invite.supabaseUrl,
        supabaseKey: invite.supabaseKey,
        ...(invite.managed ? { managed: true } : {})
      });
    // Land on '/', not back on /join — the managed-vault gate then routes to
    // sign-in. (switchVault defaults to the current path; /join isn't it.)
    switchVault(v.id, v.name, '/');
  }
</script>

<svelte:head><title>Join a vault · Hub</title></svelte:head>

<div class="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4">
  <div class="hero-eyebrow">Vault invite</div>

  {#if invite}
    <h1 class="mb-1 font-display text-2xl font-semibold text-ink-900">{invite.name}</h1>
    <p class="mb-6 text-sm text-ink-400">
      {#if invite.managed}
        A managed team vault. Joining adds it to this device; you'll sign in with the account
        the vault's admin created for you.
      {:else}
        A shared Supabase vault. Joining adds it to this device.
      {/if}
    </p>
    <div class="card space-y-1 p-4 text-xs text-ink-500">
      <div class="truncate"><span class="text-ink-400">Server:</span> {invite.supabaseUrl}</div>
      {#if invite.managed}<div><span class="text-ink-400">Access:</span> members sign in (managed)</div>{/if}
    </div>
    {#if already}
      <p class="mt-3 text-xs text-ink-400">You already have this vault — opening it.</p>
    {/if}
    <button type="button" onclick={join} disabled={joining}
            class="mt-4 w-full px-5 py-2 font-display text-sm font-medium"
            style="background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md);">
      {joining ? 'Opening…' : already ? 'Open vault' : 'Join vault'}
    </button>
    <a href="/" class="mt-3 text-center text-xs text-ink-400 hover:text-ink-700">Not now</a>
  {:else}
    <h1 class="mb-1 font-display text-2xl font-semibold text-ink-900">Join a vault</h1>
    <p class="mb-6 text-sm text-ink-400">Paste the invite link or code your admin sent you.</p>
    <form onsubmit={(e) => { e.preventDefault(); tryPasted(); }} class="card space-y-3 p-4">
      <input type="text" class="input w-full font-mono text-xs" placeholder="twinvault1:… or an invite link" bind:value={pasted} />
      {#if error}<p class="text-xs" style="color: var(--state-danger);">{error}</p>{/if}
      <button type="submit" disabled={!pasted.trim()}
              class="px-5 py-2 font-display text-sm font-medium"
              style={`background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md); opacity: ${pasted.trim() ? 1 : 0.4};`}>
        Continue
      </button>
    </form>
    <a href="/" class="mt-3 text-center text-xs text-ink-400 hover:text-ink-700">Cancel</a>
  {/if}
</div>
