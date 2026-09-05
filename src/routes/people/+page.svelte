<script lang="ts">
  import {
    searchPeople,
    countPeople,
    getCurrentRolesFor,
    createPerson,
    personName,
    assetUrl,
    bulkUpdatePeople,
    bulkDeletePeople,
    bulkAttachPeopleToProject,
    mergePersonInto,
    mergePersonIntoWithPatch,
    getPerson,
    searchProjects,
    photoPersonsForPerson,
    uploadFile,
    updatePerson,
    formatError,
    listPersonTagUsage,
    personIdsWithTags,
    type Organization,
    type Person,
    type Project,
    type Role,
    type Tag
  } from '$lib/directus';
  import { fetchAssetFile, firstMappedAsset, immichAvailable } from '$lib/immich';
  import { COUNTRIES, DEFAULT_COUNTRY, toE164, parsePhone, type CountryCode } from '$lib/phone';
  import { scope, scopeWhere } from '$lib/scope';
  import type { Filter } from '$lib/data/repo';
  import VaultPicker from '$lib/VaultPicker.svelte';
  import VaultBadge from '$lib/VaultBadge.svelte';
  import { createInVault, canCreateInto, unifiedEnabled } from '$lib/data/repo/crossVault';
  import { activeVault, defaultVaultForScope, vaults } from '$lib/data/repo/vaults';
  import { switchVault } from '$lib/vaultSwitch';
  import { searchPeopleForeign } from '$lib/data/people';
  import { canWrite } from '$lib/data/repo/vaultRole';

  // Viewer role (managed vault) → hide write affordances. The DB (RLS) is the
  // real enforcer; this just avoids showing buttons that would only fail.
  const writeAllowed = canWrite();

  // A foreign row (unified "All vaults" view) carries __vault; a local row
  // does not. Keys must be vault-scoped — two vaults can each hold Person 1.
  type Row = Person & { __vault?: { id: string; name: string } };
  const rowKey = (p: Row) => `${p.__vault?.id ?? 'me'}:${p.id}`;
  const isForeign = (p: Row): p is Row & { __vault: { id: string; name: string } } => !!p.__vault;
  function openForeign(p: Row & { __vault: { id: string; name: string } }) {
    switchVault(p.__vault.id, p.__vault.name, `/people/${p.id}`);
  }
  import { goto } from '$app/navigation';
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import MergeReview, { type MergeField } from '$lib/MergeReview.svelte';

  // --- New person flow ---
  let newOpen = $state(false);
  let newName = $state('');
  let newEmail = $state('');
  let newPhone = $state('');
  let newPhoneCountry = $state<CountryCode>(DEFAULT_COUNTRY);
  let newScope = $state<'work' | 'private' | 'both'>('work');
  let creating = $state(false);
  let newError = $state('');
  let newDone = $state('');
  // Destination vault follows the scope tag (a scope bound to a vault in
  // Settings → Vaults pulls new records of that scope there by default);
  // the picker below still lets the person override per record.
  let newVault = $state(activeVault().id);
  $effect(() => {
    const s = newScope;
    const bound = s === 'work' || s === 'private' ? defaultVaultForScope(s) : null;
    newVault = bound && canCreateInto(bound) ? bound.id : activeVault().id;
  });

  function openNew() {
    newOpen = true;
    newName = '';
    newEmail = '';
    newPhone = '';
    newPhoneCountry = DEFAULT_COUNTRY;
    newScope = $scope === 'private' ? 'private' : 'work';
    newError = '';
    newDone = '';
  }

  async function submitNew() {
    const name = newName.trim();
    if (!name) { newError = 'Name is required'; return; }
    creating = true;
    newError = '';
    try {
      // If user typed a + or country prefix, parse it; otherwise apply the
      // dropdown country to whatever digits they typed.
      const phoneRaw = newPhone.trim();
      const phoneE164 = phoneRaw
        ? (phoneRaw.startsWith('+')
            ? parsePhone(phoneRaw, newPhoneCountry).e164
            : toE164(newPhoneCountry, phoneRaw))
        : null;
      const data = {
        full_name: name,
        email: newEmail.trim() || null,
        phone: phoneE164,
        scope: newScope
      };
      if (newVault !== activeVault().id) {
        // Saved into ANOTHER vault — its detail page doesn't exist here, so
        // stay put and say where it went instead of navigating into a 404.
        await createInVault(newVault, 'Person', { status: 'published', ...data });
        const dest = vaults().find((v) => v.id === newVault);
        newDone = `Saved ${name} to “${dest?.name ?? 'the other vault'}”.`;
        newName = '';
        newEmail = '';
        newPhone = '';
        return;
      }
      const created = await createPerson(data);
      goto(`/people/${created.id}`);
    } catch (e) {
      newError = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }

  type View = 'list' | 'grid';
  let q = $state('');
  let view = $state<View>((typeof localStorage !== 'undefined' && (localStorage.getItem('twin.people.view') as View)) || 'list');
  let scopeOnly = $state(false); // when true, exclude the 'both' overlap from work/private mode
  let showArchived = $state(false);

  // ── Tag filter ────────────────────────────────────────────────────────
  // Chips for every tag in use on people ("mentor · 12"). Selecting more
  // than one narrows (AND) — the batch actions then operate on the
  // filtered set, e.g. select-all mentors → attach to a project.
  let tagOptions = $state<Array<Tag & { count: number }>>([]);
  let selTagIds = $state<number[]>([]);
  $effect(() => {
    listPersonTagUsage()
      .then((t) => (tagOptions = t))
      .catch(() => (tagOptions = []));
  });
  // Typeahead: suggestions come from the already-loaded usage list, so
  // matching is instant and counts ride along ("mentor · 240").
  let tagQuery = $state('');
  let tagFocus = $state(false);
  const selTags = $derived(
    selTagIds.map((id) => tagOptions.find((t) => t.id === id)).filter(Boolean) as Array<Tag & { count: number }>
  );
  const tagSuggestions = $derived.by(() => {
    const q = tagQuery.trim().toLowerCase();
    return tagOptions
      .filter((t) => !selTagIds.includes(t.id) && (!q || t.name.toLowerCase().includes(q)))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  });
  function pickTag(id: number) {
    if (!selTagIds.includes(id)) selTagIds = [...selTagIds, id];
    tagQuery = '';
  }
  function removeTag(id: number) {
    selTagIds = selTagIds.filter((t) => t !== id);
  }
  function onTagKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && tagSuggestions.length) {
      e.preventDefault();
      pickTag(tagSuggestions[0].id);
    } else if (e.key === 'Escape') {
      tagQuery = '';
      (e.target as HTMLElement).blur();
    } else if (e.key === 'Backspace' && !tagQuery && selTagIds.length) {
      removeTag(selTagIds[selTagIds.length - 1]);
    }
  }
  let results: Row[] = $state([]);
  let total = $state<number | null>(null);
  let rolesByPerson = $state<Map<number, Role[]>>(new Map());
  let loading = $state(false);
  let error = $state('');
  const PAGE_SIZE = 100;

  function primaryRole(p: Row): Role | null {
    if (p.__vault) return null; // foreign rows aren't role-decorated
    const arr = rolesByPerson.get(p.id);
    return arr && arr.length ? arr[0] : null;
  }

  function orgOf(r: Role | null): Organization | null {
    if (!r) return null;
    return r.organization_id && typeof r.organization_id === 'object'
      ? (r.organization_id as Organization)
      : null;
  }

  $effect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('twin.people.view', view);
  });

  let timer: ReturnType<typeof setTimeout>;
  // Guards against an async race: switching scope fires a new load while the
  // previous (e.g. All) fetch is still in flight; without this, the slower
  // stale run could resolve last and overwrite the current list.
  let loadGen = 0;
  $effect(() => {
    clearTimeout(timer);
    const query = q;
    const s = $scope;
    const strict = scopeOnly;
    const archived = showArchived;
    const tagIds = selTagIds;
    const gen = ++loadGen;
    timer = setTimeout(async () => {
      loading = true;
      error = '';
      try {
        const extra: Array<Filter | null> = [];
        const sf = scopeWhere(s);
        if (sf && strict && s !== 'all') {
          // strict mode: only exact matches, drop null / 'both'
          extra.push({ field: 'scope', op: 'eq', value: s });
        } else if (sf) {
          extra.push(sf);
        }
        if (tagIds.length) {
          const ids = await personIdsWithTags(tagIds);
          extra.push({ field: 'id', op: 'in', value: ids.length ? ids : [-1] });
        }
        // Browsing (no search term) shows newest-ADDED first, so a just-
        // created contact — often a draft — sits at the top. A search keeps
        // the name sort so matches are easy to scan.
        const listSort = query.trim() ? undefined : ['-date_created', '-id'];
        const [rows, n] = await Promise.all([
          searchPeople(query, PAGE_SIZE, extra, { includeArchived: archived, sort: listSort }),
          countPeople(query, extra, { includeArchived: archived })
        ]);
        // Unified browsing (the 1Password model): fold in every other
        // readable vault whose WORLD matches the scope — All = all vaults,
        // Work = work + shared vaults, Private = private + shared. The toggle
        // filters this merged list; it no longer switches vaults.
        let foreign: Row[] = [];
        if (unifiedEnabled()) {
          try {
            foreign = await searchPeopleForeign(query, PAGE_SIZE, s, {
              includeArchived: archived,
              sort: listSort
            });
          } catch { foreign = []; }
        }
        if (gen !== loadGen) return; // a newer load started — drop this result
        results = [...rows, ...foreign];
        total = n + foreign.length;
        // Roles decorate LOCAL rows only — getCurrentRolesFor hits the active
        // vault, and a foreign row's id means something else there.
        try {
          const roles = await getCurrentRolesFor(rows.map((p) => p.id));
          if (gen === loadGen) rolesByPerson = roles;
        } catch { if (gen === loadGen) rolesByPerson = new Map(); }
      } catch (err) {
        if (gen === loadGen) error = err instanceof Error ? err.message : String(err);
      } finally {
        if (gen === loadGen) loading = false;
      }
    }, 200);
  });

  /** Return one pill per scope this entity belongs to. `both` yields both. */
  function scopePills(s?: string | null): Array<'work' | 'private'> {
    if (s === 'both') return ['work', 'private'];
    if (s === 'work' || s === 'private') return [s];
    return [];
  }

  // ── Batch select + actions ────────────────────────────────────────────
  // Multi-select is opt-in: a "Select" button in the header flips the
  // page into selectMode, which reveals a checkbox per row + an
  // "Actions" bar pinned to the bottom of the viewport. Cancel exits
  // the mode and clears any selection.
  let selectMode = $state(false);
  let selected = $state(new Set<number>());
  const selectedCount = $derived(selected.size);
  const allOnPageSelected = $derived(
    results.length > 0 && results.every((p) => selected.has(p.id))
  );
  // Index in `results` of the last row toggled by a plain click — the anchor
  // for shift-click range selection. Cleared with the selection so a stale
  // index can't span a filtered-away range.
  let selAnchor = $state<number | null>(null);

  // Row click in select mode. Plain click toggles one row and moves the
  // anchor. Shift+click extends the selection across the whole run from the
  // anchor to this row (Finder/Gmail behaviour) — always additive, so a
  // range never un-selects what you just picked.
  function selectClick(id: number, event?: MouseEvent | KeyboardEvent) {
    const idx = results.findIndex((p) => p.id === id);
    if (event?.shiftKey && selAnchor !== null && idx !== -1) {
      const [lo, hi] = selAnchor <= idx ? [selAnchor, idx] : [idx, selAnchor];
      const next = new Set(selected);
      for (let i = lo; i <= hi; i++) next.add(results[i].id);
      selected = next;
      return;
    }
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
    if (idx !== -1) selAnchor = idx;
  }
  function selectAllOnPage() {
    selected = new Set(results.map((p) => p.id));
  }
  function clearSelection() {
    selected = new Set();
    selAnchor = null;
  }
  function exitSelectMode() {
    selectMode = false;
    clearSelection();
    mergeMode = false;
    mergeWinnerId = null;
    projectPickerOpen = false;
    scopeMode = false;
  }

  let mergeMode = $state(false);
  let mergeWinnerId = $state<number | null>(null);
  const selectedRows = $derived(results.filter((p) => selected.has(p.id)));

  // ── Field-level merge review ────────────────────────────────────
  // The user clicks Merge in select mode. We pull the full records
  // (in case the list view is missing some fields) and open the
  // review dialog. They resolve conflicts; we PATCH the winner with
  // the resolved values, then run the regular relation re-point.
  let mergeReviewOpen = $state(false);
  let mergeReviewRecords = $state<Person[]>([]);
  const PERSON_MERGE_FIELDS = [
    { key: 'full_name',          label: 'Full name' },
    { key: 'nickname',           label: 'Nickname' },
    { key: 'first_name',         label: 'First name' },
    { key: 'last_name',          label: 'Last name' },
    { key: 'email',              label: 'Email' },
    { key: 'phone',              label: 'Phone' },
    { key: 'phone_secondary',    label: 'Phone (alt)' },
    { key: 'website',            label: 'Website' },
    { key: 'birthday',           label: 'Birthday' },
    { key: 'gender',             label: 'Gender' },
    { key: 'preferred_language', label: 'Language' },
    { key: 'address_line1',      label: 'Address line 1' },
    { key: 'address_line2',      label: 'Address line 2' },
    { key: 'city',               label: 'City' },
    { key: 'postal_code',        label: 'Postal code' },
    { key: 'state_province',     label: 'State / Province' },
    { key: 'country',            label: 'Country' },
    { key: 'Linkedin',           label: 'LinkedIn' },
    { key: 'Facebook',           label: 'Facebook' },
    { key: 'source',             label: 'Source' },
    { key: 'type',               label: 'Type' }
  ] as const satisfies ReadonlyArray<MergeField<Person>>;

  async function openMergeReview() {
    if (!mergeWinnerId || selectedCount < 2 || batchBusy) return;
    batchBusy = true; batchError = '';
    try {
      // Fetch the full records so optional fields the list view
      // doesn't carry are available for the review.
      const ids = [...selected];
      // Winner first so the dialog defaults to it.
      ids.sort((a, b) => (a === mergeWinnerId ? -1 : b === mergeWinnerId ? 1 : 0));
      const full = await Promise.all(ids.map((id) => getPerson(id)));
      mergeReviewRecords = full;
      mergeReviewOpen = true;
    } catch (e) {
      batchError = formatError(e);
    } finally {
      batchBusy = false;
    }
  }

  async function performMerge(winnerId: number, loserIds: number[], patch: Partial<Person>) {
    batchBusy = true; batchError = '';
    try {
      // Apply patch once to the winner, then merge each loser without
      // a patch (relations only). Using the patch-aware helper on the
      // first loser is enough; subsequent losers just need relations
      // re-pointed.
      let first = true;
      for (const loserId of loserIds) {
        if (first) {
          await mergePersonIntoWithPatch(loserId, winnerId, patch);
          first = false;
        } else {
          await mergePersonInto(loserId, winnerId);
        }
      }
      results = results.map((p) => (loserIds.includes(p.id) ? { ...p, status: 'archived' } : p));
      mergeReviewOpen = false;
      exitSelectMode();
    } catch (e) { batchError = formatError(e); } finally { batchBusy = false; }
  }

  // Batch project picker — small inline panel inside the actions bar.
  let projectPickerOpen = $state(false);
  let projectQuery = $state('');
  let projectResults = $state<Project[]>([]);
  let projectPickerTimer: ReturnType<typeof setTimeout> | null = null;
  function onProjectQuery(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    projectQuery = v;
    if (projectPickerTimer) clearTimeout(projectPickerTimer);
    projectPickerTimer = setTimeout(async () => {
      if (!v.trim()) { projectResults = []; return; }
      try { projectResults = (await searchProjects(v, 8)) as Project[]; } catch { projectResults = []; }
    }, 180);
  }

  let batchBusy = $state(false);
  let batchError = $state('');

  // Draft is meant to be temporary — publish/archive it right from the list
  // so it isn't forgotten. Runs on the row without navigating.
  let statusBusy = $state<number | null>(null);
  async function setStatusInline(person: Person, status: 'published' | 'archived') {
    if (statusBusy) return;
    statusBusy = person.id;
    error = '';
    try {
      await updatePerson(person.id, { status } as Partial<Person>);
      // Archiving drops the row from the default view (archived is filtered
      // out unless "Show archived" is on); publishing just clears the flag.
      results = status === 'archived' && !showArchived
        ? results.filter((p) => p.id !== person.id)
        : results.map((p) => (p.id === person.id ? { ...p, status } : p));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      statusBusy = null;
    }
  }

  async function batchArchive() {
    if (selectedCount === 0 || batchBusy) return;
    if (!confirm(`Archive ${selectedCount} ${selectedCount === 1 ? 'person' : 'people'}?`)) return;
    batchBusy = true; batchError = '';
    try {
      await bulkUpdatePeople([...selected], { status: 'archived' } as Partial<Person>);
      results = results.map((p) => (selected.has(p.id) ? { ...p, status: 'archived' } : p));
      exitSelectMode();
    } catch (e) {
      batchError = formatError(e);
    } finally { batchBusy = false; }
  }

  async function batchRestore() {
    if (selectedCount === 0 || batchBusy) return;
    batchBusy = true; batchError = '';
    try {
      await bulkUpdatePeople([...selected], { status: 'published' } as Partial<Person>);
      results = results.map((p) => (selected.has(p.id) ? { ...p, status: 'published' } : p));
      exitSelectMode();
    } catch (e) {
      batchError = formatError(e);
    } finally { batchBusy = false; }
  }

  async function batchDelete() {
    if (selectedCount === 0 || batchBusy) return;
    if (!confirm(`Permanently DELETE ${selectedCount} ${selectedCount === 1 ? 'person' : 'people'}? This cannot be undone.`)) return;
    batchBusy = true; batchError = '';
    try {
      const ids = [...selected];
      await bulkDeletePeople(ids);
      results = results.filter((p) => !selected.has(p.id));
      exitSelectMode();
    } catch (e) {
      batchError = formatError(e);
    } finally { batchBusy = false; }
  }

  async function batchAttachToProject(project: Project) {
    if (selectedCount === 0 || batchBusy) return;
    batchBusy = true; batchError = '';
    try {
      await bulkAttachPeopleToProject([...selected], project.id);
      projectPickerOpen = false;
      projectQuery = '';
      projectResults = [];
      exitSelectMode();
    } catch (e) {
      batchError = formatError(e);
    } finally { batchBusy = false; }
  }

  // ── Batch: set scope ──────────────────────────────────────────────────
  let scopeMode = $state(false);
  async function batchSetScope(value: 'work' | 'private' | 'both') {
    if (selectedCount === 0 || batchBusy) return;
    batchBusy = true; batchError = '';
    try {
      const ids = [...selected];
      await bulkUpdatePeople(ids, { scope: value } as Partial<Person>);
      results = results.map((p) => (selected.has(p.id) ? { ...p, scope: value } : p));
      scopeMode = false;
      exitSelectMode();
    } catch (e) {
      batchError = formatError(e);
    } finally { batchBusy = false; }
  }

  // ── Batch: refresh profile picture from the photo library ─────────────
  // For every selected person WITHOUT a picture, adopt the first mapped
  // Immich library photo (same pipeline as the detail page's auto-avatar).
  // Best-effort per person: no faces / offline just leaves initials.
  let photoProgress = $state<{ done: number; total: number; set: number } | null>(null);
  async function batchRefreshPhotos() {
    if (selectedCount === 0 || batchBusy) return;
    const targets = selectedRows.filter((p) => !p.person_picture);
    if (targets.length === 0) {
      batchError = 'Every selected person already has a picture.';
      return;
    }
    batchBusy = true; batchError = '';
    photoProgress = { done: 0, total: targets.length, set: 0 };
    try {
      if (!(await immichAvailable())) {
        batchError = 'Photo library is offline — try again on the tailnet.';
        return;
      }
      for (const p of targets) {
        try {
          const clusterIds = (await photoPersonsForPerson(p.id)).map((m) => m.id);
          if (clusterIds.length > 0) {
            const asset = await firstMappedAsset(clusterIds);
            if (asset) {
              const file = await fetchAssetFile(asset.id, personName(p));
              const fileId = await uploadFile(file, { title: `${personName(p)} — photo library` });
              await updatePerson(p.id, { person_picture: fileId, image_focal: null } as Partial<Person>);
              results = results.map((r) => (r.id === p.id ? { ...r, person_picture: fileId, image_focal: null } : r));
              photoProgress = { ...photoProgress!, set: photoProgress!.set + 1 };
            }
          }
        } catch {
          // best-effort — skip this person, keep going
        } finally {
          photoProgress = { ...photoProgress!, done: photoProgress!.done + 1 };
        }
      }
      const { set, total } = photoProgress!;
      batchError = set === 0
        ? `No mapped library photos found for the ${total} without a picture.`
        : '';
      if (set > 0) exitSelectMode();
    } catch (e) {
      batchError = formatError(e);
    } finally {
      batchBusy = false;
      photoProgress = null;
    }
  }
</script>

<!-- Draft → publish/archive quick actions, shared by the list + grid.
     Rendered OUTSIDE the row/card anchor so it never navigates. -->
{#snippet draftActions(person: Person, extraClass = '')}
  {#if person.status === 'draft'}
    <div class="flex items-center gap-1.5 {extraClass}">
      <button
        class="rounded-full border border-surface-border px-2.5 py-0.5 text-[11px] font-medium text-ink-700 hover:bg-surface-hover disabled:opacity-50"
        onclick={() => setStatusInline(person, 'published')}
        disabled={statusBusy === person.id}
      >{statusBusy === person.id ? '…' : 'Publish'}</button>
      <button
        class="rounded-full border border-surface-border px-2.5 py-0.5 text-[11px] font-medium text-ink-500 hover:bg-surface-hover disabled:opacity-50"
        onclick={() => setStatusInline(person, 'archived')}
        disabled={statusBusy === person.id}
      >Archive</button>
    </div>
  {/if}
{/snippet}

<section class="space-y-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <h1 class="text-3xl font-semibold">
      People
      <span class="ml-2 text-ink-300 font-medium" title={total != null && total > results.length ? `Showing the first ${results.length} of ${total.toLocaleString()} matching` : ''}>
        {#if total != null && total > results.length}
          {results.length} of {total.toLocaleString()}
        {:else if total != null}
          {total.toLocaleString()}
        {:else}
          {results.length}
        {/if}
      </span>
    </h1>
    {#if writeAllowed}
      <button class="btn-primary hidden md:inline-flex" onclick={openNew}>
        <Icon name="plus" size={16} /> New person
      </button>
    {:else}
      <span class="rounded-full px-2.5 py-1 text-xs font-medium" style="background: var(--bg-tertiary); color: var(--text-tertiary);" title="You have viewer access to this vault">
        View only
      </span>
    {/if}
  </div>

  <!-- Secondary controls: search + view + filters. -->
  <div class="flex flex-wrap items-center gap-2">
    <div class="relative w-full sm:w-80">
      <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-300">
        <Icon name="search" size={16} />
      </span>
      <input type="search" bind:value={q} placeholder="Search people…" class="input pl-9" />
    </div>
    <div class="inline-flex rounded-[10px] border border-surface-border bg-surface-card p-0.5 text-xs">
      <button class="rounded-md px-2 py-1 {view === 'list' ? 'bg-surface-hover text-ink-900' : 'text-ink-400'}" onclick={() => (view = 'list')} title="List view">List</button>
      <button class="rounded-md px-2 py-1 {view === 'grid' ? 'bg-surface-hover text-ink-900' : 'text-ink-400'}" onclick={() => (view = 'grid')} title="Grid view">Grid</button>
    </div>
    <label class="inline-flex items-center gap-2 text-xs text-ink-500">
      <input type="checkbox" class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand" bind:checked={scopeOnly} />
      Strict scope
    </label>
    <label class="inline-flex items-center gap-2 text-xs text-ink-500">
      <input type="checkbox" class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand" bind:checked={showArchived} />
      Show archived
    </label>
    <!-- Batch-select toggle. Lives next to the filters so it reads as
         another optional control, not a primary action. -->
    {#if !selectMode}
      <button
        type="button"
        class="ml-auto inline-flex items-center gap-1 rounded-[8px] border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
        onclick={() => (selectMode = true)}
        title="Select multiple to batch-update"
      >
        <Icon name="check" size={12} /> Select
      </button>
    {:else}
      <div class="ml-auto inline-flex items-center gap-2 text-xs text-ink-500">
        <span class="hidden text-ink-400 sm:inline">Tip: <kbd class="rounded border border-surface-border bg-surface-hover px-1">Shift</kbd>+click to select a range</span>
        <button type="button" class="text-brand hover:underline" onclick={selectAllOnPage}>
          {allOnPageSelected ? 'All selected' : `Select all (${results.length})`}
        </button>
        <button type="button" class="hover:text-ink-700" onclick={exitSelectMode}>Cancel</button>
      </div>
    {/if}
  </div>

  <!-- Tag filter — compact typeahead. Selected tags render as removable
       chips; suggestions (with usage counts) drop down while typing.
       Stacking chips narrows with AND. -->
  {#if tagOptions.length}
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="inline-flex items-center gap-1 text-xs text-ink-400"><Icon name="tag" size={13} /> Tags</span>
      {#each selTags as t (t.id)}
        <span class="inline-flex items-center gap-1 rounded-full border border-brand bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
          {t.name} <span class="font-normal opacity-60">{t.count}</span>
          <button type="button" class="ml-0.5 opacity-70 hover:opacity-100" aria-label={`Remove ${t.name}`} onclick={() => removeTag(t.id)}>✕</button>
        </span>
      {/each}
      <div class="relative">
        <input
          type="search"
          class="input w-44 px-2.5 py-1 text-xs"
          placeholder={selTagIds.length ? 'Narrow by another tag…' : 'Filter by tag…'}
          bind:value={tagQuery}
          onfocus={() => (tagFocus = true)}
          onblur={() => setTimeout(() => (tagFocus = false), 150)}
          onkeydown={onTagKeydown}
        />
        {#if tagFocus && tagSuggestions.length}
          <ul class="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-[10px] border border-surface-border bg-surface-card shadow-lg">
            {#each tagSuggestions as t (t.id)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-ink-700 hover:bg-surface-hover"
                  onmousedown={(e) => e.preventDefault()}
                  onclick={() => pickTag(t.id)}
                >
                  <span>{t.name}</span>
                  <span class="text-ink-300">{t.count}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      {#if selTagIds.length}
        <button type="button" class="text-xs text-ink-400 hover:text-ink-700" onclick={() => (selTagIds = [])}>Clear</button>
      {/if}
    </div>
  {/if}

  {#if newOpen}
    <div class="card border-brand/40 p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="card-title"><Icon name="users" size={16} /> New person</div>
        <button class="text-ink-400 hover:text-ink-700" aria-label="Close" onclick={() => (newOpen = false)}>✕</button>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="block sm:col-span-2">
          <span class="block text-xs text-ink-400 mb-1">Full name *</span>
          <input type="text" class="input w-full" bind:value={newName} placeholder="e.g. Eva Example" autofocus />
        </label>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Email</span>
          <input type="email" class="input w-full" bind:value={newEmail} placeholder="name@example.com" />
        </label>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Phone</span>
          <div class="flex gap-2">
            <select class="input !w-auto" bind:value={newPhoneCountry} title="Country code">
              {#each COUNTRIES as c}
                <option value={c}>{c.flag} {c.code}</option>
              {/each}
            </select>
            <input type="tel" class="input w-full" bind:value={newPhone} placeholder="phone number" />
          </div>
        </label>
        <label class="block">
          <span class="block text-xs text-ink-400 mb-1">Scope</span>
          <select class="input w-full" bind:value={newScope}>
            <option value="work">Work</option>
            <option value="private">Private</option>
            <option value="both">Both</option>
          </select>
        </label>
        <VaultPicker bind:value={newVault} />
      </div>
      {#if newError}<div class="text-xs text-tag-salesText">{newError}</div>{/if}
      {#if newDone}<div class="text-xs" style="color: var(--state-success, #16a34a);">{newDone}</div>{/if}
      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost" onclick={() => (newOpen = false)} disabled={creating}>Cancel</button>
        <button class="btn-primary" onclick={submitNew} disabled={creating || !newName.trim()}>
          {creating ? 'Creating…' : 'Create & open'}
        </button>
      </div>
      <div class="text-xs text-ink-400">Created as <span class="font-medium">draft</span>. Publish from the detail page when ready.</div>
    </div>
  {/if}

  {#if error}
    <p class="rounded-[10px] border border-tag-sales bg-tag-sales px-3 py-2 text-sm text-tag-salesText">{error}</p>
  {/if}

  {#if view === 'list'}
    <div class="card overflow-hidden">
      <!-- Column headers only render at sm+; the mobile layout is a stacked card. -->
      <div class="hidden sm:grid grid-cols-[1.6fr_1.4fr_1fr_auto] items-center gap-3 border-b border-surface-divider px-4 py-3 text-xs text-ink-400">
        <span class="flex items-center gap-1"><Icon name="users" size={14} /> Contact</span>
        <span class="flex items-center gap-1"><Icon name="building" size={14} /> Work</span>
        <span class="flex items-center gap-1"><Icon name="phone" size={14} /> Phone</span>
        <span class="flex items-center gap-1"><Icon name="tag" size={14} /> Scope</span>
      </div>
      <ul class="divide-y divide-surface-divider">
        {#each results as person (rowKey(person))}
          {@const pills = scopePills(person.scope)}
          {@const pr = primaryRole(person)}
          {@const po = orgOf(pr)}
          {@const extraRoles = (rolesByPerson.get(person.id)?.length ?? 0) - 1}
          <li class="hover:bg-surface-hover {person.status === 'archived' ? 'opacity-60' : ''} {selectMode && selected.has(person.id) ? 'bg-brand/[0.06]' : ''}">
            <!-- Mobile: stacked card. Avatar + name row 1; org/role/phone
                 row 2; scope pills row 3. Min height keeps touch target ≥ 56 px.
                 In selectMode the row becomes a click-to-toggle button with
                 a checkbox slot at the front; otherwise it's a navigation
                 anchor to the detail page. <svelte:element> swaps the tag
                 cleanly so the rest of the row markup stays shared. -->
            <svelte:element
              this={selectMode ? 'div' : 'a'}
              href={selectMode || isForeign(person) ? undefined : `/people/${person.id}`}
              onclickcapture={isForeign(person) && !selectMode ? ((e: MouseEvent) => { e.preventDefault(); openForeign(person as Row & { __vault: { id: string; name: string } }); }) : undefined}
              role={selectMode ? 'button' : undefined}
              tabindex={selectMode ? 0 : undefined}
              class="flex min-h-[60px] items-center gap-3 px-4 py-3 text-sm sm:grid sm:py-2.5 {selectMode ? 'sm:grid-cols-[auto_1.6fr_1.4fr_1fr_auto] cursor-pointer' : 'sm:grid-cols-[1.6fr_1.4fr_1fr_auto]'}"
              style="touch-action: manipulation;"
              onclick={selectMode ? ((e: MouseEvent) => selectClick(person.id, e)) : undefined}
              onkeydown={selectMode ? ((e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); selectClick(person.id, e); } }) : undefined}
            >
              {#if selectMode}
                <input
                  type="checkbox"
                  class="h-5 w-5 shrink-0 rounded border-surface-border text-brand focus:ring-brand"
                  checked={selected.has(person.id)}
                  onclick={(e) => { e.stopPropagation(); selectClick(person.id, e); }}
                  aria-label={`Select ${personName(person)}`}
                />
              {/if}
              <div class="flex flex-1 items-center gap-3 min-w-0 sm:flex-initial">
                <Avatar name={personName(person)} src={assetUrl(person.person_picture, { width: 64, height: 64, fit: 'cover' })} lazy />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate text-base font-medium text-ink-900 sm:text-sm">{personName(person)}</span>
                    {#if isForeign(person)}<VaultBadge name={person.__vault.name} />{/if}
                    {#if person.status === 'draft'}<TagPill tone="sales">Draft</TagPill>{/if}
                  </div>
                  <!-- Combined secondary line on mobile: role · org · phone -->
                  <div class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-400 sm:hidden">
                    {#if pr?.role}<span class="truncate">{pr.role}</span>{/if}
                    {#if po?.name}
                      {#if pr?.role}<span>·</span>{/if}
                      <span class="truncate text-ink-500">{po.name}</span>
                    {/if}
                    {#if extraRoles > 0}<span class="text-brand">+{extraRoles}</span>{/if}
                    {#if person.phone}
                      <span>·</span>
                      <span class="truncate">{person.phone}</span>
                    {/if}
                    {#if !pr?.role && !po?.name && !person.phone && person.email}
                      <span class="truncate">{person.email}</span>
                    {/if}
                  </div>
                  <!-- sm+ : keep the email line as before -->
                  {#if person.email}
                    <div class="hidden sm:block truncate text-xs text-ink-400">{person.email}</div>
                  {/if}
                </div>
              </div>
              <!-- These columns appear only ≥sm -->
              <div class="hidden sm:block min-w-0">
                {#if po}
                  <div class="truncate text-ink-900">{po.name ?? '—'}</div>
                  <div class="truncate text-xs text-ink-400">
                    {pr?.role ?? '—'}{#if extraRoles > 0}<span class="ml-1 text-brand">+{extraRoles}</span>{/if}
                  </div>
                {:else}
                  <span class="text-ink-300">—</span>
                {/if}
              </div>
              <span class="hidden sm:inline truncate text-ink-500">{person.phone ?? '—'}</span>
              <!-- Scope pills hidden on phone — the global Work/Private toggle in the header
                   already constrains the list, and archived rows visually dim the whole row. -->
              <span class="hidden sm:inline-flex shrink-0 flex-wrap items-center justify-end gap-1">
                {#if person.status === 'archived'}
                  <TagPill tone="neutral">archived</TagPill>
                {:else if pills.length > 0}
                  {#each pills as p}
                    {#if p === 'work'}<TagPill tone="online">Work</TagPill>{:else}<TagPill tone="chat">Private</TagPill>{/if}
                  {/each}
                {:else}
                  <TagPill tone="neutral">{person.scope ?? '—'}</TagPill>
                {/if}
              </span>
            </svelte:element>
            {#if person.status === 'draft' && !selectMode}
              {@render draftActions(person, 'px-4 pb-2.5 -mt-1 sm:justify-end')}
            {/if}
          </li>
        {:else}
          <li class="px-4 py-6 text-center text-sm text-ink-400">
            {#if loading}
              Searching…
            {:else if total === 0 && !q.trim()}
              <span class="block">No people yet.</span>
              <span class="mt-1 block">
                Add your first with <span class="font-medium" style="color: var(--text-primary);">+ New person</span>
                — or <a href="/settings/storage" class="underline hover:text-ink-700">import a twin export</a>.
              </span>
            {:else}
              No results
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {#each results as person (rowKey(person))}
        {@const pills = scopePills(person.scope)}
        {@const pr = primaryRole(person)}
        {@const po = orgOf(pr)}
        {@const extraRoles = (rolesByPerson.get(person.id)?.length ?? 0) - 1}
        <div class="flex flex-col">
        <svelte:element
          this={selectMode ? 'div' : 'a'}
          href={selectMode || isForeign(person) ? undefined : `/people/${person.id}`}
              onclickcapture={isForeign(person) && !selectMode ? ((e: MouseEvent) => { e.preventDefault(); openForeign(person as Row & { __vault: { id: string; name: string } }); }) : undefined}
          role={selectMode ? 'button' : undefined}
          tabindex={selectMode ? 0 : undefined}
          class="card relative p-4 flex flex-col items-center text-center hover:shadow-card transition {person.status === 'archived' ? 'opacity-60' : ''} {selectMode ? 'cursor-pointer' : ''} {selectMode && selected.has(person.id) ? 'ring-2 ring-brand bg-brand/[0.04]' : ''}"
          onclick={selectMode ? ((e: MouseEvent) => selectClick(person.id, e)) : undefined}
          onkeydown={selectMode ? ((e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); selectClick(person.id, e); } }) : undefined}
        >
          {#if selectMode}
            <input
              type="checkbox"
              class="absolute right-3 top-3 h-5 w-5 rounded border-surface-border bg-surface-card text-brand focus:ring-brand"
              checked={selected.has(person.id)}
              onclick={(e) => { e.stopPropagation(); selectClick(person.id, e); }}
              aria-label={`Select ${personName(person)}`}
            />
          {/if}
          <Avatar name={personName(person)} src={assetUrl(person.person_picture, { width: 120, height: 120, fit: 'cover' })} size={72} lazy />
          <div class="mt-3 truncate w-full font-medium text-ink-900">{personName(person)}</div>
          {#if isForeign(person)}<div class="mt-1"><VaultBadge name={person.__vault.name} /></div>{/if}
          {#if po}
            <div class="mt-0.5 w-full truncate text-xs text-ink-500">
              {pr?.role ? pr.role + ' · ' : ''}{po.name}
              {#if extraRoles > 0}<span class="ml-1 text-brand">+{extraRoles}</span>{/if}
            </div>
          {:else if person.email}
            <div class="mt-0.5 w-full truncate text-xs text-ink-400">{person.email}</div>
          {/if}
          <div class="mt-2 inline-flex flex-wrap items-center justify-center gap-1">
            {#if person.status === 'archived'}
              <TagPill tone="neutral">archived</TagPill>
            {:else}
              {#if person.status === 'draft'}<TagPill tone="sales">Draft</TagPill>{/if}
              {#each pills as p}
                {#if p === 'work'}<TagPill tone="online">Work</TagPill>{:else}<TagPill tone="chat">Private</TagPill>{/if}
              {/each}
            {/if}
          </div>
        </svelte:element>
        {#if person.status === 'draft' && !selectMode}
          {@render draftActions(person, 'mt-1.5 justify-center')}
        {/if}
        </div>
      {:else}
        <div class="col-span-full rounded-[10px] border border-dashed border-surface-border p-8 text-center text-sm text-ink-400">
          {loading ? 'Searching…' : 'No results'}
        </div>
      {/each}
    </div>
  {/if}

  <!-- ── Batch action bar ────────────────────────────────────────────────
       Sticky on the bottom of the viewport when selectMode is on AND at
       least one row is selected. Positioned above the mobile bottom-nav
       via the same safe-area offset the FAB uses. -->
  {#if selectMode && selectedCount > 0}
    <div
      class="fixed inset-x-0 z-30 mx-auto w-full max-w-3xl px-3 sm:px-6"
      style="bottom: calc(env(safe-area-inset-bottom) + 4.75rem);"
    >
      <div class="rounded-[14px] border border-surface-border bg-surface-card p-3 shadow-card">
        {#if batchError}
          <div class="mb-2 rounded-md border border-tag-sales bg-tag-sales/30 px-2 py-1 text-xs text-tag-salesText">{batchError}</div>
        {/if}

        {#if projectPickerOpen}
          <!-- Sub-mode: project picker. Search → tap a result to attach. -->
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="font-display text-xs uppercase tracking-wider text-ink-500">Attach {selectedCount} to project</span>
              <button class="text-xs text-ink-400 hover:text-ink-700" onclick={() => { projectPickerOpen = false; projectQuery = ''; projectResults = []; }}>Back</button>
            </div>
            <input type="text" autocomplete="off" class="input w-full text-sm" placeholder="Search projects…" value={projectQuery} oninput={onProjectQuery} />
            {#if projectResults.length > 0}
              <ul class="max-h-48 overflow-auto rounded-[10px] border border-surface-border bg-surface-card">
                {#each projectResults as p (p.id)}
                  <li>
                    <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover" onclick={() => batchAttachToProject(p)} disabled={batchBusy}>
                      <Icon name="sparkles" size={14} />
                      <span class="truncate">{p.name ?? `Project ${p.id}`}</span>
                      {#if p.kind}<span class="ml-auto text-xs text-ink-400">{p.kind}</span>{/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {:else if mergeMode}
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="font-display text-xs uppercase tracking-wider text-ink-500">Merge into…</span>
              <button class="text-xs text-ink-400 hover:text-ink-700" onclick={() => { mergeMode = false; mergeWinnerId = null; }}>Back</button>
            </div>
            <ul class="max-h-48 overflow-auto rounded-[10px] border border-surface-border bg-surface-card">
              {#each selectedRows as row (row.id)}
                <li>
                  <label class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover">
                    <input
                      type="radio"
                      name="merge-winner"
                      class="h-4 w-4 border-surface-border text-brand focus:ring-brand"
                      value={row.id}
                      checked={mergeWinnerId === row.id}
                      onchange={() => (mergeWinnerId = row.id)}
                    />
                    <span class="truncate flex-1">{personName(row)}</span>
                  </label>
                </li>
              {/each}
            </ul>
            <div class="flex items-center justify-end gap-2">
              <button class="btn-primary" onclick={openMergeReview} disabled={batchBusy || !mergeWinnerId || selectedCount < 2}>
                {batchBusy ? 'Merging…' : `Merge ${selectedCount - 1} into winner`}
              </button>
            </div>
            <p class="text-[11px] text-ink-400">Roles, activities, family edges, tags, events, and notes from the losers re-point to the winner. The losers are archived (kept for history).</p>
          </div>
        {:else if scopeMode}
          <!-- Sub-mode: set scope on the selected people. -->
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="font-display text-xs uppercase tracking-wider text-ink-500">Set scope for {selectedCount}</span>
              <button class="text-xs text-ink-400 hover:text-ink-700" onclick={() => (scopeMode = false)} disabled={batchBusy}>Back</button>
            </div>
            <div class="flex flex-wrap gap-2">
              {#each [['work', 'Work'], ['private', 'Private'], ['both', 'Both']] as const as [val, label]}
                <button
                  type="button"
                  class="btn-ghost flex-1"
                  onclick={() => batchSetScope(val)}
                  disabled={batchBusy}
                >{batchBusy ? '…' : label}</button>
              {/each}
            </div>
            <p class="text-[11px] text-ink-400">Overwrites the Work/Private tag on all {selectedCount} selected.</p>
          </div>
        {:else}
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-display text-xs uppercase tracking-wider text-ink-500">
              {#if photoProgress}Fetching photos… {photoProgress.done}/{photoProgress.total} ({photoProgress.set} set){:else}{selectedCount} selected{/if}
            </span>
            <div class="ml-auto flex flex-wrap items-center gap-2">
              <button class="btn-ghost" onclick={() => (scopeMode = true)} disabled={batchBusy} title="Set Work / Private / Both on the selected people">
                <Icon name="tag" size={14} /> Set scope
              </button>
              <button class="btn-ghost" onclick={batchRefreshPhotos} disabled={batchBusy} title="For selected people with no picture, fetch the first matching library photo">
                <Icon name="sparkles" size={14} /> {batchBusy && photoProgress ? 'Fetching…' : 'Refresh photo'}
              </button>
              <button class="btn-ghost" onclick={() => (projectPickerOpen = true)} disabled={batchBusy} title="Attach the selected people to a project">
                <Icon name="sparkles" size={14} /> Add to project
              </button>
              <button class="btn-ghost" onclick={() => (mergeMode = true)} disabled={batchBusy || selectedCount < 2} title={selectedCount < 2 ? 'Pick at least two people to merge' : 'Merge selected people into one'}>
                <Icon name="move" size={14} /> Merge
              </button>
              <button class="btn-ghost" onclick={batchRestore} disabled={batchBusy} title="Move back to published">
                <Icon name="check" size={14} /> Restore
              </button>
              <button class="btn-ghost text-tag-salesText hover:text-tag-salesText" onclick={batchArchive} disabled={batchBusy} title="Move to archive">
                <Icon name="tag" size={14} /> {batchBusy ? '…' : 'Archive'}
              </button>
              <button class="btn-ghost text-tag-salesText hover:text-tag-salesText" onclick={batchDelete} disabled={batchBusy} title="Permanently delete">
                <Icon name="x" size={14} /> Delete
              </button>
              <button class="btn-ghost" onclick={clearSelection} disabled={batchBusy}>Clear</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <MergeReview
    open={mergeReviewOpen}
    records={mergeReviewRecords}
    fields={[...PERSON_MERGE_FIELDS]}
    title="Merge people — review fields"
    busy={batchBusy}
    error={batchError}
    labelOf={(p) => personName(p)}
    onCancel={() => (mergeReviewOpen = false)}
    onConfirm={(winnerId, losers, patch) => performMerge(winnerId, losers, patch)}
  />
</section>
