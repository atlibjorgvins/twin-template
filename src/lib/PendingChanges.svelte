<script lang="ts">
  // Review sheet for the offline write queue: lists each queued mutation,
  // its status, and lets you retry/discard a failed one or flush the whole
  // queue now. Read-only-safe: discard never touches the server.
  import { pendingOps, flushing, flushQueue, retryOp, discardOp, type WriteOp } from '$lib/writeQueue';
  import { connection } from '$lib/offline';
  import { probeConnection } from '$lib/directus';
  import Icon from '$lib/Icon.svelte';

  type Props = { open: boolean; onClose: () => void };
  let { open, onClose }: Props = $props();

  let working = $state(false);

  async function syncNow() {
    if (working) return;
    working = true;
    try {
      const online = await probeConnection();
      if (online) await flushQueue();
    } finally {
      working = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  const fmt = (o: WriteOp) => o.label;
</script>

<svelte:window onkeydown={open ? onKey : undefined} />

{#if open}
  <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Pending changes">
    <button class="absolute inset-0 bg-black/40" aria-label="Close" onclick={onClose}></button>
    <div
      class="relative z-10 flex max-h-[80vh] w-full flex-col rounded-t-2xl border border-surface-border bg-surface-card sm:max-w-lg sm:rounded-2xl"
      style="padding-bottom: max(env(safe-area-inset-bottom), 0.5rem);"
    >
      <header class="flex items-center justify-between gap-3 border-b border-surface-divider px-4 py-3">
        <div>
          <div class="font-display text-sm font-semibold text-ink-900">Pending changes</div>
          <div class="text-[11px] text-ink-500">
            {#if $connection.offline}
              Offline — changes are saved on this device and will sync when reconnected.
            {:else}
              {$pendingOps.length} queued. Last-write-wins on sync.
            {/if}
          </div>
        </div>
        <button type="button" class="btn-ghost !px-2" aria-label="Close" onclick={onClose}><Icon name="x" size={18} /></button>
      </header>

      <div class="flex-1 overflow-y-auto px-2 py-2">
        {#if $pendingOps.length === 0}
          <div class="px-3 py-8 text-center text-sm text-ink-400">No pending changes. Everything's synced.</div>
        {:else}
          <ul class="space-y-1">
            {#each $pendingOps as op (op.id)}
              <li class="flex items-start gap-3 rounded-md border border-surface-border px-3 py-2">
                <span class="mt-0.5 shrink-0">
                  {#if op.status === 'failed'}
                    <span class="inline-block h-2 w-2 rounded-full" style="background:#C0392B;" title="Failed"></span>
                  {:else}
                    <span class="inline-block h-2 w-2 rounded-full" style="background:#C99A1E;" title="Pending"></span>
                  {/if}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm text-ink-900">{fmt(op)}</div>
                  {#if op.error}<div class="mt-0.5 text-[11px]" style="color:#C0392B;">{op.error}</div>{/if}
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  {#if op.status === 'failed'}
                    <button class="text-[11px] text-ink-500 hover:text-ink-900" onclick={() => retryOp(op.id)}>Retry</button>
                  {/if}
                  <button class="text-[11px] text-ink-400 hover:text-ink-700" onclick={() => discardOp(op.id)}>Discard</button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      {#if $pendingOps.length > 0}
        <footer class="border-t border-surface-divider px-4 py-3">
          <button class="btn-primary w-full" disabled={working || $flushing || $connection.offline} onclick={syncNow}>
            {#if $flushing || working}Syncing…{:else if $connection.offline}Offline — can't sync yet{:else}Sync {$pendingOps.length} now{/if}
          </button>
        </footer>
      {/if}
    </div>
  </div>
{/if}
