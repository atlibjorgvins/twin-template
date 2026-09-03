<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import {
    assetUrl,
    formatISK,
    formatError,
    updateFinanceReceipt,
    deleteFinanceReceipt,
    countOrphanReceiptFiles,
    requeueFinanceReceipt,
    linkFinanceReceipt,
    findReceiptTxnCandidates,
    autoLinkReceiptOrgs,
    teachReceiptMerchantOrg,
    resolveMerchantOrg,
    receiptOrgId,
    receiptOrgName,
    receiptProjectId,
    receiptProjectName,
    createOrgFromReceipt,
    foldMerchant,
    RECEIPT_MATCH_AMOUNT_TOLERANCE,
    RECEIPT_MATCH_DAY_WINDOW,
    type FinanceReceipt,
    type ReceiptMatch,
    type OrgResolution,
    type Organization,
    type Project,
    type ReceiptMerchantAlias
  } from '$lib/directus';
  import type { ReceiptsData } from './+page';

  let { data }: { data: ReceiptsData } = $props();
  let receipts = $state<FinanceReceipt[]>(data.receipts);
  let orgs = $state<Pick<Organization, 'id' | 'name'>[]>(data.orgs);
  let projects = $state<Pick<Project, 'id' | 'name'>[]>(data.projects);
  let aliases = $state<ReceiptMerchantAlias[]>(data.aliases);
  let error = $state('');
  let busy = $state<number | null>(null);
  /** Containment guesses: offered, never written without a click. */
  let suggestions = $state<Record<number, OrgResolution>>({});
  let autoLinked = $state(0);
  /** Photos in the Receipts folder with no row — counted, never touched. */
  let orphans = $state(0);

  // Auto-link once on mount. This runs in the page rather than the OCR
  // worker on purpose for now: the worker cannot reach the org list, and
  // doing it here means a receipt links the first time anyone looks at the
  // list. The resolver itself is pure and exported, so the worker can adopt
  // it later without changing behaviour.
  //
  // onMount, NOT $effect: this both reads and writes `receipts`, so as an
  // effect it would re-trigger itself forever.
  onMount(() => {
    void (async () => {
      const { linked, suggested } = await autoLinkReceiptOrgs(receipts, orgs, aliases);
      if (linked.size > 0) {
        receipts = receipts.map((r) => {
          const hit = linked.get(r.id);
          return hit ? { ...r, org_id: { id: hit.orgId, name: hit.orgName } } : r;
        });
        autoLinked = linked.size;
      }
      if (suggested.size > 0) suggestions = Object.fromEntries(suggested);
    })();
    // Orphan count is informational and must never block the list, so it
    // runs separately and swallows its own errors.
    void countOrphanReceiptFiles().then((n) => (orphans = n)).catch(() => {});
  });

  // 'new' first: those are the ones waiting on the worker, and seeing them
  // pile up is how you notice OCR has stopped.
  const STATUSES = [
    { value: 'all', label: 'All' },
    { value: 'new', label: 'Queued' },
    { value: 'processed', label: 'To review' },
    { value: 'linked', label: 'Linked' },
    { value: 'failed', label: 'Failed' }
  ];
  let filter = $state('all');

  const counts = $derived.by(() => {
    const m: Record<string, number> = { all: receipts.length };
    for (const r of receipts) m[r.status || 'new'] = (m[r.status || 'new'] ?? 0) + 1;
    return m;
  });

  const shown = $derived(
    filter === 'all' ? receipts : receipts.filter((r) => (r.status || 'new') === filter)
  );

  const fmtDate = (s?: string | null) => (s ? String(s).slice(0, 10) : '—');

  const statusTone = (s?: string | null) =>
    s === 'linked'
      ? 'text-emerald-600'
      : s === 'failed'
        ? 'text-rose-600'
        : s === 'processed'
          ? 'text-amber-600'
          : 'text-ink-400';

  /** Which receipt's full image / OCR text is expanded. */
  let openId = $state<number | null>(null);
  /** Candidate transactions per receipt, loaded on demand. */
  let matches = $state<Record<number, ReceiptMatch[] | 'loading'>>({});

  function patchLocal(id: number, patch: Partial<FinanceReceipt>) {
    receipts = receipts.map((r) => (r.id === id ? { ...r, ...patch } : r));
  }

  /**
   * Save one field. Kept per-field rather than a form submit so a correction
   * sticks the moment you tab away — the whole point of this screen is
   * fixing OCR mistakes quickly.
   */
  async function saveField(
    r: FinanceReceipt,
    field: 'amount' | 'merchant' | 'txn_date' | 'vsk_amount',
    raw: string
  ) {
    let value: string | number | null = raw.trim() || null;
    if ((field === 'amount' || field === 'vsk_amount') && value !== null) {
      const n = Number(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
      if (!Number.isFinite(n)) {
        error = `"${raw}" is not a number`;
        return;
      }
      value = n;
    }
    if (r[field] === value) return;
    error = '';
    busy = r.id;
    try {
      // A hand-corrected row is no longer just 'processed' output, but do not
      // touch a row that is already linked — that would unlink it.
      const patch: Partial<FinanceReceipt> = { [field]: value };
      if ((r.status || 'new') === 'new') patch.status = 'processed';
      await updateFinanceReceipt(r.id, patch);
      patchLocal(r.id, patch);
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = null;
    }
  }

  async function loadMatches(r: FinanceReceipt) {
    matches = { ...matches, [r.id]: 'loading' };
    try {
      const found = await findReceiptTxnCandidates(r);
      matches = { ...matches, [r.id]: found };
    } catch (e) {
      error = formatError(e);
      matches = { ...matches, [r.id]: [] };
    }
  }

  async function link(r: FinanceReceipt, txnId: number | null) {
    error = '';
    busy = r.id;
    try {
      await linkFinanceReceipt(r.id, txnId);
      patchLocal(r.id, { txn_id: txnId, status: txnId === null ? 'processed' : 'linked' });
      // Drop the candidate list: it is stale the moment a link exists, and
      // leaving it up offered "Link" on an already-linked row.
      const { [r.id]: _drop, ...rest } = matches;
      matches = rest;
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = null;
    }
  }

  /** Which receipt is being taught, and the current org query for it. */
  let teachFor = $state<number | null>(null);
  let orgQuery = $state('');

  const orgHits = $derived.by(() => {
    const q = foldMerchant(orgQuery);
    if (q.length < 2) return [] as Pick<Organization, 'id' | 'name'>[];
    // Rank word-start matches above mid-word ones. Folding strips spaces, so
    // a plain substring search for "Nova" returns eight *Innovation* orgs —
    // "nova" really is inside "innovation" — and buries the org you meant.
    const rank = (name: string | null | undefined) => {
      const words = (name ?? '').split(/[^\p{L}\p{N}]+/u).map(foldMerchant).filter(Boolean);
      if (words.some((w) => w.startsWith(q))) return 0;
      if (foldMerchant(name).startsWith(q)) return 1;
      return 2;
    };
    return orgs
      .filter((o) => foldMerchant(o.name).includes(q))
      .sort((a, b) => rank(a.name) - rank(b.name) || (a.name ?? '').length - (b.name ?? '').length)
      .slice(0, 8);
  });

  async function setOrg(r: FinanceReceipt, orgId: number | null) {
    error = '';
    busy = r.id;
    try {
      await updateFinanceReceipt(r.id, { org_id: orgId });
      const org = orgId === null ? null : orgs.find((o) => o.id === orgId);
      patchLocal(r.id, { org_id: org ? { id: org.id, name: org.name } : null });
      const { [r.id]: _drop, ...rest } = suggestions;
      suggestions = rest;
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = null;
    }
  }

  /**
   * Teach the mapping and apply it to every matching receipt at once.
   * Teaching that only fixed the row in front of you would leave the other
   * copies of the same merchant sitting there unlinked.
   */
  async function teach(r: FinanceReceipt, orgId: number) {
    const text = (r.merchant || '').trim();
    if (!text) {
      error = 'Give the receipt a merchant name first — that is what gets taught.';
      return;
    }
    error = '';
    busy = r.id;
    try {
      const { alias, appliedTo } = await teachReceiptMerchantOrg(text, orgId, receipts);
      aliases = [...aliases, alias];
      const org = orgs.find((o) => o.id === orgId);
      const orgRef = org ? { id: org.id, name: org.name } : null;
      receipts = receipts.map((x) =>
        appliedTo.includes(x.id) ? { ...x, org_id: orgRef } : x
      );
      // Anything just linked no longer needs a suggestion.
      const rest = { ...suggestions };
      for (const id of appliedTo) delete rest[id];
      suggestions = rest;
      taught = { text, org: org?.name || `#${orgId}`, count: appliedTo.length };
      teachFor = null;
      orgQuery = '';
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = null;
    }
  }

  let taught = $state<{ text: string; org: string; count: number } | null>(null);

  /**
   * Create the organization from the receipt's merchant text and link it.
   * A receipt from a company that is not on file should not dead-end, and
   * the merchant text is usually the best name we will ever have for it.
   */
  async function createAndLinkOrg(r: FinanceReceipt) {
    const name = (orgQuery.trim() || r.merchant || '').trim();
    if (!name) {
      error = 'Type a name for the new organization first.';
      return;
    }
    error = '';
    busy = r.id;
    try {
      const { org } = await createOrgFromReceipt(name, r.id);
      orgs = [...orgs, { id: org.id, name: org.name }];
      patchLocal(r.id, { org_id: { id: org.id, name: org.name } });
      const rest = { ...suggestions };
      delete rest[r.id];
      suggestions = rest;
      created = { name: org.name || name, id: org.id };
      teachFor = null;
      orgQuery = '';
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = null;
    }
  }

  let created = $state<{ name: string; id: number } | null>(null);

  /** Which receipt's project picker is open, and its query. */
  let projectFor = $state<number | null>(null);
  let projectQuery = $state('');

  const projectHits = $derived.by(() => {
    const q = foldMerchant(projectQuery);
    if (!q) return projects.slice(0, 8);
    return projects.filter((p) => foldMerchant(p.name).includes(q)).slice(0, 8);
  });

  async function setProject(r: FinanceReceipt, projectId: number | null) {
    error = '';
    busy = r.id;
    try {
      await updateFinanceReceipt(r.id, { project_id: projectId });
      const p = projectId === null ? null : projects.find((x) => x.id === projectId);
      patchLocal(r.id, { project_id: p ? { id: p.id, name: p.name } : null });
      projectFor = null;
      projectQuery = '';
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = null;
    }
  }

  async function requeue(r: FinanceReceipt) {
    error = '';
    busy = r.id;
    try {
      await requeueFinanceReceipt(r.id);
      patchLocal(r.id, { status: 'new', ocr_attempts: 0 });
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = null;
    }
  }

  async function remove(r: FinanceReceipt) {
    if (!confirm(`Delete this receipt${r.merchant ? ` from ${r.merchant}` : ''}? The photo stays in Directus.`)) return;
    error = '';
    busy = r.id;
    try {
      await deleteFinanceReceipt(r.id);
      receipts = receipts.filter((x) => x.id !== r.id);
    } catch (e) {
      error = formatError(e);
    } finally {
      busy = null;
    }
  }
</script>

<svelte:head><title>Receipts · twin</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-4 px-4 py-4">
  <div class="flex flex-wrap items-center gap-2">
    <!-- Back to Tools, not Finances: this is a top-level tool now. The
         finances page still links here, but it is not the parent. -->
    <a class="btn-ghost" href="/tools"><Icon name="chevron-left" size={16} /> Tools</a>
    <h1 class="text-lg font-semibold text-ink-900">Receipts</h1>
    <span class="text-xs text-ink-400">{receipts.length} total</span>
  </div>

  {#if error}
    <div class="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
  {/if}

  {#if orphans > 0}
    <div class="rounded-lg border border-surface-border px-3 py-2 text-xs text-ink-400">
      {orphans} photo{orphans === 1 ? '' : 's'} in the Receipts folder
      {orphans === 1 ? 'has' : 'have'} no receipt row — left over from deleted
      receipts. Nothing is removed automatically; tidy them in the Directus
      file library if you want the space back.
    </div>
  {/if}

  {#if created}
    <div class="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      Created <a class="underline" href={`/orgs/${created.id}`}>{created.name}</a> and linked it.
      Receipts with this merchant will link on their own from now on.
    </div>
  {:else if taught}
    <div class="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      Learned: <strong>{taught.text}</strong> → {taught.org}. Applied to {taught.count}
      receipt{taught.count === 1 ? '' : 's'}; future ones link on their own.
    </div>
  {:else if autoLinked > 0}
    <div class="rounded-lg border border-surface-border px-3 py-2 text-xs text-ink-400">
      Auto-linked {autoLinked} receipt{autoLinked === 1 ? '' : 's'} to organizations.
    </div>
  {/if}

  <div class="flex flex-wrap gap-1.5">
    {#each STATUSES as s}
      <button
        class="chip-radio"
        class:is-selected={filter === s.value}
        onclick={() => (filter = s.value)}
      >
        {s.label}
        <span class="ml-1 text-[11px] text-ink-400">{counts[s.value] ?? 0}</span>
      </button>
    {/each}
  </div>

  {#if shown.length === 0}
    <div class="card p-6 text-center text-sm text-ink-400">
      <Icon name="receipt" size={24} />
      <p class="mt-2">
        {receipts.length === 0
          ? 'No receipts yet — capture one from the Receipt quick action.'
          : 'Nothing with that status.'}
      </p>
    </div>
  {:else}
    <ul class="card divide-y divide-surface-border">
      {#each shown as r (r.id)}
        <li class="p-3" class:opacity-60={busy === r.id}>
          <div class="flex gap-3">
            {#if r.image}
              <button
                class="h-24 w-[72px] shrink-0 self-start cursor-pointer overflow-hidden rounded-lg border border-surface-border"
                title="Show the full photo"
                aria-label="Show the full photo"
                onclick={() => (openId = openId === r.id ? null : r.id)}
              >
                <img
                  src={assetUrl(r.image, { width: 96, height: 128, fit: 'cover' })}
                  alt="Receipt from {r.merchant || fmtDate(r.captured_at)}"
                  class="h-24 w-[72px] object-cover"
                  width="72"
                  height="96"
                />
              </button>
            {:else}
              <div class="grid h-24 w-[72px] shrink-0 self-start place-items-center rounded-lg border border-surface-border text-ink-400">
                <Icon name="image" size={18} />
              </div>
            {/if}

            <div class="min-w-0 flex-1 space-y-2">
              <div class="flex items-center gap-2 text-xs">
                <span class={statusTone(r.status)}>{r.status || 'new'}</span>
                <span class="text-ink-400">captured {fmtDate(r.captured_at)}</span>
                {#if typeof r.ocr_confidence === 'number'}
                  <span class="text-ink-400" title="Mean OCR recognition score">
                    OCR {Math.round(r.ocr_confidence * 100)}%
                  </span>
                {/if}
                {#if (r.ocr_attempts ?? 0) > 0 && r.status !== 'processed'}
                  <span class="text-rose-600" title="Consecutive OCR failures">
                    {r.ocr_attempts} attempt{(r.ocr_attempts ?? 0) === 1 ? '' : 's'}
                  </span>
                {/if}
              </div>

              <!-- Editable because OCR is wrong often enough that a review
                   screen without correction would be pointless. -->
              <div class="flex flex-wrap gap-2">
                <label class="flex-1 min-w-[8rem]">
                  <span class="block text-[11px] text-ink-400">Merchant</span>
                  <input
                    class="input w-full text-sm"
                    value={r.merchant ?? ''}
                    placeholder="—"
                    onchange={(e) => saveField(r, 'merchant', (e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <label class="w-28">
                  <span class="block text-[11px] text-ink-400">Amount</span>
                  <input
                    class="input w-full text-sm tabular-nums"
                    value={r.amount ?? ''}
                    placeholder="—"
                    inputmode="decimal"
                    onchange={(e) => saveField(r, 'amount', (e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <label class="w-24">
                  <!-- Only filled when the printed figure reconciles against
                       the total, so a blank here means "not proven", not
                       "no VAT". -->
                  <span class="block text-[11px] text-ink-400">VSK</span>
                  <input
                    class="input w-full text-sm tabular-nums"
                    value={r.vsk_amount ?? ''}
                    placeholder="—"
                    inputmode="decimal"
                    onchange={(e) => saveField(r, 'vsk_amount', (e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <label class="w-36">
                  <span class="block text-[11px] text-ink-400">Date</span>
                  <input
                    type="date"
                    class="input w-full text-sm"
                    value={r.txn_date ?? ''}
                    onchange={(e) => saveField(r, 'txn_date', (e.currentTarget as HTMLInputElement).value)}
                  />
                </label>
              </div>

              <!-- Organization: linked, guessed, or teachable. -->
              <div class="flex flex-wrap items-center gap-2 text-xs">
                {#if receiptOrgId(r) !== null}
                  <a class="text-brand hover:underline" href={`/orgs/${receiptOrgId(r)}`}>
                    {receiptOrgName(r) || `Org #${receiptOrgId(r)}`}
                  </a>
                  <button class="text-ink-400 hover:underline" onclick={() => setOrg(r, null)}>
                    Unlink org
                  </button>
                {:else if suggestions[r.id]}
                  <span class="text-ink-400">Looks like</span>
                  <strong class="text-ink-900">{suggestions[r.id].orgName}</strong>
                  <button class="btn-ghost text-xs" onclick={() => teach(r, suggestions[r.id].orgId)}>
                    <Icon name="check" size={14} /> Yes, and remember
                  </button>
                  <button class="text-ink-400 hover:underline" onclick={() => (teachFor = r.id)}>
                    Pick another
                  </button>
                {:else}
                  <span class="text-ink-400">No organization</span>
                  <button class="btn-ghost text-xs" onclick={() => (teachFor = teachFor === r.id ? null : r.id)}>
                    <Icon name="plus" size={14} /> Teach
                  </button>
                {/if}
              </div>

              {#if teachFor === r.id}
                <div class="space-y-2 rounded-lg border border-surface-border p-2">
                  <p class="text-[11px] text-ink-400">
                    Which organization is <strong>{r.merchant || '(no merchant yet)'}</strong>?
                    Chosen once — every receipt with this merchant links automatically after.
                  </p>
                  <input
                    class="input w-full text-sm"
                    placeholder="Search organizations…"
                    bind:value={orgQuery}
                  />
                  {#if orgHits.length > 0}
                    <ul class="space-y-1">
                      {#each orgHits as o (o.id)}
                        <li>
                          <button
                            class="w-full cursor-pointer rounded px-2 py-1 text-left text-xs hover:bg-surface-hover"
                            onclick={() => teach(r, o.id)}
                          >
                            {o.name}
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {:else if orgQuery.trim().length >= 2}
                    <p class="text-[11px] text-ink-400">No organization matches “{orgQuery}”.</p>
                  {/if}
                  <!-- The dead end this avoids: a receipt from a company that
                       is not on file yet, with no way forward from here. -->
                  <button class="btn-ghost text-xs" onclick={() => createAndLinkOrg(r)}>
                    <Icon name="plus" size={14} />
                    Create “{orgQuery.trim() || r.merchant || '…'}” as a new organization
                  </button>
                </div>
              {/if}

              <!-- Project attribution. Always manual: nothing in a receipt's
                   text says which project it serves. -->
              <div class="flex flex-wrap items-center gap-2 text-xs">
                {#if receiptProjectId(r) !== null}
                  <Icon name="layers" size={14} />
                  <a class="text-brand hover:underline" href={`/projects/${receiptProjectId(r)}`}>
                    {receiptProjectName(r) || `Project #${receiptProjectId(r)}`}
                  </a>
                  <button class="text-ink-400 hover:underline" onclick={() => setProject(r, null)}>
                    Remove project
                  </button>
                {:else}
                  <button
                    class="btn-ghost text-xs"
                    onclick={() => (projectFor = projectFor === r.id ? null : r.id)}
                  >
                    <Icon name="layers" size={14} /> Assign project
                  </button>
                {/if}
              </div>

              {#if projectFor === r.id}
                <div class="space-y-2 rounded-lg border border-surface-border p-2">
                  <input
                    class="input w-full text-sm"
                    placeholder="Search projects…"
                    bind:value={projectQuery}
                  />
                  {#if projectHits.length > 0}
                    <ul class="space-y-1">
                      {#each projectHits as p (p.id)}
                        <li>
                          <button
                            class="w-full cursor-pointer rounded px-2 py-1 text-left text-xs hover:bg-surface-hover"
                            onclick={() => setProject(r, p.id)}
                          >
                            {p.name}
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {:else}
                    <p class="text-[11px] text-ink-400">No project matches “{projectQuery}”.</p>
                  {/if}
                </div>
              {/if}

              {#if r.note}<p class="text-[11px] text-ink-400">{r.note}</p>{/if}

              <div class="flex flex-wrap items-center gap-2">
                {#if r.txn_id}
                  <a class="btn-ghost text-xs" href={`/tools/finances/${r.txn_id}`}>
                    <Icon name="check" size={14} /> Linked to #{r.txn_id}
                  </a>
                  <button class="btn-ghost text-xs" onclick={() => link(r, null)}>Unlink</button>
                {:else}
                  <button class="btn-ghost text-xs" onclick={() => loadMatches(r)}>
                    <Icon name="search" size={14} /> Find transaction
                  </button>
                {/if}
                <button class="btn-ghost text-xs" onclick={() => requeue(r)} title="Send back to the OCR queue">
                  Re-run OCR
                </button>
                {#if r.ocr_text}
                  <button class="btn-ghost text-xs" onclick={() => (openId = openId === r.id ? null : r.id)}>
                    <Icon name="eye" size={14} /> OCR text
                  </button>
                {/if}
                <button class="btn-ghost text-xs text-rose-600" onclick={() => remove(r)}>
                  <Icon name="trash" size={14} /> Delete
                </button>
              </div>

              {#if matches[r.id]}
                <div class="rounded-lg border border-surface-border p-2">
                  {#if matches[r.id] === 'loading'}
                    <p class="text-xs text-ink-400">Searching…</p>
                  {:else if (matches[r.id] as ReceiptMatch[]).length === 0}
                    <p class="text-xs text-ink-400">
                      No transaction within {RECEIPT_MATCH_AMOUNT_TOLERANCE} kr. and
                      {RECEIPT_MATCH_DAY_WINDOW} days. Fix the amount or date above and try again.
                    </p>
                  {:else}
                    <ul class="space-y-1">
                      {#each matches[r.id] as ReceiptMatch[] as m (m.txn.id)}
                        <li class="flex items-center gap-2 text-xs">
                          <span class="w-20 shrink-0 text-ink-400 tabular-nums">{fmtDate(m.txn.txn_date)}</span>
                          <span class="min-w-0 flex-1 truncate text-ink-900">{m.txn.description || '—'}</span>
                          <span class="shrink-0 tabular-nums">{formatISK(m.txn.amount)}</span>
                          <button class="btn-ghost shrink-0 text-xs" onclick={() => link(r, m.txn.id)}>Link</button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}

              {#if openId === r.id}
                <div class="space-y-2 rounded-lg border border-surface-border p-2">
                  {#if r.image}
                    <a href={assetUrl(r.image)} target="_blank" rel="noreferrer">
                      <img
                        src={assetUrl(r.image, { width: 900 })}
                        alt="Full receipt"
                        class="max-h-[70vh] w-full rounded object-contain"
                      />
                    </a>
                  {/if}
                  {#if r.ocr_text}
                    <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] text-ink-400">{r.ocr_text}</pre>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
