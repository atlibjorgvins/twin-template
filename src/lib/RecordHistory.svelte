<script lang="ts">
  // The change history for ONE record, shown on its detail card. Reads
  // twin_audit for this table + row (audit.ts). Renders NOTHING when history
  // is off or the record has none, so it's invisible on a personal vault and
  // only earns space when there's something to show.
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';
  import { listAuditFor, type AuditEntry } from '$lib/data/audit';

  let { table, rowId }: { table: string; rowId: number | string } = $props();

  let entries = $state<AuditEntry[]>([]);
  let loaded = $state(false);

  $effect(() => {
    const id = rowId;
    listAuditFor(table, id, 50)
      .then((e) => { entries = e; loaded = true; })
      .catch(() => { entries = []; loaded = true; });
  });

  const VERB: Record<AuditEntry['action'], string> = {
    insert: 'added this',
    update: 'edited',
    delete: 'removed this'
  };
  const ICON: Record<AuditEntry['action'], IconName> = {
    insert: 'plus',
    update: 'pencil',
    delete: 'trash'
  };
  function fields(e: AuditEntry): string[] {
    return e.changes ? Object.keys(e.changes).map((k) => k.replace(/_/g, ' ')) : [];
  }
  function when(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
</script>

{#if loaded && entries.length}
  <div class="card p-4">
    <div class="mb-3 flex items-center gap-2 font-display text-[10px] uppercase tracking-wider text-ink-400">
      <Icon name="notebook" size={13} /> History
    </div>
    <ul class="space-y-2.5">
      {#each entries as e (e.id)}
        <li class="flex items-start gap-2.5 text-sm">
          <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center"
                style="border-radius: var(--radius-md); background: var(--bg-tertiary); color: var(--text-secondary);">
            <Icon name={ICON[e.action]} size={12} />
          </span>
          <div class="min-w-0 flex-1">
            <span class="text-ink-700"><span class="font-medium text-ink-900">{e.actor_email || 'Someone'}</span> {VERB[e.action]}</span>
            {#if e.action === 'update' && fields(e).length}
              <span class="text-ink-400"> · {fields(e).join(', ')}</span>
            {/if}
          </div>
          <span class="shrink-0 text-xs text-ink-400" title={new Date(e.occurred_at).toLocaleString()}>{when(e.occurred_at)}</span>
        </li>
      {/each}
    </ul>
  </div>
{/if}
