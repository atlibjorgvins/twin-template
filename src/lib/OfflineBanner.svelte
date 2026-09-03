<script lang="ts">
  // Thin bar shown when the app is serving People/Org reads from the
  // local mirror because Directus is unreachable. Read-only notice — it
  // tells the user the data is a snapshot and when it was last synced.
  import { connection } from '$lib/offline';
  import { pendingCount } from '$lib/writeQueue';
  import Icon from '$lib/Icon.svelte';

  const rel = (d: Date | null): string => {
    if (!d) return 'never';
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };
</script>

<!-- Session expired (session mode). Takes priority over the offline notice:
     the queue is paused holding its writes, and signing in replays them. -->
{#if $connection.needsAuth}
  <a
    href="/login"
    class="flex items-center justify-center gap-2 px-4 py-1.5 text-center text-[12px] font-medium no-underline"
    style="background: rgba(185,28,28,0.14); color: #b91c1c;"
    role="status"
    aria-live="assertive"
  >
    <Icon name="lock" size={13} />
    <span>
      Session expired — sign in again to continue{#if $pendingCount > 0}. {$pendingCount} unsaved change{$pendingCount === 1 ? '' : 's'} held safely{/if}.
    </span>
  </a>
{:else if $connection.offline}
  <div
    class="flex items-center justify-center gap-2 px-4 py-1.5 text-center text-[12px] font-medium"
    style="background: rgba(214,158,46,0.16); color: #8a5a00;"
    role="status"
    aria-live="polite"
  >
    <Icon name="globe" size={13} />
    <span>
      Offline — showing your local copy
      {#if $connection.mirrorAt}(synced {rel($connection.mirrorAt)}){/if}. Read-only.
    </span>
  </div>
{/if}
