<script lang="ts">
  // Persistent connection + sync indicator in the chrome header.
  //  • live, nothing queued  → calm green dot
  //  • syncing               → pulsing dot + "Syncing…"
  //  • queued / failed writes → pill with a count (tap to review)
  //  • offline               → amber "Offline" pill (+ count, tap to review/retry)
  import { connection } from '$lib/offline';
  import { probeConnection } from '$lib/directus';
  import { pendingCount, flushing } from '$lib/writeQueue';
  import PendingChanges from '$lib/PendingChanges.svelte';
  import Icon from '$lib/Icon.svelte';

  let checking = $state(false);
  let review = $state(false);

  async function onClick() {
    // If there's anything to review (queued writes) or we're offline, open
    // the sheet. Otherwise treat a tap as a manual connectivity retry.
    if ($pendingCount > 0 || $connection.offline) {
      review = true;
      return;
    }
    if (checking) return;
    checking = true;
    try { await probeConnection(); } finally { checking = false; }
  }

  const rel = (d: Date | null): string => {
    if (!d) return 'not yet synced';
    const m = Math.round((Date.now() - d.getTime()) / 60000);
    if (m < 1) return 'synced just now';
    if (m < 60) return `synced ${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `synced ${h} hr ago`;
    return `synced ${Math.round(h / 24)} d ago`;
  };
</script>

<button
  type="button"
  class="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold transition"
  style={$connection.offline
    ? 'background: rgba(214,158,46,0.18); color:#8a5a00;'
    : $pendingCount > 0 || $flushing
      ? 'background: rgba(44,140,153,0.14); color: var(--brand,#2C8C99);'
      : 'background: transparent; color: var(--text-secondary);'}
  title={$connection.offline
    ? `Offline — Directus unreachable. Local copy ${rel($connection.mirrorAt)}.${$pendingCount ? ` ${$pendingCount} change(s) queued.` : ''} Tap to review.`
    : $pendingCount > 0
      ? `${$pendingCount} change(s) waiting to sync. Tap to review.`
      : 'Connected to your database'}
  aria-label={$connection.offline ? 'Offline — tap to review' : $pendingCount > 0 ? 'Pending changes — tap to review' : 'Online'}
  onclick={onClick}
>
  <span
    class="inline-block h-2 w-2 rounded-full {checking || $flushing ? 'animate-pulse' : ''}"
    style:background-color={$connection.offline ? '#C99A1E' : $pendingCount > 0 || $flushing ? 'var(--brand,#2C8C99)' : '#1B8A4B'}
  ></span>
  {#if $connection.offline}
    <span class="hidden sm:inline">{checking ? 'Checking…' : 'Offline'}</span>
    {#if $pendingCount > 0}<span class="rounded-full bg-white/60 px-1 leading-none">{$pendingCount}</span>{/if}
  {:else if $flushing}
    <span class="hidden sm:inline">Syncing…</span>
  {:else if $pendingCount > 0}
    <span>{$pendingCount}</span><span class="hidden sm:inline">pending</span>
  {/if}
</button>

<PendingChanges open={review} onClose={() => (review = false)} />
