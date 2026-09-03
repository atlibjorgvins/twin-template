<script lang="ts">
  // Tools → "Suggested data": review web-search recommendations for org
  // websites / social handles / logos. Accept writes the value onto the
  // org (logos import into Directus files); reject just dismisses. Items
  // vanish from their group as they're resolved.
  import {
    acceptSuggestion,
    rejectSuggestion,
    assetUrl,
    formatError,
    type SuggestionWithOrg,
    type Organization
  } from '$lib/directus';
  import Icon from '$lib/Icon.svelte';

  type Group = { org: Organization | null; orgId: number | null; items: SuggestionWithOrg[] };
  let { data }: { data: { groups: Group[]; total: number; error: string | null } } = $props();

  // Working copy so resolved items disappear as they're accepted/rejected.
  let groups = $state<Group[]>(data.groups.map((g) => ({ ...g, items: [...g.items] })));
  let busy = $state<Record<number, 'accept' | 'reject' | undefined>>({});
  let errors = $state<Record<number, string>>({});
  let resolved = $state(0);

  const remaining = $derived(groups.reduce((n, g) => n + g.items.length, 0));

  const FIELD_LABEL: Record<string, string> = {
    website: 'Website',
    linkedin_url: 'LinkedIn',
    facebook: 'Facebook',
    instagram: 'Instagram',
    twitter: 'Twitter / X',
    logo: 'Logo'
  };
  const label = (k: string) => FIELD_LABEL[k] ?? k;

  // Confidence pill colours, expressed as token-friendly rgba tints to
  // match the calendar/chip palette rather than raw Tailwind swatches.
  function confStyle(c?: string | null): string {
    if (c === 'HIGH') return 'background: rgba(34,160,90,0.14); color: #1B8A4B;';
    if (c === 'MEDIUM') return 'background: rgba(214,158,46,0.16); color: #B57A12;';
    return 'background: var(--bg-tertiary); color: var(--text-secondary);';
  }

  function removeItem(orgId: number | null, id: number) {
    groups = groups
      .map((g) => (g.orgId === orgId ? { ...g, items: g.items.filter((it) => it.id !== id) } : g))
      .filter((g) => g.items.length > 0);
  }

  async function accept(orgId: number | null, s: SuggestionWithOrg) {
    busy = { ...busy, [s.id]: 'accept' };
    errors = { ...errors, [s.id]: '' };
    try {
      await acceptSuggestion(s);
      resolved++;
      removeItem(orgId, s.id);
    } catch (e) {
      errors = { ...errors, [s.id]: formatError(e) };
    } finally {
      busy = { ...busy, [s.id]: undefined };
    }
  }

  async function reject(orgId: number | null, s: SuggestionWithOrg) {
    busy = { ...busy, [s.id]: 'reject' };
    errors = { ...errors, [s.id]: '' };
    try {
      await rejectSuggestion(s.id);
      resolved++;
      removeItem(orgId, s.id);
    } catch (e) {
      errors = { ...errors, [s.id]: formatError(e) };
    } finally {
      busy = { ...busy, [s.id]: undefined };
    }
  }

  async function acceptGroup(g: Group) {
    // Accept every item in an org in sequence (logo imports can be slow).
    for (const s of [...g.items]) await accept(g.orgId, s);
  }
</script>

<svelte:head><title>Suggested data · Tools</title></svelte:head>

<section class="mx-auto max-w-3xl space-y-5">
  <header class="flex items-start justify-between gap-3">
    <div>
      <div class="hero-eyebrow">Tools</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">
        Suggested data
      </h1>
      <p class="mt-1 text-sm text-ink-500">
        Web-search recommendations for websites, social handles and logos. Accept to write to the
        org, reject to dismiss.
      </p>
    </div>
    <div class="shrink-0 text-right text-sm text-ink-500">
      <div><span class="font-semibold text-ink-900">{remaining}</span> pending</div>
      {#if resolved > 0}<div style="color: #1B8A4B;">{resolved} resolved</div>{/if}
    </div>
  </header>

  {#if data.error}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 text-sm" style="color: #C0392B;">
      Couldn't load suggestions: {data.error}
    </div>
  {/if}

  {#if remaining === 0 && !data.error}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-10 text-center text-ink-500">
      <span class="inline-flex text-ink-300"><Icon name="sparkles" size={28} /></span>
      <p class="mt-2">No pending suggestions. You're all caught up.</p>
    </div>
  {/if}

  <div class="space-y-4">
    {#each groups as g (g.orgId)}
      <section class="overflow-hidden rounded-[14px] border border-surface-border bg-surface-card">
        <div class="flex items-center justify-between gap-3 border-b border-surface-divider px-4 py-2.5" style="background: var(--bg-tertiary);">
          <a href={`/orgs/${g.orgId}`} class="flex min-w-0 items-center gap-2 font-medium text-ink-900 hover:underline">
            {#if g.org?.logo}
              <img src={assetUrl(g.org.logo, { width: 40, height: 40, fit: 'contain' })} alt="" class="h-6 w-6 rounded object-contain" />
            {:else}
              <span class="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-400" style="background: var(--bg-tertiary);"><Icon name="building" size={14} /></span>
            {/if}
            <span class="truncate">{g.org?.name ?? `Org #${g.orgId}`}</span>
          </a>
          <button
            class="shrink-0 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-surface-hover"
            style="color: #1B8A4B;"
            onclick={() => acceptGroup(g)}
          >Accept all</button>
        </div>

        <ul class="divide-y divide-surface-divider">
          {#each g.items as s (s.id)}
            <li class="px-4 py-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex items-center gap-2">
                    <span class="text-sm font-medium text-ink-900">{label(s.field_key)}</span>
                    <span class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={confStyle(s.confidence)}>{s.confidence ?? '—'}</span>
                  </div>

                  {#if s.field_key === 'logo'}
                    <div class="flex items-center gap-3">
                      <img src={s.suggested_value} alt="suggested logo" class="h-12 max-w-[140px] rounded border border-surface-border bg-white object-contain p-1" loading="lazy" />
                      {#if s.current_value}<span class="text-xs text-ink-400">replaces current</span>{/if}
                    </div>
                  {:else}
                    <div class="truncate text-sm">
                      <a href={s.suggested_value} target="_blank" rel="noopener" class="hover:underline" style="color: var(--accent-electric);">{s.suggested_value}</a>
                    </div>
                    {#if s.current_value}
                      <div class="truncate text-xs text-ink-400">current: {s.current_value}</div>
                    {/if}
                  {/if}

                  {#if s.note}<p class="mt-1 text-xs text-ink-500">{s.note}</p>{/if}
                  {#if s.source_url}
                    <a href={s.source_url} target="_blank" rel="noopener" class="mt-1 inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700">
                      <Icon name="globe" size={12} /> source
                    </a>
                  {/if}
                  {#if errors[s.id]}<p class="mt-1 text-xs" style="color: #C0392B;">{errors[s.id]}</p>{/if}
                </div>

                <div class="flex shrink-0 items-center gap-2">
                  <button
                    class="btn-primary !px-3 !py-1.5 text-sm disabled:opacity-50"
                    disabled={!!busy[s.id]}
                    onclick={() => accept(g.orgId, s)}
                  >{busy[s.id] === 'accept' ? 'Applying…' : 'Accept'}</button>
                  <button
                    class="btn-ghost !px-3 !py-1.5 text-sm disabled:opacity-50"
                    disabled={!!busy[s.id]}
                    onclick={() => reject(g.orgId, s)}
                  >{busy[s.id] === 'reject' ? '…' : 'Reject'}</button>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</section>
