<script lang="ts">
  // Change history for the active vault — who added or changed what. Reads
  // twin_audit (recorded by the server trigger; see auditSchema.ts). Most
  // useful on a managed team vault, where "who changed this" has more than
  // one answer; on a solo vault it's a personal activity trail.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';
  import { listAudit, entityNoun, type AuditEntry } from '$lib/data/audit';
  import { auditAvailable, ensureAuditSchema, NEEDS_ADMIN_MESSAGE } from '$lib/data/repo/schemaSync';
  import { activeVault } from '$lib/data/repo/vaults';

  const vault = activeVault();
  let entries = $state<AuditEntry[]>([]);
  let ready = $state(false);
  let available = $state(true);
  let error = $state('');

  // Admin-enable state (managed vault, holds the service_role key).
  let enabling = $state(false);
  let enableError = $state('');

  async function load() {
    ready = false;
    error = '';
    available = await auditAvailable();
    if (available) {
      try {
        entries = await listAudit(200);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    ready = true;
  }
  onMount(load);

  async function enable() {
    if (enabling) return;
    enabling = true;
    enableError = '';
    try {
      const r = await ensureAuditSchema();
      if (r === 'no-admin-key') {
        enableError = NEEDS_ADMIN_MESSAGE;
      } else {
        await load();
      }
    } catch (e) {
      enableError = e instanceof Error ? e.message : String(e);
    } finally {
      enabling = false;
    }
  }

  const VERB: Record<AuditEntry['action'], string> = {
    insert: 'added',
    update: 'changed',
    delete: 'removed'
  };
  const ICON: Record<AuditEntry['action'], IconName> = {
    insert: 'plus',
    update: 'pencil',
    delete: 'trash'
  };

  function actorName(e: AuditEntry): string {
    return e.actor_email || 'Someone';
  }
  function changedFields(e: AuditEntry): string[] {
    return e.changes ? Object.keys(e.changes).map((k) => k.replace(/_/g, ' ')) : [];
  }
  function when(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const diff = Date.now() - t;
    const m = Math.round(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  // Day grouping for a scannable timeline.
  function dayKey(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  const grouped = $derived.by(() => {
    const out: { day: string; items: AuditEntry[] }[] = [];
    for (const e of entries) {
      const k = dayKey(e.occurred_at);
      const last = out[out.length - 1];
      if (last && last.day === k) last.items.push(e);
      else out.push({ day: k, items: [e] });
    }
    return out;
  });
</script>

<svelte:head><title>History · Hub</title></svelte:head>

<section class="mx-auto max-w-2xl space-y-5 px-4 py-6">
  <header>
    <div class="hero-eyebrow">Change history</div>
    <h1 class="font-display text-2xl font-bold" style="letter-spacing: -0.03em;">{vault.name}</h1>
    <p class="mt-1 text-sm text-ink-500">Who added or changed people and organizations, and when.</p>
  </header>

  {#if !ready}
    <p class="text-sm text-ink-400">Loading…</p>
  {:else if !available}
    <div class="card space-y-3 p-4">
      <p class="text-sm text-ink-700">
        Change history isn't turned on for this vault yet. When it's on, every add, edit and
        removal is recorded with who made it — readable by members, and impossible to forge or
        erase.
      </p>
      {#if vault.managed}
        <button type="button" onclick={enable} disabled={enabling}
                class="px-5 py-2 font-display text-sm font-medium"
                style={`background: var(--accent-electric); color: var(--accent-text); border-radius: var(--radius-md); opacity: ${enabling ? 0.5 : 1};`}>
          {enabling ? 'Turning on…' : 'Turn on change history'}
        </button>
        {#if enableError}<p class="text-xs" style="color: var(--state-danger);">{enableError}</p>{/if}
        <p class="text-[11px] text-ink-400">Needs the vault's admin key (Settings → Vaults → Members).</p>
      {:else}
        <p class="text-xs text-ink-400">Available on managed team vaults.</p>
      {/if}
    </div>
  {:else if error}
    <p class="text-sm" style="color: var(--state-danger);">{error}</p>
  {:else if entries.length === 0}
    <p class="text-sm text-ink-400">Nothing recorded yet. Changes made from here on will appear.</p>
  {:else}
    {#each grouped as g (g.day)}
      <div class="space-y-2">
        <div class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">{g.day}</div>
        <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
          {#each g.items as e (e.id)}
            <li class="flex items-start gap-3 px-4 py-3">
              <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center"
                    style="border-radius: var(--radius-md); background: var(--bg-tertiary); color: var(--text-secondary);">
                <Icon name={ICON[e.action]} size={14} />
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-sm text-ink-900">
                  <span class="font-medium">{actorName(e)}</span>
                  {VERB[e.action]}
                  {entityNoun(e.table_name)}
                  {#if e.label}<span class="font-medium">“{e.label}”</span>{/if}
                </div>
                {#if e.action === 'update' && changedFields(e).length}
                  <div class="mt-1 flex flex-wrap gap-1">
                    {#each changedFields(e) as f}
                      <span class="rounded-full px-1.5 py-0.5 text-[10px] text-ink-500" style="background: var(--bg-tertiary);">{f}</span>
                    {/each}
                  </div>
                {/if}
              </div>
              <span class="shrink-0 text-xs text-ink-400" title={new Date(e.occurred_at).toLocaleString()}>{when(e.occurred_at)}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  {/if}
</section>
