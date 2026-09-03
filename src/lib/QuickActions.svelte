<script lang="ts">
  /**
   * Single source of truth for the dashboard highlight circles and the
   * mobile bottom-nav "+" FAB. Owns:
   *   - the HIGHLIGHTS catalogue
   *   - the active-sheet $state
   *   - state + handlers for each of the 5 quick-action sheets
   *   - the bodies of those sheets (mounted once at the layout level)
   *   - a "menu" sheet for the FAB that lists the 5 highlights as
   *     circles; tapping one closes the menu and opens the picked sheet.
   *
   * Both the dashboard's `<HighlightsRow>` and the mobile FAB consume
   * this via Svelte context. Changes to the HIGHLIGHTS array reflect on
   * both surfaces automatically.
   */
  import { goto, invalidateAll } from '$app/navigation';
  import BottomSheet from '$lib/BottomSheet.svelte';
  import QuickLogChips from '$lib/QuickLogChips.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import Icon from '$lib/Icon.svelte';
  import { upsertOrgSocial } from '$lib/orgSocial';
  import {
    createNote,
    createPerson,
    createOrg,
    createProject,
    PROJECT_COLORS,
    createDateRow,
    ORG_INDUSTRY_OPTIONS,
    searchOrgs,
    searchPeople,
    searchProjects,
    personName,
    assetUrl,
    createFinanceReceipt,
    createPrompt,
    formatError,
    type Person,
    type Organization,
    type Project
  } from '$lib/directus';
  import {
    activeHighlights,
    quickActions,
    closeSheet,
    pickFromMenu
  } from '$lib/quickActionsStore.svelte';
  import { featureOn } from '$lib/instance';

  // Local alias so the `{#if sheet === '…'}` branches read naturally.
  const sheet = $derived(quickActions.sheet);

  // ── Quick capture ───────────────────────────────────────────────────────
  let captureText = $state('');
  let capturing = $state(false);
  let captureError = $state('');
  async function quickCapture() {
    const text = captureText.trim();
    if (!text || capturing) return;
    capturing = true;
    captureError = '';
    try {
      const lines = text.split('\n');
      const title = lines[0].slice(0, 200);
      const content = lines.slice(1).join('\n').trim();
      const created = await createNote({
        title,
        content: content || null,
        note_type: 'inbox',
        status: 'published'
      });
      captureText = '';
      closeSheet();
      goto(`/notes/${created.id}`);
    } catch (e) {
      captureError = formatError(e);
    } finally {
      capturing = false;
    }
  }
  function captureKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void quickCapture();
    }
  }

  // ── Prompt capture ──────────────────────────────────────────────────────
  // Jot a prompt from anywhere → opens the library entry to enrich (tags,
  // projects, systems). Title + body now, the rest on the detail page.
  let promptTitle = $state('');
  let promptBody = $state('');
  let promptBusy = $state(false);
  let promptError = $state('');
  async function savePrompt() {
    if ((!promptTitle.trim() && !promptBody.trim()) || promptBusy) return;
    promptBusy = true; promptError = '';
    try {
      const created = await createPrompt({
        title: promptTitle.trim() || 'Untitled prompt',
        body: promptBody.trim() || null
      });
      promptTitle = ''; promptBody = '';
      closeSheet();
      goto(`/tools/prompts/${created.id}`);
    } catch (e) {
      promptError = formatError(e);
    } finally {
      promptBusy = false;
    }
  }

  // ── Receipt capture ─────────────────────────────────────────────────────
  // Snap a purchase receipt → upload to the NAS "Receipts" folder + create a
  // finance_receipt row. OCR (later) enriches amount/merchant/date.
  let receiptFile = $state<File | null>(null);
  let receiptPreview = $state<string | null>(null);
  let receiptNote = $state('');
  let receiptBusy = $state(false);
  let receiptError = $state('');
  let receiptDone = $state(false);

  // Tag at capture. Standing at the till is when you know this was the
  // Hraðall lunch; a week later in the review queue you are reconstructing
  // it from a photo. Both optional — the review screen still exists for
  // everything captured in a hurry.
  let receiptOrg = $state<Pick<Organization, 'id' | 'name'> | null>(null);
  let receiptProject = $state<Pick<Project, 'id' | 'name'> | null>(null);
  let receiptOrgQ = $state('');
  let receiptProjectQ = $state('');
  let receiptOrgResults = $state<Pick<Organization, 'id' | 'name'>[]>([]);
  let receiptProjectResults = $state<Pick<Project, 'id' | 'name'>[]>([]);
  let receiptOrgTimer: ReturnType<typeof setTimeout> | null = null;
  let receiptProjectTimer: ReturnType<typeof setTimeout> | null = null;

  // Searched through the API rather than preloading every org: this sheet has
  // to open instantly, and the receipts review page already pays the cost of
  // the full list because it needs to fold accents locally.
  function onReceiptOrgQuery(e: Event) {
    receiptOrgQ = (e.currentTarget as HTMLInputElement).value;
    if (receiptOrgTimer) clearTimeout(receiptOrgTimer);
    receiptOrgTimer = setTimeout(async () => {
      if (!receiptOrgQ.trim()) { receiptOrgResults = []; return; }
      try {
        receiptOrgResults = (await searchOrgs(receiptOrgQ, 6)) as Organization[];
      } catch { receiptOrgResults = []; }
    }, 180);
  }
  function onReceiptProjectQuery(e: Event) {
    receiptProjectQ = (e.currentTarget as HTMLInputElement).value;
    if (receiptProjectTimer) clearTimeout(receiptProjectTimer);
    receiptProjectTimer = setTimeout(async () => {
      if (!receiptProjectQ.trim()) { receiptProjectResults = []; return; }
      try {
        receiptProjectResults = (await searchProjects(receiptProjectQ, 6)) as Project[];
      } catch { receiptProjectResults = []; }
    }, 180);
  }

  function onReceiptPick(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    receiptFile = f;
    receiptPreview = f ? URL.createObjectURL(f) : null;
    receiptDone = false;
    receiptError = '';
  }
  function resetReceipt() {
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    receiptFile = null;
    receiptPreview = null;
    receiptNote = '';
    receiptError = '';
    receiptDone = false;
    receiptOrg = null;
    receiptProject = null;
    receiptOrgQ = '';
    receiptProjectQ = '';
    receiptOrgResults = [];
    receiptProjectResults = [];
  }
  async function saveReceipt() {
    if (!receiptFile || receiptBusy) return;
    receiptBusy = true;
    receiptError = '';
    try {
      await createFinanceReceipt(receiptFile, {
        note: receiptNote.trim() || null,
        org_id: receiptOrg?.id ?? null,
        project_id: receiptProject?.id ?? null
      });
      receiptDone = true;
      resetReceipt();
      // Give the success note a beat, then close.
      setTimeout(() => { if (sheet === 'receipt') closeSheet(); receiptDone = false; }, 1100);
    } catch (e) {
      receiptError = formatError(e);
    } finally {
      receiptBusy = false;
    }
  }

  // ── Log an interaction ──────────────────────────────────────────────────
  // Multiple people can be attached to one interaction (Activity_Person).
  let pickedPeople = $state<Person[]>([]);
  let personQ = $state('');
  let personResults = $state<Person[]>([]);
  let personSearchTimer: ReturnType<typeof setTimeout> | null = null;
  function onPersonQuery(e: Event) {
    personQ = (e.currentTarget as HTMLInputElement).value;
    if (personSearchTimer) clearTimeout(personSearchTimer);
    personSearchTimer = setTimeout(async () => {
      if (!personQ.trim()) { personResults = []; return; }
      try { personResults = (await searchPeople(personQ, 6)) as Person[]; } catch { personResults = []; }
    }, 180);
  }
  function pickPerson(p: Person) {
    if (!pickedPeople.some((x) => x.id === p.id)) pickedPeople = [...pickedPeople, p];
    personQ = '';
    personResults = [];
  }
  function removePickedPerson(id: number) {
    pickedPeople = pickedPeople.filter((p) => p.id !== id);
  }
  // Reset the picked people whenever the interaction sheet isn't open, so a
  // fresh log doesn't inherit the previous one's attendees.
  $effect(() => {
    if (sheet !== 'interact') {
      pickedPeople = [];
      personQ = '';
      personResults = [];
    }
  });

  // ── New event ──────────────────────────────────────────────────────────
  let newEventTitle = $state('');
  let newEventDate = $state(new Date().toISOString().slice(0, 10));
  let newEventAllDay = $state(true);
  let newEventBusy = $state(false);
  let newEventError = $state('');
  async function submitNewEvent() {
    const title = newEventTitle.trim();
    if (!title || newEventBusy) return;
    newEventBusy = true;
    newEventError = '';
    try {
      const d = new Date(newEventDate);
      const start = new Date(d); start.setHours(0, 0, 0, 0);
      const end = new Date(d); end.setHours(23, 59, 59, 999);
      await createDateRow({
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        all_day: newEventAllDay,
        source: 'manual',
        status: 'published'
      } as never);
      newEventTitle = '';
      closeSheet();
      // Re-run loaders so the dashboard's Today list picks up the new row.
      void invalidateAll();
    } catch (e) {
      newEventError = formatError(e);
    } finally {
      newEventBusy = false;
    }
  }

  // ── New person ─────────────────────────────────────────────────────────
  // Compact fields (always visible): name + email.
  // Expanded extras (revealed by dragging the sheet up): phone,
  // LinkedIn, scope. Pre-fill scope from the global Work/Private
  // toggle when we add wiring; for now default to 'work'.
  let newPersonName = $state('');
  let newPersonEmail = $state('');
  let newPersonPhone = $state('');
  let newPersonLinkedin = $state('');
  let newPersonScope = $state<'work' | 'private' | 'both'>('work');
  let newPersonBusy = $state(false);
  let newPersonError = $state('');
  async function submitNewPerson() {
    const full_name = newPersonName.trim();
    if (!full_name || newPersonBusy) return;
    newPersonBusy = true;
    newPersonError = '';
    try {
      const created = await createPerson({
        full_name,
        email: newPersonEmail.trim() || null,
        phone: newPersonPhone.trim() || null,
        Linkedin: newPersonLinkedin.trim() || null,
        scope: newPersonScope
      } as Partial<Person>);
      newPersonName = '';
      newPersonEmail = '';
      newPersonPhone = '';
      newPersonLinkedin = '';
      newPersonScope = 'work';
      closeSheet();
      goto(`/people/${created.id}`);
    } catch (e) {
      newPersonError = formatError(e);
    } finally {
      newPersonBusy = false;
    }
  }

  // ── New project ────────────────────────────────────────────────────────
  // Compact: name + kind. Expanded: scope, colour, summary.
  let newProjectName = $state('');
  let newProjectKind = $state('project');
  let newProjectScope = $state<'work' | 'private' | 'both'>('work');
  let newProjectColor = $state<string | null>(null);
  let newProjectSummary = $state('');
  let newProjectBusy = $state(false);
  let newProjectError = $state('');
  async function submitNewProject() {
    const name = newProjectName.trim();
    if (!name || newProjectBusy) return;
    newProjectBusy = true;
    newProjectError = '';
    try {
      const created = await createProject({
        name,
        kind: newProjectKind,
        scope: newProjectScope,
        color: newProjectColor,
        summary: newProjectSummary.trim() || null
      });
      newProjectName = '';
      newProjectKind = 'project';
      newProjectScope = 'work';
      newProjectColor = null;
      newProjectSummary = '';
      closeSheet();
      goto(`/projects/${created.id}`);
    } catch (e) {
      newProjectError = formatError(e);
    } finally {
      newProjectBusy = false;
    }
  }

  // ── New org ────────────────────────────────────────────────────────────
  // Compact: name + website. Expanded: industry, email, phone,
  // LinkedIn URL, scope.
  let newOrgName = $state('');
  let newOrgWebsite = $state('');
  let newOrgIndustry = $state('');
  let newOrgEmail = $state('');
  let newOrgPhone = $state('');
  let newOrgLinkedin = $state('');
  let newOrgScope = $state<'work' | 'private' | 'both'>('work');
  let newOrgBusy = $state(false);
  let newOrgError = $state('');
  async function submitNewOrg() {
    const name = newOrgName.trim();
    if (!name || newOrgBusy) return;
    newOrgBusy = true;
    newOrgError = '';
    try {
      const created = await createOrg({
        name,
        website: newOrgWebsite.trim() || null,
        industry: newOrgIndustry.trim() || null,
        email: newOrgEmail.trim() || null,
        phone: newOrgPhone.trim() || null,
        scope: newOrgScope
      } as Partial<Organization>);
      // LinkedIn is a social row now, not a column on the org. Written after
      // creation because the row needs the new id, and non-fatal: a failure
      // here must not lose the organization you just typed.
      if (newOrgLinkedin.trim()) {
        await upsertOrgSocial(created.id, 'linkedin', newOrgLinkedin).catch(() => undefined);
      }
      newOrgName = '';
      newOrgWebsite = '';
      newOrgIndustry = '';
      newOrgEmail = '';
      newOrgPhone = '';
      newOrgLinkedin = '';
      newOrgScope = 'work';
      closeSheet();
      goto(`/orgs/${created.id}`);
    } catch (e) {
      newOrgError = formatError(e);
    } finally {
      newOrgBusy = false;
    }
  }
</script>

<!-- ── Menu sheet: the FAB opens this.
     The catalogue is rendered as a 3-column grid so every item is
     visible without horizontal scrolling. The sheet is `expandable`:
     drag the handle up to grow to ~88 vh, revealing any future items
     that overflow the compact (~45 vh) height. ─────────────────────── -->
<BottomSheet open={sheet === 'menu'} title="Quick actions" expandable onClose={closeSheet}>
  <div class="grid grid-cols-3 gap-3">
    {#each activeHighlights(featureOn) as h (h.key)}
      <button
        type="button"
        class="flex flex-col items-center justify-center gap-1.5 rounded-[14px] border border-surface-border bg-surface-card px-2 py-3 text-xs font-medium text-ink-700 hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        onclick={() => pickFromMenu(h.key)}
      >
        <span class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface-hover text-brand">
          <Icon name={h.icon} size={20} />
        </span>
        <span class="font-display uppercase tracking-wider text-[10px] text-ink-500">{h.label}</span>
      </button>
    {/each}
  </div>
  <p class="mt-3 px-1 text-[11px] text-ink-400">Tap an action to open it. Drag the handle ↑ to see more.</p>
</BottomSheet>

<!-- ── 5 detail sheets ─────────────────────────────────────────────── -->
<BottomSheet open={sheet === 'capture'} title="Quick capture" onClose={closeSheet}>
  <label for="sheet-capture" class="sr-only">Capture</label>
  <textarea
    id="sheet-capture"
    class="input w-full resize-none"
    rows="4"
    placeholder="Drop a thought, a name, a follow-up… (⌘↵ to save)"
    bind:value={captureText}
    onkeydown={captureKey}
    disabled={capturing}
  ></textarea>
  {#if captureError}
    <div class="mt-2 text-xs text-tag-salesText">{captureError}</div>
  {/if}
  <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
    <div class="text-xs text-ink-400">First line → title. Tag people on the next page.</div>
    <button class="btn-primary" onclick={quickCapture} disabled={capturing || !captureText.trim()}>
      <Icon name="plus" size={14} />
      {capturing ? 'Saving…' : 'Capture'}
    </button>
  </div>
</BottomSheet>

<BottomSheet open={sheet === 'receipt'} title="Capture receipt" onClose={() => { resetReceipt(); closeSheet(); }}>
  <!-- Camera on mobile (`capture`), file picker on desktop. -->
  <input
    id="sheet-receipt-file"
    type="file"
    accept="image/*"
    capture="environment"
    class="sr-only"
    onchange={onReceiptPick}
  />
  {#if !receiptPreview}
    <label
      for="sheet-receipt-file"
      class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-surface-border py-10 text-ink-500 hover:bg-surface-hover"
    >
      <Icon name="receipt" size={28} />
      <span class="text-sm font-medium">Take a photo of the receipt</span>
      <span class="text-[11px] text-ink-400">Saved to the Receipts folder on the NAS</span>
    </label>
  {:else}
    <div class="space-y-3">
      <div class="overflow-hidden rounded-[14px] border border-surface-border">
        <img src={receiptPreview} alt="Receipt preview" class="max-h-72 w-full object-contain bg-surface-hover" />
      </div>
      <label for="sheet-receipt-note" class="sr-only">Note</label>
      <input
        id="sheet-receipt-note"
        class="input w-full"
        placeholder="Optional note (merchant, what it was for…)"
        bind:value={receiptNote}
        disabled={receiptBusy}
      />
      <!-- Optional tags. Set here and the receipt skips the review queue
           entirely; leave them and the review screen handles it later. -->
      <div class="space-y-2">
        {#if receiptOrg}
          <div class="flex items-center gap-2 text-sm">
            <Icon name="building" size={14} />
            <span class="min-w-0 flex-1 truncate text-ink-900">{receiptOrg.name}</span>
            <button class="text-xs text-ink-400 hover:underline" onclick={() => (receiptOrg = null)}>
              Clear
            </button>
          </div>
        {:else}
          <div>
            <label for="sheet-receipt-org" class="sr-only">Organization</label>
            <input
              id="sheet-receipt-org"
              class="input w-full text-sm"
              placeholder="Organization (optional)"
              value={receiptOrgQ}
              oninput={onReceiptOrgQuery}
              disabled={receiptBusy}
            />
            {#if receiptOrgResults.length > 0}
              <ul class="mt-1 space-y-0.5">
                {#each receiptOrgResults as o (o.id)}
                  <li>
                    <button
                      class="w-full cursor-pointer rounded px-2 py-1 text-left text-xs hover:bg-surface-hover"
                      onclick={() => { receiptOrg = { id: o.id, name: o.name }; receiptOrgQ = ''; receiptOrgResults = []; }}
                    >
                      {o.name}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}

        {#if receiptProject}
          <div class="flex items-center gap-2 text-sm">
            <Icon name="layers" size={14} />
            <span class="min-w-0 flex-1 truncate text-ink-900">{receiptProject.name}</span>
            <button class="text-xs text-ink-400 hover:underline" onclick={() => (receiptProject = null)}>
              Clear
            </button>
          </div>
        {:else}
          <div>
            <label for="sheet-receipt-project" class="sr-only">Project</label>
            <input
              id="sheet-receipt-project"
              class="input w-full text-sm"
              placeholder="Project (optional)"
              value={receiptProjectQ}
              oninput={onReceiptProjectQuery}
              disabled={receiptBusy}
            />
            {#if receiptProjectResults.length > 0}
              <ul class="mt-1 space-y-0.5">
                {#each receiptProjectResults as p (p.id)}
                  <li>
                    <button
                      class="w-full cursor-pointer rounded px-2 py-1 text-left text-xs hover:bg-surface-hover"
                      onclick={() => { receiptProject = { id: p.id, name: p.name }; receiptProjectQ = ''; receiptProjectResults = []; }}
                    >
                      {p.name}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>

      <div class="flex items-center justify-between gap-2">
        <label for="sheet-receipt-file" class="btn-ghost cursor-pointer">Retake</label>
        <button class="btn-primary" onclick={saveReceipt} disabled={receiptBusy}>
          <Icon name="plus" size={14} />
          {receiptBusy ? 'Saving…' : 'Save receipt'}
        </button>
      </div>
    </div>
  {/if}
  {#if receiptError}<div class="mt-2 text-xs text-tag-salesText">{receiptError}</div>{/if}
  {#if receiptDone}<div class="mt-2 text-xs text-brand">Saved to Receipts ✓</div>{/if}
</BottomSheet>

<BottomSheet open={sheet === 'prompt'} title="New prompt" onClose={closeSheet}>
  <label for="sheet-prompt-title" class="sr-only">Title</label>
  <input
    id="sheet-prompt-title"
    class="input mb-2 w-full"
    placeholder="Title (e.g. Investor update draft)"
    bind:value={promptTitle}
    disabled={promptBusy}
  />
  <label for="sheet-prompt-body" class="sr-only">Prompt</label>
  <textarea
    id="sheet-prompt-body"
    class="input w-full resize-none font-mono text-sm"
    rows="5"
    placeholder="The prompt text… use {'{tokens}'} for fill-ins."
    bind:value={promptBody}
    disabled={promptBusy}
  ></textarea>
  {#if promptError}<div class="mt-2 text-xs text-tag-salesText">{promptError}</div>{/if}
  <div class="mt-3 flex items-center justify-between gap-2">
    <div class="text-xs text-ink-400">Add tags, projects &amp; systems on the next page.</div>
    <button class="btn-primary" onclick={savePrompt} disabled={promptBusy || (!promptTitle.trim() && !promptBody.trim())}>
      <Icon name="plus" size={14} /> {promptBusy ? 'Saving…' : 'Save'}
    </button>
  </div>
</BottomSheet>

<BottomSheet open={sheet === 'interact'} title="Log an interaction" onClose={closeSheet}>
  {#if pickedPeople.length > 0}
    <div class="flex flex-wrap items-center gap-1.5 text-sm">
      <span class="text-ink-500">With</span>
      {#each pickedPeople as p (p.id)}
        <span
          class="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs"
          style="background: var(--accent-alpha-10); color: var(--accent-electric); border: 1px solid var(--accent-alpha-30); border-radius: var(--radius-pill);"
        >
          <Avatar
            name={personName(p)}
            src={assetUrl(p.person_picture, { width: 48, height: 48, fit: 'cover' }) ?? ''}
            size={18}
          />
          <span class="font-medium">{personName(p)}</span>
          <button class="ml-0.5 text-ink-400 hover:text-ink-700" onclick={() => removePickedPerson(p.id)} aria-label={`Remove ${personName(p)}`}>
            <Icon name="plus" size={10} class="rotate-45" />
          </button>
        </span>
      {/each}
    </div>
  {/if}
  <div class="relative mt-2">
    <Icon name="search" size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
    <input
      type="text"
      value={personQ}
      oninput={onPersonQuery}
      placeholder={pickedPeople.length ? 'Add another person…' : 'Who did you interact with? (optional)'}
      class="w-full pl-7 pr-2 py-1.5 text-sm focus:outline-none"
      style="background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); color: var(--text-primary);"
    />
    {#if personResults.length > 0}
      <ul class="mt-1 max-h-56 overflow-auto" style="background: var(--bg-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
        {#each personResults as p (p.id)}
          <li>
            <button
              class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
              style="border-radius: var(--radius-sm);"
              onclick={() => pickPerson(p)}
            >
              <Avatar name={personName(p)} src={assetUrl(p.person_picture, { width: 48, height: 48, fit: 'cover' }) ?? ''} size={20} />
              <span class="truncate">{personName(p)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  <div class="mt-3">
    <QuickLogChips
      context={pickedPeople.length
        ? { kind: 'person', personId: pickedPeople[0].id, morePersonIds: pickedPeople.slice(1).map((p) => p.id) }
        : { kind: 'standalone' }}
      onLogged={(a) => {
        // Skip the undo callback (QuickLogChips re-fires onLogged with
        // status='__deleted__' when the user taps Undo within the 5s
        // window). Otherwise navigate to the new activity's detail
        // page so the user can flesh out summary / location.
        if (a.status === '__deleted__') return;
        closeSheet();
        goto(`/interactions/${a.id}`);
      }}
    />
  </div>
</BottomSheet>

<BottomSheet open={sheet === 'event'} title="New event" onClose={closeSheet}>
  <label class="block">
    <span class="block text-xs text-ink-400 mb-1">Title</span>
    <input type="text" class="input w-full" placeholder="e.g. Lunch with Anna" bind:value={newEventTitle} />
  </label>
  <div class="mt-3 grid grid-cols-2 gap-2">
    <label class="block">
      <span class="block text-xs text-ink-400 mb-1">Date</span>
      <input type="date" class="input w-full" bind:value={newEventDate} />
    </label>
    <label class="inline-flex items-end gap-2 pb-2">
      <input type="checkbox" bind:checked={newEventAllDay} class="accent-brand" />
      <span class="text-sm text-ink-700">All day</span>
    </label>
  </div>
  {#if newEventError}<div class="mt-2 text-xs text-tag-salesText">{newEventError}</div>{/if}
  <div class="mt-3 flex justify-end">
    <button class="btn-primary" onclick={submitNewEvent} disabled={newEventBusy || !newEventTitle.trim()}>
      <Icon name="plus" size={14} />
      {newEventBusy ? 'Saving…' : 'Add event'}
    </button>
  </div>
  <div class="mt-2 text-[11px] text-ink-400">
    For times, location, links etc., open the <a class="text-brand hover:underline" href="/calendar">Calendar</a>.
  </div>
</BottomSheet>

<BottomSheet open={sheet === 'person'} title="Add person" expandable onClose={closeSheet}>
  <!-- Essentials — always visible in compact mode. -->
  <label class="block">
    <span class="block text-xs text-ink-400 mb-1">Full name</span>
    <input type="text" class="input w-full" placeholder="e.g. Atli Björgvinsson" bind:value={newPersonName} />
  </label>
  <label class="block mt-3">
    <span class="block text-xs text-ink-400 mb-1">Email (optional)</span>
    <input type="email" class="input w-full" placeholder="name@example.com" bind:value={newPersonEmail} />
  </label>

  <!-- More fields — clipped below the fold in compact mode; drag the
       handle up to bring them into view. -->
  <div class="mt-5 border-t border-surface-divider pt-4">
    <div class="mb-3 font-display text-[10px] uppercase tracking-wider text-ink-400">More details</div>
    <label class="block">
      <span class="block text-xs text-ink-400 mb-1">Phone</span>
      <input type="tel" class="input w-full" placeholder="+354 ..." bind:value={newPersonPhone} />
    </label>
    <label class="block mt-3">
      <span class="block text-xs text-ink-400 mb-1">LinkedIn URL</span>
      <input type="url" class="input w-full" placeholder="https://www.linkedin.com/in/…" bind:value={newPersonLinkedin} />
    </label>
    <label class="block mt-3">
      <span class="block text-xs text-ink-400 mb-1">Scope</span>
      <select class="input w-full" bind:value={newPersonScope}>
        <option value="work">Work</option>
        <option value="private">Private</option>
        <option value="both">Both</option>
      </select>
    </label>
  </div>

  {#snippet footer()}
    {#if newPersonError}<div class="mb-2 text-xs text-tag-salesText">{newPersonError}</div>{/if}
    <div class="flex justify-end">
      <button class="btn-primary" onclick={submitNewPerson} disabled={newPersonBusy || !newPersonName.trim()}>
        <Icon name="plus" size={14} />
        {newPersonBusy ? 'Saving…' : 'Create'}
      </button>
    </div>
  {/snippet}
</BottomSheet>

<BottomSheet open={sheet === 'org'} title="Add organisation" expandable onClose={closeSheet}>
  <label class="block">
    <span class="block text-xs text-ink-400 mb-1">Name</span>
    <input type="text" class="input w-full" placeholder="e.g. Acme Inc" bind:value={newOrgName} />
  </label>
  <label class="block mt-3">
    <span class="block text-xs text-ink-400 mb-1">Website (optional)</span>
    <input type="url" class="input w-full" placeholder="https://example.com" bind:value={newOrgWebsite} />
  </label>

  <div class="mt-5 border-t border-surface-divider pt-4">
    <div class="mb-3 font-display text-[10px] uppercase tracking-wider text-ink-400">More details</div>
    <label class="block">
      <span class="block text-xs text-ink-400 mb-1">Industry</span>
      <select class="input w-full" bind:value={newOrgIndustry}>
        <option value="">—</option>
        {#each ORG_INDUSTRY_OPTIONS as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </label>
    <label class="block mt-3">
      <span class="block text-xs text-ink-400 mb-1">Email</span>
      <input type="email" class="input w-full" placeholder="info@example.com" bind:value={newOrgEmail} />
    </label>
    <label class="block mt-3">
      <span class="block text-xs text-ink-400 mb-1">Phone</span>
      <input type="tel" class="input w-full" placeholder="+354 …" bind:value={newOrgPhone} />
    </label>
    <label class="block mt-3">
      <span class="block text-xs text-ink-400 mb-1">LinkedIn URL</span>
      <input type="url" class="input w-full" placeholder="https://www.linkedin.com/company/…" bind:value={newOrgLinkedin} />
    </label>
    <label class="block mt-3">
      <span class="block text-xs text-ink-400 mb-1">Scope</span>
      <select class="input w-full" bind:value={newOrgScope}>
        <option value="work">Work</option>
        <option value="private">Private</option>
        <option value="both">Both</option>
      </select>
    </label>
  </div>

  {#snippet footer()}
    {#if newOrgError}<div class="mb-2 text-xs text-tag-salesText">{newOrgError}</div>{/if}
    <div class="flex justify-end">
      <button class="btn-primary" onclick={submitNewOrg} disabled={newOrgBusy || !newOrgName.trim()}>
        <Icon name="plus" size={14} />
        {newOrgBusy ? 'Saving…' : 'Create'}
      </button>
    </div>
  {/snippet}
</BottomSheet>

<BottomSheet open={sheet === 'project'} title="Add project" expandable onClose={closeSheet}>
  <label class="block">
    <span class="block text-xs text-ink-400 mb-1">Name</span>
    <input type="text" class="input w-full" placeholder="e.g. IB700 Autumn 2026" bind:value={newProjectName} />
  </label>
  <label class="block mt-3">
    <span class="block text-xs text-ink-400 mb-1">Kind</span>
    <select class="input w-full" bind:value={newProjectKind}>
      <option value="project">Project</option>
      <option value="course">Course</option>
      <option value="program">Program</option>
      <option value="campaign">Campaign</option>
      <option value="theme">Theme</option>
      <option value="hraðall">Hraðall</option>
      <option value="hugmyndahraðhlaup">Hugmyndahraðhlaup</option>
      <option value="other">Other</option>
    </select>
  </label>

  <div class="mt-5 border-t border-surface-divider pt-4">
    <div class="mb-3 font-display text-[10px] uppercase tracking-wider text-ink-400">More details</div>
    <label class="block">
      <span class="block text-xs text-ink-400 mb-1">Scope</span>
      <select class="input w-full" bind:value={newProjectScope}>
        <option value="work">Work</option>
        <option value="private">Private</option>
        <option value="both">Both</option>
      </select>
    </label>
    <div class="block mt-3">
      <div class="block text-xs text-ink-400 mb-1">Colour <span class="text-ink-300">(optional)</span></div>
      <div class="flex flex-wrap items-center gap-1.5">
        {#each PROJECT_COLORS as c (c.value)}
          {@const isActive = newProjectColor === c.value}
          <button
            type="button"
            class="h-6 w-6 rounded-full transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            style="background:{c.value}; {isActive ? 'box-shadow: 0 0 0 2px var(--surface-card), 0 0 0 4px ' + c.value + ';' : ''}"
            title={c.label}
            aria-label={`Pick ${c.label}`}
            aria-pressed={isActive}
            onclick={() => (newProjectColor = isActive ? null : c.value)}
          ></button>
        {/each}
        {#if newProjectColor}
          <button type="button" class="ml-1 text-xs text-ink-400 hover:text-ink-700" onclick={() => (newProjectColor = null)}>Clear</button>
        {/if}
      </div>
    </div>
    <label class="block mt-3">
      <span class="block text-xs text-ink-400 mb-1">Summary</span>
      <textarea class="input w-full" rows="3" placeholder="What is this project about?" bind:value={newProjectSummary}></textarea>
    </label>
  </div>

  {#snippet footer()}
    {#if newProjectError}<div class="mb-2 text-xs text-tag-salesText">{newProjectError}</div>{/if}
    <div class="flex justify-end">
      <button class="btn-primary" onclick={submitNewProject} disabled={newProjectBusy || !newProjectName.trim()}>
        <Icon name="plus" size={14} />
        {newProjectBusy ? 'Saving…' : 'Create'}
      </button>
    </div>
  {/snippet}
</BottomSheet>
