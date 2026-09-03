<script lang="ts">
  // Setup — the plumbing behind the workspace: which ad accounts twin reads,
  // and the medium vocabulary everything reports through.
  //
  // Linking an account to a project is THE GATE — campaigns only publish into
  // linked accounts, and insights are only pulled for them. That keeps 28 loose
  // accounts from becoming 28 unorganised data dumps.
  //
  // The medium list is data, not code (mk_medium), so a new channel is a row
  // here rather than a deploy.
  import Icon from '$lib/Icon.svelte';
  import {
    formatError,
    searchProjects,
    updateMkAdAccount,
    type MkAdAccount,
    type Project
  } from '$lib/directus';
  import { updateMedium } from '$lib/marketing/data';
  import { KIND_LABELS, sortMediums, type Medium } from '$lib/marketing/media';

  let {
    data
  }: { data: { accounts: MkAdAccount[]; mediums: Medium[]; error: string | null } } = $props();
  let accounts = $state<MkAdAccount[]>([...data.accounts]);
  let mediums = $state<Medium[]>(sortMediums(data.mediums));
  let errorMsg = $state<string | null>(data.error);

  // Optimistic: the toggle is the feedback. A failure puts the row back and
  // says so, which is better than a spinner on a checkbox.
  async function toggle(x: Medium, field: 'isEnabled' | 'manualEntry') {
    const next = !x[field];
    mediums = mediums.map((m) => (m.code === x.code ? { ...m, [field]: next } : m));
    try {
      await updateMedium(x.code, { [field]: next } as Partial<Medium>);
    } catch (e) {
      mediums = mediums.map((m) => (m.code === x.code ? { ...m, [field]: !next } : m));
      errorMsg = formatError(e);
    }
  }

  // one inline project search at a time
  let editing = $state<string | null>(null);
  let projQuery = $state('');
  let projMatches = $state<Project[]>([]);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  function startEdit(a: MkAdAccount) {
    editing = a.id;
    projQuery = '';
    projMatches = [];
  }
  function onProjInput() {
    if (searchTimer) clearTimeout(searchTimer);
    const q = projQuery.trim();
    if (q.length < 2) {
      projMatches = [];
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        projMatches = await searchProjects(q, 8);
      } catch {
        projMatches = [];
      }
    }, 250);
  }
  async function linkProject(a: MkAdAccount, p: Project | null) {
    errorMsg = null;
    try {
      await updateMkAdAccount(a.id, { project_id: p?.id ?? null });
      a.project_id = p ? { id: p.id, name: p.name } : null;
      editing = null;
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  function projOf(a: MkAdAccount): { id: number; name?: string | null } | null {
    return typeof a.project_id === 'object' ? a.project_id : null;
  }

  const linkedCount = $derived(accounts.filter((a) => projOf(a)).length);
</script>

<svelte:head><title>Setup · Marketing</title></svelte:head>

<section class="space-y-5">
  <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
    <div class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      Meta ad accounts
    </div>
    <p class="mt-1 text-sm text-ink-500">
      Synced from the Meta Ads connector. Link each account to the twin project it runs for —
      campaigns only publish into linked accounts, and reports are only pulled for them.
      {linkedCount}/{accounts.length} linked.
    </p>
  </div>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 text-sm" style="color: #C0392B;">
      {errorMsg}
    </div>
  {/if}

  <ul class="divide-y divide-surface-divider rounded-[14px] border border-surface-border bg-surface-card">
    {#each accounts as a (a.id)}
      {@const proj = projOf(a)}
      <li class="flex flex-wrap items-center gap-3 px-4 py-3" class:opacity-50={a.is_enabled === false}>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate font-medium text-ink-900">{a.name}</span>
            {#if a.account_status && a.account_status !== 'ACTIVE'}
              <span class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase" style="background: var(--bg-tertiary); color: var(--text-tertiary);">
                {a.account_status}
              </span>
            {/if}
          </div>
          <div class="text-[11px] text-ink-500">
            {[a.business_name, a.currency, a.id].filter(Boolean).join(' · ')}
          </div>
        </div>

        <div class="shrink-0">
          {#if proj}
            <span class="inline-flex items-center gap-1.5 text-sm">
              <a href={`/projects/${proj.id}`} class="font-medium text-ink-900 hover:underline">{proj.name}</a>
              <button class="text-ink-300 hover:text-ink-700" onclick={() => linkProject(a, null)} aria-label="Unlink project">
                <Icon name="x" size={12} />
              </button>
            </span>
          {:else if editing === a.id}
            <span class="relative block">
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="input !w-52 !py-1 text-xs"
                placeholder="Search projects…"
                bind:value={projQuery}
                oninput={onProjInput}
                autofocus
              />
              {#if projMatches.length > 0}
                <ul class="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-[10px] border border-surface-border bg-surface-card shadow-lg">
                  {#each projMatches as p (p.id)}
                    <li>
                      <button class="w-full px-3 py-1.5 text-left text-xs hover:bg-surface-hover" onclick={() => linkProject(a, p)}>
                        {p.name}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </span>
          {:else}
            <button class="btn-ghost text-xs" onclick={() => startEdit(a)}>Link project…</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <div class="rounded-[14px] border border-surface-border bg-surface-card">
    <div class="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
      <span class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        Medium vocabulary
      </span>
      <span class="text-[11px] text-ink-500">{mediums.length} mediums</span>
    </div>
    <p class="px-4 pb-3 text-sm text-ink-500">
      The one list every spend row reports through, paid and hand-entered alike.
      <strong>Offered</strong> controls whether the Spend form suggests it — off for the Meta
      platforms, which only ever arrive from the sync. <strong>Enabled</strong> retires a medium
      without deleting its history.
    </p>
    <div class="overflow-x-auto border-t border-surface-divider">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-surface-divider text-left text-[10px] uppercase tracking-wide text-ink-400">
            <th class="px-4 py-2">Medium</th>
            <th class="px-3 py-2">Family</th>
            <th class="px-3 py-2">Meta platform</th>
            <th class="px-3 py-2 text-center">Offered</th>
            <th class="px-3 py-2 text-center">Enabled</th>
          </tr>
        </thead>
        <tbody>
          {#each mediums as x (x.code)}
            <tr class="border-b border-surface-divider/50" class:opacity-50={!x.isEnabled}>
              <td class="px-4 py-2">
                <span class="text-ink-900">{x.label}</span>
                <span class="ml-1.5 text-[10px] text-ink-400">{x.code}</span>
              </td>
              <td class="px-3 py-2 text-ink-600">{KIND_LABELS[x.kind] ?? x.kind}</td>
              <td class="px-3 py-2 text-[11px] text-ink-500">{x.metaPlatform ?? '—'}</td>
              <td class="px-3 py-2 text-center">
                <input
                  type="checkbox"
                  checked={x.manualEntry}
                  aria-label={`Offer ${x.label} for hand-entered spend`}
                  onchange={() => toggle(x, 'manualEntry')}
                />
              </td>
              <td class="px-3 py-2 text-center">
                <input
                  type="checkbox"
                  checked={x.isEnabled}
                  aria-label={`Enable ${x.label}`}
                  onchange={() => toggle(x, 'isEnabled')}
                />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <p class="text-[11px] text-ink-400">
    Metrics arrive from <code>scripts/sync-meta-metrics.mjs</code>, run nightly. Adding a medium that
    mirrors a Meta platform means filling in its <em>Meta platform</em> value in Directus, so the
    breakdown sync can map onto it.
  </p>
</section>
